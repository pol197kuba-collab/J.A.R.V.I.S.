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
import { ArkRebootProvider, useArkReboot } from "@/components/jarvis/ArkRebootContext";
import { ArkRebootOverlay } from "@/components/jarvis/ArkRebootOverlay";
import { RebootButton } from "@/components/jarvis/RebootButton";
import { isFullscreen, onFullscreenChange, toggleAppFullscreen } from "@/lib/fullscreen";
import type { AppPhase } from "@/components/jarvis/PhaseContext";

/**
 * DashboardShell — the chrome around the active JARVIS dashboard
 * (sidebar + HUD header + route outlet + transition overlay).
 * Split out of __root.tsx for clarity.
 */
export function DashboardShell({ phase, onShutdown }: { phase: AppPhase; onShutdown: () => void }) {
  return (
    <ArkRebootProvider>
      <DashboardShellInner phase={phase} onShutdown={onShutdown} />
    </ArkRebootProvider>
  );
}

function DashboardShellInner({ phase, onShutdown }: { phase: AppPhase; onShutdown: () => void }) {
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
    return () => window.removeEventListener("jarvis:sidebar", onSidebarCmd as EventListener);
  }, [isMobile, setOpen, setOpenMobile]);

  return (
    <div className="relative flex min-h-screen w-full bg-background text-foreground portrait:h-[100dvh] portrait:min-h-0 portrait:overflow-hidden landscape:max-md:h-[100dvh] landscape:max-md:min-h-0 landscape:max-md:overflow-hidden short:h-[100dvh] short:min-h-0 short:overflow-hidden">
      <JarvisBackdrop />
      <div className="relative z-10 contents">
        <AppSidebar />
      </div>
      <div className="relative z-10 flex min-h-screen min-w-0 flex-1 flex-col portrait:min-h-0 landscape:max-md:min-h-0 short:min-h-0">
        <header className="sticky top-0 z-10 flex h-12 min-w-0 items-center gap-2 overflow-hidden border-b border-primary/20 bg-gradient-to-b from-black/80 to-black/50 px-4 backdrop-blur-xl shadow-[0_8px_24px_-16px_color-mix(in_oklab,var(--primary)_60%,transparent)] portrait:h-10 landscape:max-md:h-8 landscape:max-md:gap-1.5 landscape:max-md:px-2 short:h-8 short:gap-1.5 short:px-2">
          <HudMenuTrigger />
          <div className="h-4 w-px bg-gradient-to-b from-transparent via-primary/40 to-transparent" />
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
            <div className="ml-3 h-4 w-px bg-gradient-to-b from-transparent via-primary/40 to-transparent portrait:ml-1" />
            <HeaderVoiceToggle />
            <div className="h-4 w-px bg-gradient-to-b from-transparent via-primary/40 to-transparent" />
            <RebootButton />
            <div className="h-4 w-px bg-gradient-to-b from-transparent via-primary/40 to-transparent portrait:hidden short:hidden" />
            <FullscreenToggle />
            <div className="h-4 w-px bg-gradient-to-b from-transparent via-primary/40 to-transparent" />
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
      className="font-display group relative flex items-center gap-1.5 rounded-md border border-primary/40 bg-gradient-to-b from-primary/10 to-primary/[0.02] px-2.5 py-1 text-[10px] uppercase tracking-[0.28em] text-primary shadow-[inset_0_1px_0_color-mix(in_oklab,var(--primary)_20%,transparent),0_0_12px_-4px_color-mix(in_oklab,var(--primary)_60%,transparent)] transition-all duration-200 hover:border-primary/70 hover:bg-primary/15 hover:text-foreground hover:shadow-[inset_0_1px_0_color-mix(in_oklab,var(--primary)_30%,transparent),0_0_18px_-4px_var(--primary)] landscape:max-md:px-1.5 landscape:max-md:py-0.5 landscape:max-md:text-[8px] landscape:max-md:tracking-[0.2em]"
    >
      <Menu className="h-3.5 w-3.5 landscape:max-md:h-3 landscape:max-md:w-3" strokeWidth={1.5} />
      <span className="portrait:hidden">MENU // SYS</span>
    </button>
  );
}

function JarvisBackdrop() {
  const particles = Array.from({ length: 14 }).map((_, i) => {
    const seed = i * 97 + 13;
    const left = (seed * 37) % 100;
    const top = (seed * 53) % 100;
    const px = ((seed * 17) % 80) - 40;
    const py = -60 - ((seed * 23) % 80);
    const dur = 10 + ((seed * 7) % 12);
    const delay = ((seed * 11) % 100) / 10;
    return { i, left, top, px, py, dur, delay };
  });
  return (
    <div className="jarvis-bg-root" aria-hidden>
      <div className="jarvis-bg-radials" />
      <div className="jarvis-bg-grid" />
      <div className="jarvis-bg-scan" />
      <div className="jarvis-bg-particles">
        {particles.map((p) => (
          <span
            key={p.i}
            className="hud-particle"
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              ["--px" as string]: `${p.px}px`,
              ["--py" as string]: `${p.py}px`,
              ["--dur" as string]: `${p.dur}s`,
              ["--delay" as string]: `${p.delay}s`,
            }}
          />
        ))}
      </div>
      <div className="jarvis-bg-vignette" />
    </div>
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
      className="flex items-center justify-center rounded-md border border-primary/40 bg-primary/[0.06] p-1.5 text-primary shadow-[inset_0_1px_0_color-mix(in_oklab,var(--primary)_18%,transparent)] transition-all duration-200 hover:border-primary/70 hover:bg-primary/15 hover:text-foreground hover:shadow-[0_0_12px_-4px_var(--primary)] portrait:hidden"
    >
      <Icon className="h-3 w-3" strokeWidth={1.75} />
    </button>
  );
}
