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
    // Chybione wzrosty bez straty w zł — sam wniosek o trafności, nie o pieniądzach.
    const ups = series(
      69,
      (i) => (i < 5 ? { outcome: "hit", actualChangePct: 4 } : { actualChangePct: -0.1 }),
      ["BTC", "ETH", "SOL"],
    );
    // W tym samym czasie rynek rósł często — wzrosty były trafiane gorzej niż sam rynek.
    const market = series(40, { direction: "flat", actualChangePct: 4 }, ["XRP", "DOGE"]);
    const lessons = deriveLessons([...ups, ...market], NOW);
    const warn = lessons.find((l) => l.kind === "direction" && l.direction === "up");
    expect(warn).toBeDefined();
    expect(warn!.cases).toBe(69);
    expect(warn!.shrunkRate).toBeLessThan(0.15);
    expect(warn!.textPl).toContain("trafiły 5 z 69");
    expect(warn!.textPl).toContain("gorzej niż sam rynek");
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

describe("lessonProgress", () => {
  it("says how far the first lesson is", async () => {
    const { lessonProgress, MIN_CASES } = await import("./lessons");
    const now = Date.parse("2026-10-19T12:00:00Z");
    const row = (i: number, direction: "up" | "down", outcome: "hit" | "miss") => ({
      symbol: "BTC",
      direction,
      regime: "trend_up",
      outcome,
      actualChangePct: 1,
      flatBandPct: 1,
      madeAt: new Date(now - (i + 1) * 86_400_000).toISOString(),
    });
    expect(lessonProgress([], now)).toEqual({ settled: 0, closest: null, enoughButRandom: 0 });
    const few = Array.from({ length: 5 }, (_, i) => row(i, "up", "hit"));
    const p = lessonProgress(few, now);
    expect(p.settled).toBe(5);
    expect(p.closest).toMatchObject({ direction: "wzrostu", cases: 5 });
    // enough cases, hit rate ~ random → no lesson, but counted
    const many = Array.from({ length: MIN_CASES * 2 + 3 }, (_, i) =>
      row(i, "down", i % 3 === 0 ? "hit" : "miss"),
    );
    expect(lessonProgress(many, now).enoughButRandom).toBeGreaterThan(0);
  });
});

describe("wnioski w złotówkach", () => {
  it("zakupy w trendzie, po których cena spadała, to wniosek o stracie w zł", () => {
    const rows = series(40, { actualChangePct: -2 }, ["BTC", "ETH", "SOL"]);
    const money = deriveLessons(rows, NOW).filter((l) => l.kind === "pnl");
    expect(money.length).toBeGreaterThan(0);
    expect(money[0].direction).toBe("up");
    expect(money[0].rate).toBeLessThan(-0.02);
    expect(money[0].textPl).toContain("kupno po prognozie wzrostu");
    expect(money[0].textPl).toContain("traci pieniądze");
    expect(money[0].textPl).toContain("zł na każde 10 000 zł");
  });

  it("krótka sprzedaż przy spadkach to wniosek o zysku; wnioski w zł idą pierwsze", () => {
    const rows = series(40, { direction: "down", outcome: "hit", actualChangePct: -3 }, [
      "BTC",
      "ETH",
    ]);
    const lessons = deriveLessons(rows, NOW);
    expect(lessons[0].kind).toBe("pnl");
    expect(lessons[0].textPl).toContain("krótka sprzedaż");
    expect(lessons[0].textPl).toContain("zarabia");
  });

  it("„bez zmian” nie daje wniosku w zł (brak pozycji = 0 zł), mały ruch też nie", () => {
    expect(
      deriveLessons(series(40, { direction: "flat" }), NOW).filter((l) => l.kind === "pnl"),
    ).toEqual([]);
    expect(
      deriveLessons(series(40, { actualChangePct: 0.3 }), NOW).filter((l) => l.kind === "pnl"),
    ).toEqual([]);
  });
});

