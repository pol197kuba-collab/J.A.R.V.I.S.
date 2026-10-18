import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouterState } from "@tanstack/react-router";

import { cn } from "@/lib/utils";
import { useHudNavigate } from "./TransitionContext";
import { useArkReboot } from "./ArkRebootContext";
import { useShowcase } from "./ShowcaseContext";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { GlobalVoiceCommand } from "./GlobalVoiceCommand";
import { MiniArcReactor } from "./MiniArcReactor";
import { MENU_GROUPS, MODULE_ITEMS, type ModuleEntry, type ModuleGroup } from "./modules";

/**
 * Mobile-only navigation bar pinned to the bottom of the viewport.
 *
 * Three cells: the module you're on, the reactor that opens the menu, and the
 * mic. The menu itself is radial — four group nodes around the reactor, then
 * the group's modules around it — so every module is two taps away and none
 * hides behind a horizontal scroll. Uses the same HUD transition navigation
 * as the desktop sidebar.
 */
export function MobileBottomNav({ showVoice = true }: { showVoice?: boolean }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [open, setOpen] = useState(false);
  const current = MODULE_ITEMS.find((m) => m.url === pathname);

  const toggle = () => {
    audio.playClick();
    setOpen((v) => !v);
  };

  return (
    <nav
      aria-label="Modules"
      className="hud-chrome relative z-20 shrink-0 border-t border-primary/20 shadow-[0_-8px_28px_-18px_color-mix(in_oklab,var(--primary)_70%,transparent)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Mikrofon NALEŻY do paska (nie unosi się nad nim), więc nie zasłania
          niczego w treści strony — wcześniej lądował na polu wysyłki czatu. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={toggle}
          className="flex min-w-0 items-center gap-2 justify-self-start rounded-xl px-2 py-1 text-primary"
        >
          {current && <current.icon className="icon-neon h-4 w-4 shrink-0" strokeWidth={1.5} />}
          <span className="font-display min-w-0 truncate text-[9px] uppercase tracking-[0.22em]">
            {current?.shortTitle ?? "Menu"}
          </span>
        </button>

        <button
          type="button"
          onClick={toggle}
          aria-label="Menu modułów"
          aria-expanded={open}
          className="relative flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 bg-primary/[0.06] shadow-[0_0_18px_-6px_var(--primary)]"
        >
          <MiniArcReactor size={34} />
        </button>

        <div className="flex justify-self-end">{showVoice && <GlobalVoiceCommand />}</div>
      </div>

      {open && <ReactorMenu pathname={pathname} onClose={() => setOpen(false)} />}
    </nav>
  );
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
