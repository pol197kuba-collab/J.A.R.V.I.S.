// Imperative three.js scene for login → Arc Core ignition. Port of
// docs/login-scene-prototype/src/main.js (scene, camera, frame loop, quality
// guard) without its DOM: no form, HUD, roster, labels or DEMO panel — those
// belong to StarkLogin / PhaseController / the /jarvis route.
//
// Render setup is identical to the prototype: NoToneMapping, antialias off +
// EffectComposer (RenderPass → UnrealBloomPass → OutputPass), fog, fov 32 → 45,
// 800 dust points of size 2.4, DPR min(devicePixelRatio, 1.75 | 1.5 narrow).
// The ONLY quality knob is DPR (see qualityVerdict in loginSceneMath.ts).
//
// Imports three: load ONLY through the dynamic import in LoginScene.tsx.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {
  BOOT_SECONDS,
  SHAKE_SECONDS,
  QUALITY_WINDOW,
  SLOW_FRAME_S,
  bloomAt,
  cameraAt,
  clamp,
  coreCameraPosition,
  coreLook,
  dustOpacity,
  fitCamera,
  initialDpr,
  lerp,
  nodeProgress,
  overlayInteractive,
  overlayLook,
  overlayOpacity,
  qualityVerdict,
  reactorLook,
  reactorOpacities,
  reactorPartPose,
  ringGrowth,
  seg,
  shakeAt,
  startTransition,
  stepTransition,
  pickMotionVariant,
  type MotionVariant,
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
import type { SceneColors } from "./sceneColors";

export interface SlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SceneOverlays {
  /** Wrapper whose opacity / pointer-events follow overlayOpacity / overlayInteractive. */
  root: HTMLElement;
  grid: HTMLElement;
  vignette: HTMLElement;
  flash: HTMLElement;
}

export interface LoginSceneOptions {
  canvas: HTMLCanvasElement;
  overlays: SceneOverlays;
  colors: SceneColors;
  reducedMotion: boolean;
  agentCount: number;
  /** Where the reactor sits on the login screen (the StarkLogin slot). */
  getSlotRect: () => SlotRect | null;
  /** p reached P_LIVE: the dashboard may mount. */
  onLive?: () => void;
  /** p reached 1: the overlay is fully gone, the scene has stopped rendering. */
  onDone?: () => void;
  /** Keep the drawing buffer (DEV screenshots only). */
  preserveDrawingBuffer?: boolean;
}

export interface LoginScene {
  /** Re-measure the viewport and the reactor slot. `slotRect` overrides getSlotRect. */
  layout(slotRect?: SlotRect | null): void;
  /** Pin the scene to phase p (0 login … 1 core). Stops the ignition driver. */
  setPhase(p: number): void;
  /** Play the login → Arc Core transition (p 0 → 1). */
  ignite(variant?: MotionVariant): void;
  /** Fast-forward a running transition (×6). */
  skip(): void;
  /** Wrong-key shake of the reactor. */
  shake(): void;
  setReducedMotion(reduced: boolean): void;
  /** Rebuild agent nodes + spokes for n agents (default layout rules of JarvisCanvas). */
  setAgentCount(n: number): void;
  /** Stop/start the internal rAF loop; with it stopped, drive with frame(). */
  setManual(manual: boolean): void;
  /** Advance one frame and render (manual mode, DEV proof harness). */
  frame(dt?: number): void;
  readonly phase: number;
  dispose(): void;
}

type Mode = "login" | "trans" | "done";

