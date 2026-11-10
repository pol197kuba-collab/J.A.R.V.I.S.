import { describe, expect, it } from "vitest";
import {
  agentDots,
  agentsLine,
  commuteLine,
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

describe("commute line", () => {
  it("says where, how long and (only when it matters) how much worse", () => {
    expect(commuteLine({ direction: "to", durationMin: 31, delayMin: 4 })).toBe(
      "Praca: 31 min, +4",
    );
    expect(commuteLine({ direction: "back", durationMin: 28, delayMin: 1 })).toBe("Dom: 28 min");
    expect(commuteLine({ direction: "to", durationMin: 27, delayMin: null })).toBe("Praca: 27 min");
    expect(commuteLine(null)).toBeNull();
  });

  it("owns the line on its module and on the home page, with a fallback", () => {
    const dots = agentDots([]);
    expect(dockLine("/situation-room", { commute: "Praca: 31 min", openTasks: 2, dots })).toBe(
      "Praca: 31 min",
    );
    expect(dockLine("/", { commute: null, openTasks: 2, dots })).toBe("2 otwarte zadania");
  });
});
