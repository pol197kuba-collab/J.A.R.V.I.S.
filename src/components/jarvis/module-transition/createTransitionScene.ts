// Imperative three.js overlay for the 3D module transitions (approved demo):
// the tunnel between modules and the Arc Core flight into / out of /jarvis.
// One renderer for the whole dashboard session, warmed up once (shaders compiled
// before the first click) and rendering ONLY while a transition plays.
// Built from the intro scene's parts (reactor.ts, core2.ts, tunnel.ts, orbits.ts)
// so the core, rings, agents and gates are the same objects as everywhere else.
//
// Imports three: load ONLY through the dynamic import in ModuleTransitionLayer.tsx.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {
  clamp,
  coreCameraPosition,
  initialDpr,
  lerp,
  viewOffsetFor,
  type Vec3,
} from "@/components/jarvis/login-scene/loginSceneMath";
import {
  SCALE,
  WORLD,
  buildCore,
  buildNode,
  type AgentNode,
} from "@/components/jarvis/login-scene/reactor";
import {
  buildCoreExtras,
  decorateRing,
  type RingKind,
} from "@/components/jarvis/login-scene/core2";
import {
  orbitAngle,
  orbitAt,
  orbitSpec,
  type OrbitSpec,
} from "@/components/jarvis/login-scene/orbits";
import { boardTexture, triOutline } from "@/components/jarvis/login-scene/tunnel";
import type { SceneColors } from "@/components/jarvis/login-scene/sceneColors";
import { arcCoreLive } from "@/components/jarvis/arc-core/arcCoreLive";
import {
  CORE_ENTER_FROM,
  SWAP_AT,
  TUNNEL_BOARD_Z,
  coreEnterAlign,
  coreEnterCamera,
  coreEnterFlash,
  coreEnterHandoff,
  coreEnterHighlight,
  coreEnterOverlay,
  coreLeaveAlign,
  coreLeaveFlash,
  coreLeaveFov,
  coreLeaveHandoff,
  coreLeaveHighlight,
  coreLeaveLook,
  coreLeaveOverlay,
  coreLeaveTravel,
  diveStandoff,
  tunnelBoardOpacity,
  tunnelBoardWidth,
  tunnelCamZ,
  tunnelFlash,
  tunnelFov,
  tunnelGateScale,
  tunnelOverlay,
  type TransitionKind,
} from "./transitionMath";
import {
  MENU_ELEV,
  MENU_FOV,
  MENU_NODE_SCALE,
  MENU_PICK_MS,
  MENU_RING,
  menuCameraDistance,
  menuCloseK,
  menuOpenCam,
  menuOpenFade,
  menuOpenK,
  menuPickFlash,
  menuPickHighlight,
  menuPickOthers,
  menuPickTravel,
  menuSlotAngle,
  menuSwitchDone,
  menuSwitchK,
  spinToFront,
  stepSpin,
  MENU_CLOSE_MS,
  MENU_OPEN_MS,
} from "./orbitMenuMath";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TransitionOverlays {
  canvas: HTMLCanvasElement;
  flash: HTMLElement;
  handoff: HTMLElement;
  handoffName: HTMLElement;
}

export interface PlayOptions {
  kind: TransitionKind;
  durationMs: number;
  /** Tunnel board of the target module. */
  board: { index: number; title: string; sub: string };
  /** Number of agent nodes on the /jarvis matrix (teammates, core excluded). */
  agentCount: number;
  /** Node that owns the other module (null: through the core itself). */
  agentIndex: number | null;
  agentName: string | null;
  /** Rect of the /jarvis canvas (null when it is not on screen). */
  getTargetRect: () => Rect | null;
  /** Started from the orbit menu: the overlay already covers the screen. */
  coverStart?: boolean;
  /** The route should change now (the overlay still covers the screen). */
  onSwap: () => void;
  onDone: () => void;
}

