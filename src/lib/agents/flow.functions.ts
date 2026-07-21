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
//
// `output.tool_calls` is now written incrementally by runOrchestrator
// (after every iteration's tool calls, not just once at the very end), so
// a `running` row here can carry real, live progress — not just "started,
// no detail yet" — the frontend just needs to keep polling.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logServerError } from "@/lib/system/logServerError";
import type { Json } from "@/integrations/supabase/types";

export type FlowAgent = { slug: string; name: string };

export type FlowToolCall = {
  name: string;
  // Json (not Record<string, unknown>) so the server-fn result passes
  // TanStack Start's serializability validation — `unknown` fails it, which
  // collapsed getAgentFlow's inferred return type to {} for every consumer.
  args: Record<string, Json>;
};

export type FlowDelegation = {
  toSlug: string;
  task: string;
};

export type FlowRun = {
  id: string;
  agentSlug: string;
  agentName: string;
  parentRunId: string | null;
  status: string;
  /** The agent's own tool work — excludes delegate_to_agent (see
   *  `delegations` below) and the internal UI-action classifier pass. */
  toolCalls: FlowToolCall[];
  /** Extracted separately from toolCalls so the client can render the
   *  delegated task text on the edge to the child agent, rather than as
   *  just another generic tool chip on the parent. */
  delegations: FlowDelegation[];
  latencyMs: number | null;
  createdAt: string;
  finishedAt: string | null;
};

export type FlowResult = { agents: FlowAgent[]; runs: FlowRun[] };

type RawToolCall = { name: string; args?: Record<string, Json> };

export const getAgentFlow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FlowResult> => {
    const { supabase, userId } = context;

    // Secondary sort on `slug` is a deterministic tiebreaker: Postgres does
    // not guarantee stable ordering across repeated queries when
    // `created_at` values are equal or very close (plausible here since
    // each agent is seeded by its own migration inside a single
    // transaction) — without it, the teammate order could silently flip
    // between this widget's 3s polls, making nodes swap positions and
    // animate across each other via the CSS position transition.
    const { data: agentRows } = await supabase
      .from("agents")
      .select("id, slug, name, is_enabled")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .order("slug", { ascending: true });
    const agentById = new Map((agentRows ?? []).map((a) => [a.id, a]));

    const { data: runs, error } = await supabase
      .from("agent_runs")
      .select("id, agent_id, parent_run_id, status, output, latency_ms, created_at, finished_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) {
      await logServerError(supabase, userId, "agent_flow", error);
      throw new Error(error.message);
    }

    return {
      agents: (agentRows ?? [])
        .filter((a) => a.is_enabled)
        .map((a) => ({ slug: a.slug, name: a.name })),
      runs: (runs ?? []).map((r) => {
        const agent = agentById.get(r.agent_id);
        const output = (r.output ?? {}) as { tool_calls?: RawToolCall[] };
        const rawCalls = output.tool_calls ?? [];

        // classifier_* entries are runOrchestrator's internal UI-action
        // classification pass (runtime.server.ts, "Fallback classifier
        // pass"), not a tool the agent chose to use — it runs on every
        // turn that doesn't already call perform_ui_action and logs its
        // outcome (classifier_none, classifier_no_function_call, etc.)
        // into the same tool_calls array. perform_ui_action itself stays
        // visible — that one IS a real action taken.
        const toolCalls: FlowToolCall[] = rawCalls
          .filter((t) => t.name !== "delegate_to_agent" && !t.name.startsWith("classifier_"))
          .map((t) => ({ name: t.name, args: t.args ?? {} }));

        const delegations: FlowDelegation[] = rawCalls
          .filter((t) => t.name === "delegate_to_agent")
          .map((t) => ({
            toSlug: String(t.args?.slug ?? ""),
            task: String(t.args?.task ?? ""),
          }))
          .filter((d) => d.toSlug);

        return {
          id: r.id,
          agentSlug: agent?.slug ?? "unknown",
          agentName: agent?.name ?? "Unknown",
          parentRunId: r.parent_run_id,
          status: r.status,
          toolCalls,
          delegations,
          latencyMs: r.latency_ms,
          createdAt: r.created_at,
          finishedAt: r.finished_at,
        };
      }),
    };
  });
