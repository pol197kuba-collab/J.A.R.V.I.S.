// MARKET GRID — pobieranie notowań. Plik serwerowy (.server.ts), bo żadne z
// tych API nie wystawia CORS-owego Access-Control-Allow-Origin, a część
// blokuje ruch z przeglądarki wprost. Ten sam wzorzec co
// src/lib/fuel/fuel.functions.ts wobec API Orlenu.
//
// ŁAŃCUCH DOSTAWCÓW. Dla akcji, indeksów i surowców nie ma jednego darmowego
// źródła, na którym da się polegać: Stooq odpowiada stroną anty-bot, gdy
// uzna klienta za automat (zaobserwowane z serwerowni), a Yahoo potrafi
// oddać HTTP 429 dla całego zakresu IP centrum danych. Każde z osobna jest
// zawodne, oba naraz rzadko — więc próbujemy po kolei i ZAWSZE raportujemy,
// które źródło faktycznie odpowiedziało (pole `source` w wyniku trafia do
// panelu diagnostycznego, tak jak `writeMode` w module paliw).
import type { MarketAsset } from "./assets";
import {
  parseCoinGeckoChart,
  parseFrankfurterSeries,
  parseStooqCsv,
  parseYahooChart,
} from "./parse";
import { normalizeSeries, type PricePoint } from "./series";

const TIMEOUT_MS = 15_000;

// Część darmowych źródeł odrzuca żądania bez wiarygodnego User-Agenta,
// traktując je jak scraping. To nie jest obchodzenie zabezpieczenia — to
// publiczne endpointy przeznaczone do odczytu, a nagłówek mówi prawdę o tym,
// czym jest klient.
const UA = "JARVIS-MarketGrid/1.0 (personal dashboard; +https://github.com/)";

export type QuoteSource = "stooq" | "yahoo" | "coingecko" | "frankfurter";

export type FetchedSeries = {
  points: PricePoint[];
  source: QuoteSource;
};

/** Wynik pobrania dla jednego instrumentu — udany albo z powodem porażki. */
export type FetchOutcome =
  | { symbol: string; ok: true; points: PricePoint[]; source: QuoteSource }
  | { symbol: string; ok: false; error: string };

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "text/csv,text/plain", "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

// ----------------------------------------------------------- dostawcy ----

async function fetchCoinGecko(id: string, days: number): Promise<PricePoint[]> {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
    id,
  )}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  return parseCoinGeckoChart(await getJson(url));
}

async function fetchStooq(ticker: string): Promise<PricePoint[]> {
  // Stooq oddaje pełną dostępną historię dzienną; przycinamy ją dopiero po
  // stronie wywołującego, bo jeden request i tak kosztuje tyle samo.
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker)}&i=d`;
  return parseStooqCsv(await getText(url));
}

async function fetchYahoo(ticker: string, days: number): Promise<PricePoint[]> {
  const range = days > 180 ? "2y" : days > 60 ? "1y" : "3mo";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker,
  )}?range=${range}&interval=1d`;
  return parseYahooChart(await getJson(url));
}

async function fetchFx(base: string, quote: string, days: number): Promise<PricePoint[]> {
  const url = `https://api.frankfurter.dev/v1/${isoDaysAgo(days)}..?base=${encodeURIComponent(
    base,
  )}&symbols=${encodeURIComponent(quote)}`;
  return parseFrankfurterSeries(await getJson(url), quote);
}

// ------------------------------------------------------------- łańcuch ----

/**
 * Pobiera serię dla jednego instrumentu, przechodząc przez kolejnych
 * dostawców aż któryś zwróci niepustą serię.
 *
 * Pusta odpowiedź jest traktowana jak porażka, nie jak „brak notowań": to
 * właśnie tak wygląda strona anty-bot Stooqa po sparsowaniu, a zapisanie jej
 * do cache'u jako „instrument bez danych" zamaskowałoby problem na długo.
 */
export async function fetchAssetSeries(asset: MarketAsset, days = 120): Promise<FetchedSeries> {
  const attempts: Array<{ source: QuoteSource; run: () => Promise<PricePoint[]> }> = [];

  if (asset.source.kind === "coingecko") {
    const { id } = asset.source;
    attempts.push({ source: "coingecko", run: () => fetchCoinGecko(id, days) });
  } else if (asset.source.kind === "fx") {
    const { base, quote } = asset.source;
    attempts.push({ source: "frankfurter", run: () => fetchFx(base, quote, days) });
  } else {
    const { ticker, yahoo } = asset.source;
    attempts.push({ source: "stooq", run: () => fetchStooq(ticker) });
    if (yahoo) attempts.push({ source: "yahoo", run: () => fetchYahoo(yahoo, days) });
  }

  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const points = normalizeSeries(await attempt.run());
      if (points.length > 0) {
        return { points: points.slice(-days), source: attempt.source };
      }
      failures.push(`${attempt.source}: pusta odpowiedź`);
    } catch (err) {
      failures.push(`${attempt.source}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(failures.join(" | ") || "brak skonfigurowanego dostawcy");
}

/**
 * Pobiera wiele instrumentów równolegle, ale w małych paczkach — CoinGecko
 * i Frankfurter mają darmowe limity liczone na minutę, a dwadzieścia
 * jednoczesnych żądań to najprostszy sposób, żeby w nie wejść.
 */
export async function fetchManyAssetSeries(
  assets: MarketAsset[],
  days = 120,
  batchSize = 4,
): Promise<FetchOutcome[]> {
  const out: FetchOutcome[] = [];
  for (let i = 0; i < assets.length; i += batchSize) {
    const batch = assets.slice(i, i + batchSize);
    const settled = await Promise.all(
      batch.map(async (asset): Promise<FetchOutcome> => {
        try {
          const { points, source } = await fetchAssetSeries(asset, days);
          return { symbol: asset.symbol, ok: true, points, source };
        } catch (err) {
          return {
            symbol: asset.symbol,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    out.push(...settled);
  }
  return out;
}
