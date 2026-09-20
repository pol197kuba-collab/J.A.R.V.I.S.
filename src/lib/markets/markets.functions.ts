// MARKET GRID — server functions modułu /rynki (Etap 1: dane, cache,
// watchlista).
//
// Pobieranie idzie przez serwer, bo żadne ze źródeł notowań nie wystawia
// nagłówka Access-Control-Allow-Origin — przeglądarka dostałaby ścianę CORS.
// Ten sam powód i ten sam wzorzec co src/lib/fuel/fuel.functions.ts.
//
// Cache w public.market_quotes jest współdzielony (dane publiczne), a
// watchlista prywatna. Odświeżanie jest leniwe: czytamy cache, a zaciąg z
// API odpalamy tylko wtedy, gdy dane są starsze niż próg — użytkownik
// dostaje wykres od razu, a nie po dwudziestu requestach HTTP.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  assetBySymbol,
  DEFAULT_WATCHLIST,
  isKnownSymbol,
  MARKET_ASSETS,
  type MarketAsset,
} from "./assets";
import {
  computeSeriesStats,
  normalizeSeries,
  sessionsPerWeekFor,
  type PricePoint,
  type SeriesStats,
} from "./series";
import type { QuoteSource } from "./quotes.server";
import {
  aggregateSentiment,
  type MarketImpact,
  type MarketNewsItem,
  type SymbolSentiment,
} from "./news";
import {
  combineOutlook,
  computeSignals,
  scoreSignals,
  type SignalDirection,
  type SignalDriver,
} from "./signals";
import {
  buildScoreboard,
  percentChange,
  resolveOutcome,
  type PredictionDirection,
  type PredictionSource,
  type Scoreboard,
} from "./scoreboard";

// Notowania dzienne zmieniają się raz na sesję, więc częstsze odpytywanie
// darmowych API nic nie wnosi poza zużyciem limitu. Krypto chodzi 24/7,
// stąd krótszy próg dla niego.
const MIN_REFRESH_MS = 30 * 60_000;
const MIN_REFRESH_CRYPTO_MS = 10 * 60_000;
// Kanały RSS aktualizują się częściej niż notowania dzienne, ale ocena
// każdej paczki kosztuje wywołanie modelu — stąd osobny, dłuższy próg.
const MIN_NEWS_REFRESH_MS = 15 * 60_000;

// Odświeżenie jest współdzielone między równoległych czytelników: pięciu
// jednoczesnych użytkowników (albo pięć zakładek) ma wywołać jeden zaciąg,
// nie pięć. Ten sam wzorzec co `inFlight` w module paliwowym.
const lastRefreshAt = new Map<string, number>();
let refreshInFlight: Promise<void> | null = null;
let lastNewsIngestAt = 0;
let newsInFlight: Promise<void> | null = null;

export type MarketSeries = {
  symbol: string;
  label: string;
  assetClass: MarketAsset["assetClass"];
  currency: string;
  colorToken: string;
  hint?: string;
  points: PricePoint[];
  stats: SeriesStats;
  /** Który dostawca oddał najświeższy punkt tej serii. */
  source: string | null;
};

export type MarketGrid = {
  series: MarketSeries[];
  /** Symbole, których nie udało się pobrać ANI z cache'u, ani z API. */
  missing: Array<{ symbol: string; label: string; reason: string }>;
  refreshedAt: string;
  /** true, gdy to wywołanie faktycznie odpytało zewnętrzne API. */
  didFetch: boolean;
};

/** Klient Supabase zalogowanego użytkownika, tak jak podaje go middleware. */
type Db = SupabaseClient<Database>;

async function logEvent(
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
  } catch {
    // Logowanie nie ma prawa wysypać żądania.
  }
}

const refreshThresholdFor = (asset: MarketAsset): number =>
  asset.assetClass === "crypto" ? MIN_REFRESH_CRYPTO_MS : MIN_REFRESH_MS;

// --------------------------------------------------------- watchlista ----

/**
 * Watchlista użytkownika. Pusta tabela oznacza nowe konto, nie „użytkownik
 * wszystko usunął" — pierwsze wejście dostaje więc domyślny przekrój
 * rynków, zapisany na stałe, żeby dało się go potem edytować jak własny.
 */
