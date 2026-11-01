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
import { DEFAULT_RULES } from "@/lib/fund/engine";
import { assetBySymbol, type AssetClass } from "./assets";
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
/**
 * Wnioski w złotówkach: ile średnio dawało ZAGRANIE prognozy w funduszu
 * („wzrost” = kupno, „spadek” = krótka sprzedaż) po kosztach. Trafność to
 * nie pieniądze — trafne „bez zmian” zarabia 0 zł, a 40% trafionych wzrostów
 * może zarabiać, jeśli trafienia są duże. Ostrożnie: średnia ściągana do zera
 * z siłą PRIOR_WEIGHT przypadków, wniosek dopiero od MIN_PNL_PCT.
 */
export const MIN_PNL_PCT = 0.5;
/** Ile miejsc w MAX_LESSONS jest zarezerwowanych na wnioski w złotówkach. */
export const MAX_PNL_LESSONS = 3;

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
  /**
   * „direction" = jak wypada dany typ prognozy; „base_rate" = co rynek
   * faktycznie robił; „pnl" = ile dawało zagranie prognozy w złotówkach.
   */
  kind: "direction" | "base_rate" | "pnl";
  regime: string;
  /** Klasa aktywów albo null = wszystkie razem. */
  assetClass: string | null;
  direction: "up" | "down" | "flat" | null;
  cases: number;
  weeks: number;
  /**
   * Surowa trafność (direction), udział dominującego wyniku (base_rate), 0–1,
   * albo średni wynik zagrania po kosztach jako ułamek (pnl, np. −0,012).
   */
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
  etf: "ETF",
};

const shrink = (hits: number, n: number): number =>
  (hits + PRIOR_WEIGHT * BASELINE) / (n + PRIOR_WEIGHT);

const weekOf = (iso: string): number => Math.floor(Date.parse(iso) / (7 * 86_400_000));

const pct = (x: number): string => `${Math.round(x * 100)}%`;

const signedPl = (v: number, digits: number): string =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("pl-PL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;

/** Koszt zagrania tam i z powrotem (prowizja ×2 + pełny spread), w %. */
function roundTripCostPct(symbol: string): number {
  const cls = assetBySymbol(symbol)?.assetClass as AssetClass | undefined;
  const spread = cls ? DEFAULT_RULES.spreadByClass[cls] : DEFAULT_RULES.spreadByClass.equity;
  return (2 * DEFAULT_RULES.commissionRate + spread) * 100;
}

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
export function deriveLessons(
  rows: LessonInput[],
  now: number = Date.now(),
  /** Horyzont prognoz w wierszach — tylko do treści wniosków („po 2 dniach”). */
  opts: { horizonDays?: number } = {},
): Lesson[] {
  const h = opts.horizonDays ?? 7;
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
          `Sytuacja „${scopeLabel(regime, assetClass)}”: po ${h} ${h === 1 ? "dniu" : "dniach"} cena wzrosła w ${pct(counts.up / n)}, ` +
          `została w paśmie w ${pct(counts.flat / n)}, spadła w ${pct(counts.down / n)} przypadków ` +
          `(${n} obserwacji, ${weeks} tyg.).`,
        strength: (shrunk - BASELINE) * Math.sqrt(n),
      });
    }
  }

  // 3) Ile dawało zagranie prognozy w funduszu — w złotówkach, po kosztach.
  const money: Array<Lesson & { strength: number }> = [];
  for (const keyOf of scopes) {
    for (const [key, { rows: group }] of groupBy(recent, keyOf)) {
      const [regime, cls, direction] = key.split("|");
      if (direction !== "up" && direction !== "down") continue;
      const n = group.length;
      const weeks = new Set(group.map((r) => weekOf(r.madeAt))).size;
      if (n < MIN_CASES || weeks < MIN_WEEKS) continue;
      const sum = group.reduce(
        (s, r) =>
          s +
          (direction === "up" ? r.actualChangePct : -r.actualChangePct) -
          roundTripCostPct(r.symbol),
        0,
      );
      const mean = sum / n;
      const shrunk = sum / (n + PRIOR_WEIGHT);
      if (Math.abs(shrunk) < MIN_PNL_PCT) continue;
      const assetClass = cls === "*" ? null : cls;
      const action =
        direction === "up"
          ? "kupno po prognozie wzrostu dawało"
          : "krótka sprzedaż po prognozie spadku dawała";
      const verdict =
        shrunk < 0
          ? "w tej sytuacji to traci pieniądze — nie stawiaj tego kierunku albo daj niską pewność"
          : "w tej sytuacji to zarabia";
      money.push({
        kind: "pnl",
        regime,
        assetClass,
        direction: direction as Lesson["direction"],
        cases: n,
        weeks,
        rate: mean / 100,
        shrunkRate: shrunk / 100,
        textPl:
          `Sytuacja „${scopeLabel(regime, assetClass)}”: ${action} średnio ${signedPl(mean, 1)}% ` +
          `w ${h} dni po kosztach (≈ ${signedPl(Math.round(mean * 100), 0)} zł na każde 10 000 zł; ` +
          `ostrożnie liczone ${signedPl(shrunk, 1)}%, ${n} przypadków, ${weeks} tyg.) — ${verdict}.`,
        strength: Math.abs(shrunk) * Math.sqrt(n),
      });
    }
  }

  const strip = ({ strength: _strength, ...lesson }: Lesson & { strength: number }): Lesson =>
    lesson;
  const pnl = money.sort((a, b) => b.strength - a.strength).slice(0, MAX_PNL_LESSONS);
  const rest = lessons.sort((a, b) => b.strength - a.strength).slice(0, MAX_LESSONS - pnl.length);
  return [...pnl, ...rest].map(strip);
}

