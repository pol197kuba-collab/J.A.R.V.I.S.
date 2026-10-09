import { describe, expect, it } from "vitest";
import { DOG_BED, DOG_SIDE, DOG_SIT, DOG_SLEEP } from "./townDog";
import { MAX_HEARTS, applyAction, freshMood, settle } from "./dogMood";
import { buildTownMap } from "./townMap";

const HOUR = 60 * 60 * 1000;
const t0 = new Date(2026, 9, 9, 9, 0, 0).getTime();

describe("spaniel sprites", () => {
  it("are 16×12 pixel grids in every pose", () => {
    for (const rows of [DOG_SIDE, DOG_SIT, DOG_SLEEP]) {
      expect(rows).toHaveLength(12);
      for (const r of rows) expect(r).toHaveLength(16);
    }
  });
  it("wears the collar tag on the sitting sprite", () => {
    expect(DOG_SIT.join("")).toContain("t");
  });
  it("has its bed on a walkable tile of your terminal room", () => {
    const map = buildTownMap();
    expect(map.blocked[DOG_BED[1]][DOG_BED[0]]).toBe(false);
    expect(map.roomOf[DOG_BED[1]][DOG_BED[0]]).toBe("user");
  });
});

describe("dog mood", () => {
  it("gains hearts from attention, capped at the maximum", () => {
    let m = freshMood(t0);
    for (let i = 0; i < 10; i++) m = applyAction(m, "pet", t0);
    expect(m.hearts).toBe(MAX_HEARTS);
    expect(m.pets).toBe(10);
  });
  it("loses a heart every six hours without attention, but never drops below one", () => {
    const m = { ...freshMood(t0), hearts: 3 };
    expect(settle(m, t0 + 6 * HOUR).hearts).toBeCloseTo(2);
    expect(settle(m, t0 + 60 * HOUR).hearts).toBe(1);
  });
  it("resets today's counters on a new day but keeps the mood", () => {
    const m = applyAction(applyAction(freshMood(t0), "fetch", t0), "treat", t0);
    expect(m.fetches).toBe(1);
    const tomorrow = settle(m, t0 + 20 * HOUR);
    expect(tomorrow.fetches).toBe(0);
    expect(tomorrow.treats).toBe(0);
    expect(tomorrow.hearts).toBeGreaterThan(0);
  });
});
