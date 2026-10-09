// Agent Town — pixel art. Character sprites, the static floor/wall/furniture
// layer, per-frame animated details, and the screen-space speech bubbles.
//
// Colours here are artwork (a fixed game palette, like the categorical
// --fuel-*/--market-* palettes), not UI tokens: the world looks the same in
// every theme. UI around the map (panels, buttons) uses the theme tokens.

import {
  OBJECTS,
  ROOMS,
  DOORS,
  TS,
  TW,
  TH,
  WORLD_W,
  WORLD_H,
  GRASS,
  FLOOR,
  CAP,
  FACE,
  type TownMap,
  type TownObject,
  type TownSlug,
  type FloorKind,
} from "./townMap";

export const INK = "#2a2034";

// ── icons (8×8) ─────────────────────────────────────────────────────────────
export const ICON: Record<string, readonly string[]> = {
  search: [
    ".###....",
    "#...#...",
    "#...#...",
    "#...#...",
    ".###....",
    "....##..",
    ".....##.",
    "......##",
  ],
  chart: [
    "........",
    "......#.",
    "......#.",
    "...#..#.",
    "...#..#.",
    "#..#..#.",
    "#..#..#.",
    "########",
  ],
  doc: [
    "#####...",
    "#...##..",
    "#.#..#..",
    "#....#..",
    "#.##.#..",
    "#....#..",
    "#....#..",
    "######..",
  ],
  hammer: [
    "######..",
    "######..",
    "..##....",
    "..##....",
    "..##....",
    "..##....",
    "..##....",
    "........",
  ],
  shield: [
    ".######.",
    "#......#",
    "#..##..#",
    "#..##..#",
    ".#....#.",
    ".#....#.",
    "..#..#..",
    "...##...",
  ],
  mega: [
    "......#.",
    ".....##.",
    "#..###.#",
    "#####..#",
    "#####..#",
    "#..###.#",
    ".....##.",
    "......#.",
  ],
  bulb: [
    "..###...",
    ".#...#..",
    ".#...#..",
    ".#...#..",
    "..#.#...",
    "..###...",
    "..###...",
    "........",
  ],
  mail: [
    "........",
    "########",
    "##....##",
    "#.#..#.#",
    "#..##..#",
    "#......#",
    "########",
    "........",
  ],
  check: [
    "........",
    ".......#",
    "......#.",
    "#....#..",
    ".#..#...",
    "..##....",
    "........",
    "........",
  ],
  cross: [
    "#......#",
    ".#....#.",
    "..#..#..",
    "...##...",
    "...##...",
    "..#..#..",
    ".#....#.",
    "#......#",
  ],
  coffee: [
    "..#.#...",
    "...#.#..",
    "........",
    "######..",
    "#....###",
    "#....#.#",
    "#....###",
    ".####...",
  ],
  pin: [
    "######..",
    "#....#..",
    "#.##.#..",
    "#....#..",
    "######..",
    "..#.....",
    "..#.....",
    "........",
  ],
  dots: [
    "........",
    "........",
    "........",
    "#..#..#.",
    "#..#..#.",
    "........",
    "........",
    "........",
  ],
  heart: [
    ".##.##..",
    "########",
    "########",
    ".######.",
    "..####..",
    "...##...",
    "........",
    "........",
  ],
  bone: [
    "........",
    "##....##",
    "########",
    ".######.",
    "########",
    "##....##",
    "........",
    "........",
  ],
  paw: [
    "..#.#...",
    ".#...#..",
    "........",
    "..###...",
    ".#####..",
    ".#####..",
    "..###...",
    "........",
  ],
  zz: [
    "####....",
    "...#....",
    "..#.....",
    ".#..###.",
    "####..#.",
    ".....#..",
    "....#...",
    "....###.",
  ],
};

/** Best-fitting bubble icon for a real tool name. */
export function iconForTool(name: string): string {
  if (name === "delegate_to_agent") return "mail";
  if (/search|fetch|lookup|find/.test(name)) return "search";
  if (/outlook|market|fuel|stats|metric|price/.test(name)) return "chart";
  if (/generate|create_project|forge|build|start_dev/.test(name)) return "hammer";
  if (/guardian|scan|check|security/.test(name)) return "shield";
  if (/recall|remember|note/.test(name)) return "bulb";
  if (/task|order|brief/.test(name)) return "pin";
  if (/document|read|list|open|file/.test(name)) return "doc";
  return "dots";
}

// ── sprites (16×16, ¾ view) ─────────────────────────────────────────────────
const FRONT_L = [
  "........",
  ".....ooo",
  "....ohhh",
  "...ohhhh",
  "..ohhhhh",
  "..ohhhss",
  "..ohssss",
  "..ohsess",
  "..ohsess",
  "...oSsss",
  "....occc",
  "...occcc",
  "..oscccc",
  "...opppp",
  "...oppo.",
  "...obbo.",
];
const mirror = (r: string) => r + [...r].reverse().join("");
const FRONT = FRONT_L.map(mirror);
const BACK = FRONT.map((r, i) =>
  i >= 5 && i <= 8 ? r.replace(/[seS]/g, "h") : i === 9 ? r.replace(/[sS]/g, "H") : r,
);
const SIDE = [
  "................",
  ".....oooooo.....",
  "....ohhhhhho....",
  "...ohhhhhhhho...",
  "...ohhhhhhhho...",
  "...ohhhhhsssso..",
  "...ohhhhsssseo..",
  "...ohhhhsssseso.",
  "...oHhhhssssso..",
  "....ooSSssssoo..",
  ".....occcccco...",
  "....occcccccco..",
  "....occcsccco...",
  ".....opppppo....",
  ".....opo.opo....",
  ".....obo.obbo...",
];
const LEGS = {
  front: {
    A: ["...oppo..obbo...", "...obbo........."],
    B: ["...obbo..oppo...", ".........obbo..."],
  },
  side: {
    A: ["....opo...opo...", "....obo...obbo.."],
    B: ["......oppo......", "......obbo......"],
  },
} as const;
type Look = {
  h: string;
  c: string;
  p: string;
  acc: "butler" | "glasses" | "coat" | "bandana" | "helmet" | "scarf" | null;
};
const LOOKS: Record<TownSlug, Look> = {
  jarvis: { h: "#d4d7e0", c: "#2f3142", p: "#2f3142", acc: "butler" },
  insight: { h: "#4a3566", c: "#9a7fe0", p: "#4b4a63", acc: "glasses" },
  metric: { h: "#7a4a2a", c: "#f4f4ee", p: "#3f6b52", acc: "coat" },
  forge: { h: "#c4562a", c: "#e98a3c", p: "#6b4a33", acc: "bandana" },
  shield: { h: "#6f8fcf", c: "#3a5a9a", p: "#2a3550", acc: "helmet" },
  herald: { h: "#e86fa8", c: "#d1477a", p: "#4a3a5e", acc: "scarf" },
  user: { h: "#3b2a20", c: "#4f8a8b", p: "#3d4b5c", acc: null },
};
/** Identity colour per character (roster chips, board cards, name tags). */
export const AGENT_COLOR: Record<TownSlug, string> = {
  jarvis: "#4fd8f0",
  insight: "#9a7fe0",
  metric: "#4caf6a",
  forge: "#e98a3c",
  shield: "#5b7fd0",
  herald: "#e05f9b",
  user: "#d9e2ea",
};

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (
    "#" +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => ch(v).toString(16).padStart(2, "0"))
      .join("")
  );
}
function setPx(g: string[], x: number, y: number, ch: string) {
  g[y] = g[y].slice(0, x) + ch + g[y].slice(x + 1);
}
function accessorize(g: string[], view: "front" | "back" | "side", acc: Look["acc"]) {
  if (acc === "butler" && view !== "back") {
    if (view === "front") {
      for (let x = 6; x <= 9; x++) setPx(g, x, 10, "w");
      setPx(g, 7, 11, "k");
      setPx(g, 8, 11, "k");
    } else {
      setPx(g, 10, 10, "w");
      setPx(g, 11, 10, "w");
      setPx(g, 11, 11, "k");
    }
  }
  if (acc === "glasses" && view !== "back") {
    if (view === "front") for (const x of [4, 6, 7, 8, 9, 11]) setPx(g, x, 7, "g");
    else {
      setPx(g, 11, 6, "g");
      setPx(g, 11, 7, "g");
      setPx(g, 13, 6, "g");
    }
  }
  if (acc === "coat" && view === "front")
    for (const [x, y] of [
      [7, 10],
      [8, 10],
      [7, 11],
      [8, 11],
    ])
      setPx(g, x, y, "i");
  if (acc === "bandana")
    for (let x = 3; x <= 12; x++) if ("hH".includes(g[3][x])) setPx(g, x, 3, "r");
  if (acc === "helmet") {
    setPx(g, 5, 2, "w");
    setPx(g, 6, 2, "w");
    if (view === "front") setPx(g, 9, 11, "y");
  }
  if (acc === "scarf" && view !== "back")
    for (let x = 4; x <= 11; x++) if (g[10][x] === "c") setPx(g, x, 10, "y");
}
function autoShade(g: string[]) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 15; x++) {
      const ch = g[y][x];
      if ("chp".includes(ch) && g[y][x + 1] === "o") setPx(g, x, y, ch.toUpperCase());
    }
}

