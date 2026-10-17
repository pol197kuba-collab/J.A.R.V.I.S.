// Mózg 3D — scena (react-three-fiber).
//
// Wszystkie gwiazdy to JEDNO wywołanie rysowania (THREE.Points z własnym
// shaderem: kolor, rozmiar i przezroczystość per gwiazda), więc tysiące
// punktów chodzą płynnie także na telefonie.
//
// Dotyk: OrbitControls daje obrót jednym palcem, zoom i przesuwanie dwoma.
// Tapnięcie (krótkie, bez przesunięcia) wybiera gwiazdę z tolerancją w
// pikselach ekranu (scene.ts → pickNearest) — palec jest szerszy niż kropka.
// Podwójne tapnięcie przybliża kamerę do gwiazdy. Hovera nie ma: na
// telefonie nie istnieje, więc wszystko dzieje się po tapnięciu.
//
// Wydajność: DPR ≤ 1,5; bloom wyłączany sam, gdy PerformanceMonitor widzi
// spadek klatek (i nie wraca w tej sesji, żeby nie migał).

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type MutableRefObject,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, Line, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import type { BrainCluster, BrainStar } from "@/lib/brain/brain.functions";
import type { BrainSourceType } from "@/lib/brain/layout";
import { freshness, pickNearest, SCENE_SCALE, type ScreenPoint } from "@/lib/brain/scene";
import { useThemeColors } from "@/lib/theme/themeColor";

const SCENE_COLORS = {
  memory: "var(--reactor)",
  note: "var(--success)",
  document: "var(--accent)",
  selection: "var(--foreground)",
  link: "color-mix(in oklab, var(--foreground) 55%, transparent)",
  void: "color-mix(in oklab, var(--base-chrome) 25%, black)",
} as const;
const SCENE_FALLBACKS = {
  memory: "#ffaa00",
  note: "#34d399",
  document: "#7aa7ff",
  selection: "#e6f6ff",
  link: "#7f8a99",
  void: "#020409",
};

/** Tolerancja trafienia palcem / myszą w pikselach CSS. */
const TAP_TOLERANCE_TOUCH = 28;
const TAP_TOLERANCE_MOUSE = 14;
/** Tapnięcie = krótsze niż tyle ms i przesunięte mniej niż tyle px. */
const TAP_MAX_MS = 350;
const TAP_MAX_MOVE = 8;
const DOUBLE_TAP_MS = 320;
/** Odległość kamery od gwiazdy po przybliżeniu. */
const FOCUS_DISTANCE = 3.2;

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
};

export function BrainScene(props: BrainSceneProps) {
  const colors = useThemeColors(SCENE_COLORS, SCENE_FALLBACKS);
  const [bloom, setBloom] = useState(true);
  const pickerRef = useRef<Picker | null>(null);
  const gesture = useRef<{ x: number; y: number; t: number; touch: boolean } | null>(null);
  const lastTap = useRef<{ t: number; index: number | null }>({ t: 0, index: null });

  const onPointerDown = (e: React.PointerEvent) => {
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      touch: e.pointerType !== "mouse",
    };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || !pickerRef.current) return;
    const moved = Math.hypot(e.clientX - g.x, e.clientY - g.y);
    if (moved > TAP_MAX_MOVE || performance.now() - g.t > TAP_MAX_MS) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const index = pickerRef.current(
      e.clientX - rect.left,
      e.clientY - rect.top,
      g.touch ? TAP_TOLERANCE_TOUCH : TAP_TOLERANCE_MOUSE,
    );
    const now = performance.now();
    const isDouble =
      now - lastTap.current.t < DOUBLE_TAP_MS && index !== null && index === lastTap.current.index;
    lastTap.current = { t: now, index };
    props.onSelect(index);
    if (isDouble && index !== null) props.onFocus(index);
  };

  return (
    <div
      // touch-none: gest na scenie obraca galaktykę, a nie przewija stronę.
      className="absolute inset-0 touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <Canvas
        camera={{ position: [0, 2.5, 13], fov: 50, near: 0.05, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
      >
        <PerformanceMonitor onDecline={() => setBloom(false)} />
        <color attach="background" args={[colors.void]} />
        <fog attach="fog" args={[colors.void, 14, 34]} />

        <Stars
          stars={props.stars}
          visibleTypes={props.visibleTypes}
          highlighted={props.highlighted}
          colors={colors}
        />
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
        <PickerBridge stars={props.stars} visibleTypes={props.visibleTypes} pickerRef={pickerRef} />
        <CameraRig stars={props.stars} focus={props.focus} autoRotate={props.selected === null} />

        {bloom && (
          <EffectComposer multisampling={0}>
            <Bloom intensity={1.1} luminanceThreshold={0.15} luminanceSmoothing={0.9} mipmapBlur />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}

// ---------- gwiazdy ----------

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
  colors,
}: {
  stars: BrainStar[];
  visibleTypes: ReadonlySet<BrainSourceType>;
  highlighted: ReadonlySet<number>;
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
      const visible = visibleTypes.has(s.type);
      const lit = !searching || highlighted.has(i);
      const f = freshness(s.createdAt, now);
      const c = byType[s.type];
      col.setXYZ(i, c.r * (0.55 + 0.45 * f), c.g * (0.55 + 0.45 * f), c.b * (0.55 + 0.45 * f));
      const base = s.type === "document" ? 1.35 : 0.8 + s.weight * 0.12;
      size.setX(i, visible ? base * (searching && lit ? 1.6 : 1) : 0);
      alpha.setX(i, visible ? (lit ? 0.95 : 0.12) : 0);
    });
    col.needsUpdate = true;
    size.needsUpdate = true;
    alpha.needsUpdate = true;
  }, [geometry, stars, visibleTypes, highlighted, colors]);

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

