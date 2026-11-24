// Mózg 3D — scena (react-three-fiber): sieć wspomnień.
//
// Wygląd jak w scenie logowania: każda gwiazda to fasetowany kryształ
// (dwuścian jak węzły agentów — przezroczyste wnętrze, świecące krawędzie)
// z miękką poświatą, sąsiedzi połączeni liniami światła, po których płyną
// pakiety, a pod chmurą holograficzna podłoga z pierścieni i szprych.
// Kryształy, linie i pakiety to po jednym wywołaniu rysowania (instancje /
// wspólne bufory), więc skala tysięcy gwiazd zostaje.
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
import { freshness, networkEdges, SCENE_SCALE } from "@/lib/brain/scene";
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

        <Floor stars={props.stars} color={colors.beam} />
        <Network points={points} color={colors.beam} />
        <Crystals
          stars={props.stars}
          visibleTypes={props.visibleTypes}
          highlighted={props.highlighted}
          until={props.until}
          colors={colors}
        />
        <Stars
          stars={props.stars}
          visibleTypes={props.visibleTypes}
          highlighted={props.highlighted}
          until={props.until}
          colors={colors}
        />
        <NodeLabels
          stars={props.stars}
          points={points}
          highlighted={props.highlighted}
          selected={props.selected}
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
              <span className="brain-cluster-label font-display whitespace-nowrap text-[10px] uppercase tracking-[0.3em] text-primary @max-[480px]:text-[9px]">
                {c.name}
              </span>
            </Html>
          ))}

        <ViewShift shift={props.viewShift} />
        <PointsPicker points={points} pickerRef={pickerRef} />
        <CameraRig points={points} focus={props.focus} autoRotate={props.selected === null} />

        {bloom && (
          <EffectComposer multisampling={0}>
            <Bloom intensity={0.75} luminanceThreshold={0.22} luminanceSmoothing={0.6} mipmapBlur />
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
      // Poświata pod kryształem — sam kształt niesie kryształ, więc mniejsza
      // i bledsza niż dawniej (nie rozlewa się w plamę).
      const base = (s.type === "document" ? 1.35 : 0.8 + s.weight * 0.12) * 0.8;
      size.setX(i, visible ? base * (searching && lit ? 1.6 : 1) : 0);
      alpha.setX(i, visible ? (lit ? 0.55 : 0.08) : 0);
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

// ---------- kryształy ----------

/** Promień kryształu w jednostkach sceny. */
function crystalRadius(s: BrainStar): number {
  return s.type === "document" ? 0.3 : 0.2 + Math.min(4, s.weight) * 0.02;
}

/** Do tylu gwiazd kryształy obracają się w każdej klatce; większa baza stoi. */
const SPIN_MAX = 800;

/**
 * Fasetowane kryształy (dwudziestościan, jak węzły agentów): wnętrze
 * półprzezroczyste w kolorze typu, krawędzie jaśniejsze. Dwie instancje
 * tej samej geometrii (wypełnienie + siatka) dzielą macierze.
 */
function Crystals({
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
  const fill = useRef<THREE.InstancedMesh>(null);
  const wire = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const fillMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const wireMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        wireframe: true,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(
    () => () => {
      geo.dispose();
      fillMat.dispose();
      wireMat.dispose();
    },
    [geo, fillMat, wireMat],
  );

  // Skala 0 = ukryty (filtr typu / oś czasu).
  const scales = useMemo(() => {
    const searching = highlighted.size > 0;
    return stars.map((s, i) =>
      isVisible(s, visibleTypes, until)
        ? crystalRadius(s) * (searching && highlighted.has(i) ? 1.5 : 1)
        : 0,
    );
  }, [stars, visibleTypes, until, highlighted]);

  // Kolory: wnętrze w kolorze typu (jaśniejsze = świeższe), krawędzie
  // rozjaśnione w stronę bieli; przy wyszukiwaniu reszta przygasa.
  useEffect(() => {
    const f = fill.current;
    const w = wire.current;
    if (!f || !w) return;
    const byType: Record<BrainSourceType, THREE.Color> = {
      memory: new THREE.Color(colors.memory),
      note: new THREE.Color(colors.note),
      document: new THREE.Color(colors.document),
    };
    const white = new THREE.Color(colors.selection);
    const now = new Date();
    const searching = highlighted.size > 0;
    const c = new THREE.Color();
    stars.forEach((s, i) => {
      const dim = searching && !highlighted.has(i) ? 0.2 : 1;
      const fr = 0.6 + 0.4 * freshness(s.createdAt, now);
      c.copy(byType[s.type]).multiplyScalar(fr * dim);
      f.setColorAt(i, c);
      c.copy(byType[s.type]).lerp(white, 0.2).multiplyScalar(dim);
      w.setColorAt(i, c);
    });
    if (f.instanceColor) f.instanceColor.needsUpdate = true;
    if (w.instanceColor) w.instanceColor.needsUpdate = true;
  }, [stars, highlighted, colors]);

  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);
  const spin = stars.length <= SPIN_MAX;
  const write = (t: number) => {
    const f = fill.current;
    const w = wire.current;
    if (!f || !w) return;
    stars.forEach((s, i) => {
      // każdy kryształ ma własną fazę i tempo, z indeksu — stabilnie
      e.set(t * (0.18 + (i % 5) * 0.03) + i, t * (0.12 + (i % 3) * 0.04) + i * 0.7, 0);
      q.setFromEuler(e);
      pos.set(s.x * SCENE_SCALE, s.y * SCENE_SCALE, s.z * SCENE_SCALE);
      scl.setScalar(Math.max(1e-4, scales[i]));
      m.compose(pos, q, scl);
      f.setMatrixAt(i, m);
      w.setMatrixAt(i, m);
    });
    f.instanceMatrix.needsUpdate = true;
    w.instanceMatrix.needsUpdate = true;
  };
  useEffect(() => write(0));
  useFrame(({ clock }) => {
    if (spin) write(clock.elapsedTime);
  });

  return (
    <group>
      <instancedMesh
        ref={fill}
        args={[geo, fillMat, stars.length]}
        frustumCulled={false}
        key={`f-${stars.length}`}
      />
      <instancedMesh
        ref={wire}
        args={[geo, wireMat, stars.length]}
        frustumCulled={false}
        key={`w-${stars.length}`}
      />
    </group>
  );
}

// ---------- sieć: linie światła i pakiety ----------

/** Ile pakietów płynie naraz po liniach sieci. */
const PACKETS = 36;

function Network({ points, color }: { points: ScenePointV[]; color: string }) {
  const edges = useMemo(() => networkEdges(points, 2), [points]);
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(edges.length * 6);
    edges.forEach(([a, b], k) => {
      const p = points[a];
      const r = points[b];
      arr.set(
        [
          p.x * SCENE_SCALE,
          p.y * SCENE_SCALE,
          p.z * SCENE_SCALE,
          r.x * SCENE_SCALE,
          r.y * SCENE_SCALE,
          r.z * SCENE_SCALE,
        ],
        k * 6,
      );
    });
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, [edges, points]);
  const packetGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(Math.min(PACKETS, edges.length) * 3), 3),
    );
    return g;
  }, [edges.length]);
  useEffect(() => () => lineGeo.dispose(), [lineGeo]);
  useEffect(() => () => packetGeo.dispose(), [packetGeo]);

  useFrame(({ clock }) => {
    const n = Math.min(PACKETS, edges.length);
    if (n === 0) return;
    const attr = packetGeo.getAttribute("position") as THREE.BufferAttribute;
    const t = clock.elapsedTime;
    for (let k = 0; k < n; k++) {
      // pakiet k jeździ po krawędzi wybranej ze stałym krokiem, tam i z powrotem
      const edge = edges[(k * 7919) % edges.length];
      const p = points[edge[0]];
      const r = points[edge[1]];
      const phase = (t * (0.25 + (k % 4) * 0.06) + k * 0.37) % 2;
      const u = phase < 1 ? phase : 2 - phase;
      attr.setXYZ(
        k,
        (p.x + (r.x - p.x) * u) * SCENE_SCALE,
        (p.y + (r.y - p.y) * u) * SCENE_SCALE,
        (p.z + (r.z - p.z) * u) * SCENE_SCALE,
      );
    }
    attr.needsUpdate = true;
  });

  if (edges.length === 0) return null;
  return (
    <group>
      <lineSegments geometry={lineGeo}>
        <lineBasicMaterial
          color={color}
          transparent
          opacity={0.32}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
      <points geometry={packetGeo} frustumCulled={false}>
        <pointsMaterial
          color={color}
          size={0.07}
          sizeAttenuation
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

type ScenePointV = { x: number; y: number; z: number; visible: boolean };

// ---------- podłoga ----------

/**
 * Holograficzna podłoga pod chmurą, jak w scenie logowania: pierścienie i
 * szprychy, promień dopasowany do rozpiętości chmury.
 */
function Floor({ stars, color }: { stars: BrainStar[]; color: string }) {
  const { geo, y } = useMemo(() => {
    let minY = 0;
    let reach = 1;
    for (const s of stars) {
      minY = Math.min(minY, s.y * SCENE_SCALE);
      reach = Math.max(reach, Math.hypot(s.x, s.z) * SCENE_SCALE);
    }
    const R = reach * 1.25 + 0.8;
    const pts: number[] = [];
    const SEG = 128;
    [0.35, 0.6, 0.8, 1].forEach((f) => {
      for (let i = 0; i < SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const b = ((i + 1) / SEG) * Math.PI * 2;
        pts.push(
          Math.cos(a) * R * f,
          0,
          Math.sin(a) * R * f,
          Math.cos(b) * R * f,
          0,
          Math.sin(b) * R * f,
        );
      }
    });
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      pts.push(
        Math.cos(a) * R * 0.3,
        0,
        Math.sin(a) * R * 0.3,
        Math.cos(a) * R * 1.04,
        0,
        Math.sin(a) * R * 1.04,
      );
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return { geo: g, y: minY - 1.2 };
  }, [stars]);
  useEffect(() => () => geo.dispose(), [geo]);
  const ref = useRef<THREE.LineSegments>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.02;
  });
  return (
    <lineSegments ref={ref} geometry={geo} position={[0, y, 0]}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={0.1}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}

