// MARKET GRID — server functions modułu /rynki.
//
// Plik jest CIENKI z rozmysłem: cała praca (zaciąg notowań, newsy, typer,
// rozliczanie prognoz) siedzi w ./ingest.server.ts, bo dokładnie to samo
// musi dać się wykonać z nocnego joba (scripts/markets-daily.ts), kiedy nikt
// nie otworzy strony. Tutaj zostaje to, co specyficzne dla żądania HTTP:
// uwierzytelnienie, walidacja wejścia, progi świeżości i kształt odpowiedzi.
//
// Ten sam podział co w module paliwowym (fuel.functions.ts + ingest.server.ts).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assetBySymbol, MARKET_ASSETS, type MarketAsset } from "./assets";
import {
  computeSeriesStats,
  normalizeSeries,
  sessionsPerWeekFor,
  type PricePoint,
  type SeriesStats,
} from "./series";
import {
  aggregateSentiment,
  type MarketImpact,
  type MarketNewsItem,
  type SymbolSentiment,
} from "./news";
import type { SignalDirection } from "./signals";
import {
  buildScoreboard,
  type PredictionDirection,
  type PredictionSource,
  type Scoreboard,
} from "./scoreboard";
// Tylko typ — import jest wymazywany, więc ten plik nie wciąga
// ingest.server.ts (ani kluczy API) do bundla klienta.
import type { Db, ModelKeys, OutlookRow } from "./ingest.server";

export type { OutlookRow };

// Progi świeżości pilnują, żeby wejście na stronę nie oznaczało zaciągu.
// Sam zaciąg zna swoje progi per instrument (ingest.server.ts) — te tutaj
// dotyczą tego, jak często WOLNO go w ogóle zawołać z przeglądarki.
const MIN_NEWS_REFRESH_MS = 15 * 60_000;
const MIN_OUTLOOK_REFRESH_MS = 60 * 60_000;

let refreshInFlight: Promise<void> | null = null;
let lastNewsIngestAt = 0;
let newsInFlight: Promise<void> | null = null;
let lastOutlookAt = 0;
let outlookCache: MarketOutlook | null = null;

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

/** Klucze modeli tego użytkownika — BYOK, nigdy nie opuszczają serwera. */
async function loadModelKeys(supabase: Db, userId: string): Promise<ModelKeys> {
  const { data } = await supabase
    .from("user_secrets")
    .select("gemini_api_key, anthropic_api_key")
    .eq("owner_id", userId)
    .maybeSingle();
  return {
    anthropicApiKey: data?.anthropic_api_key?.trim() || null,
    geminiApiKey: data?.gemini_api_key?.trim() || null,
  };
}

// --------------------------------------------------------- watchlista ----

export const getWatchlist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadWatchlist } = await import("./ingest.server");
    return { symbols: await loadWatchlist(context.supabase, context.userId) };
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

    const { error } = await supabase
      .from("market_watchlist")
      .upsert(
        { owner_id: userId, symbol: asset.symbol, position: (tail?.position ?? -1) + 1 },
        { onConflict: "owner_id,symbol" },
      );
    if (error) throw new Error(error.message);
    return { ok: true as const, symbol: asset.symbol };
  });

export const removeFromWatchlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SymbolInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("market_watchlist")
      .delete()
      .eq("owner_id", context.userId)
      .eq("symbol", data.symbol.trim().toUpperCase());
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---------------------------------------------------------- notowania ----

const GridInput = z
  .object({
    days: z.number().int().min(7).max(1000).optional().default(120),
    /** Wymusza zaciąg z API, pomijając próg świeżości (przycisk „odśwież"). */
    force: z.boolean().optional().default(false),
  })
  .optional();

