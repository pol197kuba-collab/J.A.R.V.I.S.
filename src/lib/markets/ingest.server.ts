// MARKET GRID — rdzeń zaciągu: notowania, newsy, prognozy i ich
// rozliczanie. Plik serwerowy, świadomie NIEzależny od TanStacka.
//
// Istnieje dlatego, że ta sama praca musi dać się wykonać z dwóch miejsc:
// z server function (gdy ktoś wejdzie na /rynki) i z nocnego joba GitHub
// Actions (gdy nie wejdzie nikt). Trzymanie logiki w server functions
// zmuszałoby job do jej drugiej kopii — dokładnie ten sam powód, dla
// którego istnieje src/lib/fuel/ingest.server.ts.
//
// Dlatego każda funkcja tutaj bierze klienta Supabase i ownerId jako
// argumenty, zamiast czytać je z kontekstu żądania.
import { resolveWriteClient } from "@/lib/fuel/writeAccess.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  assetBySymbol,
  DEFAULT_WATCHLIST,
  isKnownSymbol,
  type AssetClass,
  type MarketAsset,
} from "./assets";
import { normalizeSeries, type PricePoint } from "./series";
import type { QuoteSource } from "./quotes.server";
import { aggregateSentiment, type MarketImpact, type MarketNewsItem } from "./news";
import {
  annualizedVolatility,
  combineOutlook,
  computeSignals,
  scoreSignals,
  type SignalDirection,
  type SignalDriver,
} from "./signals";
import {
  FLAT_BAND_PCT,
  flatBandPct,
  percentChange,
  resolveOutcome,
  sessionsInHorizon,
  type PredictionDirection,
} from "./scoreboard";
import { fetchAllPages } from "@/lib/db/paginate";
import { chooseVariant } from "@/lib/darwin/variants.server";
import { classifyRegime, type MarketRegime } from "./regime";
import { deriveLessons, LESSON_WINDOW_DAYS, type LessonInput } from "./lessons";
import { createModelBudget } from "./budget";
import { CONTROL_HORIZON_DAYS, PRIMARY_HORIZON_DAYS } from "./forecast.server";
import { horizonEnd } from "@/lib/fund/engine";
import { raiseProviderAlarm } from "@/lib/system/providerAlarm.server";

/** Klient Supabase — sesja użytkownika albo service_role, zależnie od tego, kto woła. */
export type Db = SupabaseClient<Database>;

/** Klucze modeli. Server function bierze je z user_secrets, job ze środowiska. */
export type ModelKeys = {
  anthropicApiKey: string | null;
  geminiApiKey: string | null;
};

// Notowania dzienne zmieniają się raz na sesję, więc częstsze odpytywanie
// darmowych API nic nie wnosi poza zużyciem limitu. Krypto chodzi 24/7,
// stąd krótszy próg dla niego.
const MIN_REFRESH_MS = 30 * 60_000;
const MIN_REFRESH_CRYPTO_MS = 10 * 60_000;

/**
 * Horyzont prognoz: główny 2 dni (krypto — 2 dni, reszta — 1 sesja), plus
 * kontrolny 7 dni z tej samej odpowiedzi modelu — żeby wiedzieć, czy
 * skrócenie horyzontu w ogóle pomogło (fundusz ma gracza „AI (7 dni)”).
 */
export const HORIZON_DAYS = PRIMARY_HORIZON_DAYS;
export const CONTROL_HORIZON = CONTROL_HORIZON_DAYS;

/**
 * Ile instrumentów dostaje model w jednym przebiegu. Skaner liczy sygnały
 * dla wszystkich (0 tokenów), a model ocenia tylko najmocniejsze sytuacje —
 * tak cały rynek mieści się w dziennym budżecie tokenów.
 */
export const MODEL_INSTRUMENTS = 14;

/**
 * Wersja kontekstu zapisywanego przy prognozie (pasmo, reżim, kopia).
 * Wiersze z niższą albo pustą wersją uzupełnia backfillPredictionContext.
 */
export const PREDICTION_CONTEXT_VERSION = 1;

/** Ta sama cena wejściowa — z tolerancją na zaokrąglenie NUMERIC(20,8). */
export const samePrice = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(1e-8, Math.abs(a) * 1e-9);

// Świeżość per instrument, wspólna dla wszystkich czytelników w procesie.
const lastRefreshAt = new Map<string, number>();

const refreshThresholdFor = (asset: MarketAsset): number =>
  asset.assetClass === "crypto" ? MIN_REFRESH_CRYPTO_MS : MIN_REFRESH_MS;

/**
 * Klient do zapisu we WSPÓLNYCH tabelach cache (`market_quotes`,
 * `market_news_items`). Zapis wymaga service_role — migracja
 * 20261107120000_lock_secrets_and_shared_writes.sql odebrała go zalogowanym
 * użytkownikom. Bez skonfigurowanego klucza zwracamy klienta wywołującego
 * (testy, skrypty działające na własnym kliencie).
 */
async function sharedCacheWriter(fallback: Db): Promise<Db> {
  const admin = (await resolveWriteClient()) as Db | null;
  return admin ?? fallback;
}

