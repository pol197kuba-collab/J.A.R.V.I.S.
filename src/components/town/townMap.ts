// Agent Town — the floor plan. Pure data + pathfinding, no DOM, so it is
// unit-testable and shared by the renderer and the simulation.
//
// One building on a 44×32 grid of 16px tiles (¾ top-down, Pokémon-style):
// three rooms on top, J.A.R.V.I.S.'s "Rdzeń" in the middle with lounges on
// both sides, three rooms at the bottom, a strip of garden around it all.
// Each agent owns the room keyed by its slug; "user" is the human's terminal.

import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";

export const TS = 16;
export const TW = 44;
export const TH = 32;
export const WORLD_W = TW * TS;
export const WORLD_H = TH * TS;

export const GRASS = 0;
export const FLOOR = 1;
export const CAP = 2; // wall seen from above
export const FACE = 3; // north wall's front face (wallpaper)

export type TownSlug = (typeof AGENT_SLUGS)[keyof typeof AGENT_SLUGS] | "user";
export const TOWN_AGENTS: readonly TownSlug[] = [
  AGENT_SLUGS.JARVIS,
  AGENT_SLUGS.INSIGHT,
  AGENT_SLUGS.METRIC,
  AGENT_SLUGS.FORGE,
  AGENT_SLUGS.SHIELD,
  AGENT_SLUGS.HERALD,
];
export const isTownAgent = (slug: string): slug is TownSlug =>
  (TOWN_AGENTS as readonly string[]).includes(slug);

export type FloorKind = "wood" | "wood2" | "lab" | "stone" | "metal" | "carpet" | "hall";
export type Room = {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  label: string;
  floor: FloorKind;
  /** wallpaper colour, or a named pattern */
  face: string;
};

export const ROOMS: Record<TownSlug, Room> = {
  insight: { x0: 2, x1: 15, y0: 2, y1: 10, label: "Archiwum", floor: "wood", face: "#b9a27e" },
  metric: { x0: 15, x1: 28, y0: 2, y1: 10, label: "Laboratorium", floor: "lab", face: "#cfdfe4" },
  forge: { x0: 28, x1: 41, y0: 2, y1: 10, label: "Kuźnia", floor: "stone", face: "brick" },
  jarvis: { x0: 15, x1: 28, y0: 12, y1: 19, label: "Rdzeń", floor: "wood2", face: "#c9b48c" },
  shield: { x0: 2, x1: 15, y0: 21, y1: 29, label: "Skarbiec", floor: "metal", face: "steel" },
  user: { x0: 15, x1: 28, y0: 21, y1: 29, label: "Twój terminal", floor: "wood", face: "#d8c7a6" },
  herald: { x0: 28, x1: 41, y0: 21, y1: 29, label: "Studio", floor: "carpet", face: "#a8789c" },
};

export const DOORS: readonly [number, number][] = [
  [8, 10],
  [9, 10],
  [21, 10],
  [22, 10],
  [34, 10],
  [35, 10],
  [8, 21],
  [9, 21],
  [8, 22],
  [9, 22],
  [21, 21],
  [22, 21],
  [21, 22],
  [22, 22],
  [34, 21],
  [35, 21],
  [34, 22],
  [35, 22],
  [15, 16],
  [15, 17],
  [28, 16],
  [28, 17],
  [21, 29],
  [22, 29],
];

export type ObjKind =
  | "rug"
  | "mat"
  | "shelf"
  | "window"
  | "desk"
  | "chair"
  | "globe"
  | "plant"
  | "whiteboard"
  | "wallscreens"
  | "bench"
  | "furnace"
  | "anvil"
  | "workbench"
  | "toolwall"
  | "crate"
  | "barrel"
  | "board"
  | "table"
  | "vault"
  | "rack"
  | "coffee"
  | "vending"
  | "sofa"
  | "beanbag"
  | "arcade"
  | "pingpong"
  | "stage"
  | "poster"
  | "mic"
  | "spot"
  | "camera"
  | "tree"
  | "dogbed"
  // themed furnishing (one look per agent's job) + common areas + garden
  | "corkboard"
  | "cabinet"
  | "armchair"
  | "floorlamp"
  | "catalog"
  | "lectern"
  | "ladder"
  | "papers"
  | "stickies"
  | "chartstand"
  | "plotter"
  | "holotable"
  | "press"
  | "paperstack"
  | "grindstone"
  | "coal"
  | "blueprint"
  | "reactor"
  | "clock"
  | "cctv"
  | "lockers"
  | "hazard"
  | "emblem"
  | "extinguisher"
  | "photo"
  | "toys"
  | "neon"
  | "softbox"
  | "editdesk"
  | "socialwall"
  | "fridge"
  | "counter"
  | "watercooler"
  | "aquarium"
  | "stool"
  | "foosball"
  | "jukebox"
  | "tvconsole"
  | "bush"
  | "flowerbed"
  | "lamppost";
