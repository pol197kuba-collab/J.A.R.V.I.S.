import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { coreFragment, coreVertex } from "@/components/jarvis/login-scene/coreShader";
import {
  SCENE_COLOR_EXPR,
  SCENE_COLOR_FALLBACKS,
  type SceneColors,
} from "@/components/jarvis/login-scene/sceneColors";
import { useThemeColors } from "@/lib/theme/themeColor";
import {
  CORE_LIGHT_DEMO,
  S,
  U,
  beadAngle,
  corePulse,
  coronaPulse,
  lightToApp,
} from "./arcCoreMath";

// Arc Core v2: the molten sphere of reactor.js (as <shaderMaterial>, NOT
// MeshDistortMaterial), the wireframe plasma shell, the corona sprite, and three
// rings with ticks and travelling beads. Port of docs/jarvis-3d-v2 (reactor.js
// buildCore + core2.js + the ring table of main.js), every length ×0.01.
// Final-frame values (p = 1): everything fully on.

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function coronaTexture(C: SceneColors) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const x = cv.getContext("2d")!;
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, rgba(C.hot, 0.9));
  g.addColorStop(0.25, rgba(C.reactor, 0.45));
  g.addColorStop(0.6, rgba(C.coronaMid, 0.12));
  g.addColorStop(1, rgba(C.coronaEdge, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// [radius ×S, tube ×U, colour key, opacity, rest rotation, spin velocity, tick kind]
const RINGS = [
  {
    r: 1.55,
    tube: 1.1,
    color: "reactor",
    op: 0.75,
    rot: [Math.PI / 2.3, 0, 0],
    v: [0.25, 0, 0],
    tick: [110, 6, 1, 0],
    deco: "hot",
  },
  {
    r: 1.85,
    tube: 0.8,
    color: "primary",
    op: 0.55,
    rot: [Math.PI / 3.1, Math.PI / 5, 0],
    v: [0, 0.18, 0],
    tick: [20, 17, 2.4, 0],
    deco: "primary",
  },
  {
    r: 2.1,
    tube: 0.7,
    color: "reactor",
    op: 0.45,
    rot: [0, Math.PI / 2.4, Math.PI / 6],
    v: [0, 0, 0.32],
    tick: [6, 34, 3.4, Math.PI / 2],
    deco: "reactor",
  },
] as const;

const additive = (color: string, opacity: number) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

function Ring({ i, C }: { i: number; C: SceneColors }) {
  const cfg = RINGS[i];
  const group = useRef<THREE.Mesh>(null);
  const bead = useRef<THREE.Mesh>(null);
  const radius = cfg.r * S;
  const spin = useRef([0, 0, 0]);

  const ticks = useMemo(() => {
    const [n, len, wd, rot] = cfg.tick;
    const geo = new THREE.BoxGeometry(len * U, wd * U, 1.2 * U);
    const mat = additive(C[cfg.deco], 0.85);
    const inst = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const z = new THREE.Vector3(0, 0, 1);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      p.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      q.setFromAxisAngle(z, a + rot);
      m.compose(p, q, one);
      inst.setMatrixAt(k, m);
    }
    return inst;
  }, [cfg, C, radius]);

  useEffect(
    () => () => {
      ticks.geometry.dispose();
      (ticks.material as THREE.Material).dispose();
      ticks.dispose();
    },
    [ticks],
  );

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const sp = spin.current;
    sp[0] += cfg.v[0] * dt;
    sp[1] += cfg.v[1] * dt;
    sp[2] += cfg.v[2] * dt;
    g.rotation.set(cfg.rot[0] + sp[0], cfg.rot[1] + sp[1], cfg.rot[2] + sp[2]);
    const b = bead.current;
    if (b) {
      const a = beadAngle(i, state.clock.elapsedTime);
      b.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    }
  });

  return (
    <mesh ref={group} rotation={[cfg.rot[0], cfg.rot[1], cfg.rot[2]]}>
      <torusGeometry args={[radius, cfg.tube * U, 10, 180]} />
      <meshBasicMaterial
        color={C[cfg.color]}
        transparent
        opacity={cfg.op}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
      <primitive object={ticks} />
      <mesh ref={bead}>
        <sphereGeometry args={[4.4 * U, 16, 12]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </mesh>
  );
}

export function Core3DV2() {
  const C = useThemeColors(SCENE_COLOR_EXPR, SCENE_COLOR_FALLBACKS);
  const core = useRef<THREE.Mesh>(null);
  const shell = useRef<THREE.Mesh>(null);
  const corona = useRef<THREE.Sprite>(null);
  const light = lightToApp(CORE_LIGHT_DEMO);

  const uniforms = useMemo(
    () => ({
      t: { value: 0 },
      heat: { value: 1 },
      op: { value: 1 },
      cold: { value: new THREE.Color(C.primary) },
      amber: { value: new THREE.Color(C.reactor) },
      hot: { value: new THREE.Color(C.hot) },
    }),
    // colours are re-applied below when the theme changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    uniforms.cold.value.set(C.primary);
    uniforms.amber.value.set(C.reactor);
    uniforms.hot.value.set(C.hot);
  }, [uniforms, C.primary, C.reactor, C.hot]);

  const vertexShader = useMemo(() => coreVertex(S), []);
  const tex = useMemo(() => coronaTexture(C), [C]);
  useEffect(() => () => tex.dispose(), [tex]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    uniforms.t.value = t;
    const c = core.current;
    if (c) {
      c.scale.setScalar(corePulse(t));
      c.rotation.y += dt * 0.15;
    }
    const s = shell.current;
    if (s) {
      s.rotation.y -= dt * 0.09;
      s.rotation.x += dt * 0.05;
    }
    const k = corona.current;
    if (k) {
      k.scale.setScalar(5.6 * S * corePulse(t));
      k.material.opacity = 0.55 * coronaPulse(t);
    }
  });

  return (
    <group>
      <pointLight
        color={C.reactor}
        intensity={light.intensity}
        distance={light.distance}
        decay={light.decay}
      />

      <mesh ref={core}>
        <sphereGeometry args={[S, 128, 96]} />
        <shaderMaterial
          transparent
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={coreFragment}
        />
      </mesh>

      {/* plasma shell: wireframe icosahedron (detail 2) */}
      <mesh ref={shell}>
        <icosahedronGeometry args={[1.2 * S, 2]} />
        <meshBasicMaterial
          color={C.hot}
          wireframe
          transparent
          opacity={0.17}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* corona: gradient sprite behind the core, additive, ignores depth */}
      <sprite ref={corona} renderOrder={-1} scale={[5.6 * S, 5.6 * S, 1]}>
        <spriteMaterial
          map={tex}
          transparent
          opacity={0.55}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </sprite>

      {[0, 1, 2].map((i) => (
        <Ring key={i} i={i} C={C} />
      ))}
    </group>
  );
}
