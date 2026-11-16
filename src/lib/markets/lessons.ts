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
// - trafność jest „ściągana" do tego, jak często rynek w tej sytuacji sam
//   tak kończył (nie do sztywnego 1/3), z siłą PRIOR_WEIGHT przypadków —
//   mała próbka nie da skrajnego wniosku;
// - wniosek o trafności sprzeczny z wnioskiem w złotówkach nie idzie do
//   promptu, a wnioski raz wprowadzone trzymają się z histerezą;
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
/** Histereza: ile dni wstecz wniosek liczy się jako „już działający”. */
export const HOLD_DAYS = 7;
/** Działający wniosek zostaje, dopóki spełnia taki ułamek progu. */
export const HOLD_FACTOR = 0.5;
/** Premia siły działającego wniosku przy wyborze miejsc w prompcie. */
export const INCUMBENT_BONUS = 1.5;

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
  /** Ta sama wartość ściągnięta do punktu odniesienia — ona decyduje o wniosku. */
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

type Candidate = Lesson & { strength: number; key: string };

/** Okno wniosków: rozliczone, z reżimem, z ostatnich LESSON_WINDOW_DAYS dni. */
function windowed(rows: LessonInput[], now: number): LessonInput[] {
  const since = now - LESSON_WINDOW_DAYS * 86_400_000;
  return rows.filter(
    (r) => r.regime && Date.parse(r.madeAt) >= since && Number.isFinite(r.actualChangePct),
  );
}

/** Jedna obserwacja na instrument i dzień (sygnały i AI dotyczą tej samej ceny). */
function uniqueObservations(rows: LessonInput[]): LessonInput[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.symbol}|${r.madeAt.slice(0, 10)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Jak często rynek w danej sytuacji (reżim × klasa, „*” = wszystkie klasy)
 * kończył w danym kierunku — punkt odniesienia dla trafności prognoz. Zamiast
 * sztywnego 1/3: „bez zmian” trafione w 49% to nie sukces, gdy cena zostawała
 * w paśmie w 58% przypadków. Też ściągane do 1/3 — mała próbka nie daje
 * skrajnego punktu odniesienia; poniżej MIN_CASES obserwacji zostaje 1/3.
 */
function marketBaselines(unique: LessonInput[]): (key: string, direction: string) => number {
  const counts = new Map<string, { n: number; up: number; flat: number; down: number }>();
  for (const r of unique) {
    for (const key of [`${r.regime}|*`, `${r.regime}|${classOf(r.symbol)}`]) {
      const c = counts.get(key) ?? { n: 0, up: 0, flat: 0, down: 0 };
      c.n += 1;
      c[realized(r)] += 1;
      counts.set(key, c);
    }
  }
  return (key, direction) => {
    const c = counts.get(key);
    if (!c || c.n < MIN_CASES || !(direction in c)) return BASELINE;
    const hits = c[direction as "up" | "flat" | "down"];
    return (hits + PRIOR_WEIGHT * BASELINE) / (c.n + PRIOR_WEIGHT);
  };
}

/**
 * Wszyscy kandydaci na wnioski. `factor` skaluje progi (MIN_DEVIATION,
 * MIN_PNL_PCT) — 1 = pełne progi dla nowego wniosku, mniej = progi
 * podtrzymania wniosku, który już działał (histereza).
 */
function candidates(recent: LessonInput[], h: number, factor: number): Candidate[] {
  const lessons: Candidate[] = [];
  const unique = uniqueObservations(recent);
  const baseline = marketBaselines(unique);

  // 1) Jak wypada dany kierunek w danej sytuacji — wszystkie klasy razem i per
  //    klasa — wobec tego, jak często rynek sam tak się zachowywał.
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
      const base = baseline(`${regime}|${cls}`, direction);
      const shrunk = (hits + PRIOR_WEIGHT * base) / (n + PRIOR_WEIGHT);
      const deviation = shrunk - base;
      if (Math.abs(deviation) < MIN_DEVIATION * factor) continue;
      const assetClass = cls === "*" ? null : cls;
      const verdict =
        deviation < 0
          ? "gorzej niż sam rynek — w tej sytuacji rozważ inny kierunek albo niską pewność"
          : "lepiej niż sam rynek — ten typ prognozy w tej sytuacji działa";
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
          `wobec ${pct(base)} — tak często rynek w tej sytuacji tak kończył, ${weeks} tyg.) — ${verdict}.`,
        strength: Math.abs(deviation) * Math.sqrt(n),
        key: `direction|${regime}|${cls}|${direction}|${deviation < 0 ? "-" : "+"}`,
      });
    }
  }

  // 2) Co rynek faktycznie robił w danej sytuacji — niezależnie od tego, co
  //    przewidywaliśmy.
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
      if (shrunk - BASELINE < MIN_DEVIATION * factor) continue;
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
        key: `base_rate|${regime}|${cls}|${top}|+`,
      });
    }
  }

  // 3) Ile dawało zagranie prognozy w funduszu — w złotówkach, po kosztach.
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
      if (Math.abs(shrunk) < MIN_PNL_PCT * factor) continue;
      const assetClass = cls === "*" ? null : cls;
      const action =
        direction === "up"
          ? "kupno po prognozie wzrostu dawało"
          : "krótka sprzedaż po prognozie spadku dawała";
      const verdict =
        shrunk < 0
          ? "w tej sytuacji to traci pieniądze — nie stawiaj tego kierunku albo daj niską pewność"
          : "w tej sytuacji to zarabia";
      lessons.push({
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
        key: `pnl|${regime}|${cls}|${direction}|${shrunk < 0 ? "-" : "+"}`,
      });
    }
  }
  return lessons;
}