export type TownObject = {
  kind: ObjKind;
  tx: number;
  ty: number;
  w: number;
  h: number;
  block: boolean;
  opt: {
    c?: string;
    b?: string;
    books?: boolean;
    lamp?: boolean;
    monitor?: boolean;
    pc?: boolean;
    cams?: boolean;
  };
};

const OBJ: TownObject[] = [];
const O = (
  kind: ObjKind,
  tx: number,
  ty: number,
  w = 1,
  h = 1,
  block = true,
  opt: TownObject["opt"] = {},
) => OBJ.push({ kind, tx, ty, w, h, block, opt });
// Archiwum
O("rug", 4, 7, 6, 2, false, { c: "#7b4fb0", b: "#5a3a86" });
O("shelf", 3, 4, 2, 1);
O("shelf", 5, 4, 2, 1);
O("shelf", 11, 4, 2, 1);
O("shelf", 13, 4, 2, 1);
O("window", 8, 3, 2, 1, false);
O("desk", 7, 6, 2, 1, true, { books: true, lamp: true });
O("chair", 8, 7, 1, 1, false);
O("globe", 13, 8);
O("plant", 3, 9);
// …research den: evidence board, card catalogue, reading corner, files
O("corkboard", 10, 3, 1, 1, false);
O("ladder", 7, 4, 1, 1, false);
O("catalog", 3, 7);
O("armchair", 12, 6);
O("floorlamp", 13, 6);
O("lectern", 11, 7);
O("cabinet", 14, 6);
O("cabinet", 14, 7);
O("papers", 5, 9, 1, 1, false);
O("papers", 11, 9, 1, 1, false);
// Laboratorium
O("whiteboard", 16, 3, 3, 1, false);
O("window", 20, 3, 1, 1, false);
O("wallscreens", 23, 3, 4, 1, false);
O("bench", 17, 5, 4, 1);
O("desk", 23, 6, 3, 1, true, { monitor: true });
O("chair", 24, 7, 1, 1, false);
O("plant", 16, 9);
O("plant", 27, 9);
O("rug", 18, 7, 3, 2, false, { c: "#6fb7a4", b: "#4d8f7e" });
// …data lab: sticky-note wall, plotter printing charts, chart easel, holo table
O("stickies", 21, 3, 2, 1, false);
O("plotter", 16, 7);
O("chartstand", 27, 6);
O("holotable", 25, 8);
// Kuźnia
O("furnace", 29, 4, 2, 1);
O("window", 33, 3, 1, 1, false);
O("toolwall", 36, 3, 4, 1, false);
O("anvil", 33, 6);
O("workbench", 36, 4, 4, 1);
O("crate", 40, 8);
O("crate", 40, 9);
O("crate", 39, 9);
O("barrel", 29, 9);
// …document forge: blueprints, printing press, paper stacks, grindstone, coal
O("blueprint", 31, 3, 2, 1, false);
O("coal", 31, 4, 1, 1, false);
O("grindstone", 29, 7);
O("press", 37, 7, 2, 1);
O("paperstack", 39, 7);
// Rdzeń — the task board is where commands are pinned and results delivered
O("rug", 18, 15, 8, 3, false, { c: "#a8433a", b: "#7d2f29" });
O("board", 17, 14, 10, 1);
O("table", 19, 15, 6, 2);
O("plant", 16, 14);
O("plant", 27, 14);
O("plant", 16, 18);
O("reactor", 27, 18);
O("clock", 16, 13, 1, 1, false);
// Skarbiec
O("vault", 3, 22, 3, 1, false);
O("rack", 10, 23);
O("rack", 11, 23);
O("rack", 12, 23);
O("rack", 13, 23);
O("desk", 4, 26, 3, 1, true, { monitor: true, cams: true });
O("chair", 5, 27, 1, 1, false);
O("plant", 14, 28);
// …security: CCTV wall, deposit lockers, hazard stripes, shield emblem
O("cctv", 6, 22, 2, 1, false);
O("lockers", 14, 24);
O("lockers", 14, 25);
O("hazard", 10, 24, 4, 1, false);
O("emblem", 8, 26, 2, 2, false);
O("extinguisher", 3, 28);
// Twój terminal
O("rug", 18, 25, 6, 3, false, { c: "#3f7a8c", b: "#2c5a68" });
O("shelf", 16, 23, 2, 1);
O("desk", 19, 24, 3, 1, true, { monitor: true, pc: true });
O("chair", 20, 25, 1, 1, false);
O("coffee", 27, 23);
O("sofa", 24, 28, 3, 1);
O("plant", 16, 28);
O("dogbed", 17, 26, 1, 1, false); // the spaniel's bed (see townDog.ts)
O("window", 18, 22, 2, 1, false);
O("photo", 23, 22, 2, 1, false); // a framed photo of Marvel
O("floorlamp", 25, 23);
O("floorlamp", 27, 28);
O("toys", 18, 27, 1, 1, false);
// Studio
O("stage", 33, 23, 5, 2, false);
O("poster", 30, 22, 2, 1, false);
O("poster", 38, 22, 2, 1, false);
O("mic", 35, 24);
O("spot", 39, 24);
O("camera", 31, 27);
O("sofa", 37, 28, 3, 1);
O("plant", 29, 23);
O("plant", 40, 28);
// …broadcast studio: ON AIR neon, social wall, softboxes, editing desk
O("neon", 32, 22, 2, 1, false);
O("socialwall", 36, 22, 2, 1, false);
O("softbox", 29, 25);
O("softbox", 40, 25);
O("editdesk", 38, 26, 2, 1);
// Hall + lounges — corridor runners first (flat, drawn under everything)
O("rug", 3, 11, 38, 1, false, { c: "#9a7a5a", b: "#7a5a3e" });
O("rug", 3, 20, 38, 1, false, { c: "#9a7a5a", b: "#7a5a3e" });
O("rug", 7, 14, 5, 3, false, { c: "#c97b4a", b: "#9a5a32" });
O("vending", 3, 12);
O("coffee", 4, 12);
O("sofa", 5, 19, 3, 1);
O("table", 9, 15, 2, 1);
O("plant", 14, 12);
O("plant", 3, 19);
O("beanbag", 11, 18);
O("arcade", 39, 12);
O("arcade", 40, 12);
O("pingpong", 33, 15, 3, 2);
O("plant", 29, 12);
O("plant", 40, 19);
O("beanbag", 31, 19);
O("mat", 21, 28, 2, 1, false);
// west lounge = kitchenette & café corner
O("fridge", 6, 12);
O("counter", 7, 12, 2, 1);
O("watercooler", 12, 12);
O("aquarium", 3, 15, 1, 2);
O("stool", 8, 15, 1, 1, false);
O("stool", 11, 15, 1, 1, false);
// east lounge = games room
O("rug", 31, 14, 7, 4, false, { c: "#4a6a8a", b: "#34506c" });
O("jukebox", 31, 12);
O("tvconsole", 34, 12, 2, 1);
O("foosball", 38, 17, 2, 1);
// Garden
for (const [x, y] of [
  [0, 0],
  [42, 0],
  [0, 30],
  [42, 30],
  [0, 13],
  [42, 13],
  [11, 30],
  [31, 30],
] as const)
  O("tree", x, y, 2, 2, false);
