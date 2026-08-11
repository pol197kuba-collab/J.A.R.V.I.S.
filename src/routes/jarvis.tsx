import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { AgentMatrix } from "@/components/jarvis/AgentMatrix";
import { useHudNavigate } from "@/components/jarvis/TransitionContext";
import { audio } from "@/lib/audio/AudioEngine";
import { listAgents } from "@/lib/agents/runtime.functions";
import { listSystemEvents, type SystemEvent } from "@/lib/system/events.functions";

export const Route = createFileRoute("/jarvis")({
  head: () => ({
    meta: [
      { title: "J.A.R.V.I.S. // Stark Agent Matrix" },
      {
        name: "description",
        content:
          "Holograficzne centrum dowodzenia J.A.R.V.I.S. — żywa mapa agentów, ich zadań i sieciowych przydziałów.",
      },
      { property: "og:title", content: "J.A.R.V.I.S. // Stark Agent Matrix" },
      {
        property: "og:description",
        content: "Żywa mapa agentów J.A.R.V.I.S. z podglądem zadań w czasie rzeczywistym.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: JarvisMatrixPage,
});

const LEVEL_COLOR: Record<SystemEvent["level"], string> = {
  info: "var(--primary)",
  debug: "var(--muted-foreground)",
  warn: "var(--warning)",
  error: "var(--destructive)",
};

function JarvisMatrixPage() {
  const fetchAgents = useServerFn(listAgents);
  const fetchEvents = useServerFn(listSystemEvents);
  const { go, isTransitioning } = useHudNavigate();

  const { data: agents = [] } = useQuery({
    queryKey: ["agents", "matrix"],
    queryFn: () => fetchAgents(),
    refetchInterval: 4000,
  });

  const { data: events = [], isFetching } = useQuery({
    queryKey: ["system-events", "network-assignments"],
    queryFn: () => fetchEvents({ data: { limit: 40 } }),
    refetchInterval: 3000,
  });

  const activeCount = agents.filter((a) => a.activeRuns > 0 || a.status === "running").length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:gap-4 md:p-5">
      <HudPanel index={0} title="J.A.R.V.I.S. // STARK AGENT MATRIX" className="px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-display text-xl font-bold tracking-[0.2em] md:text-2xl">
            AGENT MATRIX
          </h1>
          <p className="font-display text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            {agents.length} WĘZŁÓW // {activeCount} W PRACY
          </p>
        </div>
      </HudPanel>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_320px] lg:gap-4">
        <HudPanel index={1} className="relative min-h-[340px] overflow-hidden lg:min-h-0">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, oklch(0.35 0.1 240 / 0.35), transparent 65%)",
            }}
          />
          <div className="relative h-full w-full">
            <AgentMatrix
              agents={agents}
              onSelect={(agent) => {
                if (isTransitioning) return;
                audio.playClick();
                go(`/agent-hub/${agent.slug}`);
              }}
            />
          </div>
        </HudPanel>

        <HudPanel
          index={2}
          tone="quiet"
          title="RECENT NETWORK ASSIGNMENTS"
          className="flex min-h-[180px] flex-col overflow-hidden"
          rightSlot={
            <span className="flex items-center gap-1.5 font-display text-[10px] uppercase tracking-[0.3em] text-primary">
              <span
                className={
                  "h-1.5 w-1.5 rounded-full bg-[color:var(--success)] " +
                  (isFetching ? "animate-pulse" : "")
                }
              />
              LIVE
            </span>
          }
        >
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
            {events.length === 0 && (
              <li className="font-display text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                ▸ BRAK PRZYDZIAŁÓW SIECIOWYCH…
              </li>
            )}
            {events.map((e) => (
              <li
                key={e.id}
                className="flex min-w-0 items-start gap-2 border-l-2 pl-2 font-mono text-[10px] uppercase tracking-[0.08em]"
                style={{
                  borderColor: `color-mix(in oklab, ${LEVEL_COLOR[e.level]} 80%, transparent)`,
                }}
              >
                <span className="shrink-0 text-muted-foreground">
                  {new Date(e.createdAt).toLocaleTimeString([], { hour12: false })}
                </span>
                <span className="min-w-0 flex-1 whitespace-normal break-words text-foreground/85">
                  {e.message}
                </span>
              </li>
            ))}
          </ul>
        </HudPanel>
      </div>
    </div>
  );
}