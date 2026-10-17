// Agent Town — art for the new wings: the trading floor (Parkiet) and the
// rooms under construction. Like townArt.ts this is ARTWORK: a fixed pixel
// palette, exempt from the theme-token rule (CLAUDE.md).
//
// Static furniture paints once into the static layer (exchangePainters);
// everything that shows fund data animates per frame (drawExchange) — the
// ranking flip-board, the big NAV screen, the heat wall, the traders'
// monitors, the bull/bear statue and the bell — and the LED ticker hangs
// over the floor, drawn after the characters (drawExchangeTicker).
// With no fund data the screens idle on "BRAK DANYCH" — nothing invented.

import { OBJECTS, TS, type TownObject } from "./townMap";
import { FUND_COLOR, pctLabel, type TownFund } from "./townFund";

const INK = "#2a2034";
const GREEN = "#57e08f";
const RED = "#ff5c6c";
const GOLD = "#e3b341";
const GOLD_HI = "#ffe08a";
const GOLD_DK = "#9a6a1c";

// ── 3×5 pixel font ──────────────────────────────────────────────────────────
const GLYPHS: Record<string, string> = {
  "0": "111101101101111",
  "1": "010110010010111",
  "2": "111001111100111",
  "3": "111001111001111",
  "4": "101101111001001",
  "5": "111100111001111",
  "6": "111100111101111",
  "7": "111001010010010",
  "8": "111101111101111",
  "9": "111101111001111",
  A: "010101111101101",
  B: "110101110101110",
  C: "011100100100011",
  D: "110101101101110",
  E: "111100110100111",
  F: "111100110100100",
  G: "011100101101011",
  H: "101101111101101",
  I: "111010010010111",
  J: "001001001101010",
  K: "101110100110101",
  L: "100100100100111",
  M: "101111111101101",
  N: "101111111111101",
  O: "010101101101010",
  P: "110101110100100",
  Q: "010101101110011",
  R: "110101110101101",
  S: "011100010001110",
  T: "111010010010010",
  U: "101101101101111",
  V: "101101101101010",
  W: "101101111111101",
  X: "101101010101101",
  Y: "101101010010010",
  Z: "111001010100111",
  " ": "000000000000000",
  "+": "000010111010000",
  "-": "000000111000000",
  "%": "101001010100101",
  ".": "000000000000010",
  ",": "000000000010100",
  ":": "000010000010000",
  "/": "001001010100100",
  "▲": "000010111000000",
  "▼": "000111010000000",
};

type Fill = (x: number, y: number, w: number, h: number, c: string) => void;

export const textWidth = (text: string, s = 1): number => Math.max(0, text.length * 4 * s - s);

export function drawPixelText(F: Fill, text: string, x: number, y: number, color: string, s = 1) {
  let gx = Math.round(x);
  for (const ch of text) {
    const gl = GLYPHS[ch] ?? GLYPHS[" "];
    for (let i = 0; i < 15; i++)
      if (gl[i] === "1") F(gx + (i % 3) * s, Math.round(y) + Math.floor(i / 3) * s, s, s, color);
    gx += 4 * s;
  }
}

// ── static furniture ────────────────────────────────────────────────────────
export type PaintKit = {
  g: CanvasRenderingContext2D;
  R: Fill;
  outline: (x: number, y: number, w: number, h: number) => void;
  box: (
    x: number,
    y: number,
    w: number,
    h: number,
    top: string,
    front: string,
    topH: number,
  ) => void;
  shadowBelow: (x: number, y: number, w: number) => void;
  rnd: () => number;
};

/** A wall-mounted screen frame filling the cap + face rows of the wall. */
const wallFrame = (k: PaintKit, o: TownObject) => {
  const x = o.tx * TS + 1,
    y = o.ty * TS - 15,
    w = o.w * TS - 2;
  k.R(x, y, w, 30, "#0d1018");
  k.outline(x, y, w, 30);
  k.R(x + 1, y + 1, w - 2, 1, "#3a4060");
  k.R(x + 1, y + 28, w - 2, 1, "#05070c");
  return { x, y, w };
};

