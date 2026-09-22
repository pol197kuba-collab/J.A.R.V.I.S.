import { Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, Maximize2, Minimize2, SlidersHorizontal } from "lucide-react";

import { AppSidebar } from "@/components/jarvis/AppSidebar";
import { DeactivateButton } from "@/components/jarvis/DeactivateButton";
import { HudRouteTransition } from "@/components/jarvis/HudRouteTransition";
import { MiniArcReactor } from "@/components/jarvis/MiniArcReactor";
import { useRouteTransition } from "@/components/jarvis/TransitionContext";
import { useSidebar } from "@/components/ui/sidebar";
import { audio } from "@/lib/audio/AudioEngine";
import { HeaderVoiceToggle } from "@/components/jarvis/HeaderVoiceToggle";
import { NotificationBell } from "@/components/jarvis/NotificationBell";
import { Toaster } from "@/components/ui/sonner";
import { ArkRebootProvider, useArkReboot } from "@/components/jarvis/ArkRebootContext";
import { ArkRebootOverlay } from "@/components/jarvis/ArkRebootOverlay";
import { RebootButton } from "@/components/jarvis/RebootButton";
import { ShowcaseProvider } from "@/components/jarvis/ShowcaseContext";
import { ShowcaseOverlay } from "@/components/jarvis/ShowcaseOverlay";
import { ShowcaseButton } from "@/components/jarvis/ShowcaseButton";
import { MobileBottomNav } from "@/components/jarvis/MobileBottomNav";
import { useRouterState } from "@tanstack/react-router";
import { CommandPalette } from "@/components/jarvis/CommandPalette";
import { moduleTitleFor } from "@/components/jarvis/modules";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { useHeaderDensity } from "@/components/jarvis/useHeaderDensity";

import { GlobalVoiceCommand } from "@/components/jarvis/GlobalVoiceCommand";
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
      <ShowcaseProvider>
        <DashboardShellInner phase={phase} onShutdown={onShutdown} />
      </ShowcaseProvider>
    </ArkRebootProvider>
  );
}

