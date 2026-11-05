// Pure math of the 3D intro scene (landing → login → ignition → Arc Core).
// No three.js, no DOM. Ported 1:1 from docs/jarvis-3d-v2/src/main.js: every
// visual is a function of the scene mode and of one state variable (scroll
// position on the landing page, login progress `lg`, ignition phase `p`), so
// the same curves drive the app and the demo. Vec3 is a plain {x,y,z}.
//
// Units are the demo's world units (SCALE 72 = MATRIX_SCALE 0.72 × 100).

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ---- constants: the one place to tune ---------------------------------------
/** Ignition length in seconds per motion variant (full = 2600 ms in the demo). */
export const DUR = { full: 2.6, short: 0.9, min: 0.4 } as const;
/** Phase at which the dashboard may mount (≈ 1.5 s of the full 2.6 s). */
export const P_LIVE = 0.58;
/** Fast-forward multiplier on pointerdown / keydown during the ignition. */
export const SKIP_MULT = 6;
/** Wrong-key shake length, seconds. */
export const SHAKE_SECONDS = 0.45;
/** Camera flight Engage → login pose, ms. */
export const LOGIN_ENTER_MS = 1100;
/** Login framing: the slot spans this many world units (hull + gyro rings). */
export const LOGIN_SPAN = 380;

/** Landing buttons: jump to a stop on their own rAF clock, not native smooth scroll. */
export const JUMP_PX_PER_MS = 5.5;
export const JUMP_MIN_MS = 900;
export const JUMP_MAX_MS = 3000;

/** Module tunnel layout (world units). */
export const TUNNEL = { start: 420, end: -2880, first: -300, step: 205 } as const;

export type MotionVariant = "full" | "min";

/** prefers-reduced-motion: reduce → the "min" variant (camera cut hidden in a fade to black). */
export function pickMotionVariant(reducedMotion: boolean): MotionVariant {
  return reducedMotion ? "min" : "full";
}

// ---- helpers -----------------------------------------------------------------
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const ease = (t: number) => t * t * (3 - 2 * t);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Progress of p through [a, b], clamped to 0..1. */
export const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});

// ---- button jump -------------------------------------------------------------
/** Duration of a landing jump over `px` pixels, clamped to [JUMP_MIN_MS, JUMP_MAX_MS]. */
export const jumpMs = (px: number) =>
  clamp(Math.abs(px) / JUMP_PX_PER_MS, JUMP_MIN_MS, JUMP_MAX_MS);
/** Cubic in-out easing of a jump. */
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Scroll position at time `elapsedMs` of a jump from → to. */
export function jumpPosition(from: number, to: number, elapsedMs: number): number {
  const ms = jumpMs(to - from);
  return from + (to - from) * easeInOut(clamp(elapsedMs / ms));
}

// ---- ignition driver ----------------------------------------------------------
export interface Transition {
  elapsed: number;
  dur: number;
  skip: boolean;
  /** Seconds into the transition at which p first reached P_LIVE. */
  liveAt: number | null;
}

export function startTransition(variant: MotionVariant): Transition {
  return { elapsed: 0, dur: DUR[variant], skip: false, liveAt: null };
}

/** Advance the transition by dt seconds (mutates `t`). */
export function stepTransition(
  t: Transition,
  dt: number,
): { p: number; done: boolean; justLive: boolean } {
  t.elapsed += dt * (t.skip ? SKIP_MULT : 1);
  const p = clamp(t.elapsed / t.dur);
  let justLive = false;
  if (t.liveAt === null && p >= P_LIVE) {
    t.liveAt = t.elapsed;
    justLive = true;
  }
  return { p, done: p >= 1, justLive };
}

// ---- camera framing -----------------------------------------------------------
/** Camera distance/offset that puts `span` world units across a DOM rect's width. */
export function fitCamera(
  rect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
  fovDeg = 32,
  span = 200,
): Vec3 {
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  const ppu = rect.width / span;
  const d = viewport.height / (2 * tan * ppu);
  return {
    x: -(rect.left + rect.width / 2 - viewport.width / 2) / ppu,
    y: (rect.top + rect.height / 2 - viewport.height / 2) / ppu,
    z: d,
  };
}

/** Final Arc Core camera; wider on tall viewports (demo rule clamp(1.35 / aspect, 1, 2.5)). */
export function coreCameraPosition(scale: number, aspect: number): Vec3 {
  const m = clamp(1.35 / aspect, 1, 2.5);
  return v3(0, 2.7 * scale * m, 9.8 * scale * m);
}

