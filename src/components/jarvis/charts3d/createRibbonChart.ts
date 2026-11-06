// The 3D ribbon chart ("data in space"): every series is a glowing tube of light
// over a floor grid in perspective, with a light curtain down to the floor; the
// forecast continues as beads with a cone of uncertainty; in index mode the
// series stand one behind another. The plot turns a little with the pointer.
// Renders ON DEMAND only (data change, entrance, pointer, resize) — it never
// runs a loop on its own, so it costs nothing while the page sits still.
//
// Imports three: load ONLY through the dynamic import in RibbonChart3D.tsx.

import * as THREE from "three";
import {
  RIBBON_DEPTH,
  RIBBON_GROW_MS,
  RIBBON_H,
  RIBBON_ROW_GAP,
  RIBBON_W,
  labelIndices,
  nearestIndex,
  niceTicks,
  ribbonCameraDistance,
  ribbonDomain,
  ribbonWidthScale,
  ribbonX,
  ribbonY,
} from "./ribbonMath";

export interface RibbonSeriesInput {
  key: string;
  /** Resolved colour (hex) — three.js can't read CSS variables. */
  color: string;
  /** Points by row index (rows = union of dates, forecast days included). */
  points: Array<{ i: number; v: number }>;
  forecast?: Array<{ i: number; mid: number; low: number; high: number }>;
}

export interface RibbonInput {
  rows: number;
  series: RibbonSeriesInput[];
  /** Date labels by row index. */
  dateLabel: (i: number) => string;
  formatY: (v: number) => string;
  /** Series stand one behind another (index mode) instead of a single ribbon. */
  stacked: boolean;
}

export interface RibbonColors {
  primary: string;
  muted: string;
  hot: string;
}

export interface RibbonHover {
  /** Row under the pointer, its point position on the canvas (px). */
  i: number;
  x: number;
  y: number;
}

export interface RibbonChart {
  set(data: RibbonInput): void;
  /** Pointer over the whole window, -1…1 each (turns the plot a little). */
  tilt(x: number, y: number): void;
  dispose(): void;
}