export type SpriteSet = Record<string, HTMLCanvasElement>;
export function buildSprites(): Record<TownSlug, SpriteSet> {
  const out = {} as Record<TownSlug, SpriteSet>;
  for (const [id, look] of Object.entries(LOOKS) as [TownSlug, Look][]) {
    const pal: Record<string, string> = {
      o: INK,
      e: INK,
      g: INK,
      s: "#f7cfa6",
      S: "#dba077",
      w: "#ffffff",
      k: "#4fd8f0",
      i: "#57b86a",
      r: "#d63b3b",
      y: id === "herald" ? "#ffd36b" : "#f2c94c",
      b: "#3b2b2b",
      h: look.h,
      H: shade(look.h, 0.75),
      c: look.c,
      C: shade(look.c, 0.78),
      p: look.p,
      P: shade(look.p, 0.75),
    };
    out[id] = {};
    for (const view of ["front", "back", "side"] as const) {
      for (const fr of ["S", "A", "B"] as const) {
        const g = (view === "front" ? FRONT : view === "back" ? BACK : SIDE).slice();
        if (fr !== "S") {
          const L = LEGS[view === "side" ? "side" : "front"][fr];
          g[14] = L[0];
          g[15] = L[1];
        }
        accessorize(g, view, look.acc);
        autoShade(g);
        const cv = document.createElement("canvas");
        cv.width = cv.height = 16;
        const c2 = cv.getContext("2d")!;
        g.forEach((row, y) =>
          [...row].forEach((ch, x) => {
            if (ch === ".") return;
            c2.fillStyle = pal[ch] ?? "#ff00ff";
            c2.fillRect(x, y, 1, 1);
          }),
        );
        out[id][view + fr] = cv;
      }
    }
  }
  return out;
}

// ── static layer ────────────────────────────────────────────────────────────
const FLOORS: Record<FloorKind, [string, string, string]> = {
  wood: ["#c98b52", "#ba7c46", "#a46a3b"],
  wood2: ["#b9804c", "#ab7243", "#94603a"],
  lab: ["#eef2f3", "#e2e9ec", "#bac7cd"],
  stone: ["#948a80", "#877d74", "#6a625b"],
  metal: ["#66728a", "#5c677e", "#8b97ad"],
  carpet: ["#7d4f8a", "#73477f", "#8e5f9b"],
  hall: ["#dcd2c2", "#d1c6b4", "#b6a993"],
};

