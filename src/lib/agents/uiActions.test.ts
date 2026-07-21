import { describe, it, expect } from "vitest";
import { UI_ACTIONS, UI_ACTION_CONFIRMATIONS } from "./runtime.server";
import { JARVIS_ACTIONS } from "@/lib/ai/jarvisBrain";

// The UI-action vocabulary lives in two places by design: the JarvisAction
// union (client: voice + chat + fallback path) and UI_ACTIONS (server:
// perform_ui_action tool). They drifted twice already (PRs #43/#44 —
// system_check shadowing the Guardian agent), so this test turns any future
// drift into a red build instead of a live incident.
describe("UI action vocabulary sync", () => {
  it("UI_ACTIONS + 'none' is exactly the JarvisAction vocabulary", () => {
    const server = new Set<string>([...UI_ACTIONS, "none"]);
    const client = new Set<string>(JARVIS_ACTIONS);
    expect([...server].sort()).toEqual([...client].sort());
  });

  it("UI_ACTIONS contains no duplicates and no 'none' (it has a dedicated escape hatch)", () => {
    expect(new Set(UI_ACTIONS).size).toBe(UI_ACTIONS.length);
    expect(UI_ACTIONS).not.toContain("none");
  });

  it("every UI action has a non-empty Polish confirmation line", () => {
    expect(Object.keys(UI_ACTION_CONFIRMATIONS).sort()).toEqual([...UI_ACTIONS].sort());
    for (const action of UI_ACTIONS) {
      expect(UI_ACTION_CONFIRMATIONS[action].trim().length, action).toBeGreaterThan(0);
    }
  });
});
