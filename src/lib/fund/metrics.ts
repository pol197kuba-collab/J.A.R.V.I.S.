// FUNDUSZ — metryki gracza z dziennej wyceny. Czysta logika.

import type { NavPoint, Trade } from "./engine";

export type FundMetrics = {
  /** Stopa zwrotu od startu, % */
  returnPct: number;
  /** Największy spadek od szczytu, % (liczba ≤ 0). */
  maxDrawdownPct: number;
  /**
   * Sharpe z dziennych zmian, w skali roku (365 dni — wycena jest
   * kalendarzowa, krypto handluje w weekendy). null przy < 10 dniach albo
   * zerowej zmienności — za mało, żeby to coś znaczyło.
   */
  sharpe: number | null;
  /** Obrót: suma wartości transakcji / średnia wycena (1 = cały portfel raz). */
  turnover: number;
  trades: number;
  feesPln: number;
  /**
   * Ile sygnałów (prognoz) gracz dostał i z którego dnia ostatni. Zero przy
   * graczu-źródle = jeszcze nie gra (np. „AI z wnioskami” bez wniosków), a nie
   * wynik 0%. Brak pola = portfel przeliczony przed dodaniem licznika.
   */
  signals?: number;
  lastSignalOn?: string | null;
};

export function computeMetrics(
  nav: NavPoint[],
  trades: Trade[],
  startCashPln: number,
): FundMetrics {
  const last = nav.length > 0 ? nav[nav.length - 1].navPln : startCashPln;
  let peak = startCashPln;
  let maxDd = 0;
  for (const p of nav) {
    peak = Math.max(peak, p.navPln);
    maxDd = Math.min(maxDd, (p.navPln / peak - 1) * 100);
  }

  const returns: number[] = [];
  for (let i = 1; i < nav.length; i++) {
    if (nav[i - 1].navPln > 0) returns.push(nav[i].navPln / nav[i - 1].navPln - 1);
  }
  let sharpe: number | null = null;
  if (returns.length >= 10) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const sd = Math.sqrt(variance);
    if (sd > 1e-12) sharpe = (mean / sd) * Math.sqrt(365);
  }

  const avgNav = nav.length > 0 ? nav.reduce((s, p) => s + p.navPln, 0) / nav.length : startCashPln;
  const volume = trades.reduce((s, t) => s + t.notionalPln, 0);

  return {
    returnPct: (last / startCashPln - 1) * 100,
    maxDrawdownPct: maxDd,
    sharpe,
    turnover: avgNav > 0 ? volume / avgNav : 0,
    trades: trades.length,
    feesPln: trades.reduce((s, t) => s + t.feePln, 0),
  };
}
