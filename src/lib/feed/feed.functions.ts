// Living Feed — "what happened today", a single chronological narrative
// merging agent runs, notifications, generated files, completed tasks and
// system errors/warnings instead of separate per-widget tables. Read-only:
// pulls from tables other features already write (agent_runs, notifications,
// generated_files, tasks, system_events), no new schema.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type FeedItemType = "run" | "file" | "notification" | "task" | "issue";
export type FeedTone = "info" | "success" | "warning" | "error";

export type FeedItem = {
  id: string;
  type: FeedItemType;
  tone: FeedTone;
  title: string;
  detail: string | null;
  agent: string | null;
  timestamp: string;
};

const ListInput = z
  .object({
    hours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .optional()
      .default(24),
    limit: z.number().int().min(1).max(300).optional().default(150),
  })
  .optional();

export const getLivingFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(async ({ data, context }): Promise<FeedItem[]> => {
    const { supabase, userId } = context;
    const hours = data?.hours ?? 24;
    const limit = data?.limit ?? 150;
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();

    const [agentsRes, runsRes, notifsRes, filesRes, tasksRes, eventsRes] = await Promise.all([
      supabase.from("agents").select("id, name").eq("owner_id", userId),
      supabase
        .from("agent_runs")
        .select("id, agent_id, status, created_at, finished_at, error")
        .eq("user_id", userId)
        .in("status", ["done", "error"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("notifications")
        .select("id, kind, title, body, created_at")
        .eq("owner_id", userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("generated_files")
        .select("id, filename, format, title, created_at")
        .eq("user_id", userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("tasks")
        .select("id, title, status, completed_at")
        .eq("user_id", userId)
        .eq("status", "done")
        .not("completed_at", "is", null)
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(limit),
      supabase
        .from("system_events")
        .select("id, source, level, message, created_at")
        .eq("owner_id", userId)
        .in("level", ["warn", "error"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    const agentName = new Map((agentsRes.data ?? []).map((a) => [a.id, a.name]));

    const items: FeedItem[] = [];

    for (const r of runsRes.data ?? []) {
      const ok = r.status === "done";
      items.push({
        id: `run:${r.id}`,
        type: "run",
        tone: ok ? "success" : "error",
        title: ok ? "Uruchomienie zakończone" : "Uruchomienie nieudane",
        detail: ok ? null : (r.error ?? null),
        agent: agentName.get(r.agent_id) ?? null,
        timestamp: r.finished_at ?? r.created_at,
      });
    }

    for (const n of notifsRes.data ?? []) {
      items.push({
        id: `notification:${n.id}`,
        type: "notification",
        tone: n.kind.includes("fail") || n.kind.includes("error") ? "error" : "info",
        title: n.title,
        detail: n.body,
        agent: null,
        timestamp: n.created_at,
      });
    }

    for (const f of filesRes.data ?? []) {
      items.push({
        id: `file:${f.id}`,
        type: "file",
        tone: "success",
        title: `Wygenerowano plik: ${f.title ?? f.filename}`,
        detail: `${f.format.toUpperCase()} · ${f.filename}`,
        agent: "F.O.R.G.E.",
        timestamp: f.created_at,
      });
    }

    for (const t of tasksRes.data ?? []) {
      items.push({
        id: `task:${t.id}`,
        type: "task",
        tone: "success",
        title: `Zadanie ukończone: ${t.title}`,
        detail: null,
        agent: null,
        timestamp: t.completed_at as string,
      });
    }

    for (const e of eventsRes.data ?? []) {
      items.push({
        id: `issue:${e.id}`,
        type: "issue",
        tone: e.level === "error" ? "error" : "warning",
        title: e.level === "error" ? "Błąd systemu" : "Ostrzeżenie systemu",
        detail: e.message,
        agent: e.source,
        timestamp: e.created_at,
      });
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items.slice(0, limit);
  });
