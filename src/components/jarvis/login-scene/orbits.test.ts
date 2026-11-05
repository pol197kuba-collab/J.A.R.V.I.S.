import { describe, expect, it } from "vitest";
import {
  ORBIT_R,
  ORBIT_SPD,
  ORBIT_TILT,
  orbitAngle,
  orbitAt,
  orbitSpec,
  ringPosition,
} from "./orbits";

describe("orbitSpec (core2.js)", () => {
  it("tables have 6 entries, as in the prototype", () => {
    expect([ORBIT_R.length, ORBIT_TILT.length, ORBIT_SPD.length]).toEqual([6, 6, 6]);
  });
  it("scales the radius with the world scale (72 demo units = 0.72 app units)", () => {
    expect(orbitSpec(0, 5, 72).r).toBeCloseTo(3.2 * 72);
    expect(orbitSpec(0, 5, 0.72).r).toBeCloseTo(3.2 * 0.72);
    expect(orbitSpec(1, 5, 72).r / orbitSpec(1, 5, 0.72).r).toBeCloseTo(100);
  });
  it("agents are spread evenly, the first at the top (−π/2)", () => {
    expect(orbitSpec(0, 5, 1).a0).toBeCloseTo(-Math.PI / 2);
    expect(orbitSpec(1, 5, 1).a0 - orbitSpec(0, 5, 1).a0).toBeCloseTo((2 * Math.PI) / 5);
  });
  it("cycles after 6 agents: the 7th reuses the 1st orbit shape", () => {
    const a = orbitSpec(0, 8, 72);
    const g = orbitSpec(6, 8, 72);
    expect([g.r, g.tilt, g.w]).toEqual([a.r, a.tilt, a.w]);
    expect(g.a0).not.toBe(a.a0);
  });
});

describe("orbitAt", () => {
  it("stays on a circle of radius r, tilted about the x axis", () => {
    const s = orbitSpec(4, 5, 72);
    for (let k = 0; k < 20; k++) {
      const p = orbitAt(s, (k / 20) * Math.PI * 2, { x: 0, y: 0, z: 0 });
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(s.r);
    }
  });
  it("a zero-tilt orbit is flat", () => {
    const s = { r: 100, tilt: 0, w: 0, a0: 0 };
    expect(orbitAt(s, 1.2, { x: 0, y: 0, z: 0 }).y).toBeCloseTo(0);
  });
  it("reuses the output object", () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(orbitAt(orbitSpec(0, 5, 1), 0, out)).toBe(out);
  });
  it("angle advances with w·t, frozen when reduced", () => {
    const s = orbitSpec(1, 5, 1);
    expect(orbitAngle(s, 2)).toBeCloseTo(s.a0 + s.w * 2);
    expect(orbitAngle(s, 2, true)).toBe(s.a0);
  });
});

describe("ringPosition (landing resting ring)", () => {
  it("radius steps with agent count and alternates height", () => {
    const four = ringPosition(0, 4, 72);
    const six = ringPosition(0, 6, 72);
    const eight = ringPosition(0, 8, 72);
    expect(Math.hypot(four.x, four.z)).toBeCloseTo(2.6 * 72);
    expect(Math.hypot(six.x, six.z)).toBeCloseTo(3.0 * 72);
    expect(Math.hypot(eight.x, eight.z)).toBeCloseTo(3.4 * 72);
    expect(ringPosition(1, 5, 72).y).toBeLessThan(0);
    expect(ringPosition(0, 5, 72).y).toBeGreaterThan(0);
  });
});
