// Pure helpers of the R3F Arc Core v2 (/jarvis). The demo runs in world units
// (SCALE 72); the app in MATRIX_SCALE 0.72, so EVERY length from the demo is
// multiplied by 0.01 (radii, tube thickness, tick lengths, node size, point
// sizes, camera distances, fog, light distance). Light intensity follows the
// inverse-power falloff: I_app = I_demo × 0.01^decay keeps the illumination
// identical at the scaled distances.

import { MATRIX_SCALE } from "@/components/jarvis/matrixScale";
import {
  clamp,
  coreCameraPosition,
  type Vec3,
} from "@/components/jarvis/login-scene/loginSceneMath";

/** Demo world units → app units. */
export const U = 0.01;
/** Scale of the whole composition (= MATRIX_SCALE; the demo's SCALE 72 × U). */
export const S = MATRIX_SCALE;

/** The demo's core light, in demo units (main.js: PointLight(reactor, 0→70000, 1400, 1.7)). */
export const CORE_LIGHT_DEMO = { intensity: 70000, distance: 1400, decay: 1.7 } as const;

/** Convert a demo point light (units, intensity) to app units. */
export function lightToApp(l: { intensity: number; distance: number; decay: number }) {
  return {
    intensity: l.intensity * Math.pow(U, l.decay),
    distance: l.distance * U,
    decay: l.decay,
  };
}

/** Fog of the Arc Core frame (ignition: 1500 / 3200 demo units). */
export const CORE_FOG = { near: 1500 * U, far: 3200 * U } as const;

/** Camera clip planes (demo 1 / 7000). */
export const CORE_CLIP = { near: 1 * U, far: 7000 * U } as const;

/** Final Arc Core bloom (ignition end state: strength .62, threshold .55, radius .55). */
export const CORE_BLOOM = { strength: 0.62, threshold: 0.55, radius: 0.55 } as const;

export const CORE_FOV = 45;

/** Camera position for a canvas of this aspect (tall canvases pull back, clamp(1.35 / aspect, 1, 2.5)). */
export function coreCamera(aspect: number): Vec3 {
  return coreCameraPosition(S, aspect);
}

/** OrbitControls limits proportional to the composition (demo: 5·S … max(14·S, |coreCam|·1.2)). */
export function orbitLimits(aspect: number) {
  const c = coreCamera(aspect);
  return { min: 5 * S, max: Math.max(14 * S, Math.hypot(c.x, c.y, c.z) * 1.2) };
}

export type NodeStatus = "idle" | "busy" | "error" | "disabled";

export function nodeStatus(a: { isEnabled: boolean; status: string }): NodeStatus {
  if (!a.isEnabled) return "disabled";
  return a.status === "busy" ? "busy" : a.status === "error" ? "error" : "idle";
}

/** m:ss readout for a busy agent ("BUSY 00:41"). */
export function formatBusy(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Label line under an agent's name: "● BUSY 00:41" / "● IDLE" / "● ERROR" / "● OFFLINE". */
export function statusLine(status: NodeStatus, busySeconds: number): string {
  switch (status) {
    case "busy":
      return `● BUSY ${formatBusy(busySeconds)}`;
    case "error":
      return "● ERROR";
    case "disabled":
      return "● OFFLINE";
    default:
      return "● IDLE";
  }
}

/** Extra pixels a label drops below its node on narrow screens (nothing to its side there). */
export const NARROW_LABEL_DROP = 34;
export const NARROW_PX = 760;

/** Core-pulse and light-pulse factors shared with the demo (core.scale = 1 + sin(t·1.4)·.03). */
export const corePulse = (t: number) => 1 + Math.sin(t * 1.4) * 0.03;
export const coronaPulse = (t: number) => 1 + Math.sin(t * 1.4) * 0.08;

/** Ring bead angle: (i odd ? −.9 : .7)·t + 2i. */
export const beadAngle = (i: number, t: number) => t * (i % 2 ? -0.9 : 0.7) + i * 2;

/** Packet position along its spoke, 0..1 (fast on busy agents, slow on idle). */
export const packetT = (time: number, busy: boolean, k: number, per: number, i: number) =>
  (time * (busy ? 0.55 : 0.22) + k / per + i * 0.173) % 1;

export const clamp01 = (v: number) => clamp(v);
