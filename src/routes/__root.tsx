import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/jarvis/AppSidebar";
import { BootSequence } from "@/components/jarvis/BootSequence";
import { StarkLogin } from "@/components/jarvis/StarkLogin";
import { DeactivateButton } from "@/components/jarvis/DeactivateButton";
import { PhaseContext, type AppPhase } from "@/components/jarvis/PhaseContext";
import {
  TransitionProvider,
  useRouteTransition,
} from "@/components/jarvis/TransitionContext";
import { HudRouteTransition } from "@/components/jarvis/HudRouteTransition";
import { MiniArcReactor } from "@/components/jarvis/MiniArcReactor";
import { OrientationGate } from "@/components/jarvis/OrientationGate";
import { audio } from "@/lib/audio/AudioEngine";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "JARVIS // Personal AI Assistant" },
      { name: "description", content: "Futuristic command dashboard for the JARVIS personal AI assistant." },
      { name: "author", content: "Stark Industries" },
      { property: "og:title", content: "JARVIS // Personal AI Assistant" },
      { property: "og:description", content: "Futuristic command dashboard for the JARVIS personal AI assistant." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "JARVIS // Personal AI Assistant" },
      { name: "twitter:description", content: "Futuristic command dashboard for the JARVIS personal AI assistant." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/6503842e-f43f-419f-8374-ce726827ba4a/id-preview-56423660--59d189e1-e5ff-41bc-92f0-be5cbcc5bbb6.lovable.app-1782398182412.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/6503842e-f43f-419f-8374-ce726827ba4a/id-preview-56423660--59d189e1-e5ff-41bc-92f0-be5cbcc5bbb6.lovable.app-1782398182412.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=JetBrains+Mono:wght@400;500;700&family=Orbitron:wght@500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const [phase, setPhase] = useState<AppPhase>("booting");

  // Auto-progress shutdown → booting after dissolve
  useEffect(() => {
    if (phase !== "shutdown") return;
    audio.stopHum();
    audio.playShutdown();
    const t = setTimeout(() => setPhase("booting"), 1600);
    return () => clearTimeout(t);
  }, [phase]);

  // Auto-progress transition → dashboard_active
  useEffect(() => {
    if (phase !== "transition_to_dashboard") return;
    const t = setTimeout(() => setPhase("dashboard_active"), 1400);
    return () => clearTimeout(t);
  }, [phase]);

  // Ambient reactor hum during active dashboard
  useEffect(() => {
    if (phase === "dashboard_active") audio.startHum();
    else audio.stopHum();
  }, [phase]);

  const showDashboardShell =
    phase === "transition_to_dashboard" ||
    phase === "dashboard_active" ||
    phase === "shutdown";

  return (
    <QueryClientProvider client={queryClient}>
      <OrientationGate>
      <PhaseContext.Provider value={{ phase, setPhase }}>
        {phase === "booting" && (
          <BootSequence key="engage" mode="engage" onEngage={() => setPhase("login_screen")} />
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
            <DashboardShell phase={phase} onShutdown={() => setPhase("shutdown")} />
          </TransitionProvider>
        )}
      </PhaseContext.Provider>
      </OrientationGate>
    </QueryClientProvider>
  );
}

function DashboardShell({
  phase,
  onShutdown,
}: {
  phase: AppPhase;
  onShutdown: () => void;
}) {
  const { transition } = useRouteTransition();
  return (
    <SidebarProvider>
      <div className="relative flex min-h-screen w-full bg-background text-foreground landscape:max-md:h-screen landscape:max-md:min-h-0 landscape:max-md:overflow-hidden">
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
        <div className="relative flex min-h-screen flex-1 flex-col landscape:max-md:min-h-0">
          <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-primary/30 bg-black/70 px-4 backdrop-blur landscape:max-md:h-8 landscape:max-md:gap-1.5 landscape:max-md:px-2">
            <SidebarTrigger className="text-primary hover:bg-primary/10" />
            <div className="h-4 w-px bg-primary/40" />
            <MiniArcReactor size={20} />
            <span className="font-display text-[10px] uppercase tracking-[0.3em] text-primary/80 landscape:max-md:text-[8px] landscape:max-md:tracking-[0.2em]">
              J.A.R.V.I.S. // STARK SECURE TERMINAL
            </span>
            <div className="ml-auto flex items-center gap-2 font-display text-[10px] uppercase tracking-widest landscape:max-md:text-[8px] landscape:max-md:gap-1.5">
              <span
                className="h-1.5 w-1.5 animate-blink rounded-full"
                style={{ backgroundColor: "var(--success)" }}
              />
              <span className="landscape:max-md:hidden" style={{ color: "var(--success)" }}>All Systems Nominal</span>
              <div className="ml-3 h-4 w-px bg-primary/40" />
              <DeactivateButton onClick={onShutdown} />
            </div>
          </header>
          <main
            className={
              "relative flex-1 overflow-hidden landscape:max-md:overflow-auto" +
              (transition === "dematerialize" ? " animate-hud-dematerialize" : "")
            }
          >
            <Outlet />
            <HudRouteTransition />
          </main>
          {phase === "shutdown" && (
            <div
              className="pointer-events-none fixed inset-0 z-[90] bg-black animate-shutdown-flash"
              aria-hidden
            />
          )}
        </div>
      </div>
    </SidebarProvider>
  );
}
