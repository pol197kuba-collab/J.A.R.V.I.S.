// Server-only tool implementations for the Orchestrator.
//
// Each tool has:
//  - `declaration`: sent to Gemini as a function declaration.
//  - `execute`: runs on our server, receives typed args, returns a small
//    JSON-serialisable result the model reads back.
//
// All tools rely exclusively on FREE upstream endpoints (Wikipedia REST /
// OpenSearch, public HTTP fetch) or the user's own Supabase row-level data.
// No paid keys are touched here.

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export type ToolContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  runId: string;
  apiKey: string;
  model: string;
  logEvent: (
    level: "info" | "warn" | "error",
    source: string,
    message: string,
    meta?: Json,
  ) => Promise<void>;
};

export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolResult = Record<string, unknown>;

export type Tool = {
  declaration: ToolDeclaration;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

// ---------------------------------------------------------------------------
// web_search — Gemini native Google Search grounding
// ---------------------------------------------------------------------------

// Uses a second Gemini call with the native `google_search` grounding tool
// enabled. Gemini forbids mixing google_search with custom functionDeclarations
// in the same request, so we isolate it here: the outer agent loop keeps
// function-calling, and this tool "delegates" the actual search to a grounded
// Gemini turn. Returns a synthesised answer plus real Google source URLs.

type GroundingChunk = {
  web?: { uri?: string; title?: string };
};

const webSearch: Tool = {
  declaration: {
    name: "web_search",
    description:
      "Search the live web via Google Search grounding. Returns a synthesised answer for the query plus the source URLs Gemini actually consulted. Use for any factual, current-event, news, price, weather, sports, or research question. Pass a natural-language query in the user's language.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language search query in the user's language.",
        },
      },
      required: ["query"],
    },
  },
  async execute(args, ctx) {
    const query = String(args.query ?? "").trim();
    if (!query) return { error: "empty_query" };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          ctx.model,
        )}:generateContent?key=${encodeURIComponent(ctx.apiKey)}`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: "You are a factual web research helper. Answer the query concisely in the same language it was asked. Cite specific facts, numbers, dates, and names. Do NOT add commentary or roleplay.",
                },
              ],
            },
            generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
            tools: [{ google_search: {} }],
            contents: [{ role: "user", parts: [{ text: query }] }],
          }),
        },
      );
      clearTimeout(timer);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        await ctx.logEvent("error", "tool.web_search", `HTTP ${res.status}`, {
          query,
          body: body.slice(0, 300),
        } as Json);
        return { error: `google_search_http_${res.status}` };
      }
      const data = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          groundingMetadata?: {
            groundingChunks?: GroundingChunk[];
            webSearchQueries?: string[];
          };
        }>;
      };
      const cand = data.candidates?.[0];
      const answer = (cand?.content?.parts ?? [])
        .flatMap((p) => (p.text ? [p.text] : []))
        .join("")
        .trim();
      const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
        .flatMap((c) => (c.web?.uri ? [{ url: c.web.uri, title: c.web.title ?? "" }] : []))
        .slice(0, 8);
      const queries = cand?.groundingMetadata?.webSearchQueries ?? [];
      await ctx.logEvent(
        answer ? "info" : "warn",
        "tool.web_search",
        `${query} → ${sources.length} sources`,
        { query, sources: sources.length, queries } as Json,
      );
      return {
        query,
        answer: answer || "(no answer returned)",
        sources,
        google_queries: queries,
      };
    } catch (err) {
      await ctx.logEvent(
        "error",
        "tool.web_search",
        err instanceof Error ? err.message : String(err),
        {
          query,
        } as Json,
      );
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// fetch_url — GET arbitrary URL, return text (capped)
// ---------------------------------------------------------------------------

const MAX_FETCH_BYTES = 12_000;

// SSRF guard: the agent decides what URL to fetch (often steered by search
// results or page content it just read), so a prompt injection could try to
// point it at cloud metadata endpoints or other internal services. Block
// loopback/private/link-local targets, resolving hostnames first so a
// public domain that merely points at an internal IP is caught too.
function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // includes 169.254.169.254 metadata
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (/^fe[89ab]/.test(lower)) return true; // link-local
    if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice("::ffff:".length));
    return false;
  }
  return true; // not a literal IP — caller should have resolved it first
}

async function isBlockedTarget(hostname: string): Promise<boolean> {
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower === "metadata.google.internal"
  ) {
    return true;
  }
  if (isIP(hostname)) return isPrivateIp(hostname);
  try {
    const results = await lookup(hostname, { all: true });
    return results.length === 0 || results.some((r) => isPrivateIp(r.address));
  } catch {
    return true; // DNS failure — fail closed rather than let it through unresolved
  }
}

// Follows redirects manually (instead of letting fetch() auto-follow) so
// every hop's target is re-validated — otherwise a public URL could 302 to
// an internal address and slip past the initial check.
async function safeFetch(
  startUrl: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
  maxRedirects = 3,
): Promise<Response> {
  let current = startUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    const parsed = new URL(current);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("invalid_url");
    if (await isBlockedTarget(parsed.hostname)) throw new Error("blocked_target");
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too_many_redirects");
}

const fetchUrl: Tool = {
  declaration: {
    name: "fetch_url",
    description:
      "Fetch the plain-text contents of a public URL. Returns the first ~12kB of body text. Use after web_search to read a page in detail. HTTP/HTTPS only.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute HTTP(S) URL." },
      },
      required: ["url"],
    },
  },
  async execute(args, ctx) {
    const url = String(args.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return { error: "invalid_url" };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      let res: Response;
      try {
        res = await safeFetch(url, {
          signal: ctrl.signal,
          headers: { "user-agent": "JARVIS-Agent/1.0 (+https://jarvisbyjacob.lovable.app)" },
        });
      } finally {
        clearTimeout(timer);
      }
      const raw = await res.text();
      const stripped = raw
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const text = stripped.slice(0, MAX_FETCH_BYTES);
      await ctx.logEvent("info", "tool.fetch_url", `${url} (${res.status}, ${text.length} chars)`, {
        url,
        status: res.status,
        length: text.length,
      } as Json);
      return { url, status: res.status, text, truncated: stripped.length > MAX_FETCH_BYTES };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// save_note — insert into public.notes for the current user
// ---------------------------------------------------------------------------

const saveNote: Tool = {
  declaration: {
    name: "save_note",
    description:
      "Save a note to the user's personal notes widget. Use when the user says 'zapisz notatkę', 'save this', 'remember that', or when you have produced a useful summary the user should keep.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title, max 200 chars." },
        body: { type: "string", description: "Full body / content of the note." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional short tags.",
        },
      },
      required: ["title", "body"],
    },
  },
  async execute(args, ctx) {
    const title = String(args.title ?? "")
      .trim()
      .slice(0, 200);
    const body = String(args.body ?? "");
    if (!title) return { error: "missing_title" };
    const tagsInput = Array.isArray(args.tags) ? args.tags : [];
    const tags = tagsInput
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 40))
      .slice(0, 20);
    const { data, error } = await ctx.supabase
      .from("notes")
      .insert({
        owner_id: ctx.userId,
        title,
        body,
        tags,
        source: "orchestrator",
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    await ctx.logEvent("info", "tool.save_note", `note saved: ${title}`, {
      note_id: data.id,
      title,
      tags,
    } as Json);
    return { ok: true, id: data.id, title };
  },
};

// ---------------------------------------------------------------------------
// remember — write a durable fact/preference to public.memories
// ---------------------------------------------------------------------------

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const remember: Tool = {
  declaration: {
    name: "remember",
    description:
      "Store a durable fact or preference in long-term memory so you recall it in FUTURE sessions. Use for things the user tells you about themselves, their projects, preferences, or decisions (e.g. 'my name is …', 'I prefer …', 'the API key lives in …'). Optionally pass a stable `key` (e.g. 'user_name') to overwrite the same fact instead of duplicating it. Do NOT store transient chit-chat.",
    parameters: {
      type: "object",
      properties: {
        value: {
          type: "string",
          description: "The fact/preference to remember, as a short sentence.",
        },
        key: {
          type: "string",
          description:
            "Optional stable identifier (e.g. 'user_name', 'timezone'). If a memory with this key exists, it is overwritten rather than duplicated.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional short tags for retrieval.",
        },
        importance: {
          type: "integer",
          description: "1 (trivial) … 5 (critical). Defaults to 3.",
        },
      },
      required: ["value"],
    },
  },
  async execute(args, ctx) {
    const value = String(args.value ?? "").trim();
    if (!value) return { error: "empty_value" };
    const key =
      typeof args.key === "string" && args.key.trim() ? args.key.trim().slice(0, 120) : null;
    const tags = (Array.isArray(args.tags) ? args.tags : [])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 40))
      .slice(0, 20);
    const importance = clampInt(args.importance, 1, 5, 3);

    // Upsert-by-key: a stable key means "this is the same fact, update it"
    // rather than piling up duplicates every time the user restates it.
    if (key) {
      const { data: existing } = await ctx.supabase
        .from("memories")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("key", key)
        .maybeSingle();
      if (existing) {
        const { error } = await ctx.supabase
          .from("memories")
          .update({ value, tags, importance, source: "orchestrator" })
          .eq("id", existing.id);
        if (error) return { error: error.message };
        await ctx.logEvent("info", "tool.remember", `updated memory: ${key}`, {
          memory_id: existing.id,
          key,
        } as Json);
        return { ok: true, id: existing.id, key, updated: true };
      }
    }

    const { data, error } = await ctx.supabase
      .from("memories")
      .insert({
        user_id: ctx.userId,
        kind: "fact",
        key,
        value,
        tags,
        importance,
        source: "orchestrator",
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    await ctx.logEvent("info", "tool.remember", `saved memory${key ? `: ${key}` : ""}`, {
      memory_id: data.id,
      key,
    } as Json);
    return { ok: true, id: data.id, key, updated: false };
  },
};

// ---------------------------------------------------------------------------
// recall — read back facts from public.memories
// ---------------------------------------------------------------------------

// Strip characters that would break PostgREST's comma/paren-delimited `.or()`
// filter grammar, so a free-text query can't corrupt the query or inject
// extra filter clauses.
const sanitizeForOrFilter = (s: string): string => s.replace(/[,()*%\\]/g, " ").trim();

const recall: Tool = {
  declaration: {
    name: "recall",
    description:
      "Search your long-term memory for facts/preferences you stored earlier (with the `remember` tool). Use at the START of answering when the user refers to themselves, past decisions, or 'as I told you'. Returns matching memories newest/most-important first.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text search over stored facts. Omit to list recent memories.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional: only memories carrying any of these tags.",
        },
        limit: { type: "integer", description: "Max results (default 8, max 25)." },
      },
    },
  },
  async execute(args, ctx) {
    const limit = clampInt(args.limit, 1, 25, 8);
    let q = ctx.supabase
      .from("memories")
      .select("id, key, value, tags, importance, updated_at")
      .eq("user_id", ctx.userId);

    const query = typeof args.query === "string" ? sanitizeForOrFilter(args.query) : "";
    if (query) {
      q = q.or(`value.ilike.%${query}%,key.ilike.%${query}%`);
    }
    const tags = (Array.isArray(args.tags) ? args.tags : [])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim());
    if (tags.length > 0) {
      q = q.overlaps("tags", tags);
    }

    const { data, error } = await q
      .order("importance", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) return { error: error.message };
    await ctx.logEvent(
      "info",
      "tool.recall",
      `${query || "(recent)"} → ${data?.length ?? 0} hits`,
      {
        query,
        tags,
        hits: data?.length ?? 0,
      } as Json,
    );
    return { count: data?.length ?? 0, memories: data ?? [] };
  },
};

// ---------------------------------------------------------------------------
// Task tools — public.tasks (owner-scoped to-do queue the agents drive)
// ---------------------------------------------------------------------------

const TASK_STATUSES = ["todo", "in_progress", "done", "cancelled"] as const;

const createTask: Tool = {
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
            "Optional slug of the agent that should handle this (e.g. 'orchestrator', 'marketer').",
        },
        priority: { type: "integer", description: "1 (highest) … 5 (lowest). Defaults to 3." },
        due_at: { type: "string", description: "Optional ISO-8601 due date/time." },
        tags: { type: "array", items: { type: "string" }, description: "Optional short tags." },
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

    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        title,
        details,
        assignee_slug: assignee,
        priority,
        tags,
        due_at: dueAt,
      })
      .select("id, title, status, priority")
      .single();
    if (error) return { error: error.message };
    await ctx.logEvent("info", "tool.create_task", `task created: ${title}`, {
      task_id: data.id,
      assignee,
      priority,
    } as Json);
    return { ok: true, ...data };
  },
};

const listTasks: Tool = {
  declaration: {
    name: "list_tasks",
    description:
      "List the user's tasks. By default returns OPEN tasks (todo + in_progress), highest priority first. Pass `status` to filter (todo | in_progress | done | cancelled) or `assignee_slug` to see one agent's queue.",
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
        limit: { type: "integer", description: "Max results (default 20, max 50)." },
      },
    },
  },
  async execute(args, ctx) {
    const limit = clampInt(args.limit, 1, 50, 20);
    let q = ctx.supabase
      .from("tasks")
      .select(
        "id, title, details, status, priority, assignee_slug, due_at, tags, created_at, completed_at",
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

    const { data, error } = await q
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) return { error: error.message };
    return { count: data?.length ?? 0, tasks: data ?? [] };
  },
};

const updateTask: Tool = {
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
    if (error) return { error: error.message };
    if (!data) return { error: "task_not_found" };
    await ctx.logEvent("info", "tool.update_task", `task updated: ${data.title} → ${data.status}`, {
      task_id: data.id,
      status: data.status,
    } as Json);
    return { ok: true, ...data };
  },
};

// Full catalog of tool *implementations* known to this codebase. This array
// is the only place `execute` logic lives — it never shrinks based on DB
// state, so a disabled tool's code stays available (just unreachable via the
// declarations sent to the model). Slugs here MUST match `public.tools.slug`
// rows; keep the two in sync by hand (see supabase/migrations for the seed).
export const ALL_TOOLS: Tool[] = [
  webSearch,
  fetchUrl,
  saveNote,
  remember,
  recall,
  createTask,
  listTasks,
  updateTask,
];

export function getToolByName(name: string): Tool | undefined {
  return ALL_TOOLS.find((t) => t.declaration.name === name);
}

// ---------------------------------------------------------------------------
// DB-driven registry: which of the known tools is THIS agent allowed to call
// right now? Two independent switches must both be "on":
//   - public.tools.is_enabled       — global kill switch (admin-managed)
//   - public.agent_tools.is_enabled — per-agent toggle (Settings page)
// Two simple queries rather than one embedded join, to avoid depending on
// hand-maintained embedded-relation typings drifting out of sync with the
// actual Supabase-generated types.
// ---------------------------------------------------------------------------

export async function getEnabledToolsForAgent(
  supabase: SupabaseClient<Database>,
  agentId: string,
): Promise<Tool[]> {
  const { data: bindings, error: bindingsErr } = await supabase
    .from("agent_tools")
    .select("tool_id")
    .eq("agent_id", agentId)
    .eq("is_enabled", true);
  if (bindingsErr) {
    throw new Error(`Agent tool bindings lookup failed: ${bindingsErr.message}`);
  }
  const toolIds = (bindings ?? []).map((b) => b.tool_id);
  if (toolIds.length === 0) return [];

  const { data: toolRows, error: toolsErr } = await supabase
    .from("tools")
    .select("slug")
    .in("id", toolIds)
    .eq("is_enabled", true);
  if (toolsErr) {
    throw new Error(`Tool registry lookup failed: ${toolsErr.message}`);
  }
  const enabledSlugs = new Set((toolRows ?? []).map((t) => t.slug));

  return ALL_TOOLS.filter((t) => enabledSlugs.has(t.declaration.name));
}
