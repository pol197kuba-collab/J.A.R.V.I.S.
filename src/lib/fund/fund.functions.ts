// FUNDUSZ (PLAN.md, S3.3) — odczyt dla panelu w /rynki i ręczne przeliczenie.
//
// getFund: ranking (portfele z metrykami), krzywe kapitału (wycena dzienna
// w układzie „szerokim” — wiersz = dzień, kolumna = gracz, pod recharts),
// pozycje i ostatnie transakcje każdego gracza z powodem.
// recomputeFundNow: to samo przeliczenie co nocny job, na żądanie. Bez
// modelu AI — tylko odczyt prognoz i notowań z bazy, więc nic nie kosztuje.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { fetchAllPages } from "@/lib/db/paginate";
import { logServerError } from "@/lib/system/logServerError";
import type { FundMetrics } from "./metrics";
import { PLAYERS, type PlayerKind } from "./players";
import { DEFAULT_FUND_SETTINGS, parseFundSettings, type FundSettings } from "./settings";
import { summarizePlayer, type PlayerSummary, type SummaryOrder } from "./summary";

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
  /** Proste podsumowanie z WSZYSTKICH transakcji gracza (nie tylko ostatnich). */
  summary: Record<string, PlayerSummary>;
  /** Granie na żywo: ostatni przebieg co 15 min i dzisiejsze zdarzenia. */
  live?: {
    lastRunAt: string | null;
    today: { fill: number; stop: number; take: number; alarm: number; alarmHold: number };
    recent: Array<{
      at: string;
      player: string;
      symbol: string;
      kind: string;
      reason: string | null;
    }>;
  };
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
      return {
        startedOn: null,
        computedAt: null,
        players: [],
        nav: [],
        positions: {},
        orders: {},
        summary: {},
      };
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

    // Podsumowanie liczone z pełnej historii — lista transakcji niżej to
    // tylko ostatnie ORDERS_PER_PLAYER, a wynik musi się zgadzać z wyceną.
    const allOrders = await fetchAllPages<{
      portfolio_id: string;
      symbol: string;
      side: string;
      notional_pln: number;
      fee_pln: number;
      realized_pln: number | null;
    }>((from, to) =>
      supabase
        .from("fund_orders")
        .select("portfolio_id, symbol, side, notional_pln, fee_pln, realized_pln, id")
        .in("portfolio_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const ordersByKey = new Map<string, SummaryOrder[]>();
    for (const o of allOrders) {
      const key = keyById.get(o.portfolio_id);
      if (!key) continue;
      const list = ordersByKey.get(key) ?? [];
      list.push({
        symbol: o.symbol,
        side: o.side === "sell" ? "sell" : "buy",
        notionalPln: Number(o.notional_pln),
        feePln: Number(o.fee_pln),
        realizedPln: o.realized_pln === null ? null : Number(o.realized_pln),
      });
      ordersByKey.set(key, list);
    }
    const summary: Record<string, PlayerSummary> = {};
    for (const p of list) {
      const m = p.metrics as { financingPln?: number } | null;
      summary[p.player] = summarizePlayer(
        ordersByKey.get(p.player) ?? [],
        positions[p.player] ?? [],
        typeof m?.financingPln === "number" ? m.financingPln : 0,
      );
    }

    // Granie na żywo — kiedy ostatnio biegło i co się dziś wydarzyło.
    const { data: lastLive } = await supabase
      .from("job_runs")
      .select("finished_at")
      .eq("owner_id", userId)
      .eq("workflow", "market-live.yml")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: liveRows } = await supabase
      .from("market_live_events")
      .select("at, player, symbol, kind, reason")
      .eq("owner_id", userId)
      .gte("at", new Date(Date.now() - 24 * 3_600_000).toISOString())
      .order("at", { ascending: false })
      .limit(200);
    const today = { fill: 0, stop: 0, take: 0, alarm: 0, alarmHold: 0 };
    for (const e of liveRows ?? []) {
      if (e.kind === "alarm_hold") today.alarmHold += 1;
      else if (e.kind in today) today[e.kind as "fill" | "stop" | "take" | "alarm"] += 1;
    }

    return {
      live: {
        lastRunAt: lastLive?.finished_at ?? null,
        today,
        recent: (liveRows ?? []).filter((e) => e.kind !== "fill").slice(0, 8),
      },
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
      summary,
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

// ------------------------------------------------------------ ustawienia ----

export type FundSettingsView = {
  settings: FundSettings;
  /** Kiedy ostatnio zapisane (null = jeszcze nigdy, gra na domyślnych). */
  updatedAt: string | null;
};

export const getFundSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FundSettingsView> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("fund_settings")
      .select("settings, updated_at")
      .eq("owner_id", userId)
      .maybeSingle();
    if (error) {
      // brak tabeli (migracja jeszcze nie weszła) = domyślne, nie błąd panelu
      await logServerError(supabase, userId, "fund.settings.get", error);
      return { settings: DEFAULT_FUND_SETTINGS, updatedAt: null };
    }
    return {
      settings: parseFundSettings(data?.settings ?? null),
      updatedAt: data?.updated_at ?? null,
    };
  });

