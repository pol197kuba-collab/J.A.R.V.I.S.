// Agent Town — the extras brought to life: walking (BFS like the agents),
// picking the next job (townNpcs.ts), and drawing them with their tools.
// Builders work by day and knock off after dark; traders work the floor,
// shout the fund's real ticker into the pit and cheer when the bell rings.

import { buildLookSprites, type SpriteSet } from "./townArt";
import { feet, findPath, type Tile, type TownMap } from "./townMap";
import type { TownFund } from "./townFund";
import {
  BELL_CHEER_MS,
  NPC_TAG,
  NPCS,
  PIT_CENTER,
  TRADER_SPOTS,
  WORKERS_AWAY_AT_NIGHT,
  WORKER_LINES,
  atWall,
  roomSpots,
  taskMs,
  traderShout,
  traderTask,
  workerTask,
  type NpcDef,
  type TraderTask,
  type WorkerTask,
} from "./townNpcs";

const WALK_PX_PER_MS = 0.05;
type Dir = "up" | "down" | "left" | "right";
type Step = { x: number; y: number; tx: number; ty: number };
export type NpcBubble = { text: string; until: number; icon: null; tone: "plain" | "ok" | "bad" };

type Npc = {
  def: NpcDef;
  sprites: SpriteSet;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  path: Step[];
  task: WorkerTask | TraderTask | "cheer" | null;
  /** The job starts when the walk ends; until then it's a walk to it. */
  pending: WorkerTask | TraderTask | null;
  until: number;
  bubble: NpcBubble | null;
  seed: number;
};

export type NpcEnv = {
  fund: TownFund | null;
  night: number;
  bellAt: number;
  reduceMotion: boolean;
};

const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

export class NpcCrowd {
  private npcs: Npc[];
  private spots = new Map<string, { free: Tile[]; wall: Tile[] }>();

  constructor(private map: TownMap) {
    this.npcs = NPCS.map((def, i) => {
      const f = feet(def.home[0], def.home[1]);
      return {
        def,
        sprites: buildLookSprites(def.look),
        x: f.x,
        y: f.y,
        tx: def.home[0],
        ty: def.home[1],
        dir: "down",
        path: [],
        task: null,
        pending: null,
        // staggered starts, so the floor doesn't move in lockstep
        until: 400 + i * 700,
        bubble: null,
        seed: i * 13.37,
      };
    });
    for (const d of NPCS)
      if (d.kind === "worker" && !this.spots.has(d.room))
        this.spots.set(d.room, roomSpots(map, d.room));
  }

  private walk(n: Npc, to: Tile) {
    n.path = findPath(this.map.blocked, [n.tx, n.ty], to).map(([tx, ty]) => ({
      ...feet(tx, ty),
      tx,
      ty,
    }));
  }

  private say(n: Npc, text: string, now: number, tone: NpcBubble["tone"] = "plain", ms = 2200) {
    n.bubble = { text, until: now + ms, icon: null, tone };
  }

