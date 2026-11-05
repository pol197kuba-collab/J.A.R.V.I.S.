import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { LOGIN_DENIED_EVENT, LOGIN_REACTOR_SLOT_ATTR } from "@/lib/theme/loginScene";
import { resolveSceneColors } from "./sceneColors";
// Type-only: erased at build, so three.js never reaches the main bundle.
import type { LoginScene as SceneHandle, SlotRect } from "./createLoginScene";

const DEFAULT_AGENT_COUNT = 5;

interface Props {
  /** true once access is granted: plays login → Arc Core (p 0 → 1). */
  ignite: boolean;
  /** p reached P_LIVE: mount the dashboard. */
  onLive: () => void;
  /** p reached 1: the overlay is gone and rendering has stopped. */
  onDone: () => void;
  /** three.js chunk or WebGL failed: fall back to the SVG + BootSequence path. */
  onUnavailable: () => void;
}

declare global {
  interface Window {
    /** DEV-only proof harness (stripped from production builds). */
    __loginScene?: {
      set: (p: number) => void;
      frame: (dt?: number) => void;
      layout: () => void;
      shake: () => void;
    };
  }
}

function readSlot(): SlotRect | null {
  const el = document.querySelector(`[${LOGIN_REACTOR_SLOT_ATTR}]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * Full-screen 3D scene under the login form and, after login, the Arc Core
 * ignition overlay above the dashboard. three.js is imported dynamically in
 * the effect (SSR-safe, separate chunk). Mount it once and keep it mounted
 * across login_screen → initializing → transition_to_dashboard.
 */
export function LoginScene({ ignite, onLive, onDone, onUnavailable }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const vigRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const queryClient = useQueryClient();

  // latest props without re-running the mount effect (the scene must never remount)
  const live = useRef({ ignite, onLive, onDone, onUnavailable });
  live.current = { ignite, onLive, onDone, onUnavailable };

  const igniteScene = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const cached = queryClient.getQueryData<{ slug: string }[]>(["agents", "list"]);
    const n = cached ? cached.filter((a) => a.slug !== AGENT_SLUGS.JARVIS).length : 0;
    scene.setAgentCount(n > 0 ? n : DEFAULT_AGENT_COUNT);
    scene.layout();
    scene.ignite();
  };

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};

    (async () => {
      try {
        const { createLoginScene } = await import("./createLoginScene");
        if (cancelled) return;
        const canvas = canvasRef.current;
        const root = rootRef.current;
        const grid = gridRef.current;
        const vignette = vigRef.current;
        const flash = flashRef.current;
        if (!canvas || !root || !grid || !vignette || !flash) return;

        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        const scene = createLoginScene({
          canvas,
          overlays: { root, grid, vignette, flash },
          colors: resolveSceneColors(),
          reducedMotion: mq.matches,
          agentCount: DEFAULT_AGENT_COUNT,
          getSlotRect: readSlot,
          onLive: () => live.current.onLive(),
          onDone: () => live.current.onDone(),
          preserveDrawingBuffer: import.meta.env.DEV,
        });
        sceneRef.current = scene;

        const onMq = () => scene.setReducedMotion(mq.matches);
        mq.addEventListener("change", onMq);
        const onDenied = () => scene.shake();
        window.addEventListener(LOGIN_DENIED_EVENT, onDenied);
        const onContextLost = () => live.current.onUnavailable();
        canvas.addEventListener("webglcontextlost", onContextLost);

        // keep the 3D reactor glued to the slot (fonts, rotation, resize)
        const relayout = () => scene.layout();
        const slot = document.querySelector(`[${LOGIN_REACTOR_SLOT_ATTR}]`);
        const ro =
          slot && typeof ResizeObserver !== "undefined" ? new ResizeObserver(relayout) : null;
        if (slot) ro?.observe(slot);
        void document.fonts?.ready.then(() => !cancelled && relayout());
        requestAnimationFrame(() => !cancelled && relayout());

        if (import.meta.env.DEV) {
          window.__loginScene = {
            set: (p) => {
              scene.setPhase(p);
              scene.setManual(true);
            },
            frame: (dt) => scene.frame(dt),
            layout: relayout,
            shake: () => scene.shake(),
          };
        }

        if (live.current.ignite) igniteScene();

        cleanup = () => {
          mq.removeEventListener("change", onMq);
          window.removeEventListener(LOGIN_DENIED_EVENT, onDenied);
          canvas.removeEventListener("webglcontextlost", onContextLost);
          ro?.disconnect();
          if (import.meta.env.DEV) delete window.__loginScene;
          sceneRef.current = null;
          scene.dispose();
        };
      } catch (err) {
        console.warn("[login-scene] unavailable, falling back to the SVG reactor", err);
        if (!cancelled) live.current.onUnavailable();
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
    // mount once: the scene survives phase changes (props go through `live`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ignite) igniteScene();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ignite]);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-login-scene=""
      className="fixed inset-0 z-[99] overflow-hidden bg-black"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      <div
        ref={gridRef}
        className="pointer-events-none absolute inset-0 animate-[grid-pan_20s_linear_infinite] motion-reduce:animate-none"
        style={{
          backgroundImage: "var(--grid-bg)",
          backgroundSize: "40px 40px",
          opacity: 0.55,
          mixBlendMode: "screen",
        }}
      />
      <div
        ref={vigRef}
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.95) 100%)",
        }}
      />
      <div ref={flashRef} className="pointer-events-none absolute inset-0" style={{ opacity: 0 }} />
    </div>
  );
}
