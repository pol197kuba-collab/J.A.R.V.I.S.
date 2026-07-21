// Tasks — CRUD server functions for the task queue UI (widget + /tasks page).
// Tasks are user-scoped (RLS in DB); the same table is written by the
// orchestrator's create_task / update_task tools. Manual UI creates leave
// created_by_agent NULL; agent-created tasks carry the author, surfaced here
// via the tasks_created_by_agent_fkey embed.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { z } from "zod";
import { logServerError } from "@/lib/system/logServerError";

export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";

export type Task = {
  id: string;
  title: string;
  details: string | null;
  status: TaskStatus;
  priority: number;
  assigneeSlug: string | null;
  dueAt: string | null;
  tags: string[];
  result: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Display name of the agent that created it, or null for manual entries. */
  createdByAgent: string | null;
};

const SELECT =
  "id, title, details, status, priority, assignee_slug, due_at, tags, result, created_at, completed_at, author:agents!tasks_created_by_agent_fkey(name)";

type Row = {
  id: string;
  title: string;
  details: string | null;
  status: string;
  priority: number;
  assignee_slug: string | null;
  due_at: string | null;
  tags: string[] | null;
  result: string | null;
  created_at: string;
  completed_at: string | null;
  author: { name: string } | { name: string }[] | null;
};

function mapRow(r: Row): Task {
  const author = Array.isArray(r.author) ? r.author[0] : r.author;
  return {
    id: r.id,
    title: r.title,
    details: r.details,
    status: r.status as TaskStatus,
    priority: r.priority,
    assigneeSlug: r.assignee_slug,
    dueAt: r.due_at,
    tags: r.tags ?? [],
    result: r.result,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    createdByAgent: author?.name ?? null,
  };
}

const OPEN_STATUSES = ["todo", "in_progress"] as const;
const ARCHIVE_STATUSES = ["done", "cancelled"] as const;

const ListInput = z.object({
  scope: z.enum(["open", "archive", "all"]).optional().default("open"),
  assigneeSlug: z.string().min(1).max(60).optional(),
});

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<Task[]> => {
    const { supabase, userId } = context;
    let q = supabase.from("tasks").select(SELECT).eq("user_id", userId);

    if (data.scope === "open") q = q.in("status", [...OPEN_STATUSES]);
    else if (data.scope === "archive") q = q.in("status", [...ARCHIVE_STATUSES]);
    if (data.assigneeSlug) q = q.eq("assignee_slug", data.assigneeSlug);

    // Open queue: most urgent first. Archive/all: most recently touched first.
    q =
      data.scope === "open"
        ? q.order("priority", { ascending: true }).order("created_at", { ascending: true })
        : q.order("completed_at", { ascending: false, nullsFirst: false }).order("created_at", {
            ascending: false,
          });

    const { data: rows, error } = await q.limit(200);
    if (error) {
      await logServerError(supabase, userId, "tasks.list", error);
      throw new Error(error.message);
    }
    return ((rows as Row[] | null) ?? []).map(mapRow);
  });

const CreateInput = z.object({
  title: z.string().min(1).max(200),
  details: z.string().max(20_000).optional(),
  priority: z.number().int().min(1).max(5).optional().default(3),
  assigneeSlug: z.string().min(1).max(60).optional(),
  dueAt: z.string().datetime().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional().default([]),
});

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }): Promise<Task> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        title: data.title.trim(),
        details: data.details?.trim() || null,
        priority: data.priority,
        assignee_slug: data.assigneeSlug ?? null,
        due_at: data.dueAt ?? null,
        tags: data.tags,
      })
      .select(SELECT)
      .single();
    if (error) {
      await logServerError(supabase, userId, "tasks.create", error, { title: data.title } as Json);
      throw new Error(error.message);
    }
    return mapRow(row as Row);
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["todo", "in_progress", "done", "cancelled"]).optional(),
  result: z.string().max(20_000).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  details: z.string().max(20_000).optional(),
});

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateInput.parse(input))
  .handler(async ({ data, context }): Promise<Task> => {
    const { supabase, userId } = context;
    const patch: Database["public"]["Tables"]["tasks"]["Update"] = {};
    if (data.status !== undefined) {
      patch.status = data.status;
      // Mirror the update_task tool: stamp/clear completion time with state.
      patch.completed_at =
        data.status === "done" || data.status === "cancelled" ? new Date().toISOString() : null;
    }
    if (data.result !== undefined) patch.result = data.result;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.details !== undefined) patch.details = data.details;

    const { data: row, error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("user_id", userId)
      .eq("id", data.id)
      .select(SELECT)
      .single();
    if (error) {
      await logServerError(supabase, userId, "tasks.update", error, { task_id: data.id } as Json);
      throw new Error(error.message);
    }
    return mapRow(row as Row);
  });

const DeleteInput = z.object({ id: z.string().uuid() });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("tasks").delete().eq("user_id", userId).eq("id", data.id);
    if (error) {
      await logServerError(supabase, userId, "tasks.delete", error, { task_id: data.id } as Json);
      throw new Error(error.message);
    }
    return { ok: true as const };
  });