// ---------- podpisy ----------

/** Do tylu widocznych gwiazd podpisujemy wszystkie; więcej — tylko wyróżnione. */
const LABEL_ALL_MAX = 14;
const LABEL_MAX = 20;

/**
 * Ostre podpisy obok kryształów (tekst w HTML, nie w rozmytej poświacie):
 * przy małej bazie wszystkie, przy dużej tylko zaznaczona i wyniki
 * wyszukiwania. Zawsze z prawej strony kryształu, przyklejone do niego.
 */
function NodeLabels({
  stars,
  points,
  highlighted,
  selected,
}: {
  stars: BrainStar[];
  points: ScenePointV[];
  highlighted: ReadonlySet<number>;
  selected: number | null;
}) {
  const visible = points.reduce((n, p) => n + (p.visible ? 1 : 0), 0);
  const ids = useMemo(() => {
    const all = visible <= LABEL_ALL_MAX && highlighted.size === 0;
    const out: number[] = [];
    points.forEach((p, i) => {
      if (!p.visible) return;
      if (all || highlighted.has(i) || i === selected) out.push(i);
    });
    return out.slice(0, LABEL_MAX);
  }, [points, highlighted, selected, visible]);

  const { camera, size } = useThree();
  const narrow = size.width < 520;
  const els = useRef(new Map<number, HTMLSpanElement>());
  const v = useMemo(() => new THREE.Vector3(), []);
  // Strona podpisu liczona co klatkę z pozycji na ekranie: domyślnie z
  // prawej, z lewej tylko gdy z prawej nie zmieści się w obrazie — przy
  // obrocie sceny tekst nigdy nie ucieka za krawędź (ważne na telefonie).
  useFrame(() => {
    type Box = {
      i: number;
      el: HTMLSpanElement;
      x0: number;
      x1: number;
      y0: number;
      y1: number;
      z: number;
    };
    const boxes: Box[] = [];
    for (const [i, el] of els.current) {
      const s = stars[i];
      if (!s) continue;
      v.set(s.x * SCENE_SCALE, s.y * SCENE_SCALE, s.z * SCENE_SCALE).project(camera);
      const sx = (v.x * 0.5 + 0.5) * size.width;
      const sy = (-v.y * 0.5 + 0.5) * size.height;
      const gap = Math.round(crystalRadius(s) * 40 + 6);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // z lewej tylko, gdy z prawej podpis nie mieści się w obrazie
      const left = sx + gap + w > size.width - 8;
      const want = left ? "left" : "right";
      if (el.dataset.side !== want) {
        el.dataset.side = want;
        el.style.transform = left
          ? `translate(calc(-100% - ${gap}px), -50%)`
          : `translate(${gap}px, -50%)`;
      }
      const x0 = left ? sx - gap - w : sx + gap;
      boxes.push({ i, el, x0, x1: x0 + w, y0: sy - h / 2, y1: sy + h / 2, z: v.z });
    }
    // Kolizje: pierwszeństwo ma zaznaczony, potem bliższy kamerze; podpis,
    // który nachodzi na już postawiony, gaśnie (wraca, gdy zrobi się miejsce).
    boxes.sort((a, b) => Number(b.i === selected) - Number(a.i === selected) || a.z - b.z);
    const placed: Box[] = [];
    for (const b of boxes) {
      const hit = placed.some(
        (p) => b.x0 < p.x1 + 4 && b.x1 > p.x0 - 4 && b.y0 < p.y1 + 1 && b.y1 > p.y0 - 1,
      );
      const op = hit ? "0" : "1";
      if (b.el.style.opacity !== op) b.el.style.opacity = op;
      if (!hit) placed.push(b);
    }
  });

  return (
    <>
      {ids.map((i) => {
        const s = stars[i];
        const max = narrow ? 22 : 34;
        const label = s.label.length > max ? `${s.label.slice(0, max - 1)}…` : s.label;
        return (
          <Html
            key={`${s.type}-${s.id}`}
            position={[s.x * SCENE_SCALE, s.y * SCENE_SCALE, s.z * SCENE_SCALE]}
            zIndexRange={[10, 0]}
            style={{ pointerEvents: "none" }}
          >
            <span
              ref={(el) => {
                if (el) els.current.set(i, el);
                else els.current.delete(i);
              }}
              className={
                "brain-node-label font-display block whitespace-nowrap transition-opacity duration-300 text-[10px] uppercase tracking-[0.18em] @max-[480px]:text-[9px] " +
                (i === selected ? "text-foreground" : "text-foreground/80")
              }
            >
              {label}
            </span>
          </Html>
        );
      })}
    </>
  );
}