// ---------- przesunięcie obrazu ----------

/** Płynnie przesuwa obraz kamery w górę o `shift` wysokości (setViewOffset). */
function ViewShift({ shift }: { shift: number }) {
  const { camera, size } = useThree();
  const current = useRef(0);
  useFrame((_, delta) => {
    const next = current.current + (shift - current.current) * (1 - Math.exp(-delta * 6));
    if (Math.abs(next - current.current) < 1e-4 && Math.abs(shift - next) < 1e-4) return;
    current.current = Math.abs(shift - next) < 1e-3 ? shift : next;
    const cam = camera as THREE.PerspectiveCamera;
    if (current.current === 0) cam.clearViewOffset();
    else {
      cam.setViewOffset(
        size.width,
        size.height,
        0,
        size.height * current.current,
        size.width,
        size.height,
      );
    }
    cam.updateProjectionMatrix();
  });
  return null;
}

// ---------- trafianie ----------

type Picker = (x: number, y: number, tolerance: number) => number | null;

/** Wystawia rodzicowi funkcję „która gwiazda jest pod palcem” z bieżącą kamerą. */
function PickerBridge({
  stars,
  visibleTypes,
  pickerRef,
}: {
  stars: BrainStar[];
  visibleTypes: ReadonlySet<BrainSourceType>;
  pickerRef: MutableRefObject<Picker | null>;
}) {
  const { camera, size } = useThree();
  useEffect(() => {
    const v = new THREE.Vector3();
    pickerRef.current = (x, y, tolerance) => {
      const screen: ScreenPoint[] = new Array(stars.length);
      const depth: number[] = new Array(stars.length);
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        v.set(s.x * SCENE_SCALE, s.y * SCENE_SCALE, s.z * SCENE_SCALE).project(camera);
        screen[i] = {
          x: ((v.x + 1) / 2) * size.width,
          y: ((1 - v.y) / 2) * size.height,
          visible: visibleTypes.has(s.type) && v.z > -1 && v.z < 1,
        };
        depth[i] = v.z;
      }
      return pickNearest(screen, x, y, tolerance, depth);
    };
    return () => {
      pickerRef.current = null;
    };
  }, [camera, size, stars, visibleTypes, pickerRef]);
  return null;
}

// ---------- kamera ----------

function CameraRig({
  stars,
  focus,
  autoRotate,
}: {
  stars: BrainStar[];
  focus: { index: number; nonce: number } | null;
  autoRotate: boolean;
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const goal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);

  useEffect(() => {
    if (!focus) return;
    const s = stars[focus.index];
    const c = controls.current;
    if (!s || !c) return;
    const target = new THREE.Vector3(s.x * SCENE_SCALE, s.y * SCENE_SCALE, s.z * SCENE_SCALE);
    // Kamera zostaje po tej samej stronie, tylko podjeżdża bliżej.
    const dir = camera.position.clone().sub(c.target).normalize();
    goal.current = { target, position: target.clone().add(dir.multiplyScalar(FOCUS_DISTANCE)) };
    // focus.nonce wymusza ponowny przelot nawet do tej samej gwiazdy.
  }, [focus, stars, camera]);

  useFrame((_, delta) => {
    const g = goal.current;
    const c = controls.current;
    if (!g || !c) return;
    const k = 1 - Math.exp(-delta * 4);
    c.target.lerp(g.target, k);
    camera.position.lerp(g.position, k);
    c.update();
    if (c.target.distanceTo(g.target) < 0.01 && camera.position.distanceTo(g.position) < 0.01) {
      goal.current = null;
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan
      screenSpacePanning
      minDistance={1.2}
      maxDistance={30}
      rotateSpeed={0.7}
      autoRotate={autoRotate}
      autoRotateSpeed={0.25}
      // Własny gest użytkownika przerywa przelot kamery.
      onStart={() => {
        goal.current = null;
      }}
    />
  );
}
