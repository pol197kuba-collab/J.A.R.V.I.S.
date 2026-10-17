import { describe, expect, it } from "vitest";
import { hashUnit, nodeDegrees, planetLooks } from "./planets";

const tables = [
  { name: "notes", rows: 64 },
  { name: "agent_runs", rows: 900 },
  { name: "memories", rows: 10 },
  { name: "fuel_prices", rows: 300 },
  { name: "tasks", rows: 0 },
  { name: "user_secrets", rows: 1 },
  { name: "brain_points", rows: 74 },
  { name: "projects", rows: 2 },
  { name: "documents", rows: 0 },
  { name: "system_events", rows: 120 },
];

describe("hashUnit", () => {
  it("is stable, in [0,1) and salt-dependent", () => {
    expect(hashUnit("notes")).toBe(hashUnit("notes"));
    expect(hashUnit("notes")).not.toBe(hashUnit("notes", 1));
    for (const t of tables) {
      const u = hashUnit(t.name);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});

describe("planetLooks", () => {
  const degree = nodeDegrees(tables.length, [
    [0, 6],
    [2, 6],
    [8, 6],
    [1, 7],
    [4, 7],
    [9, 7],
  ]);
  const looks = planetLooks(tables, degree);

  it("is deterministic", () => {
    expect(planetLooks(tables, degree)).toEqual(looks);
  });

  it("makes the biggest table the terran home world and the next ones giants", () => {
    expect(looks[1].kind).toBe("terran");
    expect(looks[3].kind).toBe("gas"); // 300 wierszy
    expect(looks[9].kind).toBe("gas"); // 120 wierszy
    expect(looks.filter((l) => l.kind === "gas")).toHaveLength(2);
  });

  it("puts rings only on the best-connected non-terran nodes", () => {
    const ringed = looks.flatMap((l, i) => (l.ringTilt === null ? [] : [i]));
    expect(ringed).toEqual([6, 7]);
    for (const i of ringed) expect(Math.abs(looks[i].ringTilt!)).toBeLessThanOrEqual(0.45);
  });

  it("has no terran world when every table is empty", () => {
    const empty = planetLooks(
      tables.map((t) => ({ ...t, rows: 0 })),
      degree,
    );
    expect(empty.some((l) => l.kind === "terran")).toBe(false);
  });

  it("gives each look a 3-color palette and a seed", () => {
    for (const l of looks) {
      expect(l.colors).toHaveLength(3);
      for (const c of l.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(l.seed).toBeGreaterThanOrEqual(0);
      expect(l.seed).toBeLessThan(1);
    }
  });
});

describe("nodeDegrees", () => {
  it("counts both ends and ignores self-loops", () => {
    expect(
      nodeDegrees(3, [
        [0, 1],
        [1, 2],
        [2, 2],
      ]),
    ).toEqual([1, 2, 1]);
  });
});
