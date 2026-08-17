// System Pulse — aggregate, cross-agent stats for the command-center
// dashboard. Deliberately separate from runtime.functions.ts's per-agent
// AgentStats (used by the individual agent console pages): same underlying
// windows/metrics, but summed across the whole roster instead of scoped to
// one agent_id, plus a per-agent breakdown row for the "who's been busy"
// view. No new tables — agent_runs and agents already carry everything this
// needs.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AgentPulseRow = {
  slug: string;
  name: string;
  status: string;
  isEnabled: boolean;
  runs24h: number;
  successRate: number | null;
  lastRunStatus: string | null;
  lastRunAt: string | null;
};

export type SystemPulse = {
  runs24h: number;
  runs7d: number;
  successRate24h: number | null;
  errors24h: number;
  tokensIn24h: number;
  tokensOut24h: number;
  activeAgents: number;
  totalAgents: number;
  /** 24 hourly buckets (oldest → newest), all agents combined. */
  sparkline: number[];
  perAgent: AgentPulseRow[];
};

export const getSystemPulse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SystemPulse> => {
    const { supabase, userId } = context;

    const { data: agents } = await supabase
      .from("agents")
      .select("id, slug, name, status, is_enabled")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true });
    const roster = agents ?? [];

    const now = Date.now();
    const H24 = now - 24 * 3600_000;
    const D7 = now - 7 * 24 * 3600_000;

    // Bounded to 7 days server-side (not just a row LIMIT) so a heavy user
    // can't silently truncate the 7d window before the 24h one is even full.
    const { data: runsRaw } = await supabase
      .from("agent_runs")
      .select("agent_id, status, created_at, tokens_input, tokens_output")
      .eq("user_id", userId)
      .gte("created_at", new Date(D7).toISOString())
      .order("created_at", { ascending: false })
      .limit(5000);
    const runs = runsRaw ?? [];

    const ts = (r: (typeof runs)[number]) => new Date(r.created_at).getTime();
    const runs24h = runs.filter((r) => ts(r) >= H24);
    const errors24h = runs24h.filter((r) => r.status === "error").length;
    const done24h = runs24h.filter((r) => r.status === "done").length;
    const closed24h = done24h + errors24h;

    const sumTokens = (list: typeof runs, key: "tokens_input" | "tokens_output") =>
      list.reduce((sum, r) => sum + ((r[key] as number | null) ?? 0), 0);

    const sparkline = Array<number>(24).fill(0);
    for (const r of runs24h) {
      const hoursAgo = Math.floor((now - ts(r)) / 3600_000);
      const idx = 23 - Math.min(23, Math.max(0, hoursAgo));
      sparkline[idx] += 1;
    }

    const perAgent: AgentPulseRow[] = roster.map((a) => {
      const mine = runs.filter((r) => r.agent_id === a.id);
      const mine24h = mine.filter((r) => ts(r) >= H24);
      const mineDone24h = mine24h.filter((r) => r.status === "done").length;
      const mineErr24h = mine24h.filter((r) => r.status === "error").length;
      const mineClosed24h = mineDone24h + mineErr24h;
      const last = mine[0]; // runs already ordered desc
      return {
        slug: a.slug,
        name: a.name,
        status: a.status,
        isEnabled: a.is_enabled,
        runs24h: mine24h.length,
        successRate: mineClosed24h > 0 ? mineDone24h / mineClosed24h : null,
        lastRunStatus: last?.status ?? null,
        lastRunAt: last?.created_at ?? null,
      };
    });

    return {
      runs24h: runs24h.length,
      runs7d: runs.length,
      successRate24h: closed24h > 0 ? done24h / closed24h : null,
      errors24h,
      tokensIn24h: sumTokens(runs24h, "tokens_input"),
      tokensOut24h: sumTokens(runs24h, "tokens_output"),
      activeAgents: roster.filter((a) => a.is_enabled && a.status === "busy").length,
      totalAgents: roster.length,
      sparkline,
      perAgent,
    };
  });
