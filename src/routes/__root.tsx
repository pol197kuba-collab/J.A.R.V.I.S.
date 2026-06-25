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
import { JarvisBoot } from "@/components/jarvis/JarvisBoot";

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
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "JARVIS // Personal AI Assistant" },
      { name: "description", content: "Futuristic command dashboard for the JARVIS personal AI assistant." },
      { name: "author", content: "Stark Industries" },
      { property: "og:title", content: "JARVIS // Personal AI Assistant" },
      { property: "og:description", content: "Futuristic command dashboard for the JARVIS personal AI assistant." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
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
        href: "https://fonts.googleapis.com/css2?family=Orbitron:wght@500;600;700&family=Inter:wght@400;500;600&display=swap",
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
  const [isBooted, setIsBooted] = useState(false);

  if (!isBooted) {
    return (
      <QueryClientProvider client={queryClient}>
        <JarvisBoot onEnter={() => setIsBooted(true)} />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <div className="relative flex min-h-screen w-full bg-background text-foreground">
          <div className="bg-grid pointer-events-none fixed inset-0 opacity-40" aria-hidden />
          <div
            className="pointer-events-none fixed inset-0 opacity-60"
            aria-hidden
            style={{
              background:
                "radial-gradient(ellipse at 20% 0%, oklch(0.4 0.15 230 / 0.25), transparent 60%), radial-gradient(ellipse at 80% 100%, oklch(0.4 0.18 210 / 0.18), transparent 60%)",
            }}
          />
          <AppSidebar />
          <div className="relative flex min-h-screen flex-1 flex-col">
            <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-border/60 bg-background/70 px-4 backdrop-blur">
              <SidebarTrigger className="text-primary hover:bg-primary/10" />
              <div className="h-4 w-px bg-border" />
              <span className="font-display text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                Stark Industries // Secure Terminal
              </span>
              <div className="ml-auto flex items-center gap-2 font-display text-[10px] uppercase tracking-widest">
                <span
                  className="h-1.5 w-1.5 animate-blink rounded-full"
                  style={{ backgroundColor: "var(--success)" }}
                />
                <span style={{ color: "var(--success)" }}>All Systems Nominal</span>
              </div>
            </header>
            <main className="relative flex-1">
              {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
              <Outlet />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </QueryClientProvider>
  );
}