/** Screen position of one menu node (px), its radius on screen and its label opacity. */
export interface MenuNodeFrame {
  x: number;
  y: number;
  r: number;
  alpha: number;
  depth: number;
}
export interface MenuFrame {
  nodes: MenuNodeFrame[];
  core: { x: number; y: number; r: number };
}
/** The mobile "Orbita" menu: entries as nodes on an orbit around the Arc Core. */
export interface MenuControl {
  /** false when the menu cannot open now (a transition is playing). */
  open(o: { count: number; active: number | null; onFrame: (f: MenuFrame) => void }): boolean;
  /** Switch to another level (sections ↔ modules): old nodes fall in, new ones burst out. */
  setLevel(count: number, active: number | null): void;
  /** Finger drag: turn the orbit by `dSpin` rad. */
  drag(dSpin: number): void;
  /** Finger up: keep turning at `velocity` rad/s, then settle on a slot. */
  release(velocity: number): void;
  /** Dive into node `index`; `onReady` fires at the end (start the module transition there). */
  pick(index: number, onReady: () => void): void;
  close(onClosed?: () => void): void;
  readonly isOpen: boolean;
}

export interface TransitionScene {
  play(o: PlayOptions): void;
  readonly playing: boolean;
  readonly menu: MenuControl;
  dispose(): void;
}

/** Most entries one menu level can hold. */
export const MENU_MAX_NODES = 8;

const RING_KINDS: RingKind[] = ["fine", "bold", "claw"];

