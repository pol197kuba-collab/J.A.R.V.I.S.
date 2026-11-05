// Pure math of the mobile "Orbita" menu: the menu entries are nodes on one
// orbit around the Arc Core, seen from slightly above. Same world units as
// the intro scene (SCALE 72). No three.js, no DOM.

import { clamp, ease, seg } from "@/components/jarvis/login-scene/loginSceneMath";

/** Orbit radius in core radii (× SCALE). */
export const MENU_RING = 3.1;
/** Camera elevation above the orbit plane, degrees. */
export const MENU_ELEV = 46;
export const MENU_FOV = 45;
/** Node size in the menu (× the agent gem). */
export const MENU_NODE_SCALE = 1.35;

export const MENU_OPEN_MS = 420;
export const MENU_CLOSE_MS = 240;
/** Level change: old nodes fall into the core, then the new ones burst out. */
export const MENU_SWITCH_OUT_MS = 200;
export const MENU_SWITCH_IN_MS = 360;
/** Dive into the picked node before the module transition takes over. */
export const MENU_PICK_MS = 480;
/** Per-node delay of the burst-out, ms. */
export const MENU_STAGGER_MS = 35;

const TAU = Math.PI * 2;

/**
 * Angle of node `i` of `n` on the orbit plane (x = cos, z = sin). Node 0 sits at
 * the front (closest to the camera, bottom of the screen) when spin = 0; the
 * rest follow clockwise as seen from above.
 */
export const menuSlotAngle = (i: number, n: number, spin: number) =>
  Math.PI / 2 - (TAU * i) / Math.max(1, n) + spin;

/** Spin that brings node `i` to the front. */
export const spinToFront = (i: number, n: number) => (TAU * i) / Math.max(1, n);

/** Nearest spin at which a node sits exactly at the front. */
export function snapSpin(spin: number, n: number): number {
  const step = TAU / Math.max(1, n);
  return Math.round(spin / step) * step;
}

/** Index of the node closest to the front for a given spin. */
export function frontIndex(spin: number, n: number): number {
  if (n <= 0) return 0;
  const step = TAU / n;
  return (((Math.round(spin / step) % n) + n) % n) as number;
}

/** Horizontal drag (px) → spin (rad): a full screen width turns the orbit by ~π. */
export const dragToSpin = (dxPx: number, widthPx: number) =>
  (-dxPx / Math.max(1, widthPx)) * Math.PI;

/**
 * Camera distance from the core so the whole orbit (plus a node and its label)
 * fits the screen: narrow phones are limited by width, landscape by height.
 */
export function menuCameraDistance(ringR: number, fovDeg: number, aspect: number): number {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  const byWidth = (ringR * 1.32) / tanH;
  const elev = (MENU_ELEV * Math.PI) / 180;
  const byHeight = (ringR * (Math.sin(elev) + 0.55)) / tanV;
  return Math.max(byWidth, byHeight);
}

/** Opening: radius/scale share of node `i` (staggered) and the camera pull-back. */
export function menuOpenK(elapsedMs: number, i: number) {
  return ease(seg(elapsedMs - i * MENU_STAGGER_MS, 60, MENU_OPEN_MS));
}
export const menuOpenCam = (elapsedMs: number) => ease(seg(elapsedMs, 0, MENU_OPEN_MS));
export const menuOpenFade = (elapsedMs: number) => seg(elapsedMs, 0, 160);

export const menuCloseK = (elapsedMs: number) => 1 - ease(seg(elapsedMs, 0, MENU_CLOSE_MS));

/** Level change: 1 → 0 while the old level falls in, then 0 → 1 per node for the new one. */
export function menuSwitchK(elapsedMs: number, i: number): { k: number; incoming: boolean } {
  if (elapsedMs < MENU_SWITCH_OUT_MS)
    return { k: 1 - ease(seg(elapsedMs, 0, MENU_SWITCH_OUT_MS)), incoming: false };
  const e = elapsedMs - MENU_SWITCH_OUT_MS - i * MENU_STAGGER_MS;
  return { k: ease(seg(e, 0, MENU_SWITCH_IN_MS)), incoming: true };
}
export const menuSwitchDone = (elapsedMs: number, n: number) =>
  elapsedMs >= MENU_SWITCH_OUT_MS + MENU_SWITCH_IN_MS + Math.max(0, n - 1) * MENU_STAGGER_MS;

/** Pick: camera travel share, highlight of the picked node, fade of the others. */
export const menuPickTravel = (elapsedMs: number) => ease(seg(elapsedMs, 60, MENU_PICK_MS));
export const menuPickHighlight = (elapsedMs: number) => seg(elapsedMs, 0, 140);
export const menuPickOthers = (elapsedMs: number) => 1 - seg(elapsedMs, 0, 220);
export const menuPickFlash = (elapsedMs: number) =>
  0.45 * Math.sin(Math.PI * seg(elapsedMs, MENU_PICK_MS * 0.6, MENU_PICK_MS * 1.25)) ** 2;

/** Spin inertia: velocity (rad/s) decay per second, and the spring to the snap angle. */
export const SPIN_DECAY = 4.5;
export const SPIN_SPRING = 9;
export function stepSpin(
  spin: number,
  vel: number,
  n: number,
  dt: number,
): { spin: number; vel: number } {
  let v = vel * Math.exp(-SPIN_DECAY * dt);
  let s = spin + v * dt;
  if (Math.abs(v) < 0.6) {
    v = 0;
    const target = snapSpin(s, n);
    s += (target - s) * clamp(dt * SPIN_SPRING, 0, 1);
    if (Math.abs(target - s) < 1e-4) s = target;
  }
  return { spin: s, vel: v };
}
