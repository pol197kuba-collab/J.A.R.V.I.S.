import { useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Bot,
  Terminal,
  Settings as SettingsIcon,
  Boxes,
  Radar,
  Eye,
  ListChecks,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Agent Hub", url: "/agent-hub", icon: Bot },
  { title: "Tasks", url: "/tasks", icon: ListChecks },
  { title: "Sub-Systems", url: "/sub-systems", icon: Boxes },
  { title: "Geo-Tracking", url: "/geo-tracking", icon: Radar },
  { title: "Vision", url: "/vision", icon: Eye },
  { title: "System Logs", url: "/system-logs", icon: Terminal },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
] as const;

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { go, isTransitioning } = useHudNavigate();
  const { isDiagnosticRunning } = useArkReboot();

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border/40 bg-gradient-to-b from-black/70 via-black/50 to-black/70 backdrop-blur-xl shadow-[8px_0_32px_-16px_color-mix(in_oklab,var(--primary)_50%,transparent)]"
    >
      <SidebarHeader className="border-b border-sidebar-border/30 bg-gradient-to-b from-primary/[0.08] to-transparent">
        <div className="flex items-center gap-3 px-2 py-2">
          <MiniArcReactor size={36} />
          {(!collapsed || isMobile) && (
            <div className="leading-tight">
              <p className="font-display text-sm font-bold tracking-[0.25em] text-foreground">
                J.A.R.V.I.S.
              </p>
              <p className="font-display text-[9px] uppercase tracking-[0.3em] text-primary/80">
                v3.14 // online
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-3 py-3">
          {(!collapsed || isMobile) && (
            <SidebarGroupLabel className="font-display mb-2 flex items-center gap-2 text-[9px] uppercase tracking-[0.35em] text-primary/60">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent to-primary/30" />
              Modules
              <span className="h-px flex-1 bg-gradient-to-l from-transparent to-primary/30" />
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent
            className={cn(
              "rounded-[var(--radius-md)] border border-primary/10 p-1.5",
              "bg-gradient-to-b from-primary/[0.04] via-transparent to-primary/[0.03]",
              "shadow-[inset_0_1px_0_color-mix(in_oklab,var(--primary)_12%,transparent),0_8px_24px_-16px_color-mix(in_oklab,var(--primary)_40%,transparent)]",
            )}
          >
            <SidebarMenu className="gap-1.5">
              {items.map((item) => {
                const active = pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      isActive={active}
                      disabled={isTransitioning || isDiagnosticRunning}
                      onClick={() => {
                        audio.playClick();
                        if (item.url === "/geo-tracking") {
                          speak("Uruchamiam telemetrię satelitarną.");
                        }
                        if (isMobile) setOpenMobile(false);
                        go(item.url);
                      }}
                      className={cn(
                        "group relative overflow-hidden rounded-[var(--radius-md)] transition-all duration-250 hover:bg-primary/[0.06] hover:text-primary",
                        "data-[active=true]:bg-gradient-to-r data-[active=true]:from-primary/15 data-[active=true]:via-primary/8 data-[active=true]:to-transparent",
                        "data-[active=true]:text-primary data-[active=true]:shadow-[inset_0_1px_0_color-mix(in_oklab,var(--primary)_25%,transparent),0_0_20px_-8px_var(--primary)]",
                        active && "before:absolute before:left-0 before:top-1/2 before:h-6 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary before:shadow-[0_0_10px_var(--primary),0_0_20px_var(--primary)]",
                      )}
                    >
                      <item.icon className="icon-neon h-4 w-4" strokeWidth={1.5} />
                      {(!collapsed || isMobile) && (
                        <span className="font-display text-[11px] uppercase tracking-[0.2em]">
                          {item.title}
                        </span>
                      )}
                      {active && (
                        <span className="ml-auto flex items-center gap-1">
                          <span className="h-1 w-1 animate-blink rounded-full bg-primary shadow-[0_0_6px_var(--primary)]" />
                          <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[var(--glow-primary)]" />
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {(!collapsed || isMobile) && (
        <SidebarFooter className="border-t border-sidebar-border/30 bg-gradient-to-t from-primary/[0.08] to-transparent">
          <ArcCorePanel />
          <div className="space-y-1 px-2 py-2">
            <div className="flex items-center justify-between text-[10px] font-display uppercase tracking-widest">
              <span className="text-muted-foreground">Core</span>
              <span className="flex items-center gap-1.5 text-[color:var(--success)]">
                <span
                  className="h-1.5 w-1.5 animate-blink rounded-full"
                  style={{ backgroundColor: "var(--success)" }}
                />
                Online
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] font-display uppercase tracking-widest text-muted-foreground">
              <span>Uptime</span>
              <span className="text-foreground">42d 11h</span>
            </div>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}

function ArcCorePanel() {
  const { isMobile } = useSidebar();
  const status = useAgentStatus();

  return (
    <div className={cn("border-b border-sidebar-border px-2", isMobile ? "py-1.5" : "py-2")}>
      <div className="flex items-center justify-between font-display text-[9px] uppercase tracking-[0.28em] text-primary/80">
        <span>ARC CORE // J-3140</span>
        <span className="flex items-center gap-1 text-primary">
          <span
            className="h-1.5 w-1.5 animate-blink rounded-full"
            style={{ backgroundColor: "var(--primary)" }}
          />
          LIVE
        </span>
      </div>
      <div className="mx-auto mt-1 flex w-full items-center justify-center">
        <ArcReactorTriangle
          className={cn(
            "!w-[160px] short:!w-[100px]",
            isMobile && "!w-[100px] short:!w-[80px]"
          )}
        />
      </div>
      <div className="mt-1 text-center font-display text-[9px] uppercase tracking-[0.28em]" style={{ color: status.color }}>
        {status.label}
      </div>
    </div>
  );
}