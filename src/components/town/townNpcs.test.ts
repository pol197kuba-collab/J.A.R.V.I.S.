import { describe, expect, it } from "vitest";
import { buildTownMap, findPath } from "./townMap";
import {
  NPCS,
  PIT_CENTER,
  TRADER_SPOTS,
  pickWeighted,
  roomSpots,
  taskMs,
  traderShout,
  traderTask,
  workerTask,
} from "./townNpcs";
import type { TownFund } from "./townFund";

const map = buildTownMap();
const free = ([x, y]: readonly [number, number]) => !map.blocked[y][x];

describe("extras on the map", () => {
  it("everyone starts on a walkable tile inside their own room", () => {
    for (const n of NPCS) {
      expect(free(n.home), n.id).toBe(true);
      expect(map.roomOf[n.home[1]][n.home[0]], n.id).toBe(n.room);
    }
  });

  it("builders can reach every free tile and the wall row of their room", () => {
    for (const n of NPCS.filter((x) => x.kind === "worker")) {
      const { free: tiles, wall } = roomSpots(map, n.room);
      expect(tiles.length, n.room).toBeGreaterThan(10);
      expect(wall.length, n.room).toBeGreaterThan(2);
      for (const t of [...wall, tiles[0], tiles[tiles.length - 1]]) {
        const ok =
          (t[0] === n.home[0] && t[1] === n.home[1]) || findPath(map.blocked, n.home, t).length > 0;
        expect(ok, `${n.id}→${t}`).toBe(true);
      }
    }
  });

  it("traders' spots are on the trading floor and reachable", () => {
    const spots = [...TRADER_SPOTS.desk, ...TRADER_SPOTS.pit, ...TRADER_SPOTS.screen];
    for (const t of spots) {
      expect(free(t), String(t)).toBe(true);
      expect(map.roomOf[t[1]][t[0]]).toBe("exchange");
      const from = NPCS.find((n) => n.kind === "trader")!.home;
      const same = from[0] === t[0] && from[1] === t[1];
      expect(same || findPath(map.blocked, from, t).length > 0, String(t)).toBe(true);
    }
    expect(map.blocked[PIT_CENTER[1]][PIT_CENTER[0]]).toBe(true); // the statue
  });
});

describe("what they do", () => {
  it("weighted picks cover every task and respect the edges", () => {
    expect(
      pickWeighted(
        [
          ["a", 1],
          ["b", 3],
        ] as const,
        0,
      ),
    ).toBe("a");
    expect(
      pickWeighted(
        [
          ["a", 1],
          ["b", 3],
        ] as const,
        0.3,
      ),
    ).toBe("b");
    expect(
      pickWeighted(
        [
          ["a", 1],
          ["b", 3],
        ] as const,
        1,
      ),
    ).toBe("b");
    const seen = new Set(Array.from({ length: 100 }, (_, i) => workerTask(i / 100)));
    expect(seen).toEqual(new Set(["hammer", "drill", "paint", "carry", "measure", "break"]));
    expect(new Set(Array.from({ length: 50 }, (_, i) => traderTask(i / 50)))).toEqual(
      new Set(["desk", "pit", "screen"]),
    );
  });

  it("task lengths stay in range", () => {
    expect(taskMs("desk", 0)).toBe(4000);
    expect(taskMs("desk", 1)).toBe(9000);
    expect(taskMs("hammer", 0.5)).toBeGreaterThan(2600);
  });

  it("traders shout only real ticker lines", () => {
    const fund = {
      ticker: [
        { text: "FUNDUSZ J.A.R.V.I.S.", sign: 0 },
        { text: "AI +2,50%", sign: 1 },
        { text: "SYGN -1,00%", sign: -1 },
      ],
    } as unknown as TownFund;
    expect(traderShout(fund, 0)).toEqual({ text: "AI +2,50%!", tone: "ok" });
    expect(traderShout(fund, 0.99)).toEqual({ text: "SYGN -1,00%!", tone: "bad" });
    expect(traderShout(null, 0.2).tone).toBe("plain");
  });
});
