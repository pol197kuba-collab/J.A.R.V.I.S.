// Per-agent orbits of Arc Core v2 (core2.js): every agent gets its own radius,
// tilt and angular speed, so the matrix is no longer one flat ring. Pure, no
// three.js — shared by the imperative intro scene (world units, SCALE 72) and
// the R3F /jarvis canvas (app units, MATRIX_SCALE 0.72).
//
// The arrays have 6 entries and repeat cyclically: with more than 6 agents the
// 7th shares the 1st orbit's radius/tilt/speed (its start angle still differs).

import type { Vec3 } from "./loginSceneMath";

export const ORBIT_R = [3.2, 3.95, 3.4, 4.4, 3.7, 4.15] as const;
export const ORBIT_TILT = [0.25, -0.38, 0.08, -0.22, 0.42, -0.1] as const;
export const ORBIT_SPD = [0.16, -0.12, 0.21, -0.09, 0.14, -0.18] as const;

export interface OrbitSpec {
  /** Radius in world units (R × scale). */
  r: number;
  tilt: number;
  /** Angular speed, rad/s. */
  w: number;
  /** Start angle: agents are spread evenly, the first at the top. */
  a0: number;
}

export function orbitSpec(i: number, n: number, scale: number): OrbitSpec {
  return {
    r: ORBIT_R[i % 6] * scale,
    tilt: ORBIT_TILT[i % 6],
    w: ORBIT_SPD[i % 6],
    a0: (i / n) * Math.PI * 2 - Math.PI / 2,
  };
}

/** Position on the orbit at angle `a`, written into `out`. */
export function orbitAt(s: OrbitSpec, a: number, out: Vec3): Vec3 {
  const x = Math.cos(a) * s.r;
  const z = Math.sin(a) * s.r;
  out.x = x;
  out.y = -z * Math.sin(s.tilt);
  out.z = z * Math.cos(s.tilt);
  return out;
}

/** Orbit angle of agent `s` at time `t` (frozen when motion is reduced). */
export const orbitAngle = (s: OrbitSpec, t: number, reduced = false) =>
  s.a0 + (reduced ? 0 : s.w * t);

/** Resting ring used on the landing page (and by the legacy JarvisCanvas layout). */
export function ringPosition(i: number, n: number, scale: number): Vec3 {
  const radius = (n <= 4 ? 2.6 : n <= 6 ? 3.0 : 3.4) * scale;
  const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Math.cos(angle) * radius,
    y: (i % 2 === 0 ? 1 : -1) * 0.35 * scale,
    z: Math.sin(angle) * radius,
  };
}
