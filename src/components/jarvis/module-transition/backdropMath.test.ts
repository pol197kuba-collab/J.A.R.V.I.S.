import { describe, expect, it } from "vitest";
import {
  BACKDROP_OPACITY,
  approachAngle,
  backdropAzimuth,
  backdropCamera,
  backdropFade,
  backdropSeed,
  backdropShift,
  hasBackdrop,
  tiltFromOrientation,
} from "./backdropMath";

const base = { az: 0, time: 0, scrollPx: 0, viewportH: 900, aspect: 0.46, tiltX: 0, tiltY: 0 };

describe("module backdrop", () => {
  it("skips routes with their own canvas", () => {
    expect(hasBackdrop("/jarvis")).toBe(false);
    expect(hasBackdrop("/mozg")).toBe(false);
    expect(hasBackdrop("/town")).toBe(false);
    expect(hasBackdrop("/rynki")).toBe(true);
    expect(hasBackdrop("/agent-hub/forge")).toBe(true);
  });

  it("gives every module its own angle, sub-routes the parent's", () => {
    expect(backdropSeed("/agent-hub/forge")).toBe(backdropSeed("/agent-hub"));
    const a = backdropAzimuth(backdropSeed("/rynki"));
    const b = backdropAzimuth(backdropSeed("/paliwa"));
    expect(Math.abs(Math.sin((a - b) / 2))).toBeGreaterThan(0.3);
  });

  it("keeps the core above the screen centre and lifts it with the scroll", () => {
    const top = backdropCamera(base);
    const down = backdropCamera({ ...base, scrollPx: 2700 });
    expect(top.look.y).toBeLessThan(0);
    expect(down.look.y).toBeLessThan(top.look.y);
    // capped: very long pages don't throw the core off screen
    const far = backdropCamera({ ...base, scrollPx: 1e6 });
    expect(top.look.y - far.look.y).toBeLessThanOrEqual(170);
  });

  it("tilt swings the view only a few degrees", () => {
    const a = backdropCamera(base).cam;
    const b = backdropCamera({ ...base, tiltX: 1 }).cam;
    const angle = Math.acos(
      (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)),
    );
    expect(angle).toBeGreaterThan(0.05);
    expect(angle).toBeLessThan(0.25);
  });

  it("turns the short way round and fades back in", () => {
    const next = approachAngle(0.1, Math.PI * 2 - 0.1, 0.1);
    expect(next).toBeLessThan(0.1);
    expect(backdropFade(0)).toBe(0);
    expect(backdropFade(5000)).toBeCloseTo(BACKDROP_OPACITY);
  });

  it("keeps the core centred and shifts the frame onto the content area", () => {
    expect(backdropCamera({ ...base, aspect: 1.8 }).look.x).toBe(0);
    expect(backdropShift(1440, { left: 280, width: 1160 })).toBe(140);
    expect(backdropShift(1440, null)).toBe(0);
  });

  it("reads the phone tilt around the usual holding angle", () => {
    expect(tiltFromOrientation(50, 0)).toEqual({ x: 0, y: 0 });
    expect(tiltFromOrientation(140, 90)).toEqual({ x: 1, y: 1 });
    expect(tiltFromOrientation(null, null)).toEqual({ x: 0, y: 0 });
  });
});
