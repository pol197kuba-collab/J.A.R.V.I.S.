import { describe, expect, it } from "vitest";
import {
  JARVIS_CORE,
  LANDING_AGENTS,
  LANDING_AGENT_TOTAL,
  landingIntroAgents,
  landingModules,
} from "./landingData";

describe("landing data", () => {
  it("five teammates plus the core = 6 stops/orbits, as in the prototype tables", () => {
    expect(LANDING_AGENTS).toHaveLength(5);
    expect(LANDING_AGENT_TOTAL).toBe(6);
    expect(JARVIS_CORE.name).toBe("J.A.R.V.I.S.");
  });
  it("agent slugs come from the app constants and are unique", () => {
    const slugs = LANDING_AGENTS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(5);
    expect(slugs).toContain("shield");
    expect(slugs).not.toContain("jarvis");
  });
  it("intro agents are idle (no live data before login)", () => {
    expect(landingIntroAgents().every((a) => !a.busy)).toBe(true);
  });
  it("tunnel modules are the repo's modules.ts titles, in repo order", () => {
    const m = landingModules().map((x) => x.title);
    expect(m).toEqual([
      "Dashboard",
      "Feed",
      "Mózg",
      "Agent Town",
      "Wydatki",
      "Paliwa",
      "Rynki",
      "Vision",
      "Zadania",
      "Notatki",
      "Dokumenty",
      "Situation Room",
    ]);
    expect(landingModules().every((x) => x.sub.length > 5)).toBe(true);
  });
});
