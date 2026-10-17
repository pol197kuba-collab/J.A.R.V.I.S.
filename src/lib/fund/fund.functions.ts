// FUNDUSZ (PLAN.md, S3.3) — odczyt dla panelu w /rynki i ręczne przeliczenie.
//
// getFund: ranking (portfele z metrykami), krzywe kapitału (wycena dzienna
// w układzie „szerokim” — wiersz = dzień, kolumna = gracz, pod recharts),
// pozycje i ostatnie transakcje każdego gracza z powodem.
// recomputeFundNow: to samo przeliczenie co nocny job, na żądanie. Bez
// modelu AI — tylko odczyt prognoz i notowań z bazy, więc nic nie kosztuje.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAllPages } from "@/lib/db/paginate";
import { logServerError } from "@/lib/system/logServerError";
import type { FundMetrics } from "./metrics";
import { PLAYERS, type PlayerKind } from "./players";

/** Ile ostatnich transakcji na gracza trafia do panelu. */
const ORDERS_PER_PLAYER = 60;

export type FundPlayer = {
  key: string;
  label: string;
  kind: PlayerKind;
  metrics: FundMetrics | null;
  navPln: number;
  cashPln: number;
};

export type FundOrder = {
  executedOn: string;
  signalOn: string;
  symbol: string;
  side: "buy" | "sell";
  notionalPln: number;
  feePln: number;
  realizedPln: number | null;
  direction: string;
  confidence: number;
  reason: string | null;
};

export type FundPosition = { symbol: string; valuePln: number; costPln: number };

export type FundView = {
  startedOn: string | null;
  computedAt: string | null;
  players: FundPlayer[];
  /** Wiersz = dzień; klucz gracza → wycena w PLN. */
  nav: Array<{ date: string } & Record<string, number | string>>;
  positions: Record<string, FundPosition[]>;
  orders: Record<string, FundOrder[]>;
};

const ORDER = new Map(PLAYERS.map((p, i) => [p.key, i]));

export const getFund = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FundView> => {
    const { supabase, userId } = context;
    const { data: portfolios, error } = await supabase
      .from("fund_portfolios")
      .select("id, player, label, kind, metrics, cash_pln, started_on, computed_at")
      .eq("owner_id", userId);
    if (error) {
      await logServerError(supabase, userId, "fund.get", error);
      throw new Error(error.message);
    }
    const list = (portfolios ?? []).sort(
      (a, b) => (ORDER.get(a.player) ?? 99) - (ORDER.get(b.player) ?? 99),
    );
    if (list.length === 0) {
      return { startedOn: null, computedAt: null, players: [], nav: [], positions: {}, orders: {} };
    }
    const keyById = new Map(list.map((p) => [p.id, p.player]));
    const ids = list.map((p) => p.id);

    const navRows = await fetchAllPages<{
      portfolio_id: string;
      nav_date: string;
      nav_pln: number;
    }>((from, to) =>
      supabase
        .from("fund_nav_daily")
        .select("portfolio_id, nav_date, nav_pln")
        .in("portfolio_id", ids)
        .order("nav_date", { ascending: true })
        .order("portfolio_id", { ascending: true })
        .range(from, to),
    );
    const byDate = new Map<string, { date: string } & Record<string, number | string>>();
    const lastNav = new Map<string, number>();
    for (const r of navRows) {
      const key = keyById.get(r.portfolio_id);
      if (!key) continue;
      const row = byDate.get(r.nav_date) ?? { date: r.nav_date };
      row[key] = Number(r.nav_pln);
      byDate.set(r.nav_date, row);
      lastNav.set(key, Number(r.nav_pln));
    }

    const { data: positionRows } = await supabase
      .from("fund_positions")
      .select("portfolio_id, symbol, value_pln, cost_pln")
      .in("portfolio_id", ids)
      .order("value_pln", { ascending: false });
    const positions: Record<string, FundPosition[]> = {};
    for (const r of positionRows ?? []) {
      const key = keyById.get(r.portfolio_id);
      if (!key) continue;
      (positions[key] ??= []).push({
        symbol: r.symbol,
        valuePln: Number(r.value_pln),
        costPln: Number(r.cost_pln),
      });
    }

    const orders: Record<string, FundOrder[]> = {};
    await Promise.all(
      list.map(async (p) => {
        const { data } = await supabase
          .from("fund_orders")
          .select(
            "executed_on, signal_on, symbol, side, notional_pln, fee_pln, realized_pln, direction, confidence, reason",
          )
          .eq("portfolio_id", p.id)
          .order("executed_on", { ascending: false })
          .order("symbol", { ascending: true })
          .limit(ORDERS_PER_PLAYER);
        orders[p.player] = (data ?? []).map((o) => ({
          executedOn: o.executed_on,
          signalOn: o.signal_on,
          symbol: o.symbol,
          side: o.side === "sell" ? "sell" : "buy",
          notionalPln: Number(o.notional_pln),
          feePln: Number(o.fee_pln),
          realizedPln: o.realized_pln === null ? null : Number(o.realized_pln),
          direction: o.direction,
          confidence: o.confidence,
          reason: o.reason,
        }));
      }),
    );

    return {
      startedOn: list[0].started_on,
      computedAt: list.reduce<string | null>(
        (m, p) => (p.computed_at && (!m || p.computed_at > m) ? p.computed_at : m),
        null,
      ),
      players: list.map((p) => {
        const metrics =
          p.metrics && typeof p.metrics === "object" && !Array.isArray(p.metrics)
            ? (p.metrics as unknown as FundMetrics)
            : null;
        return {
          key: p.player,
          label: p.label,
          kind: (p.kind as PlayerKind) ?? "source",
          metrics: metrics && typeof metrics.returnPct === "number" ? metrics : null,
          navPln: lastNav.get(p.player) ?? Number(p.cash_pln),
          cashPln: Number(p.cash_pln),
        };
      }),
      nav: [...byDate.values()],
      positions,
      orders,
    };
  });

export const recomputeFundNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { recomputeFund } = await import("./fund.server");
    try {
      return await recomputeFund(supabase, userId);
    } catch (err) {
      await logServerError(supabase, userId, "fund.recompute", err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  });
