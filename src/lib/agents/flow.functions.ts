// Agent flow — read-only view over agent_runs for the live delegation-tree
// widget. Builds entirely on data the runtime already writes (parent_run_id
// for the delegation edges, output.tool_calls for which tools/agents a run
// invoked) — no new tables, no new writes.
//
// Returns the full enabled-agent roster (so the widget can render a
// persistent team structure, not just whichever agent happened to run
// recently) alongside the recent run history (so the client can highlight
// whichever slice of that roster is part of the current/most recent
// interaction).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FlowAgent = { slug: string; name: string };

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

export type FlowResult = { agents: FlowAgent[]; runs: FlowRun[] };

export const getAgentFlow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FlowResult> => {
    const { supabase, userId } = context;

    const { data: agentRows } = await supabase
      .from("agents")
      .select("id, slug, name, is_enabled")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true });
    const agentById = new Map((agentRows ?? []).map((a) => [a.id, a]));

    const { data: runs, error } = await supabase
      .from("agent_runs")
      .select("id, agent_id, parent_run_id, status, output, latency_ms, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw new Error(error.message);

    return {
      agents: (agentRows ?? [])
        .filter((a) => a.is_enabled)
        .map((a) => ({ slug: a.slug, name: a.name })),
      runs: (runs ?? []).map((r) => {
        const agent = agentById.get(r.agent_id);
        const output = (r.output ?? {}) as { tool_calls?: Array<{ name: string }> };
        return {
          id: r.id,
          agentSlug: agent?.slug ?? "unknown",
          agentName: agent?.name ?? "Unknown",
          parentRunId: r.parent_run_id,
          status: r.status,
          // Two kinds of noise filtered out:
          // - delegate_to_agent hops are already represented structurally
          //   via parentRunId — listing it again as a tool chip would be
          //   noise.
          // - classifier_* entries are runOrchestrator's internal
          //   UI-action classification pass (runtime.server.ts, "Fallback
          //   classifier pass"), not a tool the agent chose to use — it
          //   runs on every turn that doesn't already call
          //   perform_ui_action and logs its outcome (classifier_none,
          //   classifier_no_function_call, etc.) into the same tool_calls
          //   array. perform_ui_action itself stays visible — that one IS
          //   a real action taken.
          toolCalls: (output.tool_calls ?? [])
            .map((t) => t.name)
            .filter((name) => name !== "delegate_to_agent" && !name.startsWith("classifier_")),
          latencyMs: r.latency_ms,
          createdAt: r.created_at,
        };
      }),
    };
  });
