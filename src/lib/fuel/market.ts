// Kontekst rynkowy dla cen hurtowych: ropa Brent (USD/bbl) i kurs USD/PLN.
// Cena hurtowa Orlenu to w uproszczeniu notowanie produktu w USD przeliczone
// po kursie — bez tych dwóch serii wykres pokazuje CO się stało, ale nie
// DLACZEGO. Czysta warstwa (parsery + przeliczniki), bez I/O.

/** Baryłka ropy w metrach sześciennych (42 galony US = 158,987 l). */
export const BARREL_IN_M3 = 0.158987;

export const BRENT_SYMBOL = "BRENT_USD";
export const USDPLN_SYMBOL = "USDPLN";

/** Kontrakt futures na Brent w Yahoo Finance. */
export const YAHOO_BRENT_TICKER = "BZ=F";

export function buildYahooChartUrl(ticker: string, range = "1y", interval = "1d"): string {
  return (
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=${range}&interval=${interval}`
  );
}

export function buildNbpUsdUrl(lastN: number): string {
  // Tabela A = kurs średni. NBP ogranicza `last/N` do 255 notowań.
  const n = Math.max(1, Math.min(255, Math.trunc(lastN)));
  return `https://api.nbp.pl/api/exchangerates/rates/a/usd/last/${n}/?format=json`;
}

export type SeriesPoint = { date: string; value: number };

function isoFromEpochSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * Wyciąga dzienne zamknięcia z odpowiedzi Yahoo Finance. `close` bywa `null`
 * dla dni bez sesji — takie punkty są pomijane (nie zerowane, bo zero
 * wywróciłoby korelację i wykres).
 */
export function parseYahooChart(payload: unknown): SeriesPoint[] {
  const result = (payload as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | {
        timestamp?: unknown;
        indicators?: { quote?: Array<{ close?: unknown }> };
      }
    | undefined;

  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return [];

  const byDate = new Map<string, number>();
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i];
    const close = closes[i];
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    // Ostatni wpis dla danej daty wygrywa (Yahoo potrafi dorzucić świecę
    // śróddzienną dla dnia bieżącego).
    byDate.set(isoFromEpochSeconds(ts), Math.round(close * 10000) / 10000);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

/** Parsuje odpowiedź NBP (tabela A) na serię kursów średnich. */
export function parseNbpRates(payload: unknown): SeriesPoint[] {
  const rates = (payload as { rates?: unknown })?.rates;
  if (!Array.isArray(rates)) return [];

  const out: SeriesPoint[] = [];
  for (const item of rates) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as { effectiveDate?: unknown; mid?: unknown };
    if (typeof row.effectiveDate !== "string") continue;
    const mid = typeof row.mid === "number" ? row.mid : Number(row.mid);
    if (!Number.isFinite(mid) || mid <= 0) continue;
    out.push({ date: row.effectiveDate.slice(0, 10), value: Math.round(mid * 10000) / 10000 });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Ropa Brent przeliczona na tę samą jednostkę, w której Orlen podaje cennik
 * (PLN za m³). To nie jest cena paliwa — to koszt surowca, więc różnica
 * między tą linią a cennikiem to marża rafineryjno-hurtowa plus koszty.
 */
export function brentToPlnPerM3(usdPerBarrel: number, usdPln: number): number {
  return Math.round(((usdPerBarrel * usdPln) / BARREL_IN_M3) * 100) / 100;
}

/**
 * Łączy dwie serie po dacie, przenosząc ostatnią znaną wartość na dni bez
 * notowania (weekend na giełdzie ≠ weekend w NBP, więc bez tego przecięcie
 * obu serii gubiłoby większość punktów).
 */
export function joinSeries(
  brent: SeriesPoint[],
  usdPln: SeriesPoint[],
): Array<{ date: string; brentUsd: number; usdPln: number; brentPlnPerM3: number }> {
  if (brent.length === 0 || usdPln.length === 0) return [];
  const fxByDate = new Map(usdPln.map((p) => [p.date, p.value]));
  const fxDates = usdPln.map((p) => p.date);

  let lastFx: number | null = null;
  let fxCursor = 0;
  const out: Array<{ date: string; brentUsd: number; usdPln: number; brentPlnPerM3: number }> = [];

  for (const point of brent) {
    while (fxCursor < fxDates.length && fxDates[fxCursor] <= point.date) {
      lastFx = fxByDate.get(fxDates[fxCursor]) ?? lastFx;
      fxCursor += 1;
    }
    if (lastFx === null) continue;
    out.push({
      date: point.date,
      brentUsd: point.value,
      usdPln: lastFx,
      brentPlnPerM3: brentToPlnPerM3(point.value, lastFx),
    });
  }

  return out;
}
