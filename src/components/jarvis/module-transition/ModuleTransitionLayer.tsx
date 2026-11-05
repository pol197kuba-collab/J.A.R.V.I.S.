import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { LANDING_AGENTS } from "@/components/jarvis/login-scene/landingData";
import { resolveSceneColors } from "@/components/jarvis/login-scene/sceneColors";
// Type-only: erased at build, so three.js never reaches the main bundle.
import type { MenuControl, Rect, TransitionScene } from "./createTransitionScene";
import { JARVIS_PATH, MODULE_AGENT, moduleBoard, type TransitionKind } from "./transitionMath";

export interface ModuleTransitionHandle {
  /** The 3D overlay is loaded and warmed up. */
  ready(): boolean;
  /** Play a transition; false if it could not start (caller falls back to the CSS one). */
  play(o: {
    kind: TransitionKind;
    from: string;
    to: string;
    durationMs: number;
    /** Started from the orbit menu (its dive already covers the screen). */
    coverStart?: boolean;
    onSwap: () => void;
    onDone: () => void;
  }): boolean;
  /** The orbit menu of the loaded scene (null until it is loaded). */
  menu(): MenuControl | null;
}

type AgentRow = { slug: string; name: string };

function jarvisRect(): Rect | null {
  const el = document.querySelector("[data-jarvis-canvas-rect]");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * Full-screen overlay that plays the 3D module transitions. three.js loads in a
 * separate chunk once the dashboard is up (only when `enabled`), compiles its
 * shaders right away, and then renders only while a transition plays.
 */
export const ModuleTransitionLayer = forwardRef<ModuleTransitionHandle, { enabled: boolean }>(
  function ModuleTransitionLayer({ enabled }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const flashRef = useRef<HTMLDivElement>(null);
    const handoffRef = useRef<HTMLDivElement>(null);
    const nameRef = useRef<HTMLElement>(null);
    const sceneRef = useRef<TransitionScene | null>(null);
    const queryClient = useQueryClient();

    useEffect(() => {
      if (!enabled) return;
      let cancelled = false;
      let scene: TransitionScene | null = null;
      // after the dashboard's own first paint, so it never competes with it
      const id = window.setTimeout(async () => {
        try {
          const { createTransitionScene } = await import("./createTransitionScene");
          const canvas = canvasRef.current;
          const flash = flashRef.current;
          const handoff = handoffRef.current;
          const handoffName = nameRef.current;
          if (cancelled || !canvas || !flash || !handoff || !handoffName) return;
          scene = createTransitionScene(
            { canvas, flash, handoff, handoffName },
            resolveSceneColors(),
          );
          sceneRef.current = scene;
        } catch (err) {
          console.warn("[module-transition] 3D unavailable, keeping the CSS transition", err);
        }
      }, 600);
      return () => {
        cancelled = true;
        window.clearTimeout(id);
        sceneRef.current = null;
        scene?.dispose();
      };
    }, [enabled]);

    useImperativeHandle(
      ref,
      () => ({
        ready: () => !!sceneRef.current && !sceneRef.current.playing,
        menu: () => sceneRef.current?.menu ?? null,
        play({ kind, from, to, durationMs, coverStart, onSwap, onDone }) {
          const scene = sceneRef.current;
          if (!scene || scene.playing) return false;
          // nodes in the same order as the /jarvis matrix (teammates from the agents cache)
          const rows = queryClient.getQueryData<AgentRow[]>(["agents", "list"]);
          const team: AgentRow[] = rows?.length
            ? rows.filter((a) => a.slug !== AGENT_SLUGS.JARVIS)
            : LANDING_AGENTS.map((a) => ({ slug: a.slug, name: a.name }));
          const other = kind === "core-enter" ? from : to;
          const ownerSlug = MODULE_AGENT[other] ?? null;
          const idx = ownerSlug ? team.findIndex((a) => a.slug === ownerSlug) : -1;
          scene.play({
            kind,
            durationMs,
            board: moduleBoard(to),
            agentCount: team.length,
            agentIndex: idx >= 0 ? idx : null,
            agentName: idx >= 0 ? team[idx].name : null,
            getTargetRect: () => (from === JARVIS_PATH || to === JARVIS_PATH ? jarvisRect() : null),
            coverStart,
            onSwap,
            onDone,
          });
          return true;
        },
      }),
      [queryClient],
    );

    if (!enabled) return null;
    return (
      <>
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[70] block h-full w-full"
          style={{ opacity: 0, visibility: "hidden" }}
        />
        <div
          ref={flashRef}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[71]"
          style={{ opacity: 0 }}
        />
        <div
          ref={handoffRef}
          aria-hidden="true"
          className="font-display pointer-events-none fixed bottom-[18%] left-1/2 z-[72] -translate-x-1/2 whitespace-nowrap text-center text-[11px] uppercase tracking-[0.4em] transition-opacity duration-200"
          style={{ opacity: 0, color: "var(--reactor-hot)" }}
        >
          Przekazanie
          <b
            ref={nameRef}
            className="mt-1 block text-lg font-normal tracking-[0.25em] text-foreground"
          />
        </div>
      </>
    );
  },
);
