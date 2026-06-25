import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";

export type RouteTransition = "idle" | "dematerialize" | "scan" | "materialize";

type Ctx = {
  transition: RouteTransition;
  isTransitioning: boolean;
  startTransition: (path: string) => void;
};

const TransitionCtx = createContext<Ctx>({
  transition: "idle",
  isTransitioning: false,
  startTransition: () => {},
});

export function useRouteTransition() {
  return useContext(TransitionCtx);
}

export function TransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [transition, setTransition] = useState<RouteTransition>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => () => clearTimers(), []);

  const startTransition = useCallback(
    (path: string) => {
      if (transition !== "idle") return;
      if (path === pathname) return;
      setTransition("dematerialize");
      timers.current.push(
        setTimeout(() => {
          router.navigate({ to: path });
          setTransition("scan");
        }, 550),
      );
      timers.current.push(
        setTimeout(() => setTransition("materialize"), 1000),
      );
      timers.current.push(
        setTimeout(() => setTransition("idle"), 1850),
      );
    },
    [transition, pathname, router],
  );

  return (
    <TransitionCtx.Provider
      value={{ transition, isTransitioning: transition !== "idle", startTransition }}
    >
      {children}
    </TransitionCtx.Provider>
  );
}

export function useHudNavigate() {
  const { startTransition, isTransitioning } = useRouteTransition();
  return { go: startTransition, isTransitioning };
}