function DashboardShellInner({ phase, onShutdown }: { phase: AppPhase; onShutdown: () => void }) {
  const { transition } = useRouteTransition();
  const { setOpen, setOpenMobile, isMobile } = useSidebar();
  // Moduł /jarvis ma własny mikrofon w konsoli czatu, tuż obok przycisku
  // wysyłki. Globalny przycisk jest tam nie tylko zbędny — w wersji
  // desktopowej siada dokładnie na „SEND", bo oba kotwiczą się w prawym
  // dolnym rogu. Ukrywamy go w tym jednym module zamiast przesuwać: mikrofon
  // obok pola tekstowego jest bliżej ręki niż pływający w rogu.
  const onJarvisModule = useRouterState({ select: (r) => r.location.pathname === "/jarvis" });
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
      {!isMobile && (
        <div className="relative z-10 contents">
          <AppSidebar />
        </div>
      )}
      <div className="relative z-10 flex min-h-screen min-w-0 flex-1 flex-col portrait:min-h-0 landscape:max-md:min-h-0 short:min-h-0">
        <HudHeader onShutdown={onShutdown} />
        <main
          className={
            // @container: the page-level container context — route content
            // outside any HudPanel (hero rows, page wrappers) sizes off this
            // (nearest ancestor wins; a nested HudPanel's own @container
            // shadows this for its own children). Always scrollable: routes
            // that genuinely need a fixed, non-scrolling "windowed" viewport
            // (e.g. /jarvis's 3D canvas) enforce that themselves via their
            // own definite height + overflow-hidden wrapper, so this doesn't
            // fight them — it only matters when a route's content is taller
            // than the viewport, which used to get silently clipped instead
            // of scrollable in landscape/short orientations.
            "@container relative min-h-0 flex-1 overflow-y-auto" +
            (transition === "dematerialize" ? " animate-hud-dematerialize" : "") +
            (isDiagnosticRunning ? " ark-dimmed" : "")
          }
        >
          <Outlet />
          <HudRouteTransition />
        </main>
        {isMobile ? (
          // Na mobile mikrofon jest częścią paska — osobną komórką obok
          // przewijanej listy modułów, nie elementem unoszącym się nad
          // treścią. Dzięki temu nie ma jak zasłonić niczego na stronie.
          // Sam pasek zostaje ZAWSZE: to jedyna nawigacja na telefonie,
          // znika wyłącznie komórka mikrofonu.
          <MobileBottomNav showVoice={!onJarvisModule} />
        ) : (
          !onJarvisModule && (
            <div className="absolute right-6 bottom-6 z-40">
              <GlobalVoiceCommand />
            </div>
          )
        )}
        <CommandPalette />
        <ArkRebootOverlay />
        <ShowcaseOverlay />
        <Toaster theme="dark" position="top-right" richColors />
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

/**
 * Top bar.
 *
 * Two clusters instead of the old chain of seven `w-px` dividers: a passive
 * STATUS readout and an ACTIONS group. The dividers were pure noise on
 * desktop and, on a phone, ate the width that forced the labels down to 8px.
 * Background is .hud-chrome — the same glass as the rail and the panels,
 * replacing the literal black/80 gradient that made the chrome read as a
 * different application.
 */
function HudHeader({ onShutdown }: { onShutdown: () => void }) {
  const isMobile = useIsMobile();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const moduleTitle = moduleTitleFor(pathname);
  const { ref, density } = useHeaderDensity<HTMLElement>();

  // On a phone the bar is always compact; on desktop the measured width
  // decides, so collapsing the rail gives the labels back.
  const compact = isMobile || density === "compact";

  return (
    <header
      ref={ref}
      className="hud-chrome sticky top-0 z-20 flex h-12 min-w-0 items-center gap-3 px-4 shadow-[0_8px_24px_-16px_color-mix(in_oklab,var(--primary)_60%,transparent)] portrait:h-11 portrait:gap-2 portrait:px-2.5 landscape:max-md:h-9 landscape:max-md:gap-2 landscape:max-md:px-2 short:h-9 short:gap-2 short:px-2"
    >
      <span className="hud-chrome-rule" aria-hidden />

      {!isMobile && <HudMenuTrigger />}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MiniArcReactor size={20} />
        {/* Was a static "STARK SECURE TERMINAL". Showing the active module
            instead turns decoration into orientation — which matters most on
            a phone, where the rail isn't visible at all. */}
        <span className="font-display min-w-0 truncate whitespace-nowrap text-[10px] uppercase tracking-[0.3em] text-primary/80 landscape:max-md:text-[8px] landscape:max-md:tracking-[0.2em] short:text-[8px] short:tracking-[0.2em]">
          {density === "full" && !isMobile && <span>J.A.R.V.I.S.</span>}
          {moduleTitle && (
            <>
              {density === "full" && !isMobile && (
                <span className="px-1.5 text-primary/40">//</span>
              )}
              <span className="text-foreground/90">{moduleTitle}</span>
            </>
          )}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2 portrait:gap-1.5">
        {/* STATUS — passive telemetry. Below "full" the label drops and the
            dot carries the state on its own, which is what buys the action
            cluster the room it needs before anything has to move. */}
        <span className="font-display flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/12 bg-primary/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-widest portrait:border-0 portrait:bg-transparent portrait:px-0 landscape:max-md:px-1.5 landscape:max-md:py-0.5 landscape:max-md:text-[8px] short:px-1.5 short:py-0.5 short:text-[8px]">
          <span
            className="h-1.5 w-1.5 shrink-0 animate-blink rounded-full"
            style={{ backgroundColor: "var(--success)" }}
          />
          {density === "full" && !isMobile && (
            <span
              className="landscape:max-md:hidden short:hidden"
              style={{ color: "var(--success)" }}
            >
              All Systems Nominal
            </span>
          )}
        </span>

        {compact ? (
          // Six labelled controls never fit a narrow bar — they used to
          // wrap onto a second line. Only the two that must stay one tap
          // away (voice, notifications) keep their spot; the rest move
          // behind SYS, where they are still one tap deep.
          <>
            <HeaderVoiceToggle />
            <NotificationBell />
            <SysMenu onShutdown={onShutdown} showFullscreen={!isMobile} />
          </>
        ) : (
          <>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-primary/12 bg-primary/[0.04] px-1.5 py-1 landscape:max-md:gap-1 landscape:max-md:px-1 landscape:max-md:py-0.5 short:gap-1 short:px-1 short:py-0.5">
              <HeaderVoiceToggle />
              <NotificationBell />
              <ShowcaseButton />
              <RebootButton />
              <FullscreenToggle />
            </span>
            {/* Deactivate sits outside the cluster: it is the only
                destructive control up here, and grouping it with the rest
                would make it look like one more toggle. */}
            <DeactivateButton onClick={onShutdown} />
          </>
        )}
      </div>
    </header>
  );
}

/** Phone-only overflow for the header actions that don't fit the bar. */
function SysMenu({
  onShutdown,
  showFullscreen = false,
}: {
  onShutdown: () => void;
  showFullscreen?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={() => audio.playClick()}
          aria-label="Akcje systemowe"
          className="font-display flex items-center gap-1 rounded-md border border-primary/40 bg-primary/[0.06] px-2 py-1 text-[9px] uppercase tracking-[0.25em] text-primary transition-colors hover:border-primary/70 hover:bg-primary/15 hover:text-foreground"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
          SYS
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="hud-chrome w-auto border-primary/25 p-2"
        onClick={() => setOpen(false)}
      >
        <div className="flex items-center gap-2">
          <ShowcaseButton />
          <RebootButton />
          {showFullscreen && <FullscreenToggle />}
          <DeactivateButton onClick={onShutdown} />
        </div>
      </PopoverContent>
    </Popover>
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
      className="font-display group relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-primary/40 bg-gradient-to-b from-primary/10 to-primary/[0.02] px-2.5 py-1 text-[10px] uppercase tracking-[0.28em] text-primary shadow-[inset_0_1px_0_color-mix(in_oklab,var(--primary)_20%,transparent),0_0_12px_-4px_color-mix(in_oklab,var(--primary)_60%,transparent)] transition-all duration-200 hover:border-primary/70 hover:bg-primary/15 hover:text-foreground hover:shadow-[inset_0_1px_0_color-mix(in_oklab,var(--primary)_30%,transparent),0_0_18px_-4px_var(--primary)] landscape:max-md:px-1.5 landscape:max-md:py-0.5 landscape:max-md:text-[8px] landscape:max-md:tracking-[0.2em]"
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
      className="flex items-center justify-center rounded-md border border-primary/40 bg-primary/[0.06] p-1.5 text-primary shadow-[inset_0_1px_0_color-mix(in_oklab,var(--primary)_18%,transparent)] transition-all duration-200 hover:border-primary/70 hover:bg-primary/15 hover:text-foreground hover:shadow-[0_0_12px_-4px_var(--primary)]"
    >
      <Icon className="h-3 w-3" strokeWidth={1.75} />
    </button>
  );
}
