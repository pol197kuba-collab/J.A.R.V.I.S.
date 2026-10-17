// Mózg 3D — wspólne klocki obu scen (WIEDZA i STRUKTURA): warstwa
// tapnięć, trafianie z tolerancją, kamera z przelotem i przesunięcie
// obrazu pod kartą. Jedno źródło, żeby dotyk działał identycznie w obu
// trybach.

import { useEffect, useRef, type ComponentRef, type MutableRefObject, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { pickNearest, SCENE_SCALE, type ScreenPoint } from "@/lib/brain/scene";

/** Tolerancja trafienia palcem / myszą w pikselach CSS. */
const TAP_TOLERANCE_TOUCH = 28;
const TAP_TOLERANCE_MOUSE = 14;
/** Tapnięcie = krótsze niż tyle ms i przesunięte mniej niż tyle px. */
const TAP_MAX_MS = 350;
const TAP_MAX_MOVE = 8;
const DOUBLE_TAP_MS = 320;
/** Domyślna odległość kamery od celu po przybliżeniu. */
const FOCUS_DISTANCE = 3.2;

/** „Który obiekt jest pod palcem” — liczone na żywo z bieżącą kamerą. */
export type Picker = (x: number, y: number, tolerance: number) => number | null;

/** Punkt sceny w jednostkach bazy (promień ~1); scena mnoży przez SCENE_SCALE. */
export type ScenePoint = { x: number; y: number; z: number; visible?: boolean };

/**
 * Warstwa nad canvasem: rozróżnia tapnięcie od gestu obrotu/zoomu, woła
 * `onSelect` z trafionym indeksem (albo null w pustkę) i `onFocus` przy
 * podwójnym tapnięciu. touch-none: gest obraca scenę, a nie przewija stronę.
 */
export function TapLayer({
  pickerRef,
  onSelect,
  onFocus,
  children,
}: {
  pickerRef: MutableRefObject<Picker | null>;
  onSelect: (index: number | null) => void;
  onFocus: (index: number) => void;
  children: ReactNode;
}) {
  const gesture = useRef<{ x: number; y: number; t: number; touch: boolean } | null>(null);
  const lastTap = useRef<{ t: number; index: number | null }>({ t: 0, index: null });

  return (
    <div
      className="absolute inset-0 touch-none select-none"
      onPointerDown={(e) => {
        gesture.current = {
          x: e.clientX,
          y: e.clientY,
          t: performance.now(),
          touch: e.pointerType !== "mouse",
        };
      }}
      onPointerUp={(e) => {
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
          now - lastTap.current.t < DOUBLE_TAP_MS &&
          index !== null &&
          index === lastTap.current.index;
        lastTap.current = { t: now, index };
        onSelect(index);
        if (isDouble && index !== null) onFocus(index);
      }}
    >
      {children}
    </div>
  );
}

/** Wystawia rodzicowi Picker dla podanych punktów (wewnątrz <Canvas>). */
export function PointsPicker({
  points,
  pickerRef,
}: {
  points: ScenePoint[];
  pickerRef: MutableRefObject<Picker | null>;
}) {
  const { camera, size } = useThree();
  useEffect(() => {
    const v = new THREE.Vector3();
    pickerRef.current = (x, y, tolerance) => {
      const screen: ScreenPoint[] = new Array(points.length);
      const depth: number[] = new Array(points.length);
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        v.set(p.x * SCENE_SCALE, p.y * SCENE_SCALE, p.z * SCENE_SCALE).project(camera);
        screen[i] = {
          x: ((v.x + 1) / 2) * size.width,
          y: ((1 - v.y) / 2) * size.height,
          visible: p.visible !== false && v.z > -1 && v.z < 1,
        };
        depth[i] = v.z;
      }
      return pickNearest(screen, x, y, tolerance, depth);
    };
    return () => {
      pickerRef.current = null;
    };
  }, [camera, size, points, pickerRef]);
  return null;
}

/** Płynnie przesuwa obraz kamery w górę o `shift` wysokości (setViewOffset). */
export function ViewShift({ shift }: { shift: number }) {
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

/** OrbitControls + przelot kamery do punktu `focus.index` (zmiana nonce = nowy przelot). */
export function CameraRig({
  points,
  focus,
  autoRotate,
  focusDistance = FOCUS_DISTANCE,
}: {
  points: ScenePoint[];
  focus: { index: number; nonce: number } | null;
  autoRotate: boolean;
  focusDistance?: number;
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const goal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);

  useEffect(() => {
    if (!focus) return;
    const p = points[focus.index];
    const c = controls.current;
    if (!p || !c) return;
    const target = new THREE.Vector3(p.x * SCENE_SCALE, p.y * SCENE_SCALE, p.z * SCENE_SCALE);
    // Kamera zostaje po tej samej stronie, tylko podjeżdża bliżej.
    const dir = camera.position.clone().sub(c.target).normalize();
    goal.current = { target, position: target.clone().add(dir.multiplyScalar(focusDistance)) };
  }, [focus, points, camera, focusDistance]);

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
