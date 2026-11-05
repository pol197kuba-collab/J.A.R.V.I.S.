import { describe, expect, it } from "vitest";
import {
  MENU_FOV,
  MENU_SWITCH_OUT_MS,
  dragToSpin,
  frontIndex,
  menuCameraDistance,
  menuOpenK,
  menuSlotAngle,
  menuSwitchDone,
  menuSwitchK,
  snapSpin,
  spinToFront,
  stepSpin,
} from "./orbitMenuMath";

describe("orbit menu slots", () => {
  it("puts node 0 at the front (+z) without spin", () => {
    const a = menuSlotAngle(0, 4, 0);
    expect(Math.cos(a)).toBeCloseTo(0);
    expect(Math.sin(a)).toBeCloseTo(1);
  });

  it("spinToFront brings any node to the front", () => {
    for (const n of [3, 4, 5, 7]) {
      for (let i = 0; i < n; i++) {
        const a = menuSlotAngle(i, n, spinToFront(i, n));
        expect(Math.sin(a)).toBeCloseTo(1);
        expect(frontIndex(spinToFront(i, n), n)).toBe(i);
      }
    }
  });

  it("snaps to the nearest slot and wraps the front index", () => {
    const step = (Math.PI * 2) / 4;
    expect(snapSpin(step * 0.4, 4)).toBeCloseTo(0);
    expect(snapSpin(step * 0.6, 4)).toBeCloseTo(step);
    expect(frontIndex(-step, 4)).toBe(3);
    expect(frontIndex(step * 5, 4)).toBe(1);
  });

  it("dragging right turns the front node to the right (spin decreases)", () => {
    expect(dragToSpin(100, 400)).toBeLessThan(0);
    expect(dragToSpin(400, 400)).toBeCloseTo(-Math.PI);
  });
});

describe("orbit menu camera", () => {
  it("backs off further on a narrow phone than on a wide screen", () => {
    const phone = menuCameraDistance(200, MENU_FOV, 0.46);
    const wide = menuCameraDistance(200, MENU_FOV, 1.8);
    expect(phone).toBeGreaterThan(wide);
  });

  it("keeps the orbit inside the frame horizontally", () => {
    const aspect = 0.46;
    const d = menuCameraDistance(200, MENU_FOV, aspect);
    const tanH = Math.tan((MENU_FOV * Math.PI) / 360) * aspect;
    expect(200 / d).toBeLessThan(tanH);
  });
});

describe("orbit menu timing", () => {
  it("staggers the burst-out", () => {
    expect(menuOpenK(200, 0)).toBeGreaterThan(menuOpenK(200, 3));
    expect(menuOpenK(2000, 6)).toBe(1);
  });

  it("level switch falls in, then bursts out", () => {
    expect(menuSwitchK(0, 0)).toEqual({ k: 1, incoming: false });
    expect(menuSwitchK(MENU_SWITCH_OUT_MS - 1, 0).k).toBeLessThan(0.05);
    expect(menuSwitchK(MENU_SWITCH_OUT_MS, 0).incoming).toBe(true);
    expect(menuSwitchDone(5000, 7)).toBe(true);
    expect(menuSwitchDone(MENU_SWITCH_OUT_MS, 3)).toBe(false);
  });

  it("inertia settles exactly on a slot", () => {
    let s = { spin: 0.3, vel: 3 };
    for (let i = 0; i < 300; i++) s = stepSpin(s.spin, s.vel, 5, 1 / 60);
    expect(s.vel).toBe(0);
    expect(s.spin).toBeCloseTo(snapSpin(s.spin, 5), 6);
  });
});
