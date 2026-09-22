// Warstwa I/O modułu paliwowego: pobranie danych ze źródeł i zapis do cache.
//
// Klient Supabase jest PARAMETREM, nie importem — ten sam kod obsługuje
// server function (supabaseAdmin z Nitro) i nocny job GitHub Actions
// (własny klient zbudowany z sekretów repo). Dzięki temu harmonogram
// i lazy refresh nie mogą się rozjechać logiką zapisu.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  ORLEN_PRODUCTS,
  ORLEN_HISTORY_START,
  buildOrlenUrl,
  fillGaps,
  parseOrlenResponse,
  todayIso,
  type OrlenProduct,
  type OrlenPricePoint,
} from "./orlen";
import {
  BRENT_SYMBOL,
  USDPLN_SYMBOL,
  YAHOO_BRENT_TICKER,
  buildNbpUsdUrl,
  buildYahooChartUrl,
  parseNbpRates,
  parseYahooChart,
  type SeriesPoint,
} from "./market";
import { FEEDS, dedupeNews, parseRss, type NewsItem } from "./news";
import { fetchAllPages } from "@/lib/db/paginate";
import { classifyNewsImpact } from "./news.server";

export type Db = SupabaseClient<Database>;

const FETCH_TIMEOUT_MS = 30_000;
const UPSERT_CHUNK = 1000;
const USER_AGENT = "JARVIS-FuelGrid/1.0";

/**
 * PONAWIANIE PRÓBY PRZY BŁĘDZIE PRZEJŚCIOWYM.
 *
 * Nocny job padał praktycznie co noc, choć nic nie było zepsute: z pięciu
 * paliw trzy zaciągały się poprawnie, a jedno–dwa wracały z „fetch failed" —
 * generycznym błędem sieciowym Node'a, nie odpowiedzią Orlenu. Za każdym
 * razem inne paliwo. Cały przebieg kończył się kodem 1, mimo że rynek, newsy
 * i alerty przechodziły. Jedno mrugnięcie sieci kosztowało całą noc danych.
 *
 * Ponawiamy WYŁĄCZNIE to, co ma szansę zadziałać za chwilę: błędy sieci,
 * przekroczony czas i odpowiedzi 5xx/429. Kod 4xx to odpowiedź serwera
 * mówiąca „tego zasobu nie ma" albo „nie wolno ci" — ponawianie jej niczego
 * nie zmieni, a tylko opóźni moment, w którym zobaczymy prawdziwy problem.
 */
const FETCH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Czy ten błąd ma sens ponawiać? */
export function isRetriableFetchError(err: unknown): boolean {
  if (err instanceof HttpStatusError) return err.status >= 500 || err.status === 429;
  // Wszystko, co nie jest odpowiedzią HTTP, jest awarią transportu: zerwane
  // połączenie, DNS, timeout. To właśnie te przypadki wywracały job.
  return true;
}

/** Błąd niosący kod odpowiedzi — żeby dało się odróżnić 503 od 404. */
class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`${url} → HTTP ${status}`);
    this.name = "HttpStatusError";
  }
}

async function fetchWithRetry(url: string, accept: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: accept, "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new HttpStatusError(response.status, url);
      return response;
    } catch (err) {
      lastError = err;
      if (attempt === FETCH_ATTEMPTS || !isRetriableFetchError(err)) break;
      // Narastająco: 400 ms, potem 800 ms. Przy błędzie sieciowym kolejna
      // próba od razu trafiłaby najczęściej w ten sam stan.
      await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }
  throw lastError;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetchWithRetry(url, "application/json");
  return response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetchWithRetry(url, "application/rss+xml, application/xml, text/xml");
  return response.text();
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- ceny ----

export async function fetchProductPrices(
  product: OrlenProduct,
  from: string,
  to: string,
): Promise<{ points: OrlenPricePoint[]; rejected: number }> {
  const payload = await fetchJson(buildOrlenUrl(product.id, from, to));
  const { prices, rejected } = parseOrlenResponse(payload, product);
  return { points: prices, rejected: rejected.length };
}

export type PriceIngestSummary = {
  product: string;
  fetched: number;
  written: number;
  rejected: number;
  error?: string;
};

