import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { useHudNavigate } from "./TransitionContext";
import { useArkReboot } from "./ArkRebootContext";
import { useShowcase } from "./ShowcaseContext";
import { MENU_GROUPS, type ModuleEntry, type ModuleGroup } from "./modules";
import { dragToSpin } from "./module-transition/orbitMenuMath";
// Type-only: erased at build, so three.js never reaches the main bundle.
import type { MenuControl, MenuFrame } from "./module-transition/createTransitionScene";

type Entry = { key: string; label: string; icon: ModuleEntry["icon"] };

const groupOf = (pathname: string): ModuleGroup | undefined =>
  MENU_GROUPS.find((g) => g.items.some((i) => i.url === pathname));

const indexOrNull = (i: number) => (i >= 0 ? i : null);

/**
 * The mobile module menu as the Arc Core: sections (then a section's modules)
 * are nodes on one orbit, drawn by the 3D transition scene. This component only
 * lays the tap targets and labels over the nodes (positions come per frame from
 * the scene) and turns the orbit with a horizontal drag. Picking a module dives
 * into its node and the tunnel takes over without a cut.
 */
export function OrbitMenu({
  pathname,
  menu,
  onClose,
}: {
  pathname: string;
  menu: MenuControl;
  onClose: () => void;
}) {
  const { go, isTransitioning } = useHudNavigate();
  const { isDiagnosticRunning } = useArkReboot();
  const { isRunning: isShowcaseRunning } = useShowcase();
  const locked = isTransitioning || isDiagnosticRunning || isShowcaseRunning;

  const [group, setGroup] = useState<ModuleGroup | null>(null);
  const [leaving, setLeaving] = useState(false);
  const activeGroupIndex = indexOrNull(MENU_GROUPS.findIndex((g) => g === groupOf(pathname)));

  const entries: Entry[] = group
    ? group.items.map((m) => ({ key: m.url, label: m.shortTitle, icon: m.icon }))
    : MENU_GROUPS.map((g) => ({ key: g.id, label: g.label, icon: g.icon }));
  const activeIndex = group
    ? indexOrNull(group.items.findIndex((m) => m.url === pathname))
    : activeGroupIndex;

  const nodeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const coreRef = useRef<HTMLButtonElement>(null);

  const onFrame = useCallback((f: MenuFrame) => {
    f.nodes.forEach((n, i) => {
      const el = nodeRefs.current[i];
      if (!el) return;
      el.style.transform = `translate3d(${n.x.toFixed(1)}px, ${n.y.toFixed(1)}px, 0)`;
      el.style.opacity = n.alpha.toFixed(3);
      el.style.zIndex = String(Math.max(1, 5000 - Math.round(n.depth)));
      el.style.pointerEvents = n.alpha > 0.6 ? "auto" : "none";
      el.style.setProperty("--node-r", `${Math.max(24, n.r * 1.7).toFixed(1)}px`);
      // nodes above the core carry their label on top, so no label crosses the core
      el.dataset.up = n.y < f.core.y - 4 ? "1" : "0";
    });
    const c = coreRef.current;
    if (c) {
      c.style.transform = `translate3d(${f.core.x.toFixed(1)}px, ${f.core.y.toFixed(1)}px, 0)`;
      c.style.setProperty("--core-r", `${Math.max(30, f.core.r * 1.1).toFixed(1)}px`);
    }
  }, []);

  // open once; the scene drives every frame from here on
  useEffect(() => {
    const ok = menu.open({ count: entries.length, active: activeIndex, onFrame });
    if (!ok) onClose();
    return () => menu.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    setLeaving(true);
    menu.close(onClose);
  }, [menu, onClose]);

  const back = () => {
    audio.playClick();
    if (group) {
      setGroup(null);
      menu.setLevel(MENU_GROUPS.length, activeGroupIndex);
    } else close();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (group) {
        setGroup(null);
        menu.setLevel(MENU_GROUPS.length, activeGroupIndex);
      } else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [group, menu, activeGroupIndex, close]);

  const openGroup = (g: ModuleGroup) => {
    audio.playClick();
    setGroup(g);
    menu.setLevel(g.items.length, indexOrNull(g.items.findIndex((m) => m.url === pathname)));
  };

  const openModule = (item: ModuleEntry, i: number) => {
    if (locked) return;
    audio.playClick();
    if (item.url === pathname) {
      close();
      return;
    }
    if (item.url === "/situation-room") speak("Uruchamiam telemetrię satelitarną.");
    setLeaving(true);
    menu.pick(i, () => {
      go(item.url, { fromMenu: true });
      // unmounting closes the menu; if the 3D transition took over it is already gone
      onClose();
    });
  };

  // horizontal drag turns the orbit; a drag never counts as a tap
  const drag = useRef<{
    x: number;
    lastX: number;
    lastT: number;
    vel: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, lastX: e.clientX, lastT: e.timeStamp, vel: 0, moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x) > 8) {
      d.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    if (!d.moved) return;
    const dSpin = dragToSpin(e.clientX - d.lastX, window.innerWidth);
    const dt = Math.max(1, e.timeStamp - d.lastT) / 1000;
    d.vel = d.vel * 0.6 + (dSpin / dt) * 0.4;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    menu.drag(dSpin);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      menu.release(d.vel);
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
    }
  };
  const guard = (fn: () => void) => () => {
    if (suppressClick.current || leaving) return;
    fn();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Menu modułów"
      className={cn(
        "fixed inset-0 z-[73] touch-none select-none",
        leaving && "pointer-events-none",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => {
        if (e.target === e.currentTarget && !suppressClick.current && !leaving) close();
      }}
    >
      <p
        className={cn(
          "font-display pointer-events-none absolute inset-x-0 top-[max(1.5rem,env(safe-area-inset-top))] text-center text-[10px] uppercase tracking-[0.35em] text-primary/80 transition-opacity duration-200",
          leaving && "opacity-0",
        )}
      >
        {group ? `Menu // ${group.label}` : "Menu // wybierz sekcję"}
      </p>

      {/* the core: closes the menu on the sections level, goes back on a section */}
      <button
        ref={coreRef}
        type="button"
        onClick={guard(back)}
        aria-label={group ? "Wróć do sekcji" : "Zamknij menu"}
        className={cn(
          "absolute top-0 left-0 transition-opacity duration-200",
          leaving && "opacity-0",
        )}
        style={{ transform: "translate3d(50vw, 50vh, 0)" }}
      >
        <span
          className="absolute top-0 left-0 block -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: "calc(var(--core-r, 40px) * 2)",
            height: "calc(var(--core-r, 40px) * 2)",
          }}
        />
      </button>

      {entries.map((n, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={n.key}
            ref={(el) => {
              nodeRefs.current[i] = el;
            }}
            type="button"
            aria-label={n.label}
            aria-current={active && group ? "page" : undefined}
            disabled={group !== null && locked}
            onClick={guard(() =>
              group ? openModule(group.items[i], i) : openGroup(MENU_GROUPS[i]),
            )}
            className="group/node absolute top-0 left-0"
            style={{ opacity: 0, pointerEvents: "none" }}
          >
            <span
              className={cn(
                "absolute top-0 left-0 block -translate-x-1/2 -translate-y-1/2 rounded-full border",
                active ? "border-primary/60" : "border-primary/20",
              )}
              style={{
                width: "calc(var(--node-r, 28px) * 2)",
                height: "calc(var(--node-r, 28px) * 2)",
              }}
            />
            <span
              className={cn(
                "font-display absolute left-0 top-[calc(var(--node-r,28px)+4px)] flex -translate-x-1/2 items-center group-data-[up=1]/node:top-auto group-data-[up=1]/node:bottom-[calc(var(--node-r,28px)+4px)] gap-1.5 whitespace-nowrap rounded-full border bg-background/70 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] backdrop-blur-sm",
                active
                  ? "border-primary/60 text-primary shadow-[0_0_12px_-4px_var(--primary)]"
                  : "border-primary/20 text-foreground/85",
              )}
            >
              <n.icon className="icon-neon h-3 w-3 shrink-0" strokeWidth={1.5} />
              {n.label}
            </span>
          </button>
        );
      })}

      <button
        type="button"
        onClick={guard(back)}
        className={cn(
          "font-display absolute bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+1.75rem)] left-1/2 -translate-x-1/2 rounded-full border border-primary/40 bg-background/70 px-4 py-1.5 text-[10px] uppercase tracking-[0.3em] text-primary shadow-[0_0_14px_-6px_var(--primary)] backdrop-blur-sm transition-opacity duration-200",
          leaving && "opacity-0",
        )}
      >
        {group ? "‹ wróć" : "✕ zamknij"}
      </button>

      <p
        className={cn(
          "font-display pointer-events-none absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-[9px] uppercase tracking-[0.3em] text-muted-foreground/70 transition-opacity duration-200",
          leaving && "opacity-0",
        )}
      >
        przeciągnij, by obrócić · dotknij tła, by zamknąć
      </p>
    </div>,
    document.body,
  );
}