export function buildStaticLayer(map: TownMap): HTMLCanvasElement {
  const stat = document.createElement("canvas");
  stat.width = WORLD_W;
  stat.height = WORLD_H;
  const g = stat.getContext("2d")!;
  let seed = 7; // seeded: the map looks identical on every load
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const R = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  const outline = (x: number, y: number, w: number, h: number) => {
    R(x, y, w, 1, INK);
    R(x, y + h - 1, w, 1, INK);
    R(x, y, 1, h, INK);
    R(x + w - 1, y, 1, h, INK);
  };
  const box = (
    x: number,
    y: number,
    w: number,
    h: number,
    top: string,
    front: string,
    topH: number,
  ) => {
    R(x, y, w, h, front);
    R(x, y, w, topH, top);
    R(x, y + topH, w, 1, shade(front, 0.85));
    outline(x, y, w, h);
  };
  const shadowBelow = (x: number, y: number, w: number) =>
    R(x + 1, y, w - 2, 2, "rgba(30,16,30,0.28)");
  const { grid, roomOf } = map;

  const grass = (px: number, py: number) => {
    R(px, py, 16, 16, "#78c25a");
    for (let i = 0; i < 6; i++)
      R(px + Math.floor(rnd() * 15), py + Math.floor(rnd() * 15), 1, 2, "#64ad49");
    for (let i = 0; i < 2; i++)
      R(px + Math.floor(rnd() * 15), py + Math.floor(rnd() * 15), 1, 1, "#9bdc77");
    if (rnd() < 0.12) {
      const fx = px + 3 + Math.floor(rnd() * 9);
      const fy = py + 3 + Math.floor(rnd() * 9);
      R(fx, fy, 2, 2, ["#fff7e8", "#ffd34d", "#ff7b7b"][Math.floor(rnd() * 3)]);
      R(fx + 1, fy + 2, 1, 1, "#4f8f3a");
    }
  };
  const floor = (px: number, py: number, kind: FloorKind, tx: number, ty: number) => {
    const [a, b, s] = FLOORS[kind];
    if (kind === "wood" || kind === "wood2") {
      for (let r = 0; r < 4; r++) {
        R(px, py + r * 4, 16, 4, (r + tx) % 2 ? a : b);
        R(px, py + r * 4 + 3, 16, 1, s);
        R(px + ((r * 7 + tx * 5 + ty * 3) % 16), py + r * 4, 1, 3, s);
        if (rnd() < 0.5) R(px + Math.floor(rnd() * 15), py + r * 4 + 1, 2, 1, shade(a, 0.93));
      }
    } else if (kind === "lab" || kind === "hall") {
      R(px, py, 16, 16, (tx + ty) % 2 ? a : b);
      R(px, py + 15, 16, 1, s);
      R(px + 15, py, 1, 16, s);
      R(px + 1, py + 1, 2, 1, "rgba(255,255,255,0.14)");
    } else if (kind === "stone") {
      R(px, py, 16, 16, a);
      R(px, py + 7, 16, 1, s);
      R(px, py + 15, 16, 1, s);
      R(px + ((tx * 5) % 12) + 2, py, 1, 7, s);
      R(px + ((tx * 3 + 6) % 12) + 2, py + 8, 1, 7, s);
      if (rnd() < 0.4) R(px + Math.floor(rnd() * 14), py + Math.floor(rnd() * 14), 2, 1, b);
    } else if (kind === "metal") {
      R(px, py, 16, 16, (tx + ty) % 2 ? a : b);
      g.globalAlpha = 0.35;
      outline(px, py, 16, 16);
      g.globalAlpha = 1;
      for (const [x, y] of [
        [2, 2],
        [13, 2],
        [2, 13],
        [13, 13],
      ])
        R(px + x, py + y, 1, 1, s);
    } else {
      R(px, py, 16, 16, a);
      for (let y = 2; y < 16; y += 4)
        for (let x = y % 8 === 2 ? 2 : 4; x < 16; x += 4) R(px + x, py + y, 1, 1, s);
    }
  };
  const isCap = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < TW && y < TH && grid[y][x] === CAP;
  const cap = (tx: number, ty: number) => {
    const px = tx * TS;
    const py = ty * TS;
    R(px, py, 16, 16, "#efe4cc");
    R(px, py + 1, 16, 1, "#f8f1e0");
    if (!isCap(tx, ty - 1)) R(px, py, 16, 1, INK);
    if (!isCap(tx, ty + 1)) {
      R(px, py + 13, 16, 2, "#d6c6a2");
      R(px, py + 15, 16, 1, INK);
    }
    if (!isCap(tx - 1, ty)) R(px, py, 1, 16, INK);
    if (!isCap(tx + 1, ty)) R(px + 15, py, 1, 16, INK);
  };
  const face = (tx: number, ty: number) => {
    const px = tx * TS;
    const py = ty * TS;
    const room = ROOMS[roomOf[ty][tx] as TownSlug];
    const f = room ? room.face : "#c9b48c";
    if (f === "brick") {
      R(px, py, 16, 16, "#9a5a42");
      for (let r = 0; r < 4; r++) {
        R(px, py + r * 4 + 3, 16, 1, "#6e3c2c");
        for (let x = r % 2 ? 0 : 4; x < 16; x += 8) R(px + x, py + r * 4, 1, 3, "#6e3c2c");
      }
    } else if (f === "steel") {
      R(px, py, 16, 16, "#7c879e");
      R(px, py, 1, 16, "#5d677c");
      R(px + 2, py + 2, 1, 1, "#aab4c8");
      R(px + 13, py + 2, 1, 1, "#aab4c8");
    } else {
      R(px, py, 16, 16, f);
      for (let x = 2; x < 16; x += 4) R(px + x, py, 1, 13, shade(f, 1.07));
    }
    R(px, py, 16, 2, "rgba(0,0,0,0.18)");
    R(px, py + 13, 16, 3, "#7a5236");
    R(px, py + 13, 16, 1, "#9b6b47");
    R(px, py + 15, 16, 1, INK);
  };

  const PAINT: Partial<Record<TownObject["kind"], (o: TownObject) => void>> = {
    rug(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS + 2,
        w = o.w * TS - 4,
        h = o.h * TS - 4;
      R(x, y, w, h, o.opt.b!);
      R(x + 2, y + 2, w - 4, h - 4, o.opt.c!);
      for (let i = x + 4; i < x + w - 4; i += 4) {
        R(i, y + 3, 2, 1, o.opt.b!);
        R(i, y + h - 4, 2, 1, o.opt.b!);
      }
      // fringe on the short ends, a woven medallion on larger rugs
      for (let j = y + 1; j < y + h - 1; j += 2) {
        R(x - 1, j, 1, 1, "#efe4cc");
        R(x + w, j, 1, 1, "#efe4cc");
      }
      if (h >= 20 && w >= 40) {
        const cx = x + Math.floor(w / 2);
        const cy = y + Math.floor(h / 2);
        R(cx - 4, cy - 1, 8, 2, o.opt.b!);
        R(cx - 1, cy - 4, 2, 8, o.opt.b!);
        R(cx - 1, cy - 1, 2, 2, "#efe4cc");
      }
    },
    mat(o) {
      const x = o.tx * TS + 4,
        y = o.ty * TS + 6;
      R(x, y, o.w * TS - 8, 8, "#8a5a3a");
      R(x + 2, y + 2, o.w * TS - 12, 4, "#a8724b");
    },
    shelf(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 14,
        w = o.w * TS - 2,
        h = 28;
      R(x, y, w, h, "#7a4a2c");
      outline(x, y, w, h);
      const books = ["#c0504d", "#4f81bd", "#9bbb59", "#f2c94c", "#8064a2", "#e98a3c", "#4bacc6"];
      for (let s = 0; s < 3; s++) {
        R(x + 2, y + 3 + s * 8, w - 4, 6, "#4a2c1a");
        for (let bx = x + 3; bx < x + w - 3; bx += 3) {
          const hh = 4 + Math.floor(rnd() * 2);
          R(bx, y + 9 + s * 8 - hh, 2, hh, books[Math.floor(rnd() * books.length)]);
        }
        R(x + 1, y + 9 + s * 8, w - 2, 1, "#a8724b");
      }
      shadowBelow(x, y + h, w);
    },
    window(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS + 1,
        w = o.w * TS - 4;
      R(x, y, w, 11, "#f5efe2");
      R(x + 2, y + 2, w - 4, 7, "#8fcbea");
      R(x + 2, y + 2, w - 4, 2, "#c6e8f8");
      R(x + Math.floor(w / 2), y + 2, 1, 7, "#f5efe2");
      R(x + 3, y + 4, 2, 1, "#ffffff");
      outline(x, y, w, 11);
      // curtains gathered at the sides
      R(x - 2, y - 1, 3, 12, "#b8574d");
      R(x + w - 1, y - 1, 3, 12, "#b8574d");
      R(x - 2, y - 1, 1, 12, "#8f4038");
      R(x + w + 1, y - 1, 1, 12, "#8f4038");
      R(x - 3, y - 2, w + 6, 1, "#5a3520");
      R(x - 1, y + 11, w + 2, 2, "#e8dcc2");
    },
    desk(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS + 2,
        w = o.w * TS - 2;
      box(x, y, w, 12, "#c08550", "#8a5631", 6);
      R(x + 2, y + 12, 2, 2, "#5a3520");
      R(x + w - 4, y + 12, 2, 2, "#5a3520");
      // drawers with brass pulls, a little wood grain on the top
      R(x + w - 12, y + 7, 10, 4, "#9a6338");
      R(x + w - 8, y + 9, 2, 1, "#f2c94c");
      R(x + 3, y + 2, Math.min(10, w - 6), 1, "#cf9663");
      if (o.opt.books) {
        R(x + 4, y - 2, 6, 3, "#4f81bd");
        R(x + 5, y - 4, 5, 2, "#c0504d");
        outline(x + 4, y - 4, 6, 5);
      }
      if (o.opt.lamp) {
        R(x + w - 7, y - 6, 5, 3, "#f2c94c");
        R(x + w - 5, y - 3, 1, 4, INK);
        outline(x + w - 7, y - 6, 5, 3);
      }
      if (o.opt.monitor) {
        R(x + w / 2 - 6, y - 8, 12, 9, INK);
        R(x + w / 2 - 1, y + 1, 2, 2, INK);
      }
      if (o.opt.pc) {
        R(x + w - 6, y - 6, 4, 9, "#d9d9d9");
        outline(x + w - 6, y - 6, 4, 9);
        R(x + 3, y + 3, 8, 2, "#e8e8e8");
      }
      shadowBelow(x, y + 14, w);
    },
    chair(o) {
      const x = o.tx * TS + 4,
        y = o.ty * TS + 3;
      R(x, y, 8, 3, "#5c3b2a");
      R(x, y + 3, 8, 6, "#7a4f36");
      R(x + 1, y + 4, 6, 1, "#94634a");
      outline(x, y, 8, 9);
      R(x + 1, y + 9, 1, 2, "#3e2618");
      R(x + 6, y + 9, 1, 2, "#3e2618");
    },
    globe(o) {
      const x = o.tx * TS + 3,
        y = o.ty * TS - 2;
      R(x + 4, y + 13, 2, 3, "#7a4a2c");
      R(x + 1, y + 15, 8, 2, "#7a4a2c");
      g.fillStyle = "#4f9fd8";
      g.beginPath();
      g.arc(x + 5, y + 7, 5, 0, 7);
      g.fill();
      R(x + 2, y + 5, 3, 2, "#6cc35a");
      R(x + 6, y + 8, 2, 2, "#6cc35a");
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x + 5, y + 7, 5.5, 0, 7);
      g.stroke();
    },
    plant(o) {
      const x = o.tx * TS + 4,
        y = o.ty * TS;
      const kind = (o.tx * 7 + o.ty * 3) % 3;
      if (kind === 1) {
        // tall snake plant in a white pot
        R(x + 1, y + 10, 6, 5, "#e8e2d4");
        R(x, y + 9, 8, 2, "#f5f0e4");
        outline(x, y + 9, 8, 6);
        for (const [lx, h] of [
          [1, 9],
          [3, 12],
          [5, 8],
          [4, 10],
        ]) {
          R(x + lx, y + 10 - h, 2, h, "#3f7a3a");
          R(x + lx, y + 10 - h, 1, h, "#6cb35a");
          R(x + lx, y + 10 - h + 2, 2, 1, "#c9d870");
        }
        return;
      }
      if (kind === 2) {
        // round cactus in a terracotta pot, with a flower
        R(x + 1, y + 10, 6, 5, "#b86a3c");
        R(x, y + 9, 8, 2, "#cf7f4c");
        outline(x, y + 9, 8, 6);
        R(x + 1, y + 2, 6, 8, "#4f9a4a");
        R(x + 2, y + 1, 4, 1, "#4f9a4a");
        R(x + 2, y + 3, 1, 6, "#76c25e");
        outline(x + 1, y + 1, 6, 9);
        R(x + 3, y, 2, 2, "#ff7b9b");
        return;
      }
      R(x + 1, y + 10, 6, 5, "#b86a3c");
      R(x, y + 9, 8, 2, "#cf7f4c");
      outline(x, y + 9, 8, 6);
      for (const [lx, ly] of [
        [3, 0],
        [1, 2],
        [5, 2],
        [0, 4],
        [6, 4],
        [2, 5],
        [4, 5],
        [3, 3],
      ]) {
        R(x + lx, y + ly + 1, 3, 3, "#3f8a3a");
        R(x + lx, y + ly + 1, 2, 2, "#5fb352");
      }
    },
    whiteboard(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS + 1,
        w = o.w * TS - 4;
      R(x, y, w, 11, "#fbfbf7");
      outline(x, y, w, 11);
      g.strokeStyle = "#e05f5f";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + 3, y + 8);
      g.lineTo(x + 10, y + 5);
      g.lineTo(x + 17, y + 7);
      g.lineTo(x + 26, y + 3);
      g.lineTo(x + w - 4, y + 4);
      g.stroke();
      R(x + 3, y + 2, 8, 1, "#4f81bd");
    },
    bench(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS + 1,
        w = o.w * TS - 2;
      box(x, y, w, 13, "#eef3f5", "#aab8bf", 6);
      const cols = ["#e05f9b", "#57b86a", "#4fd8f0", "#f2c94c", "#9a7fe0"];
      for (let i = 0; i < 7; i++) {
        const fx = x + 4 + i * 8;
        R(fx, y - 4, 4, 6, "#dff4fb");
        R(fx, y - 1, 4, 3, cols[i % 5]);
        outline(fx, y - 4, 4, 6);
      }
      shadowBelow(x, y + 13, w);
    },
    furnace(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 16,
        w = 30;
      R(x + 9, y - 8, 12, 10, "#6a625b");
      outline(x + 9, y - 8, 12, 10);
      R(x, y, w, 30, "#857b72");
      outline(x, y, w, 30);
      for (let r = 0; r < 6; r++) R(x + 1, y + 4 + r * 5, w - 2, 1, "#6a625b");
      R(x + 7, y + 14, 16, 12, "#2b1a12");
      outline(x + 7, y + 14, 16, 12);
      shadowBelow(x, y + 30, w);
    },
    anvil(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS + 3;
      R(x + 1, y, 14, 4, "#5d6168");
      R(x + 4, y + 4, 8, 3, "#4a4e55");
      R(x + 2, y + 7, 12, 4, "#3e4148");
      R(x - 1, y, 3, 2, "#5d6168");
      outline(x + 1, y, 14, 11);
      R(x + 2, y + 1, 10, 1, "#8a8f97");
      shadowBelow(x, y + 11, 16);
    },
    workbench(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS + 2,
        w = o.w * TS - 2;
      box(x, y, w, 12, "#9a6a43", "#6e4a2e", 5);
      R(x + 6, y - 2, 10, 3, "#8a8f97");
      R(x + 24, y - 3, 3, 4, "#c4562a");
      R(x + 40, y - 2, 8, 2, "#f2c94c");
      shadowBelow(x, y + 12, w);
    },
    toolwall(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS + 1,
        w = o.w * TS - 4;
      R(x, y, w, 11, "#c49a6c");
      outline(x, y, w, 11);
      R(x + 4, y + 2, 2, 7, "#5a3520");
      R(x + 2, y + 2, 6, 2, "#8a8f97");
      R(x + 14, y + 2, 2, 7, "#5a3520");
      R(x + 13, y + 7, 4, 2, "#8a8f97");
      R(x + 24, y + 3, 10, 3, "#8a8f97");
      R(x + 34, y + 3, 3, 3, "#5a3520");
      R(x + 44, y + 2, 2, 7, "#5a3520");
      R(x + 42, y + 2, 6, 3, "#5d6168");
    },
    crate(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS + 1;
      R(x, y, 14, 14, "#c08a52");
      outline(x, y, 14, 14);
      R(x + 1, y + 6, 12, 2, "#8a5a32");
      R(x + 6, y + 1, 2, 12, "#8a5a32");
      R(x + 1, y + 1, 4, 1, "#dca46a");
      R(x + 9, y + 9, 3, 3, "#9a6a3a");
    },
    barrel(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS;
      R(x, y + 1, 12, 14, "#9a5a32");
      R(x, y + 4, 12, 1, "#5d6168");
      R(x, y + 11, 12, 1, "#5d6168");
      R(x + 1, y, 10, 3, "#b8743f");
      R(x + 2, y + 5, 1, 5, "#c88a52");
      outline(x, y, 12, 15);
    },
    board(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 14,
        w = o.w * TS - 2,
        h = 28;
      R(x, y, w, h, "#7a4a2c");
      R(x + 2, y + 2, w - 4, h - 4, "#d8b07a");
      outline(x, y, w, h);
      const cw = Math.floor((w - 4) / 3);
      const head = ["#a59a8c", "#e0a23a", "#57b86a"];
      for (let c = 0; c < 3; c++) {
        R(x + 2 + c * cw + 2, y + 3, cw - 4, 3, head[c]);
        if (c) R(x + 2 + c * cw, y + 2, 1, h - 4, "#b38a58");
      }
      R(x + 6, y + h, 2, 4, "#5a3520");
      R(x + w - 8, y + h, 2, 4, "#5a3520");
      shadowBelow(x, y + h + 2, w);
    },
    table(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS + 1,
        w = o.w * TS - 4,
        h = o.h * TS - 4;
      R(x, y, w, h, "#8a5631");
      R(x, y, w, h - 5, "#c08550");
      outline(x, y, w, h);
      if (o.w >= 5) {
        R(x + 10, y + 4, 22, 12, "#e9dcc0");
        outline(x + 10, y + 4, 22, 12);
        R(x + 13, y + 7, 6, 4, "#78c25a");
        R(x + 21, y + 9, 7, 3, "#4f9fd8");
        R(x + 40, y + 5, 9, 7, "#fbfbf7");
        R(x + 52, y + 8, 8, 6, "#fbfbf7");
        outline(x + 40, y + 5, 9, 7);
        outline(x + 52, y + 8, 8, 6);
        R(x + 70, y + 6, 4, 4, "#ffffff");
        R(x + 74, y + 7, 1, 2, "#ffffff");
      } else {
        R(x + 6, y + 3, 4, 4, "#ffffff");
        R(x + 10, y + 4, 1, 2, "#ffffff");
      }
      shadowBelow(x, y + h, w);
    },
    vault(o) {
      const cx = o.tx * TS + 24,
        cy = o.ty * TS + 6;
      g.fillStyle = "#5d6168";
      g.beginPath();
      g.arc(cx, cy, 11, 0, 7);
      g.fill();
      g.fillStyle = "#8a8f97";
      g.beginPath();
      g.arc(cx, cy, 8, 0, 7);
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, 11.5, 0, 7);
      g.stroke();
      R(cx - 6, cy - 1, 12, 2, "#3e4148");
      R(cx - 1, cy - 6, 2, 12, "#3e4148");
      R(cx - 2, cy - 2, 4, 4, "#f2c94c");
    },
    rack(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS - 12;
      R(x, y, 12, 26, "#1f2638");
      outline(x, y, 12, 26);
      for (let i = 0; i < 6; i++) R(x + 2, y + 3 + i * 4, 8, 2, "#2c3650");
      shadowBelow(x, y + 26, 12);
    },
    coffee(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS - 6;
      R(x, y, 12, 20, "#d9d9d9");
      R(x + 2, y + 3, 8, 5, "#3e4148");
      R(x + 4, y + 11, 4, 5, "#2b1a12");
      R(x + 4, y + 15, 4, 2, "#ffffff");
      outline(x, y, 12, 20);
      shadowBelow(x, y + 20, 12);
    },
    vending(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 12;
      R(x, y, 14, 26, "#c0504d");
      R(x + 2, y + 3, 10, 14, "#bfe7f5");
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          R(x + 3 + j * 3, y + 4 + i * 4, 2, 3, ["#f2c94c", "#57b86a", "#4f81bd"][(i + j) % 3]);
      R(x + 3, y + 20, 8, 3, "#3e4148");
      outline(x, y, 14, 26);
      shadowBelow(x, y + 26, 14);
    },
    sofa(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 2,
        w = o.w * TS - 2;
      R(x, y, w, 8, "#5b7fa8");
      R(x, y + 8, w, 9, "#6f93bd");
      R(x, y + 2, 4, 15, "#4d6d92");
      R(x + w - 4, y + 2, 4, 15, "#4d6d92");
      outline(x, y, w, 17);
      const step = Math.floor((w - 8) / 3);
      for (let i = x + 4 + step; i < x + w - 4; i += step) R(i, y + 9, 1, 7, "#4d6d92");
      for (let i = x + 5; i < x + w - 5; i += step) R(i, y + 9, step - 3, 1, "#8fb0d6");
      R(x + 5, y + 3, 6, 5, "#f2c94c");
      R(x + 6, y + 4, 4, 1, "#ffe48a");
      outline(x + 5, y + 3, 6, 5);
      shadowBelow(x, y + 17, w);
    },
    beanbag(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS + 3;
      g.fillStyle = "#e9a23a";
      g.beginPath();
      g.ellipse(x + 6, y + 6, 7, 6, 0, 0, 7);
      g.fill();
      g.strokeStyle = INK;
      g.beginPath();
      g.ellipse(x + 6, y + 6, 7.5, 6.5, 0, 0, 7);
      g.stroke();
      R(x + 3, y + 2, 3, 2, "#f6c46a");
    },
    arcade(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 12;
      R(x, y, 14, 26, "#3b2f6b");
      R(x + 2, y + 3, 10, 8, "#111111");
      R(x + 1, y + 13, 12, 4, "#5c4b9c");
      R(x + 3, y + 14, 2, 2, "#e05f5f");
      R(x + 8, y + 14, 2, 2, "#f2c94c");
      outline(x, y, 14, 26);
      shadowBelow(x, y + 26, 14);
    },
    pingpong(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS + 2,
        w = o.w * TS - 4,
        h = o.h * TS - 6;
      R(x, y, w, h, "#2f7a5a");
      R(x + w / 2, y, 1, h, "#ffffff");
      R(x, y + h / 2, w, 1, "rgba(255,255,255,0.65)");
      outline(x, y, w, h);
      R(x + 2, y + h, 2, 4, INK);
      R(x + w - 4, y + h, 2, 4, INK);
    },
    stage(o) {
      const x = o.tx * TS,
        y = o.ty * TS + 2,
        w = o.w * TS,
        h = o.h * TS - 4;
      R(x, y, w, h, "#4a2f52");
      R(x, y + h - 4, w, 4, "#352240");
      for (let i = x + 4; i < x + w; i += 8) R(i, y + 2, 4, 1, "#6a4572");
      outline(x, y, w, h);
    },
    poster(o) {
      const x = o.tx * TS + 4,
        y = o.ty * TS + 1,
        w = o.w * TS - 8;
      R(x, y, w, 12, "#ffd36b");
      R(x + 2, y + 2, w - 4, 5, "#e05f9b");
      R(x + 2, y + 8, w - 10, 1, INK);
      R(x + 2, y + 10, w - 14, 1, INK);
      outline(x, y, w, 12);
    },
    mic(o) {
      const x = o.tx * TS + 7,
        y = o.ty * TS - 4;
      R(x, y + 4, 1, 14, "#3e4148");
      R(x - 3, y + 17, 7, 1, "#3e4148");
      R(x - 1, y, 3, 5, "#8a8f97");
      outline(x - 1, y, 3, 5);
    },
    spot(o) {
      const x = o.tx * TS + 4,
        y = o.ty * TS - 6;
      R(x + 3, y + 8, 1, 12, "#3e4148");
      R(x, y + 19, 7, 1, "#3e4148");
      R(x, y, 8, 8, "#5d6168");
      outline(x, y, 8, 8);
      R(x + 2, y + 2, 4, 4, "#fff3c4");
    },
    camera(o) {
      const x = o.tx * TS + 3,
        y = o.ty * TS - 6;
      R(x + 4, y + 9, 1, 11, "#3e4148");
      R(x, y + 19, 9, 1, "#3e4148");
      R(x, y + 2, 10, 7, "#3e4148");
      R(x + 10, y + 3, 3, 5, "#5d6168");
      R(x + 2, y, 4, 2, "#5d6168");
      outline(x, y + 2, 10, 7);
      R(x + 2, y + 4, 2, 2, "#e05f5f");
    },
    dogbed(o) {
      // the spaniel's cushion: a round basket with a soft pillow
      const x = o.tx * TS + 1,
        y = o.ty * TS + 3;
      R(x + 1, y, 12, 11, "#7a4a2c");
      R(x, y + 1, 14, 9, "#7a4a2c");
      R(x + 2, y + 2, 10, 7, "#c45b6a");
      R(x + 3, y + 3, 8, 4, "#e07f8c");
      outline(x + 1, y, 12, 11);
      R(x, y + 1, 1, 9, INK);
      R(x + 13, y + 1, 1, 9, INK);
      R(x + 4, y + 8, 2, 1, "#fbf3df");
      R(x + 8, y + 8, 2, 1, "#fbf3df");
    },
    // ── themed furnishing ───────────────────────────────────────────────
    corkboard(o) {
      // Insight's evidence board: notes, photos and red string between them
      const x = o.tx * TS + 1,
        y = o.ty * TS + 1;
      R(x, y, 14, 11, "#b98a54");
      R(x + 1, y + 1, 12, 9, "#d4a86c");
      outline(x, y, 14, 11);
      const pins: [number, number, string][] = [
        [3, 3, "#fbf3df"],
        [9, 2, "#9ad0ec"],
        [6, 6, "#ffe48a"],
        [10, 7, "#fbf3df"],
      ];
      for (const [px, py, c] of pins) {
        R(x + px - 1, y + py, 3, 3, c);
        R(x + px, y + py, 1, 1, "#e5484d");
      }
      g.strokeStyle = "#c0392b";
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x + 3.5, y + 3.5);
      g.lineTo(x + 9.5, y + 2.5);
      g.lineTo(x + 6.5, y + 6.5);
      g.lineTo(x + 10.5, y + 7.5);
      g.stroke();
    },
    cabinet(o) {
      // filing cabinet: three drawers with labels and handles
      const x = o.tx * TS + 2,
        y = o.ty * TS - 8;
      R(x, y, 12, 22, "#7d8794");
      R(x, y, 12, 2, "#a3adb8");
      outline(x, y, 12, 22);
      for (let i = 0; i < 3; i++) {
        const dy = y + 3 + i * 6;
        R(x + 1, dy, 10, 5, "#8f99a6");
        R(x + 1, dy + 4, 10, 1, "#66707c");
        R(x + 3, dy + 1, 4, 2, "#fbf3df");
        R(x + 8, dy + 2, 2, 1, INK);
      }
      shadowBelow(x, y + 22, 12);
    },
    armchair(o) {
      // reading chair, leather, with a folded blanket
      const x = o.tx * TS + 1,
        y = o.ty * TS - 2;
      R(x, y, 14, 7, "#8a3a2e");
      R(x + 1, y + 1, 12, 2, "#a9503f");
      R(x, y + 7, 14, 8, "#9e4636");
      R(x, y + 3, 3, 12, "#7a3127");
      R(x + 11, y + 3, 3, 12, "#7a3127");
      R(x + 4, y + 8, 6, 3, "#c86a55");
      R(x + 3, y + 12, 6, 2, "#4f81bd");
      outline(x, y, 14, 15);
      shadowBelow(x, y + 15, 14);
    },
    floorlamp(o) {
      const x = o.tx * TS + 7,
        y = o.ty * TS - 12;
      R(x - 4, y, 9, 6, "#f2d48a");
      R(x - 3, y + 1, 7, 1, "#fff3c4");
      R(x - 4, y + 5, 9, 1, "#c9a65a");
      outline(x - 4, y, 9, 6);
      R(x, y + 6, 1, 19, "#3e4148");
      R(x - 3, y + 24, 7, 2, "#3e4148");
    },
    catalog(o) {
      // card catalogue: a grid of tiny brass-handled drawers
      const x = o.tx * TS + 1,
        y = o.ty * TS - 6;
      R(x, y, 14, 20, "#8a5631");
      R(x, y, 14, 2, "#a86c40");
      outline(x, y, 14, 20);
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 3; c++) {
          R(x + 2 + c * 4, y + 3 + r * 4, 3, 3, "#c08550");
          R(x + 3 + c * 4, y + 4 + r * 4, 1, 1, "#f2c94c");
        }
      shadowBelow(x, y + 20, 14);
    },
    lectern(o) {
      // reading stand with an open book
      const x = o.tx * TS + 3,
        y = o.ty * TS;
      R(x + 4, y + 6, 3, 8, "#7a4a2c");
      R(x + 1, y + 13, 9, 2, "#5a3520");
      R(x, y + 1, 11, 6, "#8a5631");
      R(x + 1, y, 4, 5, "#fbf3df");
      R(x + 6, y, 4, 5, "#f1e6cc");
      R(x + 5, y, 1, 5, "#c9b48a");
      for (let i = 0; i < 3; i++) {
        R(x + 2, y + 1 + i, 2, 1 * (i % 2), "#9a8a70");
        R(x + 7, y + 1 + i, 2, 1 * ((i + 1) % 2), "#9a8a70");
      }
      outline(x, y, 11, 7);
    },
    ladder(o) {
      // library ladder leaning on the shelves
      const x = o.tx * TS + 4,
        y = o.ty * TS - 12;
      R(x, y, 1, 26, "#7a4a2c");
      R(x + 7, y, 1, 26, "#7a4a2c");
      for (let i = 2; i < 26; i += 5) R(x, y + i, 8, 1, "#a86c40");
    },
    papers(o) {
      // a few sheets left on the floor
      const x = o.tx * TS + 3,
        y = o.ty * TS + 6;
      R(x, y, 6, 4, "#fbf3df");
      R(x + 4, y + 2, 6, 4, "#f1e6cc");
      R(x + 1, y + 1, 3, 1, "#b8a888");
      R(x + 5, y + 3, 4, 1, "#b8a888");
    },
    stickies(o) {
      // Metric's wall of sticky notes in a loose grid
      const x = o.tx * TS + 2,
        y = o.ty * TS + 1,
        w = o.w * TS - 4;
      const c = ["#ffe48a", "#ff9fb8", "#9ad0ec", "#b6e58a"];
      let k = 0;
      for (let yy = 0; yy < 3; yy++)
        for (let xx = 0; xx < Math.floor(w / 5); xx++) {
          if (rnd() < 0.18) continue;
          R(x + xx * 5, y + yy * 4, 4, 3, c[k++ % c.length]);
          R(x + xx * 5 + 1, y + yy * 4 + 1, 2, 1, "rgba(42,32,52,0.35)");
        }
    },
    chartstand(o) {
      // flip-chart easel with a bar chart
      const x = o.tx * TS + 2,
        y = o.ty * TS - 10;
      R(x + 1, y + 14, 1, 10, "#5a3520");
      R(x + 10, y + 14, 1, 10, "#5a3520");
      R(x, y, 12, 15, "#fbfbf7");
      outline(x, y, 12, 15);
      for (const [i, h, c] of [
        [0, 4, "#4f81bd"],
        [1, 7, "#57b86a"],
        [2, 5, "#f2c94c"],
        [3, 9, "#e05f5f"],
      ] as const)
        R(x + 2 + i * 2, y + 12 - h, 1, h, c);
      R(x + 1, y + 12, 10, 1, INK);
    },
    plotter(o) {
      // plotter printing a long chart
      const x = o.tx * TS + 1,
        y = o.ty * TS - 2;
      R(x, y, 14, 8, "#d9dee3");
      R(x, y, 14, 2, "#eef2f3");
      outline(x, y, 14, 8);
      R(x + 2, y + 3, 4, 2, "#3e4148");
      R(x + 9, y + 3, 3, 1, "#57d98a");
      R(x + 2, y + 8, 10, 7, "#fbfbf7");
      g.strokeStyle = "#4f81bd";
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(x + 3, y + 13);
      g.lineTo(x + 6, y + 10);
      g.lineTo(x + 8, y + 12);
      g.lineTo(x + 11, y + 9);
      g.stroke();
      shadowBelow(x, y + 15, 14);
    },
    holotable(o) {
      // round projector table (the hologram itself is animated in drawDynamic)
      const cx = o.tx * TS + 8,
        cy = o.ty * TS + 10;
      g.fillStyle = "#3e4148";
      g.beginPath();
      g.ellipse(cx, cy, 7, 4, 0, 0, 7);
      g.fill();
      g.fillStyle = "#1b2a4d";
      g.beginPath();
      g.ellipse(cx, cy - 1, 5, 2.5, 0, 0, 7);
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(cx, cy, 7.5, 4.5, 0, 0, 7);
      g.stroke();
      R(cx - 1, cy + 4, 2, 3, "#3e4148");
    },
    press(o) {
      // Forge's printing press — paper goes in, documents come out
      const x = o.tx * TS + 1,
        y = o.ty * TS - 10,
        w = o.w * TS - 2;
      R(x + 2, y, 3, 22, "#4a4e55");
      R(x + w - 5, y, 3, 22, "#4a4e55");
      R(x, y, w, 4, "#5d6168");
      outline(x, y, w, 4);
      R(x + w / 2 - 1, y + 4, 2, 5, "#8a8f97");
      R(x + 5, y + 9, w - 10, 3, "#8a8f97");
      outline(x + 5, y + 9, w - 10, 3);
      box(x, y + 14, w, 10, "#9a6a43", "#6e4a2e", 4);
      R(x + 7, y + 15, w - 14, 2, "#fbf3df");
      R(x + w - 6, y + 5, 4, 4, "#c4562a");
      outline(x + w - 6, y + 5, 4, 4);
      shadowBelow(x, y + 24, w);
    },
    paperstack(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS - 2;
      for (let i = 0; i < 5; i++) {
        const off = i % 2;
        R(x + off, y + 12 - i * 3, 11, 3, i % 2 ? "#fbf3df" : "#f1e6cc");
        R(x + off, y + 14 - i * 3, 11, 1, "#c9b48a");
      }
      outline(x, y, 12, 15);
      R(x + 3, y + 1, 6, 1, "#e05f5f");
    },
    grindstone(o) {
      const cx = o.tx * TS + 8,
        cy = o.ty * TS + 6;
      R(cx - 6, cy + 4, 12, 6, "#7a4a2c");
      outline(cx - 6, cy + 4, 12, 6);
      g.fillStyle = "#9b958c";
      g.beginPath();
      g.arc(cx, cy, 6, 0, 7);
      g.fill();
      g.fillStyle = "#7d776f";
      g.beginPath();
      g.arc(cx, cy, 2, 0, 7);
      g.fill();
      g.strokeStyle = INK;
      g.beginPath();
      g.arc(cx, cy, 6.5, 0, 7);
      g.stroke();
      R(cx + 6, cy - 1, 4, 1, "#5a3520");
    },
    coal(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS + 6;
      for (const [dx, dy, c] of [
        [0, 4, "#2a2a2a"],
        [3, 2, "#3a3636"],
        [6, 4, "#2a2a2a"],
        [9, 3, "#3a3636"],
        [4, 6, "#1e1c1c"],
        [7, 0, "#3a3636"],
      ] as const)
        R(x + dx, y + dy, 4, 3, c);
      R(x + 4, y + 3, 1, 1, "#8a8f97");
    },
    blueprint(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS + 1,
        w = o.w * TS - 4;
      R(x, y, w, 11, "#2f5f9e");
      outline(x, y, w, 11);
      g.strokeStyle = "#cfe3ff";
      g.lineWidth = 0.6;
      g.strokeRect(x + 3.5, y + 2.5, 10, 6);
      g.beginPath();
      g.moveTo(x + 3.5, y + 5.5);
      g.lineTo(x + 13.5, y + 5.5);
      g.moveTo(x + 17, y + 3);
      g.lineTo(x + w - 3, y + 3);
      g.moveTo(x + 17, y + 6);
      g.lineTo(x + w - 6, y + 6);
      g.stroke();
      g.beginPath();
      g.arc(x + w - 6, y + 8, 2, 0, 7);
      g.stroke();
    },
    reactor(o) {
      // J.A.R.V.I.S.'s arc-reactor pillar (the glow pulses in drawDynamic)
      const x = o.tx * TS + 3,
        y = o.ty * TS - 12;
      R(x, y + 22, 10, 4, "#4a4e55");
      R(x + 1, y, 8, 22, "#5d6168");
      R(x + 2, y + 1, 2, 20, "#8a8f97");
      outline(x + 1, y, 8, 22);
      outline(x, y + 22, 10, 4);
      R(x + 3, y + 6, 4, 10, "#1b2a4d");
      outline(x + 3, y + 6, 4, 10);
    },
    clock(o) {
      // wall clock face — hands are drawn live (real local time)
      const cx = o.tx * TS + 8,
        cy = o.ty * TS + 6;
      g.fillStyle = "#fbf3df";
      g.beginPath();
      g.arc(cx, cy, 5, 0, 7);
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, 5.5, 0, 7);
      g.stroke();
      for (let i = 0; i < 4; i++)
        R(
          cx + Math.round(Math.cos((i * Math.PI) / 2) * 4),
          cy + Math.round(Math.sin((i * Math.PI) / 2) * 4),
          1,
          1,
          INK,
        );
    },
    cctv(o) {
      // Shield's camera wall: a 3×2 grid of feeds (they flicker live)
      const x = o.tx * TS + 2,
        y = o.ty * TS,
        w = o.w * TS - 4;
      R(x, y, w, 12, "#2c3650");
      outline(x, y, w, 12);
      const cw = Math.floor((w - 4) / 3);
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < 3; c++) R(x + 2 + c * cw, y + 2 + r * 5, cw - 1, 4, "#24413a");
    },
    lockers(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 10;
      R(x, y, 14, 24, "#6f7b93");
      outline(x, y, 14, 24);
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 2; c++) {
          R(x + 1 + c * 6, y + 1 + r * 7, 6, 7, "#8794ab");
          outline(x + 1 + c * 6, y + 1 + r * 7, 6, 7);
          R(x + 5 + c * 6, y + 4 + r * 7, 1, 1, "#f2c94c");
        }
      shadowBelow(x, y + 24, 14);
    },
    hazard(o) {
      // yellow-black safety stripes in front of the servers
      const x = o.tx * TS,
        y = o.ty * TS + 11,
        w = o.w * TS;
      R(x, y, w, 4, "#f2c94c");
      for (let i = 0; i < w; i += 6) R(x + i, y, 3, 4, "#2a2034");
    },
    emblem(o) {
      // the S.H.I.E.L.D. crest painted on the floor
      const cx = o.tx * TS + 16,
        cy = o.ty * TS + 16;
      g.globalAlpha = 0.55;
      g.fillStyle = "#8b97ad";
      g.beginPath();
      g.arc(cx, cy, 12, 0, 7);
      g.fill();
      g.fillStyle = "#5c677e";
      g.beginPath();
      g.moveTo(cx, cy - 8);
      g.lineTo(cx + 7, cy - 4);
      g.lineTo(cx + 5, cy + 5);
      g.lineTo(cx, cy + 9);
      g.lineTo(cx - 5, cy + 5);
      g.lineTo(cx - 7, cy - 4);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      R(cx - 1, cy - 4, 2, 8, "#aab4c8");
      R(cx - 4, cy - 1, 8, 2, "#aab4c8");
    },
    extinguisher(o) {
      const x = o.tx * TS + 5,
        y = o.ty * TS - 2;
      R(x, y + 3, 6, 13, "#d0362f");
      R(x + 1, y + 4, 1, 10, "#ef6a5f");
      outline(x, y + 3, 6, 13);
      R(x + 1, y, 4, 3, "#3e4148");
      R(x + 5, y + 1, 3, 1, "#3e4148");
      R(x + 1, y + 8, 4, 3, "#fbf3df");
    },
    photo(o) {
      // a framed photo of the owner with Marvel
      const x = o.tx * TS + 6,
        y = o.ty * TS + 1;
      R(x, y, 20, 12, "#c9a46a");
      R(x + 2, y + 2, 16, 8, "#9fd3ec");
      R(x + 2, y + 7, 16, 3, "#78c25a");
      outline(x, y, 20, 12);
      // owner
      R(x + 6, y + 3, 3, 3, "#f1c9a5");
      R(x + 6, y + 2, 3, 1, "#5a3520");
      R(x + 5, y + 6, 5, 4, "#3f7a8c");
      // spaniel
      R(x + 11, y + 6, 5, 3, "#a8642e");
      R(x + 14, y + 4, 3, 3, "#a8642e");
      R(x + 13, y + 5, 1, 3, "#7a4420");
      R(x + 16, y + 5, 1, 1, INK);
    },
    toys(o) {
      // Marvel's chew toys: a bone and a rope
      const x = o.tx * TS + 3,
        y = o.ty * TS + 8;
      R(x, y, 6, 2, "#f3e6c8");
      R(x - 1, y - 1, 2, 4, "#f3e6c8");
      R(x + 5, y - 1, 2, 4, "#f3e6c8");
      R(x + 3, y + 4, 7, 2, "#e05f5f");
      R(x + 5, y + 4, 2, 2, "#4f81bd");
    },
    neon(o) {
      // ON AIR sign — lit live in drawDynamic when Herald is working
      const x = o.tx * TS + 2,
        y = o.ty * TS + 2,
        w = o.w * TS - 4;
      R(x, y, w, 9, "#2a1830");
      outline(x, y, w, 9);
    },
    softbox(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS - 10;
      R(x, y, 12, 9, "#fbfbf7");
      R(x + 1, y + 1, 10, 7, "#fff3c4");
      outline(x, y, 12, 9);
      R(x + 5, y + 9, 2, 14, "#3e4148");
      R(x + 1, y + 22, 10, 2, "#3e4148");
    },
    editdesk(o) {
      // editing desk: two screens with a timeline, headphones
      const x = o.tx * TS + 1,
        y = o.ty * TS + 2,
        w = o.w * TS - 2;
      box(x, y, w, 12, "#4a3a5a", "#352a42", 6);
      R(x + 3, y - 8, 11, 8, INK);
      R(x + 4, y - 7, 9, 5, "#3b2f6b");
      R(x + 16, y - 8, 11, 8, INK);
      R(x + 17, y - 7, 9, 5, "#3b2f6b");
      for (let i = 0; i < 4; i++)
        R(x + 5 + i * 5, y + 2, 4, 2, ["#e05f9b", "#4fd8f0", "#f2c94c", "#57d98a"][i]);
      R(x + w - 6, y - 3, 4, 3, "#2a2034");
      shadowBelow(x, y + 12, w);
    },
    socialwall(o) {
      // Herald's wall of likes, hearts and follower counts
      const x = o.tx * TS + 2,
        y = o.ty * TS + 1,
        w = o.w * TS - 4;
      R(x, y, w, 11, "#fbfbf7");
      outline(x, y, w, 11);
      for (let i = 0; i < 4; i++) {
        const bx = x + 2 + i * 7;
        R(bx, y + 2, 5, 4, ["#e05f9b", "#4f81bd", "#f2c94c", "#57b86a"][i]);
        R(bx + 1, y + 7, 4, 1, "#a59a8c");
      }
      R(x + 3, y + 3, 1, 1, "#fbfbf7");
      R(x + 5, y + 3, 1, 1, "#fbfbf7");
    },
    // ── common areas ──────────────────────────────────────────────────
    fridge(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 12;
      R(x, y, 14, 26, "#e8eef2");
      R(x, y + 9, 14, 1, "#aab8bf");
      outline(x, y, 14, 26);
      R(x + 11, y + 3, 1, 4, "#8a8f97");
      R(x + 11, y + 12, 1, 7, "#8a8f97");
      R(x + 3, y + 13, 3, 3, "#ffe48a");
      R(x + 6, y + 15, 3, 2, "#ff9fb8");
      shadowBelow(x, y + 26, 14);
    },
    counter(o) {
      // kitchen counter with a sink, a kettle and a microwave
      const x = o.tx * TS,
        y = o.ty * TS - 2,
        w = o.w * TS;
      box(x, y, w, 16, "#e9dcc0", "#a8724b", 5);
      R(x + 3, y + 1, 8, 3, "#9fb4c0");
      outline(x + 3, y + 1, 8, 3);
      R(x + 6, y - 2, 1, 3, "#8a8f97");
      R(x + 14, y - 6, 12, 7, "#d9d9d9");
      R(x + 15, y - 5, 7, 5, "#3e4148");
      outline(x + 14, y - 6, 12, 7);
      for (let i = 0; i < 3; i++) R(x + 4 + i * 9, y + 8, 6, 6, "#b8824f");
      for (let i = 0; i < 3; i++) R(x + 6 + i * 9, y + 10, 2, 1, "#5a3520");
      shadowBelow(x, y + 16, w);
    },
    watercooler(o) {
      const x = o.tx * TS + 4,
        y = o.ty * TS - 8;
      R(x + 1, y, 6, 8, "#8fcbea");
      R(x + 2, y + 1, 2, 5, "#c6e8f8");
      outline(x + 1, y, 6, 8);
      R(x, y + 8, 8, 14, "#e8eef2");
      outline(x, y + 8, 8, 14);
      R(x + 2, y + 11, 1, 2, "#4f81bd");
      R(x + 5, y + 11, 1, 2, "#e05f5f");
      shadowBelow(x, y + 22, 8);
    },
    aquarium(o) {
      // fish tank on a cabinet (fish and bubbles swim in drawDynamic)
      const x = o.tx * TS + 1,
        y = o.ty * TS,
        h = o.h * TS - 2;
      R(x, y + h - 8, 14, 8, "#5a3520");
      outline(x, y + h - 8, 14, 8);
      R(x, y, 14, h - 8, "#3e7fb8");
      R(x + 1, y + 1, 12, 2, "#8fcbea");
      R(x + 1, y + h - 12, 12, 3, "#d4b483");
      R(x + 3, y + h - 17, 1, 5, "#3f8a3a");
      R(x + 10, y + h - 19, 1, 7, "#3f8a3a");
      outline(x, y, 14, h - 8);
    },
    stool(o) {
      const x = o.tx * TS + 5,
        y = o.ty * TS + 5;
      R(x, y, 6, 3, "#c0504d");
      outline(x, y, 6, 3);
      R(x + 1, y + 3, 1, 5, "#3e4148");
      R(x + 4, y + 3, 1, 5, "#3e4148");
    },
    foosball(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS + 1,
        w = o.w * TS - 2;
      box(x, y, w, 12, "#57b86a", "#5a3520", 9);
      R(x + 1, y + 4, w - 2, 1, "rgba(255,255,255,0.6)");
      for (let i = 0; i < 4; i++) {
        R(x + 4 + i * 7, y - 1, 1, 11, "#a8b0ba");
        R(x + 3 + i * 7, y + 2 + (i % 2) * 3, 3, 2, i % 2 ? "#e05f5f" : "#4f81bd");
      }
      R(x + 2, y + 12, 2, 3, "#3e2618");
      R(x + w - 4, y + 12, 2, 3, "#3e2618");
    },
    jukebox(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 12;
      R(x, y + 4, 14, 22, "#8a3a2e");
      g.fillStyle = "#c0504d";
      g.beginPath();
      g.arc(x + 7, y + 6, 7, Math.PI, 0);
      g.fill();
      R(x + 2, y + 6, 10, 8, "#ffe48a");
      for (let i = 0; i < 4; i++) R(x + 3 + i * 2, y + 7, 1, 6, "#e9a23a");
      R(x + 2, y + 16, 10, 6, "#3e4148");
      R(x + 3, y + 17, 8, 1, "#e05f9b");
      outline(x, y + 4, 14, 22);
      shadowBelow(x, y + 26, 14);
    },
    tvconsole(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 10,
        w = o.w * TS - 2;
      R(x + 2, y, w - 4, 14, INK);
      R(x + 3, y + 1, w - 6, 12, "#1b2a4d");
      R(x + w / 2 - 1, y + 14, 2, 2, INK);
      box(x, y + 16, w, 8, "#6e4a2e", "#4a3220", 3);
      R(x + 4, y + 19, 6, 2, "#d9d9d9");
      R(x + w - 10, y + 19, 6, 2, "#3e4148");
      shadowBelow(x, y + 24, w);
    },
    // ── garden ────────────────────────────────────────────────────────
    bush(o) {
      const x = o.tx * TS + 8,
        y = o.ty * TS + 9;
      for (const [c, r, off] of [
        [INK, 7.5, 0],
        ["#3f8a3a", 7, 0],
        ["#5fb352", 4, 2],
      ] as const) {
        g.fillStyle = c;
        g.beginPath();
        g.arc(x - off, y - off, r, 0, 7);
        g.fill();
      }
      if (rnd() < 0.6) {
        R(x - 3, y + 1, 2, 2, "#ff7b7b");
        R(x + 2, y - 2, 2, 2, "#ffd34d");
      }
    },
    flowerbed(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS + 3,
        w = o.w * TS - 2;
      R(x, y, w, 10, "#7a4a2c");
      R(x + 1, y + 1, w - 2, 8, "#5a3520");
      outline(x, y, w, 10);
      const cols = ["#ff7b7b", "#ffd34d", "#fff7e8", "#c38bff", "#ff9fb8"];
      for (let i = x + 3; i < x + w - 3; i += 4) {
        R(i, y + 3, 1, 4, "#3f8a3a");
        R(i - 1, y + 2, 3, 2, cols[Math.floor(rnd() * cols.length)]);
      }
    },
    lamppost(o) {
      const x = o.tx * TS + 7,
        y = o.ty * TS - 10;
      R(x - 3, y, 7, 6, "#3e4148");
      R(x - 2, y + 1, 5, 4, "#fff3c4");
      outline(x - 3, y, 7, 6);
      R(x, y + 6, 1, 18, "#3e4148");
      R(x - 2, y + 23, 5, 2, "#3e4148");
    },
    tree(o) {
      const x = o.tx * TS,
        y = o.ty * TS;
      R(x + 13, y + 20, 6, 10, "#7a4a2c");
      outline(x + 13, y + 20, 6, 10);
      const blobs = [
        [16, 10, 11],
        [9, 15, 8],
        [23, 15, 8],
        [16, 18, 9],
      ];
      for (const [color, grow, off] of [
        [INK, 1, 0],
        ["#3f8a3a", 0, 0],
        ["#5fb352", -0.4, 2],
      ] as const) {
        g.fillStyle = color;
        for (const [bx, by, r] of blobs) {
          g.beginPath();
          g.arc(x + bx - off, y + by - off, grow < 0 ? r * 0.6 : r + grow, 0, 7);
          g.fill();
        }
      }
    },
  };

  for (let ty = 0; ty < TH; ty++)
    for (let tx = 0; tx < TW; tx++) {
      const v = grid[ty][tx];
      if (v === GRASS) grass(tx * TS, ty * TS);
      else if (v === FLOOR) {
        const room = ROOMS[roomOf[ty][tx] as TownSlug];
        floor(tx * TS, ty * TS, room ? room.floor : "hall", tx, ty);
      }
    }
  for (let y = 30; y < 32; y++)
    for (let x = 21; x <= 22; x++) {
      R(x * TS, y * TS, 16, 16, "#c9a46a");
      R(x * TS + 3, y * TS + 5, 2, 1, "#b38a52");
      R(x * TS + 10, y * TS + 11, 2, 1, "#b38a52");
    }
  for (let ty = 0; ty < TH; ty++)
    for (let tx = 0; tx < TW; tx++) {
      if (grid[ty][tx] !== FLOOR) continue;
      const up = ty > 0 ? grid[ty - 1][tx] : GRASS;
      const left = tx > 0 ? grid[ty][tx - 1] : GRASS;
      if (up === CAP || up === FACE) R(tx * TS, ty * TS, 16, 3, "rgba(30,16,30,0.22)");
      if (left === CAP) R(tx * TS, ty * TS, 3, 16, "rgba(30,16,30,0.16)");
    }
  for (let ty = 0; ty < TH; ty++)
    for (let tx = 0; tx < TW; tx++) {
      if (grid[ty][tx] === CAP) cap(tx, ty);
      else if (grid[ty][tx] === FACE) face(tx, ty);
    }
  for (const [x, y] of DOORS)
    if (y === 10 || y === 29) R(x * TS, y * TS + 12, 16, 2, "rgba(30,16,30,0.2)");
  const flat = (k: string) => k === "rug" || k === "stage" || k === "mat";
  const order = OBJECTS.slice().sort(
    (a, b) => Number(flat(b.kind)) - Number(flat(a.kind)) || a.ty - b.ty,
  );
  for (const o of order) PAINT[o.kind]?.(o);
  return stat;
}

