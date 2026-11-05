// The dock's menu button: the Arc Core of /jarvis in miniature — the same
// simplex core shader, plasma shell, corona, the three tumbling rings with
// ticks and beads, and the same bloom; only scaled down, without the agents
// and without the floor. Renders on a small canvas of its own over black; the
// canvas is blended with `screen`, so the black disappears into the dock.
//
// Imports three: load ONLY through the dynamic import in DockCore.tsx.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SCALE, buildCore } from "@/components/jarvis/login-scene/reactor";
import { buildCoreExtras } from "@/components/jarvis/login-scene/core2";
import type { SceneColors } from "@/components/jarvis/login-scene/sceneColors";
import { buildCoreRings, stepCoreRings } from "./coreRig";
import { MINI_CORE_FIT, MINI_CORE_FOV, miniCoreDistance } from "./miniCoreMath";

export interface MiniCoreParams {
  /** Ring / core speed multiplier (agents working spin it up). */
  spin: number;
  /** Long-press charge, 0…1: the core grows and blooms brighter. */
  charge: number;
}

export interface MiniCore {
  dispose(): void;
}

export function createMiniCore(
  canvas: HTMLCanvasElement,
  C: SceneColors,
  params: () => MiniCoreParams,
): MiniCore {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(MINI_CORE_FOV, 1, 1, 5000);
  scene.add(new THREE.AmbientLight(C.ambient, 0.5));

  const group = new THREE.Group();
  scene.add(group);
  const core = buildCore(C);
  core.material.uniforms.heat.value = 1;
  core.material.uniforms.op.value = 1;
  group.add(core);
  const rings = buildCoreRings(C, group);
  const extras = buildCoreExtras([], C);
  extras.shell.material.opacity = 0.17;
  extras.floor.visible = false;
  group.add(extras.group);

  // the same view of the core as /jarvis: from the front, a little above
  const dist = miniCoreDistance(MINI_CORE_FIT * SCALE, MINI_CORE_FOV);
  camera.position.set(0, dist * 0.3, dist * 0.954);
  camera.lookAt(0, 0, 0);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(128, 128), 0.62, 0.55, 0.55);
  composer.addPass(bloom);
  const output = new OutputPass();
  composer.addPass(output);

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  let raf = 0;
  let last = performance.now();
  let time = 0;
  let disposed = false;
  const loop = (now: number) => {
    if (disposed) return;
    const p = params();
    const dt = Math.min(0.05, (now - last) / 1000) * p.spin;
    last = now;
    time += dt;
    // exactly the /jarvis core motion (updateCore without the agents)
    core.material.uniforms.t.value = time;
    core.scale.setScalar(1 + Math.sin(time * 1.4) * 0.03);
    core.rotation.y += dt * 0.15;
    extras.shell.rotation.y -= dt * 0.09;
    extras.shell.rotation.x += dt * 0.05;
    extras.corona.scale.setScalar(5.6 * SCALE * (1 + Math.sin(time * 1.4) * 0.03));
    extras.corona.material.opacity = 0.55 * (1 + Math.sin(time * 1.4) * 0.08);
    stepCoreRings(rings, dt, time);
    // long press: the core charges up
    group.scale.setScalar(1 + 0.22 * p.charge);
    bloom.strength = 0.62 + 0.9 * p.charge;
    composer.render(dt);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
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
}
