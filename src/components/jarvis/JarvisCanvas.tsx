import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Line, OrbitControls, Points, PointMaterial } from "@react-three/drei";
import { Core3D } from "./Core3D";
import { AgentNode3D, type AgentNodeData } from "./AgentNode3D";
import { MATRIX_SCALE as SCALE } from "./matrixScale";

const PARTICLE_COLOR = "#4dd8ff";

// Soft dust field drifting around the core — @react-three/drei's <Points>
// batches every particle into a single draw call, so this stays cheap even
// with a few hundred points.
function ParticleField({ count = 500 }: { count?: number }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = (3 + Math.random() * 5.5) * SCALE;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.4;
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [count]);

  return (
    <Points positions={positions} stride={3} frustumCulled>
      <PointMaterial
        transparent
        color={PARTICLE_COLOR}
        size={0.018}
        sizeAttenuation
        depthWrite={false}
        opacity={0.5}
      />
    </Points>
  );
}

// Neon spokes from the core to every satellite — brighter/gold while that
// agent is actively working a task, dim cyan at idle.
function ConnectionLines({
  nodes,
}: {
  nodes: Array<{
    slug: string;
    position: [number, number, number];
    status: string;
    isEnabled: boolean;
  }>;
}) {
  return (
    <>
      {nodes.map((n) => {
        const active = n.isEnabled && n.status === "busy";
        return (
          <Line
            key={n.slug}
            points={[[0, 0, 0], n.position]}
            color={active ? "#ffaa00" : "#0891b2"}
            transparent
            opacity={active ? 0.85 : n.isEnabled ? 0.28 : 0.12}
            lineWidth={active ? 1.6 : 0.8}
          />
        );
      })}
    </>
  );
}

export function JarvisCanvas({ agents }: { agents: AgentNodeData[] }) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const positioned = useMemo(() => {
    const n = Math.max(agents.length, 1);
    const radius = (n <= 4 ? 2.6 : n <= 6 ? 3.0 : 3.4) * SCALE;
    return agents.map((a, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const y = (i % 2 === 0 ? 1 : -1) * 0.35 * SCALE;
      const position: [number, number, number] = [
        Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius,
      ];
      return { ...a, position };
    });
  }, [agents]);

  const anyBusy = positioned.some((a) => a.isEnabled && a.status === "busy");

  return (
    <Canvas
      camera={{ position: [0, 2.2 * SCALE, 8.5 * SCALE], fov: 45 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onPointerMissed={() => setSelectedSlug(null)}
    >
      <color attach="background" args={["#020409"]} />
      <fog attach="fog" args={["#020409", 8 * SCALE, 20 * SCALE]} />
      <ambientLight intensity={0.25} color="#4dd8ff" />
      <directionalLight position={[5, 8, 5]} intensity={0.4} color="#ffffff" />

      <Suspense fallback={null}>
        <Core3D pulse={anyBusy ? 1 : 0} />
        <ConnectionLines nodes={positioned} />
        {positioned.map((a) => (
          <AgentNode3D
            key={a.slug}
            agent={a}
            position={a.position}
            selected={selectedSlug === a.slug}
            onSelect={setSelectedSlug}
          />
        ))}
        <ParticleField />
      </Suspense>

      <EffectComposer multisampling={0}>
        <Bloom intensity={1.5} luminanceThreshold={0.2} luminanceSmoothing={0.9} mipmapBlur />
      </EffectComposer>

      <OrbitControls
        enablePan={false}
        minDistance={5 * SCALE}
        maxDistance={14 * SCALE}
        autoRotate
        autoRotateSpeed={0.35}
        maxPolarAngle={Math.PI / 1.6}
        minPolarAngle={Math.PI / 4}
      />
    </Canvas>
  );
}
