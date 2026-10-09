// Agent Town — your companion: a one-year-old red cocker spaniel.
//
// It follows your character around, has its own bed in your terminal room,
// gets up to small things on its own (sniffing, sitting, chasing its tail,
// napping, barking at J.A.R.V.I.S. when he brings news), and answers to the
// buttons in the "Towarzysz" panel: pet, fetch, treat, come, sleep.
//
// Sprite colours follow the real dog: red-gold coat, darker wavy ears,
// black nose, a red collar with a little gold tag.

import { findPath, feet, HOME, TS, type Tile } from "./townMap";
import { drawIcon, INK } from "./townArt";

const PAL: Record<string, string> = {
  o: "#3a2416", // outline (warm, not the cold UI ink)
  f: "#c97a3e", // coat
  F: "#a65e2c", // coat shade
  l: "#e6a868", // light chest
  e: "#8e4a22", // long ears
  n: "#1a1210", // nose
  k: "#1a1210", // eye
  c: "#c2364a", // collar
  t: "#f2c94c", // tag
};

// 16×12, facing right (left = mirrored). Tail on the left, head on the right.
export const DOG_SIDE = [
  "................",
  "...........ooo..",
  "..........offfo.",
  "..........ofkffo",
  ".........oeefffn",
  "o........oeeeffo",
  "of.oooooooeeefo.",
  ".ffofffffffeeeo.",
  "..offffffffceo..",
  "..oFFFFFFFFFo...",
  "...oFo....oFo...",
  "...oo.....oo....",
];
const SIDE_LEGS = {
  A: ["..oFo......oFo..", "..oo.......oo..."],
  B: ["....oFo..oFo....", "....oo...oo....."],
};
const SIT_LEFT = [
  "........",
  "....oooo",
  "...offff",
  "..oeffff",
  ".oeefkff",
  ".oeefffn",
  ".oeeefff",
  ".oeeeocc",
  "..oeofff",
  "...offll",
  "...offof",
  "..ooooo.",
];
export const DOG_SIT = SIT_LEFT.map((r) => r + [...r].reverse().join("")).map((r, i) =>
  i === 7 ? r.slice(0, 8) + "t" + r.slice(9) : r,
);
export const DOG_SLEEP = [
  "................",
  "................",
  ...DOG_SIDE.slice(0, 9).map((r) => r.replace("k", "F")),
  "..oooooooooo....",
];

export type DogPose = "stand" | "walkA" | "walkB" | "sit" | "sleep";
type DogSprites = Record<DogPose, HTMLCanvasElement>;

function paint(rows: readonly string[]): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = 16;
  cv.height = 12;
  const g = cv.getContext("2d")!;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      g.fillStyle = PAL[ch] ?? "#ff00ff";
      g.fillRect(x, y, 1, 1);
    }),
  );
  return cv;
}
function buildDogSprites(): DogSprites {
  const legs = (k: "A" | "B") => [...DOG_SIDE.slice(0, 10), ...SIDE_LEGS[k]];
  return {
    stand: paint(DOG_SIDE),
    walkA: paint(legs("A")),
    walkB: paint(legs("B")),
    sit: paint(DOG_SIT),
    sleep: paint(DOG_SLEEP),
  };
}

/** Where the dog's bed is (a cushion in your terminal room). */
export const DOG_BED: Tile = [17, 26];
/** Where he picks up a result note: in front of the task board in the Core. */
const LETTER_PICKUP: Tile = [17, 16];

export type DogAction = "pet" | "fetch" | "treat" | "call" | "sleep";
type Bubble = { text: string; until: number; icon: string | null };
type Heart = { x: number; y: number; born: number; icon: string };

/** What the dog needs from the world it lives in. */
export type DogHost = {
  readonly time: number;
  readonly map: { blocked: boolean[][] };
  wait(ms: number): Promise<void>;
  /** Your character's feet position and tile, and whether it is walking. */
  owner(): { x: number; y: number; tx: number; ty: number; moving: boolean };
  /** J.A.R.V.I.S.'s feet position (the dog greets him). */
  butler(): { x: number; y: number };
  ownerSay(text: string, ms: number, icon: string | null): void;
};

