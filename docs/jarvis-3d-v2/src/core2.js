import * as THREE from 'three';
import { C, SCALE } from './reactor.js';

// Arc Core v2: the extra layers that make the core read as a machine instead of a ball.
// Everything here is decoration around buildCore() / buildNode() and is driven from main.js by phase p.

const additive = (color, opacity = 0) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });

// Every agent gets its own orbit: different radius, tilt and angular speed, so the matrix is no longer one flat ring.
const R = [3.2, 3.95, 3.4, 4.4, 3.7, 4.15], TILT = [.25, -.38, .08, -.22, .42, -.1], SPD = [.16, -.12, .21, -.09, .14, -.18];
export function orbitSpec(i, n) {
  return { r: R[i % 6] * SCALE, tilt: TILT[i % 6], w: SPD[i % 6], a0: (i / n) * Math.PI * 2 - Math.PI / 2 };
}
export function orbitAt(s, a, out) {
  const x = Math.cos(a) * s.r, z = Math.sin(a) * s.r;
  return out.set(x, -z * Math.sin(s.tilt), z * Math.cos(s.tilt));
}

// ticks + a travelling bead on top of an existing torus ring (so it inherits the ring's scale and tumble)
export function decorateRing(mesh, kind, color) {
  const r = mesh.geometry.parameters.radius;
  const spec = { fine: [110, 6, 1, 0], bold: [20, 17, 2.4, 0], claw: [6, 34, 3.4, Math.PI / 2] }[kind];
  const [n, len, wd, rot] = spec;
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(len, wd, 1.2), additive(color, 0), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    p.set(Math.cos(a) * r, Math.sin(a) * r, 0); q.setFromAxisAngle(zAxis, a + rot); m.compose(p, q, one); inst.setMatrixAt(i, m);
  }
  mesh.add(inst);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(4.4, 16, 12), additive(0xffffff, .95));
  bead.visible = false; mesh.add(bead);
  return { inst, bead, r };
}

export function buildCoreExtras(specs) {
  const group = new THREE.Group();

  // wireframe plasma shell: gives the core a second, structured layer
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2 * SCALE, 2), additive(C.hot, 0));
  shell.material.wireframe = true; group.add(shell);

  // soft corona behind the core: gradient instead of a hard, blown-out disc
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const x = cv.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,205,66,.9)'); g.addColorStop(.25, 'rgba(255,173,0,.45)'); g.addColorStop(.6, 'rgba(255,120,0,.12)'); g.addColorStop(1, 'rgba(255,100,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
  corona.renderOrder = -1; group.add(corona);

  // holographic floor: concentric rings and spokes under the core give the scene ground and depth
  const pts = [];
  [2, 3, 4, 5].forEach((k) => { for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, b = (i + 1) / 96 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * k * SCALE, 0, Math.sin(a) * k * SCALE), new THREE.Vector3(Math.cos(b) * k * SCALE, 0, Math.sin(b) * k * SCALE)); } });
  for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * 1.7 * SCALE, 0, Math.sin(a) * 1.7 * SCALE), new THREE.Vector3(Math.cos(a) * 5.2 * SCALE, 0, Math.sin(a) * 5.2 * SCALE)); }
  const floor = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: C.primary, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  floor.position.y = -1.9 * SCALE; group.add(floor);

  // each agent's orbit path, faint
  const orbits = specs.map((s) => {
    const p = [];
    for (let k = 0; k <= 160; k++) p.push(orbitAt(s, k / 160 * Math.PI * 2, new THREE.Vector3()));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), new THREE.LineBasicMaterial({ color: C.primary, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    group.add(l); return l;
  });
  return { group, shell, corona, floor, orbits };
}

// light packets running from the core to each agent: faster and amber on busy agents, slow cyan on idle ones
export function makePackets(n, per = 3) {
  const N = n * per, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 7, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat); points.frustumCulled = false; points.visible = false;
  const cy = new THREE.Color(0x7ff4ff), am = new THREE.Color(0xffd36a);
  return {
    points,
    update(nodes, status, time, vis) {
      points.visible = vis > .01; mat.opacity = vis;
      for (let i = 0; i < n; i++) for (let k = 0; k < per; k++) {
        const busy = status[i] === 'busy', t = (time * (busy ? .55 : .22) + k / per + i * .173) % 1, idx = (i * per + k) * 3, c = busy ? am : cy;
        pos[idx] = nodes[i].position.x * t; pos[idx + 1] = nodes[i].position.y * t; pos[idx + 2] = nodes[i].position.z * t;
        col[idx] = c.r; col[idx + 1] = c.g; col[idx + 2] = c.b;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
}