async function loadWatchlist(supabase: Db, userId: string): Promise<string[]> {
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

export const getWatchlist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const symbols = await loadWatchlist(context.supabase, context.userId);
    return { symbols };
  });

const SymbolInput = z.object({ symbol: z.string().min(1).max(32) });

export const addToWatchlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SymbolInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const asset = assetBySymbol(data.symbol);
    if (!asset) throw new Error(`Nieznany instrument: ${data.symbol}`);

    // Nowa pozycja ląduje na końcu listy — czytamy tylko maksimum, bez
    // przepisywania pozostałych wierszy.
    const { data: tail } = await supabase
      .from("market_watchlist")
      .select("position")
      .eq("owner_id", userId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabase.from("market_watchlist").upsert(
      {
        owner_id: userId,
        symbol: asset.symbol,
        position: (tail?.position ?? -1) + 1,
      },
      { onConflict: "owner_id,symbol" },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const, symbol: asset.symbol };
  });

export const removeFromWatchlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SymbolInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("market_watchlist")
      .delete()
      .eq("owner_id", userId)
      .eq("symbol", data.symbol.trim().toUpperCase());
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ------------------------------------------------------ notowania ----

const GridInput = z
  .object({
    days: z.number().int().min(7).max(1000).optional().default(120),
    /** Wymusza zaciąg z API, pomijając próg świeżości (przycisk „odśwież"). */
    force: z.boolean().optional().default(false),
  })
  .optional();

/**
 * Zapisuje pobrane serie do współdzielonego cache'u.
 *
 * Upsert po (symbol, quote_date): ostatni punkt dnia potrafi się jeszcze
 * zmienić (sesja w toku, korekta u dostawcy), więc ponowny zaciąg ma go
 * poprawić, a nie zduplikować.
 */
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
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
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
async function refreshStaleAssets(
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

export const getMarketGrid = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GridInput.parse(input))
  .handler(async ({ data, context }): Promise<MarketGrid> => {
    const days = data?.days ?? 120;
    const force = data?.force ?? false;
    const { supabase, userId } = context;

    const symbols = await loadWatchlist(supabase, userId);
    const assets = symbols.map(assetBySymbol).filter((a): a is MarketAsset => Boolean(a));

    // Jedno odświeżenie naraz na proces — równolegli czytelnicy czekają na
    // ten sam zaciąg zamiast mnożyć żądania do darmowych API.
    let errors = new Map<string, string>();
    let didFetch = false;
    if (refreshInFlight) {
      await refreshInFlight.catch(() => undefined);
    } else {
      const run = refreshStaleAssets(supabase, userId, assets, days, force).then((r) => {
        didFetch = r.didFetch;
        errors = r.errors;
      });
      refreshInFlight = run.then(
        () => undefined,
        () => undefined,
      );
      try {
        await run;
      } finally {
        refreshInFlight = null;
      }
    }

    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const { data: rows, error } = await supabase
      .from("market_quotes")
      .select("symbol, quote_date, close, source")
      .in("symbol", symbols)
      .gte("quote_date", since)
      .order("quote_date", { ascending: true });
    if (error) throw new Error(error.message);

    const bySymbol = new Map<string, Array<{ date: string; close: number; source: string }>>();
    for (const row of rows ?? []) {
      const bucket = bySymbol.get(row.symbol) ?? [];
      bucket.push({ date: row.quote_date, close: Number(row.close), source: row.source });
      bySymbol.set(row.symbol, bucket);
    }

    const series: MarketSeries[] = [];
    const missing: MarketGrid["missing"] = [];

    for (const asset of assets) {
      const bucket = bySymbol.get(asset.symbol) ?? [];
      const points = normalizeSeries(bucket);
      if (points.length === 0) {
        missing.push({
          symbol: asset.symbol,
          label: asset.label,
          reason: errors.get(asset.symbol) ?? "brak danych w cache i brak odpowiedzi z API",
        });
        continue;
      }
      series.push({
        symbol: asset.symbol,
        label: asset.label,
        assetClass: asset.assetClass,
        currency: asset.currency,
        colorToken: asset.colorToken,
        hint: asset.hint,
        points,
        stats: computeSeriesStats(points, sessionsPerWeekFor(asset.assetClass)),
        source: bucket[bucket.length - 1]?.source ?? null,
      });
    }

    return {
      series,
      missing,
      refreshedAt: new Date().toISOString(),
      didFetch,
    };
  });

