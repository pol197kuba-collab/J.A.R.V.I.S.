import { describe, expect, it } from "vitest";
import { BLIP_BASE, MAX_BLIPS, blipPlan } from "./townBlips";

describe("blipPlan", () => {
  it("is deterministic and plays a blip per letter, resting on spaces", () => {
    const a = blipPlan("Biorę zadanie", "jarvis");
    expect(blipPlan("Biorę zadanie", "jarvis")).toEqual(a);
    expect(a.length).toBe(12); // letters only
    const times = a.map((b) => b.at);
    expect(times).toEqual([...times].sort((x, y) => x - y));
    // the gap across the space is shorter than a full letter slot would be twice
    expect(times[5] - times[4]).toBeGreaterThan(times[1] - times[0]);
  });

  it("keeps every blip within an octave of the character's own pitch", () => {
    for (const b of blipPlan("Sprawdzam logi systemu", "forge")) {
      expect(b.freq).toBeGreaterThanOrEqual(BLIP_BASE.forge);
      expect(b.freq).toBeLessThan(BLIP_BASE.forge * 2);
    }
  });

  it("gives characters different voices and never chatters on a long answer", () => {
    expect(blipPlan("Gotowe", "herald")[0].freq).not.toBe(blipPlan("Gotowe", "forge")[0].freq);
    expect(blipPlan("x".repeat(400), "jarvis")).toHaveLength(MAX_BLIPS);
    expect(blipPlan("… ?!", "user")).toEqual([]);
  });
});