export const FOV_LOGIN = 32;
export const FOV_CORE = 45;

// ---- landing: stops and scroll → camera ---------------------------------------
export interface Stop {
  id: string;
  /** Scroll range of the stop: a = top, b = top + span (Infinity for the last). */
  a: number;
  b: number;
  grid: number;
  fogNear: number;
  fogFar: number;
  tun: number;
  hull: number;
  bloom: number;
  cam: Vec3;
  look: Vec3;
}

export interface SectionBox {
  id: string;
  /** Top of the section relative to the scroll content (px). */
  top: number;
  height: number;
}

/** Port of layout() in main.js: one camera stop per landing section. */
export function buildStops(o: {
  sections: SectionBox[];
  viewport: { width: number; height: number };
  /** fitCamera() of the engage home rect. */
  engageFit: Vec3;
  /** Resting positions of the agent nodes (orbitPosition). */
  homes: Vec3[];
}): Stop[] {
  const { width: w, height: h } = o.viewport;
  const asp = w / h;
  const port = asp < 1;
  const far = clamp(1.65 / asp, 1, 2.4);
  return o.sections.map((sec) => {
    const span = Math.max(1, sec.height - h);
    const s: Stop = {
      id: sec.id,
      a: sec.top,
      b: sec.top + span,
      grid: 0,
      fogNear: 900,
      fogFar: 2600,
      tun: 0,
      hull: 1,
      bloom: 0.42,
      cam: v3(),
      look: v3(),
    };
    const id = sec.id;
    if (id === "hero") {
      s.a = 0;
      s.grid = 0.55;
      s.look = port ? v3(0, -40, 0) : v3(-235, 10, 0);
      s.cam = v3(port ? 230 : 300, 140, 860 * far);
    } else if (id === "jarvis") {
      s.look = port ? v3(0, -60, 0) : v3(-110, 0, -20);
      s.cam = v3(-230, 80, 430 * far);
    } else if (/^a\d+$/.test(id)) {
      const i = +id.slice(1);
      const n = o.homes[i] ?? v3();
      const len = Math.hypot(n.x, n.y, n.z) || 1;
      const side = i % 2 ? -1 : 1;
      s.look = v3(n.x * 0.7, n.y * 0.7, n.z * 0.7);
      if (port) s.look.y -= 70;
      s.look.x += port ? 0 : side * 70;
      const k = (340 * far) / len;
      s.cam = v3(n.x + n.x * k + side * 170, n.y + n.y * k + 80, n.z + n.z * k + 120);
    } else if (id === "modules") {
      s.look = v3(0, 0, -1000);
      s.cam = v3(0, 0, TUNNEL.start);
      s.tun = 1;
      s.fogNear = 240;
      s.fogFar = 1250;
      s.bloom = 0.45;
      s.hull = 0.4;
    } else if (id === "engage") {
      s.grid = 1;
      s.hull = 0;
      s.bloom = 0.26;
      s.tun = 0;
      s.b = Infinity;
      s.look = v3(o.engageFit.x, o.engageFit.y, 0);
      s.cam = v3(o.engageFit.x, o.engageFit.y, o.engageFit.z);
    }
    return s;
  });
}

export interface StopAt {
  A: Stop;
  B: Stop;
  same: boolean;
  t: number;
  raw: number;
}

/** Port of at(): which stop(s) a scroll position falls on. */
export function stopAt(stops: Stop[], y: number): StopAt {
  let i = 0;
  while (i < stops.length - 1 && y > stops[i].b) i++;
  const S = stops[i];
  if (y >= S.a || i === 0) {
    return {
      A: S,
      B: S,
      same: true,
      t: 0,
      raw: S.b === Infinity ? 1 : clamp((y - S.a) / (S.b - S.a)),
    };
  }
  const P = stops[i - 1];
  return { A: P, B: S, same: false, t: clamp((y - P.b) / (S.a - P.b)), raw: 0 };
}

export interface ScrollState {
  cam: Vec3;
  look: Vec3;
  /** 1 once the reactor is front-on (engage). */
  align: number;
  /** White match-cut flash 0..1 (module tunnel → engage). */
  flash: number;
  tunVis: number;
  hull: number;
  bloom: number;
  grid: number;
  fogNear: number;
  fogFar: number;
  engaged: number;
  /** Module readout visible (HUD under the tunnel). */
  hudMod: number;
  nodesVisible: boolean;
  reactorVisible: boolean;
  dustVisible: boolean;
}

