// Module tunnel of the landing page: triangular gates borrowed from the reactor
// segments, a white portal at the end and one 3D board per app module. Port of
// the tunnel part of docs/jarvis-3d-v2/src/main.js (world units, SCALE 72).
// Imports three: load ONLY through the dynamic import in LoginScene.tsx.

import * as THREE from "three";
import { TUNNEL, boardPlacement } from "./loginSceneMath";
import type { SceneColors } from "./sceneColors";

export interface TunnelModule {
  title: string;
  sub: string;
}

function triOutline(r: number, w: number) {
  const s = new THREE.Shape();
  const h = new THREE.Path();
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + i * 2.0944;
    const f = i ? "lineTo" : "moveTo";
    s[f](Math.cos(a) * r, Math.sin(a) * r);
    h[f](Math.cos(a) * (r - w), Math.sin(a) * (r - w));
  }
  s.closePath();
  h.closePath();
  s.holes.push(h);
  return new THREE.ShapeGeometry(s);
}

function boardTexture(C: SceneColors, name: string, sub: string, i: number) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 400;
  const x = c.getContext("2d")!;
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  };
  x.fillStyle = `rgba(${rgb(C.boardFill)},.13)`;
  x.fillRect(0, 0, 1024, 400);
  x.strokeStyle = C.primary;
  x.lineWidth = 4;
  x.strokeRect(10, 10, 1004, 380);
  x.fillStyle = C.primary;
  [
    [10, 10],
    [974, 10],
    [10, 374],
    [974, 374],
  ].forEach(([a, b]) => x.fillRect(a, b, 40, 16));
  x.font = '400 40px "Share Tech Mono","JetBrains Mono",monospace';
  x.fillText(`MODULE // ${String(i + 1).padStart(2, "0")}`, 56, 92);
  x.fillStyle = C.foreground;
  x.font = '400 112px "Share Tech Mono","JetBrains Mono",monospace';
  x.fillText(name.toUpperCase(), 54, 226);
  x.fillStyle = C.muted;
  x.font = '400 40px "JetBrains Mono",monospace';
  x.fillText(sub, 56, 320);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildTunnel(C: SceneColors, modules: TunnelModule[]) {
  const group = new THREE.Group();
  group.visible = false;
  const gateMat = new THREE.MeshBasicMaterial({
    color: C.primary,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const gateSoft = gateMat.clone();
  gateSoft.opacity = 0.35;
  const gateCount = modules.length + 3;
  const triGeo = triOutline(420, 7);
  const triGeo2 = triOutline(392, 2.4);
  const ringGeo = new THREE.RingGeometry(508, 512, 128);
  const gates: THREE.Group[] = [];
  for (let i = 0; i < gateCount; i++) {
    const g = new THREE.Group();
    g.position.z = TUNNEL.first - i * TUNNEL.step;
    g.rotation.z = i * 0.36;
    g.add(
      new THREE.Mesh(triGeo, gateMat),
      new THREE.Mesh(triGeo2, gateSoft),
      new THREE.Mesh(ringGeo, gateSoft),
    );
    group.add(g);
    gates.push(g);
  }
  const portal = new THREE.Mesh(
    new THREE.SphereGeometry(170, 40, 28),
    new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false }),
  );
  portal.position.z = TUNNEL.end - 240;
  group.add(portal);

  const boards = modules.map((m, i) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.39),
      new THREE.MeshBasicMaterial({
        map: boardTexture(C, m.title, m.sub, i),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    group.add(mesh);
    return mesh;
  });

  return {
    group,
    gates,
    boards,
    portal,
    gateMat,
    /** Per-viewport placement: narrow screens get boards closer to the axis. */
    place(portrait: boolean) {
      boards.forEach((m, i) => {
        const b = boardPlacement(i, portrait);
        m.scale.set(b.size, b.size, 1);
        m.position.set(b.x, b.y, b.z);
        m.rotation.y = b.rotY;
      });
    },
    /** Redraw the board canvases (called once the web fonts are ready). */
    retexture() {
      boards.forEach((m, i) => {
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.map = boardTexture(C, modules[i].title, modules[i].sub, i);
        mat.needsUpdate = true;
      });
    },
  };
}
