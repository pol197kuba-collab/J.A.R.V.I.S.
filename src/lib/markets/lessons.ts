// MARKET GRID — wnioski typera z jego własnych rozliczonych prognoz.
//
// ZASADA, jak przy RSI: liczby liczy kod, model tylko je czyta. Wniosek to
// zdanie zbudowane z policzonych statystyk („prognozy wzrostu w trendzie
// wzrostowym trafiły 5 z 69 razy"), nigdy opinia modelu o sobie samym.
//
// OSTROŻNOŚĆ, bo danych jest mało i są ze sobą powiązane: prognozy z
// kolejnych dni dotyczą w dużej części tego samego tygodnia, więc 60 prognoz
// z trzech tygodni to realnie kilka niezależnych obserwacji. Dlatego:
// - wniosek wymaga MIN_CASES przypadków z co najmniej MIN_WEEKS tygodni;
// - trafność jest „ściągana" do poziomu losowego (BASELINE) z siłą
//   PRIOR_WEIGHT przypadków — mała próbka nie da skrajnego wniosku;
// - liczone jest tylko okno ostatnich dni (LESSON_WINDOW_DAYS), bo rynek
//   zmienia charakter, a wniosek z września nie musi obowiązywać w grudniu.
// Czysta logika, bez I/O.
import { assetBySymbol } from "./assets";
import { REGIME_LABEL_PL, isMarketRegime } from "./regime";

/** Poziom losowy: pasmo „bez zmian" dobiera trzy wyniki ~równo prawdopodobne. */
export const BASELINE = 1 / 3;
export const PRIOR_WEIGHT = 10;
export const MIN_CASES = 12;
export const MIN_WEEKS = 2;
/** O ile ostrożnie liczona trafność musi odbiegać od losowej, żeby był wniosek. */
export const MIN_DEVIATION = 0.1;
export const LESSON_WINDOW_DAYS = 90;
/** Ile wniosków trafia do promptu — więcej to szum, który model i tak rozmyje. */
export const MAX_LESSONS = 8;

export type LessonInput = {
  symbol: string;
  direction: "up" | "down" | "flat";
  regime: string | null;
  outcome: "hit" | "miss";
  actualChangePct: number;
  flatBandPct: number | null;
  madeAt: string;
};

export type Lesson = {
  /** „direction" = jak wypada dany typ prognozy; „base_rate" = co rynek faktycznie robił. */
  kind: "direction" | "base_rate";
  regime: string;
  /** Klasa aktywów albo null = wszystkie razem. */
  assetClass: string | null;
  direction: "up" | "down" | "flat" | null;
  cases: number;
  weeks: number;
  /** Surowa trafność (direction) albo udział dominującego wyniku (base_rate), 0–1. */
  rate: number;
  /** Ta sama wartość ściągnięta do poziomu losowego — ona decyduje o wniosku. */
  shrunkRate: number;
  textPl: string;
};

const DIRECTION_PL: Record<string, string> = { up: "wzrostu", down: "spadku", flat: "„bez zmian”" };
const CLASS_PL: Record<string, string> = {
  crypto: "krypto",
  equity: "akcje",
  index: "indeksy",
  commodity: "surowce",
  fx: "waluty",
};

const shrink = (hits: number, n: number): number =>
  (hits + PRIOR_WEIGHT * BASELINE) / (n + PRIOR_WEIGHT);

const weekOf = (iso: string): number => Math.floor(Date.parse(iso) / (7 * 86_400_000));

const pct = (x: number): string => `${Math.round(x * 100)}%`;

function realized(row: LessonInput): "up" | "down" | "flat" {
  const band = row.flatBandPct ?? 1;
  if (row.actualChangePct >= band) return "up";
  if (row.actualChangePct <= -band) return "down";
  return "flat";
}

type Bucket = { rows: LessonInput[] };

function groupBy(rows: LessonInput[], keyOf: (r: LessonInput) => string | null) {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const key = keyOf(r);
    if (key === null) continue;
    const b = map.get(key) ?? { rows: [] };
    b.rows.push(r);
    map.set(key, b);
  }
  return map;
}

const classOf = (symbol: string): string => assetBySymbol(symbol)?.assetClass ?? "other";

function scopeLabel(regime: string, assetClass: string | null): string {
  const r = isMarketRegime(regime) ? REGIME_LABEL_PL[regime] : regime;
  return assetClass ? `${r}, ${CLASS_PL[assetClass] ?? assetClass}` : r;
}

