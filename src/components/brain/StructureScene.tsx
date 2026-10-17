// Mózg 3D — tryb STRUKTURA: tabele bazy jako planety, klucze obce jako
// linie. Ta sama kamera, dotyk i karta co w trybie WIEDZA (sceneKit.tsx).
//
// Planety: proceduralne (PlanetField.tsx) — typ i barwy z nazwy tabeli,
// rozmiar = log(liczby wierszy), poświata atmosfery = kolor modułu.
// W środku słońce (źródło światła), dookoła pole gwiazd (space.tsx).
// Linie: jedna geometria LineSegments; połączenia zaznaczonej tabeli
// rysowane jaśniej osobno.
// Etykiety: wszystkie przy szerokim ekranie, na telefonie tylko zaznaczona
// tabela i jej sąsiedzi + nazwy modułów — inaczej 40 napisów zasłania mapę.

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Billboard, Html, Line, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { SCENE_SCALE } from "@/lib/brain/scene";
import { MIN_ORBIT, MODULES, planetRadius, type ModuleId } from "@/lib/brain/structure";
import type { PlanetLook } from "@/lib/brain/planets";
import { useThemeColors } from "@/lib/theme/themeColor";
import { CameraRig, PointsPicker, TapLayer, ViewShift, type Picker } from "./sceneKit";
import { PlanetField } from "./PlanetField";
import { SpaceBackdrop, Sun } from "./space";

export type StructureNode = {
  name: string;
  module: ModuleId;
  rows: number;
  x: number;
  y: number;
  z: number;
};

const SCENE_COLORS = {
  ...(Object.fromEntries(MODULES.map((m) => [m.id, m.color])) as Record<ModuleId, string>),
  link: "color-mix(in oklab, var(--foreground) 35%, transparent)",
  linkHot: "var(--foreground)",
  selection: "var(--foreground)",
  void: "color-mix(in oklab, var(--base-chrome) 25%, black)",
};
const SCENE_FALLBACKS = {
  wiedza: "#34d399",
  agenci: "#4dd8ff",
  rynki: "#facc15",
  paliwa: "#f87171",
  praca: "#7aa7ff",
  system: "#8b9bb0",
  link: "#3c4654",
  linkHot: "#e6f6ff",
  selection: "#e6f6ff",
  void: "#020409",
};

const scaled = (n: { x: number; y: number; z: number }): [number, number, number] => [
  n.x * SCENE_SCALE,
  n.y * SCENE_SCALE,
  n.z * SCENE_SCALE,
];

