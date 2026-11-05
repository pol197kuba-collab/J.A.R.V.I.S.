import { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";

import { AppSidebar } from "@/components/jarvis/AppSidebar";
import { BootSequence } from "@/components/jarvis/BootSequence";
import { LandingPage } from "@/components/jarvis/login-scene/LandingPage";
import { createIntroBridge } from "@/components/jarvis/login-scene/introBridge";
import { LoginScene } from "@/components/jarvis/login-scene/LoginScene";
import { useQueryClient } from "@tanstack/react-query";
import { StarkLogin } from "@/components/jarvis/StarkLogin";
import { DashboardShell } from "@/components/jarvis/DashboardShell";
import { PhaseContext, type AppPhase } from "@/components/jarvis/PhaseContext";
import { TransitionProvider } from "@/components/jarvis/TransitionContext";
import { VoiceCommandProvider } from "@/components/jarvis/VoiceCommandContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { audio } from "@/lib/audio/AudioEngine";
import { supabase } from "@/integrations/supabase/client";
import { MODE_HOME, getUiMode } from "@/lib/theme/uiMode";
import { shouldUseIntro, type IntroMode } from "@/lib/theme/loginScene";

// Suppress unused-import warning — kept so refactors don't drop the dep.
void AppSidebar;

/**
 * PhaseController owns the JARVIS boot → login → init → dashboard → shutdown
 * state machine. Split out of __root.tsx to keep the root file as a thin
 * routing shell.
 */
export function PhaseController() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<AppPhase>("booting");
  const queryClient = useQueryClient();
  // 3D intro: decided on the client each time the app returns to "booting"
  // (null until then, so hydration matches the server markup). "landing" =
  // 3D landing page instead of the Engage screen, "login" = classic Engage but
  // 3D login + ignition (reduced motion), "off" = today's SVG + BootSequence.
  // Dropped to "off" for good if the scene fails to start.
  const [intro, setIntro] = useState<IntroMode | null>(null);
  // The landing page lingers 450 ms into the login screen so it can fade out.
  const [landingGone, setLandingGone] = useState(false);
  // The scene reported p = 1 (overlay gone, rendering stopped) — safe to unmount.
  const [sceneDone, setSceneDone] = useState(false);
  const introBridge = useRef(createIntroBridge());
  const sceneActive = intro === "landing" || intro === "login";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPublicRoute = pathname === "/reset-password" || pathname.startsWith("/.lovable/oauth/");

  // Listen for auth state changes: if user signs out anywhere, drop to boot.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setPhase("booting");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

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
    void supabase.auth.signOut();
    const t = setTimeout(() => setPhase("booting"), 1600);
    return () => clearTimeout(t);
  }, [phase]);

  // DEV-only proof harness: lets the verification scripts seed the agents cache.
  useEffect(() => {
    if (import.meta.env.DEV) Reflect.set(window, "__queryClient", queryClient);
  }, [queryClient]);

  useEffect(() => {
    if (phase !== "booting") return;
    setIntro(shouldUseIntro());
    setSceneDone(false);
    setLandingGone(false);
  }, [phase]);

  useEffect(() => {
    if (phase !== "login_screen") return;
    const t = setTimeout(() => setLandingGone(true), 450);
    return () => clearTimeout(t);
  }, [phase]);

  // Arc Core ignition replaces the 10 s BootSequence "init": its boot chirp is
  // 2.4 s, the same length as the scene's transition, so it stays.
  useEffect(() => {
    if (phase === "initializing" && sceneActive) audio.playBoot();
  }, [phase, sceneActive]);

  // Safety net: the scene normally reports P_LIVE itself (~1.4 s). If it never
  // does (hidden tab, stalled rAF), don't leave the user on a black screen.
  useEffect(() => {
    if (phase !== "initializing" || !sceneActive) return;
    const t = setTimeout(() => setPhase("transition_to_dashboard"), 8000);
    return () => clearTimeout(t);
  }, [phase, sceneActive]);

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

  // Public routes bypass the whole phase machine. This early return MUST sit
  // below every hook above: hooks have to run in the same order on every
  // render, and a pre-hook return would crash React ("rendered fewer hooks
  // than expected") the moment navigation crosses the public/app boundary.
  // The effects above are all safe no-ops on public routes — each one gates
  // on phase or events internally.
  if (isPublicRoute) {
    return <Outlet />;
  }

  const showDashboardShell =
    phase === "transition_to_dashboard" || phase === "dashboard_active" || phase === "shutdown";

  // One stable <LoginScene> from the landing page (booting) through the login
  // screen and the ignition; it outlives the phase changes until it reports
  // p = 1 (never remounts: the phase prop drives its modes).
  const showScene =
    sceneActive &&
    !sceneDone &&
    ((intro === "landing" && phase === "booting") ||
      phase === "login_screen" ||
      phase === "initializing" ||
      phase === "transition_to_dashboard" ||
      phase === "dashboard_active");
  const showLanding =
    intro === "landing" && !landingGone && (phase === "booting" || phase === "login_screen");

  const engage = () => {
    setSceneDone(false);
    setPhase("login_screen");
  };

  return (
    <PhaseContext.Provider value={{ phase, setPhase }}>
      {phase === "booting" && intro !== "landing" && (
        <BootSequence key="engage" mode="engage" onEngage={engage} />
      )}
      {showScene && (
        <LoginScene
          key="login-scene"
          mode={intro === "landing" ? "landing" : "login"}
          phase={phase}
          bridge={introBridge}
          onLive={() =>
            setPhase((cur) => (cur === "initializing" ? "transition_to_dashboard" : cur))
          }
          onDone={() => setSceneDone(true)}
          onUnavailable={() => setIntro("off")}
        />
      )}
      {showLanding && (
        <LandingPage bridge={introBridge} leaving={phase !== "booting"} onEngage={engage} />
      )}
      {phase === "login_screen" && (
        <StarkLogin
          sceneActive={sceneActive}
          onGranted={() => {
            void navigate({ to: MODE_HOME[getUiMode()] });
            if (sceneActive) {
              // warm the agent list: real names and statuses for the ignition labels / node count
              void queryClient.prefetchQuery({
                queryKey: ["agents", "list"],
                queryFn: async () => (await import("@/lib/agents/runtime.functions")).listAgents(),
              });
            }
            setPhase("initializing");
          }}
        />
      )}
      {phase === "initializing" && !sceneActive && (
        <BootSequence
          key="init"
          mode="init"
          onComplete={() => setPhase("transition_to_dashboard")}
          onSkip={() => setPhase("transition_to_dashboard")}
        />
      )}
      {showDashboardShell && (
        <TransitionProvider>
          <SidebarProvider defaultOpen={false}>
            <VoiceCommandProvider>
              <DashboardShell phase={phase} onShutdown={() => setPhase("shutdown")} />
            </VoiceCommandProvider>
          </SidebarProvider>
        </TransitionProvider>
      )}
    </PhaseContext.Provider>
  );
}
