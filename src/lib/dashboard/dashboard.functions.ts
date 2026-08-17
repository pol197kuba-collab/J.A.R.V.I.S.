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
  /** 24 hourly buckets (oldest → newest), this agent only. */
  sparkline24h: number[];
  /** 7 daily buckets (oldest → newest), this agent only. */
  sparkline7d: number[];
};

export type SystemPulse = {
  runs24h: number;
  runs7d: number;
  successRate24h: number | null;
  /** Failed agent_runs in 24h — hard failures only (a run that never recovered). */
  failedRuns24h: number;
  /**
   * system_events at level warn/error in 24h — the same query S.H.I.E.L.D.'s
   * guardian_scan_errors tool runs. Catches things like a provider fallback
   * (Gemini -> Groq) that a run recovered from, so it never shows up as a
   * failed run but is still worth flagging.
   */
  warnEvents24h: number;
  tokensIn24h: number;
  tokensOut24h: number;
  activeAgents: number;
  totalAgents: number;
  /** 24 hourly buckets (oldest → newest), all agents combined. */
  sparkline24h: number[];
  /** 7 daily buckets (oldest → newest), all agents combined. */
  sparkline7d: number[];
  perAgent: AgentPulseRow[];
};

function hourlyBuckets(runs: { created_at: string }[], now: number): number[] {
  const buckets = Array<number>(24).fill(0);
  for (const r of runs) {
    const hoursAgo = Math.floor((now - new Date(r.created_at).getTime()) / 3600_000);
    if (hoursAgo < 0 || hoursAgo >= 24) continue;
    buckets[23 - hoursAgo] += 1;
  }
  return buckets;
}

function dailyBuckets(runs: { created_at: string }[], now: number): number[] {
  const buckets = Array<number>(7).fill(0);
  for (const r of runs) {
    const daysAgo = Math.floor((now - new Date(r.created_at).getTime()) / 86_400_000);
    if (daysAgo < 0 || daysAgo >= 7) continue;
    buckets[6 - daysAgo] += 1;
  }
  return buckets;
}

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

    const { count: warnEvents24h } = await supabase
      .from("system_events")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .in("level", ["warn", "error"])
      .gte("created_at", new Date(H24).toISOString());

    const ts = (r: (typeof runs)[number]) => new Date(r.created_at).getTime();
    const runs24h = runs.filter((r) => ts(r) >= H24);
    const failedRuns24h = runs24h.filter((r) => r.status === "error").length;
    const done24h = runs24h.filter((r) => r.status === "done").length;
    const closed24h = done24h + failedRuns24h;

    const sumTokens = (list: typeof runs, key: "tokens_input" | "tokens_output") =>
      list.reduce((sum, r) => sum + ((r[key] as number | null) ?? 0), 0);

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
        sparkline24h: hourlyBuckets(mine, now),
        sparkline7d: dailyBuckets(mine, now),
      };
    });

    return {
      runs24h: runs24h.length,
      runs7d: runs.length,
      successRate24h: closed24h > 0 ? done24h / closed24h : null,
      failedRuns24h,
      warnEvents24h: warnEvents24h ?? 0,
      tokensIn24h: sumTokens(runs24h, "tokens_input"),
      tokensOut24h: sumTokens(runs24h, "tokens_output"),
      activeAgents: roster.filter((a) => a.is_enabled && a.status === "busy").length,
      totalAgents: roster.length,
      sparkline24h: hourlyBuckets(runs, now),
      sparkline7d: dailyBuckets(runs, now),
      perAgent,
    };
  });

// ---------------------------------------------------------------------------
// Kokpit startowy — "what's waiting for you right now", the dynamic hero
// that replaced the static welcome banner. Deliberately forward-looking
// (overdue/upcoming tasks, files ready to grab, unread notifications)
// rather than retrospective — that's what the Living Feed and System Pulse
// are for.
// ---------------------------------------------------------------------------

export type CockpitTask = {
  id: string;
  title: string;
  priority: number;
  dueAt: string | null;
  overdue: boolean;
};

export type CockpitFile = {
  id: string;
  filename: string;
  format: string;
  title: string | null;
  createdAt: string;
  downloadUrl: string | null;
};

export type Cockpit = {
  overdueTasks: CockpitTask[];
  upcomingTasks: CockpitTask[];
  recentFiles: CockpitFile[];
  unreadNotifications: number;
};

const COCKPIT_SIGNED_URL_TTL_SECONDS = 3600;

export const getCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Cockpit> => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();

    const [tasksRes, filesRes, unreadRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, priority, due_at")
        .eq("user_id", userId)
        .in("status", ["todo", "in_progress"])
        .order("priority", { ascending: true })
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(20),
      supabase
        .from("generated_files")
        .select("id, filename, format, title, storage_path, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", userId)
        .eq("read", false),
    ]);

    const allOpenTasks: CockpitTask[] = (tasksRes.data ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      dueAt: t.due_at,
      overdue: t.due_at != null && t.due_at < nowIso,
    }));
    const overdueTasks = allOpenTasks.filter((t) => t.overdue).slice(0, 5);
    const upcomingTasks = allOpenTasks.filter((t) => !t.overdue).slice(0, 5);

    const recentFiles: CockpitFile[] = await Promise.all(
      (filesRes.data ?? []).map(async (f) => {
        const { data: signed } = await supabase.storage
          .from("generated")
          .createSignedUrl(f.storage_path, COCKPIT_SIGNED_URL_TTL_SECONDS, {
            download: f.filename,
          });
        return {
          id: f.id,
          filename: f.filename,
          format: f.format,
          title: f.title,
          createdAt: f.created_at,
          downloadUrl: signed?.signedUrl ?? null,
        };
      }),
    );

    return {
      overdueTasks,
      upcomingTasks,
      recentFiles,
      unreadNotifications: unreadRes.count ?? 0,
    };
  });