export function StructureScene({
  nodes,
  looks,
  edges,
  visibleModules,
  selected,
  highlighted,
  focus,
  onSelect,
  onFocus,
  viewShift,
  allLabels,
}: {
  nodes: StructureNode[];
  /** Wygląd planet (planetLooks), w kolejności `nodes`. */
  looks: PlanetLook[];
  /** Pary indeksów [tabela z kluczem, tabela wskazywana]. */
  edges: [number, number][];
  visibleModules: ReadonlySet<ModuleId>;
  selected: number | null;
  highlighted: ReadonlySet<number>;
  focus: { index: number; nonce: number } | null;
  onSelect: (index: number | null) => void;
  onFocus: (index: number) => void;
  viewShift: number;
  /** Etykiety wszystkich tabel (szeroki ekran) albo tylko wybranej i sąsiadów. */
  allLabels: boolean;
}) {
  const colors = useThemeColors(SCENE_COLORS, SCENE_FALLBACKS);
  const [bloom, setBloom] = useState(true);
  const pickerRef = useRef<Picker | null>(null);

  const points = useMemo(
    () => nodes.map((n) => ({ x: n.x, y: n.y, z: n.z, visible: visibleModules.has(n.module) })),
    [nodes, visibleModules],
  );
  const linked = useMemo(() => {
    if (selected === null) return new Set<number>();
    const s = new Set<number>();
    for (const [a, b] of edges) {
      if (a === selected) s.add(b);
      if (b === selected) s.add(a);
    }
    return s;
  }, [edges, selected]);

  // Nazwy modułów w środku ich tabel — orientacja na telefonie.
  const moduleLabels = useMemo(
    () =>
      MODULES.map((m) => {
        const own = nodes.filter((n) => n.module === m.id && visibleModules.has(n.module));
        if (own.length === 0) return null;
        const c = own.reduce(
          (acc, n) => [
            acc[0] + n.x / own.length,
            acc[1] + n.y / own.length,
            acc[2] + n.z / own.length,
          ],
          [0, 0, 0],
        );
        return { id: m.id, label: m.label, at: scaled({ x: c[0], y: c[1], z: c[2] }) };
      }).filter((m): m is NonNullable<typeof m> => m !== null),
    [nodes, visibleModules],
  );

  return (
    <TapLayer pickerRef={pickerRef} onSelect={onSelect} onFocus={onFocus}>
      <Canvas
        camera={{ position: [0, 2.5, 13], fov: 50, near: 0.05, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <PerformanceMonitor onDecline={() => setBloom(false)} />
        <color attach="background" args={[colors.void]} />
        <fog attach="fog" args={[colors.void, 14, 34]} />
        <SpaceBackdrop />
        <Sun radius={MIN_ORBIT * SCENE_SCALE * 0.38} />

        <PlanetField
          nodes={nodes}
          looks={looks}
          visibleModules={visibleModules}
          highlighted={highlighted}
          rimColors={colors}
        />
        <Links nodes={nodes} edges={edges} visibleModules={visibleModules} color={colors.link} />

        {selected !== null && nodes[selected] && (
          <group>
            <Billboard position={scaled(nodes[selected])}>
              <mesh>
                <ringGeometry
                  args={[
                    // Poza poświatą atmosfery (1,12 × promień).
                    planetRadius(nodes[selected].rows) * 1.18 + 0.04,
                    planetRadius(nodes[selected].rows) * 1.18 + 0.07,
                    48,
                  ]}
                />
                <meshBasicMaterial color={colors.selection} transparent opacity={0.85} />
              </mesh>
            </Billboard>
            {[...linked].map((i) => (
              <Line
                key={i}
                points={[scaled(nodes[selected]), scaled(nodes[i])]}
                color={colors.linkHot}
                lineWidth={2}
                transparent
                opacity={0.85}
              />
            ))}
          </group>
        )}

        {nodes.map((n, i) => {
          if (!visibleModules.has(n.module)) return null;
          const show = allLabels || i === selected || linked.has(i) || highlighted.has(i);
          if (!show) return null;
          const at = scaled(n);
          return (
            <Html
              key={n.name}
              position={[at[0], at[1] + planetRadius(n.rows) + 0.25, at[2]]}
              center
              zIndexRange={[10, 0]}
              style={{ pointerEvents: "none" }}
            >
              <span
                className={
                  "whitespace-nowrap rounded-sm bg-background/60 px-1 py-px font-mono text-[10px] backdrop-blur-sm " +
                  (i === selected ? "text-foreground" : "text-foreground/70")
                }
              >
                {n.name}
              </span>
            </Html>
          );
        })}
        {!allLabels &&
          selected === null &&
          moduleLabels.map((m) => (
            <Html
              key={m.id}
              position={[m.at[0], m.at[1] + 1.1, m.at[2]]}
              center
              zIndexRange={[10, 0]}
              style={{ pointerEvents: "none" }}
            >
              <span className="font-display whitespace-nowrap rounded-sm border border-primary/20 bg-background/60 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-foreground/80 backdrop-blur-sm">
                {m.label}
              </span>
            </Html>
          ))}

        <ViewShift shift={viewShift} />
        <PointsPicker points={points} pickerRef={pickerRef} />
        <CameraRig points={points} focus={focus} autoRotate={selected === null} focusDistance={6} />

        {bloom && (
          <EffectComposer multisampling={0}>
            <Bloom intensity={1.0} luminanceThreshold={0.6} luminanceSmoothing={0.35} mipmapBlur />
          </EffectComposer>
        )}
      </Canvas>
    </TapLayer>
  );
}

function Links({
  nodes,
  edges,
  visibleModules,
  color,
}: {
  nodes: StructureNode[];
  edges: [number, number][];
  visibleModules: ReadonlySet<ModuleId>;
  color: string;
}) {
  const geometry = useMemo(() => {
    const pos: number[] = [];
    for (const [a, b] of edges) {
      const na = nodes[a];
      const nb = nodes[b];
      if (!na || !nb || !visibleModules.has(na.module) || !visibleModules.has(nb.module)) continue;
      pos.push(...scaled(na), ...scaled(nb));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [nodes, edges, visibleModules]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.45} />
    </lineSegments>
  );
}
