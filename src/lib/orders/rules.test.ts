import { describe, expect, it } from "vitest";
import {
  MAX_SERIES_STALENESS_DAYS,
  describeOrder,
  evaluateOrder,
  formatHit,
  isSilenced,
  type OrderCondition,
  type SeriesPoint,
  type StandingOrder,
} from "./rules";

const NOW = new Date("2026-09-22T18:00:00Z");

/** Rozkaz z sensownymi wartościami domyślnymi — test nadpisuje tylko to, co bada. */
const order = (patch: Partial<StandingOrder> & { condition: OrderCondition }): StandingOrder => ({
  id: "00000000-0000-0000-0000-000000000001",
  subjectKind: "market",
  subject: "BTC",
  threshold: 5,
  windowDays: 1,
  cooldownHours: 24,
  phrase: null,
  isEnabled: true,
  expiresAt: null,
  lastTriggeredAt: null,
  triggerCount: 0,
  ...patch,
});

/** Seria dzienna kończąca się `endDate`, wartości podane od najstarszej. */
const series = (endDate: string, values: number[]): SeriesPoint[] => {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return values.map((value, i) => ({
    date: new Date(end - (values.length - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    value,
  }));
};

describe("evaluateOrder — warunki poziomu", () => {
  it("melduje, gdy cena spadła poniżej progu", () => {
    const hit = evaluateOrder(
      order({ condition: "level_below", threshold: 5200 }),
      series("2026-09-22", [5400, 5300, 5150]),
      NOW,
    );
    expect(hit?.value).toBe(5150);
    // Warunek poziomu nie ma punktu odniesienia — i nie udaje, że ma.
    expect(hit?.reference).toBeNull();
    expect(hit?.changePct).toBeNull();
  });

  it("milczy, dopóki próg nie został przekroczony", () => {
    expect(
      evaluateOrder(
        order({ condition: "level_below", threshold: 5000 }),
        series("2026-09-22", [5400, 5300, 5150]),
        NOW,
      ),
    ).toBeNull();
  });

  it("melduje przekroczenie progu w górę", () => {
    const hit = evaluateOrder(
      order({ condition: "level_above", threshold: 100_000 }),
      series("2026-09-22", [90_000, 101_500]),
      NOW,
    );
    expect(hit).not.toBeNull();
  });
});

describe("evaluateOrder — warunki zmiany", () => {
  it("łapie spadek procentowy w zadanym oknie", () => {
    const hit = evaluateOrder(
      order({ condition: "change_pct_down", threshold: 5, windowDays: 1 }),
      series("2026-09-22", [100, 94]),
      NOW,
    );
    expect(hit?.changePct).toBeCloseTo(-6, 6);
  });

  it("nie myli kierunku — spadek nie wyzwala rozkazu na wzrost", () => {
    expect(
      evaluateOrder(
        order({ condition: "change_pct_up", threshold: 5 }),
        series("2026-09-22", [100, 94]),
        NOW,
      ),
    ).toBeNull();
  });

  it("liczy zmianę przez całe okno, a nie tylko z ostatniego dnia", () => {
    // Każdy dzień z osobna daje ~2%, dopiero tydzień łącznie przekracza 5%.
    const week = series("2026-09-22", [100, 102, 104, 106, 108, 110, 112, 114]);
    expect(
      evaluateOrder(order({ condition: "change_pct_up", threshold: 5 }), week, NOW),
    ).toBeNull();
    const hit = evaluateOrder(
      order({ condition: "change_pct_up", threshold: 5, windowDays: 7 }),
      week,
      NOW,
    );
    expect(hit?.changePct).toBeCloseTo(14, 6);
  });

  it("bierze za odniesienie ostatni punkt sprzed okna, nie najstarszy w serii", () => {
    const hit = evaluateOrder(
      order({ condition: "change_pct_down", threshold: 1, windowDays: 1 }),
      series("2026-09-22", [1000, 200, 100, 90]),
      NOW,
    );
    // Odniesieniem ma być 100 (wczoraj), nie 1000 (początek serii).
    expect(hit?.reference).toBe(100);
    expect(hit?.changePct).toBeCloseTo(-10, 6);
  });

  it("przeskakuje lukę w notowaniach zamiast milczeć", () => {
    // Piątek i poniedziałek: „zmiana dzienna" jest tu zmianą przez weekend.
    // Odmowa meldunku byłaby gorsza niż lekka nieścisłość w nazwie okna.
    const hit = evaluateOrder(
      order({ condition: "change_pct_down", threshold: 5 }),
      [
        { date: "2026-09-18", value: 100 },
        { date: "2026-09-21", value: 90 },
      ],
      new Date("2026-09-21T18:00:00Z"),
    );
    expect(hit?.referenceDate).toBe("2026-09-18");
  });

  it("milczy, gdy historia jest krótsza niż okno", () => {
    expect(
      evaluateOrder(
        order({ condition: "change_pct_down", threshold: 5, windowDays: 30 }),
        series("2026-09-22", [100, 80]),
        NOW,
      ),
    ).toBeNull();
  });

  it("zmiana bezwzględna łapie oba kierunki", () => {
    const rule = order({ condition: "change_abs", threshold: 120 });
    expect(evaluateOrder(rule, series("2026-09-22", [5000, 5150]), NOW)?.changeAbs).toBeCloseTo(
      150,
      6,
    );
    expect(evaluateOrder(rule, series("2026-09-22", [5000, 4850]), NOW)?.changeAbs).toBeCloseTo(
      -150,
      6,
    );
  });
});

describe("evaluateOrder — kiedy NIE meldować", () => {
  it("nie melduje z martwej serii", () => {
    // Gdyby źródło notowań zamilkło, warunek „poniżej X" byłby spełniony w
    // nieskończoność przez ostatnią znaną cenę — meldunek opisywałby
    // przeszłość jako teraźniejszość.
    const stale = series("2026-09-01", [100, 50]);
    expect(
      evaluateOrder(order({ condition: "level_below", threshold: 60 }), stale, NOW),
    ).toBeNull();
  });

  it("melduje z serii świeżej na granicy dopuszczalnego opóźnienia", () => {
    const end = new Date(NOW.getTime() - MAX_SERIES_STALENESS_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(
      evaluateOrder(
        order({ condition: "level_below", threshold: 60 }),
        series(end, [100, 50]),
        NOW,
      ),
    ).not.toBeNull();
  });

  it("nie melduje z rozkazu wyłączonego ani wygasłego", () => {
    const points = series("2026-09-22", [100, 50]);
    const rule = { condition: "level_below" as const, threshold: 60 };
    expect(evaluateOrder(order({ ...rule, isEnabled: false }), points, NOW)).toBeNull();
    expect(
      evaluateOrder(order({ ...rule, expiresAt: "2026-09-20T00:00:00Z" }), points, NOW),
    ).toBeNull();
    expect(
      evaluateOrder(order({ ...rule, expiresAt: "2026-09-30T00:00:00Z" }), points, NOW),
    ).not.toBeNull();
  });

  it("respektuje wyciszenie po poprzednim meldunku", () => {
    const points = series("2026-09-22", [100, 50]);
    const fresh = order({
      condition: "level_below",
      threshold: 60,
      lastTriggeredAt: "2026-09-22T12:00:00Z",
    });
    expect(evaluateOrder(fresh, points, NOW)).toBeNull();

    const expired = order({
      condition: "level_below",
      threshold: 60,
      lastTriggeredAt: "2026-09-21T06:00:00Z",
    });
    expect(evaluateOrder(expired, points, NOW)).not.toBeNull();
  });

  it("milczy na pustej serii", () => {
    expect(evaluateOrder(order({ condition: "level_below", threshold: 60 }), [], NOW)).toBeNull();
  });
});

describe("isSilenced", () => {
  it("liczy wyciszenie od chwili meldunku, nie od początku doby", () => {
    const rule = order({
      condition: "level_below",
      cooldownHours: 6,
      lastTriggeredAt: "2026-09-22T14:00:00Z",
    });
    expect(isSilenced(rule, new Date("2026-09-22T19:00:00Z"))).toBe(true);
    expect(isSilenced(rule, new Date("2026-09-22T20:30:00Z"))).toBe(false);
  });
});

describe("opis i meldunek", () => {
  const labels = { label: "ON Ekodiesel", unit: "PLN/m³" };

  it("opisuje rozkaz zdaniem, nie kodem warunku", () => {
    expect(describeOrder(order({ condition: "level_below", threshold: 5200 }), labels)).toBe(
      "ON Ekodiesel poniżej 5\u00a0200 PLN/m³",
    );
    expect(
      describeOrder(order({ condition: "change_pct_down", threshold: 5, windowDays: 7 }), labels),
    ).toBe("ON Ekodiesel w dół o 5% w ciągu 7 dni");
  });

  it("wplata w meldunek oryginalne zdanie użytkownika", () => {
    const hit = evaluateOrder(
      order({
        condition: "change_pct_down",
        threshold: 5,
        phrase: "daj znać, jak ON tąpnie",
      }),
      series("2026-09-22", [5000, 4700]),
      NOW,
    )!;
    const msg = formatHit(hit, labels);
    expect(msg.title).toContain("ON Ekodiesel");
    expect(msg.body).toContain("daj znać, jak ON tąpnie");
    expect(msg.body).toContain("-6%");
  });
});
