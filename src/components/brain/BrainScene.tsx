// Mózg 3D — scena (react-three-fiber).
//
// Wszystkie gwiazdy to JEDNO wywołanie rysowania (THREE.Points z własnym
// shaderem: kolor, rozmiar i przezroczystość per gwiazda), więc tysiące
// punktów chodzą płynnie także na telefonie.
//
// Dotyk (sceneKit.tsx, wspólny z trybem STRUKTURA): obrót jednym palcem,
// zoom i przesuwanie dwoma, tapnięcie wybiera gwiazdę z tolerancją w
// pikselach ekranu, podwójne tapnięcie przybliża. Hovera nie ma — na
// telefonie nie istnieje, więc wszystko dzieje się po tapnięciu.
//
// Wydajność: DPR ≤ 1,5; bloom wyłączany sam, gdy PerformanceMonitor widzi
// spadek klatek (i nie wraca w tej sesji, żeby nie migał).

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, Line, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import type { BrainCluster, BrainStar } from "@/lib/brain/brain.functions";
import type { BrainSourceType } from "@/lib/brain/layout";
import { freshness, SCENE_SCALE } from "@/lib/brain/scene";
import { CameraRig, PointsPicker, TapLayer, ViewShift, type Picker } from "./sceneKit";
import { useThemeColors } from "@/lib/theme/themeColor";
import { SpaceBackdrop } from "./space";

const SCENE_COLORS = {
  memory: "var(--reactor)",
  note: "var(--success)",
  document: "var(--accent)",
  selection: "var(--foreground)",
  link: "color-mix(in oklab, var(--foreground) 55%, transparent)",
  beam: "var(--primary)",
  void: "color-mix(in oklab, var(--base-chrome) 25%, black)",
} as const;
const SCENE_FALLBACKS = {
  memory: "#ffaa00",
  note: "#34d399",
  document: "#7aa7ff",
  selection: "#e6f6ff",
  link: "#7f8a99",
  beam: "#4dd8ff",
  void: "#020409",
};

export type BrainSceneProps = {
  stars: BrainStar[];
  clusters: BrainCluster[];
  visibleTypes: ReadonlySet<BrainSourceType>;
  selected: number | null;
  /** Indeksy wyróżnione (wyniki wyszukiwania); pusta = brak wyróżnienia. */
  highlighted: ReadonlySet<number>;
  /** Sąsiedzi zaznaczonej gwiazdy — rysowani liniami. */
  neighbors: number[];
  /** Zmiana `nonce` = przeleć kamerą do gwiazdy `index`. */
  focus: { index: number; nonce: number } | null;
  onSelect: (index: number | null) => void;
  onFocus: (index: number) => void;
  showClusterLabels: boolean;
  /**
   * Ułamek wysokości, o jaki przesunąć obraz w górę — na telefonie karta
   * zasłania dolną połowę ekranu, więc środek sceny (i przybliżona gwiazda)
   * ma wypaść nad nią, a nie pod nią.
   */
  viewShift: number;
  /** Ślad RAG: indeksy gwiazd, po które sięgnął J.A.R.V.I.S.; `key` restartuje animację. */
  trace: { key: string; indices: number[] } | null;
  /** Oś czasu: gwiazdy powstałe później niż ten moment są ukryte; null = wszystkie. */
  until: number | null;
};

