import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Mesh } from "three";
import { MATRIX_SCALE } from "./matrixScale";

// Slim view over AgentSummary (src/lib/agents/runtime.functions.ts) — only
// the fields this satellite node actually renders, kept decoupled from the
// server type so this file has zero server-fn imports.
export type AgentNodeData = {
  slug: string;
  name: string;
  role: string | null;
  status: string; // idle | busy | error
  isEnabled: boolean;
  currentTask: string | null;
  progress: number;
  timeElapsedSeconds: number;
};

const STATUS_COLOR: Record<string, string> = {
  idle: "#00f0ff",
  busy: "#ffaa00",
  error: "#ff3b3b",
};
const DISABLED_COLOR = "#4b5563";

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function AgentNode3D({
  agent,
  position,
  selected,
  onSelect,
}: {
  agent: AgentNodeData;
  position: [number, number, number];
  selected: boolean;
  onSelect: (slug: string | null) => void;
}) {
  const meshRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const color = agent.isEnabled
    ? (STATUS_COLOR[agent.status] ?? STATUS_COLOR.idle)
    : DISABLED_COLOR;
  const busy = agent.status === "busy";
  const showCard = hovered || selected;

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.x += delta * (busy ? 0.6 : 0.15);
    meshRef.current.rotation.y += delta * (busy ? 0.4 : 0.1);
    const t = state.clock.elapsedTime;
    const targetScale = busy ? 1 + Math.sin(t * 5) * 0.12 : hovered || selected ? 1.18 : 1;
    meshRef.current.scale.setScalar(targetScale);
  });

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(selected ? null : agent.slug);
        }}
      >
        <icosahedronGeometry args={[0.38 * MATRIX_SCALE, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={busy ? 2.6 : 1.4}
          roughness={0.25}
          metalness={0.4}
        />
      </mesh>
      {/* Wireframe shell — reads as a containment lattice around the core gem. */}
      <mesh>
        <icosahedronGeometry args={[0.52 * MATRIX_SCALE, 0]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.22} />
      </mesh>

      <Html
        center
        distanceFactor={8}
        position={[0, -0.78 * MATRIX_SCALE, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          className="whitespace-nowrap text-center font-display text-[10px] uppercase tracking-[0.25em]"
          style={{ color, textShadow: `0 0 8px ${color}` }}
        >
          {agent.name}
        </div>
        <div className="whitespace-nowrap text-center font-display text-[7px] uppercase tracking-[0.2em] text-white/50">
          {agent.role ?? agent.slug}
        </div>
      </Html>

      {showCard && (
        <Html
          center
          distanceFactor={8}
          position={[0, 0.98 * MATRIX_SCALE, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div
            className="w-[190px] rounded-md border bg-black/85 px-3 py-2 backdrop-blur-md"
            style={{ borderColor: `${color}88`, boxShadow: `0 0 20px -4px ${color}` }}
          >
            <p className="font-display text-[9px] uppercase tracking-[0.2em]" style={{ color }}>
              {agent.status === "busy"
                ? "ACTIVE TASK"
                : agent.status === "error"
                  ? "ERROR"
                  : "STANDBY"}
              {!agent.isEnabled && " · DISABLED"}
            </p>
            {agent.currentTask ? (
              <>
                <p className="mt-1 truncate font-mono text-[10px] text-white/90">
                  TASK: {agent.currentTask}
                </p>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{
                      width: `${agent.progress}%`,
                      backgroundColor: color,
                      boxShadow: `0 0 6px ${color}`,
                    }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between font-mono text-[8px] text-white/60">
                  <span>PROGRESS: {agent.progress}%</span>
                  <span>TIME: {formatElapsed(agent.timeElapsedSeconds)}</span>
                </div>
              </>
            ) : (
              <p className="mt-1 font-mono text-[9px] text-white/50">No active task.</p>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}
