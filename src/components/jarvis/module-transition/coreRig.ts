// The Arc Core's three tumbling rings (ticks + travelling beads), exactly as the
// /jarvis matrix and the module transitions draw them. Shared by the transition
// scene and the dock's mini core so both stay identical.
//
// Imports three: load ONLY through dynamic imports (createTransitionScene.ts,
// createMiniCore.ts), never from the main bundle.

import * as THREE from "three";
import { SCALE } from "@/components/jarvis/login-scene/reactor";
import { decorateRing, type RingKind } from "@/components/jarvis/login-scene/core2";
import type { SceneColors } from "@/components/jarvis/login-scene/sceneColors";

const RING_KINDS: RingKind[] = ["fine", "bold", "claw"];

export interface CoreRing {
  m: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  deco: ReturnType<typeof decorateRing>;
  d: { rot: number[]; v: number[] };
  spin: number[];
}

/** Build the three rings into `parent` (the core's group). */
export function buildCoreRings(C: SceneColors, parent: THREE.Object3D): CoreRing[] {
  const ringDefs = [
    {
      r: 1.55,
      tube: 1.1,
      color: C.reactor,
      op: 0.75,
      rot: [Math.PI / 2.3, 0, 0],
      v: [0.25, 0, 0],
      deco: C.hot,
    },
    {
      r: 1.85,
      tube: 0.8,
      color: C.primary,
      op: 0.55,
      rot: [Math.PI / 3.1, Math.PI / 5, 0],
      v: [0, 0.18, 0],
      deco: C.primary,
    },
    {
      r: 2.1,
      tube: 0.7,
      color: C.reactor,
      op: 0.45,
      rot: [0, Math.PI / 2.4, Math.PI / 6],
      v: [0, 0, 0.32],
      deco: C.reactor,
    },
  ];
  return ringDefs.map((d, i) => {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(d.r * SCALE, d.tube, 10, 180),
      new THREE.MeshBasicMaterial({
        color: d.color,
        transparent: true,
        opacity: d.op,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    parent.add(m);
    const deco = decorateRing(m, RING_KINDS[i], d.deco);
    deco.inst.material.opacity = 0.85;
    deco.bead.visible = true;
    return { m, deco, d, spin: [0, 0, 0] };
  });
}

/** Tumble the rings by `dt` seconds and run their beads at clock `time`. */
export function stepCoreRings(rings: CoreRing[], dt: number, time: number) {
  rings.forEach((r, i) => {
    r.spin[0] += r.d.v[0] * dt;
    r.spin[1] += r.d.v[1] * dt;
    r.spin[2] += r.d.v[2] * dt;
    r.m.rotation.set(r.d.rot[0] + r.spin[0], r.d.rot[1] + r.spin[1], r.d.rot[2] + r.spin[2]);
    const a = time * (i % 2 ? -0.9 : 0.7) + i * 2;
    r.deco.bead.position.set(Math.cos(a) * r.deco.r, Math.sin(a) * r.deco.r, 0);
  });
}
