import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { listAgentTools, type AgentSummary } from "@/lib/agents/runtime.functions";
import { FORCED_TOOLS_BY_SLUG } from "@/lib/constants/agentSlugs";

// Left-side twin of HudOverlay's "Recent Network Assignments" panel — same
// frame/header/scroll treatment, but a static registry of the agent team
// instead of a live event feed. Tool lists are the union of DB-enabled
// agent_tools bindings and FORCED_TOOLS_BY_SLUG (in-memory forced tools like
// delegate_to_agent never have a `tools` row, so they'd otherwise be
// invisible here even though the agent always has them at runtime).
const MAX_INLINE_TOOLS = 2;

export function AgentRegistryPanel({ agents }: { agents: AgentSummary[] }) {
  return (
    <div className="pointer-events-auto absolute left-4 top-16 flex max-h-[50%] w-[220px] flex-col overflow-hidden rounded-lg border border-cyan-400/25 bg-black/60 shadow-[0_0_30px_-10px_rgba(77,216,255,0.5)] backdrop-blur-md sm:left-6 sm:top-20 sm:w-[260px]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-cyan-400/20 px-3 py-2">
        <Users className="h-3 w-3 text-cyan-300" strokeWidth={1.5} />
        <span className="font-display text-[9px] uppercase tracking-[0.25em] text-cyan-300/90">
          Agent Registry
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {agents.length === 0 ? (
          <p className="px-1 py-2 font-mono text-[9px] uppercase tracking-widest text-white/30">
            ▸ no agents registered…
          </p>
        ) : (
          agents.map((agent) => <AgentRegistryRow key={agent.slug} agent={agent} />)
        )}
      </div>
    </div>
  );
}

function AgentRegistryRow({ agent }: { agent: AgentSummary }) {
  const fetchTools = useServerFn(listAgentTools);
  const { data: tools = [] } = useQuery({
    queryKey: ["agent-tools", agent.slug],
    queryFn: () => fetchTools({ data: { agentSlug: agent.slug } }),
    staleTime: 30_000,
  });

  const dbEnabled = tools.filter((t) => t.enabledForAgent && t.globallyEnabled).map((t) => t.slug);
  const forced = FORCED_TOOLS_BY_SLUG[agent.slug] ?? [];
  const toolSlugs = Array.from(new Set([...dbEnabled, ...forced]));

  const visible = toolSlugs.slice(0, MAX_INLINE_TOOLS);
  const remaining = toolSlugs.length - visible.length;
  const toolsLabel =
    toolSlugs.length === 0
      ? "no tools bound"
      : remaining > 0
        ? `${visible.join(", ")}, +${remaining} więcej`
        : visible.join(", ");

  return (
    <div
      className="border-l-2 border-cyan-400/40 pl-2"
      title={toolSlugs.length > 0 ? toolSlugs.join(", ") : undefined}
    >
      <p className="line-clamp-1 font-display text-[10px] uppercase tracking-[0.15em] text-white/90">
        {agent.name}
      </p>
      <p className="line-clamp-1 font-mono text-[8px] leading-snug text-cyan-300/70">
        {agent.role ?? "—"}
      </p>
      <p className="line-clamp-1 font-mono text-[8px] leading-snug text-white/40">{toolsLabel}</p>
    </div>
  );
}
