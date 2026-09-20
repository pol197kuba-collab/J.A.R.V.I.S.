// MARKET GRID — czysta analityka serii notowań. Bez I/O i bez zależności od
// Supabase, żeby dało się ją w całości przetestować jednostkowo (tak jak
// src/lib/fuel/analytics.ts, który obsługuje ten sam problem dla paliw).
//
// Wszystko tutaj operuje na dziennych punktach zamknięcia. Świadomie NIE
// wypełniamy luk weekendowych syntetycznymi punktami: dla akcji i indeksów
// „brak notowania" to prawdziwa informacja, a doklejanie piątkowej ceny do
// soboty zafałszowałoby liczbę dni w zmianach procentowych. Wykres łączy
// punkty linią, więc wizualnie luka i tak nie razi.

export type PricePoint = {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  close: number;
};

export type SeriesStats = {
  last: number | null;
  lastDate: string | null;
  previous: number | null;
  /** Zmiany procentowe względem ostatniego punktu; null gdy brak danych. */
  change1d: number | null;
  change7d: number | null;
  change30d: number | null;
  min: number | null;
  max: number | null;
  /** Roczna zmienność w %, z dziennych stóp zwrotu (√252). */
  volatility: number | null;
  /** Gdzie w zakresie [min, max] z ostatnich 30 punktów leży cena, 0-100. */
  rangePosition: number | null;
  points: number;
};

/**
 * Porządkuje serię: rosnąco po dacie, bez duplikatów dnia (wygrywa punkt
 * wczytany później — świeższy odczyt z API koryguje wcześniejszy cache),
 * bez punktów o niepoprawnej cenie.
 */
export function normalizeSeries(points: PricePoint[]): PricePoint[] {
  const byDate = new Map<string, number>();
  for (const p of points) {
    if (!p || typeof p.close !== "number" || !Number.isFinite(p.close) || p.close <= 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) continue;
    byDate.set(p.date, p.close);
  }
  return [...byDate.entries()]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const pct = (from: number, to: number): number | null =>
  from > 0 ? ((to - from) / from) * 100 : null;

/**
 * Zmiana procentowa względem punktu sprzed `sessions` notowań (nie dni
 * kalendarzowych — dla akcji tydzień to 5 sesji, nie 7). Wywołujący podaje
 * liczbę sesji, bo tylko on wie, czy seria jest ciągła (krypto, 7 dni w
 * tygodniu) czy giełdowa.
 */
export function changeOverSessions(points: PricePoint[], sessions: number): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const idx = points.length - 1 - sessions;
  const ref = points[idx < 0 ? 0 : idx];
  if (ref === last) return null;
  return pct(ref.close, last.close);
}

/** Roczna zmienność z dziennych stóp zwrotu — null przy mniej niż 5 punktach. */
export function annualizedVolatility(points: PricePoint[]): number | null {
  if (points.length < 5) return null;
  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].close;
    if (prev > 0) returns.push(points[i].close / prev - 1);
  }
  if (returns.length < 4) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function computeSeriesStats(rawPoints: PricePoint[], sessionsPerWeek = 5): SeriesStats {
  const points = normalizeSeries(rawPoints);
  const empty: SeriesStats = {
    last: null,
    lastDate: null,
    previous: null,
    change1d: null,
    change7d: null,
    change30d: null,
    min: null,
    max: null,
    volatility: null,
    rangePosition: null,
    points: 0,
  };
  if (points.length === 0) return empty;

  const last = points[points.length - 1];
  const previous = points.length > 1 ? points[points.length - 2] : null;

  // Okno „miesiąca" liczone w sesjach z tego samego powodu co tydzień:
  // krypto ma ~30 punktów na 30 dni, akcje ~22.
  const weekSessions = sessionsPerWeek;
  const monthSessions = sessionsPerWeek === 7 ? 30 : 22;

  const window30 = points.slice(-Math.max(monthSessions, 2));
  const closes30 = window30.map((p) => p.close);
  const min = Math.min(...closes30);
  const max = Math.max(...closes30);

  return {
    last: last.close,
    lastDate: last.date,
    previous: previous?.close ?? null,
    change1d: changeOverSessions(points, 1),
    change7d: changeOverSessions(points, weekSessions),
    change30d: changeOverSessions(points, monthSessions),
    min,
    max,
    volatility: annualizedVolatility(points.slice(-60)),
    rangePosition: max > min ? ((last.close - min) / (max - min)) * 100 : null,
    points: points.length,
  };
}

/** Ile sesji w tygodniu ma dana klasa aktywów — krypto i FX handlują inaczej. */
export const sessionsPerWeekFor = (assetClass: string): number => (assetClass === "crypto" ? 7 : 5);

/**
 * Seria przeskalowana do 100 w punkcie startowym — pozwala narysować na
 * jednym wykresie Bitcoina po 80 000 USD i WIG20 po 2 500 pkt bez logarytmów
 * i bez dwóch osi.
 */
export function rebaseToHundred(points: PricePoint[]): Array<{ date: string; value: number }> {
  const clean = normalizeSeries(points);
  const base = clean[0]?.close;
  if (!base || base <= 0) return [];
  return clean.map((p) => ({ date: p.date, value: (p.close / base) * 100 }));
}

/** Format ceny dopasowany do rzędu wielkości — 0.42 USD i 81 000 USD w jednej tabeli. */
export function formatPrice(value: number | null, currency: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const digits =
    Math.abs(value) >= 1000 ? 0 : Math.abs(value) >= 10 ? 2 : Math.abs(value) >= 1 ? 3 : 5;
  return `${value.toLocaleString("pl-PL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currency}`;
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}