/** Diagonal hazard stripes (yellow/black) inside a rectangle. */
const hazard = (k: PaintKit, x: number, y: number, w: number, h: number) => {
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++)
      k.R(x + xx, y + yy, 1, 1, Math.floor((xx + yy) / 3) % 2 ? "#1d1a1a" : "#ffcf33");
};

export function exchangePainters(
  k: PaintKit,
): Partial<Record<TownObject["kind"], (o: TownObject) => void>> {
  const { R, outline, box, shadowBelow, rnd } = k;
  return {
    flipboard(o) {
      const { x, y, w } = wallFrame(k, o);
      // five flap rows, a hinge line through the middle of each
      for (let r = 0; r < 5; r++) {
        R(x + 2, y + 1 + r * 6, w - 4, 5, "#1b1f2c");
        R(x + 2, y + 3 + r * 6, w - 4, 1, "#0a0c12");
      }
      R(x + w / 2 - 6, y - 3, 12, 3, GOLD_DK);
      R(x + w / 2 - 5, y - 2, 10, 1, GOLD);
    },
    bigscreen(o) {
      const { x, y, w } = wallFrame(k, o);
      R(x + 2, y + 2, w - 4, 26, "#061018");
      // gold trim and two mounting brackets
      R(x - 1, y + 30, w + 2, 2, GOLD_DK);
      R(x - 1, y + 30, w + 2, 1, GOLD);
      R(x + 6, y + 30, 3, 3, "#3a3f55");
      R(x + w - 9, y + 30, 3, 3, "#3a3f55");
    },
    heatwall(o) {
      const { x, y, w } = wallFrame(k, o);
      R(x + 2, y + 2, w - 4, 26, "#0a0d14");
    },
    pit(o) {
      const x0 = o.tx * TS + 2,
        y0 = o.ty * TS + 2,
        w = o.w * TS - 4,
        h = o.h * TS - 4,
        c = 10;
      // octagon: gold rim, sunken dark floor, a red trading ring
      const oct = (inset: number, color: string) => {
        const cc = Math.max(0, c - inset);
        for (let yy = inset; yy < h - inset; yy++) {
          const dy = Math.min(yy - inset, h - inset - 1 - yy);
          const cut = Math.max(0, cc - dy);
          R(x0 + inset + cut, y0 + yy, w - 2 * inset - 2 * cut, 1, color);
        }
      };
      oct(0, GOLD_DK);
      oct(1, GOLD);
      oct(3, "#141826");
      oct(8, "#7d1f2c");
      oct(13, "#161a29");
      // studs on the rail
      for (let xx = x0 + 14; xx < x0 + w - 14; xx += 12) {
        R(xx, y0 + 1, 2, 1, GOLD_HI);
        R(xx, y0 + h - 2, 2, 1, GOLD_HI);
      }
      // compass medallion under the statue
      const mx = x0 + w / 2,
        my = y0 + h / 2 + 4;
      k.g.fillStyle = GOLD_DK;
      k.g.beginPath();
      k.g.arc(mx, my, 15, 0, 7);
      k.g.fill();
      k.g.fillStyle = "#1e2335";
      k.g.beginPath();
      k.g.arc(mx, my, 13, 0, 7);
      k.g.fill();
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        R(mx + Math.cos(ang) * 10 - 1, my + Math.sin(ang) * 10 - 1, 2, 2, GOLD);
      }
    },
    statue(o) {
      // black marble plinth with gold bands and a plaque; the animal is
      // drawn per frame on top of it
      const x = o.tx * TS - 2,
        y = o.ty * TS - 1;
      box(x, y, 20, 15, "#3a3f55", "#20243a", 4);
      R(x, y + 4, 20, 1, GOLD);
      R(x, y + 13, 20, 1, GOLD_DK);
      R(x + 5, y + 7, 10, 4, GOLD);
      R(x + 6, y + 8, 8, 1, GOLD_HI);
      R(x + 6, y + 10, 8, 1, GOLD_DK);
      shadowBelow(x, y + 15, 20);
    },
    tradedesk(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS + 3,
        w = o.w * TS - 2;
      box(x, y, w, 11, "#5a4034", "#33241f", 5);
      R(x + 2, y + 1, w - 4, 1, "#6e5244");
      // nameplate in the player's color (grey on spare desks)
      const col = (o.opt.player && FUND_COLOR[o.opt.player]) || "#6b6f80";
      R(x + w / 2 - 5, y + 7, 10, 2, col);
      outline(x + w / 2 - 6, y + 6, 12, 4);
      // two monitors on arms
      for (const mx of [x + 3, x + w - 15]) {
        R(mx, y - 9, 12, 9, INK);
        R(mx + 5, y, 2, 2, "#1a1420");
      }
      R(x + 12, y + 2, 6, 2, "#22252f"); // keyboard
      shadowBelow(x, y + 11, w);
    },
    bell(o) {
      const x = o.tx * TS + 7,
        y = o.ty * TS - 12;
      R(x - 5, y + 24, 12, 3, "#5a3a24");
      outline(x - 5, y + 24, 12, 3);
      R(x, y, 2, 24, "#7a4f2e");
      R(x - 4, y, 10, 2, "#7a4f2e");
      outline(x - 4, y, 10, 2);
    },
    velvet(o) {
      const x0 = o.tx * TS + 2,
        y = o.ty * TS + 2,
        w = o.w * TS - 4;
      const posts = [x0, x0 + w / 2 - 1, x0 + w - 2];
      for (let i = 0; i < posts.length - 1; i++) {
        const a = posts[i] + 1,
          b = posts[i + 1];
        for (let xx = a; xx < b; xx++) {
          const tt = (xx - a) / (b - a);
          R(xx, y + 4 + Math.round(Math.sin(tt * Math.PI) * 3), 1, 2, "#b0243a");
        }
      }
      for (const px of posts) {
        R(px, y + 2, 2, 10, GOLD);
        R(px - 1, y + 1, 4, 2, GOLD_HI);
        R(px - 1, y + 12, 4, 2, GOLD_DK);
      }
    },

    // ── under construction ──────────────────────────────────────────────
    scaffold(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 14,
        w = o.w * TS - 2,
        h = o.h * TS + 12;
      const pipe = "#8c96a3",
        joint = "#4a5260";
      for (const px of [x, x + w - 2]) R(px, y, 2, h, pipe);
      for (const py of [y + 2, y + h / 2, y + h - 4]) R(x, py, w, 2, pipe);
      // a diagonal brace
      for (let i = 0; i < h / 2; i++)
        R(x + 2 + Math.round((i / (h / 2)) * (w - 6)), y + 4 + i, 2, 1, pipe);
      for (const py of [y + 2, y + h / 2]) {
        R(x - 1, py - 1, 4, 4, joint);
        R(x + w - 3, py - 1, 4, 4, joint);
      }
      // planks with a paint bucket on top
      R(x + 1, y + h / 2 - 3, w - 2, 3, "#b07a3a");
      R(x + 1, y + h / 2 - 3, w - 2, 1, "#d39a55");
      R(x + 4, y + h / 2 - 9, 6, 6, "#c9ccd2");
      R(x + 4, y + h / 2 - 9, 6, 2, "#3d7bd6");
      outline(x + 4, y + h / 2 - 9, 6, 6);
      shadowBelow(x, y + h, w);
    },
    cone(o) {
      const x = o.tx * TS + 4,
        y = o.ty * TS + 2;
      R(x - 1, y + 11, 10, 2, "#2a2a2a");
      for (let i = 0; i < 11; i++) {
        const half = 1 + Math.floor(i / 2.2);
        R(x + 4 - half, y + i, half * 2, 1, i === 4 || i === 5 ? "#f4f4f4" : "#ff7a1a");
      }
      R(x + 3, y, 2, 1, "#ffb066");
    },
    paint(o) {
      const lids = ["#3d7bd6", "#e05f5f", "#57c46a", "#f2c94c"];
      const lid = lids[Math.floor(rnd() * lids.length)];
      const x = o.tx * TS + 3,
        y = o.ty * TS + 4;
      box(x, y, 10, 10, lid, "#c9ccd2", 3);
      R(x + 2, y + 3, 1, 5, lid); // drip
      R(x + 8, y + 3, 1, 3, lid);
      R(x + 1, y + 12, 3, 2, lid); // splat
    },
    bricks(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS + 2,
        w = o.w * TS - 2;
      R(x, y + 10, w, 3, "#a4743c");
      R(x + 2, y + 13, 2, 1, "#6e4a24");
      R(x + w - 4, y + 13, 2, 1, "#6e4a24");
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < Math.floor((w - 2) / 6); c++)
          R(
            x + 1 + c * 6 + (r % 2) * 3,
            y + 7 - r * 3,
            5,
            3,
            ["#b9573d", "#a64b33", "#c8644a"][(r + c) % 3],
          );
      outline(x, y - 2, w, 15);
    },
    drywall(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 8,
        w = o.w * TS - 2;
      for (let i = 0; i < 3; i++) {
        R(x + i * 2, y + i, w - 6, 20, ["#e9e6df", "#dcd8cf", "#f2efe9"][i]);
        outline(x + i * 2, y + i, w - 6, 20);
      }
      shadowBelow(x, y + 22, w);
    },
    mixer(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS - 4;
      R(x + 2, y + 26, 4, 4, INK); // wheels
      R(x + 22, y + 26, 4, 4, INK);
      R(x + 4, y + 18, 22, 3, "#4a5260");
      k.g.fillStyle = "#e8742a";
      k.g.beginPath();
      k.g.ellipse(x + 14, y + 11, 11, 8, -0.4, 0, 7);
      k.g.fill();
      k.g.strokeStyle = INK;
      k.g.stroke();
      R(x + 22, y + 2, 5, 4, "#c95a1c"); // mouth
      shadowBelow(x, y + 30, 28);
    },
    worklamp(o) {
      const x = o.tx * TS + 7,
        y = o.ty * TS - 10;
      R(x, y + 6, 2, 18, INK);
      R(x - 4, y + 22, 2, 3, INK);
      R(x + 4, y + 22, 2, 3, INK);
      R(x - 4, y, 10, 7, "#2a2a2a");
      R(x - 3, y + 1, 8, 5, "#ffe9a0");
      outline(x - 4, y, 10, 7);
    },
    tarp(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS + 3,
        w = o.w * TS - 4,
        h = o.h * TS - 6;
      R(x, y, w, h, "#3a7bd5");
      for (let i = 4; i < w; i += 9) R(x + i, y, 2, h, "#2f66b3");
      R(x, y, w, 1, "#6aa0ea");
      for (let i = 0; i < 6; i++)
        R(x + Math.floor(rnd() * (w - 3)), y + Math.floor(rnd() * (h - 2)), 2, 1, "#d8d2c4");
      outline(x, y, w, h);
    },
    ucsign(o) {
      const x = o.tx * TS + 2,
        y = o.ty * TS + 1,
        w = o.w * TS - 4;
      hazard(k, x, y, w, 11);
      R(x + 2, y + 2, w - 4, 7, "#ffcf33");
      drawPixelText(R, "REMONT", x + (w - textWidth("REMONT")) / 2, y + 3, "#1d1a1a");
      outline(x, y, w, 11);
    },
    tape(o) {
      // caution tape sagging across the doorway (decor — you can still walk in)
      const vertical = o.h > o.w;
      const len = (vertical ? o.h : o.w) * TS;
      for (let i = 0; i < len; i += 2) {
        const sag = Math.round(Math.sin((i / len) * Math.PI) * 4);
        const col = Math.floor(i / 4) % 2 ? "#1d1a1a" : "#ffcf33";
        if (vertical) R(o.tx * TS + 6 + sag, o.ty * TS + i, 2, 2, col);
        else R(o.tx * TS + i, o.ty * TS + 9 + sag, 2, 2, col);
      }
    },
    planboard(o) {
      const x = o.tx * TS + 1,
        y = o.ty * TS - 12;
      R(x + 2, y + 18, 2, 10, "#7a4f2e");
      R(x + 11, y + 18, 2, 10, "#7a4f2e");
      R(x, y, 15, 19, "#2f5d9a");
      outline(x, y, 15, 19);
      for (const [lx, ly, lw, lh] of [
        [2, 3, 10, 1],
        [2, 3, 1, 12],
        [11, 3, 1, 12],
        [2, 14, 10, 1],
        [6, 3, 1, 7],
        [6, 9, 6, 1],
      ])
        R(x + lx, y + ly, lw, lh, "#cfe3ff");
      R(x + 9, y + 11, 5, 5, "#ffd34d"); // sticky note "?"
      R(x + 11, y + 12, 1, 1, INK);
      R(x + 12, y + 13, 1, 1, INK);
      R(x + 11, y + 15, 1, 1, INK);
    },
  };
}

