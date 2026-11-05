import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { cn } from "@/lib/utils";
import { useHudNavigate, useRouteTransition } from "./TransitionContext";
import { useArkReboot } from "./ArkRebootContext";
import { useShowcase } from "./ShowcaseContext";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { GlobalVoiceCommand } from "./GlobalVoiceCommand";
import { MiniArcReactor } from "./MiniArcReactor";
import { OrbitMenu } from "./OrbitMenu";
import { MENU_GROUPS, MODULE_ITEMS, type ModuleEntry, type ModuleGroup } from "./modules";
import { agentDots, dockLine, reactorState, type AgentDot } from "./dockWidgets";
import { listAgents } from "@/lib/agents/runtime.functions";
import { listTasks } from "@/lib/tasks/tasks.functions";
import { getFund } from "@/lib/fund/fund.functions";
import { townFund } from "@/components/town/townFund";
// Type-only: erased at build, so three.js never reaches the main bundle.
import type { MenuControl } from "./module-transition/createTransitionScene";

/**
 * Mobile-only dock pinned to the bottom of the viewport.
 *
 * Glass belt with the Arc Core raised in a socket in the middle (it opens the
 * menu and spins up / turns red with the agents' real state), the module you're
 * on with one live number on the left, the agents' status dots and the mic on
 * the right. It slides away while you scroll down and comes back on the way up.
 *
 * The menu is the 3D "Orbita" (sections and modules as nodes around the Arc
 * Core, flowing straight into the module tunnel) when the 3D layer is on;
 * otherwise the flat radial menu below.
 */
export function MobileBottomNav({ showVoice = true }: { showVoice?: boolean }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [open, setOpen] = useState<null | { menu: MenuControl | null }>(null);
  const { menu3d } = useRouteTransition();
  const current = MODULE_ITEMS.find((m) => m.url === pathname);
  const hidden = useHideOnScroll(open !== null, pathname);
  const { dots, line } = useDockData(pathname);
  const state = reactorState(dots);

  const toggle = () => {
    audio.playClick();
    setOpen((v) => (v ? null : { menu: menu3d() }));
  };
  const close = () => setOpen(null);

  return (
    <nav
      aria-label="Modules"
      className="relative z-20 shrink-0 transition-[margin,transform] duration-300 ease-out motion-reduce:transition-none"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
        // slides below the screen edge; <main> (flex-1) takes the room back
        marginBottom: hidden ? "calc(-1 * (64px + env(safe-area-inset-bottom)))" : 0,
        transform: hidden ? "translateY(20px)" : undefined,
      }}
    >
      {/* the belt: glass, a lit top edge that dips into the reactor's socket */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-background/80 backdrop-blur-xl"
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex h-10">
        <span className="mt-0 h-px flex-1 bg-gradient-to-r from-transparent via-primary/35 to-primary/60" />
        <svg viewBox="0 0 96 40" className="h-10 w-24 shrink-0 overflow-visible">
          <path
            d="M0 0.5 H10 A38 38 0 0 0 86 0.5 H96"
            fill="none"
            strokeWidth="1"
            style={{
              stroke: "color-mix(in oklab, var(--primary) 60%, transparent)",
              filter: "drop-shadow(0 0 4px var(--primary))",
            }}
          />
        </svg>
        <span className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/35 to-primary/60" />
      </div>

      {/* Mikrofon NALEŻY do paska (nie unosi się nad nim), więc nie zasłania
          niczego w treści strony — wcześniej lądował na polu wysyłki czatu. */}
      <div className="relative grid h-16 grid-cols-[1fr_96px_1fr] items-center px-3">
        <button
          type="button"
          onClick={toggle}
          className="flex min-w-0 flex-col items-start justify-self-stretch rounded-xl px-1 py-1 text-left"
        >
          <span className="flex min-w-0 max-w-full items-center gap-1.5 text-primary">
            {current && (
              <current.icon className="icon-neon h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            )}
            <span className="font-display min-w-0 truncate text-[10px] uppercase tracking-[0.22em]">
              {current?.shortTitle ?? "Menu"}
            </span>
          </span>
          {line && (
            <span className="mt-0.5 min-w-0 max-w-full truncate font-mono text-[10px] text-muted-foreground">
              {line}
            </span>
          )}
        </button>

        {/* the Arc Core in its socket, raised above the belt */}
        <div className="relative h-full">
          <button
            type="button"
            onClick={toggle}
            aria-label="Menu modułów"
            aria-expanded={open !== null}
            className="absolute top-[-14px] left-1/2 flex h-[60px] w-[60px] -translate-x-1/2 items-center justify-center rounded-full border border-primary/50 bg-background shadow-[0_0_22px_-6px_var(--primary)]"
          >
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute -inset-[5px] rounded-full border border-dashed",
                state === "error"
                  ? "border-destructive/80 motion-safe:animate-[spin_6s_linear_infinite]"
                  : state === "busy"
                    ? "border-reactor/80 motion-safe:animate-[spin_3s_linear_infinite]"
                    : "border-primary/25 motion-safe:animate-[spin_24s_linear_infinite]",
              )}
            />
            {state === "busy" && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_24px_-2px_var(--reactor)] motion-safe:animate-pulse"
              />
            )}
            <MiniArcReactor size={38} />
          </button>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-3">
          <AgentDots dots={dots} />
          {showVoice && <GlobalVoiceCommand />}
        </div>
      </div>

      {open &&
        (open.menu ? (
          <OrbitMenu pathname={pathname} menu={open.menu} onClose={close} />
        ) : (
          <ReactorMenu pathname={pathname} onClose={close} />
        ))}
    </nav>
  );
}