/** Najświeższa data w cache dla danego produktu (null, gdy pusto). */
export async function latestPriceDate(db: Db, productId: number): Promise<string | null> {
  const { data } = await db
    .from("orlen_fuel_prices")
    .select("price_date")
    .eq("product_id", productId)
    .order("price_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.price_date ?? null;
}

/**
 * Dociąga cennik i zapisuje do cache.
 *
 * Tryb inkrementalny startuje 7 dni przed ostatnią zapisaną datą, a nie od
 * niej — Orlen bywa, że koryguje wstecz opublikowaną cenę, a upsert po
 * (product_id, price_date) i tak nadpisze tylko to, co się zmieniło.
 *
 * Luki (weekendy, święta) domykamy `fillGaps` DOPIERO przy zapisie do
 * dzisiaj, żeby wykres i średnie miały ciągłą serię dzienną; te wiersze są
 * oznaczone `is_gap_fill`.
 */
export async function ingestPrices(
  db: Db,
  opts: { full?: boolean; now?: Date } = {},
): Promise<PriceIngestSummary[]> {
  const to = todayIso(opts.now);
  const summaries: PriceIngestSummary[] = [];

  for (const product of ORLEN_PRODUCTS) {
    try {
      const last = opts.full ? null : await latestPriceDate(db, product.id);
      const from = opts.full || !last ? ORLEN_HISTORY_START : addDaysIso(last, -7);

      const { points, rejected } = await fetchProductPrices(product, from, to);
      if (points.length === 0) {
        summaries.push({ product: product.code, fetched: 0, written: 0, rejected });
        continue;
      }

      const rows = fillGaps(points, to).map((p) => ({
        product_id: p.productId,
        product_code: p.productCode,
        price_date: p.date,
        price_per_m3: p.price,
        is_gap_fill: p.isGapFill,
        source: p.isGapFill ? "Auto-uzupełnione" : "Orlen API",
      }));

      let written = 0;
      for (const batch of chunk(rows, UPSERT_CHUNK)) {
        const { error } = await db
          .from("orlen_fuel_prices")
          .upsert(batch, { onConflict: "product_id,price_date" });
        if (error) throw new Error(error.message);
        written += batch.length;
      }

      summaries.push({ product: product.code, fetched: points.length, written, rejected });
    } catch (err) {
      summaries.push({
        product: product.code,
        fetched: 0,
        written: 0,
        rejected: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summaries;
}

// -------------------------------------------------------------- rynek ----

export type MarketIngestSummary = { brent: number; usdPln: number; error?: string };

export async function ingestMarket(
  db: Db,
  opts: { days?: number } = {},
): Promise<MarketIngestSummary> {
  const days = opts.days ?? 365;
  try {
    const range = days > 300 ? "2y" : days > 90 ? "1y" : "6mo";
    const [brentPayload, nbpPayload] = await Promise.all([
      fetchJson(buildYahooChartUrl(YAHOO_BRENT_TICKER, range)),
      fetchJson(buildNbpUsdUrl(Math.min(255, days))),
    ]);

    const brent = parseYahooChart(brentPayload);
    const usdPln = parseNbpRates(nbpPayload);

    const rows = [
      ...brent.map((p) => ({ symbol: BRENT_SYMBOL, series_date: p.date, value: p.value })),
      ...usdPln.map((p) => ({ symbol: USDPLN_SYMBOL, series_date: p.date, value: p.value })),
    ];

    for (const batch of chunk(rows, UPSERT_CHUNK)) {
      const { error } = await db
        .from("orlen_market_series")
        .upsert(batch, { onConflict: "symbol,series_date" });
      if (error) throw new Error(error.message);
    }

    return { brent: brent.length, usdPln: usdPln.length };
  } catch (err) {
    return { brent: 0, usdPln: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function readMarketSeries(
  db: Db,
  fromDate: string,
): Promise<{ brent: SeriesPoint[]; usdPln: SeriesPoint[] }> {
  // Dwa symbole na dzień, więc dwa lata notowań to ~1460 wierszy — ponad
  // limit strony w Supabase. `symbol` jako drugi klucz sortowania, bo datę
  // dzielą obie serie (patrz komentarz w paginate.ts).
  const data = await fetchAllPages((from, to) =>
    db
      .from("orlen_market_series")
      .select("symbol, series_date, value")
      .gte("series_date", fromDate)
      .order("series_date", { ascending: true })
      .order("symbol", { ascending: true })
      .range(from, to),
  );

  const brent: SeriesPoint[] = [];
  const usdPln: SeriesPoint[] = [];
  for (const row of data) {
    const point = { date: row.series_date, value: Number(row.value) };
    if (row.symbol === BRENT_SYMBOL) brent.push(point);
    else if (row.symbol === USDPLN_SYMBOL) usdPln.push(point);
  }
  return { brent, usdPln };
}

// -------------------------------------------------------------- newsy ----

export type NewsIngestSummary = {
  fetched: number;
  fresh: number;
  classifiedBy: string;
  error?: string;
};

/** Ile newsów oceniamy jednym wywołaniem modelu — reszta czeka na kolejny przebieg. */
const NEWS_CLASSIFY_LIMIT = 30;

export async function ingestNews(db: Db, geminiKey: string | null): Promise<NewsIngestSummary> {
  try {
    const settled = await Promise.allSettled(
      FEEDS.map(async (feed) => parseRss(await fetchText(feed.url), feed)),
    );
    const all: NewsItem[] = [];
    for (const result of settled) if (result.status === "fulfilled") all.push(...result.value);

    // Kanał, który padł, nie może wywrócić całego odświeżenia — ale gdy
    // padły wszystkie, to nie jest „zero newsów", tylko awaria.
    if (all.length === 0) throw new Error("all feeds failed or returned no items");

    const deduped = dedupeNews(all).slice(0, 120);

    const { data: known } = await db
      .from("fuel_news_items")
      .select("guid")
      .in(
        "guid",
        deduped.map((i) => i.guid),
      );
    const knownGuids = new Set((known ?? []).map((r) => r.guid));

    const fresh = deduped.filter((i) => !knownGuids.has(i.guid)).slice(0, NEWS_CLASSIFY_LIMIT);
    if (fresh.length === 0) {
      return {
        fetched: deduped.length,
        fresh: 0,
        classifiedBy: geminiKey ? "gemini" : "heuristic",
      };
    }

    const verdicts = await classifyNewsImpact(fresh, geminiKey);
    const rows = fresh.map((item, i) => ({
      guid: item.guid,
      title: item.title,
      link: item.link,
      source: item.source,
      published_at: item.publishedAt,
      feed_tag: item.feedTag,
      impact: verdicts[i].impact,
      impact_score: verdicts[i].score,
      summary_pl: verdicts[i].summaryPl,
      classified_by: verdicts[i].classifiedBy,
    }));

    const { error } = await db.from("fuel_news_items").upsert(rows, { onConflict: "guid" });
    if (error) throw new Error(error.message);

    return {
      fetched: deduped.length,
      fresh: rows.length,
      classifiedBy: verdicts[0]?.classifiedBy ?? "heuristic",
    };
  } catch (err) {
    return {
      fetched: 0,
      fresh: 0,
      classifiedBy: "none",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
