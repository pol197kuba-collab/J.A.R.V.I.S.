import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { AgentNodeData } from "@/components/jarvis/AgentNode3D";
import { labelPlacement } from "@/components/jarvis/login-scene/loginSceneMath";
import { orbitAngle, orbitAt, type OrbitSpec } from "@/components/jarvis/login-scene/orbits";
import {
  SCENE_COLOR_EXPR,
  SCENE_COLOR_FALLBACKS,
} from "@/components/jarvis/login-scene/sceneColors";
import { useThemeColors } from "@/lib/theme/themeColor";
import { NARROW_LABEL_DROP, NARROW_PX, S, nodeStatus, statusLine } from "./arcCoreMath";

// Agent node v2: smaller gem (0.8 of the old size) orbiting the core on its own
// orbit, status colours from theme tokens, a pulse while busy, and a label BESIDE
// the node on the side facing away from the core (name, role, status line) so it
// never covers the node or the core. Hover, selection, detail card and onSelect
// are kept from the legacy node. Port of docs/jarvis-3d-v2 (reactor.js buildNode
// + the igniteFrame node block + placeLabels), every length ×0.01.

// Status colours: idle = primary, busy = reactor, error = destructive, disabled as before.
const NODE_COLORS = {
  idle: "var(--primary)",
  busy: "var(--reactor)",
  error: "var(--destructive)",
  disabled: "color-mix(in oklab, var(--muted-foreground) 45%, var(--background))",
} as const;
const NODE_FALLBACKS = { idle: "#00e6f9", busy: "#ffad00", error: "#ff4c4d", disabled: "#4b5563" };

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** One agent label, as the node reports it each frame (screen px, before shifts). */
export type LabelSlot = {
  el: HTMLDivElement;
  /** Offset from the node's screen position (what the transform applies). */
  ox: number;
  oy: number;
  /** Anchor point relative to the canvas: label's side edge / centre, vertical middle. */
  x: number;
  y: number;
  ax: "0%" | "-100%" | "-50%";
  align: "left" | "right" | "center";
  depth: number;
  /** Smoothed collision shift and opacity (LabelResolver). */
  dy: number;
  alpha: number;
  style: string;
};

export function AgentNode3DV2({
  agent,
  index,
  spec,
  positions,
  core,
  labels,
  selected,
  onSelect,
}: {
  agent: AgentNodeData;
  index: number;
  spec: OrbitSpec;
  /** Shared world positions (read by spokes and light packets). */
  positions: THREE.Vector3[];
  /** Core's screen position in px, refreshed every frame by the canvas. */
  core: MutableRefObject<{ x: number; y: number }>;
  /** Shared label slots: the canvas' LabelResolver places all labels together. */
  labels: MutableRefObject<Map<string, LabelSlot>>;
  selected: boolean;
  onSelect: (slug: string | null) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  const label = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const C = useThemeColors(SCENE_COLOR_EXPR, SCENE_COLOR_FALLBACKS);
  const N = useThemeColors(NODE_COLORS, NODE_FALLBACKS);
  const status = nodeStatus(agent);
  const busy = status === "busy";
  const color = N[status];
  const wire = status === "idle" ? C.nodeWire : status === "busy" ? C.nodeWireAmber : color;
  const showCard = hovered || selected;

  const geo = useMemo(() => new THREE.IcosahedronGeometry(0.38 * S, 0), []);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);
  useEffect(
    () => () => {
      geo.dispose();
      edges.dispose();
    },
    [geo, edges],
  );

  // The server writes timeElapsedSeconds only when a run finishes; busySince is a
  // stable start timestamp, so tick against it locally for a live counter.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy || !agent.busySince) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy, agent.busySince]);
  const liveElapsed =
    busy && agent.busySince
      ? Math.max(0, Math.round((now - new Date(agent.busySince).getTime()) / 1000))
      : agent.timeElapsedSeconds;

  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new THREE.Vector3(), []);

  // the label's slot is ours; drop it when the node goes away
  useEffect(() => {
    const map = labels.current;
    return () => {
      map.delete(agent.slug);
    };
  }, [labels, agent.slug]);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    orbitAt(spec, orbitAngle(spec, t), positions[index]);
    g.position.copy(positions[index]);
    const b = body.current;
    if (b) {
      b.rotation.x += dt * (busy ? 0.5 : 0.15);
      b.rotation.y += dt * (busy ? 0.35 : 0.1);
      const base =
        0.8 * (busy ? 1 + Math.sin(t * 5 + index) * 0.07 : hovered || selected ? 1.18 : 1);
      b.scale.setScalar(base);
    }
    // label beside the node, facing away from the core (screen space); the
    // canvas' LabelResolver moves it off other labels and writes the style
    const el = label.current;
    if (el) {
      v.copy(positions[index]).project(camera);
      const sx = (v.x * 0.5 + 0.5) * size.width;
      const sy = (-v.y * 0.5 + 0.5) * size.height;
      const narrow = size.width < NARROW_PX;
      const p = labelPlacement(sx - core.current.x, sy - core.current.y, narrow);
      const slot = labels.current.get(agent.slug);
      const oy = p.oy + (narrow ? NARROW_LABEL_DROP : 0);
      const next = {
        el,
        ox: p.ox,
        oy,
        x: sx + p.ox,
        y: sy + oy,
        ax: p.ax,
        align: p.align,
        depth: v.z,
      };
      if (slot) Object.assign(slot, next);
      else labels.current.set(agent.slug, { ...next, dy: 0, alpha: 1, style: "" });
    }
  });

  return (
    <group ref={group}>
      <mesh
        ref={body}
        geometry={geo}
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
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={busy ? 0.8 : 0.3}
          metalness={0.4}
          roughness={0.35}
          flatShading
          transparent
          opacity={0.55}
        />
        <lineSegments geometry={edges}>
          <lineBasicMaterial
            color={wire}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
      </mesh>

      <Html style={{ pointerEvents: "none" }} zIndexRange={[5, 0]}>
        <div
          ref={label}
          className="absolute left-0 top-0 whitespace-nowrap text-center"
          style={{ transform: "translate(-50%,-50%)" }}
        >
          <div className="font-display text-[13px] leading-[1.3] tracking-[0.2em] text-foreground">
            {agent.name}
          </div>
          <div className="font-display text-[10px] uppercase leading-[1.4] tracking-[0.18em] text-muted-foreground max-[760px]:hidden">
            {agent.role ?? agent.slug}
          </div>
          <div
            className="font-display mt-0.5 text-[9.5px] leading-[1.4] tracking-[0.16em]"
            style={{ color: busy ? "var(--reactor-hot)" : "var(--muted-foreground)" }}
          >
            {statusLine(status, liveElapsed)}
          </div>
        </div>
      </Html>

      {showCard && (
        <Html
          center
          distanceFactor={8}
          position={[0, 0.98 * S, 0]}
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
                  <span>TIME: {formatElapsed(liveElapsed)}</span>
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
