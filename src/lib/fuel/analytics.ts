// Analityka serii cenowych: statystyki nagłówkowe, korelacja z ropą,
// prognoza i siatka do heatmapy. Wszystko czyste i deterministyczne —
// te funkcje są sercem modułu, więc mają własne testy, a nie „wygląda ok
// na wykresie".

export type PricePoint = { date: string; price: number; isGapFill?: boolean };

export type FuelStats = {
  latest: number | null;
  latestDate: string | null;
  changeDay: number | null;
  changeDayPct: number | null;
  changeWeek: number | null;
  changeWeekPct: number | null;
  changeMonth: number | null;
  changeMonthPct: number | null;
  /** Min/max z ostatnich 52 tygodni (albo z całej serii, jeśli krótsza). */
  low52w: number | null;
  high52w: number | null;
  /** 0-100: gdzie w paśmie 52-tygodniowym leży bieżąca cena. */
  position52w: number | null;
  /** Odchylenie standardowe zmian dziennych z ostatnich 30 dni, w PLN/m³. */
  volatility30d: number | null;
};

function pctChange(from: number, to: number): number {
  if (from === 0) return 0;
  return Math.round(((to - from) / from) * 10000) / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cena sprzed `daysBack` dni kalendarzowych — najbliższy punkt nie późniejszy. */
function priceDaysBack(points: PricePoint[], daysBack: number): number | null {
  if (points.length === 0) return null;
  const lastDate = new Date(`${points[points.length - 1].date}T00:00:00Z`);
  lastDate.setUTCDate(lastDate.getUTCDate() - daysBack);
  const target = lastDate.toISOString().slice(0, 10);

  let found: number | null = null;
  for (const p of points) {
    if (p.date <= target) found = p.price;
    else break;
  }
  return found;
}

export function computeStats(points: PricePoint[]): FuelStats {
  const empty: FuelStats = {
    latest: null,
    latestDate: null,
    changeDay: null,
    changeDayPct: null,
    changeWeek: null,
    changeWeekPct: null,
    changeMonth: null,
    changeMonthPct: null,
    low52w: null,
    high52w: null,
    position52w: null,
    volatility30d: null,
  };
  if (points.length === 0) return empty;

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];

  const dayAgo = priceDaysBack(sorted, 1);
  const weekAgo = priceDaysBack(sorted, 7);
  const monthAgo = priceDaysBack(sorted, 30);

  const window52 = sorted.slice(-366).map((p) => p.price);
  const low = Math.min(...window52);
  const high = Math.max(...window52);

  const recent = sorted.slice(-31);
  const deltas: number[] = [];
  for (let i = 1; i < recent.length; i += 1) deltas.push(recent[i].price - recent[i - 1].price);
  const mean = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  const variance = deltas.length
    ? deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length
    : 0;

  return {
    latest: last.price,
    latestDate: last.date,
    changeDay: dayAgo === null ? null : round2(last.price - dayAgo),
    changeDayPct: dayAgo === null ? null : pctChange(dayAgo, last.price),
    changeWeek: weekAgo === null ? null : round2(last.price - weekAgo),
    changeWeekPct: weekAgo === null ? null : pctChange(weekAgo, last.price),
    changeMonth: monthAgo === null ? null : round2(last.price - monthAgo),
    changeMonthPct: monthAgo === null ? null : pctChange(monthAgo, last.price),
    low52w: round2(low),
    high52w: round2(high),
    position52w: high === low ? 50 : Math.round(((last.price - low) / (high - low)) * 100),
    volatility30d: deltas.length ? round2(Math.sqrt(variance)) : null,
  };
}

/** Średnia krocząca; pierwsze `window-1` punktów dostaje `null`. */
export function movingAverage(values: number[], window: number): Array<number | null> {
  if (window <= 1) return values.slice();
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out.push(i >= window - 1 ? round2(sum / window) : null);
  }
  return out;
}

/** Współczynnik korelacji Pearsona. Zwraca 0 dla serii bez zmienności. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const xs = a.slice(0, n);
  const ys = b.slice(0, n);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const vx = xs[i] - mx;
    const vy = ys[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx === 0 || dy === 0) return 0;
  return Math.round((num / Math.sqrt(dx * dy)) * 1000) / 1000;
}

export type LagCorrelation = { lagDays: number; r: number };

/**
 * Szuka opóźnienia, z jakim cennik Orlenu odwzorowuje ruch ropy: przesuwa
 * serię `driver` (Brent w PLN) o 0..maxLag dni wstecz i wybiera przesunięcie
 * o najwyższym |r|. Wynik odpowiada na pytanie „ile dni temu zdarzyło się
 * to, co widać dziś w cenniku".
 */
