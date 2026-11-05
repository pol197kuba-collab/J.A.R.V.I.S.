import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { AgentNodeData } from "@/components/jarvis/AgentNode3D";
import { orbitAt, orbitSpec, type OrbitSpec } from "@/components/jarvis/login-scene/orbits";
import {
  SCENE_COLOR_EXPR,
  SCENE_COLOR_FALLBACKS,
  type SceneColors,
} from "@/components/jarvis/login-scene/sceneColors";
import { useThemeColors } from "@/lib/theme/themeColor";
import { AgentNode3DV2 } from "./AgentNode3DV2";
import { BloomComposer } from "./BloomComposer";
import { arcCoreLive } from "./arcCoreLive";
import { Core3DV2 } from "./Core3DV2";
import {
  CORE_CLIP,
  CORE_FOG,
  CORE_FOV,
  S,
  U,
  coreCamera,
  nodeStatus,
  orbitLimits,
  packetT,
} from "./arcCoreMath";

// JarvisCanvas v2 — the /jarvis Arc Core. Port of the final frame of
// docs/jarvis-3d-v2 (main.js igniteFrame at p = 1 + core2.js): individual
// agent orbits with thin orbit paths, holographic floor, light packets (fast
// amber for busy agents, slow cyan for the rest), dust, the demo's bloom.
// Units: every demo length ×0.01 (see arcCoreMath.ts). Colours from theme tokens.

const PACKETS_PER_AGENT = 3;

/** 800 dust points drifting around the core (ParticleField of the demo: size 2.4 → .024). */
function Dust({ C }: { C: SceneColors }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(800 * 3);
    for (let i = 0; i < 800; i++) {
      const r = (3 + Math.random() * 5.5) * S;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(ph) * Math.cos(th);
      arr[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.4;
      arr[i * 3 + 2] = r * Math.cos(ph);
    }
    return arr;
  }, []);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.01;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={C.primary}
        size={2.4 * U}
        sizeAttenuation
        transparent
        opacity={0.55}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** Holographic floor: concentric rings (k = 2…5) and 36 spokes under the core. */
function Floor({ C }: { C: SceneColors }) {
  const geo = useMemo(() => {
    const pts: number[] = [];
    [2, 3, 4, 5].forEach((k) => {
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const b = ((i + 1) / 96) * Math.PI * 2;
        pts.push(
          Math.cos(a) * k * S,
          0,
          Math.sin(a) * k * S,
          Math.cos(b) * k * S,
          0,
          Math.sin(b) * k * S,
        );
      }
    });
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      pts.push(
        Math.cos(a) * 1.7 * S,
        0,
        Math.sin(a) * 1.7 * S,
        Math.cos(a) * 5.2 * S,
        0,
        Math.sin(a) * 5.2 * S,
      );
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <lineSegments geometry={geo} position={[0, -1.9 * S, 0]}>
      <lineBasicMaterial
        color={C.primary}
        transparent
        opacity={0.15}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}

/** Each agent's orbit path, faint (one LineSegments for all orbits). */
function OrbitPaths({ specs, C }: { specs: OrbitSpec[]; C: SceneColors }) {
  const geo = useMemo(() => {
    const pts: number[] = [];
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    specs.forEach((s) => {
      for (let k = 0; k < 160; k++) {
        orbitAt(s, (k / 160) * Math.PI * 2, a);
        orbitAt(s, ((k + 1) / 160) * Math.PI * 2, b);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [specs]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial
        color={C.primary}
        transparent
        opacity={0.22}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}

/** Spokes core → agent and the light packets running along them. No allocation per frame. */
function AgentLinks({
  agents,
  positions,
  C,
}: {
  agents: AgentNodeData[];
  positions: THREE.Vector3[];
  C: SceneColors;
}) {
  const n = agents.length;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const spoke = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    return geo;
  }, [n]);
  const packets = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const N = n * PACKETS_PER_AGENT;
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    return geo;
  }, [n]);
  useEffect(
    () => () => {
      spoke.dispose();
      packets.dispose();
    },
    [spoke, packets],
  );

  const col = useMemo(
    () => ({
      spoke: new THREE.Color(),
      cSpoke: new THREE.Color(),
      amber: new THREE.Color(),
      destructive: new THREE.Color(),
      cyan: new THREE.Color(),
      pAmber: new THREE.Color(),
      tmp: new THREE.Color(),
    }),
    [],
  );
  useEffect(() => {
    col.cSpoke.set(C.spoke);
    col.amber.set(C.reactor);
    col.destructive.set(C.destructive);
    col.cyan.set(C.packetCyan);
    col.pAmber.set(C.packetAmber);
  }, [col, C.spoke, C.reactor, C.destructive, C.packetCyan, C.packetAmber]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const sp = spoke.attributes.position as THREE.BufferAttribute;
    const sc = spoke.attributes.color as THREE.BufferAttribute;
    const pp = packets.attributes.position as THREE.BufferAttribute;
    const pc = packets.attributes.color as THREE.BufferAttribute;
    const list = agentsRef.current;
    for (let i = 0; i < n; i++) {
      const p = positions[i];
      const st = nodeStatus(list[i]);
      // spoke: idle = spoke colour @ .4; busy = amber @ .75 (premultiplied: additive blending)
      let c = col.tmp.copy(col.cSpoke);
      let a = 0.4;
      if (st === "busy") {
        c = col.tmp.copy(col.amber);
        a = 0.75;
      } else if (st === "error") {
        c = col.tmp.copy(col.destructive);
        a = 0.6;
      } else if (st === "disabled") {
        a = 0.15;
      }
      sp.setXYZ(i * 2, 0, 0, 0);
      sp.setXYZ(i * 2 + 1, p.x, p.y, p.z);
      sc.setXYZ(i * 2, 0, 0, 0);
      sc.setXYZ(i * 2 + 1, c.r * a, c.g * a, c.b * a);
      const busy = st === "busy";
      const pcol = busy ? col.pAmber : col.cyan;
      for (let k = 0; k < PACKETS_PER_AGENT; k++) {
        const q = packetT(t, busy, k, PACKETS_PER_AGENT, i);
        const idx = i * PACKETS_PER_AGENT + k;
        pp.setXYZ(idx, p.x * q, p.y * q, p.z * q);
        pc.setXYZ(idx, pcol.r, pcol.g, pcol.b);
      }
    }
    sp.needsUpdate = true;
    sc.needsUpdate = true;
    pp.needsUpdate = true;
    pc.needsUpdate = true;
  });

  return (
    <>
      <lineSegments geometry={spoke} frustumCulled={false}>
        <lineBasicMaterial
          vertexColors
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
      <points geometry={packets} frustumCulled={false}>
        <pointsMaterial
          vertexColors
          size={7 * U}
          sizeAttenuation
          transparent
          opacity={1}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  );
}

/** Keeps `core` = the core's screen position in px (labels face away from it). */
function CoreScreenTracker({ core }: { core: React.MutableRefObject<{ x: number; y: number }> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    v.set(0, 0, 0).project(camera);
    core.current.x = (v.x * 0.5 + 0.5) * size.width;
    core.current.y = (-v.y * 0.5 + 0.5) * size.height;
  }, -1);
  return null;
}