export function BrainScene(props: BrainSceneProps) {
  const colors = useThemeColors(SCENE_COLORS, SCENE_FALLBACKS);
  const [bloom, setBloom] = useState(true);
  const pickerRef = useRef<Picker | null>(null);
  // Punkty do trafiania i przelotu kamery — widoczność jak w Stars.
  const points = useMemo(
    () =>
      props.stars.map((s) => ({
        x: s.x,
        y: s.y,
        z: s.z,
        visible: isVisible(s, props.visibleTypes, props.until),
      })),
    [props.stars, props.visibleTypes, props.until],
  );

  return (
    <TapLayer pickerRef={pickerRef} onSelect={props.onSelect} onFocus={props.onFocus}>
      <Canvas
        camera={{ position: [0, 2.5, 13], fov: 50, near: 0.05, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
      >
        <PerformanceMonitor onDecline={() => setBloom(false)} />
        <color attach="background" args={[colors.void]} />
        <fog attach="fog" args={[colors.void, 14, 34]} />
        {/* Tło przygaszone: gwiazdy-dane muszą być wyraźnie jaśniejsze. */}
        <SpaceBackdrop strength={0.4} />

        <Stars
          stars={props.stars}
          visibleTypes={props.visibleTypes}
          highlighted={props.highlighted}
          until={props.until}
          colors={colors}
        />
        {props.trace && (
          <TraceBeams
            key={props.trace.key}
            stars={props.stars}
            indices={props.trace.indices}
            color={colors.beam}
          />
        )}
        <Selection
          stars={props.stars}
          selected={props.selected}
          neighbors={props.neighbors}
          color={colors.selection}
          linkColor={colors.link}
        />
        {props.showClusterLabels &&
          props.clusters.map((c) => (
            <Html
              key={c.id}
              position={[c.x * SCENE_SCALE, c.y * SCENE_SCALE + 0.6, c.z * SCENE_SCALE]}
              center
              zIndexRange={[10, 0]}
              style={{ pointerEvents: "none" }}
            >
              <span className="font-display whitespace-nowrap rounded-sm border border-primary/20 bg-background/60 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-foreground/80 backdrop-blur-sm @max-[480px]:text-[9px]">
                {c.name}
              </span>
            </Html>
          ))}

        <ViewShift shift={props.viewShift} />
        <PointsPicker points={points} pickerRef={pickerRef} />
        <CameraRig points={points} focus={props.focus} autoRotate={props.selected === null} />

        {bloom && (
          <EffectComposer multisampling={0}>
            <Bloom intensity={1.1} luminanceThreshold={0.15} luminanceSmoothing={0.9} mipmapBlur />
          </EffectComposer>
        )}
      </Canvas>
    </TapLayer>
  );
}

// ---------- gwiazdy ----------

/** Widoczna = typ włączony w legendzie i (przy osi czasu) już istniała. */
function isVisible(
  s: BrainStar,
  visibleTypes: ReadonlySet<BrainSourceType>,
  until: number | null,
): boolean {
  if (!visibleTypes.has(s.type)) return false;
  return until === null || Date.parse(s.createdAt) <= until;
}

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uPixelRatio;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Rozmiar maleje z odległością, ale nie poniżej 2 px — daleka gwiazda
    // ma zostać widoczna, a nie zniknąć.
    gl_PointSize = max(2.0 * uPixelRatio, aSize * uPixelRatio * (60.0 / -mv.z));
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    // Jasne jądro + miękka poświata.
    float core = smoothstep(0.22, 0.0, d);
    float glow = smoothstep(0.5, 0.1, d) * 0.55;
    gl_FragColor = vec4(vColor, (core + glow) * vAlpha);
  }
`;

function Stars({
  stars,
  visibleTypes,
  highlighted,
  until,
  colors,
}: {
  stars: BrainStar[];
  visibleTypes: ReadonlySet<BrainSourceType>;
  highlighted: ReadonlySet<number>;
  until: number | null;
  colors: Record<keyof typeof SCENE_COLORS, string>;
}) {
  const { gl } = useThree();

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(stars.length * 3);
    stars.forEach((s, i) => {
      pos[i * 3] = s.x * SCENE_SCALE;
      pos[i * 3 + 1] = s.y * SCENE_SCALE;
      pos[i * 3 + 2] = s.z * SCENE_SCALE;
    });
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(stars.length * 3), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(stars.length), 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(stars.length), 1));
    g.computeBoundingSphere();
    return g;
  }, [stars]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // Kolor, rozmiar i widoczność — osobno od pozycji, żeby filtr albo
  // wyszukiwanie nie przebudowywały geometrii.
  useEffect(() => {
    const col = geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const size = geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const alpha = geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const byType: Record<BrainSourceType, THREE.Color> = {
      memory: new THREE.Color(colors.memory),
      note: new THREE.Color(colors.note),
      document: new THREE.Color(colors.document),
    };
    const now = new Date();
    const searching = highlighted.size > 0;
    stars.forEach((s, i) => {
      const visible = isVisible(s, visibleTypes, until);
      const lit = !searching || highlighted.has(i);
      const f = freshness(s.createdAt, now);
      const c = byType[s.type];
      col.setXYZ(i, c.r * (0.55 + 0.45 * f), c.g * (0.55 + 0.45 * f), c.b * (0.55 + 0.45 * f));
      const base = s.type === "document" ? 1.35 : 0.8 + s.weight * 0.12;
      size.setX(i, visible ? base * (searching && lit ? 2 : 1) : 0);
      alpha.setX(i, visible ? (lit ? 0.95 : 0.12) : 0);
    });
    col.needsUpdate = true;
    size.needsUpdate = true;
    alpha.needsUpdate = true;
  }, [geometry, stars, visibleTypes, highlighted, until, colors]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uPixelRatio: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

// ---------- zaznaczenie i sąsiedzi ----------

function Selection({
  stars,
  selected,
  neighbors,
  color,
  linkColor,
}: {
  stars: BrainStar[];
  selected: number | null;
  neighbors: number[];
  color: string;
  linkColor: string;
}) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.12);
  });
  const s = selected === null ? null : stars[selected];
  if (!s) return null;
  const at = (i: number): [number, number, number] => {
    const t = stars[i];
    return [t.x * SCENE_SCALE, t.y * SCENE_SCALE, t.z * SCENE_SCALE];
  };
  const origin = at(selected!);
  return (
    <group>
      <Billboard position={origin}>
        <mesh ref={ring}>
          <ringGeometry args={[0.075, 0.09, 40]} />
          <meshBasicMaterial color={color} transparent opacity={0.75} depthWrite={false} />
        </mesh>
      </Billboard>
      {neighbors.map((n) => (
        <Line
          key={n}
          points={[origin, at(n)]}
          color={linkColor}
          lineWidth={1}
          transparent
          opacity={0.35}
        />
      ))}
    </group>
  );
}

// ---------- ślad RAG ----------

/** Czas, w którym promienie „wyrastają” z rdzenia do gwiazd. */
const BEAM_GROW_S = 0.9;

/**
 * Rdzeń w środku galaktyki i promienie do gwiazd, po które sięgnął
 * J.A.R.V.I.S. Promienie startują w rdzeniu (0,0,0), więc skalowanie całej
 * grupy od 0 do 1 „wypuszcza” je na zewnątrz bez przeliczania geometrii.
 */
function TraceBeams({
  stars,
  indices,
  color,
}: {
  stars: BrainStar[];
  indices: number[];
  color: string;
}) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const born = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (born.current === null) born.current = clock.elapsedTime;
    const k = Math.min(1, (clock.elapsedTime - born.current) / BEAM_GROW_S);
    const eased = 1 - (1 - k) ** 3;
    group.current?.scale.setScalar(Math.max(0.001, eased));
    core.current?.scale.setScalar(1 + Math.sin(clock.elapsedTime * 4) * 0.15);
  });
  const targets = indices
    .map((i) => stars[i])
    .filter(Boolean)
    .map(
      (s) => [s.x * SCENE_SCALE, s.y * SCENE_SCALE, s.z * SCENE_SCALE] as [number, number, number],
    );
  return (
    <group>
      <mesh ref={core}>
        <sphereGeometry args={[0.12, 20, 20]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      <group ref={group}>
        {targets.map((t, i) => (
          <Line
            key={i}
            points={[[0, 0, 0], t]}
            color={color}
            lineWidth={1.5}
            transparent
            opacity={0.7}
          />
        ))}
      </group>
    </group>
  );
}
