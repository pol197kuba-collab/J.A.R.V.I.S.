// Agent flow — read-only view over agent_runs for the live delegation-tree
// widget. Builds entirely on data the runtime already writes (parent_run_id
// for the delegation edges, output.tool_calls for which tools/agents a run
// invoked) — no new tables, no new writes.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FlowRun = {
  id: string;
  agentSlug: string;
  agentName: string;
  parentRunId: string | null;
  status: string;
  toolCalls: string[];
  latencyMs: number | null;
  createdAt: string;
};

export const getAgentFlow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FlowRun[]> => {
    const { supabase, userId } = context;

    const { data: agents } = await supabase
      .from("agents")
      .select("id, slug, name")
      .eq("owner_id", userId);
    const agentById = new Map((agents ?? []).map((a) => [a.id, a]));

    const { data: runs, error } = await supabase
      .from("agent_runs")
      .select("id, agent_id, parent_run_id, status, output, latency_ms, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw new Error(error.message);

    return (runs ?? []).map((r) => {
      const agent = agentById.get(r.agent_id);
      const output = (r.output ?? {}) as { tool_calls?: Array<{ name: string }> };
      return {
        id: r.id,
        agentSlug: agent?.slug ?? "unknown",
        agentName: agent?.name ?? "Unknown",
        parentRunId: r.parent_run_id,
        status: r.status,
        // delegate_to_agent hops are already represented structurally via
        // parentRunId — listing it again as a tool chip would be noise.
        toolCalls: (output.tool_calls ?? [])
          .map((t) => t.name)
          .filter((name) => name !== "delegate_to_agent"),
        latencyMs: r.latency_ms,
        createdAt: r.created_at,
      };
    });
  });
