// Narzędzia agentów — projects. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import type { Json } from "@/integrations/supabase/types";
import type { Tool } from "./shared.server";

// ---------------------------------------------------------------------------
// Projekty (grupy zadań w /tasks). Dev Wing — start_dev_session /
// check_dev_session, czyli zlecanie kodu Claude Code przez issue w GitHubie —
// usunięty w etapie 8 planu naprawczego; projekty i ich repo_owner/repo_name
// zostają jako zwykłe dane.
// ---------------------------------------------------------------------------

export const createProject: Tool = {
  risk: "write",
  declaration: {
    name: "create_project",
    description:
      "Create a new dev project the user can then attach tasks to (via create_task's project_id). Always call list_projects first to check a project with this name doesn't already exist — project names must be unique per user. Optionally link it to a GitHub repo (repo_owner/repo_name).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short, unique project name." },
        description: { type: "string", description: "Optional one-line description." },
        repo_owner: {
          type: "string",
          description: "Optional GitHub repo owner this project's dev tasks dispatch against.",
        },
        repo_name: { type: "string", description: "Optional GitHub repo name (with repo_owner)." },
        context_doc: {
          type: "string",
          description:
            "Optional free-text 'CLAUDE.md for this project' — stack, conventions, how to run tests. Prepended to every dev task's prompt.",
        },
      },
      required: ["name"],
    },
  },
  async execute(args, ctx) {
    const name = String(args.name ?? "")
      .trim()
      .slice(0, 200);
    if (!name) return { error: "missing_name" };
    const description =
      typeof args.description === "string" && args.description.trim()
        ? args.description.trim()
        : null;
    const repoOwner =
      typeof args.repo_owner === "string" && args.repo_owner.trim() ? args.repo_owner.trim() : null;
    const repoName =
      typeof args.repo_name === "string" && args.repo_name.trim() ? args.repo_name.trim() : null;
    const contextDoc =
      typeof args.context_doc === "string" && args.context_doc.trim()
        ? args.context_doc.trim()
        : null;

    const { data, error } = await ctx.supabase
      .from("projects")
      .insert({
        owner_id: ctx.userId,
        name,
        description,
        repo_owner: repoOwner,
        repo_name: repoName,
        context_doc: contextDoc,
      })
      .select("id, name, status")
      .single();
    if (error) {
      if (error.code === "23505") return { error: "project_name_taken", name };
      await ctx.logEvent("error", "tool.create_project", error.message, { name } as Json);
      return { error: error.message };
    }
    await ctx.logEvent("info", "tool.create_project", `project created: ${name}`, {
      project_id: data.id,
    } as Json);
    return { ok: true, ...data };
  },
};

export const listProjects: Tool = {
  risk: "read",
  declaration: {
    name: "list_projects",
    description:
      "List the user's dev projects (each optionally linked to a GitHub repo). Use to find a project's id, or when the user asks 'what projects do I have'.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter to one status: active | paused | archived.",
        },
      },
    },
  },
  async execute(args, ctx) {
    let q = ctx.supabase
      .from("projects")
      .select("id, name, description, repo_owner, repo_name, status, created_at")
      .eq("owner_id", ctx.userId);
    const status = typeof args.status === "string" ? args.status.trim() : "";
    if (status) q = q.eq("status", status);
    const { data, error } = await q.order("created_at", { ascending: true });
    if (error) {
      await ctx.logEvent("error", "tool.list_projects", error.message);
      return { error: error.message };
    }
    return { count: data?.length ?? 0, projects: data ?? [] };
  },
};
