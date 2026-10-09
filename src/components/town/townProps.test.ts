import { describe, expect, it } from "vitest";
import type { FlowRun } from "@/lib/agents/flow.functions";
import { BOARD_SPOTS, HOME, buildTownMap, findPath, type Tile } from "./townMap";
import { PROPS, propAt, propById } from "./townProps";
import { dailyStats, markerSpeed, plural, zoneWidth } from "./townPropActions";

const map = buildTownMap();
const key = (t: Tile) => `${t[0]},${t[1]}`;

describe("town props", () => {
  it("can be used from walkable tiles you can reach from home", () => {
    for (const p of PROPS)
      for (const t of p.stand) {
        expect(map.blocked[t[1]][t[0]], `${p.id} @ ${key(t)}`).toBe(false);
        const same = key(t) === key(HOME.user);
        expect(same || findPath(map.blocked, HOME.user, t).length > 0, p.id).toBe(true);
      }
  });

  it("never share a stand tile with another prop or the board", () => {
    const seen = new Set(BOARD_SPOTS.map(key));
    for (const p of PROPS)
      for (const t of p.stand) {
        expect(seen.has(key(t)), `${p.id} @ ${key(t)}`).toBe(false);
        seen.add(key(t));
      }
  });

  it("looks props up by tile and id", () => {
    expect(propAt(27, 24)?.kind).toBe("coffee");
    expect(propAt(0, 0)).toBeNull();
    expect(propById("arcade")?.prompt).toBe("Graj");
    expect(new Set(PROPS.map((p) => p.id)).size).toBe(PROPS.length);
  });
});

describe("plural", () => {
  it("follows Polish rules", () => {
    const f = (n: number) => plural(n, "przebieg", "przebiegi", "przebiegów");
    expect([0, 1, 2, 4, 5, 12, 14, 22, 25, 112].map(f)).toEqual([
      "przebiegów",
      "przebieg",
      "przebiegi",
      "przebiegi",
      "przebiegów",
      "przebiegów",
      "przebiegów",
      "przebiegi",
      "przebiegów",
      "przebiegów",
    ]);
  });
});

describe("dailyStats", () => {
  const now = Date.parse("2026-10-09T15:00:00");
  const run = (slug: string, created: string, finished: string | null, status = "done") =>
    ({
      agentSlug: slug,
      status,
      createdAt: new Date(Date.parse(created)).toISOString(),
      finishedAt: finished ? new Date(Date.parse(finished)).toISOString() : null,
    }) as FlowRun;
  const name = (s: string) => s.toUpperCase();

  it("says so when nothing ran today", () => {
    expect(dailyStats([run("jarvis", "2026-10-08T10:00:00", null)], now, name)).toMatch(
      /żadnych przebiegów/,
    );
  });

  it("counts today's runs, errors, the busiest agent and the average time", () => {
    const text = dailyStats(
      [
        run("jarvis", "2026-10-09T10:00:00", "2026-10-09T10:00:10"),
        run("jarvis", "2026-10-09T11:00:00", "2026-10-09T11:00:20", "error"),
        run("insight", "2026-10-09T12:00:00", null),
        run("insight", "2026-10-08T12:00:00", "2026-10-08T12:00:30"),
      ],
      now,
      name,
    );
    expect(text).toContain("3 przebiegi, 1 błąd");
    expect(text).toContain("Najaktywniejszy: JARVIS (2)");
    expect(text).toContain("Średni czas zadania: 15 s");
  });
});

describe("Złap buga difficulty", () => {
  it("narrows the target and speeds up, with a floor on the width", () => {
    expect(zoneWidth(1)).toBeLessThan(zoneWidth(0));
    expect(markerSpeed(1)).toBeGreaterThan(markerSpeed(0));
    expect(zoneWidth(100)).toBe(0.08);
  });
});
