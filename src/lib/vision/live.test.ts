import { describe, expect, it } from "vitest";
import {
  MAX_DETECTIONS,
  coverRect,
  cropRect,
  frameDiff,
  normalizeDetections,
  toGrey,
} from "./live";

describe("normalizeDetections", () => {
  it("turns Gemini's 0–1000 [ymin,xmin,ymax,xmax] into normalised boxes, biggest first", () => {
    const d = normalizeDetections([
      { label: "kubek", box_2d: [100, 200, 300, 400] },
      { label: "  laptop ", box_2d: [0, 0, 600, 800] },
    ]);
    expect(d[0]).toEqual({ label: "laptop", x: 0, y: 0, w: 0.8, h: 0.6 });
    expect(d[1]).toMatchObject({ label: "kubek", x: 0.2, y: 0.1 });
    expect(d[1].w).toBeCloseTo(0.2);
  });

  it("drops junk, tiny and unlabeled boxes, accepts {objects:[…]} and caps the list", () => {
    expect(
      normalizeDetections({
        objects: [
          { label: "", box_2d: [0, 0, 500, 500] },
          { label: "kropka", box_2d: [10, 10, 15, 15] },
          { label: "x", box_2d: [0, 0, "a", 1] },
          { label: "odwrotnie", box_2d: [500, 500, 100, 100] },
        ],
      }),
    ).toEqual([{ label: "odwrotnie", x: 0.1, y: 0.1, w: 0.4, h: 0.4 }]);
    const many = Array.from({ length: 20 }, (_, i) => ({
      label: `o${i}`,
      box_2d: [0, 0, 100, 100],
    }));
    expect(normalizeDetections(many)).toHaveLength(MAX_DETECTIONS);
    expect(normalizeDetections("nope")).toEqual([]);
  });
});

describe("frame change", () => {
  it("measures how much the picture moved", () => {
    expect(frameDiff([10, 10, 10], [10, 10, 10])).toBe(0);
    expect(frameDiff([0, 0], [10, 30])).toBe(20);
    expect(frameDiff([1], [1, 2])).toBe(255);
  });
  it("greys RGBA pixels", () => {
    expect([...toGrey([255, 255, 255, 255, 0, 0, 0, 255])]).toEqual([255, 0]);
  });
});

describe("coverRect", () => {
  it("maps through object-fit: cover (landscape frame in a portrait view crops the sides)", () => {
    // 1600×900 frame in a 450×800 view: scale = 800/900, frame is 1422 wide,
    // offset −486 → the frame's centre column stays centred.
    const r = coverRect({ x: 0.45, y: 0.25, w: 0.1, h: 0.5 }, 1600, 900, 450, 800)!;
    expect(r.top).toBeCloseTo(200);
    expect(r.height).toBeCloseTo(400);
    expect(r.left + r.width / 2).toBeCloseTo(225, 0);
    expect(coverRect({ x: 0, y: 0, w: 0.1, h: 0.1 }, 1600, 900, 450, 800)).toBeNull();
  });
  it("is identity when aspect ratios match", () => {
    expect(coverRect({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 }, 400, 200, 800, 400)).toEqual({
      left: 400,
      top: 200,
      width: 200,
      height: 100,
    });
  });
});

describe("cropRect", () => {
  it("adds a margin and stays inside the frame", () => {
    expect(cropRect({ x: 0, y: 0.5, w: 0.5, h: 0.5 }, 1000, 1000)).toEqual({
      sx: 0,
      sy: 425,
      sw: 575,
      sh: 575,
    });
  });
});
