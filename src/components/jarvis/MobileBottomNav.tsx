import { useCallback, useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Bot,
  Terminal,
  Settings as SettingsIcon,
  Boxes,
  Radar,
  Eye,
  ListChecks,
  Database,
  FileText,
  Orbit,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useHudNavigate } from "./TransitionContext";
import { useArkReboot } from "./ArkRebootContext";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Agents", url: "/agent-hub", icon: Bot },
  { title: "Matrix", url: "/jarvis", icon: Orbit },
  { title: "Tasks", url: "/tasks", icon: ListChecks },
  { title: "Systems", url: "/sub-systems", icon: Boxes },
  { title: "Situation", url: "/situation-room", icon: Radar },
  { title: "Vision", url: "/vision", icon: Eye },
  { title: "Logs", url: "/system-logs", icon: Terminal },
  { title: "Schema", url: "/schema", icon: Database },
  { title: "Docs", url: "/documents", icon: FileText },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
] as const;

/**
 * Mobile-only navigation rail pinned to the bottom of the viewport.
 * Horizontally scrollable — roughly five modules fit on screen, the rest
 * are a swipe away. Uses the exact same HUD transition navigation as the
 * desktop sidebar, so behaviour is identical across form factors.
 */
export function MobileBottomNav() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { go, isTransitioning } = useHudNavigate();
  const { isDiagnosticRunning } = useArkReboot();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const drag = useRef({
    active: false,
    moved: false,
    startX: 0,
    startScroll: 0,
    lastX: 0,
    lastT: 0,
    velocity: 0,
    pointerId: -1,
  });
  const momentum = useRef<number | null>(null);

  const stopMomentum = useCallback(() => {
    if (momentum.current !== null) {
      cancelAnimationFrame(momentum.current);
      momentum.current = null;
    }
  }, []);

  useEffect(() => stopMomentum, [stopMomentum]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stopMomentum();
    const el = scrollerRef.current;
    if (!el) return;
    drag.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      lastX: e.clientX,
      lastT: performance.now(),
      velocity: 0,
      pointerId: e.pointerId,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = scrollerRef.current;
    if (!d.active || !el) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true;
      el.setPointerCapture?.(d.pointerId);
    }
    if (!d.moved) return;
    el.scrollLeft = d.startScroll - dx;
    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) {
      // px per ms, smoothed
      const v = (e.clientX - d.lastX) / dt;
      d.velocity = d.velocity * 0.7 + v * 0.3;
      d.lastX = e.clientX;
      d.lastT = now;
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = scrollerRef.current;
    d.active = false;
    if (!el) return;
    try {
      el.releasePointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    if (!d.moved) return;
    // Flywheel: keep spinning and decelerate until it stops.
    let velocity = d.velocity;
    if (Math.abs(velocity) < 0.05) return;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = Math.min(now - last, 32);
      last = now;
      el.scrollLeft -= velocity * dt;
      velocity *= Math.pow(0.995, dt);
      const atEdge = el.scrollLeft <= 0 || el.scrollLeft >= el.scrollWidth - el.clientWidth;
      if (Math.abs(velocity) < 0.02 || atEdge) {
        momentum.current = null;
        return;
      }
      momentum.current = requestAnimationFrame(step);
    };
    momentum.current = requestAnimationFrame(step);
  };

  // Keep the active module in view when the route changes.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [pathname]);

  return (
    <nav
      aria-label="Modules"
      className="relative z-20 shrink-0 border-t border-primary/20 bg-gradient-to-t from-black/85 to-black/50 backdrop-blur-xl shadow-[0_-8px_28px_-18px_color-mix(in_oklab,var(--primary)_70%,transparent)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        ref={scrollerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="no-scrollbar flex touch-pan-x items-stretch gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] select-none"
        style={{ overscrollBehaviorX: "contain" }}
      >
        {items.map((item) => {
          const active = pathname === item.url;
          return (
            <button
              key={item.url}
              ref={active ? activeRef : undefined}
              type="button"
              disabled={isTransitioning || isDiagnosticRunning}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                if (drag.current.moved) return;
                audio.playClick();
                if (item.url === "/situation-room") speak("Uruchamiam telemetrię satelitarną.");
                go(item.url);
              }}
              className={cn(
                "group relative flex w-[19vw] min-w-[68px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 transition-all duration-200 disabled:opacity-50",
                active
                  ? "bg-gradient-to-b from-primary/20 to-primary/5 text-primary shadow-[inset_0_1px_0_color-mix(in_oklab,var(--primary)_30%,transparent),0_0_18px_-8px_var(--primary)]"
                  : "text-muted-foreground",
              )}
            >
              <item.icon
                className={cn("h-[18px] w-[18px]", active && "icon-neon")}
                strokeWidth={1.5}
              />
              <span className="font-display max-w-full truncate text-[8px] uppercase tracking-[0.18em]">
                {item.title}
              </span>
              {active && (
                <span className="absolute -top-[7px] h-1 w-1 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
