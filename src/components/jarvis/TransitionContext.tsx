import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";

import {
  ModuleTransitionLayer,
  type ModuleTransitionHandle,
} from "@/components/jarvis/module-transition/ModuleTransitionLayer";
import {
  PAGE_IN,
  PAGE_OUT,
  isFastJump,
  pickKind,
  transitionDuration,
} from "@/components/jarvis/module-transition/transitionMath";
import { hasWebGl, isLoginSceneEnabled } from "@/lib/theme/loginScene";
import { useUiMode } from "@/lib/theme/uiMode";

/**
 * "dematerialize" / "scan" / "materialize": the classic CSS transition (Town,
 * no WebGL, reduced motion, intro switch off, or the 3D layer not loaded yet).
 * "tunnel-out" / "core-out" / "enter-3d": the 3D module transitions — the old page
 * leaves, the overlay flies, the new page enters.
 */
export type RouteTransition =
  | "idle"
  | "dematerialize"
  | "scan"
  | "materialize"
  | "tunnel-out"
  | "core-out"
  | "enter-3d";

type Ctx = {
  transition: RouteTransition;
  isTransitioning: boolean;
  startTransition: (path: string) => void;
  /** CSS durations of the page leaving / entering during a 3D transition, ms. */
  pageTiming: { out: number; in: number };
};

const TransitionCtx = createContext<Ctx>({
  transition: "idle",
  isTransitioning: false,
  startTransition: () => {},
  pageTiming: { out: 0, in: 0 },
});

export function useRouteTransition() {
  return useContext(TransitionCtx);
}

export function TransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [transition, setTransition] = useState<RouteTransition>("idle");
  const [pageTiming, setPageTiming] = useState({ out: 0, in: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const layer = useRef<ModuleTransitionHandle>(null);
  const lastEnd = useRef(0);
  const uiMode = useUiMode();
  // 3D transitions: same switch as the 3D intro, HUD skin, WebGL, motion allowed
  const [can3d, setCan3d] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setCan3d(isLoginSceneEnabled() && uiMode === "hud" && !reduced && hasWebGl());
  }, [uiMode]);

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => () => clearTimers(), []);

  const startTransition = useCallback(
    (path: string) => {
      if (transition !== "idle") return;
      if (path === pathname) return;
      const l = layer.current;
      if (can3d && l?.ready()) {
        const kind = pickKind(pathname, path);
        const now = performance.now();
        const durationMs = transitionDuration(kind, isFastJump(now, lastEnd.current));
        setPageTiming({
          out: Math.round(durationMs * PAGE_OUT[kind]),
          in: Math.round(durationMs * PAGE_IN[kind]),
        });
        const started = l.play({
          kind,
          from: pathname,
          to: path,
          durationMs,
          onSwap: () => {
            void router.navigate({ to: path });
            setTransition("enter-3d");
          },
          onDone: () => {
            lastEnd.current = performance.now();
            setTransition("idle");
          },
        });
        if (started) {
          setTransition(kind === "tunnel" ? "tunnel-out" : "core-out");
          return;
        }
      }
      setTransition("dematerialize");
      timers.current.push(
        setTimeout(() => {
          router.navigate({ to: path });
          setTransition("scan");
        }, 550),
      );
      timers.current.push(setTimeout(() => setTransition("materialize"), 1000));
      timers.current.push(setTimeout(() => setTransition("idle"), 1850));
    },
    [transition, pathname, router, can3d],
  );

  return (
    <TransitionCtx.Provider
      value={{ transition, isTransitioning: transition !== "idle", startTransition, pageTiming }}
    >
      {children}
      <ModuleTransitionLayer ref={layer} enabled={can3d} />
    </TransitionCtx.Provider>
  );
}

export function useHudNavigate() {
  const { startTransition, isTransitioning } = useRouteTransition();
  return { go: startTransition, isTransitioning };
}
