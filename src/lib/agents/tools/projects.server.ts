// Narzędzia agentów — projects. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import type { Json } from "@/integrations/supabase/types";
import type { Tool, ToolContext } from "./shared.server";

// ---------------------------------------------------------------------------
// D.R.O.I.D. tools — Software Delivery. D.R.O.I.D. never writes code itself;
// it dispatches real work to Claude Code (via the claude-dev.yml GitHub
// Actions workflow — see .github/workflows/claude-dev.yml) and tracks the
// result. All three need the user's own GitHub token (user_secrets.github_token,
// Settings → D.R.O.I.D. // GITHUB ACCESS) — missing/invalid token is reported
// back as a normal tool error, never a crash.
// ---------------------------------------------------------------------------

export const createProject: Tool = {
  risk: "write",
  declaration: {
    name: "create_project",
    description:
      "Create a new dev project the user can then attach tasks to (via create_task's project_id). Always call list_projects first to check a project with this name doesn't already exist — project names must be unique per user. Optionally link it to a GitHub repo (repo_owner/repo_name) so start_dev_session can dispatch real coding sessions against it later; a project can also be created without a repo and linked later.",
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
      "List the user's dev projects (each optionally linked to a GitHub repo). Use before start_dev_session to find a project's id, or when the user asks 'what projects do I have'.",
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

async function getGithubToken(ctx: ToolContext): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("user_secrets")
    .select("github_token")
    .eq("owner_id", ctx.userId)
    .maybeSingle();
  const token = data?.github_token?.trim();
  return token || null;
}

export const startDevSession: Tool = {
  risk: "external",
  declaration: {
    name: "start_dev_session",
    description:
      "Dispatch a real coding session for a task that belongs to a dev project (task.project_id must be set — use create_task with project_id, or list_tasks with project_id to find one). Opens a GitHub issue tagged @claude in the project's repo with the full task context; Claude Code then does the actual work (writes code, runs tests, opens a PR) on its own, asynchronously — this call returns immediately with the issue link, it does NOT wait for the work to finish. Use check_dev_session later to see progress. Never marks the task done itself — that only happens once check_dev_session confirms the PR merged.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task id (from create_task or list_tasks)." },
      },
      required: ["task_id"],
    },
  },
  async execute(args, ctx) {
    const taskId = String(args.task_id ?? "").trim();
    if (!taskId) return { error: "missing_task_id" };

    const { data: task, error: taskErr } = await ctx.supabase
      .from("tasks")
      .select("id, title, details, priority, project_id, status")
      .eq("id", taskId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (taskErr) return { error: taskErr.message };
    if (!task) return { error: "task_not_found" };
    if (!task.project_id) {
      return {
        error: "task_has_no_project",
        hint: "This task isn't linked to a project. Set project_id when creating it, or update_task details won't help here — project_id isn't editable via update_task, recreate the task with create_task(project_id=...).",
      };
    }

    const { data: project, error: projectErr } = await ctx.supabase
      .from("projects")
      .select("id, name, description, repo_owner, repo_name, context_doc")
      .eq("id", task.project_id)
      .eq("owner_id", ctx.userId)
      .maybeSingle();
    if (projectErr) return { error: projectErr.message };
    if (!project) return { error: "project_not_found" };
    if (!project.repo_owner || !project.repo_name) {
      return {
        error: "project_has_no_repo",
        hint: `Project "${project.name}" has no linked GitHub repo yet — nowhere to open the issue.`,
      };
    }

    const token = await getGithubToken(ctx);
    if (!token) {
      return {
        error: "no_github_token",
        hint: "No GitHub token linked. Ask the user to add one in Settings → D.R.O.I.D. // GITHUB ACCESS.",
      };
    }

    const { createIssue } = await import("@/lib/dev/github.server");

    const bodyParts = [
      `**Zadanie z projektu „${project.name}"** (priorytet P${task.priority})`,
      project.description ? `\nOpis projektu: ${project.description}` : "",
      project.context_doc ? `\n---\n${project.context_doc}` : "",
      `\n---\n### ${task.title}\n\n${task.details ?? "(brak dodatkowego opisu)"}`,
      `\n---\n@claude wykonaj powyższe zadanie: przeanalizuj repo, zaimplementuj, uruchom testy, otwórz PR. Nie mergujesz sam.`,
    ];

    let issue: { number: number; htmlUrl: string };
    try {
      issue = await createIssue(
        token,
        project.repo_owner,
        project.repo_name,
        task.title,
        bodyParts.filter(Boolean).join("\n"),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.logEvent("error", "tool.start_dev_session", message, { task_id: taskId } as Json);
      return { error: `github_error: ${message}` };
    }

    const { data: session, error: sessionErr } = await ctx.supabase
      .from("dev_sessions")
      .insert({
        owner_id: ctx.userId,
        project_id: project.id,
        task_id: task.id,
        status: "queued",
        issue_number: issue.number,
        issue_url: issue.htmlUrl,
      })
      .select("id")
      .single();
    if (sessionErr) {
      await ctx.logEvent("error", "tool.start_dev_session", sessionErr.message, {
        task_id: taskId,
      } as Json);
      return { error: sessionErr.message };
    }

    await ctx.supabase.from("tasks").update({ status: "in_progress" }).eq("id", task.id);
    await ctx.logEvent(
      "info",
      "tool.start_dev_session",
      `dev session started: ${task.title} → ${issue.htmlUrl}`,
      { task_id: taskId, dev_session_id: session.id, issue_url: issue.htmlUrl } as Json,
    );

    return {
      ok: true,
      dev_session_id: session.id,
      issue_url: issue.htmlUrl,
      note: "Praca właśnie się zaczyna w tle — sprawdź postęp przez check_dev_session za jakiś czas, nie od razu.",
    };
  },
};

export const checkDevSession: Tool = {
  risk: "read",
  declaration: {
    name: "check_dev_session",
    description:
      "Check progress on a dev session started with start_dev_session. Polls GitHub for the linked PR and its CI status, updates the stored status, and — only once the PR is actually merged — marks the task done with a result summary. Use when the user asks about progress on a dev task, or periodically after starting one.",
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The task id — looks up its most recent dev session.",
        },
        dev_session_id: {
          type: "string",
          description: "Alternative to task_id — a specific dev session id.",
        },
      },
    },
  },
  async execute(args, ctx) {
    const taskId = typeof args.task_id === "string" ? args.task_id.trim() : "";
    const devSessionId = typeof args.dev_session_id === "string" ? args.dev_session_id.trim() : "";
    if (!taskId && !devSessionId) return { error: "missing_task_id_or_dev_session_id" };

    let q = ctx.supabase
      .from("dev_sessions")
      .select(
        "id, task_id, project_id, status, issue_number, issue_url, pr_number, pr_url, summary",
      )
      .eq("owner_id", ctx.userId);
    q = devSessionId ? q.eq("id", devSessionId) : q.eq("task_id", taskId);
    const { data: session, error: sessionErr } = await q
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sessionErr) return { error: sessionErr.message };
    if (!session) return { error: "dev_session_not_found" };

    const { data: project, error: projectErr } = await ctx.supabase
      .from("projects")
      .select("repo_owner, repo_name")
      .eq("id", session.project_id)
      .maybeSingle();
    if (projectErr || !project?.repo_owner || !project.repo_name) {
      return { error: "project_repo_missing" };
    }

    const token = await getGithubToken(ctx);
    if (!token) {
      return {
        error: "no_github_token",
        hint: "No GitHub token linked. Ask the user to add one in Settings → D.R.O.I.D. // GITHUB ACCESS.",
      };
    }

    const { findLinkedPullRequest, getPullRequestStatus } = await import("@/lib/dev/github.server");
    const owner = project.repo_owner;
    const repo = project.repo_name;

    let prNumber = session.pr_number;
    let prUrl = session.pr_url;
    if (!prNumber) {
      try {
        const linked = await findLinkedPullRequest(token, owner, repo, session.issue_number!);
        if (linked) {
          prNumber = linked.number;
          prUrl = linked.htmlUrl;
        }
      } catch (err) {
        await ctx.logEvent(
          "warn",
          "tool.check_dev_session",
          `linked-PR lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    let status = session.status;
    let summary = session.summary;
    if (prNumber) {
      try {
        const pr = await getPullRequestStatus(token, owner, repo, prNumber);
        if (pr.merged) {
          status = "done";
          summary = `PR #${prNumber} scalony.`;
        } else if (pr.state === "closed") {
          status = "failed";
          summary = `PR #${prNumber} zamknięty bez scalenia.`;
        } else if (pr.ci === "failure") {
          status = "running";
          summary = `PR #${prNumber} otwarty, CI czerwone — Claude Code prawdopodobnie jeszcze poprawia.`;
        } else if (pr.ci === "success") {
          status = "review";
          summary = `PR #${prNumber} gotowy do przeglądu — CI zielone, czeka na Twoją decyzję o mergu.`;
        } else {
          status = "running";
          summary = `PR #${prNumber} otwarty, CI w trakcie.`;
        }
      } catch (err) {
        await ctx.logEvent(
          "warn",
          "tool.check_dev_session",
          `PR status lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      status = "running";
      summary = "Issue otwarte, Claude Code jeszcze nie otworzył PR-a.";
    }

    await ctx.supabase
      .from("dev_sessions")
      .update({
        status,
        pr_number: prNumber,
        pr_url: prUrl,
        summary,
        finished_at: status === "done" || status === "failed" ? new Date().toISOString() : null,
      })
      .eq("id", session.id);

    if (status === "done") {
      await ctx.supabase
        .from("tasks")
        .update({
          status: "done",
          result: summary,
          completed_at: new Date().toISOString(),
        })
        .eq("id", session.task_id);
    }

    return {
      status,
      summary,
      issue_url: session.issue_url,
      pr_url: prUrl,
    };
  },
};
