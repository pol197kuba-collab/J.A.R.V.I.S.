// Narzędzia agentów — S.H.I.E.L.D. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { type Tool, clampInt } from "./shared.server";

// ---------------------------------------------------------------------------
// S.H.I.E.L.D. tools — system health monitoring + active smoke-tests. Read-only:
// they observe/verify state, they never mutate anything except their own
// diagnostic queries.
// ---------------------------------------------------------------------------

export const scanErrors: Tool = {
  risk: "read",
  declaration: {
    name: "shield_scan_errors",
    description:
      "Scan system_events and agent_runs for recent warnings/errors across the whole system (not just this conversation). Use to answer 'what broke recently' or a general system health check.",
    parameters: {
      type: "object",
      properties: {
        hours: {
          type: "integer",
          description: "How many hours back to look (default 24, max 168).",
        },
        limit: {
          type: "integer",
          description: "Max results per source (default 20, max 50).",
        },
      },
    },
  },
  async execute(args, ctx) {
    const hours = clampInt(args.hours, 1, 168, 24);
    const limit = clampInt(args.limit, 1, 50, 20);
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();

    // NOTE: the live runtime (runAgentLoop's logEvent, every ctx.logEvent
    // call in this file) writes to system_events, not the older event_log
    // table — event_log has no writer anywhere in the current codebase.
    // This originally queried event_log and would have silently returned
    // nothing forever; caught while building the agent flow tree widget.
    const { data: events, error: eventsErr } = await ctx.supabase
      .from("system_events")
      .select("source, level, message, meta, created_at")
      .eq("owner_id", ctx.userId)
      .in("level", ["warn", "error"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (eventsErr) {
      await ctx.logEvent("error", "tool.shield_scan_errors", eventsErr.message);
      return { error: eventsErr.message };
    }

    const { data: runs, error: runsErr } = await ctx.supabase
      .from("agent_runs")
      .select("id, agent_id, status, error, created_at")
      .eq("user_id", ctx.userId)
      .eq("status", "error")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (runsErr) {
      await ctx.logEvent("error", "tool.shield_scan_errors", runsErr.message);
      return { error: runsErr.message };
    }

    return {
      window_hours: hours,
      event_count: events?.length ?? 0,
      events: events ?? [],
      failed_run_count: runs?.length ?? 0,
      failed_runs: runs ?? [],
    };
  },
};

export const runStats: Tool = {
  risk: "read",
  declaration: {
    name: "shield_run_stats",
    description:
      "Aggregate agent run statistics over a time window — counts by status and average latency per agent. Use to spot trends (rising error rate, latency regression) rather than a single incident.",
    parameters: {
      type: "object",
      properties: {
        hours: {
          type: "integer",
          description: "How many hours back to look (default 24, max 168).",
        },
      },
    },
  },
  async execute(args, ctx) {
    const hours = clampInt(args.hours, 1, 168, 24);
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();

    const { data: runs, error } = await ctx.supabase
      .from("agent_runs")
      .select("agent_id, status, latency_ms")
      .eq("user_id", ctx.userId)
      .gte("created_at", since);
    if (error) {
      await ctx.logEvent("error", "tool.shield_run_stats", error.message);
      return { error: error.message };
    }

    const { data: agentRows } = await ctx.supabase
      .from("agents")
      .select("id, slug")
      .eq("owner_id", ctx.userId);
    const slugById = new Map((agentRows ?? []).map((a) => [a.id, a.slug]));

    const byAgent = new Map<
      string,
      { total: number; errors: number; latencySum: number; latencyCount: number }
    >();
    for (const r of runs ?? []) {
      const slug = slugById.get(r.agent_id) ?? r.agent_id;
      const bucket = byAgent.get(slug) ?? {
        total: 0,
        errors: 0,
        latencySum: 0,
        latencyCount: 0,
      };
      bucket.total += 1;
      if (r.status === "error") bucket.errors += 1;
      if (typeof r.latency_ms === "number") {
        bucket.latencySum += r.latency_ms;
        bucket.latencyCount += 1;
      }
      byAgent.set(slug, bucket);
    }

    const stats = Array.from(byAgent.entries()).map(([slug, b]) => ({
      agent: slug,
      total_runs: b.total,
      error_rate: b.total > 0 ? Math.round((b.errors / b.total) * 100) / 100 : 0,
      avg_latency_ms: b.latencyCount > 0 ? Math.round(b.latencySum / b.latencyCount) : null,
    }));

    return { window_hours: hours, stats };
  },
};

export const checkDelegation: Tool = {
  risk: "read",
  declaration: {
    name: "shield_check_delegation",
    description:
      "Smoke-test multi-agent delegation tracing: checks whether recent delegated agent runs correctly link back to their parent run via parent_run_id. Use when asked to verify delegation/tracing health.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "How many recent delegated runs to inspect (default 20, max 50).",
        },
      },
    },
  },
  async execute(args, ctx) {
    const limit = clampInt(args.limit, 1, 50, 20);

    // A delegated run is any run on a non-jarvis agent — delegation is
    // the only path that creates one today, so this is a reliable filter
    // without needing a dedicated schema flag.
    const { data: agentRows } = await ctx.supabase
      .from("agents")
      .select("id, slug")
      .eq("owner_id", ctx.userId);
    const nonJarvisIds = (agentRows ?? [])
      .filter((a) => a.slug !== AGENT_SLUGS.JARVIS)
      .map((a) => a.id);
    if (nonJarvisIds.length === 0) {
      return { checked: 0, linked: 0, unlinked: 0, note: "no delegated agents exist yet" };
    }

    const { data: runs, error } = await ctx.supabase
      .from("agent_runs")
      .select("id, agent_id, parent_run_id, created_at")
      .eq("user_id", ctx.userId)
      .in("agent_id", nonJarvisIds)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      await ctx.logEvent("error", "tool.shield_check_delegation", error.message);
      return { error: error.message };
    }

    const checked = runs?.length ?? 0;
    const unlinked = (runs ?? []).filter((r) => !r.parent_run_id);
    return {
      checked,
      linked: checked - unlinked.length,
      unlinked: unlinked.length,
      unlinked_run_ids: unlinked.map((r) => r.id),
    };
  },
};