/** Port of the camera/visibility half of scrollFrame(): scroll position → scene state. */
export function scrollState(sy: number, stops: Stop[]): ScrollState {
  const { A, B, same, t, raw } = stopAt(stops, sy);
  const e = ease(t);
  let align = 0;
  let fl = 0;
  let tunVis = lerp(A.tun, B.tun, t > 0.5 ? 1 : 0);
  let cam: Vec3;
  let look: Vec3;

  if (same && A.id === "modules") {
    const z = lerp(TUNNEL.start, TUNNEL.end, raw);
    cam = v3(Math.sin(raw * 9) * 14, Math.cos(raw * 7) * 10, z);
    look = v3(0, 0, z - 500);
    tunVis = 1;
  } else if (A.id === "modules" && B.id === "engage") {
    // match cut on white: the end of the tunnel is the white centre of the reactor
    const out = seg(t, 0, 0.28);
    const back = seg(t, 0.28, 1);
    fl = out < 1 ? ease(out) : 1 - seg(t, 0.28, 0.32);
    if (out < 1) {
      cam = v3(0, 0, lerp(TUNNEL.end, TUNNEL.end - 90, out));
      look = v3(0, 0, cam.z - 500);
    } else {
      const k = back * back * (3 - 2 * back);
      align = 1;
      cam = v3(B.cam.x * k, B.cam.y * k, lerp(12, B.cam.z, k));
      look = v3(B.look.x * k, B.look.y * k, 0);
      tunVis = 0;
    }
  } else {
    cam = lerp3(A.cam, B.cam, e);
    look = lerp3(A.look, B.look, e);
    if (A.id === "engage") align = 1;
  }
  if (B.id === "engage" && same) align = 1;

  let bloom = align ? lerp(0.4, B.bloom ?? 0.26, seg(t, 0.28, 0.6)) : lerp(A.bloom, B.bloom, e);
  if (same && A.id === "engage") bloom = 0.26;

  return {
    cam,
    look,
    align,
    flash: fl,
    tunVis,
    hull: align ? 0 : lerp(A.hull, B.hull, e),
    bloom,
    grid: same ? A.grid : lerp(A.grid, B.grid, B.id === "engage" ? seg(t, 0.5, 1) : e),
    fogNear: tunVis ? 240 : 900,
    fogFar: tunVis ? 1250 : 2600,
    engaged: B.id === "engage" ? (same ? 1 : seg(t, 0.85, 1)) : 0,
    hudMod: tunVis && same ? 1 : 0,
    nodesVisible: cam.z > -500 && !align,
    reactorVisible: cam.z > -700,
    dustVisible: !align,
  };
}

/** Index of the module the tunnel camera is passing (-1 = entrance). */
export function moduleIndexAt(camZ: number, count: number): number {
  return clamp(
    Math.floor((TUNNEL.first - 60 - TUNNEL.step - camZ + 400) / TUNNEL.step + 0.5),
    -1,
    count - 1,
  );
}

/** Where a module board hangs in the tunnel. */
export function boardPlacement(i: number, portrait: boolean) {
  const side = i % 2 ? 1 : -1;
  return {
    size: portrait ? 120 : 250,
    x: side * (portrait ? 74 : 190),
    y: ((i % 3) - 1) * (portrait ? 34 : 56),
    z: TUNNEL.first - 60 - (i + 1) * TUNNEL.step,
    rotY: -side * 0.34,
  };
}

/** Board opacity as the camera approaches (fades in far away, out when passed). */
export const boardOpacity = (camZ: number, boardZ: number) => {
  const d = camZ - boardZ;
  return seg(d, 780, 420) * seg(d, 30, 150);
};

/** The white portal at the end of the tunnel grows as the camera gets close. */
export const portalScale = (camZ: number) => {
  const pr = seg(camZ, -1900, TUNNEL.end);
  return lerp(0.12, 1, pr * pr);
};

/** SYSTEM SCAN percentage readout. */
export const scanPercent = (sy: number, scrollHeight: number, viewportH: number) =>
  Math.round(clamp(sy / Math.max(1, scrollHeight - viewportH)) * 100);

// ---- login (3D) ----------------------------------------------------------------
export interface LoginInput {
  /** Login progress 0..1 (camera flight in LOGIN_ENTER_MS). */
  lg: number;
  from: { cam: Vec3; look: Vec3 };
  pose: Vec3; // x, y = look target, z = distance
  pointer: { x: number; y: number };
  reduced: boolean;
}

