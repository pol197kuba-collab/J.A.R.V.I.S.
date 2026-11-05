// Pure math of the 3D module transitions (approved demo, tempo 1×):
//  - "tunnel": between ordinary modules — gates and the target module's board,
//    flown through like the landing page's tunnel;
//  - "core-enter" / "core-leave": into and out of /jarvis — through the Arc Core,
//    leaving via the agent that owns the target module.
// No three.js, no DOM. World units match the intro scene (SCALE 72).

import { MODULE_ITEMS, MODULE_GROUPS } from "@/components/jarvis/modules";
import { moduleBlurb } from "@/components/jarvis/login-scene/landingData";
import {
  clamp,
  ease,
  easeInOut as io,
  lerp,
  seg,
} from "@/components/jarvis/login-scene/loginSceneMath";

export type TransitionKind = "tunnel" | "core-enter" | "core-leave";

export const JARVIS_PATH = "/jarvis";

/** Durations at tempo 1×, ms. */
export const TRANSITION_MS: Record<TransitionKind, number> = {
  tunnel: 950,
  "core-enter": 1500,
  "core-leave": 1350,
};
/** A second jump within FAST_WINDOW_MS of the previous one runs at FAST_FACTOR of the time. */
export const FAST_WINDOW_MS = 2500;
export const FAST_FACTOR = 0.55;

/** Share of the transition at which the route actually changes (the new page mounts). */
export const SWAP_AT: Record<TransitionKind, number> = {
  tunnel: 0.82,
  "core-enter": 0.7,
  "core-leave": 0.8,
};
/** Share of the transition the old page takes to leave (CSS), and the new one to enter. */
export const PAGE_OUT: Record<TransitionKind, number> = {
  tunnel: 0.25,
  "core-enter": 0.3,
  "core-leave": 0,
};
export const PAGE_IN: Record<TransitionKind, number> = {
  tunnel: 0.3,
  "core-enter": 0.3,
  "core-leave": 0.25,
};

export function pickKind(from: string, to: string): TransitionKind {
  if (to === JARVIS_PATH) return "core-enter";
  if (from === JARVIS_PATH) return "core-leave";
  return "tunnel";
}

export function transitionDuration(kind: TransitionKind, fast: boolean): number {
  return Math.round(TRANSITION_MS[kind] * (fast ? FAST_FACTOR : 1));
}

export const isFastJump = (now: number, lastEnd: number) =>
  lastEnd > 0 && now - lastEnd < FAST_WINDOW_MS;

/**
 * Which agent "owns" a module: the Arc Core flight leaves /jarvis through that
 * agent's node (and enters through it when coming back). Agent slugs as in the
 * agents table; modules not listed go through the core itself.
 */
export const MODULE_AGENT: Readonly<Record<string, string>> = {
  "/documents": "metric",
  "/rynki": "metric",
  "/mozg": "insight",
  "/situation-room": "shield",
  "/system-logs": "shield",
  "/feed": "herald",
};

/** What the tunnel board shows for a route: "MODULE // NN", the title, one line. */
export function moduleBoard(path: string): { index: number; title: string; sub: string } {
  const i = MODULE_ITEMS.findIndex((m) => m.url === path);
  if (i >= 0) {
    const m = MODULE_ITEMS[i];
    const group = MODULE_GROUPS.find((g) => g.items.some((x) => x.url === path));
    return { index: i + 1, title: m.title, sub: moduleBlurb(m.title) ?? group?.label ?? "" };
  }
  // a sub-route (e.g. /agent-hub/forge): name it after its parent module
  const parent = MODULE_ITEMS.find((m) => m.url !== "/" && path.startsWith(`${m.url}/`));
  const leaf = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
  return {
    index: parent ? MODULE_ITEMS.indexOf(parent) + 1 : 0,
    title: leaf ? leaf.replace(/-/g, " ") : "J.A.R.V.I.S.",
    sub: parent?.title ?? "",
  };
}

// ---- tunnel --------------------------------------------------------------------
export const tunnelCamZ = (t: number) => lerp(420, -1260, io(t));
export const tunnelFov = (t: number) => 32 + 14 * Math.sin(Math.PI * t);
export const TUNNEL_BOARD_Z = -1180;
/** Board fades in from far away and out once the camera is through it. */
export const tunnelBoardOpacity = (camZ: number) => {
  const d = camZ - TUNNEL_BOARD_Z;
  return seg(d, 900, 420) * seg(d, 10, 110);
};
/** Board width that fits the frame (portrait phones see a narrow horizontal slice). */
export function tunnelBoardWidth(fovDeg: number, aspect: number, t: number): number {
  const half = Math.atan(Math.tan((fovDeg * Math.PI) / 360) * aspect);
  const fit = Math.min(620, 2 * 520 * Math.tan(half) * 0.86);
  return fit * lerp(1, 1.25, seg(t, 0.55, 0.9));
}
export const tunnelGateScale = (aspect: number) => clamp(aspect * 1.5, 0.42, 1);
export const tunnelOverlay = (t: number) => seg(t, 0, 0.2) * (1 - seg(t, 0.84, 1));
export const tunnelFlash = (t: number) => 0.35 * Math.sin(Math.PI * seg(t, 0.78, 0.96)) ** 2;

// ---- Arc Core: entering /jarvis --------------------------------------------------
/** Camera falls in from deep space onto the matrix (angle, radius share, height share, fov). */
export function coreEnterCamera(t: number) {
  const k = io(seg(t, 0.12, 1));
  return { k, az: lerp(1.25, 0, k), fov: lerp(28, 45, k) };
}
export const CORE_ENTER_FROM = { r: 2900, y: 1300 } as const;
export const coreEnterOverlay = (t: number) => seg(t, 0, 0.25) * (1 - seg(t, 0.84, 1));
export const coreEnterFlash = (t: number) => 0.25 * Math.sin(Math.PI * seg(t, 0.08, 0.3)) ** 2;
export const coreEnterHighlight = (t: number) => Math.sin(Math.PI * seg(t, 0.3, 1));
export const coreEnterHandoff = (t: number) => t > 0.35 && t < 0.9;
/** From the route swap on, the frame lines up with the /jarvis canvas (0 → 1). */
export const coreEnterAlign = (t: number) => ease(seg(t, SWAP_AT["core-enter"], 1));

// ---- Arc Core: leaving /jarvis -----------------------------------------------------
export const coreLeaveTravel = (t: number) => io(seg(t, 0, 0.8));
export const coreLeaveLook = (t: number) => ease(seg(t, 0, 0.5));
export const coreLeaveFov = (t: number) => lerp(45, 32, coreLeaveTravel(t));
export const coreLeaveHighlight = (t: number) => seg(t, 0.05, 0.35);
export const coreLeaveFlash = (t: number) => 0.55 * Math.sin(Math.PI * seg(t, 0.66, 0.96)) ** 2;
export const coreLeaveOverlay = (t: number) => 1 - seg(t, 0.82, 1);
export const coreLeaveHandoff = (t: number) => t > 0.15 && t < 0.75;
/** At the start the frame is the /jarvis canvas rect (1), then the full screen (0). */
export const coreLeaveAlign = (t: number) => 1 - ease(seg(t, 0, 0.3));
/** How far in front of the target the dive stops: a node (gem ×2.2) or the core (1.25 radii). */
export const diveStandoff = (toAgent: boolean, scale: number) =>
  toAgent ? 0.38 * scale * 2.2 : scale * 1.25;
