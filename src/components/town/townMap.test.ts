import { describe, expect, it } from "vitest";
import {
  BOARD_SPOTS,
  COFFEE_SPOT,
  HOME,
  MEETING_HEAD,
  MEETING_SEATS,
  VISIT,
  buildTownMap,
  findPath,
  roomArea,
  type Tile,
  type TownSlug,
} from "./townMap";

const map = buildTownMap();
const slugs = Object.keys(HOME) as TownSlug[];
const free = (t: Tile) => !map.blocked[t[1]][t[0]];

describe("town floor plan", () => {
  it("puts every named spot on a walkable tile", () => {
    const spots: [string, Tile][] = [
      ...slugs.map((s): [string, Tile] => [`home:${s}`, HOME[s]]),
      ...slugs.map((s): [string, Tile] => [`visit:${s}`, VISIT[s]]),
      ...BOARD_SPOTS.map((t, i): [string, Tile] => [`board:${i}`, t]),
      ["coffee", COFFEE_SPOT],
    ];
    for (const [name, t] of spots) expect(free(t), name).toBe(true);
  });

  it("connects every character's home to every room, the board and the coffee machine", () => {
    for (const from of slugs) {
      const targets = [...slugs.map((s) => VISIT[s]), ...BOARD_SPOTS, COFFEE_SPOT];
      for (const to of targets) {
        const path = findPath(map.blocked, HOME[from], to);
        const same = HOME[from][0] === to[0] && HOME[from][1] === to[1];
        expect(same || path.length > 0, `${from} → ${to}`).toBe(true);
      }
    }
  });

  it("returns 4-connected steps that end on the target and never cross a blocked tile", () => {
    const path = findPath(map.blocked, HOME.insight, HOME.herald);
    expect(path.at(-1)).toEqual(HOME.herald);
    let prev: Tile = HOME.insight;
    for (const step of path) {
      expect(Math.abs(step[0] - prev[0]) + Math.abs(step[1] - prev[1])).toBe(1);
      expect(free(step)).toBe(true);
      prev = step;
    }
  });

  it("returns no path into a wall", () => {
    expect(findPath(map.blocked, HOME.jarvis, [0, 0])).toEqual([]);
  });

  it("keeps each room's wander area inside the room", () => {
    for (const s of slugs) {
      const a = roomArea(s);
      expect(map.roomOf[a.y0][a.x0]).toBe(s);
      expect(map.roomOf[a.y1][a.x1]).toBe(s);
    }
  });
});

describe("meeting at the Core table", () => {
  it("has walkable, reachable, distinct places for the head and every seat", () => {
    const all = [MEETING_HEAD, ...MEETING_SEATS];
    expect(new Set(all.map((t) => t.join(","))).size).toBe(all.length);
    expect(MEETING_SEATS.length).toBeGreaterThanOrEqual(slugs.length - 2);
    for (const t of all) {
      expect(free(t), t.join(",")).toBe(true);
      for (const from of slugs) {
        const same = HOME[from][0] === t[0] && HOME[from][1] === t[1];
        expect(same || findPath(map.blocked, HOME[from], t).length > 0).toBe(true);
      }
    }
  });
});