// ------------------------------------------------------------- newsy ----

export type MarketNews = {
  items: MarketNewsItem[];
  /** Wypadkowy wydźwięk newsów per instrument — NIE jest to prognoza ceny. */
  sentiment: SymbolSentiment[];
  /** Ile pozycji oceniło AI (reszta: heurystyka słownikowa). */
  aiCount: number;
  refreshedAt: string;
};

const NewsInput = z
  .object({
    limit: z.number().int().min(5).max(200).optional().default(60),
    /** Zawęża do newsów dotyczących jednego instrumentu. */
    symbol: z.string().min(1).max(32).optional(),
  })
  .optional();

/**
 * Zaciąga kanały, ocenia wpływ i zapisuje do współdzielonego cache'u.
 * Nigdy nie rzuca w górę — padnięty kanał ma zostawić ślad w System Logs i
 * pozwolić pokazać to, co już jest w bazie.
 */
async function refreshNews(
  supabase: Db,
  userId: string,
  assets: MarketAsset[],
  force: boolean,
): Promise<void> {
  if (!force && Date.now() - lastNewsIngestAt < MIN_NEWS_REFRESH_MS) return;

  const { data: secret } = await supabase
    .from("user_secrets")
    .select("gemini_api_key, anthropic_api_key")
    .eq("owner_id", userId)
    .maybeSingle();

  const { ingestMarketNews } = await import("./news.server");
  const { items, errors } = await ingestMarketNews(assets, {
    anthropicApiKey: secret?.anthropic_api_key?.trim() || null,
    geminiApiKey: secret?.gemini_api_key?.trim() || null,
  });

  for (const err of errors) {
    await logEvent(supabase, userId, "warn", `Kanał newsów: ${err}`, {} as Json);
  }
  if (items.length === 0) return;

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
  const { error } = await supabase.from("market_news_items").upsert(rows, { onConflict: "guid" });
  if (error) {
    await logEvent(supabase, userId, "error", `Zapis newsów: ${error.message}`, {} as Json);
    return;
  }
  lastNewsIngestAt = Date.now();
}

