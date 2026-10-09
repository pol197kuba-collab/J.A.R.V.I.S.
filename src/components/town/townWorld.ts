// Agent Town — the living world: characters that walk (BFS on the tile
// grid), talk (speech bubbles), queue their errands (one "actor" chain per
// character, so J.A.R.V.I.S. never teleports between two hand-offs), idle
// around their rooms, and the per-frame render of all of it.
//
// It knows nothing about agent_runs — townDirector.ts translates real data
// into calls on this class.

import {
  buildTownMap,
  findPath,
  feet,
  roomArea,
  HOME,
  BOARD_SPOTS,
  COFFEE_SPOT,
  ROOMS,
  TS,
  WORLD_W,
  WORLD_H,
  type Tile,
  type TownMap,
  type TownSlug,
} from "./townMap";
import {
  AGENT_COLOR,
  INK,
  ICON,
  buildSprites,
  buildStaticLayer,
  drawDynamic,
  drawIcon,
  pixelBox,
  type BoardCard,
  type SpriteSet,
} from "./townArt";
import { TownDog } from "./townDog";
import { propAt, propById } from "./townProps";

export type CharStatus = "idle" | "running" | "done" | "error" | "off";
type Dir = "up" | "down" | "left" | "right";
type Tone = "plain" | "tool" | "ok" | "bad";
type Bubble = { text: string; until: number; icon: string | null; tone: Tone };
type Char = {
  slug: TownSlug;
  x: number;
  y: number;
  tx: number;
  ty: number;
  path: { tx: number; ty: number; x: number; y: number }[];
  arrive: (() => void) | null;
  dir: Dir;
  bubble: Bubble | null;
  idleAt: number;
  errands: number;
};
export type Camera = { x: number; y: number; z: number };
type Rect = { x: number; y: number; w: number; h: number };
type Speaker = { x: number; y: number; bubble: Bubble | null; tag: string };

export const TAG: Record<TownSlug, string> = {
  jarvis: "JAR",
  insight: "INS",
  metric: "MET",
  forge: "FOR",
  shield: "SHI",
  herald: "HER",
  user: "TY",
};

const WALK_PX_PER_MS = 0.08;

