import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAgents } from "@/lib/agents/runtime.functions";
import { JarvisCanvas } from "@/components/jarvis/JarvisCanvas";
import { HudOverlay } from "@/components/jarvis/HudOverlay";
import { AgentRegistryPanel } from "@/components/jarvis/AgentRegistryPanel";
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
    <div className="flex h-full min-h-[560px] w-full flex-col overflow-hidden">
      {/* Matrix zone — 60% of the view. Sized so the whole route (matrix +
          chat) fits a typical desktop viewport (~900-1000px) without page
          scroll: see AgentChatPanel below for the other 40%. */}
      <div className="relative h-[60%] min-h-0 w-full overflow-hidden">
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
        <AgentRegistryPanel agents={agents} />
      </div>

      {/* Chat zone — 40% of the view, placeholder until the chat component
          lands. id/data-slot are the hook a future <AgentChatPanel/> attaches
          to; keep this element (or its id) when wiring the real one in. */}
      <div
        id="jarvis-chat-panel"
        data-slot="jarvis-chat-panel"
        className="relative h-[40%] min-h-0 w-full shrink-0 border-t border-cyan-400/20 bg-black/40 backdrop-blur-sm"
      >
        <div className="flex h-full w-full items-center justify-center">
          <p className="font-display text-[10px] uppercase tracking-[0.3em] text-white/25">
            chat module // pending integration
          </p>
        </div>
      </div>
    </div>
  );
}
