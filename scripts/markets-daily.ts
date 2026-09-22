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
import { assetBySymbol, type MarketAsset } from "../src/lib/markets/assets";
import {
  buildOutlook,
  ingestNews,
  ingestQuotes,
  loadWatchlist,
  resolveDuePredictions,
  type Db,
} from "../src/lib/markets/ingest.server";
import { evaluateStandingOrders } from "../src/lib/orders/evaluate.server";

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

  const supabaseUrl = requireEnv("SUPABASE_URL");

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

  // Dwie drogi uwierzytelnienia, w kolejności preferencji — identycznie jak
  // w scripts/orlen-daily.ts:
  //
  // 1. service_role — omija RLS, nic nie zależy od kont użytkowników.
  // 2. Logowanie kontem (klucz anon + e-mail i hasło) — dla instalacji,
  //    w których Supabase jest zarządzany przez Lovable i service_role jest
  //    poza zasięgiem właściciela.
  //
  // UWAGA na różnicę wobec modułu paliwowego: market_predictions i
  // market_watchlist są PER UŻYTKOWNIK, więc ownerId nie jest tu tylko
  // etykietą w logach — to on decyduje, czyja watchlista jest zaciągana i
  // czyje prognozy są rozliczane.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  const email = process.env.JARVIS_EMAIL?.trim();
  const password = process.env.JARVIS_PASSWORD;

  let db: Db;
  let ownerId: string;

  if (serviceRoleKey) {
    db = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as Db;
    ownerId = requireEnv("JARVIS_OWNER_ID");
    notice("Uwierzytelnienie: service_role.");
  } else if (anonKey && email && password) {
    const client = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: session, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !session.user) {
      fail(`Logowanie kontem ${email} nie powiodło się: ${error?.message ?? "brak użytkownika"}`);
      process.exit(1);
    }
    db = client as Db;
    ownerId = session.user.id;
    notice(`Uwierzytelnienie: konto ${email}.`);
  } else {
    fail(
      "Brak danych uwierzytelniających. Ustaw SUPABASE_SERVICE_ROLE_KEY + JARVIS_OWNER_ID albo " +
        "SUPABASE_PUBLISHABLE_KEY + JARVIS_EMAIL + JARVIS_PASSWORD w Settings → Secrets → Actions.",
    );
    process.exit(1);
  }

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
  try {
    const { errors } = await ingestQuotes(db, ownerId, assets, 200, true);
    for (const [symbol, message] of errors) {
      await report("notowania", `${symbol} — ${message}`);
    }
    notice(`notowania: ${assets.length - errors.size} z ${assets.length} instrumentów zaciągnięte`);
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
    const { rows, model } = await buildOutlook(db, ownerId, keys);
    const up = rows.filter((r) => r.direction === "up").length;
    const down = rows.filter((r) => r.direction === "down").length;
    notice(
      `typer: ${rows.length} prognoz (${up} wzrostowych, ${down} spadkowych), ` +
        `interpretacja: ${model ?? "same sygnały"}`,
    );
  } catch (err) {
    await report("typer", err instanceof Error ? err.message : String(err));
  }

  // ---------- 4. Rozliczenie prognoz ----------
  // Na końcu, żeby korzystało z notowań zaciągniętych w kroku 1 — inaczej
  // prognoza z terminem na dziś czekałaby dobę na własne rozliczenie.
  try {
    const resolved = await resolveDuePredictions(db, ownerId);
    notice(`rozliczenie: ${resolved} prognoz zamkniętych`);
  } catch (err) {
    await report("rozliczenie", err instanceof Error ? err.message : String(err));
  }

  // ---------- 5. Stałe rozkazy ----------
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
