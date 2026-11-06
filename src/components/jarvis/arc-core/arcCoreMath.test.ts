import { describe, expect, it } from "vitest";
import {
  CORE_FOG,
  CORE_LIGHT_DEMO,
  S,
  U,
  beadAngle,
  coreCamera,
  corePulse,
  formatBusy,
  lightToApp,
  nodeStatus,
  resolveLabels,
  orbitLimits,
  packetT,
  statusLine,
} from "./arcCoreMath";

describe("units: demo world → app (×0.01)", () => {
  it("MATRIX_SCALE is the demo's SCALE 72 × 0.01", () => {
    expect(S).toBeCloseTo(72 * U);
  });
  it("light: distance ×.01, intensity × .01^decay (same illumination at scaled distances)", () => {
    const l = lightToApp(CORE_LIGHT_DEMO);
    expect(l.distance).toBeCloseTo(14);
    expect(l.decay).toBe(1.7);
    expect(l.intensity).toBeCloseTo(70000 * Math.pow(0.01, 1.7));
    expect(l.intensity).toBeGreaterThan(27);
    expect(l.intensity).toBeLessThan(29);
    // falloff check: demo at distance d_demo vs app at d_demo·U give equal illuminance
    const dDemo = 360;
    const demo = CORE_LIGHT_DEMO.intensity / Math.pow(dDemo, 1.7);
    const app = l.intensity / Math.pow(dDemo * U, 1.7);
    expect(app / demo).toBeCloseTo(1);
  });
  it("fog scales with the rest", () => {
    expect(CORE_FOG).toEqual({ near: 15, far: 32 });
  });
});

describe("camera", () => {
  it("wide canvas: coreCam (0, 2.7·S, 9.8·S)", () => {
    const c = coreCamera(2.6);
    expect(c.y).toBeCloseTo(2.7 * S);
    expect(c.z).toBeCloseTo(9.8 * S);
  });
  it("tall canvas pulls back, capped at 2.5x", () => {
    expect(coreCamera(0.46).z / coreCamera(2.6).z).toBeCloseTo(2.5);
    expect(coreCamera(1).z).toBeGreaterThan(coreCamera(2.6).z);
  });
  it("orbit limits are proportional to the composition", () => {
    const o = orbitLimits(2.6);
    expect(o.min).toBeCloseTo(5 * S);
    expect(o.max).toBeGreaterThanOrEqual(14 * S);
    expect(orbitLimits(0.46).max).toBeGreaterThan(o.max);
  });
});

describe("agent status", () => {
  it("disabled beats busy/error", () => {
    expect(nodeStatus({ isEnabled: false, status: "busy" })).toBe("disabled");
    expect(nodeStatus({ isEnabled: true, status: "busy" })).toBe("busy");
    expect(nodeStatus({ isEnabled: true, status: "error" })).toBe("error");
    expect(nodeStatus({ isEnabled: true, status: "idle" })).toBe("idle");
    expect(nodeStatus({ isEnabled: true, status: "whatever" })).toBe("idle");
  });
  it("label lines", () => {
    expect(formatBusy(41)).toBe("00:41");
    expect(formatBusy(125)).toBe("02:05");
    expect(formatBusy(-3)).toBe("00:00");
    expect(statusLine("busy", 23)).toBe("● BUSY 00:23");
    expect(statusLine("idle", 0)).toBe("● IDLE");
    expect(statusLine("error", 0)).toBe("● ERROR");
    expect(statusLine("disabled", 0)).toBe("● OFFLINE");
  });
});

describe("animation curves shared with the demo", () => {
  it("core pulse ±3 %", () => {
    expect(corePulse(0)).toBe(1);
    expect(
      Math.max(...Array.from({ length: 200 }, (_, i) => corePulse(i / 20))),
    ).toBeLessThanOrEqual(1.03);
  });
  it("beads orbit in alternating directions", () => {
    expect(beadAngle(0, 1)).toBeCloseTo(0.7);
    expect(beadAngle(1, 1)).toBeCloseTo(-0.9 + 2);
  });
  it("packets run faster on busy agents and stay within 0..1", () => {
    for (let t = 0; t < 10; t += 0.37) {
      expect(packetT(t, true, 1, 3, 2)).toBeGreaterThanOrEqual(0);
      expect(packetT(t, true, 1, 3, 2)).toBeLessThan(1);
    }
    expect(packetT(1, true, 0, 3, 0)).toBeCloseTo(0.55);
    expect(packetT(1, false, 0, 3, 0)).toBeCloseTo(0.22);
  });
});

describe("resolveLabels", () => {
  const box = (id: string, left: number, top: number, depth: number) => ({
    id,
    left,
    top,
    w: 120,
    h: 40,
    depth,
  });

  it("leaves labels that don't touch alone", () => {
    const r = resolveLabels([box("a", 0, 0, 0.1), box("b", 300, 0, 0.2)]);
    expect(r.get("a")).toEqual({ dy: 0, dim: false });
    expect(r.get("b")).toEqual({ dy: 0, dim: false });
  });

  it("the nearer label keeps its spot, the farther one slides the shorter way", () => {
    // b is nearer (depth 0.1); a overlaps it from slightly below
    const r = resolveLabels([box("a", 10, 10, 0.5), box("b", 0, 0, 0.1)]);
    expect(r.get("b")).toEqual({ dy: 0, dim: false });
    expect(r.get("a")).toEqual({ dy: 34, dim: false }); // below b: 0 + 40 + 4 − 10
  });

  it("dims a label when there is no free spot within the shift limit", () => {
    const r = resolveLabels(
      [
        box("near", 0, 0, 0.1),
        box("above", 0, -44, 0.2),
        box("below", 0, 44, 0.3),
        box("far", 0, 5, 0.9),
      ],
      4,
      60,
    );
    expect(r.get("far")).toEqual({ dy: 0, dim: true });
    expect(r.get("near")?.dim).toBe(false);
  });

  it("keeps a label on the side it already took", () => {
    const boxes = [box("a", 10, 20, 0.5), box("b", 0, 0, 0.1)];
    // without history: below b (+24 beats −64)
    expect(resolveLabels(boxes).get("a")?.dy).toBe(24);
    // it went above last frame: stays above
    expect(resolveLabels(boxes, 4, 90, new Map([["a", -60]])).get("a")?.dy).toBe(-64);
  });
});
