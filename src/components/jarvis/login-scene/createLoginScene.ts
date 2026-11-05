// Imperative three.js intro scene: ONE scene for the whole path
//   landing (scroll) → 3D login → ignition → Arc Core.
// Port of docs/jarvis-3d-v2/src/main.js without its DOM (landing copy, form,
// HUD, DEMO controls): those belong to LandingPage / StarkLogin / the /jarvis
// route. All visuals are pure functions of the mode and one state variable
// (scroll position, login progress, ignition phase p) — see loginSceneMath.ts.
//
// Render setup is identical to the prototype: NoToneMapping, antialias off +
// EffectComposer (RenderPass → UnrealBloomPass → OutputPass), fog, fov 32 → 45,
// 800 dust points of size 2.4, DPR min(devicePixelRatio, 1.75 | 1.5 narrow).
// The ONLY quality knob is DPR (qualityVerdict in loginSceneMath.ts).
//
// Imports three: load ONLY through the dynamic import in LoginScene.tsx.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {
  LOGIN_SPAN,
  QUALITY_WINDOW,
  SHAKE_SECONDS,
  SLOW_FRAME_S,
  arkFlash,
  boardOpacity,
  buildStops,
  clamp,
  coreCameraPosition,
  energyDecay,
  energyKick,
  fitCamera,
  igniteLook,
  initialDpr,
  lerp,
  loginCamera,
  loginLook,
  loginProgress,
  moduleIndexAt,
  nodeProgress,
  overlayInteractive,
  overlayOpacity,
  pickMotionVariant,
  portalScale,
  qualityVerdict,
  reactorOpacities,
  reactorPartPose,
  scanPercent,
  scrollState,
  seg,
  shakeAt,
  spinBoost,
  startTransition,
  stepTransition,
  viewBlend,
  viewOffsetFor,
  type MotionVariant,
  type Stop,
  type Transition,
  type Vec3,
} from "./loginSceneMath";
import {
  SCALE,
  buildCore,
  buildNode,
  buildReactor,
  orbitPosition,
  type AgentNode,
} from "./reactor";
import { buildCoreExtras, decorateRing, makePackets, type RingKind } from "./core2";
import { orbitAngle, orbitAt, orbitSpec, type OrbitSpec } from "./orbits";
import { buildTunnel, type TunnelModule } from "./tunnel";
import type { SceneColors } from "./sceneColors";

export interface SlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One agent as the scene needs it (name/role from the registry, status live). */
export interface IntroAgent {
  slug: string;
  name: string;
  role: string | null;
  busy: boolean;
  error?: boolean;
  /** ISO start of the current run — the label shows a live m:ss counter. */
  busySince?: string | null;
}

export interface SceneOverlays {
  /** Wrapper whose opacity / pointer-events follow overlayOpacity / overlayInteractive. */
  root: HTMLElement;
  grid: HTMLElement;
  vignette: HTMLElement;
  /** White flash of the tunnel → engage match cut. */
  flash: HTMLElement;
  /** Ignition flash (reactor colour), or a black fade when motion is reduced. */
  ark: HTMLElement;
  /** Host for the agent name labels shown at the end of the ignition. */
  labels: HTMLElement;
}

/** The landing page the scroll mode reads its camera stops from. */
export interface LandingHost {
  /** The scroll container (null once the landing page has unmounted). */
  scrollEl: () => HTMLElement | null;
  /** Stop sections in document order (data-stop ids: hero, jarvis, a0…, modules, engage). */
  sections: () => { id: string; el: HTMLElement }[];
  /** Rect of the engage reactor placeholder (fixed layer, viewport coordinates). */
  engageHome: () => SlotRect | null;
  /** True while a button jump runs (it is already eased: no extra smoothing). */
  isJumping: () => boolean;
}

/** Per-frame readout for the landing DOM (updated imperatively, no React renders). */
export interface LandingHud {
  scan: number;
  /** 0 | 1: module readout under the tunnel. */
  hudMod: number;
  moduleIndex: number;
  moduleCount: number;
  /** 0..1: how far the engage UI is faded in. */
  engaged: number;
}

export interface IntroSceneOptions {
  canvas: HTMLCanvasElement;
  overlays: SceneOverlays;
  colors: SceneColors;
  reducedMotion: boolean;
  /** Start in scroll mode (landing) or directly in login mode. */
  initialMode: "scroll" | "login";
  /** Agents drawn from the start (static registry on the landing page). */
  agents: IntroAgent[];
  /** Tunnel board contents. */
  modules: TunnelModule[];
  landing?: LandingHost;
  /** Where the 3D reactor sits on the login screen (StarkLogin slot). */
  getSlotRect: () => SlotRect | null;
  /** Rect of the /jarvis canvas, once the dashboard is mounted (null before). */
  getTargetRect?: () => SlotRect | null;
  /** Live agents (react-query cache) — polled while ignition has not placed the nodes yet. */
  getAgents?: () => IntroAgent[] | null;
  onHud?: (h: LandingHud) => void;
  /** p reached P_LIVE: the dashboard may mount. */
  onLive?: () => void;
  /** p reached 1: the overlay is fully gone, the scene has stopped rendering. */
  onDone?: () => void;
  /** Keep the drawing buffer (DEV screenshots only). */
  preserveDrawingBuffer?: boolean;
}

