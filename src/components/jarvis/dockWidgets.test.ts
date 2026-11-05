import { describe, expect, it } from "vitest";
import {
  agentDots,
  agentsLine,
  dockLine,
  fundLine,
  plural,
  reactorState,
  tasksLine,
} from "./dockWidgets";

const row = (slug: string, status: string, isEnabled = true) => ({
  slug,
  name: slug,
  status,
  isEnabled,
});

describe("dock widgets", () => {
  it("dots skip the core and disabled agents", () => {
    const d = agentDots([
      row("jarvis", "busy"),
      row("metric", "busy"),
      row("shield", "idle", false),
      row("herald", "error"),
    ]);
    expect(d.map((x) => [x.slug, x.state])).toEqual([
      ["metric", "busy"],
      ["herald", "error"],
    ]);
    expect(reactorState(d)).toBe("error");
    expect(reactorState(d.slice(0, 1))).toBe("busy");
    expect(reactorState([])).toBe("idle");
  });

  it("Polish plurals", () => {
    expect([1, 2, 4, 5, 12, 22, 25].map((n) => plural(n, "a", "b", "c"))).toEqual([
      "a",
      "b",
      "b",
      "c",
      "c",
      "b",
      "c",
    ]);
    expect(tasksLine(0)).toBe("brak otwartych zadań");
    expect(tasksLine(3)).toBe("3 otwarte zadania");
    expect(tasksLine(5)).toBe("5 otwartych zadań");
    expect(tasksLine(undefined)).toBeNull();
  });

  it("fund line is signed and Polish-formatted", () => {
    expect(fundLine(0.4213)).toBe("fundusz +0,42% dziś");
    expect(fundLine(-1.5)).toBe("fundusz -1,50% dziś");
    expect(fundLine(null)).toBeNull();
  });

  it("picks the module's own number, then falls back", () => {
    const dots = agentDots([row("metric", "busy")]);
    expect(dockLine("/rynki", { fundDayPct: 1, openTasks: 2, dots })).toBe("fundusz +1,00% dziś");
    expect(dockLine("/rynki", { fundDayPct: null, openTasks: 2, dots })).toBe("2 otwarte zadania");
    expect(dockLine("/jarvis", { openTasks: 2, dots })).toBe("1 agent pracuje");
    expect(dockLine("/notes", { openTasks: null, dots: [] })).toBeNull();
    expect(agentsLine(agentDots([row("metric", "idle")]))).toBe("agenci w gotowości");
  });
});
