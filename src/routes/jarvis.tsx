import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAgents } from "@/lib/agents/runtime.functions";
import { JarvisCanvas } from "@/components/jarvis/JarvisCanvas";
import { HudOverlay } from "@/components/jarvis/HudOverlay";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";

export const Route = createFileRoute("/jarvis")({
  head: () => ({
    meta: [
      { title: "JARVIS // Stark Agent Matrix" },
      {
        name: "description",
        content: "Live 3D delegation network of the J.A.R.V.I.S. agent team.",
      },
    ],
  }),
  component: AgentMatrix,
});

// Full-bleed 3D replacement for the old flat delegation-tree widget — the
// core (J.A.R.V.I.S. itself) sits at the origin, every other enabled agent
// orbits it as a satellite node carrying its own live status/current_task/
// progress/time_elapsed_seconds (src/lib/agents/runtime.functions.ts —
// same `agents` query AgentFlowTree/ChatPanel/Agent Hub already share).
function AgentMatrix() {
  const fetchAgents = useServerFn(listAgents);
  const { data: agents = [] } = useQuery({
    queryKey: ["agents", "list"],
    queryFn: () => fetchAgents(),
    refetchInterval: 3000,
  });

  const teammates = agents.filter((a) => a.slug !== AGENT_SLUGS.JARVIS);
  const onlineCount = agents.filter((a) => a.isEnabled).length;

  return (
    <div className="relative h-full min-h-[560px] w-full overflow-hidden">
      <JarvisCanvas
        agents={teammates.map((a) => ({
          slug: a.slug,
          name: a.name,
          role: a.role,
          status: a.status,
          isEnabled: a.isEnabled,
          currentTask: a.currentTask,
          progress: a.progress,
          timeElapsedSeconds: a.timeElapsedSeconds,
        }))}
      />
      <HudOverlay agentCount={agents.length} onlineCount={onlineCount} />
    </div>
  );
}