export function createTransitionScene(o: TransitionOverlays, C: SceneColors): TransitionScene {
  const { canvas, flash, handoff, handoffName } = o;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(initialDpr(window.devicePixelRatio, window.innerWidth));
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 1500, 3200);
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 7000);
  scene.add(new THREE.AmbientLight(C.ambient, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(300, 500, 500);
  scene.add(key);

  // ---- Arc Core at its /jarvis state (ignition p = 1) ----
  const coreGroup = new THREE.Group();
  scene.add(coreGroup);
  const core = buildCore(C);
  core.material.uniforms.heat.value = 1;
  core.material.uniforms.op.value = 1;
  coreGroup.add(core);
  coreGroup.add(new THREE.PointLight(C.reactor, 70000, 1400, 1.7));
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
  const rings = ringDefs.map((d, i) => {
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
    coreGroup.add(m);
    const deco = decorateRing(m, RING_KINDS[i], d.deco);
    deco.inst.material.opacity = 0.85;
    deco.bead.visible = true;
    return { m, deco, d, spin: [0, 0, 0] };
  });

  // agents (rebuilt when the count changes)
  let nodes: AgentNode[] = [];
  let specs: OrbitSpec[] = [];
  let extras: ReturnType<typeof buildCoreExtras> | null = null;
  const spokeGeo = new THREE.BufferGeometry();
  const spokes = new THREE.LineSegments(
    spokeGeo,
    new THREE.LineBasicMaterial({
      color: C.spoke,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  coreGroup.add(spokes);
  const cCyan = new THREE.Color(C.primary);
  const cAmber = new THREE.Color(C.reactor);
  const wCyan = new THREE.Color(C.nodeWire);
  const wAmber = new THREE.Color(C.nodeWireAmber);
  const disposeTree = (obj: THREE.Object3D) =>
    obj.traverse((c) => {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const kill = (x: THREE.Material) => {
        (x as THREE.MeshBasicMaterial).map?.dispose();
        x.dispose();
      };
      if (Array.isArray(mat)) mat.forEach(kill);
      else if (mat) kill(mat);
    });
  function buildAgents(n: number) {
    nodes.forEach((x) => {
      coreGroup.remove(x);
      disposeTree(x);
    });
    if (extras) {
      coreGroup.remove(extras.group);
      disposeTree(extras.group);
    }
    specs = Array.from({ length: n }, (_, i) => orbitSpec(i, n, SCALE));
    nodes = specs.map(() => {
      const node = buildNode(C);
      coreGroup.add(node);
      return node;
    });
    extras = buildCoreExtras(specs, C);
    extras.shell.material.opacity = 0.17;
    extras.floor.material.opacity = 0.15;
    extras.orbits.forEach((l) => (l.material.opacity = 0.22));
    coreGroup.add(extras.group);
    spokeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  }
  buildAgents(5);

  // dust
  const dustPos = new Float32Array(800 * 3);
  for (let i = 0; i < 800; i++) {
    const r = (3 + Math.random() * 5.5) * SCALE;
    const th = Math.random() * 6.283;
    const ph = Math.acos(2 * Math.random() - 1);
    dustPos.set(
      [r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.4, r * Math.cos(ph)],
      i * 3,
    );
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: C.primary,
      size: 2.4,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  scene.add(dust);

  // ---- tunnel: gates and one board, flown through ----
  const tunnel = new THREE.Group();
  scene.add(tunnel);
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
  const gateTri = triOutline(420, 7);
  const gateTri2 = triOutline(392, 2.4);
  const gateRing = new THREE.RingGeometry(508, 512, 128);
  const gates = Array.from({ length: 6 }, (_, i) => {
    const g = new THREE.Group();
    g.position.z = -60 - i * 230;
    g.rotation.z = i * 0.36;
    g.add(
      new THREE.Mesh(gateTri, gateMat),
      new THREE.Mesh(gateTri2, gateSoft),
      new THREE.Mesh(gateRing, gateSoft),
    );
    tunnel.add(g);
    return g;
  });
  const boardMat = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.39), boardMat);
  board.position.z = TUNNEL_BOARD_Z;
  tunnel.add(board);
  function setBoard(b: PlayOptions["board"]) {
    boardMat.map?.dispose();
    boardMat.map = boardTexture(C, b.title, b.sub, Math.max(0, b.index - 1));
    boardMat.needsUpdate = true;
  }

  function agentsVisible(v: boolean) {
    nodes.forEach((n) => (n.visible = v));
    spokes.visible = v;
    if (extras) {
      extras.orbits.forEach((l) => (l.visible = v));
      extras.floor.visible = v;
    }
  }

  // ---- orbit menu: entries as nodes on one orbit around the core ----
  const menuGroup = new THREE.Group();
  menuGroup.visible = false;
  scene.add(menuGroup);
  const ringR = MENU_RING * SCALE;
  const menuNodes = Array.from({ length: MENU_MAX_NODES }, () => {
    const n = buildNode(C);
    menuGroup.add(n);
    return n;
  });
  const menuOrbit = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 256 }, (_, i) => {
        const a = (i / 256) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * ringR, 0, Math.sin(a) * ringR);
      }),
    ),
    new THREE.LineBasicMaterial({
      color: C.primary,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  menuGroup.add(menuOrbit);
  const menuSpokeGeo = new THREE.BufferGeometry();
  menuSpokeGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(MENU_MAX_NODES * 6), 3),
  );
  const menuSpokes = new THREE.LineSegments(
    menuSpokeGeo,
    new THREE.LineBasicMaterial({
      color: C.spoke,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  menuGroup.add(menuSpokes);

  // ---- post ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.55, 0.55);
  composer.addPass(bloom);
  const output = new OutputPass();
  composer.addPass(output);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- per-frame helpers ----
  const look = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  const startCam = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const endPos = new THREE.Vector3();
  const tmp = { x: 0, y: 0, z: 0 } as Vec3;
  const spokeArr = () => spokeGeo.attributes.position.array as Float32Array;

  function applyCoreLook() {
    coreGroup.visible = true;
    agentsVisible(true);
    tunnel.visible = false;
    const f = scene.fog as THREE.Fog;
    f.near = 1500;
    f.far = 3200;
    bloom.strength = 0.62;
    bloom.threshold = 0.55;
    bloom.radius = 0.55;
  }
  function applyTunnelLook() {
    coreGroup.visible = false;
    tunnel.visible = true;
    const f = scene.fog as THREE.Fog;
    f.near = 120;
    f.far = 1050;
    bloom.strength = 0.45;
    bloom.threshold = 0.5;
    bloom.radius = 0.45;
  }

  function updateCore(dt: number, nodeTime: number, highlight: number | null, hl: number) {
    core.material.uniforms.t.value = nodeTime;
    core.scale.setScalar(1 + Math.sin(nodeTime * 1.4) * 0.03);
    core.rotation.y += dt * 0.15;
    if (extras) {
      extras.shell.rotation.y -= dt * 0.09;
      extras.shell.rotation.x += dt * 0.05;
      extras.corona.scale.setScalar(5.6 * SCALE * (1 + Math.sin(nodeTime * 1.4) * 0.03));
      extras.corona.material.opacity = 0.55 * (1 + Math.sin(nodeTime * 1.4) * 0.08);
    }
    rings.forEach((r, i) => {
      r.spin[0] += r.d.v[0] * dt;
      r.spin[1] += r.d.v[1] * dt;
      r.spin[2] += r.d.v[2] * dt;
      r.m.rotation.set(r.d.rot[0] + r.spin[0], r.d.rot[1] + r.spin[1], r.d.rot[2] + r.spin[2]);
      const a = nodeTime * (i % 2 ? -0.9 : 0.7) + i * 2;
      r.deco.bead.position.set(Math.cos(a) * r.deco.r, Math.sin(a) * r.deco.r, 0);
    });
    const arr = spokeArr();
    nodes.forEach((n, i) => {
      orbitAt(specs[i], orbitAngle(specs[i], nodeTime), tmp);
      n.position.set(tmp.x, tmp.y, tmp.z);
      const on = i === highlight ? hl : 0;
      const pulse = on ? 1 + Math.sin(nodeTime * 9) * 0.08 * on : 1;
      n.scale.setScalar(0.8 * (1 + 0.8 * on) * pulse);
      n.userData.body.rotation.x += dt * (on ? 0.9 : 0.15);
      n.userData.body.rotation.y += dt * (on ? 0.6 : 0.1);
      const mt = n.userData.body.material;
      mt.color.copy(cCyan).lerp(cAmber, on);
      mt.emissive.copy(mt.color);
      mt.emissiveIntensity = 0.3 + 0.9 * on;
      const wm = (n.userData.body.children[0] as THREE.LineSegments)
        .material as THREE.LineBasicMaterial;
      wm.color.copy(wCyan).lerp(wAmber, on);
      arr[i * 6 + 3] = tmp.x;
      arr[i * 6 + 4] = tmp.y;
      arr[i * 6 + 5] = tmp.z;
    });
    spokeGeo.attributes.position.needsUpdate = true;
    dust.rotation.y += dt * 0.01;
  }

  /** Frame the camera on `rect` (w = 1) or the full screen (w = 0). */
  function frameOn(w: number, rect: Rect | null) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const vo = viewOffsetFor(w, { width: vw, height: vh }, rect);
    if (vo) {
      camera.aspect = vo.aspect;
      camera.setViewOffset(vo.fullWidth, vo.fullHeight, vo.x, vo.y, vo.width, vo.height);
    } else {
      camera.aspect = vw / vh;
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
  }

  const setFlash = (a: number, color: string) => {
    flash.style.background = color;
    flash.style.opacity = a.toFixed(3);
  };

  // ---- playback ----
  let raf = 0;
  let disposed = false;
  let current:
    | (PlayOptions & {
        t0: number;
        last: number;
        swapped: boolean;
        ownTime: number;
        liveT0: number;
      })
    | null = null;

  function stepTunnel(t: number, dt: number) {
    const aspect = window.innerWidth / window.innerHeight;
    const z = tunnelCamZ(t);
    camera.position.set(Math.sin(t * 9) * 10, Math.cos(t * 7) * 8, z);
    camera.fov = tunnelFov(t);
    frameOn(0, null);
    camera.lookAt(0, 0, z - 500);
    const gs = tunnelGateScale(aspect);
    gates.forEach((g, i) => {
      g.rotation.z += dt * (i % 2 ? 1.4 : -1.4);
      g.scale.set(gs, gs, 1);
    });
    const bw = tunnelBoardWidth(camera.fov, aspect, t);
    board.scale.set(bw, bw, 1);
    boardMat.opacity = tunnelBoardOpacity(z);
    canvas.style.opacity = tunnelOverlay(t).toFixed(3);
    setFlash(tunnelFlash(t), "color-mix(in oklab, var(--primary) 25%, white)");
  }

  function stepEnter(c: NonNullable<typeof current>, t: number, dt: number) {
    const rect = c.getTargetRect();
    const aspectEnd =
      rect && rect.width > 0 ? rect.width / rect.height : window.innerWidth / window.innerHeight;
    const end = coreCameraPosition(SCALE, aspectEnd);
    const { k, az, fov } = coreEnterCamera(t);
    const rEnd = Math.hypot(end.x, end.z);
    const r = lerp(CORE_ENTER_FROM.r, rEnd, k);
    camera.position.set(Math.sin(az) * r, lerp(CORE_ENTER_FROM.y, end.y, k), Math.cos(az) * r);
    camera.fov = fov;
    frameOn(coreEnterAlign(t), rect);
    camera.lookAt(0, 0, 0);
    // once /jarvis renders, follow its clock so the nodes meet the live ones
    const live = arcCoreLive.active && arcCoreLive.stamp > c.t0;
    const nodeTime = live ? arcCoreLive.time : c.ownTime;
    updateCore(dt, nodeTime, c.agentIndex, c.agentIndex !== null ? coreEnterHighlight(t) : 0);
    canvas.style.opacity = coreEnterOverlay(t).toFixed(3);
    setFlash(coreEnterFlash(t), "var(--reactor-hot)");
    handoff.style.opacity = c.agentIndex !== null && coreEnterHandoff(t) ? "1" : "0";
  }

  function stepLeave(c: NonNullable<typeof current>, t: number, dt: number) {
    const nodeTime = c.liveT0 + (performance.now() - c.t0) / 1000;
    updateCore(dt, nodeTime, c.agentIndex, c.agentIndex !== null ? coreLeaveHighlight(t) : 0);
    if (c.agentIndex !== null && nodes[c.agentIndex]) tgt.copy(nodes[c.agentIndex].position);
    else tgt.set(0, 0, 0);
    dir.copy(tgt).sub(startCam).normalize();
    endPos.copy(tgt).addScaledVector(dir, -diveStandoff(c.agentIndex !== null, SCALE));
    camera.position.lerpVectors(startCam, endPos, coreLeaveTravel(t));
    look.set(0, 0, 0).lerp(tgt, coreLeaveLook(t));
    camera.fov = coreLeaveFov(t);
    frameOn(coreLeaveAlign(t), c.getTargetRect());
    camera.lookAt(look);
    canvas.style.opacity = coreLeaveOverlay(t).toFixed(3);
    setFlash(
      coreLeaveFlash(t),
      c.agentIndex !== null
        ? "color-mix(in oklab, var(--reactor-hot) 45%, white)"
        : "var(--reactor-hot)",
    );
    handoff.style.opacity = c.agentIndex !== null && coreLeaveHandoff(t) ? "1" : "0";
  }

  function loop(now: number) {
    raf = 0;
    if (disposed) return;
    if (!current && menu) {
      const dt = Math.min(0.05, (now - menu.last) / 1000);
      stepMenu(menu, now, dt);
      // the pick handed over to a module transition: it renders from the next frame
      if (current || menu) {
        if (!current) composer.render(dt);
        raf = requestAnimationFrame(loop);
      }
      return;
    }
    const c = current;
    if (!c) return;
    const dt = Math.min(0.05, (now - c.last) / 1000);
    c.last = now;
    c.ownTime += dt;
    const t = clamp((now - c.t0) / c.durationMs);
    if (c.kind === "tunnel") stepTunnel(t, dt);
    else if (c.kind === "core-enter") stepEnter(c, t, dt);
    else stepLeave(c, t, dt);
    if (c.coverStart) {
      // the menu's dive already covers the screen: no fade-in, a flash hides the cut
      if (t < 0.5) canvas.style.opacity = "1";
      if (t < 0.12)
        setFlash(0.5 * (1 - t / 0.12), "color-mix(in oklab, var(--primary) 25%, white)");
    }
    composer.render(dt);
    if (!c.swapped && t >= SWAP_AT[c.kind]) {
      c.swapped = true;
      c.onSwap();
    }
    if (t >= 1) {
      current = null;
      canvas.style.opacity = "0";
      canvas.style.visibility = "hidden";
      setFlash(0, "transparent");
      handoff.style.opacity = "0";
      c.onDone();
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  // ---- orbit menu playback ----
  type MenuPhase = "open" | "idle" | "switch" | "pick" | "close";
  interface MenuState {
    phase: MenuPhase;
    t0: number;
    last: number;
    time: number;
    count: number;
    active: number | null;
    spin: number;
    prev: { count: number; active: number | null; spin: number };
    vel: number;
    dragging: boolean;
    pickIndex: number;
    onReady: (() => void) | null;
    onClosed?: () => void;
    onFrame: (f: MenuFrame) => void;
  }
  let menu: MenuState | null = null;
  const proj = new THREE.Vector3();
  const pickPos = new THREE.Vector3();
  const frameNodes: MenuNodeFrame[] = Array.from({ length: MENU_MAX_NODES }, () => ({
    x: 0,
    y: 0,
    r: 0,
    alpha: 0,
    depth: 0,
  }));

  function endMenu() {
    menu = null;
    menuGroup.visible = false;
    agentsVisible(true);
  }

  function stepMenu(m: MenuState, now: number, dt: number) {
    m.last = now;
    m.time += dt;
    const e = now - m.t0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const aspect = vw / vh;
    const dist = menuCameraDistance(ringR, MENU_FOV, aspect);
    const elev = (MENU_ELEV * Math.PI) / 180;

    if (m.phase === "idle" && !m.dragging) {
      const s = stepSpin(m.spin, m.vel, m.count, dt);
      m.spin = s.spin;
      m.vel = s.vel;
    }

    // camera: pulls back out of the core on open, falls back in on close, dives on pick
    let camK = 1;
    let fade = 1;
    if (m.phase === "open") {
      camK = menuOpenCam(e);
      fade = menuOpenFade(e);
      if (e >= MENU_OPEN_MS + MENU_MAX_NODES * 35) m.phase = "idle";
    } else if (m.phase === "close") {
      camK = menuCloseK(e);
      fade = camK;
    }
    const d = dist * (0.42 + 0.58 * camK);
    camera.fov = MENU_FOV;
    frameOn(0, null);
    camera.position.set(0, Math.sin(elev) * d, Math.cos(elev) * d);
    camera.lookAt(0, 0, 0);

    // nodes
    const switching = m.phase === "switch";
    let anyIncoming = false;
    const arr = menuSpokeGeo.attributes.position.array as Float32Array;
    const focal = vh / 2 / Math.tan((MENU_FOV * Math.PI) / 360);
    let pickHl = 0;
    let others = 1;
    if (m.phase === "pick") {
      pickHl = menuPickHighlight(e);
      others = menuPickOthers(e);
    }
    for (let i = 0; i < MENU_MAX_NODES; i++) {
      const n = menuNodes[i];
      const f = frameNodes[i];
      let k = 1;
      let alpha = 1;
      let count = m.count;
      let active = m.active;
      let spin = m.spin;
      if (m.phase === "open") k = menuOpenK(e, i);
      else if (m.phase === "close") {
        k = menuCloseK(e);
        alpha = 0;
      } else if (switching) {
        const sk = menuSwitchK(e, i);
        k = sk.k;
        anyIncoming ||= sk.incoming;
        if (!sk.incoming) {
          count = m.prev.count;
          active = m.prev.active;
          spin = m.prev.spin;
          alpha = 0;
        }
      } else if (m.phase === "pick") alpha = 0;
      if (i >= count || k <= 0.001) {
        n.visible = false;
        f.alpha = 0;
        f.r = 0;
        arr.fill(0, i * 6, i * 6 + 6);
        continue;
      }
      n.visible = true;
      const a = menuSlotAngle(i, count, spin);
      const r = ringR * k;
      n.position.set(Math.cos(a) * r, Math.sin(m.time * 1.3 + i * 1.7) * 4 * k, Math.sin(a) * r);
      const isPick = m.phase === "pick" && i === m.pickIndex;
      const on = isPick ? pickHl : 0;
      const sc =
        MENU_NODE_SCALE *
        (0.15 + 0.85 * k) *
        (i === active ? 1.18 : 1) *
        (isPick ? 1 + 0.35 * pickHl : m.phase === "pick" ? 0.4 + 0.6 * others : 1);
      n.scale.setScalar(sc);
      n.userData.body.rotation.x += dt * (on ? 0.9 : 0.2);
      n.userData.body.rotation.y += dt * (on ? 0.6 : 0.14);
      const mt = n.userData.body.material;
      mt.color.copy(cCyan).lerp(cAmber, on);
      mt.emissive.copy(mt.color);
      mt.emissiveIntensity = (i === active ? 0.75 : 0.35) + 0.9 * on;
      mt.opacity = m.phase === "pick" && !isPick ? 0.55 * others : 0.55;
      const wm = (n.userData.body.children[0] as THREE.LineSegments)
        .material as THREE.LineBasicMaterial;
      wm.color.copy(wCyan).lerp(wAmber, on);
      arr[i * 6 + 3] = n.position.x;
      arr[i * 6 + 4] = n.position.y;
      arr[i * 6 + 5] = n.position.z;
      if (isPick) pickPos.copy(n.position);
      f.alpha = alpha * k;
    }
    menuSpokeGeo.attributes.position.needsUpdate = true;
    if (switching && anyIncoming && menuSwitchDone(e, m.count)) m.phase = "idle";

    if (m.phase === "pick") {
      // dive into the picked node, like leaving /jarvis through an agent
      const tr = menuPickTravel(e);
      dir.copy(pickPos).sub(camera.position).normalize();
      endPos.copy(pickPos).addScaledVector(dir, -0.38 * SCALE * MENU_NODE_SCALE * 2.6);
      camera.position.lerp(endPos, tr);
      look.set(0, 0, 0).lerp(pickPos, ease01(Math.min(1, e / (MENU_PICK_MS * 0.6))));
      camera.fov = MENU_FOV - 10 * tr;
      camera.updateProjectionMatrix();
      camera.lookAt(look);
      setFlash(menuPickFlash(e), "color-mix(in oklab, var(--primary) 25%, white)");
      if (e >= MENU_PICK_MS && m.onReady) {
        const cb = m.onReady;
        m.onReady = null;
        updateCore(dt, m.time, null, 0);
        composer.render(dt);
        cb();
        return;
      }
    }

    menuOrbit.material.opacity = 0.35 * (m.phase === "pick" ? others : 1) * Math.min(1, camK + 0.2);
    updateCore(dt, m.time, null, 0);
    canvas.style.opacity = fade.toFixed(3);

    // screen positions for the HTML labels / tap targets
    camera.updateMatrixWorld();
    for (let i = 0; i < MENU_MAX_NODES; i++) {
      const n = menuNodes[i];
      const f = frameNodes[i];
      if (!n.visible) continue;
      proj.copy(n.position).project(camera);
      f.x = ((proj.x + 1) / 2) * vw;
      f.y = ((1 - proj.y) / 2) * vh;
      f.depth = camera.position.distanceTo(n.position);
      f.r = (focal * 0.38 * SCALE * n.scale.x) / f.depth;
    }
    proj.set(0, 0, 0).project(camera);
    m.onFrame({
      nodes: frameNodes,
      core: {
        x: ((proj.x + 1) / 2) * vw,
        y: ((1 - proj.y) / 2) * vh,
        r: (focal * SCALE) / camera.position.length(),
      },
    });

    if (m.phase === "close" && e >= MENU_CLOSE_MS) {
      const cb = m.onClosed;
      endMenu();
      canvas.style.opacity = "0";
      canvas.style.visibility = "hidden";
      setFlash(0, "transparent");
      cb?.();
    }
  }

  const ease01 = (x: number) => x * x * (3 - 2 * x);

  const menuControl: MenuControl = {
    open({ count, active, onFrame }) {
      // a menu that is still closing can be reopened (e.g. a quick second tap)
      if (disposed || current || (menu && menu.phase !== "close")) return false;
      const now = performance.now();
      const n = Math.min(count, MENU_MAX_NODES);
      const spin = active !== null ? spinToFront(active, n) : 0;
      menu = {
        phase: "open",
        t0: now,
        last: now,
        time: arcCoreLive.time,
        count: n,
        active,
        spin,
        prev: { count: n, active, spin },
        vel: 0,
        dragging: false,
        pickIndex: -1,
        onReady: null,
        onFrame,
      };
      applyCoreLook();
      agentsVisible(false);
      menuGroup.visible = true;
      canvas.style.opacity = "0";
      canvas.style.visibility = "visible";
      if (!raf) raf = requestAnimationFrame(loop);
      return true;
    },
    setLevel(count, active) {
      const m = menu;
      if (!m || m.phase === "pick" || m.phase === "close") return;
      const n = Math.min(count, MENU_MAX_NODES);
      m.prev = { count: m.count, active: m.active, spin: m.spin };
      m.count = n;
      m.active = active;
      m.spin = active !== null ? spinToFront(active, n) : 0;
      m.vel = 0;
      m.dragging = false;
      m.phase = "switch";
      m.t0 = performance.now();
    },
    drag(dSpin) {
      const m = menu;
      if (!m || m.phase !== "idle") return;
      m.dragging = true;
      m.vel = 0;
      m.spin += dSpin;
    },
    release(velocity) {
      const m = menu;
      if (!m) return;
      m.dragging = false;
      m.vel = Math.max(-12, Math.min(12, velocity));
    },
    pick(index, onReady) {
      const m = menu;
      if (!m || m.phase === "pick" || m.phase === "close" || index >= m.count) return;
      m.phase = "pick";
      m.pickIndex = index;
      m.onReady = onReady;
      m.t0 = performance.now();
    },
    close(onClosed) {
      const m = menu;
      if (!m) {
        onClosed?.();
        return;
      }
      if (m.phase === "close") {
        m.onClosed = onClosed ?? m.onClosed;
        return;
      }
      if (m.phase === "pick") {
        // the module transition did not take over: just drop the overlay
        endMenu();
        canvas.style.opacity = "0";
        canvas.style.visibility = "hidden";
        setFlash(0, "transparent");
        onClosed?.();
        return;
      }
      m.phase = "close";
      m.onClosed = onClosed;
      m.t0 = performance.now();
    },
    get isOpen() {
      return menu !== null;
    },
  };

  // warm-up: compile every material once, invisibly
  canvas.style.opacity = "0";
  coreGroup.visible = true;
  tunnel.visible = true;
  menuGroup.visible = true;
  setBoard({ index: 1, title: "J.A.R.V.I.S.", sub: "" });
  camera.position.set(0, 0, 900);
  camera.lookAt(0, 0, 0);
  composer.render(0);
  menuGroup.visible = false;
  canvas.style.visibility = "hidden";

  return {
    play(p) {
      if (disposed || current) return;
      if (menu) endMenu();
      if (p.agentCount > 0 && p.agentCount !== nodes.length) buildAgents(p.agentCount);
      const now = performance.now();
      current = { ...p, t0: now, last: now, swapped: false, ownTime: 0, liveT0: arcCoreLive.time };
      handoffName.textContent = p.agentName ?? "";
      if (p.kind === "tunnel") {
        setBoard(p.board);
        applyTunnelLook();
      } else {
        applyCoreLook();
        if (p.kind === "core-leave") {
          // start exactly where the live /jarvis camera is (app units → world units)
          const fresh = arcCoreLive.active && now - arcCoreLive.stamp < 500;
          const rect = p.getTargetRect();
          const fallback = coreCameraPosition(
            SCALE,
            rect && rect.width ? rect.width / rect.height : 2.4,
          );
          if (fresh)
            startCam.set(
              arcCoreLive.cam.x * WORLD,
              arcCoreLive.cam.y * WORLD,
              arcCoreLive.cam.z * WORLD,
            );
          else startCam.set(fallback.x, fallback.y, fallback.z);
        }
      }
      canvas.style.visibility = "visible";
      if (!raf) raf = requestAnimationFrame(loop);
    },
    get playing() {
      return current !== null;
    },
    menu: menuControl,
    dispose() {
      if (disposed) return;
      disposed = true;
      menu = null;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      boardMat.map?.dispose();
      disposeTree(scene);
      bloom.dispose();
      output.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