// ── animated details (drawn every frame onto the world buffer) ─────────────
/** A tiny ♪ for the jukebox. */
function drawNote(f: CanvasRenderingContext2D, x: number, y: number) {
  f.fillStyle = "#ffe48a";
  f.fillRect(Math.round(x), Math.round(y) + 3, 2, 2);
  f.fillRect(Math.round(x) + 1, Math.round(y), 1, 4);
  f.fillRect(Math.round(x) + 2, Math.round(y), 2, 1);
}

export type BoardCard = { color: string; col: 0 | 1 | 2 };
export function drawDynamic(
  f: CanvasRenderingContext2D,
  t: number,
  busy: (slug: TownSlug) => "idle" | "running" | "error" | "done" | "off",
  cards: readonly BoardCard[],
) {
  const F = (x: number, y: number, w: number, h: number, c: string) => {
    f.fillStyle = c;
    f.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const find = (k: TownObject["kind"]) => OBJECTS.find((o) => o.kind === k)!;
  // lab wall screens
  const ws = find("wallscreens");
  const mOn = busy("metric") === "running";
  for (let s = 0; s < 3; s++) {
    const x = ws.tx * TS + 2 + s * 21,
      y = ws.ty * TS + 1;
    F(x, y, 18, 11, "#0c2318");
    f.strokeStyle = INK;
    f.lineWidth = 1;
    f.strokeRect(x + 0.5, y + 0.5, 17, 10);
    for (let i = 0; i < 5; i++) {
      const h = 2 + Math.abs(Math.sin(i * 1.7 + s + (mOn ? t / 380 : 0))) * 6;
      F(x + 2 + i * 3, y + 9 - h, 2, h, i % 2 ? "#57d98a" : "#2f8a57");
    }
  }
  // monitors
  for (const o of OBJECTS) {
    if (o.kind !== "desk" || !o.opt.monitor) continue;
    const x = o.tx * TS + 1 + (o.w * TS - 2) / 2 - 5,
      y = o.ty * TS - 5;
    const owner: TownSlug = o.opt.cams ? "shield" : o.tx === 19 ? "user" : "metric";
    F(x, y, 10, 7, owner === "user" || busy(owner) === "running" ? "#4fd8f0" : "#1d3b4a");
    if (o.opt.cams) {
      F(x + 1, y + 1, 4, 2, "#2c3650");
      F(x + 5, y + 4, 4, 2, "#2c3650");
    } else
      for (let i = 0; i < 3; i++)
        F(x + 1, y + 1 + i * 2, 2 + ((Math.floor(t / 300) + i * 3) % 7), 1, "#e4f8ff");
  }
  // furnace fire
  const fu = find("furnace");
  const hot = busy("forge") === "running";
  for (let i = 0; i < 7; i++) {
    const h = 3 + Math.abs(Math.sin(t / 120 + i * 1.3)) * (hot ? 8 : 4);
    F(fu.tx * TS + 8 + i * 2, fu.ty * TS + 9 - h, 2, h, i % 2 ? "#ff9a3c" : "#ffd04d");
  }
  if (hot) {
    f.fillStyle = "rgba(255,170,60,0.12)";
    f.fillRect(fu.tx * TS - 8, fu.ty * TS, 56, 30);
    for (let i = 0; i < 3; i++) {
      const k = (t / 90 + i * 9) % 14;
      F(33 * TS + 6 + Math.sin(i * 7 + t / 160) * 5, 6 * TS + 2 - k, 1, 1, "#ffd08a");
    }
  }
  // server LEDs
  const sh = busy("shield");
  for (const o of OBJECTS) {
    if (o.kind !== "rack") continue;
    for (let i = 0; i < 6; i++) {
      const on = Math.sin(t / 170 + i * 2.1 + o.tx) > (sh === "running" ? -0.3 : 0.45);
      const err = sh === "error" && i === 2;
      const y = o.ty * TS - 9 + i * 4;
      F(
        o.tx * TS + 4,
        y,
        1,
        1,
        err ? (Math.floor(t / 300) % 2 ? "#ff5d5d" : "#5a1a1a") : on ? "#57d98a" : "#1b2a4d",
      );
      F(o.tx * TS + 6, y, 1, 1, on ? "#4fd8f0" : "#1b2a4d");
    }
  }
  // studio spotlight
  if (busy("herald") === "running") {
    f.fillStyle = "rgba(255,243,196,0.16)";
    f.beginPath();
    f.moveTo(39 * TS + 6, 24 * TS - 2);
    f.lineTo(34 * TS, 26 * TS + 6);
    f.lineTo(37 * TS, 26 * TS + 10);
    f.closePath();
    f.fill();
  }
  // coffee steam + arcade screens
  for (const o of OBJECTS) {
    if (o.kind === "coffee") {
      const k = (t / 260) % 6;
      F(
        o.tx * TS + 6 + Math.sin(t / 300) * 1.5,
        o.ty * TS - 8 - k,
        1,
        2,
        `rgba(255,255,255,${0.6 - k / 10})`,
      );
    } else if (o.kind === "arcade") {
      for (let i = 0; i < 3; i++)
        F(
          o.tx * TS + 3 + ((Math.floor(t / 200) + i * 3) % 8),
          o.ty * TS - 8 + i * 2,
          2,
          1,
          ["#ff6fb5", "#ffd36b", "#4fd8f0"][i],
        );
    }
  }
  // Metric's holo table: a rotating bar chart over the projector
  const ht = find("holotable");
  {
    const cx = ht.tx * TS + 8,
      cy = ht.ty * TS + 8;
    const spin = t / (mOn ? 260 : 900);
    f.globalAlpha = 0.75;
    for (let i = 0; i < 5; i++) {
      const a = spin + (i * Math.PI * 2) / 5;
      const dx = Math.cos(a) * 4;
      const depth = Math.sin(a);
      const h = 3 + ((i * 3 + Math.floor(t / 700)) % 5);
      F(cx + dx - 1, cy - 2 - h - depth, 2, h, depth > 0 ? "#7ff0ff" : "#3fb6d0");
    }
    f.globalAlpha = 0.25;
    F(cx - 6, cy - 12, 12, 10, "#4fd8f0");
    f.globalAlpha = 1;
  }
  // J.A.R.V.I.S.'s reactor: a steady glow, brighter and faster while he works
  const re = find("reactor");
  {
    const jOn = busy("jarvis") === "running";
    const k = (Math.sin(t / (jOn ? 160 : 600)) + 1) / 2;
    const x = re.tx * TS + 6,
      y = re.ty * TS - 6;
    F(x, y, 4, 10, jOn ? "#bff6ff" : "#7fdcf0");
    f.globalAlpha = 0.25 + k * 0.35;
    F(x - 2, y - 2, 8, 14, "#4fd8f0");
    f.globalAlpha = 1;
    F(x + 1, y + 1 + Math.floor(k * 7), 2, 1, "#ffffff");
  }
  // wall clock with the real local time
  const cl = find("clock");
  {
    const now = new Date();
    const cx = cl.tx * TS + 8,
      cy = cl.ty * TS + 6;
    const hand = (ang: number, len: number, c: string) => {
      f.strokeStyle = c;
      f.lineWidth = 1;
      f.beginPath();
      f.moveTo(cx + 0.5, cy + 0.5);
      f.lineTo(cx + 0.5 + Math.sin(ang) * len, cy + 0.5 - Math.cos(ang) * len);
      f.stroke();
    };
    hand(((now.getHours() % 12) + now.getMinutes() / 60) * (Math.PI / 6), 2.5, INK);
    hand(now.getMinutes() * (Math.PI / 30), 4, INK);
    hand(now.getSeconds() * (Math.PI / 30), 4, "#e05f5f");
  }
  // Shield's camera feeds: a scanline rolls over each one
  const cc = find("cctv");
  {
    const x = cc.tx * TS + 2,
      y = cc.ty * TS,
      w = cc.w * TS - 4;
    const cw = Math.floor((w - 4) / 3);
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 3; c++) {
        const fx = x + 2 + c * cw,
          fy = y + 2 + r * 5;
        const line = Math.floor(t / 120 + c * 2 + r * 3) % 4;
        F(fx + 1, fy + 1, 2, 2, ["#57d98a", "#4fd8f0", "#a8e6a1"][(c + r) % 3]);
        F(fx, fy + line, cw - 1, 1, "rgba(255,255,255,0.25)");
        if (sh === "error" && c === 1 && r === 0 && Math.floor(t / 300) % 2)
          F(fx, fy, cw - 1, 4, "#5a1a1a");
      }
  }
  // ON AIR — lit while Herald is working
  const ne = find("neon");
  {
    const on = busy("herald") === "running";
    const x = ne.tx * TS + 2,
      y = ne.ty * TS + 2,
      w = ne.w * TS - 4;
    const flick = on && Math.floor(t / 90) % 23 !== 0;
    const col = flick ? "#ff4f6d" : "#5a2533";
    // "ON AIR" in 3×5 pixel letters
    const glyphs: Record<string, string[]> = {
      O: ["111", "101", "101", "101", "111"],
      N: ["101", "111", "111", "111", "101"],
      A: ["010", "101", "111", "101", "101"],
      I: ["111", "010", "010", "010", "111"],
      R: ["110", "101", "110", "101", "101"],
      " ": ["000", "000", "000", "000", "000"],
    };
    let gx = x + 2;
    for (const ch of "ON AIR") {
      const gl = glyphs[ch];
      for (let yy = 0; yy < 5; yy++)
        for (let xx = 0; xx < 3; xx++) if (gl[yy][xx] === "1") F(gx + xx, y + 2 + yy, 1, 1, col);
      gx += ch === " " ? 2 : 4;
    }
    if (flick) {
      f.globalAlpha = 0.18;
      F(x - 2, y - 2, w + 4, 13, "#ff4f6d");
      f.globalAlpha = 1;
    }
  }
  // aquarium fish and bubbles
  const aq = find("aquarium");
  {
    const x = aq.tx * TS + 2,
      y = aq.ty * TS + 3,
      span = 10;
    for (let i = 0; i < 3; i++) {
      const ph = t / (1600 + i * 500) + i * 2;
      const fx = x + ((Math.sin(ph) + 1) / 2) * (span - 3);
      const fy = y + 3 + i * 4 + Math.sin(ph * 3) * 0.6;
      const dir = Math.cos(ph) > 0 ? 1 : -1;
      F(fx, fy, 3, 2, ["#ff9a3c", "#ffd34d", "#ff6fb5"][i]);
      F(dir > 0 ? fx - 1 : fx + 3, fy, 1, 2, ["#e07a2c", "#e0b030", "#e04f95"][i]);
    }
    const bk = (t / 140) % 14;
    F(x + 8, y + 13 - bk, 1, 1, "rgba(255,255,255,0.8)");
    F(x + 3, y + 13 - ((bk + 6) % 14), 1, 1, "rgba(255,255,255,0.6)");
  }
  // Forge's press stamps while he works, with fresh sheets sliding out
  const pr = find("press");
  {
    const x = pr.tx * TS + 1,
      y = pr.ty * TS - 10,
      w = pr.w * TS - 2;
    const stroke = hot ? Math.abs(Math.sin(t / 220)) * 3 : 0;
    F(x + 5, y + 9 + stroke, w - 10, 3, "#a3a8b0");
    if (hot) F(x + w - 5, y + 18 + ((t / 200) % 4), 6, 2, "#fbf3df");
  }
  // jukebox notes, TV picture
  const jb = find("jukebox");
  for (let i = 0; i < 2; i++) {
    const k = (t / 700 + i * 0.5) % 1;
    f.globalAlpha = 1 - k;
    drawNote(f, jb.tx * TS + 4 + i * 6 + Math.sin(k * 6) * 2, jb.ty * TS - 14 - k * 10);
    f.globalAlpha = 1;
  }
  const tv = find("tvconsole");
  {
    const x = tv.tx * TS + 4,
      y = tv.ty * TS - 9,
      w = tv.w * TS - 8;
    const sc = Math.floor(t / 1500) % 3;
    F(x, y, w, 10, ["#2f6fb0", "#3f8a3a", "#7d4f8a"][sc]);
    F(x + 4 + ((t / 60) % (w - 8)), y + 6, 3, 2, "#ffd34d");
    F(x + 2, y + 8, w - 4, 1, "rgba(255,255,255,0.3)");
  }
  // task board cards
  const b = find("board");
  const bx = b.tx * TS + 1,
    by = b.ty * TS - 14,
    cw = Math.floor((b.w * TS - 6) / 3);
  const cols: BoardCard[][] = [[], [], []];
  for (const c of cards) cols[c.col].push(c);
  cols.forEach((list, ci) =>
    list.slice(-12).forEach((c, i) => {
      const x = bx + 4 + ci * cw + (i % 4) * 12,
        y = by + 8 + Math.floor(i / 4) * 6;
      F(x, y, 10, 5, c.color);
      f.strokeStyle = INK;
      f.lineWidth = 1;
      f.strokeRect(x + 0.5, y + 0.5, 9, 4);
      F(x + 4, y, 2, 1, "#e05f5f");
    }),
  );
}

// ── screen-space primitives ─────────────────────────────────────────────────
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  p: number,
  color: string,
) {
  const rows = ICON[name];
  if (!rows) return;
  ctx.fillStyle = color;
  rows.forEach((row, yy) =>
    [...row].forEach((ch, xx) => {
      if (ch === "#") ctx.fillRect(Math.round(x + xx * p), Math.round(y + yy * p), p, p);
    }),
  );
}
/** A box with notched (pixel-rounded) corners. */
export function pixelBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  u: number,
  fill: string,
  border: string,
) {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  ctx.fillStyle = border;
  ctx.fillRect(x + u, y, w - 2 * u, h);
  ctx.fillRect(x, y + u, w, h - 2 * u);
  ctx.fillStyle = fill;
  ctx.fillRect(x + u, y + u, w - 2 * u, h - 2 * u);
}
