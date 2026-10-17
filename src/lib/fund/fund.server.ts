// FUNDUSZ (PLAN.md, S3.2) — przeliczenie i zapis do tabel.
//
// Cała historia od pierwszej prognozy liczona od nowa (src/lib/fund/fund.ts),
// potem podmiana wierszy właściciela: portfele upsertem (stałe id), a
// zlecenia / pozycje / wycena — usuń i wstaw. Bez modelu AI, zero tokenów.
// Wołane z nocnego joba (scripts/markets-daily.ts) po rozliczeniu prognoz.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { fetchAllPages } from "@/lib/db/paginate";
import type { PricePoint } from "@/lib/markets/series";
import { addDays, DEFAULT_RULES } from "./engine";
import { buildFund, type FundRun, type PredictionRow } from "./fund";

type Db = SupabaseClient<Database>;

/** Horyzont prognoz, na których gra fundusz (jak typer). */
const HORIZON_DAYS = 7;
/** Zapas notowań przed startem — wycena w dzień bez sesji bierze ostatnią. */
const QUOTES_LEAD_DAYS = 10;
const CHUNK = 500;

const pln = (v: number): number => Math.round(v * 100) / 100;

type Insert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

/** Wynik symulacji → wiersze tabel. Czyste, testowane. */
export function fundRows(run: FundRun, ownerId: string, portfolioIds: Map<string, string>) {
  const orders: Insert<"fund_orders">[] = [];
  const positions: Insert<"fund_positions">[] = [];
  const nav: Insert<"fund_nav_daily">[] = [];
  for (const p of run.players) {
    const portfolio_id = portfolioIds.get(p.key);
    if (!portfolio_id) continue;
    for (const t of p.result.trades) {
      orders.push({
        owner_id: ownerId,
        portfolio_id,
        symbol: t.symbol,
        side: t.side,
        units: t.units,
        price: t.price,
        fx_rate: t.fxRate,
        notional_pln: pln(t.notionalPln),
        fee_pln: pln(t.feePln),
        realized_pln: t.realizedPln === null ? null : pln(t.realizedPln),
        signal_on: t.signalOn,
        executed_on: t.executedOn,
        prediction_id: t.predictionId,
        direction: t.direction,
        confidence: Math.round(t.confidence),
        reason: t.reason,
      });
    }
    for (const h of p.result.holdings) {
      positions.push({
        owner_id: ownerId,
        portfolio_id,
        symbol: h.symbol,
        units: h.units,
        cost_pln: pln(h.costPln),
        value_pln: pln(h.valuePln),
        as_of: run.end,
      });
    }
    for (const n of p.result.nav) {
      nav.push({
        owner_id: ownerId,
        portfolio_id,
        nav_date: n.date,
        nav_pln: pln(n.navPln),
        cash_pln: pln(n.cashPln),
        invested_pln: pln(n.investedPln),
      });
    }
  }
  return { orders, positions, nav };
}

async function insertChunked<T extends "fund_orders" | "fund_positions" | "fund_nav_daily">(
  db: Db,
  table: T,
  rows: Insert<T>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).insert(rows.slice(i, i + CHUNK) as never);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

export type FundSummary = {
  start: string | null;
  players: { key: string; label: string; returnPct: number; trades: number }[];
};

export async function recomputeFund(
  db: Db,
  ownerId: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<FundSummary> {
  type Row = Omit<PredictionRow, "made_on"> & { made_on: string | null; stale: boolean };
  const predictions = await fetchAllPages<Row>((from, to) =>
    db
      .from("market_predictions")
      .select("id, symbol, source, made_on, direction, confidence, rationale_pl, stale")
      .eq("owner_id", ownerId)
      .eq("horizon_days", HORIZON_DAYS)
      .order("made_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  // Kopie prognoz na nieodświeżonych notowaniach (stale) nie są decyzjami —
  // tak samo pomija je panel skuteczności.
  const live = predictions.filter(
    (p): p is Row & { made_on: string } => !p.stale && p.made_on !== null,
  );
  if (live.length === 0) return { start: null, players: [] };

  const start = live.reduce((m, p) => (p.made_on < m ? p.made_on : m), live[0].made_on);
  const symbols = [...new Set([...live.map((p) => p.symbol), "USDPLN", "EURPLN"])];
  const quotes = await fetchAllPages<{ symbol: string; quote_date: string; close: number }>(
    (from, to) =>
      db
        .from("market_quotes")
        .select("symbol, quote_date, close")
        .in("symbol", symbols)
        .gte("quote_date", addDays(start, -QUOTES_LEAD_DAYS))
        .lte("quote_date", today)
        .order("quote_date", { ascending: true })
        .order("symbol", { ascending: true })
        .range(from, to),
  );
  const closes = new Map<string, PricePoint[]>();
  for (const q of quotes) {
    const list = closes.get(q.symbol) ?? [];
    list.push({ date: q.quote_date, close: Number(q.close) });
    closes.set(q.symbol, list);
  }

  const run = buildFund(live, closes, today);
  if (!run) return { start: null, players: [] };

  // Portfele: upsert po (owner, player) — id zostaje stałe między przebiegami.
  const computedAt = new Date().toISOString();
  const { data: portfolios, error: upErr } = await db
    .from("fund_portfolios")
    .upsert(
      run.players.map((p) => ({
        owner_id: ownerId,
        player: p.key,
        label: p.label,
        kind: p.kind,
        start_cash_pln: DEFAULT_RULES.startCashPln,
        started_on: run.start,
        metrics: p.metrics as unknown as Json,
        cash_pln: pln(p.result.cashPln),
        computed_at: computedAt,
      })),
      { onConflict: "owner_id,player" },
    )
    .select("id, player");
  if (upErr) throw new Error(`fund_portfolios: ${upErr.message}`);
  const ids = new Map((portfolios ?? []).map((p) => [p.player, p.id]));
  const idList = [...ids.values()];

  for (const table of ["fund_orders", "fund_positions", "fund_nav_daily"] as const) {
    const { error } = await db.from(table).delete().in("portfolio_id", idList);
    if (error) throw new Error(`${table} (czyszczenie): ${error.message}`);
  }
  const rows = fundRows(run, ownerId, ids);
  await insertChunked(db, "fund_orders", rows.orders);
  await insertChunked(db, "fund_positions", rows.positions);
  await insertChunked(db, "fund_nav_daily", rows.nav);

  return {
    start: run.start,
    players: run.players.map((p) => ({
      key: p.key,
      label: p.label,
      returnPct: p.metrics.returnPct,
      trades: p.metrics.trades,
    })),
  };
}