for (const [x, y] of [
  [4, 0],
  [9, 1],
  [16, 0],
  [25, 1],
  [33, 0],
  [38, 1],
  [0, 5],
  [1, 9],
  [0, 20],
  [1, 25],
  [42, 6],
  [43, 10],
  [42, 22],
  [43, 26],
] as const)
  O("bush", x, y, 1, 1, false);
O("flowerbed", 5, 30, 3, 1, false);
O("flowerbed", 15, 30, 4, 1, false);
O("flowerbed", 25, 30, 4, 1, false);
O("flowerbed", 35, 30, 3, 1, false);
O("lamppost", 20, 30, 1, 1, false);
O("lamppost", 23, 30, 1, 1, false);

export const OBJECTS: readonly TownObject[] = OBJ;

export type TownMap = {
  grid: number[][];
  roomOf: string[][];
  blocked: boolean[][];
};

export function buildTownMap(): TownMap {
  const grid = Array.from({ length: TH }, () => new Array<number>(TW).fill(GRASS));
  const roomOf = Array.from({ length: TH }, () => new Array<string>(TW).fill("hall"));
  const set = (x: number, y: number, v: number, room?: string) => {
    if (x < 0 || y < 0 || x >= TW || y >= TH) return;
    grid[y][x] = v;
    if (room) roomOf[y][x] = room;
  };
  for (let y = 2; y <= 29; y++) for (let x = 2; x <= 41; x++) set(x, y, FLOOR, "hall");
  for (let x = 2; x <= 41; x++) {
    set(x, 2, CAP);
    set(x, 29, CAP);
  }
  for (let y = 2; y <= 29; y++) {
    set(2, y, CAP);
    set(41, y, CAP);
  }
  for (const [id, r] of Object.entries(ROOMS)) {
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const edge = x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
        if (edge) set(x, y, CAP);
        else if (y === r.y0 + 1) set(x, y, FACE, id);
        else set(x, y, FLOOR, id);
      }
  }
  for (const [x, y] of DOORS) set(x, y, FLOOR);
  // doorways cut through a north wall's face row belong to the room below
  for (const [x, y] of DOORS) if (y === 22) roomOf[y][x] = roomOf[y + 1][x];

  const blocked = grid.map((row) => row.map((v) => v !== FLOOR));
  for (const o of OBJECTS)
    if (o.block)
      for (let y = o.ty; y < o.ty + o.h; y++)
        for (let x = o.tx; x < o.tx + o.w; x++) blocked[y][x] = true;
  return { grid, roomOf, blocked };
}

