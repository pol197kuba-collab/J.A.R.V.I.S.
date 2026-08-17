import { createFileRoute } from "@tanstack/react-router";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { CockpitHero } from "@/components/jarvis/CockpitHero";
import { SystemPulsePanel } from "@/components/jarvis/SystemPulsePanel";
import { TaskBoardPanel } from "@/components/jarvis/TaskBoardPanel";
import { ArcReactorTriangle } from "@/components/jarvis/ArcReactorTriangle";
import { useAgentStatus } from "@/components/jarvis/useAgentStatus";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JARVIS // Command Center" },
      {
        name: "description",
        content: "System pulse and agent task board for the JARVIS personal AI assistant.",
      },
      { property: "og:title", content: "JARVIS // Command Center" },
      {
        property: "og:description",
        content: "System pulse and agent task board for the JARVIS personal AI assistant.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const status = useAgentStatus();

  return (
    <div className="relative space-y-6 p-6 landscape:max-md:max-h-full landscape:max-md:space-y-1.5 landscape:max-md:overflow-hidden landscape:max-md:p-1.5">
      <HudPanel
        index={0}
        title="COMMAND // OVERVIEW"
        className="relative overflow-hidden p-8 landscape:max-md:p-2"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-60 blur-3xl landscape:max-md:hidden"
          style={{
            background:
              "radial-gradient(circle at center, oklch(0.85 0.18 210 / 0.35), transparent 70%)",
          }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-8 landscape:max-md:gap-1">
          <div className="min-w-0 flex-1 landscape:max-md:space-y-1">
            <CockpitHero />
          </div>
          <div
            aria-hidden
            className="pointer-events-none hidden shrink-0 flex-col items-center gap-2 md:flex"
          >
            <ArcReactorTriangle className="!w-[150px]" />
            <span
              className="font-display text-[9px] uppercase tracking-[0.28em]"
              style={{ color: status.color }}
            >
              {status.label}
            </span>
          </div>
        </div>
      </HudPanel>

      <SystemPulsePanel index={1} />

      <TaskBoardPanel index={2} />
    </div>
  );
}