export async function logEvent(
  supabase: Db,
  userId: string,
  level: "error" | "warn" | "info",
  message: string,
  meta: Json,
): Promise<void> {
  try {
    await supabase
      .from("system_events")
      .insert({ owner_id: userId, level, source: "market-grid", message, meta });
    if (level !== "info") await raiseProviderAlarm(supabase, userId, message, "market-grid");
  } catch {
    // Logowanie nie ma prawa wysypać żądania ani przebiegu joba.
  }
}

export type OutlookRow = {
  symbol: string;
  label: string;
  assetClass: MarketAsset["assetClass"];
  currency: string;
  colorToken: string;
  lastPrice: number;
  /** Wypadkowa techniki i newsów, -100..100. */
  score: number;
  direction: SignalDirection;
  confidence: number;
  technicalScore: number;
  sentimentScore: number | null;
  sentimentItems: number;
  drivers: SignalDriver[];
  /** Pasmo „bez zmian" w % dla tego instrumentu i horyzontu (scoreboard.flatBandPct). */
  flatBandPct: number;
  /** To samo dla horyzontu kontrolnego (7 dni). */
  controlBandPct: number;
  /** Czy instrument trafił do zestawu ocenianego przez model w tym przebiegu. */
  scored: boolean;
  /** Reżim rynku w chwili prognozy (regime.ts); null przy zbyt krótkiej serii. */
  regime: MarketRegime | null;
  /** Werdykt modelu — null, gdy nie ma klucza albo model zawiódł. */
  ai: AiRow | null;
  /**
   * Werdykt tego samego modelu z wnioskami z rozliczonych prognoz (test A/B,
   * źródło 'ai_learned'). null, gdy wniosków jeszcze nie ma albo model zawiódł.
   */
  aiLearned: AiRow | null;
};

type AiRow = {
  direction: SignalDirection;
  confidence: number;
  rationalePl: string | null;
  /** Prognoza kontrolna 7 dni z tej samej odpowiedzi; null = model jej nie dał. */
  control: { direction: SignalDirection; confidence: number } | null;
};

// ---------------------------------------------------------- watchlista ----

/**
 * Watchlista użytkownika. Pusta tabela oznacza nowe konto, nie „użytkownik
 * wszystko usunął" — pierwsze wejście dostaje więc domyślny przekrój
 * rynków, zapisany na stałe, żeby dało się go potem edytować jak własny.
 */
export async function loadWatchlist(supabase: Db, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("market_watchlist")
    .select("symbol, position")
    .eq("owner_id", userId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);

  const symbols = (data ?? []).map((r) => r.symbol).filter(isKnownSymbol);
  if (symbols.length > 0) return symbols;

  const seed = DEFAULT_WATCHLIST.map((symbol, position) => ({
    owner_id: userId,
    symbol,
    position,
  }));
  const { error: seedErr } = await supabase
    .from("market_watchlist")
    .upsert(seed, { onConflict: "owner_id,symbol" });
  if (seedErr) throw new Error(seedErr.message);
  return [...DEFAULT_WATCHLIST];
}

// ----------------------------------------------------------- notowania ----

async function persistSeries(
  supabase: Db,
  symbol: string,
  currency: string,
  source: QuoteSource,
  points: PricePoint[],
): Promise<void> {
  if (points.length === 0) return;
  const rows = points.map((p) => ({
    symbol,
    quote_date: p.date,
    close: p.close,
    currency,
    source,
  }));
  // Paczkami — jedno żądanie z tysiącem wierszy potrafi przekroczyć limit
  // payloadu PostgREST-a.
  const writer = await sharedCacheWriter(supabase);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await writer
      .from("market_quotes")
      .upsert(rows.slice(i, i + 500), { onConflict: "symbol,quote_date" });
    if (error) throw new Error(error.message);
  }
}

/**
 * Dociąga z API te instrumenty, których cache jest przeterminowany, i
 * zapisuje wynik. Nigdy nie rzuca w górę: awaria źródła ma zostawić ślad w
 * System Logs i pozwolić modułowi pokazać to, co już ma.
 */
export async function ingestQuotes(
  supabase: Db,
  userId: string,
  assets: MarketAsset[],
  days: number,
  force: boolean,
): Promise<{ didFetch: boolean; errors: Map<string, string> }> {
  const now = Date.now();
  const stale = assets.filter(
    (a) => force || now - (lastRefreshAt.get(a.symbol) ?? 0) > refreshThresholdFor(a),
  );
  const errors = new Map<string, string>();
  if (stale.length === 0) return { didFetch: false, errors };

  const { fetchManyAssetSeries } = await import("./quotes.server");
  const outcomes = await fetchManyAssetSeries(stale, days);

  for (const outcome of outcomes) {
    const asset = assetBySymbol(outcome.symbol);
    if (!asset) continue;
    if (!outcome.ok) {
      errors.set(outcome.symbol, outcome.error);
      await logEvent(supabase, userId, "warn", `Notowania ${asset.label}: ${outcome.error}`, {
        symbol: outcome.symbol,
      } as Json);
      continue;
    }
    try {
      await persistSeries(supabase, asset.symbol, asset.currency, outcome.source, outcome.points);
      // Znacznik stawiamy dopiero po udanym zapisie — inaczej nieudana
      // runda blokowałaby ponowną próbę na cały próg świeżości.
      lastRefreshAt.set(asset.symbol, Date.now());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.set(outcome.symbol, msg);
      await logEvent(supabase, userId, "error", `Zapis cache ${asset.label}: ${msg}`, {
        symbol: asset.symbol,
      } as Json);
    }
  }
  return { didFetch: true, errors };
}

