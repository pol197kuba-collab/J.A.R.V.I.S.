// MARKET GRID — rozliczanie prognoz i liczenie trafności. Etap 3.
//
// Czysta logika, bez I/O: reguła „czy trafione" musi być jawna, jedna i
// przetestowana, bo to od niej zależy każda liczba na panelu skuteczności.
// Gdyby siedziała w środku zapytania SQL albo w komponencie, nie dałoby się
// jej ani obronić, ani zmienić bez ryzyka.

export type PredictionDirection = "up" | "down" | "flat";
export type PredictionSource = "signals" | "ai" | "ai_learned";

export const toPredictionSource = (value: string): PredictionSource =>
  value === "ai" || value === "ai_learned" ? value : "signals";
export type PredictionOutcome = "hit" | "miss";

/**
 * Pasmo, w którym ruch uznajemy za brak ruchu — wersja STAŁA, ±1%.
 *
 * Bez pasma prognoza „bez kierunku" nigdy nie byłaby trafiona (cena prawie
 * nigdy nie kończy dokładnie tam, gdzie zaczęła), a prognoza „wzrost"
 * zaliczałaby ruch o 0,01% jako sukces.
 *
 * Od 2026-10 to już tylko zapas (brak historii do policzenia zmienności) i
 * punkt odniesienia: jeden próg dla wszystkich okazał się niesprawiedliwy.
 * Mediana tygodniowego ruchu to ~2%, więc „flat" dla BTC prawie zawsze
 * przegrywał, a dla EURPLN prawie zawsze wygrywał (93%). Właściwe pasmo
 * liczy flatBandPct.
 */
export const FLAT_BAND_PCT = 1;

/**
 * Jaka część typowego ruchu w horyzoncie to jeszcze „bez zmian".
 *
 * 0,5 odchylenia standardowego: przy rozkładzie normalnym |Z| < 0,5 ma
 * prawdopodobieństwo ~38%, więc „wzrost", „spadek" i „bez zmian" są z góry
 * mniej więcej równie prawdopodobne (~31/38/31%). Dzięki temu losowe
 * zgadywanie daje ~33% na każdym instrumencie, a wszystko powyżej to
 * realna wartość prognozy — niezależnie od tego, jak bardzo instrument się rusza.
 */
export const FLAT_BAND_SIGMA = 0.5;

/** Granice pasma w %, żeby skrajna seria (dziura w danych, krach) nie zrobiła z niego absurdu. */
export const FLAT_BAND_MIN_PCT = 0.2;
export const FLAT_BAND_MAX_PCT = 5;

/**
 * Pasmo „bez zmian" dla instrumentu, w % — z jego zmienności.
 *
 * @param annualizedVolPct zmienność roczna w % (jak signals.volatility:
 *   odchylenie dziennych zwrotów × √252 × 100).
 * @param sessions ile sesji notowań mieści się w horyzoncie — krypto
 *   handluje 7 dni w tygodniu, reszta ~5 na 7 dni kalendarzowych.
 */
export function flatBandPct(annualizedVolPct: number | null, sessions: number): number {
  if (annualizedVolPct === null || !Number.isFinite(annualizedVolPct) || annualizedVolPct <= 0) {
    return FLAT_BAND_PCT;
  }
  const horizonSigma = (annualizedVolPct / Math.sqrt(252)) * Math.sqrt(Math.max(1, sessions));
  const band = FLAT_BAND_SIGMA * horizonSigma;
  return Math.round(Math.min(FLAT_BAND_MAX_PCT, Math.max(FLAT_BAND_MIN_PCT, band)) * 100) / 100;
}

/** Sesje w horyzoncie kalendarzowym: krypto codziennie, reszta w dni robocze. */
export function sessionsInHorizon(horizonDays: number, assetClass: string): number {
  return assetClass === "crypto" ? horizonDays : Math.max(1, Math.round((horizonDays * 5) / 7));
}

export type ResolvedPrediction = {
  direction: PredictionDirection;
  actualChangePct: number;
  outcome: PredictionOutcome;
};

/**
 * Czy prognoza się sprawdziła.
 *
 * Reguła jest celowo surowa dla kierunku i łagodna dla „bez kierunku":
 * zapowiedź wzrostu wymaga realnego wzrostu (>= pasma), a nie samego braku
 * spadku. Inaczej „typer" chwaliłby się trafnością, której nie da się
 * zamienić na żadną decyzję.
 */
export function resolveOutcome(
  direction: PredictionDirection,
  actualChangePct: number,
  bandPct: number = FLAT_BAND_PCT,
): PredictionOutcome {
  if (direction === "up") return actualChangePct >= bandPct ? "hit" : "miss";
  if (direction === "down") return actualChangePct <= -bandPct ? "hit" : "miss";
  return Math.abs(actualChangePct) < bandPct ? "hit" : "miss";
}

