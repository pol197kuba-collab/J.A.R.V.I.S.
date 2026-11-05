// Pure math of the login → Arc Core scene. No three.js, no DOM: every visual is
// a function of the single phase variable p ∈ [0,1] (0 = login screen,
// 1 = Arc Core), ported 1:1 from docs/login-scene-prototype/src/main.js so the
// same curves drive the app and the demo. Vec3 is a plain {x,y,z}.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ---- motion budget -------------------------------------------------------
/** Transition length in seconds per motion variant. */
export const DUR = { full: 2.4, short: 0.9, min: 0.4 } as const;
/** Phase at which the dashboard may mount (≈ 1.4 s of the full 2.4 s). */
export const P_LIVE = 0.58;
/** Fast-forward multiplier on pointerdown / keydown during the transition. */
export const SKIP_MULT = 6;
/** Boot intro (reactor spin-up on the login screen), seconds. */
export const BOOT_SECONDS = 1.5;
/** Wrong-key shake length, seconds. */
export const SHAKE_SECONDS = 0.45;

export type MotionVariant = "full" | "min";

/** prefers-reduced-motion: reduce → the "min" variant (camera cut hidden in a fade to black). */
export function pickMotionVariant(reducedMotion: boolean): MotionVariant {
  return reducedMotion ? "min" : "full";
}

// ---- helpers -------------------------------------------------------------
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const ease = (t: number) => t * t * (3 - 2 * t);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Progress of p through [a, b], clamped to 0..1. */
export const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));

// ---- transition driver ---------------------------------------------------
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

// ---- camera --------------------------------------------------------------
/** Camera distance/offset that puts the reactor (SVG viewBox 200) on a DOM rect. */
export function fitCamera(
  rect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
  fovDeg = 32,
): Vec3 {
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  const ppu = rect.width / 200;
  const d = viewport.height / (2 * tan * ppu);
  return {
    x: -(rect.left + rect.width / 2 - viewport.width / 2) / ppu,
    y: (rect.top + rect.height / 2 - viewport.height / 2) / ppu,
    z: d,
  };
}

/** Final Arc Core camera position; wider on tall viewports (prototype rule). */
export function coreCameraPosition(scale: number, aspect: number): Vec3 {
  const m = clamp(1.3 / aspect, 1, 2.3);
  return { x: 0, y: 2.2 * scale * m, z: 8.5 * scale * m };
}

export const FOV_LOGIN = 32;
export const FOV_CORE = 45;

export interface CameraInput {
  /** Login camera (fitCamera result). */
  anchor: Vec3;
  /** Point the login camera looks at. */
  lookAnchor: Vec3;
  endCam: Vec3;
  endLook: Vec3;
  /** Boot intro progress 0..1 (raw, eased here). */
  boot: number;
  reduced: boolean;
  /** Smoothed pointer, -1..1. */
  pointer: { x: number; y: number };
}

/** Quadratic Bézier login → dive → core, plus parallax and fov. */
export function cameraAt(
  p: number,
  o: CameraInput,
): { position: Vec3; lookAt: Vec3; fov: number; k: number } {
  const bootE = ease(o.boot);
  const L: Vec3 = { x: o.anchor.x, y: o.anchor.y, z: o.anchor.z * lerp(1.5, 1, bootE) };
  const Lm: Vec3 = { x: o.anchor.x * 0.3, y: o.anchor.y * 0.3, z: L.z * 0.42 };
  const k = o.reduced ? (p > 0.5 ? 1 : 0) : ease(seg(p, 0.04, 0.9));
  const a = (1 - k) * (1 - k);
  const b = 2 * (1 - k) * k;
  const c = k * k;
  const position: Vec3 = {
    x: L.x * a + Lm.x * b + o.endCam.x * c,
    y: L.y * a + Lm.y * b + o.endCam.y * c,
    z: L.z * a + Lm.z * b + o.endCam.z * c,
  };
  const lookAt: Vec3 = {
    x: o.lookAnchor.x * a + o.lookAnchor.x * 0.4 * b + o.endLook.x * c,
    y: o.lookAnchor.y * a + o.lookAnchor.y * 0.4 * b + o.endLook.y * c,
    z: o.endLook.z * c,
  };
  const w = 1 - seg(p, 0, 0.25);
  if (!o.reduced && w > 0) {
    position.x += o.pointer.x * 16 * w;
    position.y -= o.pointer.y * 10 * w;
  }
  return { position, lookAt, fov: lerp(FOV_LOGIN, FOV_CORE, k), k };
}

