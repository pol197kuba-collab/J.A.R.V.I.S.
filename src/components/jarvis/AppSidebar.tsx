import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Bot, Terminal, Settings as SettingsIcon } from "lucide-react";
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

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Agent Hub", url: "/agent-hub", icon: Bot },
  { title: "System Logs", url: "/system-logs", icon: Terminal },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="relative h-9 w-9 shrink-0">
            <div className="absolute inset-0 rounded-full border border-primary/40" />
            <div
              className="animate-pulse-core absolute inset-1.5 rounded-full"
              style={{ background: "var(--gradient-core)", boxShadow: "var(--glow-primary)" }}
            />
            <div className="absolute inset-[35%] rounded-full bg-foreground" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <p className="font-display text-sm font-bold tracking-[0.25em] text-foreground">
                JARVIS
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
                      asChild
                      isActive={active}
                      className="data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
                    >
                      <Link to={item.url} className="flex items-center gap-3">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && (
                          <span className="font-display text-xs uppercase tracking-[0.2em]">
                            {item.title}
                          </span>
                        )}
                        {active && (
                          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-[var(--glow-primary)]" />
                        )}
                      </Link>
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