/** Status dots of the enabled agents: amber pulse = working, red = error. */
function AgentDots({ dots }: { dots: AgentDot[] }) {
  if (!dots.length) return null;
  const shown = dots.slice(0, 8);
  return (
    <div
      className="grid shrink-0 grid-cols-4 gap-1"
      role="img"
      aria-label={`Agenci: ${dots
        .map(
          (d) =>
            `${d.name} ${d.state === "busy" ? "pracuje" : d.state === "error" ? "błąd" : "wolny"}`,
        )
        .join(", ")}`}
    >
      {shown.map((d) => (
        <span
          key={d.slug}
          title={d.name}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            d.state === "busy" &&
              "bg-reactor shadow-[0_0_6px_var(--reactor)] motion-safe:animate-pulse",
            d.state === "error" && "bg-destructive shadow-[0_0_6px_var(--destructive)]",
            d.state === "idle" && "bg-primary/35",
          )}
        />
      ))}
    </div>
  );
}

/** Real data for the dock: the same query keys the modules use, so it is shared cache. */
function useDockData(pathname: string) {
  const fetchAgents = useServerFn(listAgents);
  const { data: agents } = useQuery({
    queryKey: ["agents", "list"],
    queryFn: () => fetchAgents(),
    refetchInterval: 15_000,
  });
  const fetchTasks = useServerFn(listTasks);
  const { data: tasks } = useQuery({
    queryKey: ["tasks", "open"],
    queryFn: () => fetchTasks({ data: { scope: "open" } }),
    refetchInterval: 60_000,
  });
  const fetchFund = useServerFn(getFund);
  const { data: fund } = useQuery({
    queryKey: ["fund"],
    queryFn: () => fetchFund(),
    staleTime: 5 * 60_000,
    enabled: pathname === "/rynki",
  });
  const dots = agentDots(agents);
  const line = dockLine(pathname, {
    fundDayPct: pathname === "/rynki" ? (townFund(fund)?.dayAvg ?? null) : null,
    openTasks: Array.isArray(tasks) ? tasks.length : null,
    dots,
  });
  return { dots, line };
}

/** true while the page is being scrolled down (the dock slides away), false on the way up. */
function useHideOnScroll(pinned: boolean, pathname: string): boolean {
  const [hidden, setHidden] = useState(false);
  // a new module starts at the top: show the dock again
  useEffect(() => setHidden(false), [pathname]);
  const last = useRef(new WeakMap<EventTarget, number>());
  useEffect(() => {
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el.tagName !== "MAIN") return;
      const prev = last.current.get(el) ?? el.scrollTop;
      const y = el.scrollTop;
      last.current.set(el, y);
      if (y < 48) setHidden(false);
      else if (y - prev > 6) setHidden(true);
      else if (prev - y > 6) setHidden(false);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);
  return hidden && !pinned;
}

type RingNode = {
  key: string;
  label: string;
  icon: ModuleEntry["icon"];
  active: boolean;
  onTap: () => void;
};

const groupOf = (pathname: string): ModuleGroup | undefined =>
  MENU_GROUPS.find((g) => g.items.some((i) => i.url === pathname));

/** Unit-circle position of node `i` of `n`, starting at 12 o'clock. */
const ringPos = (i: number, n: number) => {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
  return { x: Math.cos(a), y: Math.sin(a) };
};

