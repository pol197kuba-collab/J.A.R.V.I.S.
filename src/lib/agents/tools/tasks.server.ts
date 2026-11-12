// Narzędzia agentów — tasks. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import type { Database, Json } from "@/integrations/supabase/types";
import { type Tool, clampInt } from "./shared.server";

// ---------------------------------------------------------------------------
// Task tools — public.tasks (owner-scoped to-do queue the agents drive)
// ---------------------------------------------------------------------------

const TASK_STATUSES = ["todo", "in_progress", "done", "cancelled"] as const;

export const createTask: Tool = {
  risk: "write",
  declaration: {
    name: "create_task",
    description:
      "Create a tracked task / to-do item for the user. Use when the user asks you to do something that spans multiple steps or should be remembered and followed up, or when you break a larger request into pieces. Optionally assign it to a teammate agent via `assignee_slug`.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, action-oriented title." },
        details: {
          type: "string",
          description: "Optional fuller description / acceptance criteria.",
        },
        assignee_slug: {
          type: "string",
          description:
            "Optional slug of the agent that should handle this (e.g. 'jarvis', 'herald').",
        },
        priority: { type: "integer", description: "1 (highest) … 5 (lowest). Defaults to 3." },
        due_at: { type: "string", description: "Optional ISO-8601 due date/time." },
        tags: { type: "array", items: { type: "string" }, description: "Optional short tags." },
        project_id: {
          type: "string",
          description:
            "Optional project id (from list_projects) if this task belongs to a dev project rather than being a general task.",
        },
      },
      required: ["title"],
    },
  },
  async execute(args, ctx) {
    const title = String(args.title ?? "")
      .trim()
      .slice(0, 200);
    if (!title) return { error: "missing_title" };
    const details =
      typeof args.details === "string" && args.details.trim() ? args.details.trim() : null;
    const assignee =
      typeof args.assignee_slug === "string" && args.assignee_slug.trim()
        ? args.assignee_slug.trim().slice(0, 60)
        : null;
    const priority = clampInt(args.priority, 1, 5, 3);
    const tags = (Array.isArray(args.tags) ? args.tags : [])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 40))
      .slice(0, 20);
    // Accept a due date only if it parses as a real timestamp; silently drop
    // garbage so a malformed model value can't fail the whole insert.
    let dueAt: string | null = null;
    if (typeof args.due_at === "string" && args.due_at.trim()) {
      const parsed = new Date(args.due_at.trim());
      if (!Number.isNaN(parsed.getTime())) dueAt = parsed.toISOString();
    }
    const projectId =
      typeof args.project_id === "string" && args.project_id.trim() ? args.project_id.trim() : null;

    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        created_by_agent: ctx.agentId,
        title,
        details,
        assignee_slug: assignee,
        priority,
        tags,
        due_at: dueAt,
        project_id: projectId,
      })
      .select("id, title, status, priority")
      .single();
    if (error) {
      await ctx.logEvent("error", "tool.create_task", error.message, { title } as Json);
      return { error: error.message };
    }
    await ctx.logEvent("info", "tool.create_task", `task created: ${title}`, {
      task_id: data.id,
      assignee,
      priority,
    } as Json);
    return { ok: true, ...data };
  },
};

export const listTasks: Tool = {
  risk: "read",
  declaration: {
    name: "list_tasks",
    description:
      "List the user's tasks. By default returns OPEN tasks (todo + in_progress), highest priority first. Pass `status` to filter (todo | in_progress | done | cancelled), `assignee_slug` to see one agent's queue, or `project_id` to scope to one project (from list_projects) — omit project_id to see general tasks AND project tasks together.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter to one status: todo | in_progress | done | cancelled.",
        },
        assignee_slug: {
          type: "string",
          description: "Filter to tasks assigned to this agent slug.",
        },
        project_id: {
          type: "string",
          description: "Filter to tasks belonging to this project id (from list_projects).",
        },
        limit: { type: "integer", description: "Max results (default 25, max 100)." },
      },
    },
  },
  async execute(args, ctx) {
    const limit = clampInt(args.limit, 1, 100, 25);
    let q = ctx.supabase
      .from("tasks")
      .select(
        "id, title, details, status, priority, assignee_slug, project_id, due_at, tags, created_at, completed_at",
      )
      .eq("user_id", ctx.userId);

    const status = typeof args.status === "string" ? args.status.trim() : "";
    if (status && (TASK_STATUSES as readonly string[]).includes(status)) {
      q = q.eq("status", status);
    } else {
      // Default view = the actionable queue, not the archive.
      q = q.in("status", ["todo", "in_progress"]);
    }
    const assignee = typeof args.assignee_slug === "string" ? args.assignee_slug.trim() : "";
    if (assignee) q = q.eq("assignee_slug", assignee);
    const projectId = typeof args.project_id === "string" ? args.project_id.trim() : "";
    if (projectId) q = q.eq("project_id", projectId);

    const { data, error } = await q
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) {
      await ctx.logEvent("error", "tool.list_tasks", error.message, { status, assignee } as Json);
      return { error: error.message };
    }
    return { count: data?.length ?? 0, tasks: data ?? [] };
  },
};