// ---- reactor (login hologram) --------------------------------------------
export interface ReactorLook {
  /** 0 = fully pulled apart (deep prisms), 1 = flat front-on. */
  a: number;
  fade: number;
  /** 0..1 blend of the line colour primary → reactor. */
  heatMix: number;
  visible: boolean;
}

export function reactorLook(p: number, boot: number): ReactorLook {
  const bootE = ease(boot);
  const aBase = 0.6 * (1 - ease(seg(p, 0.04, 0.5)));
  return {
    a: aBase * lerp(0.15, 1, bootE),
    fade: (1 - seg(p, 0.16, 0.5)) * ease(seg(boot, 0, 0.5)),
    heatMix: seg(p, 0.08, 0.3),
    visible: p < 0.55,
  };
}

export interface PartSpec {
  z: number;
  depth: number;
  tilt: number;
  spin: number;
}

export function reactorPartPose(q: PartSpec, a: number, time: number, reduced: boolean) {
  const off = 1 - a;
  return {
    z: q.z * off,
    scaleZ: lerp(q.depth, 1, a),
    rotX: q.tilt * off,
    rotZ: q.spin * off * (reduced ? 4 : time * 2 + 4),
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

/** Wrong-key shake: strength s² applied to tint, x offset and roll. */
export function shakeAt(shake: number, time: number) {
  const s = shake * shake;
  return {
    tint: s * 0.85,
    x: Math.sin(time * 70) * 5 * s,
    rotZ: Math.sin(time * 53) * 0.035 * s,
  };
}

// ---- Arc Core -------------------------------------------------------------
export function coreLook(p: number) {
  const g = ease(seg(p, 0.12, 0.5));
  return {
    g,
    visible: g > 0,
    baseScale: lerp(0.9, 1, g),
    heat: seg(p, 0.1, 0.32),
    opacity: g,
    lightIntensity: 70000 * g,
  };
}

/** Ring growth 0..1 (rings start at the reactor's r96 and expand to their orbit). */
export const ringGrowth = (p: number) => ease(seg(p, 0.2, 0.78));

/** Agent i flies from the core to its orbit slot. */
export const nodeProgress = (p: number, i: number) =>
  ease(seg(p, 0.34 + i * 0.04, 0.78 + i * 0.03));

export const dustOpacity = (p: number) => lerp(0.3, 0.55, seg(p, 0.4, 0.9));

export function bloomAt(p: number) {
  return {
    strength: lerp(0.3, 0.62, ease(seg(p, 0.08, 0.35))),
    threshold: lerp(0.5, 0.55, p),
    radius: 0.55,
  };
}

// ---- DOM overlays ----------------------------------------------------------
export function overlayLook(p: number, reduced: boolean) {
  return {
    grid: 0.55 * (1 - seg(p, 0.1, 0.5)),
    vignette: lerp(1, 0.35, seg(p, 0.3, 0.9)),
    // ignition flash (var(--reactor), max 30 %), or a plain fade to black when motion is reduced
    flash: reduced ? Math.sin(Math.PI * p) ** 2 : 0.3 * Math.sin(Math.PI * seg(p, 0.18, 0.55)) ** 2,
    flashBlack: reduced,
  };
}

/** The whole overlay fades out between P_LIVE and p = 1 while the dashboard shows through. */
export const overlayOpacity = (p: number) => 1 - ease(seg(p, P_LIVE, 1));
/** The overlay stops catching input the moment the dashboard may mount. */
export const overlayInteractive = (p: number) => p < P_LIVE;

// ---- adaptive quality -------------------------------------------------------
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

// ---- end-frame alignment with the /jarvis canvas ----------------------------
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