export const getMarketNews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => NewsInput.parse(input))
  .handler(async ({ data, context }): Promise<MarketNews> => {
    const limit = data?.limit ?? 60;
    const { supabase, userId } = context;

    const symbols = await loadWatchlist(supabase, userId);
    const assets = symbols.map(assetBySymbol).filter((a): a is MarketAsset => Boolean(a));

    // Jeden zaciąg naraz na proces — równolegli czytelnicy czekają na ten
    // sam przebieg zamiast mnożyć wywołania modelu.
    newsInFlight ??= refreshNews(supabase, userId, assets, false).finally(() => {
      newsInFlight = null;
    });
    await newsInFlight.catch(() => undefined);

    // Czytamy szerzej niż `limit`, bo wydźwięk MUSI być liczony z całego
    // strumienia, a nie z tego, co zostało po filtrze — inaczej kliknięcie
    // „pokaż newsy dla BTC" przeliczałoby wydźwięk wszystkich instrumentów
    // na podstawie samych newsów o BTC.
    const scanLimit = Math.min(limit * 3, 200);
    const { data: rows, error } = await supabase
      .from("market_news_items")
      .select(
        "id, guid, title, link, source, published_at, feed_tag, symbols, impact, impact_score, summary_pl, classified_by",
      )
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(scanLimit);
    if (error) throw new Error(error.message);

    const all: MarketNewsItem[] = (rows ?? []).map((r) => ({
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

    const wanted = data?.symbol?.trim().toUpperCase();
    const items = wanted ? all.filter((i) => i.symbols.includes(wanted)) : all;

    return {
      items: items.slice(0, limit),
      // Zawsze z pełnego strumienia — patrz komentarz przy scanLimit.
      sentiment: aggregateSentiment(all),
      aiCount: items.slice(0, limit).filter((i) => i.classifiedBy === "ai").length,
      refreshedAt: new Date().toISOString(),
    };
  });

// ------------------------------------------------- typer (etap 3) ----

/** Ile dni do przodu dotyczy prognoza. Krótki horyzont da się rozliczyć. */
const HORIZON_DAYS = 7;

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
  /** Werdykt modelu — null, gdy nie ma klucza albo model zawiódł. */
  ai: { direction: SignalDirection; confidence: number; rationalePl: string | null } | null;
};

export type MarketOutlook = {
  rows: OutlookRow[];
  horizonDays: number;
  /** Model, który wydał werdykty; null = same sygnały. */
  model: string | null;
  generatedAt: string;
};

const OutlookInput = z.object({ force: z.boolean().optional().default(false) }).optional();

// Typer kosztuje wywołanie modelu, więc nie liczymy go przy każdym wejściu
// na stronę. Raz na godzinę wystarcza dla horyzontu tygodniowego.
const MIN_OUTLOOK_REFRESH_MS = 60 * 60_000;
let lastOutlookAt = 0;
let outlookCache: MarketOutlook | null = null;

export const getMarketOutlook = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => OutlookInput.parse(input))
  .handler(async ({ data, context }): Promise<MarketOutlook> => {
    const { supabase, userId } = context;
    const force = data?.force ?? false;

    if (!force && outlookCache && Date.now() - lastOutlookAt < MIN_OUTLOOK_REFRESH_MS) {
      return outlookCache;
    }

    const symbols = await loadWatchlist(supabase, userId);
    const assets = symbols.map(assetBySymbol).filter((a): a is MarketAsset => Boolean(a));

    // Notowania bierzemy z cache'u — typer nie odświeża danych sam, żeby
    // jedno kliknięcie nie odpalało dwudziestu żądań do darmowych API.
    // Świeżość zapewnia getMarketGrid, które i tak biegnie na tej stronie.
    const since = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
    const { data: quoteRows, error: quoteErr } = await supabase
      .from("market_quotes")
      .select("symbol, quote_date, close")
      .in("symbol", symbols)
      .gte("quote_date", since)
      .order("quote_date", { ascending: true });
    if (quoteErr) throw new Error(quoteErr.message);

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
    const { forecastWithModel } = await import("./forecast.server");

    const prepared = assets.flatMap((asset) => {
      const points = normalizeSeries(pointsBySymbol.get(asset.symbol) ?? []);
      if (points.length < 2) return [];
      const technical = scoreSignals(computeSignals(points));
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
        },
      ];
    });

    const { data: secret } = await supabase
      .from("user_secrets")
      .select("gemini_api_key, anthropic_api_key")
      .eq("owner_id", userId)
      .maybeSingle();

    const forecast = await forecastWithModel(prepared, {
      anthropicApiKey: secret?.anthropic_api_key?.trim() || null,
      geminiApiKey: secret?.gemini_api_key?.trim() || null,
    });

    const rows: OutlookRow[] = prepared.map((input, idx) => {
      const combined = combineOutlook(input.technical, input.sentimentScore, input.sentimentItems);
      const verdict = forecast.verdicts[idx];
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
        // Werdykt „ai" istnieje tylko wtedy, gdy model faktycznie
        // odpowiedział — inaczej podpisalibyśmy arytmetykę nazwą modelu.
        ai: forecast.model
          ? {
              direction: verdict.direction,
              confidence: verdict.confidence,
              rationalePl: verdict.rationalePl,
            }
          : null,
      };
    });

    await recordPredictions(supabase, userId, rows, forecast.model);

    const result: MarketOutlook = {
      // Najmocniejsze sygnały na górze, niezależnie od kierunku.
      rows: rows.sort((a, b) => Math.abs(b.score) - Math.abs(a.score)),
      horizonDays: HORIZON_DAYS,
      model: forecast.model,
      generatedAt: new Date().toISOString(),
    };
    outlookCache = result;
    lastOutlookAt = Date.now();
    return result;
  });

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
): Promise<void> {
  if (rows.length === 0) return;
  const dueAt = new Date(Date.now() + HORIZON_DAYS * 86_400_000).toISOString();

  const base = rows.map((row) => ({
    owner_id: userId,
    symbol: row.symbol,
    horizon_days: HORIZON_DAYS,
    due_at: dueAt,
    price_at_prediction: row.lastPrice,
    technical_score: row.technicalScore,
    sentiment_score: row.sentimentScore,
  }));

  const signalRows = base.map((b, i) => ({
    ...b,
    direction: rows[i].direction,
    confidence: rows[i].confidence,
    rationale_pl: rows[i].drivers[0]?.note ?? null,
    source: "signals" as const,
    model: null,
  }));

  // Prognoza modelu zapisywana OSOBNO, żeby panel skuteczności mógł
  // odpowiedzieć, czy model bije prostą arytmetykę.
  const aiRows = model
    ? base.flatMap((b, i) => {
        const ai = rows[i].ai;
        if (!ai) return [];
        return [
          {
            ...b,
            direction: ai.direction,
            confidence: ai.confidence,
            rationale_pl: ai.rationalePl,
            source: "ai" as const,
            model,
          },
        ];
      })
    : [];

  const { error } = await supabase.from("market_predictions").upsert([...signalRows, ...aiRows], {
    onConflict: "owner_id,symbol,source,horizon_days,made_on",
    ignoreDuplicates: true,
  });
  if (error) {
    await logEvent(supabase, userId, "warn", `Zapis prognoz: ${error.message}`, {} as Json);
  }
}

