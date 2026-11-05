import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector2 } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {
  QUALITY_WINDOW,
  SLOW_FRAME_S,
  qualityVerdict,
} from "@/components/jarvis/login-scene/loginSceneMath";
import { CORE_BLOOM } from "./arcCoreMath";

/**
 * The demo's exact post-processing inside R3F: RenderPass → UnrealBloomPass →
 * OutputPass (NoToneMapping; the Canvas is `flat`). This replaces the old
 * @react-three/postprocessing Bloom (intensity 1.5 / threshold .2), whose
 * different algorithm and settings burnt the core into a flat yellow ball.
 * Rendering takes over the frame loop (useFrame priority 1).
 *
 * The one allowed quality knob: after 120 frames with more than half slower
 * than 34 ms the pixel ratio drops to min(devicePixelRatio, 1.25).
 */
export function BloomComposer() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const setDpr = useThree((s) => s.setDpr);

  const fx = useMemo(() => {
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new Vector2(256, 256),
      CORE_BLOOM.strength,
      CORE_BLOOM.radius,
      CORE_BLOOM.threshold,
    );
    composer.addPass(bloom);
    const output = new OutputPass();
    composer.addPass(output);
    return { composer, bloom, output };
  }, [gl, scene, camera]);

  useEffect(() => {
    fx.composer.setPixelRatio(dpr);
    fx.composer.setSize(size.width, size.height);
  }, [fx, size.width, size.height, dpr]);

  useEffect(
    () => () => {
      fx.bloom.dispose();
      fx.output.dispose();
      fx.composer.dispose();
    },
    [fx],
  );

  const q = useRef({ frames: 0, slow: 0, done: false });
  useFrame((_, dt) => {
    const s = q.current;
    if (!s.done) {
      s.frames++;
      if (dt > SLOW_FRAME_S) s.slow++;
      if (s.frames === QUALITY_WINDOW) {
        s.done = true;
        const next = qualityVerdict(s.frames, s.slow, dpr, window.devicePixelRatio);
        if (next !== null) setDpr(next);
      }
    }
    fx.composer.render(Math.min(dt, 0.05));
  }, 1);

  return null;
}
