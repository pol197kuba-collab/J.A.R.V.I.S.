// Agent Town — extras: builders in the rooms under construction and traders
// on the trading floor. Pure: who they are, where they may stand and what
// they do next. They are scenery, not agents — tagged BUD / TRD, never in
// the roster, never talkable, and they claim nothing about agent work.
// Builders only joke ("tuk tuk!"); traders shout the fund's REAL ticker
// (townFund.ts) or, with no data yet, that the market is quiet.

import type { Look } from "./townArt";
import type { TownFund } from "./townFund";
import { roomArea, ROOMS, type RoomId, type Tile, type TownMap } from "./townMap";

export type NpcKind = "worker" | "trader";

export type NpcDef = {
  id: string;
  kind: NpcKind;
  room: RoomId;
  home: Tile;
  look: Look;
};

const builder = (h: string, c: string, p: string): Look => ({ h, c, p, acc: "hardhat" });
const trader = (h: string, c: string, p: string): Look => ({ h, c, p, acc: "badge" });

/** Everyone on the extras' list, with where they start the day. */
export const NPCS: readonly NpcDef[] = [
  {
    id: "bud-e1",
    kind: "worker",
    room: "build_e1",
    home: [47, 7],
    look: builder("#5a3a24", "#ff8a1f", "#3d4b6c"),
  },
  {
    id: "bud-e2",
    kind: "worker",
    room: "build_e2",
    home: [48, 15],
    look: builder("#2a2020", "#ff8a1f", "#4a3a2a"),
  },
  {
    id: "bud-e3",
    kind: "worker",
    room: "build_e3",
    home: [48, 26],
    look: builder("#c9a46a", "#e8742a", "#3d4b6c"),
  },
  {
    id: "bud-sw1",
    kind: "worker",
    room: "build_sw",
    home: [6, 34],
    look: builder("#7a4a2a", "#ff8a1f", "#33415e"),
  },
  {
    id: "bud-sw2",
    kind: "worker",
    room: "build_sw",
    home: [10, 39],
    look: builder("#3b2a20", "#e8742a", "#4a3a2a"),
  },
  {
    id: "bud-se",
    kind: "worker",
    room: "build_se",
    home: [47, 37],
    look: builder("#a0522d", "#ff8a1f", "#3d4b6c"),
  },
  // classic trading-floor jackets, one colour per firm
  {
    id: "trd-1",
    kind: "trader",
    room: "exchange",
    home: [34, 39],
    look: trader("#2a2020", "#d63b3b", "#2a2f45"),
  },
  {
    id: "trd-2",
    kind: "trader",
    room: "exchange",
    home: [37, 39],
    look: trader("#c9a46a", "#3d6fd6", "#2a2f45"),
  },
  {
    id: "trd-3",
    kind: "trader",
    room: "exchange",
    home: [20, 39],
    look: trader("#7a4a2a", "#e8c23a", "#2a2f45"),
  },
  {
    id: "trd-4",
    kind: "trader",
    room: "exchange",
    home: [25, 36],
    look: trader("#3b2a20", "#2f9e5a", "#2a2f45"),
  },
  {
    id: "trd-5",
    kind: "trader",
    room: "exchange",
    home: [31, 38],
    look: trader("#d4d7e0", "#7a4fc9", "#2a2f45"),
  },
  {
    id: "trd-6",
    kind: "trader",
    room: "exchange",
    home: [17, 39],
    look: trader("#a0522d", "#2aa6a6", "#2a2f45"),
  },
];

export const NPC_TAG: Record<NpcKind, string> = { worker: "BUD", trader: "TRD" };

// ── where they may stand ────────────────────────────────────────────────────

/** Free tiles of a room, and the ones right under its north wall (painting, drilling). */
export function roomSpots(map: TownMap, room: RoomId): { free: Tile[]; wall: Tile[] } {
  const a = roomArea(room);
  const free: Tile[] = [];
  for (let y = a.y0; y <= a.y1; y++)
    for (let x = a.x0; x <= a.x1; x++)
      if (!map.blocked[y][x] && map.roomOf[y][x] === room) free.push([x, y]);
  const wallRow = ROOMS[room].y0 + 2;
  return { free, wall: free.filter(([, y]) => y === wallRow) };
}