export const updateTask: Tool = {
  risk: "write",
  declaration: {
    name: "update_task",
    description:
      "Update an existing task by id — change its status (e.g. mark 'done'), attach a result/outcome, re-prioritise, or edit details. Use after you (or a delegated agent) actually complete or advance the work.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The task id (from create_task or list_tasks)." },
        status: {
          type: "string",
          description: "New status: todo | in_progress | done | cancelled.",
        },
        result: { type: "string", description: "Outcome / notes to record on the task." },
        priority: { type: "integer", description: "New priority 1 (highest) … 5 (lowest)." },
        details: { type: "string", description: "Replace the task details." },
      },
      required: ["id"],
    },
  },
  async execute(args, ctx) {
    const id = String(args.id ?? "").trim();
    if (!id) return { error: "missing_id" };
    const patch: Database["public"]["Tables"]["tasks"]["Update"] = {};
    if (typeof args.status === "string" && args.status.trim()) {
      const status = args.status.trim();
      if (!(TASK_STATUSES as readonly string[]).includes(status)) {
        return { error: "invalid_status", allowed: TASK_STATUSES };
      }
      patch.status = status;
      // Stamp / clear the completion time so it always reflects the state.
      patch.completed_at =
        status === "done" || status === "cancelled" ? new Date().toISOString() : null;
    }
    if (typeof args.result === "string") patch.result = args.result;
    if (typeof args.details === "string") patch.details = args.details;
    if (args.priority !== undefined) patch.priority = clampInt(args.priority, 1, 5, 3);
    if (Object.keys(patch).length === 0) return { error: "nothing_to_update" };

    const { data, error } = await ctx.supabase
      .from("tasks")
      .update(patch)
      .eq("id", id)
      .eq("user_id", ctx.userId)
      .select("id, title, status, priority")
      .maybeSingle();
    if (error) {
      await ctx.logEvent("error", "tool.update_task", error.message, { id } as Json);
      return { error: error.message };
    }
    if (!data) return { error: "task_not_found" };
    await ctx.logEvent("info", "tool.update_task", `task updated: ${data.title} → ${data.status}`, {
      task_id: data.id,
      status: data.status,
    } as Json);
    return { ok: true, ...data };
  },
};

export const deleteTask: Tool = {
  risk: "external",
  declaration: {
    name: "delete_task",
    description:
      "Permanently delete a task by id. Prefer update_task with status 'cancelled' when the task is simply no longer relevant — use delete_task only when the user explicitly asks to remove/delete it.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The task id (from create_task or list_tasks)." },
      },
      required: ["id"],
    },
  },
  async execute(args, ctx) {
    const id = String(args.id ?? "").trim();
    if (!id) return { error: "missing_id" };
    const { data, error } = await ctx.supabase
      .from("tasks")
      .delete()
      .eq("id", id)
      .eq("user_id", ctx.userId)
      .select("id, title")
      .maybeSingle();
    if (error) {
      await ctx.logEvent("error", "tool.delete_task", error.message, { id } as Json);
      return { error: error.message };
    }
    if (!data) return { error: "task_not_found" };
    await ctx.logEvent("info", "tool.delete_task", `task deleted: ${data.title}`, {
      task_id: data.id,
    } as Json);
    return { ok: true, id: data.id };
  },
};
