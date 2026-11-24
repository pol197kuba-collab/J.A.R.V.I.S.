import { describe, expect, it } from "vitest";
import { exitLevels } from "./exits";

describe("exitLevels", () => {
  it("długa: stop poniżej, take powyżej ceny odniesienia", () => {
    const r = exitLevels("long", 100, 0.05, 0.08, 104);
    expect(r.stop!.price).toBeCloseTo(95);
    expect(r.take!.price).toBeCloseTo(108);
    expect(r.stop!.distancePct).toBeCloseTo((95 / 104 - 1) * 100);
    expect(r.take!.distancePct).toBeCloseTo((108 / 104 - 1) * 100);
  });

  it("krótka: stop powyżej, take poniżej", () => {
    const r = exitLevels("short", 100, 0.05, 0.08, 98);
    expect(r.stop!.price).toBeCloseTo(105);
    expect(r.take!.price).toBeCloseTo(92);
    expect(r.stop!.distancePct!).toBeGreaterThan(0);
    expect(r.take!.distancePct!).toBeLessThan(0);
  });

  it("brak progów, ceny odniesienia albo obecnej ceny", () => {
    expect(exitLevels("long", null, 0.05, 0.08, 100)).toEqual({ stop: null, take: null });
    expect(exitLevels("long", 100, null, 0.08, 100).stop).toBeNull();
    expect(exitLevels("long", 100, 0.05, 0, 100).take).toBeNull();
    expect(exitLevels("long", 100, 0.05, 0.08, null).stop!.distancePct).toBeNull();
  });
});
