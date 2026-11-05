import { useEffect, useRef, type MutableRefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { LOGIN_DENIED_EVENT, LOGIN_REACTOR_SLOT_ATTR } from "@/lib/theme/loginScene";
import type { AppPhase } from "@/components/jarvis/PhaseContext";
import type { IntroBridge } from "./introBridge";
import { landingIntroAgents, landingModules } from "./landingData";
import { resolveSceneColors } from "./sceneColors";
// Type-only: erased at build, so three.js never reaches the main bundle.
import type { IntroAgent, IntroScene, LandingHost, LandingHud, SlotRect } from "./createLoginScene";

interface Props {
  /** "landing": starts in scroll mode (landing page); "login": straight to the 3D login. */
  mode: "landing" | "login";
  /** App phase: login_screen → enters the login pose, initializing → ignition. */
  phase: AppPhase;
  bridge: MutableRefObject<IntroBridge>;
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
      setScroll: (y: number) => void;
      enterLogin: () => void;
      setIgnite: (p: number) => void;
      setEnergy: (e: number) => void;
      setAgents: (list: IntroAgent[]) => void;
      shake: () => void;
      frame: (n?: number) => void;
      layout: () => void;
      stops: () => { id: string; a: number; b: number }[];
      mode: () => string;
    };
  }
}

type AgentRow = {
  slug: string;
  name: string;
  role: string | null;
  status: string;
  isEnabled: boolean;
  busySince: string | null;
};

/** Live agents from the react-query cache, as scene agents (core excluded). */
function cachedAgents(get: (key: readonly unknown[]) => unknown): IntroAgent[] | null {
  const rows = get(["agents", "list"]) as AgentRow[] | undefined;
  if (!rows) return null;
  const list = rows
    .filter((a) => a.slug !== AGENT_SLUGS.JARVIS)
    .map((a) => ({
      slug: a.slug,
      name: a.name,
      role: a.role,
      busy: a.isEnabled && a.status === "busy",
      error: a.status === "error",
      busySince: a.busySince,
    }));
  return list.length ? list : null;
}

function rectOf(sel: string): SlotRect | null {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * Full-screen 3D intro scene: landing page backdrop, the 3D login behind the
 * form, and the Arc Core ignition overlay above the dashboard. three.js is
 * imported dynamically in the effect (SSR-safe, separate chunk). Mount it once
 * and keep it mounted across booting → login_screen → initializing →
 * transition_to_dashboard (the phase prop drives its modes, never a remount).
 */
export function LoginScene({ mode, phase, bridge, onLive, onDone, onUnavailable }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const vigRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const arkRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<IntroScene | null>(null);
  const queryClient = useQueryClient();

  // latest props without re-running the mount effect (the scene must never remount)
  const live = useRef({ phase, onLive, onDone, onUnavailable });
  live.current = { phase, onLive, onDone, onUnavailable };

  const syncPhase = (scene: IntroScene) => {
    const ph = live.current.phase;
    if (ph === "login_screen") {
      scene.layout();
      scene.enterLogin();
    } else if (
      ph === "initializing" ||
      ph === "transition_to_dashboard" ||
      ph === "dashboard_active"
    ) {
      scene.layout();
      scene.ignite();
    }
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
        const ark = arkRef.current;
        const labels = labelsRef.current;
        if (!canvas || !root || !grid || !vignette || !flash || !ark || !labels) return;

        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        const getCache = (k: readonly unknown[]) => queryClient.getQueryData(k);
        const cached = cachedAgents(getCache);
        const b = bridge.current;
        const scene = createLoginScene({
          canvas,
          overlays: { root, grid, vignette, flash, ark, labels },
          colors: resolveSceneColors(),
          reducedMotion: mq.matches,
          initialMode: mode === "landing" ? "scroll" : "login",
          agents: mode === "landing" ? landingIntroAgents() : (cached ?? landingIntroAgents()),
          modules: landingModules(),
          landing:
            mode === "landing" && b.host
              ? {
                  scrollEl: () => bridge.current.host?.scrollEl() ?? null,
                  sections: () => bridge.current.host?.sections() ?? [],
                  engageHome: () => bridge.current.host?.engageHome() ?? null,
                  isJumping: () => bridge.current.host?.isJumping() ?? false,
                }
              : undefined,
          getSlotRect: () => rectOf(`[${LOGIN_REACTOR_SLOT_ATTR}]`),
          getTargetRect: () => rectOf("[data-jarvis-canvas-rect]"),
          getAgents: () => cachedAgents(getCache),
          onHud: (h) => bridge.current.onHud?.(h),
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
        const relayout = () => scene.layout();
        // The login form scrolls inside its own container (e.g. above the phone
        // keyboard): keep the 3D reactor glued to its slot while that happens.
        const onSlotMove = () => scene.refreshSlot();
        document.addEventListener("scroll", onSlotMove, { capture: true, passive: true });
        window.visualViewport?.addEventListener("resize", onSlotMove);
        void document.fonts?.ready.then(() => !cancelled && relayout());
        requestAnimationFrame(() => !cancelled && relayout());

        if (import.meta.env.DEV) {
          window.__loginScene = {
            setScroll: (y) => {
              scene.setManual(true);
              scene.debug.setScroll(y);
            },
            enterLogin: () => scene.enterLogin(),
            setIgnite: (p) => {
              scene.setManual(true);
              scene.debug.setIgnite(p);
            },
            setEnergy: (e) => scene.debug.setEnergy(e),
            setAgents: (list) => scene.setAgents(list, true),
            shake: () => scene.shake(),
            frame: (n = 1) => {
              for (let i = 0; i < n; i++) scene.frame();
            },
            layout: relayout,
            stops: () => scene.debug.stops(),
            mode: () => scene.mode,
          };
        }

        syncPhase(scene);

        cleanup = () => {
          mq.removeEventListener("change", onMq);
          window.removeEventListener(LOGIN_DENIED_EVENT, onDenied);
          canvas.removeEventListener("webglcontextlost", onContextLost);
          document.removeEventListener("scroll", onSlotMove, { capture: true });
          window.visualViewport?.removeEventListener("resize", onSlotMove);
          if (import.meta.env.DEV) delete window.__loginScene;
          sceneRef.current = null;
          scene.dispose();
        };
      } catch (err) {
        console.warn("[intro-scene] unavailable, falling back to the classic screens", err);
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
    const scene = sceneRef.current;
    if (scene) syncPhase(scene);
  }, [phase]);

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
      <div ref={labelsRef} className="pointer-events-none absolute inset-0" />
      <div
        ref={flashRef}
        className="pointer-events-none absolute inset-0 bg-white"
        style={{ opacity: 0 }}
      />
      <div ref={arkRef} className="pointer-events-none absolute inset-0" style={{ opacity: 0 }} />
    </div>
  );
}