const fillVert = `attribute float a; varying float vA;
void main(){ vA=a; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const fillFrag = `uniform vec3 col; uniform float op; varying float vA;
void main(){ gl_FragColor=vec4(col, vA*op); }`;

export function createRibbonChart(
  canvas: HTMLCanvasElement,
  colors: RibbonColors,
  onHover: (h: RibbonHover | null) => void,
): RibbonChart {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 2, 1, 8000);
  const plot = new THREE.Group();
  scene.add(plot);

  const additive = (color: THREE.ColorRepresentation, opacity: number) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  const fadeMat = (color: THREE.ColorRepresentation, op: number) =>
    new THREE.ShaderMaterial({
      vertexShader: fillVert,
      fragmentShader: fillFrag,
      uniforms: { col: { value: new THREE.Color(color) }, op: { value: op } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  const disposeTree = (o: THREE.Object3D) =>
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat) {
        (mat as THREE.SpriteMaterial).map?.dispose();
        mat.dispose();
      }
    });

  // floor grid in perspective
  {
    const p: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const x = -RIBBON_W / 2 + (i / 20) * RIBBON_W;
      p.push(new THREE.Vector3(x, 0, 40), new THREE.Vector3(x, 0, -RIBBON_DEPTH - 120));
    }
    for (let k = 0; k <= 6; k++) {
      const z = 40 - k * ((RIBBON_DEPTH + 160) / 6);
      p.push(new THREE.Vector3(-RIBBON_W / 2, 0, z), new THREE.Vector3(RIBBON_W / 2, 0, z));
    }
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(p),
      new THREE.LineBasicMaterial({
        color: colors.primary,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    plot.add(grid);
  }

  function label(text: string, color: string, size = 26) {
    const cv = document.createElement("canvas");
    const x = cv.getContext("2d")!;
    const font = `400 ${size}px "Share Tech Mono", "JetBrains Mono", monospace`;
    x.font = font;
    cv.width = Math.ceil(x.measureText(text).width) + 8;
    cv.height = size + 10;
    x.font = font;
    x.fillStyle = color;
    x.textBaseline = "middle";
    x.fillText(text, 4, cv.height / 2);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }),
    );
    sp.scale.set(cv.width * 0.62, cv.height * 0.62, 1);
    sp.userData.base = [sp.scale.x, sp.scale.y];
    return sp;
  }

  function ribbon(pts: THREE.Vector3[], color: string, strong: boolean) {
    const g = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    const segs = Math.min(600, pts.length * 4);
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, segs, strong ? 2.4 : 1.8, 8),
        additive(color, strong ? 1 : 0.85),
      ),
    );
    g.add(
      new THREE.Mesh(new THREE.TubeGeometry(curve, segs, strong ? 9 : 6, 8), additive(color, 0.1)),
    );
    const sp = curve.getPoints(segs);
    const strip = (
      top: (p: THREE.Vector3) => number[],
      bottom: (p: THREE.Vector3) => number[],
      a0: number,
      op: number,
    ) => {
      const pos: number[] = [];
      const a: number[] = [];
      const idx: number[] = [];
      sp.forEach((p) => {
        pos.push(...top(p), ...bottom(p));
        a.push(a0, 0);
      });
      for (let i = 0; i < sp.length - 1; i++) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("a", new THREE.Float32BufferAttribute(a, 1));
      geo.setIndex(idx);
      g.add(new THREE.Mesh(geo, fadeMat(color, op)));
    };
    // light curtain down to the floor, and the ribbon's top surface into depth
    strip(
      (p) => [p.x, p.y, 0],
      (p) => [p.x, 0, 0],
      1,
      strong ? 0.32 : 0.2,
    );
    strip(
      (p) => [p.x, p.y, 0],
      (p) => [p.x, p.y, -26],
      0.9,
      0.35,
    );
    return g;
  }

  // ---- state ----
  let data: RibbonInput | null = null;
  let content: THREE.Group | null = null;
  let old: { g: THREE.Group; t0: number } | null = null;
  let t0 = 0;
  let main: THREE.Vector3[] = [];
  const marker = new THREE.Group();
  const markerDot = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), additive(0xffffff, 0.95));
  const markerBeam = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), additive(colors.hot, 0.5));
  marker.add(markerDot, markerBeam);
  marker.visible = false;
  plot.add(marker);

  let tx = 0;
  let ty = 0;
  let stx = 0;
  let sty = 0;
  let raf = 0;
  let last = performance.now();
  let disposed = false;

  function build(d: RibbonInput) {
    if (content) {
      if (old) {
        disposeTree(old.g);
        plot.remove(old.g);
      }
      old = { g: content, t0: performance.now() };
    }
    const g = new THREE.Group();
    const all: number[] = [];
    d.series.forEach((s) => {
      s.points.forEach((p) => all.push(p.v));
      s.forecast?.forEach((f) => all.push(f.low, f.high, f.mid));
    });
    const { lo, hi } = ribbonDomain(all);
    const X = (i: number) => ribbonX(i, d.rows);
    const Y = (v: number) => ribbonY(v, lo, hi);

    main = [];
    d.series.forEach((s, si) => {
      if (s.points.length < 2) return;
      const pts = s.points.map((p) => new THREE.Vector3(X(p.i), Y(p.v), 0));
      const r = ribbon(pts, s.color, si === 0);
      r.position.z = d.stacked ? -si * RIBBON_ROW_GAP : 0;
      g.add(r);
      if (si === 0) main = pts;
      // forecast: beads along the path and a cone of uncertainty
      const fc = s.forecast;
      if (fc?.length) {
        const lastP = pts[pts.length - 1];
        const path = [lastP, ...fc.map((f) => new THREE.Vector3(X(f.i), Y(f.mid), 0))];
        const fg = new THREE.Group();
        fg.position.z = r.position.z;
        new THREE.CatmullRomCurve3(path).getPoints(path.length * 6).forEach((p, k) => {
          if (k % 2) return;
          const b = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), additive(s.color, 0.95));
          b.position.copy(p);
          fg.add(b);
        });
        const pos: number[] = [];
        const a: number[] = [];
        let prevTop = [lastP.x, lastP.y];
        let prevBot = [lastP.x, lastP.y];
        fc.forEach((f) => {
          const top = [X(f.i), Y(f.high)];
          const bot = [X(f.i), Y(f.low)];
          pos.push(prevTop[0], prevTop[1], 0, prevBot[0], prevBot[1], 0, top[0], top[1], 0);
          pos.push(prevBot[0], prevBot[1], 0, bot[0], bot[1], 0, top[0], top[1], 0);
          a.push(0.6, 0.6, 0.18, 0.6, 0.18, 0.18);
          prevTop = top;
          prevBot = bot;
        });
        const cone = new THREE.BufferGeometry();
        cone.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        cone.setAttribute("a", new THREE.Float32BufferAttribute(a, 1));
        fg.add(new THREE.Mesh(cone, fadeMat(s.color, 0.55)));
        g.add(fg);
      }
    });

    // value levels on the left, dates along the front edge
    niceTicks(lo, hi).forEach((v) => {
      const sp = label(d.formatY(v), colors.muted);
      sp.position.set(-RIBBON_W / 2 - 46, Y(v), 0);
      g.add(sp);
      g.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-RIBBON_W / 2, Y(v), 0),
            new THREE.Vector3(RIBBON_W / 2, Y(v), 0),
          ]),
          new THREE.LineBasicMaterial({
            color: colors.primary,
            transparent: true,
            opacity: 0.07,
            depthWrite: false,
          }),
        ),
      );
    });
    labelIndices(d.rows).forEach((i) => {
      const sp = label(d.dateLabel(i), colors.muted);
      sp.position.set(X(i), -24, 34);
      g.add(sp);
    });

    g.scale.y = 0.001;
    plot.add(g);
    content = g;
    t0 = performance.now();
    marker.visible = false;
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  function frame(now: number) {
    raf = 0;
    if (disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    stx += (tx - stx) * Math.min(1, dt * 3);
    sty += (ty - sty) * Math.min(1, dt * 3);
    let busy = Math.abs(tx - stx) > 0.002 || Math.abs(ty - sty) > 0.002;
    if (content) {
      const k = Math.min(1, (now - t0) / RIBBON_GROW_MS);
      const e = k * k * (3 - 2 * k);
      content.scale.y = Math.max(0.001, e);
      if (k < 1) busy = true;
    }
    if (old) {
      const k = Math.min(1, (now - old.t0) / 350);
      old.g.scale.y = Math.max(0.001, 1 - k);
      old.g.position.y = -k * 30;
      if (k >= 1) {
        disposeTree(old.g);
        plot.remove(old.g);
        old = null;
      } else busy = true;
    }
    const ws = ribbonWidthScale(camera.aspect);
    plot.scale.x = ws;
    const dist = ribbonCameraDistance(camera.fov, camera.aspect, ws);
    // labels keep their size on screen when the camera backs off (phones)
    const ls = Math.min(2.4, Math.max(1, dist / 1500));
    plot.traverse((o) => {
      const b = o.userData.base as [number, number] | undefined;
      if (b) o.scale.set((b[0] * ls) / ws, b[1] * ls, 1);
    });
    plot.rotation.y = stx * 0.14 - 0.1;
    plot.rotation.x = 0.02 + sty * 0.04;
    camera.position.set(0, RIBBON_H * 0.45 + dist * 0.17, dist);
    camera.lookAt(0, RIBBON_H * 0.45, -40);
    renderer.render(scene, camera);
    if (busy) raf = requestAnimationFrame(frame);
  }
  function invalidate() {
    if (!raf && !disposed) raf = requestAnimationFrame(frame);
  }

  // hover: the nearest session lights up
  const proj = new THREE.Vector3();
  function onMove(e: PointerEvent) {
    if (!data || !main.length || !content) return;
    const r = canvas.getBoundingClientRect();
    plot.updateMatrixWorld();
    const xs = main.map((p) => {
      proj.copy(p).applyMatrix4(content!.matrixWorld).project(camera);
      return ((proj.x + 1) / 2) * r.width;
    });
    const k = nearestIndex(xs, e.clientX - r.left);
    if (k < 0) return;
    const p = main[k];
    marker.visible = true;
    marker.position.set(p.x, p.y, 0);
    markerBeam.scale.set(1, Math.max(1, p.y), 1);
    markerBeam.position.y = -p.y / 2;
    proj.copy(p).applyMatrix4(plot.matrixWorld).project(camera);
    const series0 = data.series.find((s) => s.points.length >= 2);
    onHover({
      i: series0 ? series0.points[k].i : k,
      x: ((proj.x + 1) / 2) * r.width,
      y: ((1 - proj.y) / 2) * r.height,
    });
    invalidate();
  }
  function onLeave() {
    marker.visible = false;
    onHover(null);
    invalidate();
  }
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  return {
    set(d) {
      data = d;
      build(d);
      invalidate();
    },
    tilt(x, y) {
      tx = x;
      ty = y;
      invalidate();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      disposeTree(scene);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
