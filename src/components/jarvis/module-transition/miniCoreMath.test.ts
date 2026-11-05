import { describe, expect, it } from "vitest";
import {
  JARVIS_HOLD_MS,
  MINI_CORE_BUTTON_PX,
  holdCharge,
  miniCoreDistance,
  miniCoreSpin,
} from "./miniCoreMath";

describe("dock mini core", () => {
  it("is 25% bigger than the old 60 px button", () => {
    expect(MINI_CORE_BUTTON_PX).toBe(75);
  });

  it("frames the rings inside the view", () => {
    const d = miniCoreDistance(100, 30);
    expect(100 / d).toBeCloseTo(Math.tan((15 * Math.PI) / 180));
  });

  it("charges over the 2 s hold and spins up for busy agents", () => {
    expect(holdCharge(0)).toBe(0);
    expect(holdCharge(JARVIS_HOLD_MS / 2)).toBeCloseTo(0.25);
    expect(holdCharge(JARVIS_HOLD_MS * 3)).toBe(1);
    expect(miniCoreSpin("busy")).toBeGreaterThan(miniCoreSpin("idle"));
  });
});