export function loginCamera(o: LoginInput): { cam: Vec3; look: Vec3; k: number } {
  const k = ease(o.lg);
  const cam = v3(
    lerp(o.from.cam.x, o.pose.x, k),
    lerp(o.from.cam.y, o.pose.y, k),
    lerp(o.from.cam.z, o.pose.z, k),
  );
  const look = v3(lerp(o.from.look.x, o.pose.x, k), lerp(o.from.look.y, o.pose.y, k), 0);
  if (!o.reduced) {
    cam.x += o.pointer.x * 22 * k;
    cam.y -= o.pointer.y * 14 * k;
  }
  return { cam, look, k };
}

/** Login progress from the time since the camera flight started. */
export const loginProgress = (elapsedMs: number, reduced: boolean) =>
  reduced ? 1 : clamp(elapsedMs / LOGIN_ENTER_MS);

/** Reactor / bloom state while typing on the login screen. */
export function loginLook(lg: number, energy: number, shake: number) {
  const k = ease(lg);
  return {
    a: lerp(1, 0.5, k),
    hull: 0.6 * ease(seg(lg, 0.15, 1)) * (1 + energy * 0.25),
    discScale: 1 + energy * 0.1,
    bloom: { strength: 0.3 + energy * 0.08 - (shake > 0 ? 0.06 : 0), threshold: 0.5, radius: 0.45 },
    fogNear: 1500,
    fogFar: 3400,
    grid: 0.55,
    dust: 0.3,
  };
}

/** Wrong-key shake: red tint clamp(shake·1.8)·.95, position/roll by shake². */
export function shakeAt(shake: number, time: number) {
  const q = shake * shake;
  return {
    tint: clamp(shake * 1.8) * 0.95,
    x: Math.sin(time * 70) * 5 * q,
    rotZ: Math.sin(time * 53) * 0.035 * q,
  };
}

/** Typing/focus energy: decays, kicked by input (+.3), keydown (+.22), base .3 on focus. */
export const energyDecay = (energy: number, dt: number) => energy * Math.exp(-dt * 2.2);
export const energyKick = (energy: number, amount: number) => Math.min(1, energy + amount);

// ---- reactor (shared by login and ignition) --------------------------------------
export interface PartSpec {
  z: number;
  depth: number;
  tilt: number;
  spin: number;
}

export function reactorPartPose(q: PartSpec, a: number, spinT: number, reduced: boolean) {
  const off = 1 - a;
  return {
    z: q.z * off,
    scaleZ: lerp(q.depth, 1, a),
    rotX: q.tilt * off,
    rotZ: q.spin * off * (reduced ? 4 : spinT * 2 + 4),
  };
}

export function reactorOpacities(a: number, fade: number) {
  const wall = lerp(0.3, 1, a * a);
  return {
    line: fade * wall,
    lineSoft: 0.6 * fade * wall,
    lineFaint: 0.42 * fade * lerp(0.5, 1, a),
    disc: fade * lerp(0.14, 1, a),
    d14: fade,
    d6: fade,
  };
}

/** Spin speed multiplier: boosted during ignition and by typing energy. */
export function spinBoost(mode: "ignite" | "other", ig: number, energyTotal: number) {
  return mode === "ignite" ? 4 * Math.sin(Math.PI * clamp(ig * 1.6)) : clamp(energyTotal) * 5;
}

// ---- ignition ------------------------------------------------------------------
export const nodeProgress = (p: number, i: number) =>
  ease(seg(p, 0.34 + i * 0.04, 0.78 + i * 0.03));

/** Every ignition visual as a function of p (port of igniteFrame()). */
export function igniteLook(p: number, reduced = false) {
  const g = ease(seg(p, 0.12, 0.5));
  const vis2 = seg(p, 0.5, 0.9);
  const fade = 1 - seg(p, 0.16, 0.5);
  // reduced motion: the camera cuts at p = .5, hidden in the fade to black
  const k = reduced ? (p > 0.5 ? 1 : 0) : ease(seg(p, 0.1, 0.85));
  return {
    // login reactor comes back as geometry, then comes apart
    a: 0.5 * (1 - ease(seg(p, 0.05, 0.5))),
    hull: 0.6 * (1 - ease(seg(p, 0, 0.25))),
    fade,
    reactorVisible: fade > 0,
    heatMix: seg(p, 0.08, 0.3),
    k,
    fov: lerp(FOV_LOGIN, FOV_CORE, k),
    // Arc Core
    g,
    coreBase: lerp(0.9, 1, g),
    heat: seg(p, 0.1, 0.32),
    coreLight: 70000 * g,
    ringU: ease(seg(p, 0.2, 0.78)),
    statusK: ease(seg(p, 0.62, 0.9)),
    vis2,
    extrasVisible: p > 0.1,
    coronaOpacity: 0.55 * ease(seg(p, 0.25, 0.65)),
    shellOpacity: 0.17 * seg(p, 0.3, 0.7),
    floorOpacity: 0.15 * vis2,
    orbitOpacity: 0.22 * vis2,
    ringDecoOpacity: 0.85 * ease(seg(p, 0.3, 0.8)),
    beadsVisible: p > 0.45,
    packets: p > 0.7 ? vis2 : 0,
    dustOpacity: 0.55 * seg(p, 0.4, 0.9),
    bloom: {
      strength: lerp(0.26, 0.62, ease(seg(p, 0.08, 0.35))),
      threshold: lerp(0.5, 0.55, p),
      radius: 0.55,
    },
    fogNear: 1500,
    fogFar: 3200,
    grid: 1 - seg(p, 0.1, 0.5),
    labels: seg(p, 0.72, 0.95),
  };
}