export class TownWorld {
  readonly map: TownMap;
  private sprites: Record<TownSlug, SpriteSet>;
  private staticLayer: HTMLCanvasElement;
  private frame: HTMLCanvasElement;
  private f: CanvasRenderingContext2D;
  private timers: { at: number; res: () => void }[] = [];
  private chains = new Map<TownSlug, Promise<void>>();
  readonly chars: Record<TownSlug, Char>;
  time = 0;
  status: Record<TownSlug, CharStatus>;
  /** 0..1 while running, null = unknown (animated bar). */
  progress: Partial<Record<TownSlug, number | null>> = {};
  cards: BoardCard[] = [];
  reduceMotion = false;
  /** Walk mode: you steer your own character (see TownView). */
  walkMode = false;
  /** The agent you're talking to stays put and faces you. */
  talkingTo: TownSlug | null = null;
  /** Unread results pinned on the board — drawn as a "!" over it. */
  boardAlert = 0;
  /** Your companion. */
  readonly dog: TownDog;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the dog host reads live time
    const world = this;
    this.map = buildTownMap();
    this.sprites = buildSprites();
    this.staticLayer = buildStaticLayer(this.map);
    this.frame = document.createElement("canvas");
    this.frame.width = WORLD_W;
    this.frame.height = WORLD_H;
    this.f = this.frame.getContext("2d")!;
    const slugs = Object.keys(HOME) as TownSlug[];
    this.chars = {} as Record<TownSlug, Char>;
    this.status = {} as Record<TownSlug, CharStatus>;
    for (const slug of slugs) {
      const [tx, ty] = HOME[slug];
      const p = feet(tx, ty);
      this.chars[slug] = {
        slug,
        ...p,
        tx,
        ty,
        path: [],
        arrive: null,
        dir: slug === "user" ? "up" : "down",
        bubble: null,
        idleAt: 2500 + Math.random() * 6000,
        errands: 0,
      };
      this.status[slug] = "idle";
    }
    const owner = this.chars.user;
    const butler = this.chars.jarvis;
    this.dog = new TownDog({
      get time() {
        return world.time;
      },
      map: this.map,
      wait: (ms) => this.wait(ms),
      owner: () => ({
        x: owner.x,
        y: owner.y,
        tx: owner.tx,
        ty: owner.ty,
        moving: owner.path.length > 0,
      }),
      butler: () => ({ x: butler.x, y: butler.y }),
      ownerSay: (text, ms, icon) => this.say("user", text, ms, icon),
    });
  }

  // ── time & actions ────────────────────────────────────────────────────────
  wait(ms: number): Promise<void> {
    return new Promise((res) => this.timers.push({ at: this.time + ms, res }));
  }

  walkTo(slug: TownSlug, tile: Tile): Promise<void> {
    const c = this.chars[slug];
    const steps = findPath(this.map.blocked, [c.tx, c.ty], tile);
    c.path = steps.map(([x, y]) => ({ tx: x, ty: y, ...feet(x, y) }));
    if (c.arrive) {
      const prev = c.arrive;
      c.arrive = null;
      prev();
    }
    if (!c.path.length) return Promise.resolve();
    return new Promise((res) => {
      c.arrive = res;
    });
  }
  goHome(slug: TownSlug) {
    return this.walkTo(slug, HOME[slug]);
  }
  say(slug: TownSlug, text: string, ms = 2200, icon: string | null = null, tone: Tone = "plain") {
    this.chars[slug].bubble = { text, until: this.time + ms, icon, tone };
  }
  face(slug: TownSlug, dir: Dir) {
    this.chars[slug].dir = dir;
  }
  /** How many errands are queued for this character (load-shedding hint). */
  backlog(slug: TownSlug) {
    return this.chars[slug].errands;
  }
  /** Run `fn` after this character's previous errands — one body, one queue. */
  actor(slug: TownSlug, fn: () => Promise<void>): Promise<void> {
    const c = this.chars[slug];
    c.errands++;
    const run = async () => {
      try {
        await fn();
      } finally {
        c.errands--;
        c.idleAt = this.time + 3000 + Math.random() * 4000;
      }
    };
    const next = (this.chains.get(slug) ?? Promise.resolve()).then(run, run);
    this.chains.set(slug, next);
    return next;
  }

  private idleLife(c: Char) {
    if (
      c.slug === "user" ||
      c.slug === this.talkingTo ||
      c.errands ||
      c.path.length ||
      this.time < c.idleAt
    )
      return;
    const st = this.status[c.slug];
    if (st === "running") return;
    c.idleAt = this.time + 4500 + Math.random() * 6000;
    if (st === "off") {
      this.say(c.slug, "zzz", 2500, "zz");
      return;
    }
    if (this.reduceMotion) return;
    if (Math.random() < 0.15) {
      void this.actor(c.slug, async () => {
        await this.walkTo(c.slug, COFFEE_SPOT);
        this.face(c.slug, "up");
        this.say(c.slug, "kawa", 1600, "coffee");
        await this.wait(1800);
        await this.goHome(c.slug);
      });
      return;
    }
    const a = roomArea(c.slug);
    for (let k = 0; k < 8; k++) {
      const tx = a.x0 + Math.floor(Math.random() * (a.x1 - a.x0 + 1));
      const ty = a.y0 + Math.floor(Math.random() * (a.y1 - a.y0 + 1));
      if (!this.map.blocked[ty][tx]) {
        void this.walkTo(c.slug, [tx, ty]);
        break;
      }
    }
  }

  update(dt: number) {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].at <= this.time) this.timers.splice(i, 1)[0].res();
    }
    for (const c of Object.values(this.chars)) {
      if (!c.path.length) {
        this.idleLife(c);
        continue;
      }
      const p = c.path[0];
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d = Math.hypot(dx, dy);
      const v = WALK_PX_PER_MS * dt;
      if (Math.abs(dx) > Math.abs(dy)) c.dir = dx > 0 ? "right" : "left";
      else if (d > 0.01) c.dir = dy > 0 ? "down" : "up";
      if (d <= v) {
        c.x = p.x;
        c.y = p.y;
        c.tx = p.tx;
        c.ty = p.ty;
        c.path.shift();
        if (!c.path.length && c.arrive) {
          const r = c.arrive;
          c.arrive = null;
          r();
        }
      } else {
        c.x += (dx / d) * v;
        c.y += (dy / d) * v;
      }
    }
    this.dog.update(dt);
  }

  /** Paint a character's front-facing sprite, scaled up, for the inspector. */
  drawPortrait(cv: HTMLCanvasElement, slug: TownSlug | "dog") {
    if (slug === "dog") {
      this.dog.drawPortrait(cv);
      return;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const scale = Math.floor(Math.min(cv.width, cv.height) / 16);
    const size = 16 * scale;
    ctx.drawImage(
      this.sprites[slug].frontS,
      (cv.width - size) / 2,
      (cv.height - size) / 2 + scale,
      size,
      size,
    );
  }

  // ── walk mode: your character ────────────────────────────────────────────
  /** One step in a direction (arrow keys / WASD). Ignored mid-step. */
  userStep(dx: number, dy: number) {
    const c = this.chars.user;
    if (c.path.length) return;
    c.dir = dx > 0 ? "right" : dx < 0 ? "left" : dy > 0 ? "down" : "up";
    const tx = c.tx + dx;
    const ty = c.ty + dy;
    if (this.map.blocked[ty]?.[tx] === false) void this.walkTo("user", [tx, ty]);
  }
  /** Walk your character to a tile (tap / click on the map). */
  userWalkTo(tile: Tile) {
    return this.walkTo("user", tile);
  }
  /** A free tile right next to an agent, nearest to you — where you stand to talk. */
  besideAgent(slug: TownSlug): Tile {
    const a = this.chars[slug];
    const u = this.chars.user;
    const cands: Tile[] = [
      [a.tx - 1, a.ty],
      [a.tx + 1, a.ty],
      [a.tx, a.ty + 1],
      [a.tx, a.ty - 1],
    ];
    const free = cands.filter(([x, y]) => this.map.blocked[y]?.[x] === false);
    free.sort(
      (p, q) => Math.hypot(p[0] - u.tx, p[1] - u.ty) - Math.hypot(q[0] - u.tx, q[1] - u.ty),
    );
    return free[0] ?? [a.tx, a.ty];
  }
  /** The board spot nearest to you. */
  nearestBoardSpot(): Tile {
    const u = this.chars.user;
    return [...BOARD_SPOTS].sort(
      (p, q) => Math.hypot(p[0] - u.tx, p[1] - u.ty) - Math.hypot(q[0] - u.tx, q[1] - u.ty),
    )[0];
  }
  /** Is a world point on the task board (or the floor right in front of it)? */
  isBoard(wx: number, wy: number) {
    return wx >= 17 * TS && wx < 27 * TS && wy >= 13 * TS && wy < 15 * TS;
  }
  /** What you could interact with from where you stand, if anything. */
  reachable():
    | { kind: "agent"; slug: TownSlug }
    | { kind: "board" }
    | { kind: "prop"; id: string }
    | null {
    const u = this.chars.user;
    if (u.path.length) return null;
    let best: TownSlug | null = null;
    let bd = TS * 1.6;
    for (const c of Object.values(this.chars)) {
      if (c.slug === "user") continue;
      const d = Math.hypot(c.x - u.x, c.y - u.y);
      if (d < bd) {
        bd = d;
        best = c.slug;
      }
    }
    if (best) return { kind: "agent", slug: best };
    if (BOARD_SPOTS.some(([x, y]) => x === u.tx && y === u.ty)) return { kind: "board" };
    const prop = propAt(u.tx, u.ty);
    return prop ? { kind: "prop", id: prop.id } : null;
  }
  /** Turn an agent to face you while you talk. */
  faceUser(slug: TownSlug) {
    const a = this.chars[slug];
    const u = this.chars.user;
    const dx = u.x - a.x;
    const dy = u.y - a.y;
    a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    u.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "left" : "right") : dy > 0 ? "up" : "down";
  }

  // ── picking ───────────────────────────────────────────────────────────────
  /** Agent under a world point: a character first, else the room's owner. */
  pick(wx: number, wy: number): TownSlug | null {
    let best: TownSlug | null = null;
    let bd = 12;
    for (const c of Object.values(this.chars)) {
      if (c.slug === "user") continue;
      const d = Math.hypot(c.x - wx, c.y - 6 - wy);
      if (d < bd) {
        bd = d;
        best = c.slug;
      }
    }
    if (best) return best;
    const tx = Math.floor(wx / TS);
    const ty = Math.floor(wy / TS);
    const rid = this.map.roomOf[ty]?.[tx];
    return rid && rid !== "hall" && rid !== "user" ? (rid as TownSlug) : null;
  }

  // ── render ────────────────────────────────────────────────────────────────
  draw(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, selected: TownSlug | null) {
    const f = this.f;
    const t = this.time;
    f.drawImage(this.staticLayer, 0, 0);
    drawDynamic(f, t, (s) => this.status[s], this.cards);
    const order = Object.values(this.chars).sort((a, b) => a.y - b.y);
    let dogDrawn = false;
    for (const c of order) {
      if (!dogDrawn && this.dog.y < c.y) {
        this.dog.drawSprite(f, t);
        dogDrawn = true;
      }
      this.drawChar(c, t);
    }
    if (!dogDrawn) this.dog.drawSprite(f, t);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#120d18";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(cam.z, 0, 0, cam.z, -cam.x * cam.z, -cam.y * cam.z);
    ctx.drawImage(this.frame, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawOverlay(ctx, cam, dpr, selected, order);
  }

  private drawChar(c: Char, t: number) {
    const f = this.f;
    const moving = c.path.length > 0;
    const fr = moving ? (Math.floor(t / 140) % 2 ? "A" : "B") : "S";
    const view = c.dir === "up" ? "back" : c.dir === "down" ? "front" : "side";
    const spr = this.sprites[c.slug][view + fr];
    const x = Math.round(c.x);
    const y = Math.round(c.y);
    f.globalAlpha = this.status[c.slug] === "off" ? 0.55 : 1;
    f.fillStyle = "rgba(30,16,30,0.3)";
    f.fillRect(x - 5, y + 1, 10, 2);
    f.fillRect(x - 4, y, 8, 1);
    if (c.dir === "left") {
      f.save();
      f.translate(x + 8, y - 14);
      f.scale(-1, 1);
      f.drawImage(spr, 0, 0);
      f.restore();
    } else f.drawImage(spr, x - 8, y - 14);
    f.globalAlpha = 1;
  }

  private drawOverlay(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    dpr: number,
    selected: TownSlug | null,
    order: Char[],
  ) {
    const toS = (wx: number, wy: number) => ({ x: (wx - cam.x) * cam.z, y: (wy - cam.y) * cam.z });
    const fs = Math.round(Math.max(11 * dpr, Math.min(15 * dpr, cam.z * 3.6)));
    const u = Math.max(2, Math.round(fs / 7));
    const font = (w: number, size: number) =>
      `${w} ${size}px "Pixelify Sans", ui-monospace, monospace`;
    ctx.textBaseline = "middle";

    // room signs
    if (cam.z >= 1.1 * dpr) {
      const ls = Math.round(fs * 0.85);
      ctx.font = font(700, ls);
      for (const r of Object.values(ROOMS)) {
        const label = r.label.toUpperCase();
        const w = ctx.measureText(label).width + ls;
        const h = Math.round(ls * 1.5);
        const s = toS((r.x0 + 1) * TS + 2, r.y0 * TS + 3);
        pixelBox(ctx, s.x, s.y, w, h, Math.max(1, u - 1), "#5d3a29", INK);
        ctx.fillStyle = "#fbe9c9";
        ctx.fillText(label, s.x + ls / 2, s.y + h / 2 + 1);
      }
    }

    // "!" over the task board while results wait unread
    if (this.boardAlert > 0) {
      const bob = this.reduceMotion ? 0 : Math.abs(Math.sin(this.time / 300)) * 4;
      const s = toS(22 * TS, 13 * TS - 6 - bob);
      const bs = Math.round(fs * 1.5);
      pixelBox(ctx, s.x - bs / 2, s.y - bs, bs, bs, u, "#f2c94c", INK);
      ctx.font = font(700, Math.round(fs * 1.1));
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.fillText(this.boardAlert > 1 ? String(this.boardAlert) : "!", s.x, s.y - bs / 2 + 1);
      ctx.textAlign = "left";
    }
    // walk mode: what's within reach
    const reach = this.walkMode ? this.reachable() : null;
    if (reach) {
      const prop = reach.kind === "prop" ? propById(reach.id) : null;
      const label =
        reach.kind === "board" ? "E · Tablica" : prop ? `E · ${prop.prompt}` : "E · Porozmawiaj";
      const at =
        reach.kind === "board"
          ? { x: 22 * TS, y: 12 * TS }
          : reach.kind === "prop"
            ? { x: (prop?.anchor[0] ?? 0) * TS, y: (prop?.anchor[1] ?? 0) * TS }
            : { x: this.chars[reach.slug].x, y: this.chars[reach.slug].y - 26 };
      const ps = Math.round(fs * 0.85);
      ctx.font = font(700, ps);
      const w = ctx.measureText(label).width + ps;
      const h = Math.round(ps * 1.6);
      const s = toS(at.x, at.y);
      pixelBox(ctx, s.x - w / 2, s.y - h, w, h, Math.max(1, u - 1), "#f2a93b", INK);
      ctx.fillStyle = INK;
      ctx.fillText(label, s.x - w / 2 + ps / 2, s.y - h / 2 + 1);
    }

    for (const c of order) {
      const s = toS(c.x, c.y);
      // name tag
      if (cam.z >= 1.8 * dpr || c.slug === selected) {
        const ts = Math.round(fs * 0.78);
        ctx.font = font(700, ts);
        const label = TAG[c.slug];
        const w = ctx.measureText(label).width + ts * 0.8;
        const h = Math.round(ts * 1.35);
        const x = s.x - w / 2;
        const y = s.y + 3 * cam.z * 0.6;
        const sel = c.slug === selected;
        pixelBox(
          ctx,
          x,
          y,
          w,
          h,
          Math.max(1, u - 1),
          sel ? INK : "rgba(42,32,52,0.85)",
          sel ? AGENT_COLOR[c.slug] : "rgba(42,32,52,0.85)",
        );
        ctx.fillStyle = "#fbf3df";
        ctx.fillText(label, x + ts * 0.4, y + h / 2 + 1);
      }
      // work bar (HP-bar style) over a working agent
      if (this.status[c.slug] === "running" && c.slug !== "jarvis" && c.slug !== "user") {
        const bw = 18 * cam.z;
        const bh = Math.max(5 * dpr, 3 * cam.z * 0.6);
        const top = toS(c.x, c.y - 18);
        const inner = Math.max(1, Math.round(u / 2));
        pixelBox(ctx, top.x - bw / 2, top.y - bh, bw, bh, inner, "#3b3247", INK);
        const p = this.progress[c.slug];
        const iw = bw - inner * 4;
        const ix = top.x - bw / 2 + inner * 2;
        const iy = top.y - bh + inner * 2;
        const ih = Math.max(1, bh - inner * 4);
        if (p == null) {
          // unknown progress: a block sweeping across
          const seg = iw * 0.35;
          const k = ((this.time / 900) % 1) * (iw + seg) - seg;
          ctx.fillStyle = "#58c35a";
          ctx.fillRect(
            Math.round(ix + Math.max(0, k)),
            Math.round(iy),
            Math.max(0, Math.min(seg, iw - k, seg + k)),
            ih,
          );
        } else {
          ctx.fillStyle = p > 0.66 ? "#58c35a" : p > 0.33 ? "#f2c94c" : "#e98a3c";
          ctx.fillRect(Math.round(ix), Math.round(iy), Math.max(0, iw * p), ih);
        }
      }
      // bouncing selection cursor
      if (c.slug === selected && !(c.bubble && c.bubble.until >= this.time)) {
        const a = toS(
          c.x,
          c.y - 17 - (this.reduceMotion ? 0 : Math.abs(Math.sin(this.time / 250)) * 3),
        );
        const p = Math.max(2, Math.round(cam.z * 0.9));
        ctx.fillStyle = INK;
        for (let i = 0; i < 4; i++)
          ctx.fillRect(a.x - (4 - i) * p, a.y - (6 - i) * p, (8 - 2 * i) * p, p);
        ctx.fillStyle = "#f2a93b";
        for (let i = 0; i < 3; i++)
          ctx.fillRect(a.x - (3 - i) * p, a.y - (6 - i) * p, (6 - 2 * i) * p, p);
      }
    }
    // Bottom-most speakers first, so a crowd stacks its bubbles upward
    // instead of drawing them on top of each other.
    this.dog.drawHearts(ctx, toS, cam.z);
    const placed: Rect[] = [];
    const dogTag = this.dog.name.toUpperCase().slice(0, 10);
    const speakers: Speaker[] = [
      ...order.map((c) => ({ x: c.x, y: c.y, bubble: c.bubble, tag: TAG[c.slug] })),
      {
        x: this.dog.x,
        y: this.dog.y + 6,
        bubble: this.dog.bubble ? { ...this.dog.bubble, tone: "plain" as const } : null,
        tag: dogTag,
      },
    ].sort((a, b) => b.y - a.y);
    for (const sp of speakers) this.drawBubble(ctx, sp, toS, fs, u, font, placed);
  }

  private drawBubble(
    ctx: CanvasRenderingContext2D,
    c: Speaker,
    toS: (x: number, y: number) => { x: number; y: number },
    fs: number,
    u: number,
    font: (w: number, s: number) => string,
    placed: Rect[],
  ) {
    const bb = c.bubble;
    if (!bb || bb.until < this.time) return;
    const p = Math.max(1, Math.round(fs / 8));
    const tag = c.tag + ":";
    ctx.font = font(700, fs);
    const tagW = ctx.measureText(tag).width;
    ctx.font = font(500, fs);
    const text = bb.text.length > 32 ? bb.text.slice(0, 31) + "…" : bb.text;
    const textW = ctx.measureText(text).width;
    const pad = Math.round(fs * 0.55);
    const gap = Math.round(fs * 0.4);
    const iw = bb.icon && ICON[bb.icon] ? 8 * p + gap : 0;
    const w = pad * 2 + tagW + gap + iw + textW;
    const h = Math.round(fs * 1.7);
    const s = toS(c.x, c.y - 24);
    const cw = ctx.canvas.width;
    const x = Math.max(4, Math.min(cw - w - 4, s.x - w / 2));
    const anchorY = s.y - h - u * 3;
    let y = anchorY;
    const hits = (r: Rect) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y;
    for (let guard = 0; guard < 8; guard++) {
      const hit = placed.find(hits);
      if (!hit) break;
      y = hit.y - h - u;
    }
    placed.push({ x, y, w, h });
    const fill = bb.tone === "tool" ? "#fff6dc" : "#ffffff";
    pixelBox(ctx, x, y, w, h, u, fill, INK);
    if (y === anchorY) {
      // tail — only when the bubble sits right above its speaker
      const tx = Math.round(Math.max(x + 3 * u, Math.min(x + w - 6 * u, s.x - 2 * u)));
      ctx.fillStyle = INK;
      ctx.fillRect(tx, y + h - u, 4 * u, u * 2);
      ctx.fillRect(tx, y + h + u, 2 * u, u * 2);
      ctx.fillStyle = fill;
      ctx.fillRect(tx + u, y + h - u, 2 * u, u);
      ctx.fillRect(tx + u, y + h, u, u);
    }
    ctx.fillStyle = INK;
    ctx.font = font(700, fs);
    ctx.fillText(tag, x + pad, y + h / 2 + 1);
    let cx = x + pad + tagW + gap;
    const toneColor = bb.tone === "bad" ? "#c93838" : bb.tone === "ok" ? "#3f9d4f" : INK;
    if (iw && bb.icon) {
      drawIcon(ctx, bb.icon, cx, y + (h - 8 * p) / 2, p, toneColor);
      cx += iw;
    }
    ctx.font = font(500, fs);
    ctx.fillStyle = bb.tone === "bad" ? "#c93838" : INK;
    ctx.fillText(text, cx, y + h / 2 + 1);
  }
}