// --------------------------------------------------------------- newsy ----

/**
 * Zaciąga kanały, ocenia wpływ i zapisuje do współdzielonego cache'u.
 * Nigdy nie rzuca w górę — padnięty kanał ma zostawić ślad w System Logs i
 * pozwolić pokazać to, co już jest w bazie.
 */
export async function ingestNews(
  supabase: Db,
  userId: string,
  assets: MarketAsset[],
  keys: ModelKeys,
): Promise<{ written: number; aiCount: number; errors: string[] }> {
  const { ingestMarketNews } = await import("./news.server");
  // Już ocenione przez model z ostatnich dni — nie płacimy za nie drugi raz.
  const { data: known } = await supabase
    .from("market_news_items")
    .select("guid")
    .eq("classified_by", "ai")
    .gte("published_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .limit(1000);
  const { items, errors } = await ingestMarketNews(assets, keys, 80, {
    budget: createModelBudget(supabase, userId),
    skipGuids: new Set((known ?? []).map((k) => k.guid)),
  });

  for (const err of errors) {
    await logEvent(supabase, userId, "warn", `Kanał newsów: ${err}`, {} as Json);
  }
  // Powód pustego zaciągu wraca do wywołującego, a nie tylko do logów:
  // „brak newsów" bez przyczyny wygląda identycznie jak „jeszcze się nie
  // zaciągnęły", a to dwie zupełnie różne sytuacje.
  if (items.length === 0) {
    return {
      written: 0,
      aiCount: 0,
      // Pusto bez błędów kanałów = wszystko już było ocenione wcześniej.
      errors,
    };
  }

  // Upsert po guid: ten sam news wraca przy każdym zaciągu, a ponowna ocena
  // (np. po dodaniu klucza AI) ma poprawić wiersz, nie dołożyć drugi.
  const rows = items.map((i) => ({
    guid: i.guid,
    title: i.title,
    link: i.link,
    source: i.source,
    published_at: i.publishedAt,
    feed_tag: i.feedTag,
    symbols: i.symbols,
    impact: i.impact,
    impact_score: i.impactScore,
    summary_pl: i.summaryPl,
    classified_by: i.classifiedBy,
  }));
  const writer = await sharedCacheWriter(supabase);
  const { error } = await writer.from("market_news_items").upsert(rows, { onConflict: "guid" });
  if (error) {
    await logEvent(supabase, userId, "error", `Zapis newsów: ${error.message}`, {} as Json);
    return { written: 0, aiCount: 0, errors: [`zapis do bazy: ${error.message}`] };
  }
  return {
    written: items.length,
    aiCount: items.filter((i) => i.classifiedBy === "ai").length,
    errors,
  };
}

// ------------------------------------------------------------- typer ----

/**
 * Liczy sygnały dla całej watchlisty, prosi model o interpretację i zapisuje
 * obie wersje prognozy.
 *
 * Notowania bierze z cache'u, nie odświeża ich sam — od tego jest
 * ingestQuotes. Dzięki temu jedno wejście na stronę nie odpala dwudziestu
 * żądań do darmowych API, a nocny job może wykonać kroki w kontrolowanej
 * kolejności.
 */
export async function buildOutlook(
  supabase: Db,
  userId: string,
  keys: ModelKeys,
  opts: {
    /**
     * Dodatkowe instrumenty skanera (job). Sygnały liczone dla wszystkich,
     * model dostaje MODEL_INSTRUMENTS najmocniejszych.
     */
    scan?: MarketAsset[];
    /**
     * Zapis prognoz do market_predictions. Tylko job i ręczne „Przelicz” —
     * wejście na stronę albo pytanie do JARVIS-a nie stawia prognoz o
     * przypadkowej porze i nie woła modelu (to robi job, w budżecie).
     */
    record?: boolean;
    /**
     * Tylko te klasy instrumentów (sesja joba: rano akcje/ETF/indeksy,
     * wieczorem krypto/surowce/waluty — schedule.ts). Brak = wszystkie.
     */
    classes?: readonly AssetClass[];
  } = {},
): Promise<{ rows: OutlookRow[]; model: string | null }> {
  const watch = await loadWatchlist(supabase, userId);
  const inSession = (a: MarketAsset) => !opts.classes || opts.classes.includes(a.assetClass);
  const assets = [...new Set([...watch, ...(opts.scan ?? []).map((a) => a.symbol)])]
    .map(assetBySymbol)
    .filter((a): a is MarketAsset => Boolean(a) && inSession(a!));
  const symbols = assets.map((a) => a.symbol);
  const record = opts.record ?? false;

  // Notowania bierzemy z cache'u — typer nie odświeża danych sam, żeby
  // jedno kliknięcie nie odpalało dwudziestu żądań do darmowych API.
  // Świeżość zapewnia ingestQuotes — na stronie woła je getMarketGrid,
  // w nocnym jobie osobny krok przed tym.
  const since = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
  // STRONICOWANE. Supabase oddaje maksymalnie 1000 wierszy na zapytanie i
  // robi to CICHO — `error` zostaje null, a nadmiar znika. Dwadzieścia
  // instrumentów razy 200 dni to ~4000 wierszy, więc bez tego sygnały
  // liczyłyby się z najstarszego wycinka historii i wyglądałyby wiarygodnie
  // mimo że opisują stan sprzed miesięcy. Moduł paliwowy przerobił dokładnie
  // tę awarię (patrz src/lib/db/paginate.ts).
  //
  // Sortowanie MUSI być jednoznaczne: sama data powtarza się dla każdego z
  // instrumentów, a przy niejednoznacznej kolejności strony potrafią gubić
  // i dublować wiersze.
  const quoteRows = await fetchAllPages<{ symbol: string; quote_date: string; close: number }>(
    (from, to) =>
      supabase
        .from("market_quotes")
        .select("symbol, quote_date, close")
        .in("symbol", symbols)
        .gte("quote_date", since)
        .order("quote_date", { ascending: true })
        .order("symbol", { ascending: true })
        .range(from, to),
  );

  const pointsBySymbol = new Map<string, PricePoint[]>();
  for (const row of quoteRows ?? []) {
    const bucket = pointsBySymbol.get(row.symbol) ?? [];
    bucket.push({ date: row.quote_date, close: Number(row.close) });
    pointsBySymbol.set(row.symbol, bucket);
  }

  // Wydźwięk i nagłówki z tego samego cache'u newsów, co panel etapu 2.
  const { data: newsRows } = await supabase
    .from("market_news_items")
    .select(
      "guid, title, link, source, published_at, feed_tag, symbols, impact, impact_score, summary_pl, classified_by",
    )
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(150);

  const news: MarketNewsItem[] = (newsRows ?? []).map((r) => ({
    guid: r.guid,
    title: r.title,
    link: r.link,
    source: r.source,
    publishedAt: r.published_at,
    feedTag: r.feed_tag ?? "",
    symbols: r.symbols ?? [],
    impact: (r.impact as MarketImpact | null) ?? "neutral",
    impactScore: r.impact_score ?? 0,
    summaryPl: r.summary_pl,
    classifiedBy: r.classified_by === "ai" ? "ai" : "heuristic",
  }));
  const sentimentBySymbol = new Map(aggregateSentiment(news).map((r) => [r.symbol, r]));

  // Import dynamiczny, jak przy quotes.server/news.server: trzyma klucze
  // i wywołania modelu poza bundlem klienta.
  const { forecastWithModel, TYPER_BASELINE, TYPER_SLUG } = await import("./forecast.server");

  const prepared = assets.flatMap((asset) => {
    const points = normalizeSeries(pointsBySymbol.get(asset.symbol) ?? []);
    if (points.length < 2) return [];
    const signals = computeSignals(points);
    const technical = scoreSignals(signals);
    const sentiment = sentimentBySymbol.get(asset.symbol) ?? null;
    const headlines = news
      .filter((n) => n.symbols.includes(asset.symbol))
      .sort((a, b) => b.impactScore - a.impactScore)
      .slice(0, 4)
      .map((n) => n.title);
    return [
      {
        asset,
        technical,
        sentimentScore: sentiment?.score ?? null,
        sentimentItems: sentiment?.items ?? 0,
        headlines,
        lastPrice: points[points.length - 1].close,
        flatBandPct: flatBandPct(
          signals.volatility,
          sessionsInHorizon(HORIZON_DAYS, asset.assetClass),
        ),
        controlBandPct: flatBandPct(
          signals.volatility,
          sessionsInHorizon(CONTROL_HORIZON, asset.assetClass),
        ),
        regime: classifyRegime(signals),
      },
    ];
  });

  // Zestaw dla modelu: najmocniejsze sytuacje (|wynik sygnałów|), remis —
  // watchlista przed skanerem. Ten sam zestaw dostają WSZYSTKIE źródła
  // (sygnały, AI, AI z wnioskami), żeby porównanie było uczciwe.
  const watchSet = new Set(watch);
  const ranked = [...prepared].sort(
    (a, b) =>
      Math.abs(b.technical.score) - Math.abs(a.technical.score) ||
      Number(watchSet.has(b.asset.symbol)) - Number(watchSet.has(a.asset.symbol)),
  );
  const chosen = new Set(ranked.slice(0, MODEL_INSTRUMENTS).map((p) => p.asset.symbol));
  const forModel = prepared.filter((p) => chosen.has(p.asset.symbol));
  const useModel = record && Boolean(keys.anthropicApiKey || keys.geminiApiKey);
  const budget = createModelBudget(supabase, userId);

  // Darwin: który wariant promptu typera prognozuje dziś (champion albo
  // pretendent). Bez kluczy model i tak nie ruszy — wtedy bez losowania.
  // Błąd bazy = null = zwykły prompt (prognoza nie może przez to paść).
  const variant = useModel
    ? await chooseVariant(supabase, userId, TYPER_SLUG, { baseline: TYPER_BASELINE })
    : null;
  const strategy = variant?.prompt;

  const noKeys = { anthropicApiKey: null, geminiApiKey: null };
  const forecast = await forecastWithModel(forModel, useModel ? keys : noKeys, {
    strategy,
    budget,
  });

  // Wariant „z wnioskami" testu A/B: ten sam model, ten sam prompt, plus
  // wnioski z rozliczonych prognoz. Tylko gdy wnioski są — bez nich byłby
  // kopią kontrolnego i rozmywał porównanie.
  // Wnioski z prognoz głównego horyzontu; dopóki ich nie ma (pierwsze dni
  // po zmianie), z horyzontu 7-dniowego — opisane jako takie.
  let lessons: ReturnType<typeof deriveLessons> = [];
  if (forecast.model) {
    lessons = deriveLessons(await loadLessonInputs(supabase, userId, HORIZON_DAYS), Date.now(), {
      horizonDays: HORIZON_DAYS,
    });
    if (lessons.length === 0) {
      lessons = deriveLessons(
        await loadLessonInputs(supabase, userId, CONTROL_HORIZON),
        Date.now(),
        { horizonDays: CONTROL_HORIZON },
      );
    }
  }
  const learned =
    lessons.length > 0
      ? await forecastWithModel(forModel, keys, {
          lessons: lessons.map((l) => l.textPl),
          strategy,
          budget,
        })
      : null;
  if (learned?.failure) {
    await logEvent(
      supabase,
      userId,
      "warn",
      `Typer: brak prognozy z wnioskami — ${learned.failure}`,
      {} as Json,
    );
  }
  if (forecast.failure) {
    await logEvent(
      supabase,
      userId,
      "warn",
      `Typer: brak prognozy modelu, zapisano tylko sygnały — ${forecast.failure}`,
      {} as Json,
    );
  }

  const modelIdx = new Map(forModel.map((p, i) => [p.asset.symbol, i]));
  const rows: OutlookRow[] = prepared.map((input) => {
    const combined = combineOutlook(input.technical, input.sentimentScore, input.sentimentItems);
    const idx = modelIdx.get(input.asset.symbol);
    const verdict = idx === undefined ? undefined : forecast.verdicts[idx];
    const learnedVerdict = idx === undefined ? undefined : learned?.verdicts[idx];
    return {
      symbol: input.asset.symbol,
      label: input.asset.label,
      assetClass: input.asset.assetClass,
      currency: input.asset.currency,
      colorToken: input.asset.colorToken,
      lastPrice: input.lastPrice,
      score: combined.score,
      direction: combined.direction,
      confidence: combined.confidence,
      technicalScore: input.technical.score,
      sentimentScore: input.sentimentScore,
      sentimentItems: input.sentimentItems,
      drivers: input.technical.drivers,
      flatBandPct: input.flatBandPct,
      controlBandPct: input.controlBandPct,
      scored: idx !== undefined,
      regime: input.regime,
      // Werdykt „ai" istnieje tylko wtedy, gdy model faktycznie
      // odpowiedział — inaczej podpisalibyśmy arytmetykę nazwą modelu.
      ai:
        forecast.model && verdict
          ? {
              direction: verdict.direction,
              confidence: verdict.confidence,
              rationalePl: verdict.rationalePl,
              control: verdict.control,
            }
          : null,
      aiLearned:
        learned?.model && learnedVerdict
          ? {
              direction: learnedVerdict.direction,
              confidence: learnedVerdict.confidence,
              rationalePl: learnedVerdict.rationalePl,
              control: learnedVerdict.control,
            }
          : null,
    };
  });

  // Bez wywołania modelu (strona, JARVIS) pokazujemy ostatnie zapisane
  // werdykty modelu — te z joba — zamiast pustych pól.
  if (!useModel) await attachStoredVerdicts(supabase, userId, rows);

  if (record) {
    await recordPredictions(
      supabase,
      userId,
      rows.filter((r) => r.scored),
      forecast.model,
      learned?.model ? { model: learned.model, lessons: lessons.map((l) => l.textPl) } : null,
      variant?.id ?? null,
    );
  }

  // Pusty typer wygląda w UI tak samo, niezależnie od przyczyny: braku
  // notowań w cache'u, zbyt krótkich serii czy pustej watchlisty. Bez tego
  // wpisu diagnoza sprowadzała się do zgadywania — stąd liczby, które
  // rozstrzygają, gdzie urwał się łańcuch.
  if (rows.length === 0) {
    await logEvent(
      supabase,
      userId,
      "warn",
      `Typer nie policzył żadnego sygnału: ${assets.length} instrumentów na watchliście, ` +
        `${quoteRows.length} wierszy notowań w cache, ${pointsBySymbol.size} instrumentów z jakimkolwiek notowaniem`,
      { symbols } as Json,
    );
  }

  return {
    // Najmocniejsze sygnały na górze, niezależnie od kierunku.
    rows: rows.sort((a, b) => Math.abs(b.score) - Math.abs(a.score)),
    model: forecast.model,
  };
}

/**
 * Zapisuje prognozy razem z ceną z momentu ich postawienia.
 *
 * Bez tej ceny rozliczenie byłoby zgadywaniem, od czego liczyć zmianę, a
 * trafności nie da się odtworzyć wstecz — albo zapisujemy ją od pierwszego
 * dnia, albo nie dowiemy się nigdy, czy moduł działa.
 *
 * Ograniczenie UNIQUE w migracji dopuszcza jedną prognozę dziennie na
 * instrument i źródło, więc `ignoreDuplicates` sprawia, że kolejne
 * odświeżenia tego samego dnia nie rozcieńczają statystyki.
 */
async function recordPredictions(
  supabase: Db,
  userId: string,
  rows: OutlookRow[],
  model: string | null,
  learned: { model: string; lessons: string[] } | null = null,
  /** Wariant Darwina, który napisał prognozy modelu (ai i ai_learned). */
  variantId: string | null = null,
): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date();
  const timeOfDay = now.toISOString().slice(10);
  const today = now.toISOString().slice(0, 10);
  /** Termin rozliczenia: krypto — dni kalendarzowe, reszta — sesje. */
  const dueAt = (assetClass: string, days: number): string =>
    `${horizonEnd(today, days, assetClass)}${timeOfDay}`;

  // Ostatnia cena wejściowa per instrument, źródło i horyzont. Ta sama cena
  // co w poprzedniej prognozie = notowania się nie odświeżyły (weekend,
  // awaria źródła) i nowa prognoza byłaby kopią poprzedniej, liczoną drugi
  // raz w trafności.
  const { data: recent } = await supabase
    .from("market_predictions")
    .select("symbol, source, horizon_days, price_at_prediction")
    .eq("owner_id", userId)
    .in("horizon_days", [HORIZON_DAYS, CONTROL_HORIZON])
    .order("made_at", { ascending: false })
    .limit(1000);
  const lastPrice = new Map<string, number>();
  for (const r of recent ?? []) {
    const key = `${r.symbol}|${r.source}|${r.horizon_days}`;
    if (!lastPrice.has(key)) lastPrice.set(key, Number(r.price_at_prediction));
  }
  const isCopy = (symbol: string, source: string, horizon: number, price: number): boolean => {
    const prev = lastPrice.get(`${symbol}|${source}|${horizon}`);
    return prev !== undefined && samePrice(prev, price);
  };

  const base = (row: OutlookRow, horizon: number) => ({
    owner_id: userId,
    symbol: row.symbol,
    horizon_days: horizon,
    due_at: dueAt(row.assetClass, horizon),
    flat_band_pct: horizon === HORIZON_DAYS ? row.flatBandPct : row.controlBandPct,
    regime: row.regime,
    context_version: PREDICTION_CONTEXT_VERSION,
    price_at_prediction: row.lastPrice,
    technical_score: row.technicalScore,
    sentiment_score: row.sentimentScore,
  });

  // Sygnały: tylko horyzont główny — arytmetyka nie ma osobnego zdania o
  // tygodniu, a kopia tej samej prognozy pod dwoma horyzontami nic nie mówi.
  const signalRows = rows.map((row) => ({
    ...base(row, HORIZON_DAYS),
    direction: row.direction,
    confidence: row.confidence,
    rationale_pl: row.drivers[0]?.note ?? null,
    source: "signals" as const,
    model: null,
  }));

  // Prognozy modelu: główna (2 dni) i kontrolna (7 dni) z tej samej odpowiedzi.
  const modelRows = (
    source: "ai" | "ai_learned",
    pick: (r: OutlookRow) => AiRow | null,
    extra: Record<string, unknown>,
  ) =>
    rows.flatMap((row) => {
      const v = pick(row);
      if (!v) return [];
      const out = [
        {
          ...base(row, HORIZON_DAYS),
          direction: v.direction,
          confidence: v.confidence,
          rationale_pl: v.rationalePl,
          source,
          variant_id: variantId,
          ...extra,
        },
      ];
      if (v.control) {
        out.push({
          ...base(row, CONTROL_HORIZON),
          direction: v.control.direction,
          confidence: v.control.confidence,
          rationale_pl: v.rationalePl,
          source,
          variant_id: variantId,
          ...extra,
        });
      }
      return out;
    });

  // Prognoza modelu zapisywana OSOBNO, żeby panel skuteczności mógł
  // odpowiedzieć, czy model bije prostą arytmetykę.
  const aiRows = model ? modelRows("ai", (r) => r.ai, { model }) : [];
  const learnedRows = learned
    ? modelRows("ai_learned", (r) => r.aiLearned, {
        model: learned.model,
        // Które wnioski widział model — bez tego nie da się później
        // ocenić, co faktycznie pomogło, a co zaszkodziło.
        lessons: learned.lessons as unknown as Json,
      })
    : [];

  const fresh = [...signalRows, ...aiRows, ...learnedRows].filter(
    (r) => !isCopy(r.symbol, r.source, r.horizon_days, r.price_at_prediction),
  );
  if (fresh.length === 0) return;

  const { error } = await supabase.from("market_predictions").upsert(fresh, {
    onConflict: "owner_id,symbol,source,horizon_days,made_on",
    ignoreDuplicates: true,
  });
  if (error) {
    await logEvent(supabase, userId, "warn", `Zapis prognoz: ${error.message}`, {} as Json);
  }
}

