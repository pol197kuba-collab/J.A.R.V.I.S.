// MARKET GRID — rozliczanie prognoz i liczenie trafności. Etap 3.
//
// Czysta logika, bez I/O: reguła „czy trafione" musi być jawna, jedna i
// przetestowana, bo to od niej zależy każda liczba na panelu skuteczności.
// Gdyby siedziała w środku zapytania SQL albo w komponencie, nie dałoby się
// jej ani obronić, ani zmienić bez ryzyka.

export type PredictionDirection = "up" | "down" | "flat";
export type PredictionSource = "signals" | "ai";
export type PredictionOutcome = "hit" | "miss";

/**
 * Pasmo, w którym ruch uznajemy za brak ruchu.
 *
 * Bez niego prognoza „bez kierunku" nigdy nie byłaby trafiona (cena prawie
 * nigdy nie kończy dokładnie tam, gdzie zaczęła), a prognoza „wzrost"
 * zaliczałaby ruch o 0,01% jako sukces. 1% to próg świadomie arbitralny —
 * dlatego jest stałą z nazwą, a nie liczbą wklejoną w trzech miejscach.
 */
export const FLAT_BAND_PCT = 1;

export type ResolvedPrediction = {
  direction: PredictionDirection;
  actualChangePct: number;
  outcome: PredictionOutcome;
};

/**
 * Czy prognoza się sprawdziła.
 *
 * Reguła jest celowo surowa dla kierunku i łagodna dla „bez kierunku":
 * zapowiedź wzrostu wymaga realnego wzrostu (>= 1%), a nie samego braku
 * spadku. Inaczej „typer" chwaliłby się trafnością, której nie da się
 * zamienić na żadną decyzję.
 */
export function resolveOutcome(
  direction: PredictionDirection,
  actualChangePct: number,
): PredictionOutcome {
  if (direction === "up") return actualChangePct >= FLAT_BAND_PCT ? "hit" : "miss";
  if (direction === "down") return actualChangePct <= -FLAT_BAND_PCT ? "hit" : "miss";
  return Math.abs(actualChangePct) < FLAT_BAND_PCT ? "hit" : "miss";
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
  resolved: number;
  pending: number;
  /**
   * Ile rozliczeń trzeba, żeby wynik cokolwiek znaczył. Poniżej tego progu
   * UI pokazuje liczby, ale wprost mówi, że są nieistotne statystycznie —
   * trafność 100% z trzech prognoz to nie jest wynik.
   */
  minimumMeaningful: number;
};

export const MINIMUM_MEANINGFUL_RESOLUTIONS = 20;

export function buildScoreboard(rows: Scored[]): Scoreboard {
  return {
    bySource: tally(rows, (r) => r.source),
    byDirection: tally(rows, (r) => r.direction),
    bySymbol: tally(rows, (r) => r.symbol),
    resolved: rows.filter((r) => r.outcome).length,
    pending: rows.filter((r) => !r.outcome).length,
    minimumMeaningful: MINIMUM_MEANINGFUL_RESOLUTIONS,
  };
}