  update(dt: number, now: number, env: NpcEnv) {
    const bellFresh = now - env.bellAt >= 0 && now - env.bellAt < BELL_CHEER_MS;
    for (const n of this.npcs) {
      // walking
      if (n.path.length) {
        const p = n.path[0];
        const dx = p.x - n.x,
          dy = p.y - n.y,
          d = Math.hypot(dx, dy),
          v = WALK_PX_PER_MS * dt;
        if (Math.abs(dx) > Math.abs(dy)) n.dir = dx > 0 ? "right" : "left";
        else if (d > 0.01) n.dir = dy > 0 ? "down" : "up";
        if (d <= v) {
          n.x = p.x;
          n.y = p.y;
          n.tx = p.tx;
          n.ty = p.ty;
          n.path.shift();
          if (!n.path.length && n.pending) this.arrive(n, now, env);
        } else {
          n.x += (dx / d) * v;
          n.y += (dy / d) * v;
        }
        continue;
      }
      if (env.reduceMotion) continue;
      // the bell: every trader on the floor cheers on the spot
      if (n.def.kind === "trader" && bellFresh && n.task !== "cheer") {
        n.task = "cheer";
        n.pending = null;
        n.until = env.bellAt + BELL_CHEER_MS;
        if (Math.random() < 0.5)
          this.say(n, pick(["Hura!", "Dzwon!", "Sesja otwarta!"]), now, "ok", 1800);
        continue;
      }
      if (now < n.until) continue;
      n.task = null;
      if (n.def.kind === "worker") {
        if (env.night >= WORKERS_AWAY_AT_NIGHT) continue; // knocked off
        const job = workerTask(Math.random());
        const s = this.spots.get(n.def.room)!;
        const target = atWall(job) && s.wall.length ? pick(s.wall) : pick(s.free);
        n.pending = job;
        this.walk(n, target);
        if (!n.path.length) this.arrive(n, now, env);
      } else {
        const job = traderTask(Math.random());
        n.pending = job;
        this.walk(n, pick(TRADER_SPOTS[job]));
        if (!n.path.length) this.arrive(n, now, env);
      }
    }
  }

  private arrive(n: Npc, now: number, env: NpcEnv) {
    const job = n.pending!;
    n.pending = null;
    n.task = job;
    n.until = now + taskMs(job, Math.random());
    if (job === "paint" || job === "drill" || job === "desk" || job === "screen") n.dir = "up";
    else if (job === "pit") {
      const dx = PIT_CENTER[0] - n.tx,
        dy = PIT_CENTER[1] - n.ty;
      n.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    }
    if (n.def.kind === "worker") {
      if (Math.random() < 0.3) this.say(n, pick(WORKER_LINES[job as WorkerTask]), now);
      if (job === "carry") {
        // carrying is a walk with a load: pick up here, take it somewhere else
        n.task = null;
        n.pending = null;
        const s = this.spots.get(n.def.room)!;
        n.task = "carry";
        n.until = now + taskMs("carry", Math.random());
        this.walk(n, pick(s.free));
      }
    } else if (job === "pit") {
      const shout = traderShout(env.fund, Math.random());
      this.say(n, shout.text, now, shout.tone, 2400);
    } else if (job === "screen" && env.fund && env.fund.mood !== "flat" && Math.random() < 0.5) {
      this.say(
        n,
        env.fund.mood === "up" ? "Zielono!" : "Czerwono…",
        now,
        env.fund.mood === "up" ? "ok" : "bad",
      );
    }
  }

  /** Speech bubbles for the overlay (same renderer as the agents', tag BUD/TRD). */
  speakers() {
    return this.npcs.map((n) => ({ x: n.x, y: n.y, bubble: n.bubble, tag: NPC_TAG[n.def.kind] }));
  }

  /** One draw call per extra, sorted with the agents by feet y. */
  drawables(f: CanvasRenderingContext2D, t: number, env: NpcEnv) {
    return this.npcs
      .filter(
        (n) => !(n.def.kind === "worker" && env.night >= WORKERS_AWAY_AT_NIGHT && !n.path.length),
      )
      .map((n) => ({ y: n.y, draw: () => this.drawNpc(f, n, t, env) }));
  }