// --------------------------------------------- skuteczność (backtest) ----

export type PredictionScoreboard = Scoreboard & {
  /** Ile prognoz rozliczono podczas tego wywołania. */
  justResolved: number;
  recent: Array<{
    symbol: string;
    madeAt: string;
    direction: PredictionDirection;
    source: PredictionSource;
    confidence: number;
    actualChangePct: number | null;
    outcome: "hit" | "miss" | null;
    rationalePl: string | null;
  }>;
};

export const getPredictionScoreboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PredictionScoreboard> => {
    const { supabase, userId } = context;

    const justResolved = await resolveDuePredictions(supabase, userId);

    const { data: rows, error } = await supabase
      .from("market_predictions")
      .select(
        "symbol, made_at, direction, source, confidence, actual_change_pct, outcome, rationale_pl",
      )
      .eq("owner_id", userId)
      .order("made_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const scored = (rows ?? []).map((r) => ({
      source: (r.source === "ai" ? "ai" : "signals") as PredictionSource,
      direction: r.direction as PredictionDirection,
      symbol: r.symbol,
      outcome: (r.outcome as "hit" | "miss" | null) ?? null,
      actualChangePct: r.actual_change_pct === null ? null : Number(r.actual_change_pct),
    }));

    return {
      ...buildScoreboard(scored),
      justResolved,
      recent: (rows ?? []).slice(0, 25).map((r) => ({
        symbol: r.symbol,
        madeAt: r.made_at,
        direction: r.direction as PredictionDirection,
        source: (r.source === "ai" ? "ai" : "signals") as PredictionSource,
        confidence: r.confidence,
        actualChangePct: r.actual_change_pct === null ? null : Number(r.actual_change_pct),
        outcome: (r.outcome as "hit" | "miss" | null) ?? null,
        rationalePl: r.rationale_pl,
      })),
    };
  });

/**
 * Rozlicza prognozy, którym minął termin.
 *
 * Cena rozliczeniowa to pierwsze notowanie NIE WCZEŚNIEJSZE niż termin —
 * a nie po prostu „ostatnie, jakie mamy". Ta różnica jest istotna: gdyby
 * brać ostatnie notowanie, prognoza sprzed dwóch miesięcy rozliczyłaby się
 * wobec dzisiejszej ceny, czyli na zupełnie innym horyzoncie niż ten, który
 * zadeklarowała.
 */
async function resolveDuePredictions(supabase: Db, userId: string): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from("market_predictions")
    .select("id, symbol, direction, due_at, price_at_prediction")
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
        outcome: resolveOutcome(prediction.direction as PredictionDirection, change),
      })
      .eq("id", prediction.id)
      .eq("owner_id", userId);
    if (!updErr) resolved += 1;
  }
  return resolved;
}

/** Katalog instrumentów dla wyszukiwarki w UI — bez odpytywania sieci. */
export const getAssetCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    assets: MARKET_ASSETS.map((a) => ({
      symbol: a.symbol,
      label: a.label,
      assetClass: a.assetClass,
      currency: a.currency,
      hint: a.hint,
    })),
  }));
