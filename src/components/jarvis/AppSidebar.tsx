import { useCallback, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { ChevronDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useHudNavigate } from "./TransitionContext";
import { MiniArcReactor } from "./MiniArcReactor";
import { ArcReactorTriangle } from "./ArcReactorTriangle";
import { useAgentStatus } from "./useAgentStatus";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { useArkReboot } from "./ArkRebootContext";
import { useShowcase } from "./ShowcaseContext";
import { MODULE_GROUPS, type ModuleEntry } from "./modules";
import { openCommandPalette } from "./commandPaletteBus";

const COLLAPSED_GROUPS_KEY = "jarvis:sidebar:collapsed-groups";

function readCollapsedGroups(): string[] {
  // localStorage throws in private-mode / blocked-storage contexts, and is
  // absent during SSR — a remembered section layout is never worth failing
  // to render the only navigation the app has.
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  // In the icon-collapsed rail there is no room for labels, group headers or
  // the reactor — only the icon column. On mobile the sheet is always full
  // width, so it never takes the collapsed treatment.
  const compact = collapsed && !isMobile;

  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { go, isTransitioning } = useHudNavigate();
  const { isDiagnosticRunning } = useArkReboot();
  const { isRunning: isShowcaseRunning } = useShowcase();
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(readCollapsedGroups);

  const navLocked = isTransitioning || isDiagnosticRunning || isShowcaseRunning;

  const toggleGroup = useCallback((id: string) => {
    setCollapsedGroups((prev) => {
      const next = prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id];
      try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next));
      } catch {
        // Non-fatal: the section state just won't survive a reload.
      }
      return next;
    });
  }, []);

  const navigate = useCallback(
    (item: ModuleEntry) => {
      audio.playClick();
      if (item.url === "/situation-room") {
        speak("Uruchamiam telemetrię satelitarną.");
      }
      if (isMobile) setOpenMobile(false);
      go(item.url);
    },
    [go, isMobile, setOpenMobile],
  );

  return (
    <Sidebar
      collapsible="icon"
      className="shadow-[8px_0_32px_-16px_color-mix(in_oklab,var(--primary)_50%,transparent)]"
    >
      {/* Hairline edge with a vertical falloff, replacing the flat border —
          bright where the rail meets the header, fading toward the floor. */}
      <span className="hud-chrome-edge right" aria-hidden />
      {/* Corner brackets, same instrumentation language as HudPanel. Hidden
          in the icon rail, where there isn't the width to read them. */}
      {!compact && (
        <>
          <span className="hud-corner tl !left-1.5 !top-1.5" aria-hidden />
          <span className="hud-corner bl !bottom-1.5 !left-1.5" aria-hidden />
        </>
      )}

      <SidebarHeader className="relative border-b border-sidebar-border/70 bg-gradient-to-b from-primary/[0.07] to-transparent">
        <div className="flex items-center gap-3 px-2 py-2">
          <MiniArcReactor size={compact ? 26 : 34} />
          {!compact && (
            <div className="min-w-0 leading-tight">
              <p className="font-display truncate text-sm font-bold tracking-[0.25em] text-foreground">
                J.A.R.V.I.S.
              </p>
              <p className="font-display text-[9px] uppercase tracking-[0.3em] text-primary/80">
                v3.14 // online
              </p>
            </div>
          )}
        </div>
        {!compact && (
          <button
            type="button"
            onClick={() => {
              audio.playClick();
              if (isMobile) setOpenMobile(false);
              openCommandPalette();
            }}
            className="font-display mx-2 mb-1 flex items-center gap-2 rounded-[var(--radius-md)] border border-primary/15 bg-primary/[0.04] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:border-primary/35 hover:bg-primary/[0.08] hover:text-primary"
          >
            <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="truncate">Szukaj modułu</span>
            <kbd className="ml-auto shrink-0 rounded border border-primary/20 px-1 py-px text-[9px] tracking-widest text-primary/70">
              ⌘K
            </kbd>
          </button>
        )}
      </SidebarHeader>

      {/* fade-scroll-y: the native bar is hidden per CLAUDE.md, so the cut at
          the top/bottom edge is masked instead of slicing content mid-glyph. */}
      <SidebarContent className="fade-scroll-y">
        <SidebarGroup className="gap-3 px-3 py-3 group-data-[collapsible=icon]:px-1.5">
          {MODULE_GROUPS.map((group) => {
            const isCollapsed = !compact && collapsedGroups.includes(group.id);
            // A collapsed section still has to reveal where you actually are,
            // otherwise the active module can vanish from the rail entirely.
            const holdsActive = group.items.some((i) => i.url === pathname);
            const visible = isCollapsed && !holdsActive ? [] : group.items;

            return (
              <div key={group.id}>
                {!compact && (
                  <button
                    type="button"
                    onClick={() => {
                      audio.playClick();
                      toggleGroup(group.id);
                    }}
                    aria-expanded={!isCollapsed}
                    className="font-display mb-1.5 flex w-full items-center gap-2 px-1 text-[9px] uppercase tracking-[0.35em] text-primary/55 transition-colors hover:text-primary/90"
                  >
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 shrink-0 transition-transform duration-200",
                        isCollapsed && "-rotate-90",
                      )}
                      strokeWidth={2}
                    />
                    <span>{group.label}</span>
                    <span className="h-px flex-1 bg-gradient-to-r from-primary/25 to-transparent" />
                  </button>
                )}
                <SidebarGroupContent>
                  <SidebarMenu className="gap-1">
                    {visible.map((item) => {
                      const active = pathname === item.url;
                      return (
                        <SidebarMenuItem key={item.url}>
                          <SidebarMenuButton
                            isActive={active}
                            disabled={navLocked}
                            tooltip={compact ? item.title : undefined}
                            onClick={() => navigate(item)}
                            // hud-slot carries the whole visual treatment (tick,
                            // hover, active gradient); the data-[active] utility
                            // classes shadcn ships would fight it, so they are
                            // neutralised here rather than in the shared ui/.
                            className="hud-slot data-[active=true]:bg-transparent data-[active=true]:font-normal data-[active=true]:text-primary"
                          >
                            <item.icon className="icon-neon h-4 w-4 shrink-0" strokeWidth={1.5} />
                            {!compact && (
                              <span className="font-display min-w-0 truncate text-[11px] uppercase tracking-[0.2em]">
                                {item.title}
                              </span>
                            )}
                            {active && !compact && (
                              <span className="ml-auto h-1.5 w-1.5 shrink-0 animate-blink rounded-full bg-primary shadow-[0_0_6px_var(--primary)]" />
                            )}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </div>
            );
          })}
        </SidebarGroup>
      </SidebarContent>

      {!compact && (
        <SidebarFooter className="gap-0 border-t border-sidebar-border/70 bg-gradient-to-t from-primary/[0.07] to-transparent p-0">
          <ArcCoreStrip />
        </SidebarFooter>
      )}
    </Sidebar>
  );
}

/**
 * Compact ARC CORE readout.
 *
 * The old footer spent ~200px on a 160px reactor plus two stacked stat
 * rows, which is most of why sixteen modules couldn't fit the rail outside
 * fullscreen. The reactor is now ~96px (80px on mobile, where the sheet
 * also has to clear the browser chrome) and Core/Uptime share one line.
 */
function ArcCoreStrip() {
  const { isMobile } = useSidebar();
  const status = useAgentStatus();

  return (
    <div className="px-3 py-2">
      <div className="font-display flex items-center justify-between text-[9px] uppercase tracking-[0.28em] text-primary/70">
        <span>ARC CORE // J-3140</span>
        <span className="flex items-center gap-1 text-primary">
          <span
            className="h-1.5 w-1.5 animate-blink rounded-full"
            style={{ backgroundColor: "var(--primary)" }}
          />
          Live
        </span>
      </div>

      <div className="mt-1 flex items-center justify-center">
        <ArcReactorTriangle
          className={cn("!w-[96px] short:!w-[72px]", isMobile && "!w-[80px] short:!w-[64px]")}
        />
      </div>

      <div
        className="font-display mt-0.5 text-center text-[9px] uppercase tracking-[0.28em]"
        style={{ color: status.color }}
      >
        {status.label}
      </div>

      <div className="font-display mt-1.5 flex items-center justify-between gap-2 border-t border-sidebar-border/50 pt-1.5 text-[10px] uppercase tracking-widest">
        <span className="flex items-center gap-1.5" style={{ color: "var(--success)" }}>
          <span
            className="h-1.5 w-1.5 animate-blink rounded-full"
            style={{ backgroundColor: "var(--success)" }}
          />
          Core
        </span>
        <span className="text-muted-foreground">
          Uptime <span className="text-foreground">42d 11h</span>
        </span>
      </div>
    </div>
  );
}