/**
 * Ignition flash (the demo's ark-flash, mapped onto p so it follows skip):
 * white .55 at 0.4 s → reactor-hot 35 % at 1.0 s → gone at 1.9 s of the 2.6 s run.
 * `hotMix` is the share of --reactor-hot in the colour (0 = white).
 */
export function arkFlash(p: number, reduced: boolean) {
  if (reduced) return { alpha: Math.sin(Math.PI * p) ** 2, hotMix: 0, black: true };
  const t = p * DUR.full;
  if (t < 0.4 || t >= 1.9) return { alpha: 0, hotMix: 0, black: false };
  if (t < 1.0) {
    const k = ease((t - 0.4) / 0.6);
    return { alpha: lerp(0.55, 0.245, k), hotMix: k, black: false };
  }
  const k = ease((t - 1.0) / 0.9);
  return { alpha: lerp(0.245, 0, k), hotMix: 1, black: false };
}

/** The whole overlay fades out between P_LIVE and p = 1 while the dashboard shows through. */
export const overlayOpacity = (p: number) => 1 - ease(seg(p, P_LIVE, 1));
/** The overlay stops catching input the moment the dashboard may mount. */
export const overlayInteractive = (p: number) => p < P_LIVE;

// ---- adaptive quality ------------------------------------------------------------
export const QUALITY_WINDOW = 120;
export const SLOW_FRAME_S = 0.034;

/**
 * After QUALITY_WINDOW frames, more than half slower than 34 ms → drop DPR only
 * (never geometry, shader or bloom). Returns the new DPR, or null to keep it.
 */
export function qualityVerdict(
  frames: number,
  slowFrames: number,
  currentDpr: number,
  deviceDpr: number,
): number | null {
  if (frames !== QUALITY_WINDOW || slowFrames * 2 <= frames) return null;
  const floor = Math.min(deviceDpr, 1.25);
  return currentDpr > floor ? floor : null;
}

/** Initial render DPR: capped at 1.75, or 1.5 on narrow screens. */
export const initialDpr = (deviceDpr: number, viewportWidth: number) =>
  Math.min(deviceDpr, viewportWidth < 760 ? 1.5 : 1.75);

// ---- end-frame alignment with the /jarvis canvas ----------------------------------
/** 0 until P_LIVE (the dashboard mounts), then eases to 1 at p = 1. */
export const viewBlend = (p: number) => ease(seg(p, P_LIVE, 1));

export interface ViewOffset {
  aspect: number;
  fullWidth: number;
  fullHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Camera view mapping that blends the full-screen frame (w = 0) into the exact
 * frame JarvisCanvas renders into its own rect (w = 1): the camera's frustum
 * (aspect of the rect) fills `rect`, the rest of the screen shows its surroundings.
 * Uses three's setViewOffset(fullWidth, fullHeight, x, y, width, height).
 */
export function viewOffsetFor(
  w: number,
  viewport: { width: number; height: number },
  rect: { left: number; top: number; width: number; height: number } | null,
): ViewOffset | null {
  if (!rect || rect.width <= 0 || rect.height <= 0 || w <= 0) return null;
  return {
    aspect: lerp(viewport.width / viewport.height, rect.width / rect.height, w),
    fullWidth: lerp(viewport.width, rect.width, w),
    fullHeight: lerp(viewport.height, rect.height, w),
    x: lerp(0, -rect.left, w),
    y: lerp(0, -rect.top, w),
    width: viewport.width,
    height: viewport.height,
  };
}