function ReactorMenu({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const { go, isTransitioning } = useHudNavigate();
  const { isDiagnosticRunning } = useArkReboot();
  const { isRunning: isShowcaseRunning } = useShowcase();
  const locked = isTransitioning || isDiagnosticRunning || isShowcaseRunning;

  const [group, setGroup] = useState<ModuleGroup | null>(null);
  const activeGroup = groupOf(pathname);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (group) setGroup(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [group, onClose]);

  const back = () => {
    audio.playClick();
    if (group) setGroup(null);
    else onClose();
  };

  const openModule = (item: ModuleEntry) => {
    if (locked) return;
    audio.playClick();
    if (item.url === "/situation-room") speak("Uruchamiam telemetrię satelitarną.");
    onClose();
    if (item.url !== pathname) go(item.url);
  };

  const nodes: RingNode[] = group
    ? group.items.map((item) => ({
        key: item.url,
        label: item.shortTitle,
        icon: item.icon,
        active: item.url === pathname,
        onTap: () => openModule(item),
      }))
    : MENU_GROUPS.map((g) => ({
        key: g.id,
        label: g.label,
        icon: g.icon,
        active: g.id === activeGroup?.id,
        onTap: () => {
          audio.playClick();
          setGroup(g);
        },
      }));

  // Pierścień rośnie z liczbą węzłów, ale z węzłem (56 px) i podpisem mieści
  // się w szerokości telefonu.
  const radius = nodes.length > 4 ? "min(36vw, 150px)" : "min(30vw, 120px)";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Menu modułów"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-md motion-safe:animate-in motion-safe:fade-in"
      onClick={onClose}
    >
      <p className="font-display absolute top-[max(1.5rem,env(safe-area-inset-top))] text-[10px] uppercase tracking-[0.35em] text-primary/70">
        {group ? `Menu // ${group.label}` : "Menu // wybierz sekcję"}
      </p>

      <div
        className="relative h-[min(100vw,420px)] w-[min(100vw,420px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <svg
          viewBox="0 0 100 100"
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full animate-mini-reactor-spin"
        >
          <circle
            cx="50"
            cy="50"
            r="38"
            fill="none"
            strokeWidth="0.3"
            strokeDasharray="1 2"
            style={{ stroke: "color-mix(in oklab, var(--primary) 45%, transparent)" }}
          />
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            strokeWidth="0.2"
            style={{ stroke: "color-mix(in oklab, var(--primary) 20%, transparent)" }}
          />
          {/* the intro's triangular gates, so the flat menu speaks the same language */}
          <polygon
            points="50,8 86.4,71 13.6,71"
            fill="none"
            strokeWidth="0.35"
            style={{ stroke: "color-mix(in oklab, var(--primary) 35%, transparent)" }}
          />
          <polygon
            points="50,92 13.6,29 86.4,29"
            fill="none"
            strokeWidth="0.2"
            style={{ stroke: "color-mix(in oklab, var(--primary) 18%, transparent)" }}
          />
        </svg>

        {/* Środek: na poziomie sekcji zamyka menu, na poziomie modułów wraca. */}
        <button
          type="button"
          onClick={back}
          aria-label={group ? "Wróć do sekcji" : "Zamknij menu"}
          className="absolute top-1/2 left-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full border border-primary/50 bg-background/80 shadow-[0_0_28px_-6px_var(--primary)]"
        >
          <MiniArcReactor size={40} />
          <span className="font-display text-[7px] uppercase tracking-[0.25em] text-primary/80">
            {group ? "wróć" : "zamknij"}
          </span>
        </button>

        {/* key: zmiana poziomu przemontowuje węzły, żeby rozbłysły od nowa. */}
        <div key={group?.id ?? "groups"}>
          {nodes.map((n, i) => {
            const { x, y } = ringPos(i, nodes.length);
            return (
              <div
                key={n.key}
                className="absolute top-1/2 left-1/2"
                style={{
                  transform: `translate(-50%, -50%) translate(calc(${x.toFixed(4)} * ${radius}), calc(${y.toFixed(4)} * ${radius}))`,
                }}
              >
                <button
                  type="button"
                  disabled={group !== null && locked}
                  onClick={n.onTap}
                  aria-current={n.active ? "page" : undefined}
                  className="relative block motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:fill-mode-both disabled:opacity-50"
                  style={{ animationDelay: `${i * 35}ms` }}
                >
                  <span
                    className={cn(
                      "flex h-14 w-14 items-center justify-center rounded-full border transition-colors",
                      n.active
                        ? "border-primary bg-primary/20 text-primary shadow-[0_0_18px_-4px_var(--primary)]"
                        : "border-primary/35 bg-background/90 text-primary/80",
                    )}
                  >
                    <n.icon className="icon-neon h-5 w-5" strokeWidth={1.5} />
                  </span>
                  <span
                    className={cn(
                      "font-display absolute top-full left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-[8px] uppercase tracking-[0.18em]",
                      n.active ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {n.label}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <p className="font-display absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] text-[9px] uppercase tracking-[0.3em] text-muted-foreground/70">
        dotknij tła, by zamknąć
      </p>
    </div>,
    document.body,
  );
}