export function createLoginScene(opts: LoginSceneOptions): LoginScene {
  const { canvas, overlays, colors } = opts;
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
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 7000);
  scene.background = new THREE.Color(0x000000); // neutral black void
  scene.fog = new THREE.Fog(0x000000, 1500, 3400);
  scene.add(new THREE.AmbientLight(colors.ambient, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(300, 500, 500);
  scene.add(key);

  const R = buildReactor(colors);
  scene.add(R.root);
  R.hull.visible = false;

  // agent nodes + spokes (rebuilt by setAgentCount)
  const spokeMat = new THREE.LineBasicMaterial({
    color: colors.spoke,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  let nodes: AgentNode[] = [];
  let spokes: THREE.Line[] = [];
  function disposeNodes() {
    nodes.forEach((n) => {
      scene.remove(n);
      n.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    });
    spokes.forEach((l) => {
      scene.remove(l);
      l.geometry.dispose();
    });
    nodes = [];
    spokes = [];
  }
  function buildNodes(n: number) {
    disposeNodes();
    nodes = Array.from({ length: n }, (_, i) => {
      const node = buildNode(colors);
      node.userData.home = orbitPosition(i, n);
      node.visible = false;
      scene.add(node);
      return node;
    });
    spokes = nodes.map(() => {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        spokeMat,
      );
      l.visible = false;
      scene.add(l);
      return l;
    });
  }
  buildNodes(Math.max(1, opts.agentCount));

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
    color: colors.primary,
    size: 2.4,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  const core = buildCore(colors);
  core.visible = false;
  scene.add(core);
  const coreLight = new THREE.PointLight(colors.reactor, 0, 1400, 1.7);
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
      m: torus(1.55 * SCALE, 1.1, colors.reactor, 0.75),
      rot: [Math.PI / 2.3, 0, 0],
      v: [0.25, 0, 0],
      spin: [0, 0, 0],
    },
    {
      m: torus(1.85 * SCALE, 0.8, colors.primary, 0.55),
      rot: [Math.PI / 3.1, Math.PI / 5, 0],
      v: [0, 0.18, 0],
      spin: [0, 0, 0],
    },
    {
      m: torus(2.1 * SCALE, 0.7, colors.reactor, 0.45),
      rot: [0, Math.PI / 2.4, Math.PI / 6],
      v: [0, 0, 0.32],
      spin: [0, 0, 0],
    },
  ];
  rings.forEach((r) => {
    r.m.visible = false;
    scene.add(r.m);
  });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.45, 0.5);
  composer.addPass(bloom);
  const output = new OutputPass();
  composer.addPass(output);

  // ---- state ----
  const st = {
    mode: "login" as Mode,
    p: 0,
    boot: 0,
    shake: 0,
    hold: false,
    transition: null as Transition | null,
    reduced: opts.reducedMotion,
    liveFired: false,
  };
  const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  const colA = new THREE.Color(colors.primary);
  const colB = new THREE.Color(colors.reactor);
  const colR = new THREE.Color(colors.destructive);
  const colT = new THREE.Color();
  let anchor: Vec3 = { x: 0, y: 0, z: 1000 };
  let lookAnchor: Vec3 = { x: 0, y: 0, z: 0 };
  let coreCam: Vec3 = { x: 0, y: 2.2 * SCALE, z: 8.5 * SCALE };
  const coreTarget: Vec3 = { x: 0, y: 0, z: 0 };
  let endCam: Vec3 = { ...coreCam };
  let lastSlot: SlotRect | null = null;
  let time = 0;
  let frames = 0;
  let slow = 0;
  let qualityDone = false;
  let last = performance.now();
  let raf = 0;
  let manual = false;
  let disposed = false;

  function layout(slotRect?: SlotRect | null) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    coreCam = coreCameraPosition(SCALE, w / h);
    const rect = slotRect ?? opts.getSlotRect() ?? lastSlot;
    if (rect && rect.width > 0) {
      lastSlot = rect;
      const f = fitCamera(rect, { width: w, height: h });
      anchor = f;
      lookAnchor = { x: f.x, y: f.y, z: 0 };
    }
    if (st.mode !== "trans") endCam = { ...coreCam };
  }

  function applyReactor(a: number, fade: number) {
    R.parts.forEach((q) => {
      const o = q.obj;
      const pose = reactorPartPose(q, a, time, st.reduced);
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
  }

  // ---- every visual as a function of p ----
  function scenePhase(p: number, dt: number) {
    const cam = cameraAt(p, {
      anchor,
      lookAnchor,
      endCam,
      endLook: coreTarget,
      boot: st.boot,
      reduced: st.reduced,
      pointer: { x: ptr.sx, y: ptr.sy },
    });
    camera.position.set(cam.position.x, cam.position.y, cam.position.z);
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(cam.lookAt.x, cam.lookAt.y, cam.lookAt.z);

    // reactor: front-on with a little depth at login, then it comes apart and fades
    const rl = reactorLook(p, st.boot);
    applyReactor(rl.a, rl.fade);
    colT.copy(colA).lerp(colB, rl.heatMix);
    if (st.shake > 0) {
      const sh = shakeAt(st.shake, time);
      colT.lerp(colR, sh.tint);
      R.root.position.x = sh.x;
      R.root.rotation.z = sh.rotZ;
    } else {
      R.root.position.x = 0;
      R.root.rotation.z = 0;
    }
    R.mats.line.color.copy(colT);
    R.mats.lineSoft.color.copy(colT);
    R.mats.lineFaint.color.copy(colT);
    R.root.visible = rl.visible;

    // Arc Core
    const cl = coreLook(p);
    core.visible = cl.visible;
    core.scale.setScalar(cl.baseScale * (1 + Math.sin(time * 1.4) * 0.03));
    core.rotation.y += dt * 0.15;
    core.material.uniforms.t.value = time;
    core.material.uniforms.heat.value = cl.heat;
    core.material.uniforms.op.value = cl.opacity;
    coreLight.intensity = cl.lightIntensity;
    const u = ringGrowth(p);
    rings.forEach((r) => {
      r.m.visible = u > 0;
      const s = lerp(96 / (r.m.geometry as THREE.TorusGeometry).parameters.radius, 1, u);
      r.m.scale.set(s, s, s);
      if (!st.reduced) r.v.forEach((wv, i) => (r.spin[i] += wv * dt));
      r.m.rotation.set(
        lerp(0, r.rot[0], u) + r.spin[0],
        lerp(0, r.rot[1], u) + r.spin[1],
        lerp(0, r.rot[2], u) + r.spin[2],
      );
    });
    nodes.forEach((n, i) => {
      const q = nodeProgress(p, i);
      n.visible = spokes[i].visible = q > 0;
      n.position.copy(n.userData.home).multiplyScalar(q);
      n.scale.setScalar(0.2 + q * 0.8);
      if (!st.reduced) {
        n.userData.body.rotation.x += dt * 0.15;
        n.userData.body.rotation.y += dt * 0.1;
      }
      n.userData.body.material.emissiveIntensity = 0.3;
      const pos = spokes[i].geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(1, n.position.x, n.position.y, n.position.z);
      pos.needsUpdate = true;
    });
    dustMat.opacity = dustOpacity(p);
    if (!st.reduced) dust.rotation.y += dt * 0.01;
    const b = bloomAt(p);
    bloom.strength = b.strength;
    bloom.threshold = b.threshold;
    bloom.radius = b.radius;
  }

  function uiPhase(p: number) {
    const o = overlayLook(p, st.reduced);
    overlays.grid.style.opacity = o.grid.toFixed(3);
    overlays.vignette.style.opacity = o.vignette.toFixed(3);
    overlays.flash.style.background = o.flashBlack ? "black" : "var(--reactor)";
    overlays.flash.style.opacity = o.flash.toFixed(3);
    // pinned (proof harness) frames are shown at full opacity
    overlays.root.style.opacity = st.hold ? "1" : overlayOpacity(p).toFixed(3);
    overlays.root.style.pointerEvents = st.hold || overlayInteractive(p) ? "auto" : "none";
  }

  function finish() {
    st.mode = "done";
    st.p = 1;
    stopLoop();
    opts.onDone?.();
  }

  function frameStep(dt: number) {
    time += st.reduced ? 0 : dt;
    ptr.sx = lerp(ptr.sx, ptr.x, 1 - Math.exp(-dt * 4));
    ptr.sy = lerp(ptr.sy, ptr.y, 1 - Math.exp(-dt * 4));
    if (st.boot < 1) st.boot = st.reduced ? 1 : clamp(st.boot + dt / BOOT_SECONDS);
    if (st.shake > 0) st.shake = Math.max(0, st.shake - dt / SHAKE_SECONDS);

    let justDone = false;
    if (st.mode === "trans" && st.transition && !st.hold) {
      const r = stepTransition(st.transition, dt);
      st.p = r.p;
      if (r.justLive) {
        st.liveFired = true;
        opts.onLive?.();
      }
      justDone = r.done;
    }
    scenePhase(st.p, dt);
    uiPhase(st.p);
    composer.render(dt);
    if (justDone) finish();
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

  // ---- input: parallax + skip (listeners on window, removed in dispose) ----
  const onSkip = () => {
    if (st.mode === "trans" && st.transition) st.transition.skip = true;
    if (st.boot < 1) st.boot = 1;
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      ptr.x = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.y = (e.clientY / window.innerHeight) * 2 - 1;
    }
  };
  const onResize = () => layout();
  const onKey = () => onSkip();
  window.addEventListener("pointerdown", onSkip, { passive: true });
  window.addEventListener("keydown", onKey);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("resize", onResize);

  const onContextLost = (e: Event) => e.preventDefault();
  canvas.addEventListener("webglcontextlost", onContextLost);

  layout();
  frameStep(0.016); // first frame at once, so the canvas is never blank
  startLoop();

  return {
    layout,
    setPhase(p) {
      st.hold = true;
      st.boot = 1;
      st.p = clamp(p);
      st.mode = "login";
      st.transition = null;
    },
    ignite(variant) {
      if (st.mode !== "login") return;
      const v = variant ?? pickMotionVariant(st.reduced);
      st.hold = false;
      st.mode = "trans";
      st.transition = startTransition(v);
      st.liveFired = false;
      endCam = { ...coreCam };
      startLoop();
    },
    skip: onSkip,
    shake() {
      st.shake = 1;
    },
    setReducedMotion(reduced) {
      st.reduced = reduced;
    },
    setAgentCount(n) {
      buildNodes(Math.max(1, n));
    },
    setManual(m) {
      manual = m;
      if (m) stopLoop();
      else startLoop();
    },
    frame(dt = 0.016) {
      frameStep(dt);
    },
    get phase() {
      return st.p;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopLoop();
      window.removeEventListener("pointerdown", onSkip);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      disposeNodes();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
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
      spokeMat.dispose();
      bloom.dispose();
      output.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
