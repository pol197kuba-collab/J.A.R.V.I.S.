import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ReactorCore } from "@/components/jarvis/ReactorCore";
import { VoiceButton } from "@/components/jarvis/VoiceButton";
import { ChatPanel } from "@/components/jarvis/ChatPanel";
import { ActiveTasksWidget } from "@/components/jarvis/ActiveTasksWidget";
import { SystemStatsStrip } from "@/components/jarvis/SystemStatsStrip";

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
    <div className="relative space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-display text-[10px] uppercase tracking-[0.4em] text-primary">
            Command // Overview
          </p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-[0.15em] text-foreground">
            GOOD EVENING, SIR.
          </h1>
        </div>
        <p className="max-w-md text-sm text-muted-foreground">
          All subsystems are operating within acceptable parameters. I am standing by for your next
          directive.
        </p>
      </header>

      <SystemStatsStrip />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="relative flex flex-col items-center justify-center gap-6 rounded-lg border border-border/60 bg-card/40 p-8 backdrop-blur">
          <div className="font-display absolute left-4 top-4 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            Arc Core // J-3140
          </div>
          <div className="font-display absolute right-4 top-4 text-[10px] uppercase tracking-[0.3em] text-primary">
            ● Live
          </div>
          <ReactorCore active={listening} />
          <VoiceButton active={listening} onToggle={() => setListening((v) => !v)} />
        </section>

        <ActiveTasksWidget />
      </div>

      <ChatPanel />
    </div>
  );
}
