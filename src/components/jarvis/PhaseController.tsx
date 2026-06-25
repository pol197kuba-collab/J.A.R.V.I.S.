import { useEffect, useState } from "react";

import { AppSidebar } from "@/components/jarvis/AppSidebar";
import { BootSequence } from "@/components/jarvis/BootSequence";
import { StarkLogin } from "@/components/jarvis/StarkLogin";
import { DashboardShell } from "@/components/jarvis/DashboardShell";
import { OrientationGate } from "@/components/jarvis/OrientationGate";
import { PhaseContext, type AppPhase } from "@/components/jarvis/PhaseContext";
import { TransitionProvider } from "@/components/jarvis/TransitionContext";
import { VoiceCommandProvider } from "@/components/jarvis/VoiceCommandContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { audio } from "@/lib/audio/AudioEngine";

// Suppress unused-import warning — kept so refactors don't drop the dep.
void AppSidebar;

/**
 * PhaseController owns the JARVIS boot → login → init → dashboard → shutdown
 * state machine. Split out of __root.tsx to keep the root file as a thin
 * routing shell.
 */
export function PhaseController() {
  const [phase, setPhase] = useState<AppPhase>("booting");

  // iOS / Safari autoplay policy: unlock AudioContext on the first real
  // user gesture. Until then, audio.* calls no-op silently (no warnings).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (audio.isUnlocked()) return;
    const unlock = () => {
      audio.unlock();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  // shutdown → booting after the dissolve animation
  useEffect(() => {
    if (phase !== "shutdown") return;
    audio.stopHum();
    audio.playShutdown();
    const t = setTimeout(() => setPhase("booting"), 1600);
    return () => clearTimeout(t);
  }, [phase]);

  // transition_to_dashboard → dashboard_active
  useEffect(() => {
    if (phase !== "transition_to_dashboard") return;
    const t = setTimeout(() => setPhase("dashboard_active"), 1400);
    return () => clearTimeout(t);
  }, [phase]);

  // Ambient reactor hum while the dashboard is active
  useEffect(() => {
    if (phase === "dashboard_active") audio.startHum();
    else audio.stopHum();
  }, [phase]);

  const showDashboardShell =
    phase === "transition_to_dashboard" ||
    phase === "dashboard_active" ||
    phase === "shutdown";

  return (
    <OrientationGate>
      <PhaseContext.Provider value={{ phase, setPhase }}>
        {phase === "booting" && (
          <BootSequence
            key="engage"
            mode="engage"
            onEngage={() => setPhase("login_screen")}
          />
        )}
        {phase === "login_screen" && (
          <StarkLogin onGranted={() => setPhase("initializing")} />
        )}
        {phase === "initializing" && (
          <BootSequence
            key="init"
            mode="init"
            onComplete={() => setPhase("transition_to_dashboard")}
          />
        )}
        {showDashboardShell && (
          <TransitionProvider>
            <SidebarProvider defaultOpen={false}>
              <VoiceCommandProvider>
                <DashboardShell
                  phase={phase}
                  onShutdown={() => setPhase("shutdown")}
                />
              </VoiceCommandProvider>
            </SidebarProvider>
          </TransitionProvider>
        )}
      </PhaseContext.Provider>
    </OrientationGate>
  );
}