/** coreCam of the prototype scaled to the canvas proportions (useThree size). */
function CameraRig() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const mult = useRef(0);
  useLayoutEffect(() => {
    const c = coreCamera(size.width / size.height);
    const m = c.z / (9.8 * S);
    if (!mult.current) camera.position.set(c.x, c.y, c.z);
    else camera.position.multiplyScalar(m / mult.current);
    mult.current = m;
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

/** Publishes the live camera and clock for the module transitions (arcCoreLive). */
function LiveReporter() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    arcCoreLive.active = true;
    return () => {
      arcCoreLive.active = false;
    };
  }, []);
  useFrame((state) => {
    arcCoreLive.cam.x = camera.position.x;
    arcCoreLive.cam.y = camera.position.y;
    arcCoreLive.cam.z = camera.position.z;
    arcCoreLive.time = state.clock.elapsedTime;
    arcCoreLive.stamp = performance.now();
  });
  return null;
}

/** OrbitControls limits proportional to the composition and the canvas proportions. */
function Controls() {
  const size = useThree((s) => s.size);
  const lim = orbitLimits(size.width / size.height);
  return (
    <OrbitControls
      enablePan={false}
      minDistance={lim.min}
      maxDistance={lim.max}
      autoRotate
      autoRotateSpeed={0.35}
      enableDamping
      maxPolarAngle={Math.PI / 1.6}
      minPolarAngle={Math.PI / 4}
    />
  );
}

export function JarvisCanvasV2({ agents }: { agents: AgentNodeData[] }) {
  const C = useThemeColors(SCENE_COLOR_EXPR, SCENE_COLOR_FALLBACKS);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const core = useRef({ x: 0, y: 0 });
  const n = Math.max(agents.length, 1);

  const specs = useMemo(() => Array.from({ length: n }, (_, i) => orbitSpec(i, n, S)), [n]);
  const positions = useMemo(() => Array.from({ length: n }, () => new THREE.Vector3()), [n]);
  // placeholder until CameraRig fits the camera to the real canvas proportions
  const initialCam = coreCamera(2.4);

  return (
    <Canvas
      flat
      camera={{
        position: [initialCam.x, initialCam.y, initialCam.z],
        fov: CORE_FOV,
        near: CORE_CLIP.near,
        far: CORE_CLIP.far,
      }}
      dpr={[1, 1.75]}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      onPointerMissed={() => setSelectedSlug(null)}
    >
      {/* neutral black void + the demo's fog and lights */}
      <color attach="background" args={["#000000"]} />
      <fog attach="fog" args={["#000000", CORE_FOG.near, CORE_FOG.far]} />
      <ambientLight intensity={0.5} color={C.ambient} />
      <directionalLight position={[3, 5, 5]} intensity={1.3} color="#ffffff" />

      <Suspense fallback={null}>
        <Core3DV2 />
        <Floor C={C} />
        <OrbitPaths specs={specs} C={C} />
        <AgentLinks agents={agents} positions={positions} C={C} />
        {agents.map((a, i) => (
          <AgentNode3DV2
            key={a.slug}
            agent={a}
            index={i}
            spec={specs[i]}
            positions={positions}
            core={core}
            selected={selectedSlug === a.slug}
            onSelect={setSelectedSlug}
          />
        ))}
        <Dust C={C} />
      </Suspense>

      <CoreScreenTracker core={core} />
      <CameraRig />
      <LiveReporter />
      <BloomComposer />

      <Controls />
    </Canvas>
  );
}