const RUN = 0.11; // px per ms — a spaniel trots faster than people walk
const STROLL = 0.06;

export class TownDog {
  name = "Marvel";
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: "left" | "right" = "right";
  pose: DogPose = "sleep";
  private path: { tx: number; ty: number; x: number; y: number }[] = [];
  private arrive: (() => void) | null = null;
  private speed = STROLL;
  private busy = false;
  private nextIdle = 4000;
  private nextFollow = 0;
  private greetCooldown = 0;
  private wagUntil = 0;
  private spinUntil = 0;
  bubble: Bubble | null = null;
  private hearts: Heart[] = [];
  private ball: { x: number; y: number; z: number } | null = null;
  private carrying = false;
  /** Holding a result from the board for you — take it by clicking him / E. */
  letter = false;
  private wantDeliver = false;
  /** Night: he sleeps on his bed unless you call him. */
  night = false;
  private sprites: DogSprites;
  /** Called after each finished interaction (for mood, counters, the log). */
  onAction: ((action: DogAction, line: string) => void) | null = null;

  constructor(private host: DogHost) {
    this.sprites = buildDogSprites();
    [this.tx, this.ty] = DOG_BED;
    ({ x: this.x, y: this.y } = feet(this.tx, this.ty));
  }

  // ── movement ─────────────────────────────────────────────────────────────
  private walkTo(tile: Tile, speed = STROLL): Promise<void> {
    this.speed = speed;
    const steps = findPath(this.host.map.blocked, [this.tx, this.ty], tile);
    this.path = steps.map(([x, y]) => ({ tx: x, ty: y, ...feet(x, y) }));
    if (this.arrive) {
      const prev = this.arrive;
      this.arrive = null;
      prev();
    }
    if (!this.path.length) return Promise.resolve();
    this.pose = "stand";
    return new Promise((res) => {
      this.arrive = res;
    });
  }
  /** A free tile next to your character, on the side the dog is coming from. */
  private besideOwner(): Tile {
    const o = this.host.owner();
    const cands: Tile[] = [
      [o.tx - 1, o.ty],
      [o.tx + 1, o.ty],
      [o.tx, o.ty + 1],
      [o.tx, o.ty - 1],
    ];
    const free = cands.filter(([x, y]) => !this.host.map.blocked[y]?.[x]);
    if (!free.length) return [o.tx, o.ty];
    free.sort(
      (a, b) =>
        Math.hypot(a[0] - this.tx, a[1] - this.ty) - Math.hypot(b[0] - this.tx, b[1] - this.ty),
    );
    return free[0];
  }
  private faceOwner() {
    this.dir = this.host.owner().x >= this.x ? "right" : "left";
  }
  say(text: string, ms = 1600, icon: string | null = "paw") {
    this.bubble = { text, until: this.host.time + ms, icon };
  }
  private heart(icon = "heart") {
    this.hearts.push({
      x: this.x + (Math.random() * 8 - 4),
      y: this.y - 12,
      born: this.host.time,
      icon,
    });
  }

