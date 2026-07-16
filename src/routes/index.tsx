import { createFileRoute } from "@tanstack/react-router";
import { ChatPanel } from "@/components/jarvis/ChatPanel";
import { SystemStatsStrip } from "@/components/jarvis/SystemStatsStrip";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { WeatherTelemetry } from "@/components/jarvis/WeatherTelemetry";
import { NotesWidget } from "@/components/jarvis/NotesWidget";
import { TasksWidget } from "@/components/jarvis/TasksWidget";
import { AgentOpsFeed } from "@/components/jarvis/AgentOpsFeed";
import { GithubActivityPulse } from "@/components/jarvis/GithubActivityPulse";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JARVIS // Dashboard" },
      { name: "description", content: "Real-time command dashboard for the JARVIS personal AI assistant." },
      { property: "og:title", content: "JARVIS // Dashboard" },
      { property: "og:description", content: "Real-time command dashboard for the JARVIS personal AI assistant." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="relative space-y-6 p-6 landscape:max-md:max-h-full landscape:max-md:space-y-1.5 landscape:max-md:overflow-hidden landscape:max-md:p-1.5">
      <HudPanel index={0} title="COMMAND // OVERVIEW" className="relative overflow-hidden p-8 landscape:max-md:p-2">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-60 blur-3xl landscape:max-md:hidden"
          style={{
            background:
              "radial-gradient(circle at center, oklch(0.85 0.18 210 / 0.35), transparent 70%)",
          }}
        />
        <div className="relative flex flex-wrap items-center justify-between gap-8 landscape:max-md:gap-1">
          <div className="max-w-2xl space-y-3 landscape:max-md:space-y-1">
            <p className="font-display text-[10px] uppercase tracking-[0.4em] text-primary/70 landscape:max-md:text-[8px]">
              ▸ Stark Industries · Operating System
            </p>
            <h1 className="font-display text-4xl font-bold leading-tight tracking-[0.14em] text-foreground landscape:max-md:text-[11px] landscape:max-md:leading-none landscape:max-md:tracking-[0.1em]">
              SYSTEM OPERATIONAL
              <span className="block text-primary/90 mt-1 text-2xl tracking-[0.2em] landscape:max-md:mt-0 landscape:max-md:text-[10px]">
                WELCOME, MR. SLAWINSKY
              </span>
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground landscape:max-md:text-[9px] landscape:max-md:leading-tight">
              All subsystems are operating within acceptable parameters. Standing by for next directive.
            </p>
          </div>
          <div
            aria-hidden
            className="pointer-events-none hidden shrink-0 opacity-70 md:block"
          >
            <div className="relative h-28 w-28">
              <div className="absolute inset-0 rounded-full border border-primary/40 animate-ring-spin" />
              <div className="absolute inset-3 rounded-full border border-dashed border-primary/30 animate-ring-spin-rev" />
              <div className="absolute inset-6 rounded-full border border-primary/60 shadow-[0_0_24px_var(--primary)]" />
              <div className="absolute inset-11 rounded-full bg-primary/80 shadow-[0_0_18px_var(--primary)]" />
            </div>
          </div>
        </div>
      </HudPanel>

      <HudPanel index={1} title="TELEMETRY // CORE METRICS" tone="quiet" className="p-4 landscape:max-md:p-2">
        <div className="pt-3 landscape:max-md:pt-1">
          <SystemStatsStrip />
        </div>
      </HudPanel>

      <HudPanel index={2} title="CONVERSATION STREAM" className="flex flex-col">
        <ChatPanel />
      </HudPanel>

      <AgentOpsFeed index={3} />

      <div className="grid gap-6 lg:grid-cols-2 landscape:max-md:grid-cols-2 landscape:max-md:gap-2">
        <NotesWidget index={4} />
        <TasksWidget index={5} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 landscape:max-md:grid-cols-2 landscape:max-md:gap-2">
        <WeatherTelemetry index={6} />
        <GithubActivityPulse index={7} />
      </div>
    </div>
  );
}
