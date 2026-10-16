// MARKET GRID — reżim rynku w chwili postawienia prognozy.
//
// PO CO: sama trafność „krypto 5%" mówi tylko, że coś nie działa. Dopiero
// trafność W DANEJ SYTUACJI mówi co. Przegląd z 2026-10 pokazał to wprost:
// przez trzy tygodnie konsolidacji BTC/ETH średnie kroczące wciąż wskazywały
// wzrost (SMA20 5–10% nad SMA50 po wrześniowych wzrostach), więc typer
// 65 razy z rzędu mówił „wzrost", a cena stała albo spadała. Reżim pozwala
// odróżnić „trend, który trwa" od „trendu, który już się wyczerpał".
//
// Liczony z tych samych wskaźników co sygnały (signals.ts) — żadnych nowych
// danych, tylko inna, jawna klasyfikacja. Czysta funkcja, bez I/O.
import type { TechnicalSignals } from "./signals";

export type MarketRegime =
  | "uptrend"
  | "uptrend_pullback"
  | "downtrend"
  | "downtrend_bounce"
  | "sideways";

export const REGIME_LABEL_PL: Record<MarketRegime, string> = {
  uptrend: "trend wzrostowy",
  uptrend_pullback: "korekta w trendzie wzrostowym",
  downtrend: "trend spadkowy",
  downtrend_bounce: "odbicie w trendzie spadkowym",
  sideways: "bez trendu",
};

/**
 * Od jakiej różnicy SMA20 vs SMA50 (w %) mówimy o trendzie. Poniżej tego
 * średnie się splatają i ich „kierunek" to szum.
 */
export const TREND_SPREAD_PCT = 1;

/**
 * Klasyfikuje rynek w chwili prognozy.
 *
 * - brak trendu: SMA20 i SMA50 bliżej niż TREND_SPREAD_PCT;
 * - trend: średnie rozjechane, a ostatnie 5 sesji idą w tę samą stronę;
 * - korekta / odbicie: średnie rozjechane, ale ostatnie 5 sesji idą POD
 *   prąd — dokładnie ta sytuacja, w której trend-following się myli.
 *
 * null, gdy seria jest za krótka na SMA50 albo momentum.
 */
export function classifyRegime(signals: TechnicalSignals): MarketRegime | null {
  const { sma20, sma50, momentum5 } = signals;
  if (sma20 === null || sma50 === null || sma50 <= 0 || momentum5 === null) return null;
  const spread = ((sma20 - sma50) / sma50) * 100;
  if (Math.abs(spread) < TREND_SPREAD_PCT) return "sideways";
  if (spread > 0) return momentum5 > 0 ? "uptrend" : "uptrend_pullback";
  return momentum5 < 0 ? "downtrend" : "downtrend_bounce";
}

export const isMarketRegime = (value: unknown): value is MarketRegime =>
  typeof value === "string" && Object.hasOwn(REGIME_LABEL_PL, value);