  // ── interactions (buttons / clicking the dog) ────────────────────────────
  async interact(action: DogAction): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const h = this.host;
    try {
      if (action === "sleep") {
        this.say("ziew…", 1400, null);
        await this.walkTo(DOG_BED);
        this.pose = "sleep";
        this.say("zzz", 2500, "zz");
        this.nextIdle = h.time + 30000;
        this.onAction?.("sleep", `${this.name} zwinął się na swoim posłaniu.`);
        return;
      }
      await this.walkTo(this.besideOwner(), RUN);
      this.faceOwner();
      if (action === "pet") {
        this.pose = "sit";
        this.wagUntil = h.time + 2500;
        for (let i = 0; i < 3; i++) {
          this.heart();
          await h.wait(350);
        }
        this.say("merda ogonem", 1400, "heart");
        this.onAction?.("pet", `Głaskanie: ${this.name} merda ogonem.`);
      } else if (action === "treat") {
        h.ownerSay("Siad!", 1200, null);
        await h.wait(500);
        this.pose = "sit";
        await h.wait(600);
        this.say("mniam!", 1500, "bone");
        this.wagUntil = h.time + 2000;
        this.heart("bone");
        this.onAction?.("treat", `${this.name} dostał smakołyk.`);
      } else if (action === "call") {
        this.say("Hau!", 1200);
        this.wagUntil = h.time + 2000;
        this.pose = "sit";
        this.onAction?.("call", `${this.name} przybiegł na zawołanie.`);
      } else if (action === "fetch") {
        await this.fetch();
      }
      this.nextIdle = h.time + 5000;
    } finally {
      this.busy = false;
    }
  }

  /**
   * A new result is on the board: he trots over, takes the note in his
   * mouth and brings it to you, then waits beside you until you take it.
   */
  deliver() {
    if (this.busy) {
      this.wantDeliver = true;
      return;
    }
    this.wantDeliver = false;
    this.busy = true;
    const h = this.host;
    void (async () => {
      try {
        this.say("Hau!", 900);
        await this.walkTo(LETTER_PICKUP, RUN);
        this.letter = true;
        this.say("*chwyta kartkę*", 1200, "pin");
        await h.wait(500);
        await this.walkTo(this.besideOwner(), RUN);
        this.faceOwner();
        this.pose = "sit";
        this.wagUntil = h.time + 3000;
        this.say("Mam coś dla Ciebie!", 2400, "pin");
        this.nextIdle = h.time + 8000;
      } finally {
        this.busy = false;
      }
    })();
  }
  /** You took the note from him. */
  takeLetter() {
    if (!this.letter) return;
    this.letter = false;
    this.heart();
    this.wagUntil = this.host.time + 1500;
  }

  private async fetch() {
    const h = this.host;
    const o = h.owner();
    h.ownerSay("Aport!", 1200, null);
    // a free tile 4-7 tiles away
    let target: Tile = [o.tx, o.ty];
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 3;
      const t: Tile = [Math.round(o.tx + Math.cos(a) * r), Math.round(o.ty + Math.sin(a) * r)];
      if (!h.map.blocked[t[1]]?.[t[0]] && findPath(h.map.blocked, [o.tx, o.ty], t).length) {
        target = t;
        break;
      }
    }
    // the throw: a short arc from your hand to the target tile
    const from = { x: o.x, y: o.y - 8 };
    const to = feet(target[0], target[1]);
    const t0 = h.time;
    const flight = 650;
    this.ball = { ...from, z: 0 };
    const fly = async () => {
      while (h.time - t0 < flight) {
        const k = (h.time - t0) / flight;
        this.ball = {
          x: from.x + (to.x - from.x) * k,
          y: from.y + (to.y - from.y) * k,
          z: Math.sin(k * Math.PI) * 18,
        };
        await h.wait(16);
      }
      this.ball = { x: to.x, y: to.y, z: 0 };
    };
    const flying = fly();
    this.say("!", 600, null);
    await this.walkTo(target, RUN);
    await flying;
    this.ball = null;
    this.carrying = true;
    await h.wait(250);
    await this.walkTo(this.besideOwner(), RUN);
    this.faceOwner();
    this.carrying = false;
    this.pose = "sit";
    this.wagUntil = h.time + 2500;
    this.say("Hau!", 1300);
    this.heart();
    this.onAction?.("fetch", `${this.name} przyniósł piłkę!`);
  }

  // ── autonomous life ──────────────────────────────────────────────────────
  private idle() {
    const h = this.host;
    this.nextIdle = h.time + 6000 + Math.random() * 7000;
    if (this.letter) {
      // still holding your note: stay put and remind you now and then
      this.pose = "sit";
      if (Math.random() < 0.5) this.say("Hau! (kartka)", 1400, "pin");
      return;
    }
    if (this.night) {
      // after dark he sleeps on his bed, unless he's out walking with you
      const o0 = h.owner();
      if (o0.tx === HOME.user[0] && o0.ty === HOME.user[1] && this.pose !== "sleep") {
        void this.walkTo(DOG_BED).then(() => {
          if (this.path.length) return;
          this.pose = "sleep";
        });
        return;
      }
      if (this.pose === "sleep") {
        if (Math.random() < 0.3) this.say("zzz", 2200, "zz");
        this.nextIdle = h.time + 15000;
        return;
      }
    }
    const o = h.owner();
    const atHome = o.tx === HOME.user[0] && o.ty === HOME.user[1];
    const r = Math.random();
    if (r < 0.35) {
      // potter around you — at the terminal, or wherever you're standing
      const [hx, hy] = atHome ? HOME.user : [o.tx, o.ty];
      for (let k = 0; k < 10; k++) {
        const t: Tile = [
          hx - 4 + Math.floor(Math.random() * 9),
          hy - 2 + Math.floor(Math.random() * 4),
        ];
        if (!h.map.blocked[t[1]]?.[t[0]]) {
          void this.walkTo(t);
          break;
        }
      }
    } else if (r < 0.55) {
      this.pose = "sit";
    } else if (r < 0.67) {
      this.spinUntil = h.time + 1600;
      this.say("goni ogon", 1500, null);
    } else if (r < 0.77) {
      this.say("*niuch niuch*", 1600, "paw");
    } else if (r < 0.85) {
      this.say("Hau!", 1000);
      this.wagUntil = h.time + 1200;
    } else if (!atHome) {
      // away from home he won't go off to his bed — a quick sit instead
      this.pose = "sit";
    } else {
      void this.walkTo(DOG_BED).then(() => {
        if (this.path.length) return;
        this.pose = "sleep";
        this.say("zzz", 2500, "zz");
        this.nextIdle = h.time + 20000;
      });
    }
  }

  update(dt: number) {
    const h = this.host;
    const o = h.owner();
    // follow your character whenever it leaves the terminal; once you stop
    // and he's caught up, he gets on with his own little things nearby
    const away = o.moving || o.tx !== HOME.user[0] || o.ty !== HOME.user[1];
    const far = Math.hypot(o.x - this.x, o.y - this.y) > TS * (o.moving ? 1.6 : 3.5);
    if (this.wantDeliver && !this.busy) this.deliver();
    if (!this.busy && away && far && h.time >= this.nextFollow) {
      this.nextFollow = h.time + 350;
      void this.walkTo(this.besideOwner(), RUN);
    } else if (!this.busy && (!away || !o.moving) && !this.path.length && h.time >= this.nextIdle) {
      this.idle();
    }
    // bark at J.A.R.V.I.S. when he comes over with news
    const b = h.butler();
    if (
      h.time > this.greetCooldown &&
      Math.hypot(b.x - this.x, b.y - this.y) < TS * 2.2 &&
      this.pose !== "sleep"
    ) {
      this.greetCooldown = h.time + 20000;
      this.say("Hau! Hau!", 1400);
      this.wagUntil = h.time + 1800;
    }
    // walking
    if (this.path.length) {
      const p = this.path[0];
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      const d = Math.hypot(dx, dy);
      const v = this.speed * dt;
      if (Math.abs(dx) > 0.01) this.dir = dx > 0 ? "right" : "left";
      if (d <= v) {
        this.x = p.x;
        this.y = p.y;
        this.tx = p.tx;
        this.ty = p.ty;
        this.path.shift();
        if (!this.path.length) {
          this.pose = "stand";
          const r = this.arrive;
          this.arrive = null;
          r?.();
        }
      } else {
        this.x += (dx / d) * v;
        this.y += (dy / d) * v;
      }
    }
    if (this.spinUntil > h.time) this.dir = Math.floor(h.time / 110) % 2 ? "left" : "right";
    this.hearts = this.hearts.filter((ht) => h.time - ht.born < 1400);
  }

  /** Close enough to a world point to count as "clicked the dog". */
  hit(wx: number, wy: number) {
    return Math.hypot(this.x - wx, this.y - 5 - wy) < 10;
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  drawSprite(f: CanvasRenderingContext2D, t: number) {
    const moving = this.path.length > 0;
    const pose: DogPose = moving
      ? Math.floor(t / (this.speed > STROLL ? 90 : 140)) % 2
        ? "walkA"
        : "walkB"
      : this.pose;
    const spr = this.sprites[pose];
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    f.fillStyle = "rgba(30,16,30,0.3)";
    f.fillRect(x - 6, y + 1, 12, 2);
    const flip = pose !== "sit" && this.dir === "left";
    if (flip) {
      f.save();
      f.translate(x + 8, y - 11);
      f.scale(-1, 1);
      f.drawImage(spr, 0, 0);
      f.restore();
    } else f.drawImage(spr, x - 8, y - 11);
    // wagging tail: an extra tuft that flicks side to side
    if (this.wagUntil > t && pose !== "sleep") {
      const k = Math.floor(t / 90) % 2;
      f.fillStyle = PAL.f;
      if (pose === "sit") f.fillRect(x + 5 + k, y - 3 - k, 2, 2);
      else f.fillRect(flip ? x + 7 - k : x - 9 + k, y - 7 - k, 2, 2);
    }
    if (this.letter) {
      // a folded note in his mouth
      const lx = this.dir === "right" || pose === "sit" ? x + 4 : x - 9;
      f.fillStyle = INK;
      f.fillRect(lx - 1, y - 8, 7, 5);
      f.fillStyle = "#fbf3df";
      f.fillRect(lx, y - 7, 5, 3);
      f.fillStyle = "#c9b48a";
      f.fillRect(lx + 1, y - 6, 3, 1);
    }
    if (this.carrying) {
      f.fillStyle = "#d8f04a";
      f.fillRect(this.dir === "right" ? x + 6 : x - 9, y - 6, 3, 3);
    }
    if (this.ball) {
      const bx = Math.round(this.ball.x);
      const by = Math.round(this.ball.y - this.ball.z);
      f.fillStyle = "rgba(30,16,30,0.3)";
      f.fillRect(Math.round(this.ball.x) - 2, Math.round(this.ball.y) + 1, 4, 1);
      f.fillStyle = INK;
      f.fillRect(bx - 2, by - 2, 5, 5);
      f.fillStyle = "#d8f04a";
      f.fillRect(bx - 1, by - 1, 3, 3);
    }
  }

  drawHearts(
    ctx: CanvasRenderingContext2D,
    toS: (x: number, y: number) => { x: number; y: number },
    z: number,
  ) {
    const p = Math.max(2, Math.round(z * 0.8));
    for (const ht of this.hearts) {
      const age = (this.host.time - ht.born) / 1400;
      const s = toS(ht.x, ht.y - age * 14);
      ctx.globalAlpha = 1 - age;
      drawIcon(
        ctx,
        ht.icon,
        s.x - 4 * p,
        s.y - 8 * p,
        p,
        ht.icon === "heart" ? "#e8456b" : "#f3e6c8",
      );
      ctx.globalAlpha = 1;
    }
  }

  /** Portrait for the companion panel (sitting, front-facing). */
  drawPortrait(cv: HTMLCanvasElement) {
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const scale = Math.floor(Math.min(cv.width / 16, cv.height / 12));
    ctx.drawImage(
      this.sprites.sit,
      (cv.width - 16 * scale) / 2,
      (cv.height - 12 * scale) / 2,
      16 * scale,
      12 * scale,
    );
  }
}
