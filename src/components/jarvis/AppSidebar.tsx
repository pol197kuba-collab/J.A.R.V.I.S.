import { useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Bot, Terminal, Settings as SettingsIcon, Boxes, Radar, Eye } from "lucide-react";
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
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { useArkReboot } from "./ArkRebootContext";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Agent Hub", url: "/agent-hub", icon: Bot },
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
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-2">
          <MiniArcReactor size={36} />
          {!collapsed && (
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
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="font-display text-[10px] uppercase tracking-[0.3em]">
              Modules
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
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
                      className="group data-[active=true]:bg-primary/10 data-[active=true]:text-primary hover:text-primary"
                    >
                      <item.icon className="icon-neon h-4 w-4" strokeWidth={1.5} />
                      {!collapsed && (
                        <span className="font-display text-xs uppercase tracking-[0.2em]">
                          {item.title}
                        </span>
                      )}
                      {active && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-[var(--glow-primary)]" />
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {!collapsed && (
        <SidebarFooter className="border-t border-sidebar-border">
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