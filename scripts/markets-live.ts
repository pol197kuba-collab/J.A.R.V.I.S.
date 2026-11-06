/**
 * Market Grid NA ŻYWO — przebieg co 15 minut (.github/workflows/market-live.yml,
 * uruchamiany przez bazę: pg_cron → workflow_dispatch, migracja
 * 20261102090000_market_live.sql).
 *
 * Kroki:
 *   1. Stan funduszu na teraz, przeliczony w pamięci (czekające zlecenia,
 *      otwarte pozycje z progami ryzyka) — bez zapisu.
 *   2. Bieżące ceny tylko tych instrumentów (0 tokenów).
 *   3. Decyzje (src/lib/markets/live.ts): realizacje prognoz po cenie z ciągu
 *      dnia, stop-lossy i take-profity w trakcie sesji → market_live_events.
 *   4. Alarm: pozycja AI blisko stop-lossa → tani model decyduje „trzymaj /
 *      zamknij”, w puli „alarm” dziennego budżetu tokenów.
 *   5. Gdy cokolwiek się wydarzyło — przeliczenie i zapis funduszu.
 *
 * Wieczorny Market Grid (20:00) przelicza fundusz sam; w jego oknie ten
 * przebieg nic nie robi, żeby dwa zapisy funduszu się nie przeplatały.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";
import { assetBySymbol, type MarketAsset } from "../src/lib/markets/assets";
import { computeFund, loadFundSettings, persistFund } from "../src/lib/fund/fund.server";
import { liveRunDue } from "../src/lib/fund/settings";
import { fetchLivePrices } from "../src/lib/markets/liveQuotes.server";
import {
  fundRefreshDue,
  liveDecisions,
  liveQuoteRows,
  LIVE_QUOTE_SOURCE,
  type PlayerEvent,
} from "../src/lib/markets/live";
import { askAlarm } from "../src/lib/markets/alarm.server";
import { createModelBudget, DAILY_TOKEN_BUDGET, warsawDay } from "../src/lib/markets/budget";
import { computeSignals } from "../src/lib/markets/signals";
import { loadWatchlist, type Db } from "../src/lib/markets/ingest.server";

const notice = (m: string) => console.log(`::notice::${m}`);
const warn = (m: string) => console.log(`::warning::${m}`);
const fail = (m: string) => console.log(`::error::${m}`);

/** Jeden alarm na instrument i stronę co tyle godzin — bez mielenia tokenów. */
const ALARM_COOLDOWN_H = 6;

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    fail(`Brak sekretu ${name}.`);
    process.exit(1);
  }
  return v;
}

async function auth(): Promise<{ db: Db; ownerId: string }> {
  const url = requireEnv("SUPABASE_URL");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  const email = process.env.JARVIS_EMAIL?.trim();
  const password = process.env.JARVIS_PASSWORD;
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  if (serviceRoleKey) {
    return {
      db: createClient<Database>(url, serviceRoleKey, opts) as Db,
      ownerId: requireEnv("JARVIS_OWNER_ID"),
    };
  }
  if (anonKey && email && password) {
    const client = createClient<Database>(url, anonKey, opts);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      fail(`Logowanie nie powiodło się: ${error?.message ?? "brak użytkownika"}`);
      process.exit(1);
    }
    return { db: client as Db, ownerId: data.user.id };
  }
  fail("Brak danych uwierzytelniających (jak w market-grid.yml).");
  process.exit(1);
}

/**
 * Okna Market Grid w Warszawie: 20:00–20:44 (wieczór) i 8:30–9:14 w dni
 * robocze (poranek) — wtedy fundusz przelicza job sesji.
 */
function inDailyWindow(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  const weekend = ["Sat", "Sun"].includes(parts.find((p) => p.type === "weekday")?.value ?? "");
  const minutes = h * 60 + m;
  return (h === 20 && m < 45) || (!weekend && minutes >= 8 * 60 + 30 && minutes < 9 * 60 + 15);
}