export type LessonProgress = {
  /** Rozliczone prognozy z reżimem w oknie — surowiec na wnioski. */
  settled: number;
  /** Sytuacja (reżim × kierunek) najbliższa progu, której jeszcze brakuje przypadków. */
  closest: { scope: string; direction: string; cases: number; weeks: number } | null;
  /** Sytuacje z wystarczającą próbką, w których trafność nie odbiega od losowej. */
  enoughButRandom: number;
};

/**
 * Ile brakuje do pierwszego wniosku — żeby pusta lista nie wyglądała na
 * awarię. Liczy te same grupy co deriveLessons (kierunek w reżimie, razem
 * i per klasa aktywów).
 */
export function lessonProgress(rows: LessonInput[], now: number = Date.now()): LessonProgress {
  const since = now - LESSON_WINDOW_DAYS * 86_400_000;
  const recent = rows.filter(
    (r) => r.regime && Date.parse(r.madeAt) >= since && Number.isFinite(r.actualChangePct),
  );
  let closest: LessonProgress["closest"] = null;
  let best = -1;
  let enoughButRandom = 0;
  for (const keyOf of [
    (r: LessonInput) => `${r.regime}|*|${r.direction}`,
    (r: LessonInput) => `${r.regime}|${classOf(r.symbol)}|${r.direction}`,
  ]) {
    for (const [key, { rows: group }] of groupBy(recent, keyOf)) {
      const [regime, cls, direction] = key.split("|");
      const n = group.length;
      const weeks = new Set(group.map((r) => weekOf(r.madeAt))).size;
      if (n >= MIN_CASES && weeks >= MIN_WEEKS) {
        const hits = group.filter((r) => r.outcome === "hit").length;
        if (Math.abs(shrink(hits, n) - BASELINE) < MIN_DEVIATION) enoughButRandom += 1;
        continue;
      }
      // postęp = słabsze z dwóch kryteriów; przy remisie więcej przypadków
      const progress = Math.min(n / MIN_CASES, weeks / MIN_WEEKS) + n / 1000;
      if (progress > best) {
        best = progress;
        closest = {
          scope: scopeLabel(regime, cls === "*" ? null : cls),
          direction: DIRECTION_PL[direction] ?? direction,
          cases: n,
          weeks,
        };
      }
    }
  }
  return { settled: recent.length, closest, enoughButRandom };
}