/**
 * Wnioski z rozliczonych prognoz, najmocniejsze pierwsze.
 *
 * @param rows rozliczone, nie-kopie, dowolne źródło
 * @param now  „teraz" w ms — parametr, żeby test był deterministyczny
 */
export function deriveLessons(rows: LessonInput[], now: number = Date.now()): Lesson[] {
  const since = now - LESSON_WINDOW_DAYS * 86_400_000;
  const recent = rows.filter(
    (r) => r.regime && Date.parse(r.madeAt) >= since && Number.isFinite(r.actualChangePct),
  );
  const lessons: Array<Lesson & { strength: number }> = [];

  // 1) Jak wypada dany kierunek w danej sytuacji — wszystkie klasy razem i per klasa.
  const scopes: Array<(r: LessonInput) => string | null> = [
    (r) => `${r.regime}|*|${r.direction}`,
    (r) => `${r.regime}|${classOf(r.symbol)}|${r.direction}`,
  ];
  for (const keyOf of scopes) {
    for (const [key, { rows: group }] of groupBy(recent, keyOf)) {
      const [regime, cls, direction] = key.split("|");
      const n = group.length;
      const weeks = new Set(group.map((r) => weekOf(r.madeAt))).size;
      if (n < MIN_CASES || weeks < MIN_WEEKS) continue;
      const hits = group.filter((r) => r.outcome === "hit").length;
      const shrunk = shrink(hits, n);
      const deviation = shrunk - BASELINE;
      if (Math.abs(deviation) < MIN_DEVIATION) continue;
      const assetClass = cls === "*" ? null : cls;
      const verdict =
        deviation < 0
          ? "wyraźnie gorzej niż losowo — w tej sytuacji rozważ inny kierunek albo niską pewność"
          : "lepiej niż losowo — ten typ prognozy w tej sytuacji działa";
      lessons.push({
        kind: "direction",
        regime,
        assetClass,
        direction: direction as Lesson["direction"],
        cases: n,
        weeks,
        rate: hits / n,
        shrunkRate: shrunk,
        textPl:
          `Sytuacja „${scopeLabel(regime, assetClass)}”: prognozy ${DIRECTION_PL[direction]} ` +
          `trafiły ${hits} z ${n} razy (${pct(hits / n)}; ostrożnie liczone ${pct(shrunk)} ` +
          `wobec ~33% losowo, ${weeks} tyg.) — ${verdict}.`,
        strength: Math.abs(deviation) * Math.sqrt(n),
      });
    }
  }

  // 2) Co rynek faktycznie robił w danej sytuacji — niezależnie od tego, co
  // przewidywaliśmy. Jedna obserwacja na instrument i dzień (sygnały i AI
  // dotyczą tej samej ceny — liczenie obu podwoiłoby wagę).
  const seen = new Set<string>();
  const unique = recent.filter((r) => {
    const k = `${r.symbol}|${r.madeAt.slice(0, 10)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const keyOf of [
    (r: LessonInput) => `${r.regime}|*`,
    (r: LessonInput) => `${r.regime}|${classOf(r.symbol)}`,
  ]) {
    for (const [key, { rows: group }] of groupBy(unique, keyOf)) {
      const [regime, cls] = key.split("|");
      const n = group.length;
      const weeks = new Set(group.map((r) => weekOf(r.madeAt))).size;
      if (n < MIN_CASES || weeks < MIN_WEEKS) continue;
      const counts = { up: 0, flat: 0, down: 0 };
      for (const r of group) counts[realized(r)] += 1;
      const [top, topCount] = (Object.entries(counts) as Array<[keyof typeof counts, number]>).sort(
        (a, b) => b[1] - a[1],
      )[0];
      const shrunk = shrink(topCount, n);
      if (shrunk - BASELINE < MIN_DEVIATION) continue;
      const assetClass = cls === "*" ? null : cls;
      lessons.push({
        kind: "base_rate",
        regime,
        assetClass,
        direction: top,
        cases: n,
        weeks,
        rate: topCount / n,
        shrunkRate: shrunk,
        textPl:
          `Sytuacja „${scopeLabel(regime, assetClass)}”: po 7 dniach cena wzrosła w ${pct(counts.up / n)}, ` +
          `została w paśmie w ${pct(counts.flat / n)}, spadła w ${pct(counts.down / n)} przypadków ` +
          `(${n} obserwacji, ${weeks} tyg.).`,
        strength: (shrunk - BASELINE) * Math.sqrt(n),
      });
    }
  }

  return lessons
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_LESSONS)
    .map(({ strength: _strength, ...lesson }) => lesson);
}
