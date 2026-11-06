import { describe, expect, it } from "vitest";
import {
  RIBBON_H,
  RIBBON_W,
  labelIndices,
  nearestIndex,
  niceTicks,
  ribbonCameraDistance,
  ribbonDomain,
  ribbonX,
  ribbonY,
} from "./ribbonMath";

describe("ribbon chart math", () => {
  it("pads the domain and survives flat or empty data", () => {
    const d = ribbonDomain([100, 110]);
    expect(d.lo).toBeLessThan(100);
    expect(d.hi).toBeGreaterThan(110);
    const flat = ribbonDomain([5, 5]);
    expect(flat.hi).toBeGreaterThan(flat.lo);
    expect(ribbonDomain([])).toEqual({ lo: 0, hi: 1 });
  });

  it("gives round ticks inside the domain", () => {
    const t = niceTicks(231.4, 271.9);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.length).toBeLessThanOrEqual(6);
    t.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(231.4);
      expect(v).toBeLessThanOrEqual(271.9);
      expect(v % 5).toBeCloseTo(0);
    });
  });

  it("places rows across the box and values up its height", () => {
    expect(ribbonX(0, 11)).toBe(-RIBBON_W / 2);
    expect(ribbonX(10, 11)).toBe(RIBBON_W / 2);
    expect(ribbonY(10, 10, 20)).toBe(0);
    expect(ribbonY(20, 10, 20)).toBe(RIBBON_H);
  });

  it("finds the session under the pointer", () => {
    expect(nearestIndex([10, 50, 90], 62)).toBe(1);
    expect(nearestIndex([], 5)).toBe(-1);
  });

  it("spreads date labels with both ends", () => {
    expect(labelIndices(63)).toEqual([0, 12, 25, 37, 50, 62]);
    expect(labelIndices(3)).toEqual([0, 1, 2]);
  });

  it("backs off further on a narrow box", () => {
    expect(ribbonCameraDistance(30, 0.8, 0.58)).toBeGreaterThan(
      ribbonCameraDistance(30, 3, 1) * 0.9,
    );
  });
});