describe("punkt odniesienia z rynku, bez sprzeczności, histereza", () => {
  it("„bez zmian” trafione rzadziej, niż cena zostawała w paśmie, nie jest sukcesem", () => {
    const day = (i: number, perDay: number) =>
      new Date(NOW - (8 + Math.floor(i / perDay)) * DAY).toISOString();
    const flats = series(
      100,
      (i) => ({
        direction: "flat",
        regime: "downtrend",
        madeAt: day(i, 4),
        ...(i < 49
          ? { outcome: "hit", actualChangePct: 0.5 }
          : { outcome: "miss", actualChangePct: -4 }),
      }),
      ["BTC", "ETH", "SOL", "XRP"],
    );
    const others = series(
      40,
      (i) => ({
        direction: "up",
        regime: "downtrend",
        outcome: "miss",
        actualChangePct: 0.5,
        madeAt: day(i, 2),
      }),
      ["DOGE", "ADA"],
    );
    const flat = deriveLessons([...flats, ...others], NOW).filter(
      (l) => l.kind === "direction" && l.direction === "flat",
    );
    // Przy sztywnym 1/3 byłoby „lepiej niż losowo — działa” (49% wobec 33%).
    expect(flat.some((l) => l.textPl.includes("działa"))).toBe(false);
    expect(flat.some((l) => l.textPl.includes("gorzej niż sam rynek"))).toBe(true);
  });

  it("wniosek w zł wycisza sprzeczny wniosek o trafności „bez zmian” w tej samej sytuacji", () => {
    const shorts = series(
      40,
      { direction: "down", regime: "downtrend", outcome: "hit", actualChangePct: -3 },
      ["BTC", "ETH"],
    );
    const flats = series(
      40,
      { direction: "flat", regime: "downtrend", outcome: "hit", actualChangePct: 0.2 },
      ["SOL", "XRP"],
    );
    const lessons = deriveLessons([...shorts, ...flats], NOW);
    expect(lessons.some((l) => l.kind === "pnl" && l.direction === "down")).toBe(true);
    expect(lessons.some((l) => l.kind === "direction" && l.direction === "flat")).toBe(false);
    expect(lessons.some((l) => l.kind === "direction" && l.direction === "down")).toBe(false);
  });

  it("działający wniosek zostaje, gdy słabnie do połowy progu; nowy przy tym poziomie nie wchodzi", () => {
    const at = (daysBack: number) => new Date(NOW - daysBack * DAY).toISOString();
    const row = (daysBack: number, actualChangePct: number, symbol = "BTC"): LessonInput => ({
      symbol,
      direction: "up",
      regime: "uptrend",
      outcome: "miss",
      actualChangePct,
      flatBandPct: 3,
      madeAt: at(daysBack),
    });
    const pnlUp = (rows: LessonInput[]) =>
      deriveLessons(rows, NOW, { horizonDays: 2 }).find(
        (l) => l.kind === "pnl" && l.direction === "up",
      );
    // Do wczoraj: 35 strat po −0,3% (+ koszty) — wniosek o stracie w zł działał.
    // Dziś doszło 5 zysków: wniosek słabnie poniżej pełnego progu, ale zostaje.
    const old = Array.from({ length: 35 }, (_, i) => row(3 + i, -0.3));
    const recent = ["ETH", "SOL", "XRP", "DOGE", "ADA"].map((s) => row(2, 1.4, s));
    const held = pnlUp([...old, ...recent]);
    expect(held).toBeDefined();
    expect(Math.abs(held!.shrunkRate * 100)).toBeLessThan(0.5);
    // Ten sam dzisiejszy poziom bez historii — za słaby na nowy wniosek.
    const flatOld = Array.from({ length: 40 }, (_, i) => row(2 + i, -0.0875));
    expect(pnlUp(flatOld)).toBeUndefined();
  });
});