// ── animated ────────────────────────────────────────────────────────────────
const BULL = [
  ".w..w...........",
  ".ww.ww..........",
  "..####..........",
  ".######hhhhhh...",
  "##e###########..",
  ".#############d.",
  "..###########dd.",
  "..#d.#d...#d.#d.",
  "..#d.#d...#d.#d.",
  ".dd.dd...dd.dd..",
];
const BEAR = [
  "..d.d...........",
  ".dddd...........",
  ".d#e#d..........",
  "d####d####......",
  ".#############..",
  "##############d.",
  ".############dd.",
  ".##d..##d.##d.d.",
  ".##d..##d.##d.d.",
  "dd..dd..dd.dd...",
];

const objs = (k: TownObject["kind"]) => OBJECTS.filter((o) => o.kind === k);

/** Per frame, before the characters. `bellAt` = world time of the last ring. */
export function drawExchange(
  f: CanvasRenderingContext2D,
  t: number,
  fund: TownFund | null,
  bellAt: number,
  calm: boolean,
) {
  const F: Fill = (x, y, w, h, c) => {
    f.fillStyle = c;
    f.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const glow = (x: number, y: number, w: number, h: number, c: string, a: number) => {
    f.globalAlpha = a;
    F(x, y, w, h, c);
    f.globalAlpha = 1;
  };

  // ranking flip-board: five rows, each flips over when the clock says so
  for (const o of objs("flipboard")) {
    const x = o.tx * TS + 3,
      y = o.ty * TS - 13,
      w = o.w * TS - 6;
    const rows = fund?.players.slice(0, 5) ?? [];
    for (let r = 0; r < 5; r++) {
      const ry = o.ty * TS - 14 + r * 6;
      const p = rows[r];
      const flipping = !calm && (t / 70 - r * 3) % 140 < 3;
      if (flipping) {
        F(x, ry + 1, w, 2, "#3a4060");
        continue;
      }
      if (!p) {
        if (r === 2 && !fund) drawPixelText(F, "BRAK DANYCH", x + 4, ry, "#5b6280");
        continue;
      }
      drawPixelText(F, `${r + 1}`, x + 1, ry, GOLD);
      drawPixelText(F, p.tag, x + 7, ry, FUND_COLOR[p.key] ?? "#d0d4e4");
      const pct = pctLabel(p.returnPct);
      drawPixelText(F, pct, x + w - textWidth(pct) - 1, ry, p.returnPct >= 0 ? GREEN : RED);
    }
  }

  // the big NAV screen: every player's equity curve on one axis
  for (const o of objs("bigscreen")) {
    const x = o.tx * TS + 4,
      y = o.ty * TS - 12,
      w = o.w * TS - 8,
      h = 24;
    for (let gx = x; gx < x + w; gx += 12) F(gx, y, 1, h, "#0b1c26");
    for (let gy = y + 4; gy < y + h; gy += 6) F(x, gy, w, 1, "#0b1c26");
    if (!fund) {
      drawPixelText(F, "BRAK DANYCH", x + (w - textWidth("BRAK DANYCH")) / 2, y + 10, "#3d6b80");
      continue;
    }
    const series = fund.players.map((p) => ({ p, s: fund.curves[p.key] ?? [] }));
    const all = series.flatMap((v) => v.s);
    if (all.length >= 2) {
      const lo = Math.min(...all),
        hi = Math.max(...all);
      const span = hi - lo || 1;
      for (const { p, s } of series) {
        if (s.length < 2) continue;
        const col = FUND_COLOR[p.key] ?? "#9aa3c0";
        let px = -1,
          py = -1;
        for (let i = 0; i < s.length; i++) {
          const cx = x + 1 + (i / (s.length - 1)) * (w - 3);
          const cy = y + 3 + (1 - (s[i] - lo) / span) * (h - 7);
          if (px >= 0) {
            const steps = Math.max(1, Math.ceil(Math.abs(cx - px)));
            for (let k = 0; k <= steps; k++)
              F(px + ((cx - px) * k) / steps, py + ((cy - py) * k) / steps, 1, 1, col);
          }
          px = cx;
          py = cy;
        }
        // a pulsing head on the newest value
        if (!calm && Math.floor(t / 400) % 2) F(px - 1, py - 1, 3, 3, col);
      }
    }
    const lead = fund.players[0];
    if (lead) {
      const label = `${lead.tag} ${pctLabel(lead.returnPct)}`;
      F(x + 1, y + 1, textWidth(label) + 4, 7, "rgba(6,16,24,0.85)");
      drawPixelText(F, label, x + 3, y + 2, lead.returnPct >= 0 ? GREEN : RED);
    }
    const live = "LIVE";
    if (calm || Math.floor(t / 600) % 2) {
      F(x + w - textWidth(live) - 7, y + 3, 2, 2, RED);
      drawPixelText(F, live, x + w - textWidth(live) - 3, y + 2, "#c9d3e6");
    }
  }

  // heat wall: the leader's positions, green = in profit, red = at a loss
  for (const o of objs("heatwall")) {
    const x = o.tx * TS + 4,
      y = o.ty * TS - 12,
      w = o.w * TS - 8;
    const tiles = fund?.heat ?? [];
    const cols = 3,
      tw = Math.floor((w - (cols - 1)) / cols),
      th = 7;
    for (let i = 0; i < 9; i++) {
      const cx = x + (i % cols) * (tw + 1),
        cy = y + Math.floor(i / cols) * (th + 1);
      const h = tiles[i];
      if (!h) {
        F(cx, cy, tw, th, "#141824");
        continue;
      }
      const a = Math.min(1, 0.35 + Math.abs(h.plPct) / 8);
      glow(cx, cy, tw, th, h.plPct >= 0 ? "#1fb866" : "#d6334a", a);
      drawPixelText(F, h.symbol.replace(/\.(PL|US)$/, "").slice(0, 4), cx + 1, cy + 1, "#f4f6ff");
    }
  }

  // traders' monitors: candles in the desk owner's direction of the day
  for (const o of objs("tradedesk")) {
    const x = o.tx * TS + 1,
      y = o.ty * TS + 3,
      w = o.w * TS - 2;
    const p = o.opt.player ? fund?.players.find((pl) => pl.key === o.opt.player) : undefined;
    const day = p?.dayPct ?? null;
    const scroll = calm ? 0 : Math.floor(t / 260);
    [x + 3, x + w - 15].forEach((mx, mi) => {
      F(mx + 1, y - 8, 10, 7, "#06121a");
      for (let c = 0; c < 4; c++) {
        const seed = Math.sin((c + scroll + mi * 7 + o.tx) * 12.9898) * 43758.5;
        const r = seed - Math.floor(seed);
        const up = day === null ? r > 0.5 : day >= 0 ? r > 0.25 : r > 0.75;
        const hgt = 1 + Math.floor(r * 4);
        F(mx + 2 + c * 2, y - 2 - hgt, 1, hgt, up ? GREEN : RED);
      }
      if (p && mi === 1 && day !== null)
        F(mx + 1, y - 8, 10, 1, day >= 0 ? "rgba(87,224,143,0.6)" : "rgba(255,92,108,0.6)");
    });
  }

  // the statue: a golden bull on a good day, a bronze bear on a bad one
  for (const o of objs("statue")) {
    const kind = fund?.statue ?? "calm";
    const art = kind === "bear" ? BEAR : BULL;
    const pal: Record<string, string> =
      kind === "bear"
        ? { "#": "#8a5a3a", h: "#b07a52", d: "#4a2e1c", e: INK, w: "#efe6d0" }
        : kind === "bull"
          ? { "#": GOLD, h: GOLD_HI, d: GOLD_DK, e: INK, w: "#fff7dc" }
          : { "#": "#b7a07a", h: "#d8c79e", d: "#7d6a4c", e: INK, w: "#efe6d0" };
    const bob = calm || kind === "calm" ? 0 : Math.round(Math.sin(t / 300) * 0.6);
    const S = 2;
    const x = o.tx * TS + 8 - 8 * S,
      y = o.ty * TS - 1 - 10 * S + bob;
    // a soft spotlight from above
    f.globalAlpha = kind === "bear" ? 0.1 : 0.16;
    f.fillStyle = kind === "bear" ? "#9ad0ff" : GOLD_HI;
    f.beginPath();
    f.ellipse(o.tx * TS + 8, o.ty * TS + 2, 22, 9, 0, 0, 7);
    f.fill();
    f.globalAlpha = 1;
    art.forEach((row, yy) =>
      [...row].forEach((ch, xx) => {
        const c = pal[ch];
        if (c) F(x + xx * S, y + yy * S, S, S, c);
      }),
    );
    if (!calm && kind === "bull" && Math.floor(t / 500) % 5 === 0)
      F(x + 18, y + 6, 2, 2, "#ffffff");
    if (!calm && kind === "bear" && Math.floor(t / 900) % 4 === 0) F(x + 2, y - 4, 4, 2, "#9ad0ff");
  }

  // the opening bell: swings and rings for a moment after you pull it
  const since = t - bellAt;
  const ringing = since >= 0 && since < 2600;
  for (const o of objs("bell")) {
    const x = o.tx * TS + 8,
      y = o.ty * TS - 10;
    const swing = ringing && !calm ? Math.sin(since / 70) * 2 * (1 - since / 2600) : 0;
    F(x - 3 + swing, y + 2, 6, 5, GOLD);
    F(x - 4 + swing, y + 6, 8, 2, GOLD_DK);
    F(x - 2 + swing, y + 3, 1, 3, GOLD_HI);
    F(x - 1 + swing, y + 8, 2, 1, INK);
    if (ringing) {
      const r = 4 + ((since / 120) % 8);
      f.globalAlpha = Math.max(0, 0.7 - since / 3000);
      f.strokeStyle = GOLD_HI;
      f.lineWidth = 1;
      f.beginPath();
      f.arc(x + swing, y + 5, r, -0.9, 0.9);
      f.stroke();
      f.beginPath();
      f.arc(x + swing, y + 5, r, Math.PI - 0.9, Math.PI + 0.9);
      f.stroke();
      f.globalAlpha = 1;
    }
  }

  // ticker-tape confetti over the pit: after the bell, or on a big up day
  const party = ringing || (fund?.dayAvg ?? 0) >= 1;
  const pit = objs("pit")[0];
  if (party && pit && !calm) {
    const cols = ["#ffe08a", "#57e08f", "#ffffff", "#ff8fb8", "#7fd6ff"];
    for (let i = 0; i < 26; i++) {
      const sx = pit.tx * TS + ((i * 37) % (pit.w * TS));
      const fall = ((t / (14 + (i % 5) * 3) + i * 23) % (pit.h * TS + 30)) - 20;
      const sway = Math.sin(t / 240 + i) * 3;
      F(sx + sway, pit.ty * TS + fall, i % 3 ? 2 : 1, i % 2 ? 1 : 2, cols[i % cols.length]);
    }
  }

  // construction: dust motes drifting through the worklamps' light
  if (!calm)
    for (const o of objs("worklamp")) {
      for (let i = 0; i < 4; i++) {
        const ph = t / (2200 + i * 400) + i * 1.7 + o.tx;
        f.globalAlpha = 0.35;
        F(
          o.tx * TS + 8 + Math.sin(ph) * 14,
          o.ty * TS - 4 + Math.cos(ph * 1.3) * 8,
          1,
          1,
          "#fff3c4",
        );
        f.globalAlpha = 1;
      }
    }
  for (const o of objs("mixer")) {
    const a = calm ? 0 : t / 500;
    const cx = o.tx * TS + 16,
      cy = o.ty * TS + 7;
    for (let i = 0; i < 3; i++) {
      const ang = a + (i * Math.PI * 2) / 3;
      F(cx + Math.cos(ang) * 6, cy + Math.sin(ang) * 3.5, 2, 2, "#b5501a");
    }
  }
}

/** Per frame, AFTER the characters: the LED ticker hanging over the floor. */
export function drawExchangeTicker(
  f: CanvasRenderingContext2D,
  t: number,
  fund: TownFund | null,
  calm: boolean,
) {
  const room = objs("pit")[0];
  if (!room) return;
  const x0 = 16 * TS + 2,
    x1 = 41 * TS - 2,
    y = 33 * TS + 1;
  const F: Fill = (x, yy, w, h, c) => {
    f.fillStyle = c;
    f.fillRect(Math.round(x), Math.round(yy), w, h);
  };
  // hangers, housing, the LED field
  for (const hx of [x0 + 20, (x0 + x1) / 2, x1 - 22]) F(hx, y - 6, 1, 6, "#3a3f55");
  F(x0, y, x1 - x0, 9, "#05070c");
  F(x0, y, x1 - x0, 1, "#3a4060");
  F(x0, y + 8, x1 - x0, 1, "#11131c");
  const items =
    fund?.ticker && fund.ticker.length > 0
      ? fund.ticker
      : [
          {
            text: "FUNDUSZ J.A.R.V.I.S.  BRAK DANYCH - KLIKNIJ PRZELICZ W /RYNKI",
            sign: 0 as const,
          },
        ];
  const gap = 16;
  const widths = items.map((it) => textWidth(it.text) + gap + 6);
  const total = widths.reduce((s, v) => s + v, 0);
  const offset = calm ? 0 : (t / 28) % total;
  f.save();
  f.beginPath();
  f.rect(x0 + 1, y + 1, x1 - x0 - 2, 7);
  f.clip();
  for (let rep = 0; rep < 3; rep++) {
    let cx = x0 + 4 - offset + rep * total;
    if (cx > x1) break;
    items.forEach((it, i) => {
      const wdt = widths[i];
      if (cx + wdt >= x0 && cx <= x1) {
        const col = it.sign > 0 ? GREEN : it.sign < 0 ? RED : "#ffd34d";
        if (it.sign !== 0) drawPixelText(F, it.sign > 0 ? "▲" : "▼", cx, y + 2, col);
        drawPixelText(F, it.text, cx + (it.sign !== 0 ? 6 : 0), y + 2, col);
        F(cx + wdt - gap / 2 - 1, y + 4, 2, 1, "#3a4060");
      }
      cx += wdt;
    });
  }
  f.restore();
}
