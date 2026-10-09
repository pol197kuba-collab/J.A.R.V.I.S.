import { describe, expect, it } from "vitest";
import { COFFEE_CHANCE, STROLL_CHANCE, idleDelay, idlePlan } from "./townIdle";

describe("idlePlan", () => {
  it("keeps everyone at their desk while a task is running", () => {
    for (const roll of [0, 0.05, 0.2, 0.5, 0.99]) {
      expect(idlePlan(roll, true, true)).toBe("stay");
      expect(idlePlan(roll, true, false)).toBe("home");
    }
  });

  it("sends an idle agent away from the desk back home first", () => {
    expect(idlePlan(0.01, false, false)).toBe("home");
  });

  it("mostly stays put when the office is quiet", () => {
    expect(idlePlan(0, false, true)).toBe("coffee");
    expect(idlePlan(COFFEE_CHANCE, false, true)).toBe("stroll");
    expect(idlePlan(COFFEE_CHANCE + STROLL_CHANCE, false, true)).toBe("stay");
    expect(1 - COFFEE_CHANCE - STROLL_CHANCE).toBeGreaterThan(0.5);
  });

  it("decides on a calm rhythm", () => {
    expect(idleDelay(0)).toBeGreaterThanOrEqual(9000);
    expect(idleDelay(1)).toBeLessThanOrEqual(18000);
  });
});
