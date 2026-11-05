// Pure math of the 3D module backdrop: while no transition or menu plays, the
// transition scene's canvas sits UNDER the panels and shows the same world the
// transitions fly through — the Arc Core with its agents, far away and dimmed.
// Every module looks at it from its own angle; the page scroll and the phone's
// tilt move the camera a little (parallax: the world moves slower than the
// panels). World units as the intro scene (SCALE 72). No three.js, no DOM.

import { MODULE_ITEMS } from "@/components/jarvis/modules";
import { clamp, ease, lerp, seg, type Vec3 } from "@/components/jarvis/login-scene/loginSceneMath";

/** Routes with their own full-screen canvas: no backdrop under them. */
export const NO_BACKDROP_PATHS: readonly string[] = ["/jarvis", "/mozg", "/town"];

export const hasBackdrop = (path: string) =>
  !NO_BACKDROP_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/** Canvas opacity at rest over the black page: dim enough to read panels on top. */
export const BACKDROP_OPACITY = 0.72;
/** Fade-in when the backdrop comes back after a transition / the menu, ms. */
export const BACKDROP_FADE_MS = 520;
/** Rest rendering rate (the world moves slowly; this halves the GPU cost). */
export const BACKDROP_FPS = 30;

const GOLDEN = 2.399963229728653; // golden angle: neighbouring modules look far apart

/** Stable per-module seed: the module's index in the registry (sub-routes share the parent's). */
export function backdropSeed(path: string): number {
  const i = MODULE_ITEMS.findIndex((m) => m.url === path);
  if (i >= 0) return i;
  const parent = MODULE_ITEMS.findIndex((m) => m.url !== "/" && path.startsWith(`${m.url}/`));
  return parent >= 0 ? parent : 0;
}

/** Camera azimuth of a module's view (rad). */
export const backdropAzimuth = (seed: number) => seed * GOLDEN;

export interface BackdropInput {
  /** Current (smoothed) azimuth, rad. */
  az: number;
  /** Seconds since the backdrop started: a slow orbit keeps the world alive. */
  time: number;
  /** Scroll of the page (px) and the viewport height (px). */
  scrollPx: number;
  viewportH: number;
  /** Viewport aspect (w / h). */
  aspect: number;
  /** Smoothed tilt, each -1…1 (device orientation or pointer). */
  tiltX: number;
  tiltY: number;
}

/**
 * Where the backdrop camera is and what it looks at. The core sits in the upper
 * part of the screen (behind the header), small and far; scrolling a page down
 * lifts it further away slowly; tilting the phone swings the view a few degrees.
 */
export function backdropCamera(o: BackdropInput): { cam: Vec3; look: Vec3 } {
  const portrait = o.aspect < 1;
  const dist = portrait ? 1750 : 1350;
  const az = o.az + o.time * 0.012 + o.tiltX * 0.16;
  const elev = 0.26 + o.tiltY * 0.08;
  // scroll parallax: one screen of scroll moves the look point by ~170 units, capped
  const pages = clamp(o.scrollPx / Math.max(1, o.viewportH), 0, 6);
  const lift = 170 * (1 - Math.exp(-pages * 0.9));
  const cam = {
    x: Math.sin(az) * Math.cos(elev) * dist,
    y: Math.sin(elev) * dist,
    z: Math.cos(az) * Math.cos(elev) * dist,
  };
  // look below the core so it rides high on the screen; landscape a bit to the left
  const look = {
    x: portrait ? 0 : Math.cos(az) * 260,
    y: (portrait ? -330 : -230) - lift,
    z: portrait ? 0 : -Math.sin(az) * 260,
  };
  return { cam, look };
}

/** Smoothly turn `from` toward `to` (shortest way round), `k` per second. */
export function approachAngle(from: number, to: number, dt: number, k = 2.2): number {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + d * clamp(dt * k, 0, 1);
}

/** Opacity while the backdrop fades back in after a transition. */
export const backdropFade = (elapsedMs: number) =>
  BACKDROP_OPACITY * ease(seg(elapsedMs, 0, BACKDROP_FADE_MS));

/** Tilt from device orientation (deg) → -1…1, centred on how the phone is usually held. */
export function tiltFromOrientation(beta: number | null, gamma: number | null) {
  return {
    x: clamp((gamma ?? 0) / 30, -1, 1),
    y: clamp(((beta ?? 50) - 50) / 30, -1, 1),
  };
}

export const smooth = (from: number, to: number, dt: number, k = 4) =>
  lerp(from, to, clamp(dt * k, 0, 1));
