import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshDistortMaterial } from "@react-three/drei";
import type { Mesh, PointLight } from "three";

// Central J.A.R.V.I.S. reactor core — a molten, distorting sphere (drei's
// MeshDistortMaterial extends MeshPhysicalMaterial, so emissive/roughness/
// metalness all apply on top of the animated surface noise) wrapped in
// three independently-tumbling rings, Stark-reactor style.
const CORE_BASE_COLOR = "#3a1400";
const CORE_EMISSIVE = "#ffaa00";
const RING_ACCENT = "#00f0ff";

export function Core3D({ pulse = 0 }: { pulse?: number }) {
  const coreRef = useRef<Mesh>(null);
  const ringA = useRef<Mesh>(null);
  const ringB = useRef<Mesh>(null);
  const ringC = useRef<Mesh>(null);
  const lightRef = useRef<PointLight>(null);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (coreRef.current) {
      const breathe = 1 + Math.sin(t * 1.4) * 0.03 + pulse * 0.06;
      coreRef.current.scale.setScalar(breathe);
      coreRef.current.rotation.y += delta * 0.15;
    }
    if (ringA.current) ringA.current.rotation.x += delta * 0.25;
    if (ringB.current) ringB.current.rotation.y += delta * 0.18;
    if (ringC.current) ringC.current.rotation.z += delta * 0.32;
    if (lightRef.current) {
      lightRef.current.intensity = 6 + Math.sin(t * 2) * 1.2 + pulse * 3;
    }
  });

  return (
    <group>
      <pointLight ref={lightRef} color={CORE_EMISSIVE} intensity={6} distance={14} decay={2} />

      <mesh ref={coreRef}>
        <sphereGeometry args={[1, 96, 96]} />
        <MeshDistortMaterial
          color={CORE_BASE_COLOR}
          emissive={CORE_EMISSIVE}
          emissiveIntensity={3}
          roughness={0.15}
          metalness={0.7}
          distort={0.35}
          speed={1.6}
        />
      </mesh>

      <mesh ref={ringA} rotation={[Math.PI / 2.3, 0, 0]}>
        <torusGeometry args={[1.55, 0.012, 8, 128]} />
        <meshBasicMaterial color={CORE_EMISSIVE} transparent opacity={0.55} />
      </mesh>
      <mesh ref={ringB} rotation={[Math.PI / 3.1, Math.PI / 5, 0]}>
        <torusGeometry args={[1.85, 0.008, 8, 128]} />
        <meshBasicMaterial color={RING_ACCENT} transparent opacity={0.4} />
      </mesh>
      <mesh ref={ringC} rotation={[0, Math.PI / 2.4, Math.PI / 6]}>
        <torusGeometry args={[2.1, 0.006, 8, 128]} />
        <meshBasicMaterial color={CORE_EMISSIVE} transparent opacity={0.3} />
      </mesh>
    </group>
  );
}
