import { createFileRoute } from "@tanstack/react-router";
import { ReactorCore } from "@/components/jarvis/ReactorCore";
import { ChatPanel } from "@/components/jarvis/ChatPanel";
import { SystemStatsStrip } from "@/components/jarvis/SystemStatsStrip";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { WeatherTelemetry } from "@/components/jarvis/WeatherTelemetry";
import { GlobalIntelFeed } from "@/components/jarvis/GlobalIntelFeed";

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
      <HudPanel index={0} title="COMMAND // OVERVIEW" className="p-5 landscape:max-md:p-2">
        <div className="flex flex-wrap items-end justify-between gap-2 pt-3 landscape:max-md:gap-1 landscape:max-md:pt-1">
          <h1 className="font-display text-3xl font-bold tracking-[0.18em] text-foreground landscape:max-md:text-[11px] landscape:max-md:leading-none landscape:max-md:tracking-[0.1em]">
            SYSTEM OPERATIONAL // WELCOME, MR. SLAWINSKY
          </h1>
          <p className="max-w-md text-sm text-muted-foreground landscape:max-md:text-[9px] landscape:max-md:leading-tight">
            All subsystems are operating within acceptable parameters. Standing by for next directive, Mr. Slawinsky.
          </p>
        </div>
      </HudPanel>

      <HudPanel index={1} title="TELEMETRY // CORE METRICS" className="p-4 landscape:max-md:p-2">
        <div className="pt-3 landscape:max-md:pt-1">
          <SystemStatsStrip />
        </div>
      </HudPanel>

      <HudPanel
        index={2}
        title="ARC CORE // J-3140 // STATUS BEACON"
        rightSlot={
          <span className="font-display text-[10px] uppercase tracking-[0.3em] text-primary">
            ● LIVE
          </span>
        }
        className="flex flex-col"
      >
        <div className="flex items-center gap-4 px-4 py-2 landscape:max-md:gap-2 landscape:max-md:px-2 landscape:max-md:py-1">
          <div className="w-[72px] shrink-0 landscape:max-md:w-[48px]">
            <ReactorCore active={false} />
          </div>
          <div className="flex-1 space-y-1">
            <p className="font-display text-[11px] uppercase tracking-[0.3em] text-primary/90 landscape:max-md:text-[9px]">
              REACTOR STABLE // OUTPUT 3.14 GJ/s
            </p>
            <p className="font-display text-[10px] uppercase tracking-[0.25em] text-muted-foreground landscape:max-md:text-[8px]">
              CORE TEMP NOMINAL · COOLANT LOOP A/B GREEN · NO ANOMALIES DETECTED
            </p>
          </div>
        </div>
      </HudPanel>

      <div className="grid gap-6 lg:grid-cols-2 landscape:max-md:grid-cols-2 landscape:max-md:gap-2">
        <WeatherTelemetry index={3} />
        <GlobalIntelFeed index={4} />
      </div>

      <HudPanel index={5} title="CONVERSATION STREAM" className="flex flex-col">
        <ChatPanel />
      </HudPanel>
    </div>
  );
}
