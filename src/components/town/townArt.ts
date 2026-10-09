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
      outline(x, y, w, 11);
      R(x - 1, y + 11, w + 2, 2, "#e8dcc2");
    },
    desk(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS + 2,
        w = o.w * TS - 2;
      box(x, y, w, 12, "#c08550", "#8a5631", 6);
      R(x + 2, y + 12, 2, 2, "#5a3520");
      R(x + w - 4, y + 12, 2, 2, "#5a3520");
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
      outline(x, y, 8, 9);
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
    },
    barrel(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS;
      R(x, y + 1, 12, 14, "#9a5a32");
      R(x, y + 4, 12, 1, "#5d6168");
      R(x, y + 11, 12, 1, "#5d6168");
      R(x + 1, y, 10, 3, "#b8743f");
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