async function main() {
  const startedAt = new Date();
  const { db, ownerId } = await auth();
  const keys = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() || null,
  };

  const finish = async (failures: number) => {
    await db.from("job_runs").insert({
      owner_id: ownerId,
      workflow: "market-live.yml",
      trigger: process.env.GITHUB_EVENT_NAME ?? null,
      started_at: startedAt.toISOString(),
      failures,
    });
  };

  if (inDailyWindow(startedAt)) {
    notice("Okno wieczornego Market Grid — ten przebieg nic nie robi.");
    await finish(0);
    return;
  }

  // ---------- 0. częstotliwość z ustawień funduszu ----------
  // Cron biegnie co 15 min; rzadsze pilnowanie (albo wyłączone) = pomijamy
  // przebiegi, bez zapisu do job_runs, żeby licznik „ostatni przebieg” był
  // prawdziwy.
  const settings = await loadFundSettings(db, ownerId);
  const { data: lastRun } = await db
    .from("job_runs")
    .select("finished_at")
    .eq("owner_id", ownerId)
    .eq("workflow", "market-live.yml")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!liveRunDue(lastRun?.finished_at ?? null, startedAt, settings.liveEveryMin)) {
    notice(
      settings.liveEveryMin === 0
        ? "Pilnowanie na żywo wyłączone w ustawieniach funduszu."
        : `Pilnowanie co ${settings.liveEveryMin} min — jeszcze nie teraz.`,
    );
    return;
  }

  // ---------- 1. stan funduszu ----------
  const run = await computeFund(db, ownerId, undefined, settings);
  const players = (run?.players ?? []).map((p) => ({
    key: p.key,
    pending: p.result.pending,
    live: p.result.live,
  }));
  // Wspólny takt rynku: ceny WSZYSTKICH obserwowanych instrumentów (wykres,
  // sygnały) plus tych, na których gracze mają pozycje albo zlecenia.
  const watch = await loadWatchlist(db, ownerId).catch(() => [] as string[]);
  const symbols = [
    ...new Set([
      ...watch,
      ...players.flatMap((p) => [...p.pending, ...p.live].map((x) => x.symbol)),
    ]),
  ];
  const assets = symbols.map(assetBySymbol).filter((a): a is MarketAsset => Boolean(a));
  if (assets.length === 0) {
    notice("Nic do pilnowania: brak obserwowanych instrumentów, pozycji i zleceń.");
    await finish(0);
    return;
  }

  // ---------- 2. ceny ----------
  const { prices, errors } = await fetchLivePrices(assets);
  for (const e of errors) warn(`ceny: ${e}`);
  notice(`ceny na żywo: ${prices.size} z ${assets.length} instrumentów`);

  // Zapis jako dzisiejsze notowanie (wieczorny Market Grid nadpisze je
  // prawdziwym zamknięciem). Prawdziwych zamknięć nie ruszamy.
  {
    const nowQ = new Date();
    const since = new Date(nowQ.getTime() - 5 * 86_400_000).toISOString().slice(0, 10);
    const { data: existing } = await db
      .from("market_quotes")
      .select("symbol, quote_date, source")
      .in("symbol", [...prices.keys()])
      .gte("quote_date", since);
    const realDays = new Set(
      (existing ?? [])
        .filter((r) => r.source !== LIVE_QUOTE_SOURCE)
        .map((r) => `${r.symbol}|${r.quote_date}`),
    );
    const rows = liveQuoteRows(prices, (s) => assetBySymbol(s)?.currency ?? null, realDays, nowQ);
    if (rows.length > 0) {
      const { error } = await db
        .from("market_quotes")
        .upsert(rows, { onConflict: "symbol,quote_date" });
      if (error) warn(`zapis notowań na żywo: ${error.message}`);
      else notice(`notowania na żywo zapisane: ${rows.length}`);
    }
  }

  // ---------- 3. decyzje ----------
  const now = new Date();
  const { events, alarms, skipped } = liveDecisions(players, prices, now);
  const pendingCount = players.reduce((n, p) => n + p.pending.length, 0);
  const list = (xs: string[]) => (xs.length > 0 ? xs.join(", ") : "—");
  notice(
    `czekające zlecenia: ${pendingCount}; bez realizacji — giełda zamknięta/cena nieświeża: ` +
      `${list(skipped.stale)}; brak ceny: ${list(skipped.noPrice)}; cena sprzed prognozy: ` +
      `${list(skipped.beforeForecast)}; bez godziny prognozy: ${list(skipped.noTime)}`,
  );
  type Row = Omit<PlayerEvent, "kind"> & { kind: PlayerEvent["kind"] | "alarm_hold" };
  const toRow = (e: Row, extra: { model?: string | null } = {}) => ({
    owner_id: ownerId,
    player: e.player,
    symbol: e.symbol,
    kind: e.kind,
    at: e.at,
    price: e.price,
    side: e.side ?? null,
    signal_on: e.signalOn ?? null,
    reason: e.reason ?? null,
    model: extra.model ?? null,
  });
  let written = 0;
  for (const e of events) {
    const { error } = await db.from("market_live_events").insert(toRow(e));
    // 23505 = ta realizacja już zapisana (powtórzony przebieg) — w porządku.
    if (!error) written += 1;
    else if (error.code !== "23505")
      warn(`zapis zdarzenia ${e.kind} ${e.symbol}: ${error.message}`);
  }
  const byKind = (k: string) => events.filter((e) => e.kind === k).length;
  notice(
    `zdarzenia: ${byKind("fill")} realizacji, ${byKind("stop")} stop-loss, ` +
      `${byKind("take")} take-profit (zapisane: ${written})`,
  );

  // ---------- 4. alarmy ----------
  const budget = createModelBudget(db, ownerId);
  let closed = 0;
  for (const a of alarms) {
    const since = new Date(now.getTime() - ALARM_COOLDOWN_H * 3_600_000).toISOString();
    const { data: recent } = await db
      .from("market_live_events")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("symbol", a.symbol)
      .eq("side", a.side)
      .in("kind", ["alarm", "alarm_hold"])
      .gte("at", since)
      .limit(1);
    if ((recent ?? []).length > 0) continue;

    const { data: closes } = await db
      .from("market_quotes")
      .select("quote_date, close")
      .eq("symbol", a.symbol)
      .gte("quote_date", new Date(now.getTime() - 120 * 86_400_000).toISOString().slice(0, 10))
      .order("quote_date", { ascending: true });
    const s = computeSignals(
      (closes ?? []).map((q) => ({ date: q.quote_date, close: Number(q.close) })),
    );
    const f = (v: number | null, d = 1) => (v === null ? "brak" : v.toFixed(d));
    const context = `RSI14 ${f(s.rsi, 0)} | mom5 ${f(s.momentum5)}% | mom20 ${f(s.momentum20)}% | zmienność ${f(s.volatility, 0)}%`;
    const { data: news } = await db
      .from("market_news_items")
      .select("title, impact_score")
      .contains("symbols", [a.symbol])
      .gte("published_at", new Date(now.getTime() - 48 * 3_600_000).toISOString())
      .order("published_at", { ascending: false })
      .limit(10);
    const headlines = (news ?? [])
      .sort((x, y) => Math.abs(y.impact_score ?? 0) - Math.abs(x.impact_score ?? 0))
      .map((n) => n.title);

    const decision = await askAlarm(a, context, headlines, keys, budget);
    if (decision.skipped) {
      notice(`alarm ${a.symbol}: pominięty — ${decision.skipped}`);
      continue;
    }
    const reason = `Alarm AI: ${decision.reasonPl ?? "przesłanki prognozy nieaktualne"}`;
    if (decision.action === "close") {
      for (const player of a.players) {
        const { error } = await db.from("market_live_events").insert(
          toRow(
            {
              player,
              symbol: a.symbol,
              kind: "alarm",
              at: a.at,
              price: a.price,
              side: a.side,
              reason,
            },
            { model: decision.model },
          ),
        );
        if (!error) {
          written += 1;
          closed += 1;
        }
      }
    } else {
      await db.from("market_live_events").insert(
        toRow(
          {
            player: a.players[0],
            symbol: a.symbol,
            kind: "alarm_hold",
            at: a.at,
            price: a.price,
            side: a.side,
            reason: `Alarm AI (trzymaj): ${decision.reasonPl ?? "przesłanki aktualne"}`,
          },
          { model: decision.model },
        ),
      );
    }
    notice(`alarm ${a.symbol} (${a.side}): ${decision.action} — ${decision.reasonPl ?? ""}`);
  }

  // ---------- 5. zapis funduszu ----------
  // Po zdarzeniach od razu; bez zdarzeń najwyżej raz na godzinę, żeby
  // wycena i wykres kapitału szły za cenami z taktu rynku.
  const { data: lastFund } = await db
    .from("fund_portfolios")
    .select("computed_at")
    .eq("owner_id", ownerId)
    .order("computed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const refresh = run !== null && fundRefreshDue(lastFund?.computed_at ?? null, new Date());
  if (written > 0 || refresh) {
    const fresh = await computeFund(db, ownerId, undefined, settings);
    if (fresh) await persistFund(db, ownerId, fresh);
    notice(
      written > 0
        ? `fundusz przeliczony (${written} nowych zdarzeń, ${closed} zamknięć z alarmu)`
        : "fundusz przeliczony (odświeżenie wyceny po nowych cenach)",
    );
  }

  const { data: usage } = await db
    .from("market_model_usage")
    .select("tokens_in, tokens_out")
    .eq("owner_id", ownerId)
    .eq("used_on", warsawDay());
  const used = (usage ?? []).reduce((s, u) => s + u.tokens_in + u.tokens_out, 0);
  notice(`tokeny dziś: ${used} z ${DAILY_TOKEN_BUDGET}`);
  await finish(0);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