// ------------------------------------------------------- rozliczanie ----

/**
 * Rozlicza prognozy, którym minął termin.
 *
 * Cena rozliczeniowa to pierwsze notowanie NIE WCZEŚNIEJSZE niż termin —
 * a nie po prostu „ostatnie, jakie mamy". Ta różnica jest istotna: gdyby
 * brać ostatnie notowanie, prognoza sprzed dwóch miesięcy rozliczyłaby się
 * wobec dzisiejszej ceny, czyli na zupełnie innym horyzoncie niż ten, który
 * zadeklarowała.
 */
export async function resolveDuePredictions(supabase: Db, userId: string): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from("market_predictions")
    .select("id, symbol, direction, due_at, price_at_prediction, flat_band_pct")
    .eq("owner_id", userId)
    .is("outcome", null)
    .lte("due_at", nowIso)
    .limit(200);
  if (error || !due || due.length === 0) return 0;

  let resolved = 0;
  for (const prediction of due) {
    const dueDate = prediction.due_at.slice(0, 10);
    const { data: quote } = await supabase
      .from("market_quotes")
      .select("close, quote_date")
      .eq("symbol", prediction.symbol)
      .gte("quote_date", dueDate)
      .order("quote_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    // Brak notowania z terminu albo po nim znaczy, że jeszcze nie ma czym
    // rozliczyć (weekend, święto, luka w danych) — zostawiamy na później.
    if (!quote) continue;

    const change = percentChange(Number(prediction.price_at_prediction), Number(quote.close));
    if (change === null) continue;

    const { error: updErr } = await supabase
      .from("market_predictions")
      .update({
        resolved_at: new Date().toISOString(),
        price_at_resolution: Number(quote.close),
        actual_change_pct: change,
        // Pasmo zapisane przy postawieniu prognozy; brak (wiersz sprzed
        // 2026-10, jeszcze nieprzeliczony) = stały próg — backfill poprawi.
        outcome: resolveOutcome(
          prediction.direction as PredictionDirection,
          change,
          prediction.flat_band_pct === null ? FLAT_BAND_PCT : Number(prediction.flat_band_pct),
        ),
        outcome_fixed_band: resolveOutcome(prediction.direction as PredictionDirection, change),
      })
      .eq("id", prediction.id)
      .eq("owner_id", userId);
    if (!updErr) resolved += 1;
  }
  return resolved;
}