export function bestLagCorrelation(
  target: number[],
  driver: number[],
  maxLag = 14,
): LagCorrelation {
  let best: LagCorrelation = { lagDays: 0, r: 0 };
  for (let lag = 0; lag <= maxLag; lag += 1) {
    const shiftedDriver = driver.slice(0, driver.length - lag);
    const alignedTarget = target.slice(lag);
    const n = Math.min(shiftedDriver.length, alignedTarget.length);
    if (n < 10) continue;
    const r = pearson(alignedTarget.slice(-n), shiftedDriver.slice(-n));
    if (Math.abs(r) > Math.abs(best.r)) best = { lagDays: lag, r };
  }
  return best;
}

/** Regresja liniowa metodą najmniejszych kwadratów po indeksie. */
export function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: meanY - slope * meanX };
}

export type ForecastPoint = { date: string; value: number; lower: number; upper: number };

export type Forecast = {
  points: ForecastPoint[];
  direction: "up" | "down" | "flat";
  /** 0-100 — jak mocno trend wybija się ponad szum ostatnich dni. */
  confidence: number;
  /** Dzienne nachylenie trendu w PLN/m³. */
  slopePerDay: number;
};

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Projekcja krótkoterminowa: regresja liniowa na ostatnich `lookback` dniach,
 * z wstęgą ±1σ reszt rosnącą wraz z horyzontem (√h — niepewność kumuluje się
 * jak w błądzeniu losowym). To model statystyczny na potrzeby wizualizacji
 * trendu, nie rekomendacja zakupowa — UI musi to mówić wprost.
 *
 * `direction` jest „flat", gdy nachylenie mieści się w szumie (|slope| < σ/2)
 * — bez tego filtra wskaźnik migałby przy każdym płaskim tygodniu.
 */
export function forecastNext(points: PricePoint[], horizonDays = 5, lookback = 30): Forecast {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const window = sorted.slice(-lookback);
  if (window.length < 5) {
    return { points: [], direction: "flat", confidence: 0, slopePerDay: 0 };
  }

  const values = window.map((p) => p.price);
  const { slope, intercept } = linearRegression(values);

  const residuals = values.map((v, i) => v - (intercept + slope * i));
  const sigma = Math.sqrt(residuals.reduce((a, b) => a + b * b, 0) / residuals.length);

  const lastDate = window[window.length - 1].date;
  const baseIndex = values.length - 1;

  const forecastPoints: ForecastPoint[] = [];
  for (let h = 1; h <= horizonDays; h += 1) {
    const value = intercept + slope * (baseIndex + h);
    const band = sigma * Math.sqrt(h);
    forecastPoints.push({
      date: addDaysIso(lastDate, h),
      value: round2(value),
      lower: round2(value - band),
      upper: round2(value + band),
    });
  }

  const direction = Math.abs(slope) < sigma / 2 ? "flat" : slope > 0 ? "up" : "down";
  const confidence =
    sigma === 0 ? 100 : Math.max(0, Math.min(100, Math.round((Math.abs(slope) / sigma) * 100)));

  return { points: forecastPoints, direction, confidence, slopePerDay: round2(slope) };
}

export type HeatmapCell = {
  date: string;
  change: number | null;
  weekIndex: number;
  dayIndex: number;
};

/**
 * Siatka kalendarzowa zmian dziennych do heatmapy: kolumna = tydzień,
 * wiersz = dzień tygodnia (0 = poniedziałek, żeby siatka czytała się
 * po polsku). `change` to różnica w PLN/m³ wobec dnia poprzedniego.
 */
export function dailyChangeGrid(points: PricePoint[], weeks = 53): HeatmapCell[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return [];

  const changes = new Map<string, number>();
  for (let i = 1; i < sorted.length; i += 1) {
    changes.set(sorted[i].date, round2(sorted[i].price - sorted[i - 1].price));
  }

  const end = new Date(`${sorted[sorted.length - 1].date}T00:00:00Z`);
  // Cofnij do poniedziałku bieżącego tygodnia, potem o `weeks-1` tygodni.
  const endDow = (end.getUTCDay() + 6) % 7;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - endDow - (weeks - 1) * 7);

  const cells: HeatmapCell[] = [];
  const cursor = new Date(start);
  for (let w = 0; w < weeks; w += 1) {
    for (let d = 0; d < 7; d += 1) {
      const iso = cursor.toISOString().slice(0, 10);
      if (cursor <= end) {
        cells.push({ date: iso, change: changes.get(iso) ?? null, weekIndex: w, dayIndex: d });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return cells;
}

/** Normalizuje serię do indeksu 100 w pierwszym punkcie (porównanie dynamiki). */
export function indexTo100(values: number[]): number[] {
  const base = values.find((v) => v > 0);
  if (base === undefined) return values.map(() => 100);
  return values.map((v) => Math.round((v / base) * 10000) / 100);
}