/**
 * Wniosek o trafności, który kłóci się z wnioskiem w złotówkach o tej samej
 * sytuacji, nie trafia do promptu. Fundusz liczy się w złotówkach: gdy krótka
 * sprzedaż w trendzie spadkowym zarabia, zdanie „«bez zmian» trafia częściej”
 * ciągnęło model do braku pozycji (0 zł). Gdy zagranie traci, „bez zmian”
 * zostaje — wtedy nie ma sprzeczności. Wniosek w zł o całej sytuacji
 * (wszystkie klasy) wycisza też wnioski o trafności per klasa.
 */
function contradicts(pnl: Lesson, l: Lesson): boolean {
  return (
    l.kind === "direction" &&
    l.regime === pnl.regime &&
    (pnl.assetClass === null || pnl.assetClass === l.assetClass) &&
    // ten sam kierunek — wniosek w zł mówi więcej; „bez zmian” — tylko gdy
    // zagranie zarabia (wtedy brak pozycji to oddane pieniądze)
    (l.direction === pnl.direction || (l.direction === "flat" && pnl.shrunkRate > 0))
  );
}

/** Wybór do promptu: najpierw wnioski w zł, potem reszta bez sprzecznych z nimi. */
function select(all: Candidate[]): Candidate[] {
  const byStrength = [...all].sort((a, b) => b.strength - a.strength || a.key.localeCompare(b.key));
  const pnl = byStrength.filter((l) => l.kind === "pnl").slice(0, MAX_PNL_LESSONS);
  const rest = byStrength
    .filter((l) => l.kind !== "pnl" && !pnl.some((p) => contradicts(p, l)))
    .slice(0, MAX_LESSONS - pnl.length);
  return [...pnl, ...rest];
}

/**
 * Wnioski z rozliczonych prognoz, najmocniejsze pierwsze.
 *
 * HISTEREZA: wniosek, który był w prompcie w ostatnich HOLD_DAYS dniach,
 * zostaje, dopóki spełnia połowę progu (HOLD_FACTOR) i ma ten sam wydźwięk, a
 * przy wyborze miejsc dostaje premię (INCUMBENT_BONUS). Bez tego wnioski
 * wchodziły i wypadały codziennie (z progiem ±1 przypadku), model co dzień
 * dostawał inny zestaw i nie dało się ocenić, czy nauka działa. Zestaw
 * „wczoraj” jest odtwarzany z tych samych wierszy (prognozy rozliczone przed
 * danym dniem: dzień + horyzont), więc funkcja zostaje czysta.
 *
 * @param rows rozliczone, nie-kopie, dowolne źródło
 * @param now  „teraz" w ms — parametr, żeby test był deterministyczny
 */
export function deriveLessons(
  rows: LessonInput[],
  now: number = Date.now(),
  /** Horyzont prognoz w wierszach — do treści wniosków i odtworzenia dni wstecz. */
  opts: { horizonDays?: number } = {},
): Lesson[] {
  const h = opts.horizonDays ?? 7;
  const DAY = 86_400_000;

  const incumbents = new Set<string>();
  for (let k = 1; k <= HOLD_DAYS; k++) {
    const t = now - k * DAY;
    const settled = rows.filter((r) => Date.parse(r.madeAt) + h * DAY <= t);
    for (const l of select(candidates(windowed(settled, t), h, 1))) incumbents.add(l.key);
  }

  const recent = windowed(rows, now);
  const fresh = new Set(candidates(recent, h, 1).map((l) => l.key));
  const pool = candidates(recent, h, HOLD_FACTOR)
    .filter((l) => fresh.has(l.key) || incumbents.has(l.key))
    .map((l) => (incumbents.has(l.key) ? { ...l, strength: l.strength * INCUMBENT_BONUS } : l));

  return select(pool).map(({ strength: _s, key: _k, ...lesson }) => lesson);
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