export const getMarketGrid = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GridInput.parse(input))
  .handler(async ({ data, context }): Promise<MarketGrid> => {
    const days = data?.days ?? 120;
    const force = data?.force ?? false;
    const { supabase, userId } = context;

    const { ingestQuotes, loadWatchlist } = await import("./ingest.server");
    const symbols = await loadWatchlist(supabase, userId);
    const assets = symbols.map(assetBySymbol).filter((a): a is MarketAsset => Boolean(a));

    // Jedno odświeżenie naraz na proces — równolegli czytelnicy czekają na
    // ten sam zaciąg zamiast mnożyć żądania do darmowych API.
    let errors = new Map<string, string>();
    let didFetch = false;
    if (refreshInFlight) {
      await refreshInFlight.catch(() => undefined);
    } else {
      const run = ingestQuotes(supabase, userId, assets, days, force).then((r) => {
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

    return { series, missing, refreshedAt: new Date().toISOString(), didFetch };
  });

// -------------------------------------------------------------- newsy ----

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

export const getMarketNews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => NewsInput.parse(input))
  .handler(async ({ data, context }): Promise<MarketNews> => {
    const limit = data?.limit ?? 60;
    const { supabase, userId } = context;

    const { ingestNews, loadWatchlist } = await import("./ingest.server");
    const symbols = await loadWatchlist(supabase, userId);
    const assets = symbols.map(assetBySymbol).filter((a): a is MarketAsset => Boolean(a));

    // Jeden zaciąg naraz na proces i nie częściej niż co próg — kanały RSS
    // żyją szybciej niż notowania, ale ocena każdej paczki kosztuje
    // wywołanie modelu.
    if (Date.now() - lastNewsIngestAt > MIN_NEWS_REFRESH_MS) {
      const keys = await loadModelKeys(supabase, userId);
      newsInFlight ??= ingestNews(supabase, userId, assets, keys)
        .then(() => {
          lastNewsIngestAt = Date.now();
        })
        .finally(() => {
          newsInFlight = null;
        });
      await newsInFlight.catch(() => undefined);
    }

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
    const page = items.slice(0, limit);

    return {
      items: page,
      // Zawsze z pełnego strumienia — patrz komentarz przy scanLimit.
      sentiment: aggregateSentiment(all),
      aiCount: page.filter((i) => i.classifiedBy === "ai").length,
      refreshedAt: new Date().toISOString(),
    };
  });

// -------------------------------------------------------------- typer ----

export type MarketOutlook = {
  rows: OutlookRow[];
  horizonDays: number;
  /** Model, który wydał werdykty; null = same sygnały. */
  model: string | null;
  generatedAt: string;
};

const OutlookInput = z.object({ force: z.boolean().optional().default(false) }).optional();

export const getMarketOutlook = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => OutlookInput.parse(input))
  .handler(async ({ data, context }): Promise<MarketOutlook> => {
    const { supabase, userId } = context;
    const force = data?.force ?? false;

    // Przeliczenie kosztuje wywołanie modelu, a horyzont prognozy to
    // tydzień — częstsze liczenie nic nie wnosi poza rachunkiem.
    if (!force && outlookCache && Date.now() - lastOutlookAt < MIN_OUTLOOK_REFRESH_MS) {
      return outlookCache;
    }

    const { buildOutlook, HORIZON_DAYS } = await import("./ingest.server");
    const keys = await loadModelKeys(supabase, userId);
    const { rows, model } = await buildOutlook(supabase, userId, keys);

    const result: MarketOutlook = {
      rows,
      horizonDays: HORIZON_DAYS,
      model,
      generatedAt: new Date().toISOString(),
    };
    outlookCache = result;
    lastOutlookAt = Date.now();
    return result;
  });

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

    // Rozliczanie przy okazji odczytu tablicy wyników: prognoza sprzed
    // tygodnia ma się rozliczyć sama, gdy ktokolwiek wejdzie na stronę.
    // Nocny job robi to samo, gdy nie wejdzie nikt.
    const { resolveDuePredictions } = await import("./ingest.server");
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

export type { SignalDirection };