export type SceneMode = "scroll" | "login" | "ignite" | "done";

export interface IntroScene {
  /** Re-measure viewport, landing sections and the slots. */
  layout(): void;
  /** Camera flight Engage → login pose (LOGIN_ENTER_MS); the 3D reactor takes over the frame. */
  enterLogin(): void;
  /** Play the ignition (p 0 → 1). */
  ignite(variant?: MotionVariant): void;
  /** Fast-forward a running ignition (×6). */
  skip(): void;
  /** Wrong-key shake of the reactor. */
  shake(): void;
  setReducedMotion(reduced: boolean): void;
  /** Replace the agents (rebuilds nodes, orbits, packets, labels). `real` enables name labels. */
  setAgents(list: IntroAgent[], real: boolean): void;
  setManual(manual: boolean): void;
  frame(dt?: number): void;
  readonly mode: SceneMode;
  /** DEV proof harness (the wrapper exposes it on window only in DEV). */
  debug: {
    stops(): Stop[];
    setScroll(y: number): void;
    setIgnite(p: number): void;
    setEnergy(e: number): void;
  };
  dispose(): void;
}

const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const RING_KINDS: RingKind[] = ["fine", "bold", "claw"];

export function createLoginScene(opts: IntroSceneOptions): IntroScene {
  const { canvas, overlays, colors: C } = opts;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
  });
  let dpr = initialDpr(window.devicePixelRatio, window.innerWidth);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000); // neutral black void
  scene.fog = new THREE.Fog(0x000000, 900, 2600);
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 7000);
  scene.add(new THREE.AmbientLight(C.ambient, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(300, 500, 500);
  scene.add(key);

  const R = buildReactor(C);
  scene.add(R.root);

  // ---- agents: nodes, spokes, orbits, packets (rebuilt by setAgents) ----------
  let agents = opts.agents.slice();
  let nodes: AgentNode[] = [];
  let spokes: THREE.Line[] = [];
  let specs: OrbitSpec[] = [];
  let X!: ReturnType<typeof buildCoreExtras>;
  let pk!: ReturnType<typeof makePackets>;
  let nodePos: Vec3[] = [];
  let nodeViews: Vec3[] = [];
  let busyFlags: boolean[] = [];
  let labelEls: {
    root: HTMLElement;
    status: HTMLElement;
    node: AgentNode | null;
    agent?: IntroAgent;
  }[] = [];
  let labelsReal = false;
  const cCyan = new THREE.Color(C.primary);
  const cAmber = new THREE.Color(C.reactor);
  const wCyan = new THREE.Color(C.nodeWire);
  const wAmber = new THREE.Color(C.nodeWireAmber);
  const cSpoke = new THREE.Color(C.spoke);

  function disposeObject(o: THREE.Object3D) {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const kill = (x: THREE.Material) => {
        const mm = x as THREE.MeshBasicMaterial;
        mm.map?.dispose();
        x.dispose();
      };
      if (Array.isArray(mat)) mat.forEach(kill);
      else if (mat) kill(mat);
    });
  }

  function buildLabels() {
    labelEls.forEach((l) => l.root.remove());
    labelEls = [];
    if (!labelsReal) return;
    const mk = (name: string, role: string, isCore: boolean) => {
      const root = document.createElement("div");
      root.className = `intro-nl${isCore ? " core" : ""}`;
      const b = document.createElement("b");
      b.textContent = name;
      const s = document.createElement("span");
      s.textContent = role;
      const st = document.createElement("small");
      root.append(b, s, st);
      overlays.labels.append(root);
      return { root, status: st };
    };
    const core = mk("J.A.R.V.I.S.", "Primary Brain / Core", true);
    core.status.remove();
    labelEls.push({ root: core.root, status: core.status, node: null });
    agents.forEach((a, i) => {
      const l = mk(a.name, a.role ?? a.slug, false);
      labelEls.push({ root: l.root, status: l.status, node: nodes[i], agent: a });
    });
  }

  function buildAgents() {
    nodes.forEach((n) => {
      scene.remove(n);
      disposeObject(n);
    });
    spokes.forEach((l) => {
      scene.remove(l);
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    });
    if (X) {
      scene.remove(X.group);
      disposeObject(X.group);
    }
    if (pk) {
      scene.remove(pk.points);
      pk.points.geometry.dispose();
      (pk.points.material as THREE.Material).dispose();
    }
    const n = Math.max(1, agents.length);
    nodes = Array.from({ length: n }, (_, i) => {
      const node = buildNode(C);
      node.userData.home = orbitPosition(i, n);
      node.position.copy(node.userData.home);
      scene.add(node);
      return node;
    });
    spokes = nodes.map((node) => {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        node.position.clone(),
      ]);
      const l = new THREE.Line(
        g,
        new THREE.LineBasicMaterial({
          color: C.spoke,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      scene.add(l);
      return l;
    });
    specs = nodes.map((_, i) => orbitSpec(i, n, SCALE));
    X = buildCoreExtras(specs, C);
    X.group.visible = false;
    scene.add(X.group);
    pk = makePackets(n, C);
    scene.add(pk.points);
    nodePos = specs.map(() => v3());
    nodeViews = nodes.map((node) => node.position);
    busyFlags = nodes.map((_, i) => !!agents[i]?.busy);
    buildLabels();
  }
  buildAgents();

  // dust around the core (ParticleField in JarvisCanvas)
  const dustN = 800;
  const dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    const r = (3 + Math.random() * 5.5) * SCALE;
    const th = Math.random() * 6.283;
    const ph = Math.acos(2 * Math.random() - 1);
    dp.set(
      [r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.4, r * Math.cos(ph)],
      i * 3,
    );
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  const dustMat = new THREE.PointsMaterial({
    color: C.primary,
    size: 2.4,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // Arc Core: molten sphere + three rings that start as the reactor's outer ring
  const core = buildCore(C);
  core.visible = false;
  scene.add(core);
  const coreLight = new THREE.PointLight(C.reactor, 0, 1400, 1.7);
  scene.add(coreLight);
  const torus = (r: number, tube: number, color: string, opacity: number) =>
    new THREE.Mesh(
      new THREE.TorusGeometry(r, tube, 10, 180),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
  const rings = [
    {
      m: torus(1.55 * SCALE, 1.1, C.reactor, 0.75),
      rot: [Math.PI / 2.3, 0, 0],
      v: [0.25, 0, 0],
      spin: [0, 0, 0],
    },
    {
      m: torus(1.85 * SCALE, 0.8, C.primary, 0.55),
      rot: [Math.PI / 3.1, Math.PI / 5, 0],
      v: [0, 0.18, 0],
      spin: [0, 0, 0],
    },
    {
      m: torus(2.1 * SCALE, 0.7, C.reactor, 0.45),
      rot: [0, Math.PI / 2.4, Math.PI / 6],
      v: [0, 0, 0.32],
      spin: [0, 0, 0],
    },
  ];
  rings.forEach((r) => {
    r.m.visible = false;
    scene.add(r.m);
  });
  const ringDeco = rings.map((r, i) =>
    decorateRing(r.m, RING_KINDS[i], [C.hot, C.primary, C.reactor][i]),
  );

  // module tunnel (landing)
  const T = buildTunnel(C, opts.modules);
  scene.add(T.group);

  // post
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.45, 0.5);
  composer.addPass(bloom);
  const output = new OutputPass();
  composer.addPass(output);

  // ---- state ----
  const st = {
    mode: opts.initialMode as SceneMode,
    reduced: opts.reducedMotion,
    lg: 0,
    lgStart: 0,
    p: 0,
    hold: false,
    transition: null as Transition | null,
    liveFired: false,
  };
  const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  const colA = new THREE.Color(C.primary);
  const colB = new THREE.Color(C.reactor);
  const colR = new THREE.Color(C.destructive);
  const colT = new THREE.Color();
  const cam = new THREE.Vector3();
  const look = new THREE.Vector3();
  const igFrom = { cam: v3(), look: v3() };
  const lgFrom = { cam: v3(), look: v3() };
  let lgPose = v3(0, 0, 900);
  let stops: Stop[] = [];
  let portrait = false;
  let time = 0;
  let spinT = 0;
  let energy = 0;
  let energyBase = 0;
  let shake = 0;
  let sy = -1; // first scroll frame jumps straight to the container's position
  let lastHud = "";
  let frames = 0;
  let slow = 0;
  let qualityDone = false;
  let last = performance.now();
  let raf = 0;
  let manual = false;
  let disposed = false;
  let agentPoll = 0;
  let lastAgentKey = "";

  function sceneCoreCam(aspect: number) {
    return coreCameraPosition(SCALE, aspect);
  }

  // ---- layout ----
  function calcLoginPose() {
    const r = opts.getSlotRect();
    if (r && r.width > 0) {
      lgPose = fitCamera(
        r,
        { width: window.innerWidth, height: window.innerHeight },
        32,
        LOGIN_SPAN,
      );
    }
  }

  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    portrait = w / h < 1;
    T.place(portrait);
    const host = opts.landing;
    const hostEl = host?.scrollEl() ?? null;
    if (host && hostEl) {
      const hostRect = hostEl.getBoundingClientRect();
      const sections = host.sections().map(({ id, el }) => {
        const r = el.getBoundingClientRect();
        return { id, top: r.top - hostRect.top + hostEl.scrollTop, height: r.height };
      });
      const home = host.engageHome();
      stops = buildStops({
        sections,
        viewport: { width: w, height: h },
        engageFit: home ? fitCamera(home, { width: w, height: h }) : v3(0, 0, 900),
        homes: nodes.map((n) => ({
          x: n.userData.home.x,
          y: n.userData.home.y,
          z: n.userData.home.z,
        })),
      });
    }
    if (st.mode === "login") calcLoginPose();
  }

  // ---- reactor ----
  function applyReactor(a: number, hullVis: number, fade = 1) {
    R.parts.forEach((q) => {
      const o = q.obj;
      const pose = reactorPartPose(q, a, spinT, st.reduced);
      o.position.z = pose.z;
      o.scale.z = pose.scaleZ;
      o.rotation.x = pose.rotX;
      o.rotation.z = pose.rotZ;
    });
    const op = reactorOpacities(a, fade);
    R.mats.line.opacity = op.line;
    R.mats.lineSoft.opacity = op.lineSoft;
    R.mats.lineFaint.opacity = op.lineFaint;
    R.disc.material.opacity = op.disc;
    R.d14.material.opacity = op.d14;
    R.d6.material.opacity = op.d6;
    R.hull.visible = hullVis > 0.005;
    R.steel.opacity = hullVis;
    R.edgeMat.opacity = 0.75 * hullVis;
    R.fill.intensity = 90000 * hullVis;
    R.gyro.forEach((g) => {
      g.rotation.set(
        g.userData.rx + spinT * g.userData.s * 0.6,
        g.userData.ry,
        spinT * g.userData.s,
      );
      g.children.forEach((c) => (c.visible = hullVis > 0.05));
    });
  }

  function setLineColor(c: THREE.Color) {
    R.mats.line.color.copy(c);
    R.mats.lineSoft.color.copy(c);
    R.mats.lineFaint.color.copy(c);
  }

  function setFog(near: number, far: number) {
    const f = scene.fog as THREE.Fog;
    f.near = near;
    f.far = far;
  }

  function setBloom(strength: number, threshold: number, radius: number) {
    bloom.strength = strength;
    bloom.threshold = threshold;
    bloom.radius = radius;
  }

  function hideCore() {
    core.visible = false;
    coreLight.intensity = 0;
    rings.forEach((r) => (r.m.visible = false));
    X.group.visible = false;
    pk.points.visible = false;
  }

  // ---- scroll mode ----
  function scrollFrame(dt: number) {
    const host = opts.landing;
    const hostEl = host?.scrollEl() ?? null;
    if (!host || !hostEl || !stops.length) return;
    const target = hostEl.scrollTop;
    if (sy < 0) sy = target;
    sy = st.reduced || host.isJumping() ? target : lerp(sy, target, 1 - Math.exp(-dt * 6));
    if (Math.abs(sy - target) < 0.3) sy = target;
    const S = scrollState(sy, stops);

    cam.set(S.cam.x, S.cam.y, S.cam.z);
    look.set(S.look.x, S.look.y, S.look.z);
    camera.position.copy(cam);
    camera.fov = 32;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.lookAt(look);

    applyReactor(S.align, S.hull);
    R.root.visible = S.reactorVisible;
    R.root.position.x = 0;
    R.root.rotation.z = 0;
    R.d14.scale.setScalar(1);
    setLineColor(colA);

    T.group.visible = S.tunVis > 0;
    T.gateMat.opacity = 0.9;
    setFog(S.fogNear, S.fogFar);
    const count = opts.modules.length;
    let moduleIndex = -1;
    if (S.tunVis) {
      moduleIndex = moduleIndexAt(cam.z, count);
      if (!st.reduced) {
        T.gates.forEach((g, i) => (g.rotation.z += dt * (i % 2 ? 0.12 : -0.12)));
      }
      T.boards.forEach((m) => {
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = boardOpacity(cam.z, m.position.z);
        m.visible = mat.opacity > 0.01;
      });
      T.portal.scale.setScalar(portalScale(cam.z));
    }
    setBloom(S.bloom, 0.5, 0.45);

    nodes.forEach((n, i) => {
      n.visible = S.nodesVisible;
      spokes[i].visible = S.nodesVisible;
      n.position.copy(n.userData.home);
      n.scale.setScalar(1);
      n.userData.body.rotation.x += dt * 0.15;
      n.userData.body.rotation.y += dt * 0.1;
      const pos = spokes[i].geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(1, n.position.x, n.position.y, n.position.z);
      pos.needsUpdate = true;
    });
    hideCore();
    dust.visible = S.dustVisible;
    dustMat.opacity = 0.55;
    if (!st.reduced) dust.rotation.y += dt * 0.01;

    overlays.flash.style.opacity = S.flash.toFixed(3);
    overlays.grid.style.opacity = S.grid.toFixed(3);
    overlays.vignette.style.opacity = "1";
    overlays.ark.style.opacity = "0";
    if (opts.onHud) {
      const scan = scanPercent(sy, hostEl.scrollHeight, hostEl.clientHeight);
      const key = `${scan}|${S.hudMod}|${moduleIndex}|${S.engaged.toFixed(2)}`;
      if (key !== lastHud) {
        lastHud = key;
        opts.onHud({ scan, hudMod: S.hudMod, moduleIndex, moduleCount: count, engaged: S.engaged });
      }
    }
  }

  // ---- login mode ----
  function loginFrame(dt: number) {
    st.lg = loginProgress(performance.now() - st.lgStart, st.reduced);
    const E = clamp(energy + energyBase);
    const c = loginCamera({
      lg: st.lg,
      from: lgFrom,
      pose: lgPose,
      pointer: { x: ptr.sx, y: ptr.sy },
      reduced: st.reduced,
    });
    cam.set(c.cam.x, c.cam.y, c.cam.z);
    look.set(c.look.x, c.look.y, c.look.z);
    camera.position.copy(cam);
    camera.fov = 32;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.lookAt(look);

    const L = loginLook(st.lg, E, shake);
    applyReactor(L.a, L.hull, 1);
    colT.copy(colA);
    if (shake > 0) {
      const s = shakeAt(shake, time);
      colT.lerp(colR, s.tint);
      R.root.position.x = s.x;
      R.root.rotation.z = s.rotZ;
    } else {
      R.root.position.x = 0;
      R.root.rotation.z = 0;
    }
    setLineColor(colT);
    R.root.visible = true;
    R.d14.scale.setScalar(L.discScale);
    nodes.forEach((n, i) => {
      n.visible = false;
      spokes[i].visible = false;
    });
    hideCore();
    T.group.visible = false;
    setFog(L.fogNear, L.fogFar);
    dust.visible = true;
    dustMat.opacity = L.dust;
    if (!st.reduced) dust.rotation.y += dt * 0.01;
    setBloom(L.bloom.strength, L.bloom.threshold, L.bloom.radius);
    overlays.grid.style.opacity = L.grid.toFixed(3);
    overlays.vignette.style.opacity = "1";
    overlays.flash.style.opacity = "0";
    overlays.ark.style.opacity = "0";
  }

  // ---- ignition ----
  const isBusy = (i: number) => !!agents[i]?.busy;

  function pollAgents() {
    if (!opts.getAgents) return;
    const list = opts.getAgents();
    if (!list || !list.length) return;
    const key = list.map((a) => `${a.slug}:${a.busy ? 1 : 0}${a.error ? "e" : ""}`).join("|");
    if (key === lastAgentKey) return;
    lastAgentKey = key;
    const sameCount = list.length === agents.length;
    agents = list.slice();
    busyFlags = nodes.map((_, i) => !!agents[i]?.busy);
    if (!sameCount || !labelsReal) {
      labelsReal = true;
      buildAgents();
    } else {
      buildLabels();
    }
  }

  function elapsedLabel(a: IntroAgent) {
    if (!a.busySince) return "00:00";
    const s = Math.max(0, Math.round((Date.now() - new Date(a.busySince).getTime()) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  const lv = new THREE.Vector3();
  const lcenter = new THREE.Vector3();
  function placeLabels(show: number) {
    if (!labelEls.length) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const narrow = W < 760;
    lcenter.set(0, 0, 0).project(camera);
    const cx = (lcenter.x * 0.5 + 0.5) * W;
    const cy = (-lcenter.y * 0.5 + 0.5) * H;
    labelEls.forEach((l) => {
      if (l.node) lv.copy(l.node.position);
      else lv.set(0, -1.32 * SCALE, 0);
      lv.project(camera);
      const vis = show > 0.01 && lv.z < 1;
      l.root.style.opacity = vis ? String(show) : "0";
      if (!vis) return;
      let sx = (lv.x * 0.5 + 0.5) * W;
      let sy2 = (-lv.y * 0.5 + 0.5) * H;
      let ax = "-50%";
      if (!narrow && l.node) {
        // labels sit beside their node, on the side facing away from the core,
        // so they never cover the node or the core
        const dx = sx - cx;
        const dy = sy2 - cy;
        const d = Math.hypot(dx, dy) || 1;
        const side = Math.abs(dx) > 40 ? Math.sign(dx) : 0;
        sx += side * 46 + (dx / d) * 10;
        sy2 += side ? (dy / d) * 8 : dy > 0 ? 40 : -40;
        ax = side > 0 ? "0%" : side < 0 ? "-100%" : "-50%";
        l.root.style.textAlign = side > 0 ? "left" : side < 0 ? "right" : "center";
      }
      l.root.style.transform = `translate(${ax},-50%) translate(${sx}px,${sy2}px)`;
    });
  }

  function igniteFrame(dt: number) {
    if (st.mode === "ignite" && st.transition && !st.hold) {
      const r = stepTransition(st.transition, dt);
      st.p = r.p;
      if (r.justLive) {
        st.liveFired = true;
        opts.onLive?.();
      }
      if (r.done) pendingDone = true;
    }
    const p = st.p;
    const L = igniteLook(p, st.reduced);
    if (p < 0.3 && ++agentPoll % 8 === 0) pollAgents();

    applyReactor(L.a, L.hull, L.fade);
    colT.copy(colA).lerp(colB, L.heatMix);
    setLineColor(colT);
    R.root.visible = L.reactorVisible;
    R.root.rotation.y = 0;
    R.root.position.x = 0;
    R.root.rotation.z = 0;

    // camera: login pose → Arc Core frame (aligned onto the /jarvis canvas once it exists)
    const w = window.innerWidth;
    const h = window.innerHeight;
    const target = opts.getTargetRect?.() ?? null;
    const blend = viewBlend(p);
    const cw = sceneCoreCam(w / h);
    const ct = target && target.width > 0 ? sceneCoreCam(target.width / target.height) : cw;
    const coreCam = {
      x: lerp(cw.x, ct.x, blend),
      y: lerp(cw.y, ct.y, blend),
      z: lerp(cw.z, ct.z, blend),
    };
    cam.set(
      lerp(igFrom.cam.x, coreCam.x, L.k),
      lerp(igFrom.cam.y, coreCam.y, L.k),
      lerp(igFrom.cam.z, coreCam.z, L.k),
    );
    look.set(lerp(igFrom.look.x, 0, L.k), lerp(igFrom.look.y, 0, L.k), lerp(igFrom.look.z, 0, L.k));
    camera.position.copy(cam);
    camera.fov = L.fov;
    const vo = p > 0.5 ? viewOffsetFor(blend, { width: w, height: h }, target) : null;
    if (vo) {
      camera.aspect = vo.aspect;
      camera.setViewOffset(vo.fullWidth, vo.fullHeight, vo.x, vo.y, vo.width, vo.height);
    } else {
      camera.aspect = w / h;
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
    camera.lookAt(look);

    // Arc Core
    core.visible = L.g > 0;
    core.scale.setScalar(L.coreBase * (1 + Math.sin(time * 1.4) * 0.03));
    core.rotation.y += dt * 0.15;
    core.material.uniforms.t.value = time;
    core.material.uniforms.heat.value = L.heat;
    core.material.uniforms.op.value = L.g;
    coreLight.intensity = L.coreLight;

    rings.forEach((r) => {
      r.m.visible = L.ringU > 0;
      const s = lerp(96 / (r.m.geometry as THREE.TorusGeometry).parameters.radius, 1, L.ringU);
      r.m.scale.set(s, s, s);
      if (!st.reduced) r.v.forEach((wv, i) => (r.spin[i] += wv * dt));
      r.m.rotation.set(
        lerp(0, r.rot[0], L.ringU) + r.spin[0],
        lerp(0, r.rot[1], L.ringU) + r.spin[1],
        lerp(0, r.rot[2], L.ringU) + r.spin[2],
      );
    });

    nodes.forEach((n, i) => {
      const q = nodeProgress(p, i);
      const busy = isBusy(i);
      n.visible = spokes[i].visible = q > 0;
      orbitAt(specs[i], orbitAngle(specs[i], time, st.reduced), nodePos[i]);
      n.position.set(nodePos[i].x * q, nodePos[i].y * q, nodePos[i].z * q);
      n.scale.setScalar(
        (0.2 + q * 0.8) * 0.8 * (busy && L.statusK > 0.5 ? 1 + Math.sin(time * 5 + i) * 0.07 : 1),
      );
      n.userData.body.rotation.x += dt * (busy ? 0.5 : 0.15);
      n.userData.body.rotation.y += dt * (busy ? 0.35 : 0.1);
      const mt = n.userData.body.material;
      const wm = (n.userData.body.children[0] as THREE.LineSegments)
        .material as THREE.LineBasicMaterial;
      const sm = spokes[i].material as THREE.LineBasicMaterial;
      mt.color.copy(cCyan);
      mt.emissive.copy(cCyan);
      wm.color.copy(wCyan);
      sm.color.copy(cSpoke);
      sm.opacity = 0.4;
      mt.emissiveIntensity = 0.3;
      if (busy) {
        mt.color.lerp(cAmber, L.statusK);
        mt.emissive.lerp(cAmber, L.statusK);
        wm.color.lerp(wAmber, L.statusK);
        sm.color.lerp(cAmber, L.statusK);
        sm.opacity = 0.4 + 0.35 * L.statusK;
        mt.emissiveIntensity = 0.3 + 0.5 * L.statusK;
      }
      const pos = spokes[i].geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(1, n.position.x, n.position.y, n.position.z);
      pos.needsUpdate = true;
    });

    const pulse = 1 + Math.sin(time * 1.4) * 0.03;
    X.group.visible = L.extrasVisible;
    X.corona.material.opacity = L.coronaOpacity * (1 + Math.sin(time * 1.4) * 0.08);
    X.corona.scale.setScalar(5.6 * SCALE * pulse);
    X.shell.material.opacity = L.shellOpacity;
    if (!st.reduced) {
      X.shell.rotation.y -= dt * 0.09;
      X.shell.rotation.x += dt * 0.05;
    }
    X.floor.material.opacity = L.floorOpacity;
    X.orbits.forEach((o) => (o.material.opacity = L.orbitOpacity));
    ringDeco.forEach((d, i) => {
      d.inst.material.opacity = L.ringDecoOpacity;
      d.bead.visible = L.beadsVisible;
      const ang = time * (i % 2 ? -0.9 : 0.7) + i * 2;
      d.bead.position.set(Math.cos(ang) * d.r, Math.sin(ang) * d.r, 0);
    });
    pk.update(nodeViews, busyFlags, st.reduced ? 0 : time, L.packets);
    dust.visible = true;
    dustMat.opacity = L.dustOpacity;
    if (!st.reduced) dust.rotation.y += dt * 0.01;
    T.group.visible = false;
    setFog(L.fogNear, L.fogFar);
    setBloom(L.bloom.strength, L.bloom.threshold, L.bloom.radius);

    overlays.grid.style.opacity = L.grid.toFixed(3);
    overlays.vignette.style.opacity = lerp(1, 0.35, seg(p, 0.3, 0.9)).toFixed(3);
    overlays.flash.style.opacity = "0";
    const f = arkFlash(p, st.reduced);
    overlays.ark.style.background = f.black
      ? "black"
      : f.hotMix === 0
        ? "white"
        : `color-mix(in oklab, var(--reactor-hot) ${Math.round(f.hotMix * 100)}%, white)`;
    overlays.ark.style.opacity = f.alpha.toFixed(3);
    overlays.root.style.opacity = st.hold ? "1" : overlayOpacity(p).toFixed(3);
    overlays.root.style.pointerEvents = st.hold || overlayInteractive(p) ? "auto" : "none";
    if (labelEls.length) {
      labelEls.forEach((l) => {
        if (!l.agent) return;
        const a = l.agent;
        l.status.textContent = a.error
          ? "● ERROR"
          : a.busy
            ? `● BUSY ${elapsedLabel(a)}`
            : "● IDLE";
        l.status.className = a.busy ? "st busy" : "st";
      });
      placeLabels(L.labels);
    }
  }

  let pendingDone = false;
  function finish() {
    st.mode = "done";
    st.p = 1;
    stopLoop();
    labelEls.forEach((l) => (l.root.style.opacity = "0"));
    opts.onDone?.();
  }

  // ---- loop ----
  function frameStep(dt: number) {
    time += st.reduced ? 0 : dt;
    ptr.sx = lerp(ptr.sx, ptr.x, 1 - Math.exp(-dt * 4));
    ptr.sy = lerp(ptr.sy, ptr.y, 1 - Math.exp(-dt * 4));
    energy = energyDecay(energy, dt);
    if (shake > 0) shake = Math.max(0, shake - dt / SHAKE_SECONDS);
    const boost = spinBoost(st.mode === "ignite" ? "ignite" : "other", st.p, energy + energyBase);
    spinT += st.reduced ? 0 : dt * (1 + boost);

    if (st.mode === "scroll") scrollFrame(dt);
    else if (st.mode === "login") loginFrame(dt);
    else igniteFrame(dt);
    composer.render(dt);
    if (pendingDone) {
      pendingDone = false;
      finish();
    }
  }

  // adaptive quality: after 120 frames, if more than half are slower than 34 ms,
  // lower ONLY the DPR (never below min(devicePixelRatio, 1.25)).
  function quality(dt: number) {
    if (qualityDone || st.reduced) return;
    frames++;
    if (dt > SLOW_FRAME_S) slow++;
    if (frames === QUALITY_WINDOW) {
      qualityDone = true;
      const next = qualityVerdict(frames, slow, dpr, window.devicePixelRatio);
      if (next !== null) {
        dpr = next;
        renderer.setPixelRatio(dpr);
        composer.setPixelRatio(dpr);
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        composer.setSize(window.innerWidth, window.innerHeight);
      }
    }
  }

  function loop(now: number) {
    if (disposed || manual) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    quality(dt);
    frameStep(dt);
  }
  function startLoop() {
    if (raf || disposed || manual || st.mode === "done") return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // ---- input: parallax, skip, typing energy (listeners on window/document) ----
  const onSkip = () => {
    if (st.mode === "ignite" && st.transition) st.transition.skip = true;
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      ptr.x = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.y = (e.clientY / window.innerHeight) * 2 - 1;
    }
  };
  const inForm = (e: Event) => (e.target as Element | null)?.closest?.("[data-login-form]");
  const onInput = (e: Event) => {
    if (inForm(e)) energy = energyKick(energy, 0.3);
  };
  const onKey = (e: KeyboardEvent) => {
    onSkip();
    if (inForm(e)) energy = energyKick(energy, 0.22);
  };
  const onFocusIn = (e: Event) => {
    if (inForm(e)) energyBase = 0.3;
  };
  const onFocusOut = (e: Event) => {
    if (inForm(e)) energyBase = 0;
  };
  const onResize = () => layout();
  window.addEventListener("pointerdown", onSkip, { passive: true });
  window.addEventListener("keydown", onKey);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("resize", onResize);
  document.addEventListener("input", onInput);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  const onContextLost = (e: Event) => e.preventDefault();
  canvas.addEventListener("webglcontextlost", onContextLost);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => layout()) : null;
  const landingEl = opts.landing?.scrollEl() ?? null;
  if (landingEl) ro?.observe(landingEl);
  void document.fonts?.ready.then(() => {
    if (disposed) return;
    T.retexture();
    layout();
  });

  // initial pose
  layout();
  if (st.mode === "login") {
    calcLoginPose();
    lgFrom.cam = { x: lgPose.x, y: lgPose.y, z: lgPose.z };
    lgFrom.look = { x: lgPose.x, y: lgPose.y, z: 0 };
    st.lgStart = performance.now();
  }
  frameStep(0.016); // first frame at once, so the canvas is never blank
  startLoop();

  const api: IntroScene = {
    layout,
    enterLogin() {
      if (st.mode !== "scroll") return;
      lgFrom.cam = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      lgFrom.look = { x: look.x, y: look.y, z: look.z };
      st.mode = "login";
      st.lgStart = performance.now();
      st.lg = 0;
      calcLoginPose();
      startLoop();
    },
    ignite(variant) {
      if (st.mode === "scroll") api.enterLogin();
      if (st.mode !== "login") return;
      const v = variant ?? pickMotionVariant(st.reduced);
      igFrom.cam = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      igFrom.look = { x: look.x, y: look.y, z: look.z };
      st.hold = false;
      st.mode = "ignite";
      st.p = 0;
      st.transition = startTransition(v);
      st.liveFired = false;
      pollAgents();
      startLoop();
    },
    skip: onSkip,
    shake() {
      shake = 1;
      energy = 1;
    },
    setReducedMotion(reduced) {
      st.reduced = reduced;
    },
    setAgents(list, real) {
      agents = list.slice();
      labelsReal = real;
      lastAgentKey = list.map((a) => `${a.slug}:${a.busy ? 1 : 0}${a.error ? "e" : ""}`).join("|");
      buildAgents();
      layout();
    },
    setManual(m) {
      manual = m;
      if (m) stopLoop();
      else startLoop();
    },
    frame(dt = 0.016) {
      frameStep(dt);
    },
    get mode() {
      return st.mode;
    },
    debug: {
      stops: () => stops,
      setScroll(y) {
        opts.landing?.scrollEl()?.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
        sy = y;
      },
      setIgnite(p) {
        if (st.mode === "scroll") return;
        if (st.mode === "login") {
          igFrom.cam = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
          igFrom.look = { x: look.x, y: look.y, z: look.z };
        }
        st.mode = "ignite";
        st.hold = true;
        st.p = clamp(p);
      },
      setEnergy(e) {
        energy = e;
      },
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopLoop();
      window.removeEventListener("pointerdown", onSkip);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("input", onInput);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      ro?.disconnect();
      labelEls.forEach((l) => l.root.remove());
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        const kill = (x: THREE.Material) => {
          (x as THREE.MeshBasicMaterial).map?.dispose();
          x.dispose();
        };
        if (Array.isArray(mat)) mat.forEach(kill);
        else if (mat) kill(mat);
      });
      bloom.dispose();
      output.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  return api;
}
