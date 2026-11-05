// Arc Core v2 layers for the imperative intro scene: wireframe plasma shell,
// corona, holographic floor, orbit paths, ring ticks + travelling beads and
// the light packets. 1:1 port of docs/jarvis-3d-v2/src/core2.js (world units,
// SCALE 72); colours come from theme tokens (sceneColors.ts).
// Imports three: load ONLY through the dynamic import in LoginScene.tsx.

import * as THREE from "three";
import type { SceneColors } from "./sceneColors";
import { SCALE } from "./reactor";
import { orbitAt, type OrbitSpec } from "./orbits";
import type { Vec3 } from "./loginSceneMath";

const additive = (color: THREE.ColorRepresentation, opacity = 0) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

export type RingKind = "fine" | "bold" | "claw";

/** Ticks + a travelling bead on top of an existing torus ring (inherits its scale and tumble). */
export function decorateRing(mesh: THREE.Mesh<THREE.TorusGeometry>, kind: RingKind, color: string) {
  const r = mesh.geometry.parameters.radius;
  const [n, len, wd, rot] = {
    fine: [110, 6, 1, 0],
    bold: [20, 17, 2.4, 0],
    claw: [6, 34, 3.4, Math.PI / 2],
  }[kind];
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(len, wd, 1.2), additive(color, 0), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.set(Math.cos(a) * r, Math.sin(a) * r, 0);
    q.setFromAxisAngle(zAxis, a + rot);
    m.compose(p, q, one);
    inst.setMatrixAt(i, m);
  }
  mesh.add(inst);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(4.4, 16, 12), additive("#ffffff", 0.95));
  bead.visible = false;
  mesh.add(bead);
  return { inst, bead, r };
}

export function buildCoreExtras(specs: OrbitSpec[], C: SceneColors) {
  const group = new THREE.Group();

  // wireframe plasma shell: gives the core a second, structured layer
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2 * SCALE, 2), additive(C.hot, 0));
  shell.material.wireframe = true;
  group.add(shell);

  // soft corona behind the core: gradient instead of a hard, blown-out disc
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const x = cv.getContext("2d")!;
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  const rgba = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  g.addColorStop(0, rgba(C.hot, 0.9));
  g.addColorStop(0.25, rgba(C.reactor, 0.45));
  g.addColorStop(0.6, rgba(C.coronaMid, 0.12));
  g.addColorStop(1, rgba(C.coronaEdge, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const corona = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  corona.renderOrder = -1;
  group.add(corona);

  // holographic floor: concentric rings and spokes under the core give the scene ground and depth
  const pts: THREE.Vector3[] = [];
  [2, 3, 4, 5].forEach((k) => {
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const b = ((i + 1) / 96) * Math.PI * 2;
      pts.push(
        new THREE.Vector3(Math.cos(a) * k * SCALE, 0, Math.sin(a) * k * SCALE),
        new THREE.Vector3(Math.cos(b) * k * SCALE, 0, Math.sin(b) * k * SCALE),
      );
    }
  });
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    pts.push(
      new THREE.Vector3(Math.cos(a) * 1.7 * SCALE, 0, Math.sin(a) * 1.7 * SCALE),
      new THREE.Vector3(Math.cos(a) * 5.2 * SCALE, 0, Math.sin(a) * 5.2 * SCALE),
    );
  }
  const floor = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({
      color: C.primary,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  floor.position.y = -1.9 * SCALE;
  group.add(floor);

  // each agent's orbit path, faint
  const orbits = specs.map((s) => {
    const p: THREE.Vector3[] = [];
    const tmp: Vec3 = { x: 0, y: 0, z: 0 };
    for (let k = 0; k <= 160; k++) {
      orbitAt(s, (k / 160) * Math.PI * 2, tmp);
      p.push(new THREE.Vector3(tmp.x, tmp.y, tmp.z));
    }
    const l = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(p),
      new THREE.LineBasicMaterial({
        color: C.primary,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    group.add(l);
    return l;
  });
  return { group, shell, corona, floor, orbits };
}

/** Light packets running from the core to each agent: fast amber on busy agents, slow cyan on idle. */
export function makePackets(n: number, C: SceneColors, per = 3) {
  const N = n * per;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 7,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;
  const cy = new THREE.Color(C.packetCyan);
  const am = new THREE.Color(C.packetAmber);
  return {
    points,
    update(nodes: Vec3[], busy: boolean[], time: number, vis: number) {
      points.visible = vis > 0.01;
      mat.opacity = vis;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < per; k++) {
          const isBusy = busy[i];
          const t = (time * (isBusy ? 0.55 : 0.22) + k / per + i * 0.173) % 1;
          const idx = (i * per + k) * 3;
          const c = isBusy ? am : cy;
          pos[idx] = nodes[i].x * t;
          pos[idx + 1] = nodes[i].y * t;
          pos[idx + 2] = nodes[i].z * t;
          col[idx] = c.r;
          col[idx + 1] = c.g;
          col[idx + 2] = c.b;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}
