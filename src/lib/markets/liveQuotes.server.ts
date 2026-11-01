// MARKET GRID NA ŻYWO — bieżące ceny z ciągu dnia (przebieg co 15 min).
//
// Krypto: jedno zapytanie do CoinGecko /simple/price dla wszystkich monet
// (darmowy limit to liczba zapytań, nie monet), Yahoo jako zapas dla
// brakujących. Reszta: Yahoo chart (meta.regularMarketPrice i jego czas).
// Waluty: Yahoo „USDPLN=X”. Każda cena niesie CZAS notowania — silnik
// realizuje prognozę tylko po cenie zaobserwowanej po jej postawieniu.

import type { MarketAsset } from "./assets";
import { parseCoinGeckoSimple, parseYahooLive } from "./parse";
import type { LivePrice } from "./live";

const TIMEOUT_MS = 12_000;
const UA = "JARVIS-MarketGrid/1.0 (personal dashboard; +https://github.com/)";

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

/** Ticker Yahoo instrumentu do cen na żywo; null = brak źródła. */
export function yahooLiveTicker(asset: MarketAsset): string | null {
  if (asset.source.kind === "fx") return `${asset.source.base}${asset.source.quote}=X`;
  return asset.source.yahoo ?? null;
}

async function yahooLive(ticker: string): Promise<LivePrice | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker,
  )}?range=1d&interval=5m`;
  const q = parseYahooLive(await getJson(url));
  return q ? { ...q, source: "yahoo" } : null;
}

export async function fetchLivePrices(
  assets: MarketAsset[],
): Promise<{ prices: Map<string, LivePrice>; errors: string[] }> {
  const prices = new Map<string, LivePrice>();
  const errors: string[] = [];

  const crypto = assets.filter((a) => a.source.kind === "coingecko");
  if (crypto.length > 0) {
    const ids = crypto.map((a) => (a.source.kind === "coingecko" ? a.source.id : ""));
    try {
      const got = parseCoinGeckoSimple(
        await getJson(
          `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
            ids.join(","),
          )}&vs_currencies=usd&include_last_updated_at=true`,
        ),
      );
      crypto.forEach((a, i) => {
        const q = got.get(ids[i]);
        if (q) prices.set(a.symbol, { ...q, source: "coingecko" });
      });
    } catch (err) {
      errors.push(`coingecko: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const rest = assets.filter((a) => !prices.has(a.symbol));
  for (let i = 0; i < rest.length; i += 4) {
    await Promise.all(
      rest.slice(i, i + 4).map(async (a) => {
        const ticker = yahooLiveTicker(a);
        if (!ticker) return;
        try {
          const q = await yahooLive(ticker);
          if (q) prices.set(a.symbol, q);
        } catch (err) {
          errors.push(`${a.symbol}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
  }
  return { prices, errors };
}
