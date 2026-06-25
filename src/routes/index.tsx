import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ReactorCore } from "@/components/jarvis/ReactorCore";
import { VoiceButton } from "@/components/jarvis/VoiceButton";
import { ChatPanel } from "@/components/jarvis/ChatPanel";
import { ActiveTasksWidget } from "@/components/jarvis/ActiveTasksWidget";
import { SystemStatsStrip } from "@/components/jarvis/SystemStatsStrip";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { WeatherTelemetry } from "@/components/jarvis/WeatherTelemetry";
import { ThreatStream } from "@/components/jarvis/ThreatStream";

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
  const [listening, setListening] = useState(false);
  return (
    <div className="relative space-y-6 p-6 landscape:max-md:space-y-2 landscape:max-md:p-2">
      <HudPanel index={0} title="COMMAND // OVERVIEW" className="p-5 landscape:max-md:p-2">
        <div className="flex flex-wrap items-end justify-between gap-2 pt-3 landscape:max-md:gap-1 landscape:max-md:pt-1">
          <h1 className="font-display text-3xl font-bold tracking-[0.18em] text-foreground landscape:max-md:text-sm landscape:max-md:tracking-[0.12em]">
            GOOD EVENING, SIR.
          </h1>
          <p className="max-w-md text-sm text-muted-foreground landscape:max-md:text-[10px]">
            All subsystems are operating within acceptable parameters. Standing by for next directive.
          </p>
        </div>
      </HudPanel>

      <HudPanel index={1} title="TELEMETRY // CORE METRICS" className="p-4 landscape:max-md:p-2">
        <div className="pt-3 landscape:max-md:pt-1">
          <SystemStatsStrip />
        </div>
      </HudPanel>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] landscape:max-md:grid-cols-[1.1fr_1fr] landscape:max-md:gap-2">
        <HudPanel
          index={2}
          title="ARC CORE // J-3140"
          rightSlot={
            <span className="font-display text-[10px] uppercase tracking-[0.3em] text-primary">
              ● LIVE
            </span>
          }
          className="flex flex-col"
        >
          <div className="flex flex-col items-center justify-center gap-6 p-8 landscape:max-md:gap-2 landscape:max-md:p-2">
            <div className="w-full max-w-[420px] landscape:max-md:max-w-[140px]">
              <ReactorCore active={listening} />
            </div>
            <VoiceButton active={listening} onToggle={() => setListening((v) => !v)} />
          </div>
        </HudPanel>

        <HudPanel index={3} title="ACTIVE TASKS" className="flex flex-col">
          <ActiveTasksWidget />
        </HudPanel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 landscape:max-md:grid-cols-2 landscape:max-md:gap-2">
        <WeatherTelemetry index={4} />
        <ThreatStream index={5} />
      </div>

      <HudPanel index={6} title="CONVERSATION STREAM" className="flex flex-col">
        <ChatPanel />
      </HudPanel>
    </div>
  );
}