/** Trading floor: chairs at the desks, places at the pit, a view of the big screen. */
export const TRADER_SPOTS = {
  desk: [
    [17, 36],
    [20, 36],
    [17, 39],
    [20, 39],
    [34, 36],
    [37, 36],
    [34, 39],
    [37, 39],
  ] as readonly Tile[],
  pit: [
    [25, 36],
    [26, 38],
    [31, 36],
    [30, 38],
    [25, 39],
    [31, 39],
  ] as readonly Tile[],
  screen: [
    [22, 34],
    [27, 34],
    [29, 34],
    [33, 34],
  ] as readonly Tile[],
};
/** Where the traders face when shouting into the pit. */
export const PIT_CENTER: Tile = [28, 37];

// ── what they do next ───────────────────────────────────────────────────────

export type WorkerTask = "hammer" | "drill" | "paint" | "carry" | "measure" | "break";
export type TraderTask = "desk" | "pit" | "screen";

const WORKER_WEIGHTS: readonly [WorkerTask, number][] = [
  ["hammer", 3],
  ["drill", 2],
  ["paint", 2],
  ["carry", 3],
  ["measure", 1],
  ["break", 1],
];
const TRADER_WEIGHTS: readonly [TraderTask, number][] = [
  ["desk", 9],
  ["pit", 7],
  ["screen", 4],
];

export function pickWeighted<T>(items: readonly (readonly [T, number])[], roll: number): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  const target = Math.min(0.999999, Math.max(0, roll)) * total;
  for (const [item, w] of items) {
    acc += w;
    if (target < acc) return item;
  }
  return items[items.length - 1][0];
}

export const workerTask = (roll: number): WorkerTask => pickWeighted(WORKER_WEIGHTS, roll);
export const traderTask = (roll: number): TraderTask => pickWeighted(TRADER_WEIGHTS, roll);

/** Painting and drilling happen at the wall; everything else anywhere in the room. */
export const atWall = (task: WorkerTask) => task === "paint" || task === "drill";

/** How long a task lasts, ms. */
export function taskMs(task: WorkerTask | TraderTask, roll: number): number {
  const [lo, hi] =
    task === "desk"
      ? [4000, 9000]
      : task === "pit"
        ? [2600, 4200]
        : task === "screen"
          ? [3000, 5000]
          : task === "break"
            ? [4000, 6000]
            : task === "carry"
              ? [600, 900]
              : [2600, 5200];
  return lo + Math.round(roll * (hi - lo));
}

/** Builders' banter — jokes, never claims about anything real. */
export const WORKER_LINES: Record<WorkerTask, readonly string[]> = {
  hammer: ["tuk tuk!", "jeszcze jeden gwóźdź", "prosto jak w pionie"],
  drill: ["bzzzz!", "wiercę w betonie!"],
  paint: ["druga warstwa", "kolor: biel J.A.R.V.I.S."],
  carry: ["uwaga, idę!", "ciężkie te cegły"],
  measure: ["2,40… czy 2,04?", "mierz dwa razy"],
  break: ["przerwa!", "kawka i jedziemy"],
};

/** Builders knock off after dark. */
export const WORKERS_AWAY_AT_NIGHT = 0.6;

/** A trader's shout into the pit: a real ticker line, or that the market is quiet. */
export function traderShout(
  fund: TownFund | null,
  roll: number,
): { text: string; tone: "plain" | "ok" | "bad" } {
  const items = (fund?.ticker ?? []).filter((t) => t.sign !== 0);
  if (items.length === 0)
    return { text: roll < 0.5 ? "Cisza na rynku…" : "Czekamy na dane!", tone: "plain" };
  const it = items[Math.min(items.length - 1, Math.floor(roll * items.length))];
  return { text: `${it.text}!`, tone: it.sign > 0 ? "ok" : "bad" };
}

/** After the bell the whole floor cheers for this long, ms. */
export const BELL_CHEER_MS = 2600;