  private drawNpc(f: CanvasRenderingContext2D, n: Npc, t: number, env: NpcEnv) {
    const moving = n.path.length > 0;
    const calm = env.reduceMotion;
    const fr = moving ? (Math.floor(t / 150) % 2 ? "A" : "B") : "S";
    const view = n.dir === "up" ? "back" : n.dir === "down" ? "front" : "side";
    const spr = n.sprites[view + fr];
    const x = Math.round(n.x),
      y = Math.round(n.y);
    const F = (px: number, py: number, w: number, h: number, c: string) => {
      f.fillStyle = c;
      f.fillRect(Math.round(px), Math.round(py), w, h);
    };
    const side = n.dir === "left" ? -1 : 1;
    const task = moving ? (n.task === "carry" ? "carry" : null) : n.task;

    // posture: traders hop on a cheer / good day, slump on a bad one, sit at desks
    const mood = n.def.kind === "trader" ? (env.fund?.mood ?? "flat") : "flat";
    let lift = 0;
    let sink = 0;
    if (task === "cheer" && !calm) lift = -Math.abs(Math.round(Math.sin(t / 110) * 3));
    else if (
      n.def.kind === "trader" &&
      !moving &&
      mood === "up" &&
      !calm &&
      Math.floor((t + n.seed * 100) / 700) % 6 === 0
    )
      lift = -2;
    else if (n.def.kind === "trader" && !moving && mood === "down") sink = 2;
    if (task === "desk") sink = 2;

    F(x - 5, y + 1, 10, 2, "rgba(30,16,30,0.3)");
    const blit = (dx: number) => {
      if (sink) {
        f.drawImage(spr, 0, 10, 16, 6, dx, y - 4, 16, 6);
        f.drawImage(spr, 0, 0, 16, 10, dx, y - 14 + sink, 16, 10);
      } else f.drawImage(spr, dx, y - 14 + lift);
    };
    if (n.dir === "left") {
      f.save();
      f.translate(x + 8, 0);
      f.scale(-1, 1);
      blit(0);
      f.restore();
    } else blit(x - 8);

    const hx = x + side * 5; // the hand
    const ph = calm ? 0 : t + n.seed * 97;
    const skin = "#f7cfa6";
    switch (task) {
      case "hammer": {
        const up = Math.floor(ph / 180) % 2 === 0;
        F(hx, y - 8 - (up ? 3 : 0), 1, 4, "#7a4f2e");
        F(hx - 1, y - 9 - (up ? 3 : 0), 3, 2, "#9aa3b2");
        if (!up) F(hx + side * 2, y - 2, 1, 1, "#d8d2c4");
        break;
      }
      case "drill": {
        F(x - 1, y - 14, 3, 3, "#e8b91c");
        F(x, y - 16, 1, 2, "#9aa3b2");
        if (!calm)
          for (let i = 0; i < 3; i++) {
            const a = (ph / 60 + i * 2.1) % 6.28;
            F(x + Math.cos(a) * 3, y - 17 + Math.sin(a) * 2, 1, 1, i % 2 ? "#ffb347" : "#fff3c4");
          }
        break;
      }
      case "paint": {
        const off = Math.round(Math.sin(ph / 320) * 4);
        F(x + 3, y - 20 + off, 1, 12 - off, "#7a4f2e");
        F(x, y - 22 + off, 7, 2, "#ffffff");
        F(x, y - 20 + off, 7, 1, "#cfd6e4");
        break;
      }
      case "carry":
        F(x - 4, y - 22, 9, 6, "#b07a3a");
        F(x - 4, y - 22, 9, 1, "#d39a55");
        F(x - 4, y - 19, 9, 1, "#8a5a2a");
        break;
      case "measure":
        F(hx, y - 7, side * 10, 1, "#ffcf33");
        for (let i = 2; i < 10; i += 3) F(hx + side * i, y - 8, 1, 1, "#1d1a1a");
        break;
      case "break":
        F(hx, y - 8, 2, 3, "#ffffff");
        if (!calm && Math.floor(ph / 400) % 2) F(hx, y - 11, 1, 2, "rgba(255,255,255,0.7)");
        break;
      case "pit": {
        // arm up, a trading slip in hand — the open-outcry signal
        const wave = calm ? 0 : Math.round(Math.sin(ph / 140));
        F(hx + wave, y - 17, 1, 6, skin);
        F(hx - 1 + wave, y - 20, 3, 3, "#ffffff");
        break;
      }
      case "cheer": {
        const wave = calm ? 0 : Math.round(Math.sin(ph / 100));
        F(x - 6, y - 17 + lift + wave, 1, 5, skin);
        F(x + 5, y - 17 + lift - wave, 1, 5, skin);
        break;
      }
    }
  }
}