export type Tile = readonly [number, number];

/** Where each character stands when at its own post. */
export const HOME: Record<TownSlug, Tile> = {
  jarvis: [21, 17],
  insight: [9, 7],
  metric: [21, 8],
  forge: [33, 7],
  shield: [6, 27],
  herald: [35, 25],
  user: [20, 25],
};
/** Where a visitor (usually J.A.R.V.I.S.) stands inside someone's room. */
export const VISIT: Record<TownSlug, Tile> = {
  insight: [10, 9],
  metric: [22, 9],
  forge: [35, 9],
  shield: [9, 24],
  user: [22, 24],
  herald: [34, 25],
  jarvis: [18, 15],
};
/** Spots in front of the task board, for pinning commands / delivering results. */
export const BOARD_SPOTS: readonly Tile[] = [
  [17, 15],
  [18, 15],
  [25, 15],
  [26, 15],
  [17, 16],
  [26, 16],
];
export const COFFEE_SPOT: Tile = [3, 13];
/** A meeting at the Core table: J.A.R.V.I.S. at its head, agents along its south side. */
export const MEETING_HEAD: Tile = [18, 16];
export const MEETING_SEATS: readonly Tile[] = [
  [19, 17],
  [20, 17],
  [22, 17],
  [23, 17],
  [24, 17],
  [21, 17],
];

export function roomArea(slug: TownSlug) {
  const r = ROOMS[slug];
  return { x0: r.x0 + 1, x1: r.x1 - 1, y0: r.y0 + 2, y1: r.y1 - 1 };
}

/** Pixel position of a character's feet standing on a tile. */
export const feet = (tx: number, ty: number) => ({ x: tx * TS + 8, y: ty * TS + 13 });

/** 4-connected BFS over walkable tiles. Returns the steps after `from`, ending at `to`; [] if unreachable or already there. */
export function findPath(blocked: boolean[][], from: Tile, to: Tile): Tile[] {
  const [sx, sy] = from;
  const [gx, gy] = to;
  if (sx === gx && sy === gy) return [];
  const key = (x: number, y: number) => y * TW + x;
  const prev = new Map<number, number>([[key(sx, sy), -1]]);
  const q: Tile[] = [[sx, sy]];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    if (x === gx && y === gy) break;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= TW || ny >= TH || prev.has(key(nx, ny))) continue;
      if (blocked[ny][nx] && !(nx === gx && ny === gy)) continue;
      prev.set(key(nx, ny), key(x, y));
      q.push([nx, ny]);
    }
  }
  if (!prev.has(key(gx, gy))) return [];
  const out: Tile[] = [];
  for (let k = key(gx, gy); k !== key(sx, sy); k = prev.get(k)!)
    out.push([k % TW, Math.floor(k / TW)]);
  return out.reverse();
}
