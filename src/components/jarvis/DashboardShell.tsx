import { Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, Maximize2, Minimize2 } from "lucide-react";

import { AppSidebar } from "@/components/jarvis/AppSidebar";
import { DeactivateButton } from "@/components/jarvis/DeactivateButton";
import { HudRouteTransition } from "@/components/jarvis/HudRouteTransition";
import { MiniArcReactor } from "@/components/jarvis/MiniArcReactor";
import { useRouteTransition } from "@/components/jarvis/TransitionContext";
import { useSidebar } from "@/components/ui/sidebar";
import { audio } from "@/lib/audio/AudioEngine";
import { HeaderVoiceToggle } from "@/components/jarvis/HeaderVoiceToggle";
import {
  ArkRebootProvider,
  useArkReboot,
} from "@/components/jarvis/ArkRebootContext";
import { ArkRebootOverlay } from "@/components/jarvis/ArkRebootOverlay";
import { RebootButton } from "@/components/jarvis/RebootButton";
import {
  isFullscreen,
  onFullscreenChange,
  toggleAppFullscreen,
} from "@/lib/fullscreen";
import type { AppPhase } from "@/components/jarvis/PhaseContext";

/**
 * DashboardShell — the chrome around the active JARVIS dashboard
 * (sidebar + HUD header + route outlet + transition overlay).
 * Split out of __root.tsx for clarity.
 */
export function DashboardShell({
  phase,
  onShutdown,
}: {
  phase: AppPhase;
  onShutdown: () => void;
}) {
  return (
    <ArkRebootProvider>
      <DashboardShellInner phase={phase} onShutdown={onShutdown} />
    </ArkRebootProvider>
  );
}

function DashboardShellInner({
  phase,
  onShutdown,
}: {
  phase: AppPhase;
  onShutdown: () => void;
}) {
  const { transition } = useRouteTransition();
  const { setOpen, setOpenMobile, isMobile } = useSidebar();
  const { isDiagnosticRunning } = useArkReboot();

  // Bridge for voice commands ("open menu" / "close menu") dispatched via
  // window events. TODO: migrate this off the window event bus onto a
  // dedicated SidebarContext to drop the global listener.
  useEffect(() => {
    function onSidebarCmd(e: Event) {
      const detail = (e as CustomEvent<"open" | "close">).detail;
      if (isMobile) setOpenMobile(detail === "open");
      else setOpen(detail === "open");
    }
    window.addEventListener("jarvis:sidebar", onSidebarCmd as EventListener);
    return () =>
      window.removeEventListener("jarvis:sidebar", onSidebarCmd as EventListener);
  }, [isMobile, setOpen, setOpenMobile]);

  return (
    <div className="relative flex min-h-screen w-full bg-background text-foreground portrait:h-[100dvh] portrait:min-h-0 portrait:overflow-hidden landscape:max-md:h-[100dvh] landscape:max-md:min-h-0 landscape:max-md:overflow-hidden short:h-[100dvh] short:min-h-0 short:overflow-hidden">
      <div className="bg-grid pointer-events-none fixed inset-0 opacity-30" aria-hidden />
      <div
        className="pointer-events-none fixed inset-0 opacity-60"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse at 50% -10%, oklch(0.55 0.18 200 / 0.10), transparent 55%), radial-gradient(ellipse at 80% 100%, oklch(0.5 0.18 200 / 0.06), transparent 60%)",
        }}
      />
      <AppSidebar />
      <div className="relative flex min-h-screen min-w-0 flex-1 flex-col portrait:min-h-0 landscape:max-md:min-h-0 short:min-h-0">
        <header className="sticky top-0 z-10 flex h-12 min-w-0 items-center gap-2 overflow-hidden border-b border-primary/30 bg-black/70 px-4 backdrop-blur portrait:h-10 landscape:max-md:h-8 landscape:max-md:gap-1.5 landscape:max-md:px-2 short:h-8 short:gap-1.5 short:px-2">
          <HudMenuTrigger />
          <div className="h-4 w-px bg-primary/40" />
          <MiniArcReactor size={20} />
          <span className="font-display text-[10px] uppercase tracking-[0.3em] text-primary/80 portrait:hidden landscape:max-md:text-[8px] landscape:max-md:tracking-[0.2em] short:hidden">
            J.A.R.V.I.S. // STARK SECURE TERMINAL
          </span>
          <div className="ml-auto flex min-w-0 items-center gap-2 overflow-hidden font-display text-[10px] uppercase tracking-widest portrait:gap-1.5 landscape:max-md:text-[8px] landscape:max-md:gap-1.5 short:text-[8px] short:gap-1.5">
            <span
              className="h-1.5 w-1.5 animate-blink rounded-full"
              style={{ backgroundColor: "var(--success)" }}
            />
            <span
              className="portrait:hidden landscape:max-md:hidden short:hidden"
              style={{ color: "var(--success)" }}
            >
              All Systems Nominal
            </span>
            <div className="ml-3 h-4 w-px bg-primary/40 portrait:ml-1" />
            <HeaderVoiceToggle />
            <div className="h-4 w-px bg-primary/40" />
            <RebootButton />
            <div className="h-4 w-px bg-primary/40 portrait:hidden short:hidden" />
            <FullscreenToggle />
            <div className="h-4 w-px bg-primary/40" />
            <DeactivateButton onClick={onShutdown} />
          </div>
        </header>
        <main
          className={
            "relative flex-1 overflow-hidden landscape:max-md:overflow-auto short:overflow-auto" +
            (transition === "dematerialize" ? " animate-hud-dematerialize" : "") +
            (isDiagnosticRunning ? " ark-dimmed" : "")
          }
        >
          <Outlet />
          <HudRouteTransition />
        </main>
        <ArkRebootOverlay />
        {phase === "shutdown" && (
          <div
            className="pointer-events-none fixed inset-0 z-[90] bg-black animate-shutdown-flash"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

function HudMenuTrigger() {
  const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      onClick={() => {
        audio.playClick();
        if (isMobile) setOpenMobile(true);
        else toggleSidebar();
      }}
      aria-label="Open menu"
      className="font-display group relative flex items-center gap-1.5 border border-primary/60 bg-primary/5 px-2 py-1 text-[10px] uppercase tracking-[0.3em] text-primary shadow-[0_0_10px_rgba(56,189,248,0.35)] transition hover:bg-primary/15 hover:text-foreground landscape:max-md:px-1.5 landscape:max-md:py-0.5 landscape:max-md:text-[8px] landscape:max-md:tracking-[0.2em]"
    >
      <Menu className="h-3.5 w-3.5 landscape:max-md:h-3 landscape:max-md:w-3" strokeWidth={1.5} />
      <span className="portrait:hidden">MENU // SYS</span>
    </button>
  );
}

function FullscreenToggle() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    setActive(isFullscreen());
    return onFullscreenChange(() => setActive(isFullscreen()));
  }, []);
  const Icon = active ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      onClick={() => {
        audio.playClick();
        void toggleAppFullscreen();
      }}
      aria-label={active ? "Exit fullscreen" : "Enter fullscreen"}
      className="flex items-center justify-center border border-primary/50 bg-primary/5 p-1 text-primary transition hover:bg-primary/15 hover:text-foreground portrait:hidden"
    >
      <Icon className="h-3 w-3" strokeWidth={1.75} />
    </button>
  );
}