export const percentChange = (from: number, to: number): number | null =>
  from > 0 ? ((to - from) / from) * 100 : null;

export type ScoreRow = {
  /** Wymiar, którego dotyczy wiersz: źródło, kierunek albo symbol. */
  key: string;
  hits: number;
  misses: number;
  resolved: number;
  /** Trafność w %, null gdy nic jeszcze nie rozliczono. */
  hitRate: number | null;
  /** Średnia zmiana ceny na prognozach tego wiersza, w %. */
  avgChangePct: number | null;
};

type Scored = {
  source: PredictionSource;
  direction: PredictionDirection;
  symbol: string;
  outcome: PredictionOutcome | null;
  actualChangePct: number | null;
  /** Wynik wg starej reguły ±1% — tylko do porównania na panelu. */
  outcomeFixedBand?: PredictionOutcome | null;
  /** Reżim rynku w chwili prognozy (regime.ts); null = nieznany. */
  regime?: string | null;
  /**
   * Prognoza postawiona na tych samych, nieodświeżonych notowaniach co
   * poprzednia — kopia, nie nowa obserwacja. Liczenie jej podwajałoby wagę
   * jednego wyniku, więc nie wchodzi do żadnej trafności.
   */
  stale?: boolean;
};

function tally(rows: Scored[], keyOf: (row: Scored) => string): ScoreRow[] {
  const acc = new Map<
    string,
    { hits: number; misses: number; changeSum: number; changeN: number }
  >();

  for (const row of rows) {
    // Nierozliczone prognozy nie wchodzą do statystyki — ich wliczenie jako
    // „jeszcze nie trafione" zaniżałoby trafność tym mocniej, im świeższy
    // jest moduł.
    if (!row.outcome) continue;
    const key = keyOf(row);
    const bucket = acc.get(key) ?? { hits: 0, misses: 0, changeSum: 0, changeN: 0 };
    if (row.outcome === "hit") bucket.hits += 1;
    else bucket.misses += 1;
    if (row.actualChangePct !== null && Number.isFinite(row.actualChangePct)) {
      bucket.changeSum += row.actualChangePct;
      bucket.changeN += 1;
    }
    acc.set(key, bucket);
  }

  return [...acc.entries()]
    .map(([key, b]) => {
      const resolved = b.hits + b.misses;
      return {
        key,
        hits: b.hits,
        misses: b.misses,
        resolved,
        hitRate: resolved > 0 ? (b.hits / resolved) * 100 : null,
        avgChangePct: b.changeN > 0 ? b.changeSum / b.changeN : null,
      };
    })
    .sort((a, b) => b.resolved - a.resolved);
}

export type Scoreboard = {
  bySource: ScoreRow[];
  byDirection: ScoreRow[];
  bySymbol: ScoreRow[];
  /** Trafność wg reżimu rynku w chwili prognozy. */
  byRegime: ScoreRow[];
  /** Trafność wg źródła, gdyby nadal obowiązywał stały próg ±1%. */
  bySourceFixedBand: ScoreRow[];
  resolved: number;
  pending: number;
  /** Ile prognoz pominięto jako kopie na nieodświeżonych notowaniach. */
  stale: number;
  /**
   * Ile rozliczeń trzeba, żeby wynik cokolwiek znaczył. Poniżej tego progu
   * UI pokazuje liczby, ale wprost mówi, że są nieistotne statystycznie —
   * trafność 100% z trzech prognoz to nie jest wynik.
   */
  minimumMeaningful: number;
};

export const MINIMUM_MEANINGFUL_RESOLUTIONS = 20;

export function buildScoreboard(allRows: Scored[]): Scoreboard {
  const rows = allRows.filter((r) => !r.stale);
  return {
    bySource: tally(rows, (r) => r.source),
    byDirection: tally(rows, (r) => r.direction),
    bySymbol: tally(rows, (r) => r.symbol),
    byRegime: tally(
      rows.filter((r) => r.regime),
      (r) => r.regime ?? "",
    ),
    bySourceFixedBand: tally(
      rows
        .filter((r) => r.outcome && r.outcomeFixedBand)
        .map((r) => ({ ...r, outcome: r.outcomeFixedBand ?? null })),
      (r) => r.source,
    ),
    resolved: rows.filter((r) => r.outcome).length,
    pending: rows.filter((r) => !r.outcome).length,
    stale: allRows.length - rows.length,
    minimumMeaningful: MINIMUM_MEANINGFUL_RESOLUTIONS,
  };
}