/**
 * Uzupełnia kontekst prognoz zapisanych, zanim aplikacja go liczyła.
 *
 * Dla każdej prognozy bez `context_version`:
 * - pasmo „bez zmian" i reżim rynku — z notowań SPRZED dnia jej postawienia,
 *   żeby nie korzystać z wiedzy, której prognoza nie miała;
 * - kopia (`stale`) — gdy ma tę samą cenę wejściową co poprzednia prognoza
 *   tego samego instrumentu i źródła (notowania się nie odświeżyły);
 * - jeśli pasma jeszcze nie miała, a jest rozliczona: dotychczasowy wynik
 *   (stały ±1%) trafia do `outcome_fixed_band`, `outcome` dostaje wynik wg
 *   pasma.
 * Idempotentne — dotyka tylko wierszy bez `context_version`.
 */
export async function backfillPredictionContext(supabase: Db, userId: string): Promise<number> {
  const { data: pending, error } = await supabase
    .from("market_predictions")
    .select("id")
    .eq("owner_id", userId)
    .is("context_version", null)
    .limit(1);
  if (error || !pending || pending.length === 0) return 0;

  // Całość historii — kopię rozpoznaje się po POPRZEDNIM wierszu, który może
  // już mieć kontekst. Kilkaset wierszy na konto, więc jedno zapytanie.
  const rows = await fetchAllPages<{
    id: string;
    symbol: string;
    source: string;
    made_at: string;
    horizon_days: number;
    direction: string;
    outcome: string | null;
    actual_change_pct: number | null;
    price_at_prediction: number;
    flat_band_pct: number | null;
    context_version: number | null;
  }>((from, to) =>
    supabase
      .from("market_predictions")
      .select(
        "id, symbol, source, made_at, horizon_days, direction, outcome, actual_change_pct, price_at_prediction, flat_band_pct, context_version",
      )
      .eq("owner_id", userId)
      .order("made_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const todo = rows.filter((r) => r.context_version === null);
  if (todo.length === 0) return 0;

  const symbols = [...new Set(todo.map((r) => r.symbol))];
  const since = new Date(Date.parse(todo[0].made_at) - 120 * 86_400_000).toISOString().slice(0, 10);
  const quotes = await fetchAllPages<{ symbol: string; quote_date: string; close: number }>(
    (from, to) =>
      supabase
        .from("market_quotes")
        .select("symbol, quote_date, close")
        .in("symbol", symbols)
        .gte("quote_date", since)
        .order("quote_date", { ascending: true })
        .order("symbol", { ascending: true })
        .range(from, to),
  );
  const bySymbol = new Map<string, PricePoint[]>();
  for (const q of quotes ?? []) {
    const bucket = bySymbol.get(q.symbol) ?? [];
    bucket.push({ date: q.quote_date, close: Number(q.close) });
    bySymbol.set(q.symbol, bucket);
  }

  // Poprzednia cena wejściowa per instrument|źródło|horyzont, w kolejności czasu.
  const previousPrice = new Map<string, number>();
  const prevOf = new Map<string, number | undefined>();
  for (const r of rows) {
    const key = `${r.symbol}|${r.source}|${r.horizon_days}`;
    prevOf.set(r.id, previousPrice.get(key));
    previousPrice.set(key, Number(r.price_at_prediction));
  }

  let updated = 0;
  for (const row of todo) {
    // Dzień postawienia w UTC — tak samo liczy kolumna made_on.
    const madeOn = row.made_at.slice(0, 10);
    const history = normalizeSeries(bySymbol.get(row.symbol) ?? []).filter((p) => p.date < madeOn);
    const signals = computeSignals(history);
    const asset = assetBySymbol(row.symbol);
    const prev = prevOf.get(row.id);

    const patch: Database["public"]["Tables"]["market_predictions"]["Update"] = {
      regime: classifyRegime(signals),
      stale: prev !== undefined && samePrice(prev, Number(row.price_at_prediction)),
      context_version: PREDICTION_CONTEXT_VERSION,
    };
    if (row.flat_band_pct === null) {
      const band = flatBandPct(
        annualizedVolatility(history.slice(-60)),
        sessionsInHorizon(row.horizon_days, asset?.assetClass ?? "equity"),
      );
      patch.flat_band_pct = band;
      const change = row.actual_change_pct === null ? null : Number(row.actual_change_pct);
      if (row.outcome && change !== null && Number.isFinite(change)) {
        patch.outcome_fixed_band = row.outcome;
        patch.outcome = resolveOutcome(row.direction as PredictionDirection, change, band);
      }
    }

    const { error: updErr } = await supabase
      .from("market_predictions")
      .update(patch)
      .eq("id", row.id)
      .eq("owner_id", userId)
      .is("context_version", null);
    if (!updErr) updated += 1;
  }
  if (updated > 0) {
    await logEvent(
      supabase,
      userId,
      "info",
      `Typer: uzupełniono kontekst (reżim, kopie) ${updated} prognoz`,
      {} as Json,
    );
  }
  return updated;
}

/** Rozliczone, nie-kopie, z okna wniosków — wejście dla lessons.deriveLessons. */
export async function loadLessonInputs(
  supabase: Db,
  userId: string,
  /** Tylko prognozy z tym horyzontem; brak = wszystkie (historycznie były tylko 7-dniowe). */
  horizonDays?: number,
): Promise<LessonInput[]> {
  const since = new Date(Date.now() - LESSON_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = await fetchAllPages<{
    symbol: string;
    direction: string;
    regime: string | null;
    outcome: string | null;
    actual_change_pct: number | null;
    flat_band_pct: number | null;
    made_at: string;
  }>((from, to) => {
    let q = supabase
      .from("market_predictions")
      .select("symbol, direction, regime, outcome, actual_change_pct, flat_band_pct, made_at")
      .eq("owner_id", userId)
      .eq("stale", false)
      .not("outcome", "is", null)
      .gte("made_at", since);
    if (horizonDays !== undefined) q = q.eq("horizon_days", horizonDays);
    return q.order("made_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });
  return rows.flatMap((r) =>
    r.actual_change_pct === null || (r.outcome !== "hit" && r.outcome !== "miss")
      ? []
      : [
          {
            symbol: r.symbol,
            direction: r.direction as LessonInput["direction"],
            regime: r.regime,
            outcome: r.outcome,
            actualChangePct: Number(r.actual_change_pct),
            flatBandPct: r.flat_band_pct === null ? null : Number(r.flat_band_pct),
            madeAt: r.made_at,
          },
        ],
  );
}

/**
 * Ostatnie werdykty modelu z bazy (zapisane przez job) → wiersze typera.
 * Tylko z ostatnich 36 godzin: starszy werdykt opisuje inny rynek.
 */
async function attachStoredVerdicts(supabase: Db, userId: string, rows: OutlookRow[]) {
  if (rows.length === 0) return;
  const since = new Date(Date.now() - 36 * 3_600_000).toISOString();
  const { data } = await supabase
    .from("market_predictions")
    .select("symbol, source, horizon_days, direction, confidence, rationale_pl, made_at")
    .eq("owner_id", userId)
    .in("source", ["ai", "ai_learned"])
    .in(
      "symbol",
      rows.map((r) => r.symbol),
    )
    .gte("made_at", since)
    .order("made_at", { ascending: false })
    .limit(500);
  const latest = new Map<string, NonNullable<typeof data>[number]>();
  for (const r of data ?? []) {
    const key = `${r.symbol}|${r.source}|${r.horizon_days}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  const pick = (symbol: string, source: string): AiRow | null => {
    const main = latest.get(`${symbol}|${source}|${HORIZON_DAYS}`);
    if (!main) return null;
    const ctl = latest.get(`${symbol}|${source}|${CONTROL_HORIZON}`);
    return {
      direction: main.direction as SignalDirection,
      confidence: main.confidence,
      rationalePl: main.rationale_pl,
      control: ctl
        ? { direction: ctl.direction as SignalDirection, confidence: ctl.confidence }
        : null,
    };
  };
  for (const row of rows) {
    row.ai = pick(row.symbol, "ai");
    row.aiLearned = pick(row.symbol, "ai_learned");
    row.scored = row.ai !== null || row.scored;
  }
}
