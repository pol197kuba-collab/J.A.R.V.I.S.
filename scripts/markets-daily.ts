/**
 * Nocny zaciąg modułu rynkowego — uruchamiany przez
 * .github/workflows/market-grid.yml (i ręcznie: `npx tsx
 * scripts/markets-daily.ts --dry-run`).
 *
 * Skrypt jest CIENKI z rozmysłem: cała logika siedzi w src/lib/markets/*,
 * pokryta testami vitest i używana też przez server functions. Tutaj są
 * wyłącznie: odczyt sekretów, kolejność kroków, izolacja błędów i raport.
 *
 * PO CO TEN JOB, skoro moduł dociąga dane sam przy wejściu na /rynki:
 *   1. Historia notowań nie może mieć dziur w dni, w których nikt nie
 *      otworzył aplikacji — wskaźniki liczą się z ciągłej serii.
 *   2. Prognoza z horyzontem tygodniowym musi zostać ROZLICZONA w swoim
 *      terminie. Bez joba rozliczenie czeka na czyjeś wejście na stronę, a
 *      im później, tym bardziej wynik odbiega od zadeklarowanego horyzontu.
 *   3. Jedna prognoza dziennie na instrument (wymusza to UNIQUE w migracji)
 *      daje regularną próbkę zamiast zlepka dni, w które ktoś akurat zajrzał.
 *
 * Każdy krok jest w osobnym try/catch — awaria newsów nie może zablokować
 * zapisu notowań, bo to notowania są powodem, dla którego ten job istnieje.
 * Ale każda awaria kończy się niezerowym kodem wyjścia, żeby zakładka
 * Actions świeciła na czerwono zamiast cicho przepuszczać zepsuty przebieg.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/integrations/supabase/types";
import {
  assetBySymbol,
  MARKET_ASSETS,
  SCAN_ASSETS,
  type MarketAsset,
} from "../src/lib/markets/assets";
import {
  buildOutlook,
  ingestNews,
  ingestQuotes,
  loadWatchlist,
  backfillPredictionContext,
  resolveDuePredictions,
  type Db,
} from "../src/lib/markets/ingest.server";
import { evaluateStandingOrders } from "../src/lib/orders/evaluate.server";
import { recomputeFund } from "../src/lib/fund/fund.server";
import {
  decideMarketRun,
  lastRunOfSession,
  SESSION_CLASSES,
  SESSION_LABEL,
  sessionAt,
} from "../src/lib/markets/schedule";
import { DAILY_TOKEN_BUDGET, warsawDay } from "../src/lib/markets/budget";
import { startJob } from "../src/lib/jobs/jobRun";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

function notice(message: string) {
  console.log(`::notice::${message}`);
}
function warn(message: string) {
  console.log(`::warning::${message}`);
}
function fail(message: string) {
  console.log(`::error::${message}`);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`Brak wymaganego sekretu ${name}. Ustaw go w Settings → Secrets → Actions.`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  if (DRY_RUN) {
    // Tryb podglądu: odpytujemy źródła notowań, ale niczego nie zapisujemy —
    // służy do sprawdzenia, czy CoinGecko, Stooq, Yahoo i Frankfurter nadal
    // odpowiadają tym, czego oczekują parsery, bez dotykania bazy.
    const { MARKET_ASSETS } = await import("../src/lib/markets/assets");
    const { fetchManyAssetSeries } = await import("../src/lib/markets/quotes.server");

    // Cały słownik, także skaner — tu widać, które tickery trzeba poprawić.
    const outcomes = await fetchManyAssetSeries([...MARKET_ASSETS], 30);
    for (const outcome of outcomes) {
      if (!outcome.ok) {
        fail(`[dry-run] ${outcome.symbol}: ${outcome.error}`);
        continue;
      }
      const last = outcome.points[outcome.points.length - 1];
      console.log(
        `[dry-run] ${outcome.symbol.padEnd(11)} ${String(outcome.source).padEnd(11)} ` +
          `${String(outcome.points.length).padStart(3)} punktów` +
          (last ? `, ostatni: ${last.date} = ${last.close}` : ""),
      );
    }
    notice("Tryb dry-run — nic nie zostało zapisane do bazy.");
    return;
  }

  // Klucze modeli są opcjonalne: bez nich newsy dostają ocenę heurystyczną,
  // a typer zapisuje wyłącznie prognozę sygnałową. Job kończy się wtedy
  // sukcesem — uboższy wynik to nie awaria.
  const keys = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() || null,
  };
  if (!keys.anthropicApiKey && !keys.geminiApiKey) {
    warn(
      "Brak ANTHROPIC_API_KEY i GEMINI_API_KEY — newsy dostaną ocenę heurystyczną, " +
        "a prognoza zapisze się tylko jako sygnałowa.",
    );
  }

  // Jedna droga uwierzytelnienia: service role + JARVIS_OWNER_ID (etap 6b,
  // src/lib/jobs/jobRun.ts). Logowanie hasłem ukryło awarię kluczy po etapie 5.
  const job = startJob("market-grid");
  const { db, ownerId } = job;

  // ---------- 0. Czy ten przebieg w ogóle ma działać ----------
  // Job uruchamia baza (workflow_dispatch) dwa razy: rano dla akcji, ETF-ów i
  // indeksów, wieczorem dla krypto, surowców i walut (schedule.ts). Spóźniony
  // cron GitHuba, który przyjdzie po przebiegu TEJ SAMEJ sesji, kończy się
  // tutaj — drugi zaciąg to drugie wywołanie modelu za te same dane.
  const startedAt = new Date();
  const event = process.env.GITHUB_EVENT_NAME;
  const session = sessionAt(startedAt);
  const classes = SESSION_CLASSES[session];
  const { data: recentRuns } = await db
    .from("job_runs")
    .select("finished_at")
    .eq("owner_id", ownerId)
    .eq("workflow", "market-grid.yml")
    .order("finished_at", { ascending: false })
    .limit(6);
  const lastSameSession = lastRunOfSession(
    (recentRuns ?? []).map((r) => r.finished_at),
    session,
  );
  const decision = decideMarketRun(event, lastSameSession, startedAt);
  if (!decision.run) {
    notice(
      decision.reason === "off_hours"
        ? "Pomijam przebieg z crona: przyszedł poza sesjami (14:00–19:00)."
        : `Pomijam przebieg z crona: ta sesja już była (${decision.lastFinishedAt}).`,
    );
    return;
  }
  notice(`sesja: ${SESSION_LABEL[session]}`);

  const failures: string[] = [];

  /** Zapisuje awarię tak, żeby była widoczna i w Actions, i w /system-logs. */
  async function report(step: string, message: string, meta: Json = {}) {
    failures.push(`${step}: ${message}`);
    fail(`${step}: ${message}`);
    try {
      await db.from("system_events").insert({
        owner_id: ownerId,
        level: "error",
        source: "market-grid",
        message: `[cron] ${step}: ${message}`,
        meta,
      });
    } catch {
      // Jeśli nawet log nie przechodzi, zostaje ::error:: powyżej.
    }
  }

  let assets: MarketAsset[] = [];
  try {
    const symbols = await loadWatchlist(db, ownerId);
    assets = symbols.map(assetBySymbol).filter((a): a is MarketAsset => Boolean(a));
    notice(`watchlista: ${assets.length} instrumentów`);
  } catch (err) {
    await report("watchlista", err instanceof Error ? err.message : String(err));
    // Bez watchlisty nie ma czego zaciągać — dalsze kroki nie mają sensu.
    process.exit(1);
  }

  // ---------- 1. Notowania ----------
  // `force: true`, bo job biegnie rzadko i zawsze ma domknąć dzień —
  // progi świeżości chronią przed zbyt częstym odpytywaniem z przeglądarki,
  // nie przed planowym przebiegiem.
  //
  // CAŁY katalog (od 6.11.2026), nie tylko watchlista i skaner — wybrać do
  // wykresu można każdy instrument, więc każdy ma mieć historię. Awaria
  // instrumentu z watchlisty to awaria przebiegu; pozostałych — tylko
  // ostrzeżenie, bo przy ponad stu darmowych zapytaniach pojedyncze odmowy
  // są normalne. Typer (krok 3) skanuje jak dotąd: watchlista + skaner.
  const watchSymbols = new Set(assets.map((a) => a.symbol));
  const scan = SCAN_ASSETS.filter((a) => !watchSymbols.has(a.symbol));
  const catalogRest = MARKET_ASSETS.filter((a) => !watchSymbols.has(a.symbol));
  // Rano tylko instrumenty tej sesji (dzisiejsza decyzja), wieczorem
  // wszystkie — wieczorny zaciąg domyka dzień całej historii notowań.
  const inSession = (a: MarketAsset) => session === "evening" || classes.includes(a.assetClass);
  try {
    const all = [...assets, ...catalogRest].filter(inSession);
    const { errors } = await ingestQuotes(db, ownerId, all, 200, true);
    let scanMisses = 0;
    for (const [symbol, message] of errors) {
      if (watchSymbols.has(symbol)) await report("notowania", `${symbol} — ${message}`);
      else {
        scanMisses += 1;
        warn(`katalog: ${symbol} — ${message}`);
      }
    }
    notice(
      `notowania: ${all.length - errors.size} z ${all.length} instrumentów zaciągnięte` +
        (scanMisses > 0 ? ` (spoza watchlisty: ${scanMisses} bez danych)` : ""),
    );
  } catch (err) {
    await report("notowania", err instanceof Error ? err.message : String(err));
  }

  // ---------- 2. Newsy ----------
  try {
    const news = await ingestNews(db, ownerId, assets, keys);
    notice(`newsy: ${news.written} zapisanych, ${news.aiCount} ocenionych przez model`);
  } catch (err) {
    await report("newsy", err instanceof Error ? err.message : String(err));
  }

  // ---------- 3. Typer ----------
  // Po notowaniach i newsach, bo liczy z jednego i drugiego.
  try {
    const { rows, model } = await buildOutlook(db, ownerId, keys, {
      scan,
      record: true,
      classes,
    });
    const scored = rows.filter((r) => r.scored);
    const up = scored.filter((r) => (r.ai?.direction ?? r.direction) === "up").length;
    const down = scored.filter((r) => (r.ai?.direction ?? r.direction) === "down").length;
    notice(
      `typer: przeskanowano ${rows.length}, model ocenił ${scored.length} najmocniejszych ` +
        `(${up} wzrostowych, ${down} spadkowych), interpretacja: ${model ?? "same sygnały"}`,
    );
    const { data: usage } = await db
      .from("market_model_usage")
      .select("tokens_in, tokens_out")
      .eq("owner_id", ownerId)
      .eq("used_on", warsawDay());
    const used = (usage ?? []).reduce((s, u) => s + u.tokens_in + u.tokens_out, 0);
    notice(`tokeny dziś: ${used} z ${DAILY_TOKEN_BUDGET}`);
  } catch (err) {
    await report("typer", err instanceof Error ? err.message : String(err));
  }

  // ---------- 4. Rozliczenie prognoz ----------
  // Na końcu, żeby korzystało z notowań zaciągniętych w kroku 1 — inaczej
  // prognoza z terminem na dziś czekałaby dobę na własne rozliczenie.
  try {
    const rebanded = await backfillPredictionContext(db, ownerId);
    if (rebanded > 0) notice(`kontekst: ${rebanded} starszych prognoz uzupełnionych`);
    const resolved = await resolveDuePredictions(db, ownerId);
    notice(`rozliczenie: ${resolved} prognoz zamkniętych`);
  } catch (err) {
    await report("rozliczenie", err instanceof Error ? err.message : String(err));
  }

  // ---------- 5. Fundusz ----------
  // Po rozliczeniu, na świeżych notowaniach. Przelicza całą historię
  // portfeli na papierze od pierwszej prognozy (bez modelu, zero tokenów).
  try {
    const fund = await recomputeFund(db, ownerId);
    if (fund.start === null) notice("fundusz: brak prognoz — nic do przeliczenia");
    else {
      const ranking = [...fund.players]
        .sort((a, b) => b.returnPct - a.returnPct)
        .map((p) => `${p.label} ${p.returnPct >= 0 ? "+" : ""}${p.returnPct.toFixed(2)}%`)
        .join(", ");
      notice(`fundusz (od ${fund.start}): ${ranking}`);
    }
  } catch (err) {
    await report("fundusz", err instanceof Error ? err.message : String(err));
  }

  // ---------- 6. Stałe rozkazy ----------
  // Na samym końcu, bo rozkaz ma być oceniany przeciwko notowaniom
  // zaciągniętym przed chwilą, a nie przeciwko wczorajszemu stanowi bazy.
  // Ten sam ewaluator obsługuje progi paliwowe w scripts/orlen-daily.ts.
  try {
    const orders = await evaluateStandingOrders(db, "market");
    for (const message of orders.errors) await report("rozkazy", message);
    notice(
      `rozkazy: ${orders.triggered} z ${orders.checked} wyzwolonych` +
        (orders.skipped > 0 ? `, ${orders.skipped} bez notowań` : ""),
    );
  } catch (err) {
    await report("rozkazy", err instanceof Error ? err.message : String(err));
  }

  // Ślad przebiegu — po nim baza wie, że dziś nie trzeba już wołać joba,
  // a cron GitHuba, że może odpuścić. Zapisany także przy awariach kroków:
  // powtórka dałaby tylko drugie wywołanie modelu z tym samym wynikiem.
  const { error: runError } = await db.from("job_runs").insert({
    owner_id: ownerId,
    workflow: "market-grid.yml",
    trigger: event ?? null,
    started_at: startedAt.toISOString(),
    failures: failures.length,
  });
  if (runError) warn(`Nie zapisałem śladu przebiegu (job_runs): ${runError.message}`);

  if (failures.length > 0) {
    fail(`Przebieg zakończony z ${failures.length} awariami.`);
    process.exit(1);
  }
  notice("Przebieg zakończony bez awarii.");
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