/** Zapis ustawień = przeliczenie całej gry od dnia startu na nowych regułach. */
export const saveFundSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ settings: z.unknown() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const settings = parseFundSettings(data.settings);
    const { error } = await supabase.from("fund_settings").upsert(
      {
        owner_id: userId,
        settings: settings as unknown as Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" },
    );
    if (error) {
      await logServerError(supabase, userId, "fund.settings.save", error);
      throw new Error(error.message);
    }
    const { recomputeFund } = await import("./fund.server");
    try {
      const summary = await recomputeFund(supabase, userId);
      return { settings, summary };
    } catch (err) {
      await logServerError(supabase, userId, "fund.recompute", err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  });

// ---------------------------------------------------------- karta gracza ----

export type FundTrade = {
  executedOn: string;
  signalOn: string;
  symbol: string;
  side: "buy" | "sell";
  units: number;
  /** Cena w walucie instrumentu (ze spreadem). */
  price: number;
  notionalPln: number;
  feePln: number;
  realizedPln: number | null;
  direction: string;
  confidence: number;
  reason: string | null;
};

export type FundHolding = {
  symbol: string;
  units: number;
  valuePln: number;
  costPln: number;
  /** Ostatnie zamknięcie i zmiana dnia instrumentu (%), gdy są notowania. */
  last: number | null;
  change1d: number | null;
};

export type FundPlayerDetail = {
  key: string;
  holdings: FundHolding[];
  /** Wszystkie transakcje gracza, od najnowszej. */
  trades: FundTrade[];
};

export const getFundPlayer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ player: z.string().min(1).max(40) }).parse(input))
  .handler(async ({ context, data }): Promise<FundPlayerDetail> => {
    const { supabase, userId } = context;
    const { data: portfolio, error } = await supabase
      .from("fund_portfolios")
      .select("id")
      .eq("owner_id", userId)
      .eq("player", data.player)
      .maybeSingle();
    if (error) {
      await logServerError(supabase, userId, "fund.player", error);
      throw new Error(error.message);
    }
    if (!portfolio) return { key: data.player, holdings: [], trades: [] };

    const rows = await fetchAllPages<{
      executed_on: string;
      signal_on: string;
      symbol: string;
      side: string;
      units: number;
      price: number;
      notional_pln: number;
      fee_pln: number;
      realized_pln: number | null;
      direction: string;
      confidence: number;
      reason: string | null;
    }>((from, to) =>
      supabase
        .from("fund_orders")
        .select(
          "executed_on, signal_on, symbol, side, units, price, notional_pln, fee_pln, realized_pln, direction, confidence, reason, id",
        )
        .eq("portfolio_id", portfolio.id)
        .order("executed_on", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    );
    const trades: FundTrade[] = rows.map((o) => ({
      executedOn: o.executed_on,
      signalOn: o.signal_on,
      symbol: o.symbol,
      side: o.side === "sell" ? "sell" : "buy",
      units: Number(o.units),
      price: Number(o.price),
      notionalPln: Number(o.notional_pln),
      feePln: Number(o.fee_pln),
      realizedPln: o.realized_pln === null ? null : Number(o.realized_pln),
      direction: o.direction,
      confidence: o.confidence,
      reason: o.reason,
    }));

    const { data: posRows } = await supabase
      .from("fund_positions")
      .select("symbol, units, value_pln, cost_pln")
      .eq("portfolio_id", portfolio.id);
    const symbols = (posRows ?? []).map((p) => p.symbol);
    // dwa ostatnie zamknięcia każdego instrumentu → strzałka trendu dnia
    const closes = new Map<string, number[]>();
    if (symbols.length > 0) {
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
      const { data: q } = await supabase
        .from("market_quotes")
        .select("symbol, quote_date, close")
        .in("symbol", symbols)
        .gte("quote_date", since)
        .order("quote_date", { ascending: false });
      for (const r of q ?? []) {
        const list = closes.get(r.symbol) ?? [];
        if (list.length < 2) list.push(Number(r.close));
        closes.set(r.symbol, list);
      }
    }
    const holdings: FundHolding[] = (posRows ?? [])
      .map((p) => {
        const c = closes.get(p.symbol) ?? [];
        return {
          symbol: p.symbol,
          units: Number(p.units),
          valuePln: Number(p.value_pln),
          costPln: Number(p.cost_pln),
          last: c[0] ?? null,
          change1d: c.length === 2 && c[1] !== 0 ? ((c[0] - c[1]) / c[1]) * 100 : null,
        };
      })
      .sort((a, b) => Math.abs(b.valuePln) - Math.abs(a.valuePln));

    return { key: data.player, holdings, trades };
  });
