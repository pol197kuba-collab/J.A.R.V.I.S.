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
import { z } from "zod";
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
  /** The run's error message, when it failed. */
  error?: string | null;
  /** What the agent was asked (truncated) — lets a failed task be retried. */
  inputText?: string | null;
  /** Model that produced the answer (set on success). */
  model?: string | null;
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
      .select(
        "id, agent_id, parent_run_id, status, input, output, error, model, latency_ms, created_at, finished_at",
      )
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
        const input = (r.input ?? {}) as { text?: string };
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
          error: r.error ? r.error.slice(0, 500) : null,
          inputText: typeof input.text === "string" ? input.text.slice(0, 500) : null,
          model: r.model,
        };
      }),
    };
  });

// ---------------------------------------------------------------------------
// getRunDetail — one run's full answer and the files it produced, fetched on
// demand (opening a result in Agent Town) rather than in the 3 s flow poll.
// ---------------------------------------------------------------------------

export type RunFile = { id: string; filename: string; format: string };
export type RunDetail = {
  text: string | null;
  error: string | null;
  /** Files generated while this run (or its delegated sub-runs) was working. */
  files: RunFile[];
};

const RunDetailInput = z.object({ runId: z.string().uuid() });

export const getRunDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunDetailInput.parse(input))
  .handler(async ({ data, context }): Promise<RunDetail> => {
    const { supabase, userId } = context;
    const { data: run, error } = await supabase
      .from("agent_runs")
      .select("output, error, created_at, finished_at")
      .eq("id", data.runId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run) return { text: null, error: null, files: [] };
    const text = ((run.output ?? {}) as { text?: unknown }).text;
    // generated_files has no run id; a file created while the run was going
    // (plus a few seconds of slack for the upload) is that run's file.
    const until = new Date(Date.parse(run.finished_at ?? new Date().toISOString()) + 15_000);
    const { data: files } = await supabase
      .from("generated_files")
      .select("id, filename, format")
      .eq("user_id", userId)
      .gte("created_at", run.created_at)
      .lte("created_at", until.toISOString())
      .order("created_at", { ascending: true })
      .limit(10);
    return {
      text: typeof text === "string" ? text : null,
      error: run.error,
      files: (files ?? []).map((f) => ({ id: f.id, filename: f.filename, format: f.format })),
    };
  });
