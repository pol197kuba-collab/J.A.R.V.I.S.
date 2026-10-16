import { describe, expect, it } from "vitest";
import { deriveLessons, MIN_CASES, type LessonInput } from "./lessons";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const DAY = 86_400_000;

/** n prognoz rozłożonych dzień po dniu wstecz od NOW. */
function series(
  n: number,
  over: Partial<LessonInput> | ((i: number) => Partial<LessonInput>),
  symbols = ["BTC"],
): LessonInput[] {
  return Array.from({ length: n }, (_, i) => {
    const extra = typeof over === "function" ? over(i) : over;
    return {
      symbol: symbols[i % symbols.length],
      direction: "up",
      regime: "uptrend",
      outcome: "miss",
      actualChangePct: -1.5,
      flatBandPct: 3,
      madeAt: new Date(NOW - (i + 8) * DAY).toISOString(),
      ...extra,
    } as LessonInput;
  });
}

describe("deriveLessons", () => {
  it("krypto z października: 69 chybionych wzrostów w trendzie wzrostowym to wniosek ostrzegawczy", () => {
    const rows = series(69, (i) => ({ outcome: i < 5 ? "hit" : "miss" }), ["BTC", "ETH", "SOL"]);
    const lessons = deriveLessons(rows, NOW);
    const warn = lessons.find((l) => l.kind === "direction" && l.direction === "up");
    expect(warn).toBeDefined();
    expect(warn!.cases).toBe(69);
    expect(warn!.shrunkRate).toBeLessThan(0.15);
    expect(warn!.textPl).toContain("trafiły 5 z 69");
    expect(warn!.textPl).toContain("gorzej niż losowo");
  });

  it("mała próbka nie daje wniosku, nawet przy 0% trafności", () => {
    expect(deriveLessons(series(MIN_CASES - 1, {}), NOW)).toEqual([]);
  });

  it("dużo prognoz z jednego tygodnia to za mało — to jedna obserwacja rynku", () => {
    const sameWeek = series(30, {}).map((r) => ({
      ...r,
      madeAt: new Date(NOW - 8 * DAY).toISOString(),
    }));
    expect(deriveLessons(sameWeek, NOW).filter((l) => l.kind === "direction")).toEqual([]);
  });

  it("wynik bliski losowemu nie jest wnioskiem", () => {
    const rows = series(
      60,
      (i) => ({ outcome: i % 3 === 0 ? "hit" : "miss", actualChangePct: [4, 0, -4][i % 3] }),
      ["BTC", "ETH", "SOL"],
    );
    expect(deriveLessons(rows, NOW).filter((l) => l.kind === "direction")).toEqual([]);
  });

  it("stare prognozy spoza okna nie uczą", () => {
    const old = series(40, {}).map((r) => ({
      ...r,
      madeAt: new Date(NOW - 200 * DAY).toISOString(),
    }));
    expect(deriveLessons(old, NOW)).toEqual([]);
  });

  it("opisuje, co rynek faktycznie robił, licząc instrument i dzień raz", () => {
    // Sygnały i AI z tego samego dnia to jedna obserwacja ceny.
    const signals = series(20, { actualChangePct: 0.5 }, ["BTC", "ETH"]);
    const ai = signals.map((r) => ({ ...r }));
    const base = deriveLessons([...signals, ...ai], NOW).find(
      (l) => l.kind === "base_rate" && l.assetClass === null,
    );
    expect(base).toBeDefined();
    expect(base!.cases).toBe(20);
    expect(base!.direction).toBe("flat");
    expect(base!.textPl).toContain("została w paśmie w 100%");
  });

  it("pomija prognozy bez znanego reżimu", () => {
    expect(deriveLessons(series(40, { regime: null }), NOW)).toEqual([]);
  });
});
