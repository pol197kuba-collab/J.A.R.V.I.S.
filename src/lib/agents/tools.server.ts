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
  /** agents.id of the agent whose run is executing this tool. */
  agentId: string;
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
export function isPrivateIp(ip: string): boolean {
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

export async function isBlockedTarget(hostname: string): Promise<boolean> {
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
      const message = err instanceof Error ? err.message : String(err);
      await ctx.logEvent("error", "tool.fetch_url", `${url}: ${message}`, { url } as Json);
      return { error: message };
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
    if (error) {
      await ctx.logEvent("error", "tool.save_note", error.message, { title } as Json);
      return { error: error.message };
    }
    await ctx.logEvent("info", "tool.save_note", `note saved: ${title}`, {
      note_id: data.id,
      title,
      tags,
    } as Json);
    return { ok: true, id: data.id, title };
  },
};

const listNotesTool: Tool = {
  declaration: {
    name: "list_notes",
    description:
      "List or search the user's saved notes. Use this BEFORE delete_note to find the note's id — you have no memory of note ids across conversations.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional free-text search over title+body. Omit to list recent notes.",
        },
        limit: { type: "integer", description: "Max results (default 10, max 50)." },
      },
    },
  },
  async execute(args, ctx) {
    const limit = clampInt(args.limit, 1, 50, 10);
    let q = ctx.supabase
      .from("notes")
      .select("id, title, body, tags, created_at")
      .eq("owner_id", ctx.userId);
    const query = typeof args.query === "string" ? sanitizeForOrFilter(args.query) : "";
    if (query) {
      q = q.or(`title.ilike.%${query}%,body.ilike.%${query}%`);
    }
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    if (error) {
      await ctx.logEvent("error", "tool.list_notes", error.message, { query } as Json);
      return { error: error.message };
    }
    return { count: data?.length ?? 0, notes: data ?? [] };
  },
};

const deleteNote: Tool = {
  declaration: {
    name: "delete_note",
    description:
      "Delete a note by id. Use list_notes first if you don't already know the id — never guess it.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The note id (from save_note or list_notes)." },
      },
      required: ["id"],
    },
  },
  async execute(args, ctx) {
    const id = String(args.id ?? "").trim();
    if (!id) return { error: "missing_id" };
    const { data, error } = await ctx.supabase
      .from("notes")
      .delete()
      .eq("id", id)
      .eq("owner_id", ctx.userId)
      .select("id, title")
      .maybeSingle();
    if (error) {
      await ctx.logEvent("error", "tool.delete_note", error.message, { id } as Json);
      return { error: error.message };
    }
    if (!data) return { error: "note_not_found" };
    await ctx.logEvent("info", "tool.delete_note", `note deleted: ${data.title}`, {
      note_id: data.id,
    } as Json);
    return { ok: true, id: data.id };
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

// Dimensionality of the vector(768) column in public.memories. Must match
// the migration (20260715..._semantic_memory.sql) and the value requested
// from Gemini below.
const EMBED_DIMS = 768;
const EMBED_MODEL = "gemini-embedding-001";

// Turn text into a 768-dim embedding via the user's own Gemini key. Best
// effort by design: any failure (no quota, network, HTTP error, malformed
// response) returns null so the caller falls back to keyword search instead
// of failing the whole tool. `taskType` steers Gemini to produce embeddings
// tuned for either the stored document or the search query.
export async function embedText(
  text: string,
  apiKey: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${encodeURIComponent(
        apiKey,
      )}`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: trimmed.slice(0, 8_000) }] },
          taskType,
          outputDimensionality: EMBED_DIMS,
        }),
      },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    const values = data.embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBED_DIMS) return null;
    return values;
  } catch {
    return null;
  }
}

// supabase-js serialises a vector column value as a JSON-array string, e.g.
// "[0.12,-0.03,…]". Kept as a tiny helper so remember/recall agree on format.
export const toVectorLiteral = (values: number[]): string => JSON.stringify(values);

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

    // Embed the value so `recall` can find it by meaning. Best-effort: a null
    // embedding just means this row is keyword-only searchable for now.
    const embedding = await embedText(value, ctx.apiKey, "RETRIEVAL_DOCUMENT");
    const embeddingPatch = embedding ? { embedding: toVectorLiteral(embedding) } : {};

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
          .update({ value, tags, importance, source: "orchestrator", ...embeddingPatch })
          .eq("id", existing.id);
        if (error) {
          await ctx.logEvent("error", "tool.remember", error.message, { key } as Json);
          return { error: error.message };
        }
        await ctx.logEvent("info", "tool.remember", `updated memory: ${key}`, {
          memory_id: existing.id,
          key,
          embedded: Boolean(embedding),
        } as Json);
        return { ok: true, id: existing.id, key, updated: true };
      }
    }

    const { data, error } = await ctx.supabase
      .from("memories")
      .insert({
        user_id: ctx.userId,
        agent_id: ctx.agentId,
        kind: "fact",
        key,
        value,
        tags,
        importance,
        source: "orchestrator",
        ...embeddingPatch,
      })
      .select("id")
      .single();
    if (error) {
      await ctx.logEvent("error", "tool.remember", error.message, { key } as Json);
      return { error: error.message };
    }
    await ctx.logEvent("info", "tool.remember", `saved memory${key ? `: ${key}` : ""}`, {
      memory_id: data.id,
      key,
      embedded: Boolean(embedding),
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
    const rawQuery = typeof args.query === "string" ? args.query.trim() : "";
    const tags = (Array.isArray(args.tags) ? args.tags : [])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim());

    type Hit = {
      id: string;
      key: string | null;
      value: string;
      tags: string[];
      importance: number;
      updated_at: string;
      similarity?: number;
    };
    const merged: Hit[] = [];
    const seen = new Set<string>();
    const push = (rows: Hit[] | null | undefined) => {
      for (const r of rows ?? []) {
        if (seen.has(r.id)) continue;
        if (tags.length > 0 && !r.tags.some((t) => tags.includes(t))) continue;
        seen.add(r.id);
        merged.push(r);
      }
    };

    // 1. Semantic pass — embed the query and rank by cosine similarity.
    //    Best-effort: skipped entirely if there's no query text or embedding
    //    fails (no key/quota/network), leaving the keyword pass to cover it.
    let semanticUsed = false;
    if (rawQuery) {
      const queryEmbedding = await embedText(rawQuery, ctx.apiKey, "RETRIEVAL_QUERY");
      if (queryEmbedding) {
        const { data: sem, error: semErr } = await ctx.supabase.rpc("match_memories", {
          query_embedding: toVectorLiteral(queryEmbedding),
          match_count: limit,
        });
        if (!semErr) {
          semanticUsed = true;
          push(sem as Hit[] | null);
        } else {
          // Previously swallowed entirely — semantic search silently
          // degrading to keyword-only with zero trace was exactly the kind
          // of "something's wrong and Guardian has no idea" gap this pass
          // exists to close.
          await ctx.logEvent(
            "warn",
            "tool.recall",
            `match_memories RPC failed: ${semErr.message}`,
            {
              query: rawQuery,
            } as Json,
          );
        }
      }
    }

    // 2. Keyword / recency pass — ILIKE on value+key (or recent memories when
    //    no query). Always runs so exact word hits and pre-embedding rows are
    //    never lost, and it backfills up to `limit` after semantic hits.
    let q = ctx.supabase
      .from("memories")
      .select("id, key, value, tags, importance, updated_at")
      .eq("user_id", ctx.userId);
    const kwQuery = rawQuery ? sanitizeForOrFilter(rawQuery) : "";
    if (kwQuery) {
      q = q.or(`value.ilike.%${kwQuery}%,key.ilike.%${kwQuery}%`);
    }
    if (tags.length > 0) {
      q = q.overlaps("tags", tags);
    }
    const { data: kw, error } = await q
      .order("importance", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) {
      await ctx.logEvent("error", "tool.recall", error.message, { query: rawQuery } as Json);
      if (merged.length === 0) return { error: error.message };
    }
    push(kw as Hit[] | null);

    const results = merged.slice(0, limit);
    await ctx.logEvent(
      "info",
      "tool.recall",
      `${rawQuery || "(recent)"} → ${results.length} hits${semanticUsed ? " (semantic)" : ""}`,
      {
        query: rawQuery,
        tags,
        hits: results.length,
        semantic: semanticUsed,
      } as Json,
    );
    return { count: results.length, memories: results };
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
        created_by_agent: ctx.agentId,
        title,
        details,
        assignee_slug: assignee,
        priority,
        tags,
        due_at: dueAt,
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
    if (error) {
      await ctx.logEvent("error", "tool.list_tasks", error.message, { status, assignee } as Json);
      return { error: error.message };
    }
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

const deleteTask: Tool = {
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

// ---------------------------------------------------------------------------
// Guardian tools — system health monitoring + active smoke-tests. Read-only:
// they observe/verify state, they never mutate anything except their own
// diagnostic queries.
// ---------------------------------------------------------------------------

const scanErrors: Tool = {
  declaration: {
    name: "guardian_scan_errors",
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

    // NOTE: the live runtime (runOrchestrator's logEvent, every ctx.logEvent
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
      await ctx.logEvent("error", "tool.guardian_scan_errors", eventsErr.message);
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
      await ctx.logEvent("error", "tool.guardian_scan_errors", runsErr.message);
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

const runStats: Tool = {
  declaration: {
    name: "guardian_run_stats",
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
      await ctx.logEvent("error", "tool.guardian_run_stats", error.message);
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

const checkDelegation: Tool = {
  declaration: {
    name: "guardian_check_delegation",
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

    // A delegated run is any run on a non-orchestrator agent — delegation is
    // the only path that creates one today, so this is a reliable filter
    // without needing a dedicated schema flag.
    const { data: agentRows } = await ctx.supabase
      .from("agents")
      .select("id, slug")
      .eq("owner_id", ctx.userId);
    const nonOrchestratorIds = (agentRows ?? [])
      .filter((a) => a.slug !== "orchestrator")
      .map((a) => a.id);
    if (nonOrchestratorIds.length === 0) {
      return { checked: 0, linked: 0, unlinked: 0, note: "no delegated agents exist yet" };
    }

    const { data: runs, error } = await ctx.supabase
      .from("agent_runs")
      .select("id, agent_id, parent_run_id, created_at")
      .eq("user_id", ctx.userId)
      .in("agent_id", nonOrchestratorIds)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      await ctx.logEvent("error", "tool.guardian_check_delegation", error.message);
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

// ---------------------------------------------------------------------------
// Analityk tools — RAG over public.documents / public.document_chunks
// ---------------------------------------------------------------------------

const listDocumentsTool: Tool = {
  declaration: {
    name: "list_documents",
    description:
      "List the documents the user has uploaded for analysis, with processing status and chunk count. Use to check what's available before searching, or to answer 'what documents do I have'.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max results (default 20, max 50)." },
      },
    },
  },
  async execute(args, ctx) {
    const limit = clampInt(args.limit, 1, 50, 20);
    const { data, error } = await ctx.supabase
      .from("documents")
      .select("id, filename, mime_type, status, char_count, chunk_count, error_message, created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      await ctx.logEvent("error", "tool.list_documents", error.message);
      return { error: error.message };
    }
    return { count: data?.length ?? 0, documents: data ?? [] };
  },
};

const searchDocumentsTool: Tool = {
  declaration: {
    name: "search_documents",
    description:
      "Semantic search over the content of the user's uploaded documents (RAG). Use whenever the user asks a question that could be answered from a document they've uploaded. Returns the most relevant chunks with their source filename — always cite which document an answer came from.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for, in natural language." },
        limit: { type: "integer", description: "Max chunks to return (default 6, max 20)." },
      },
      required: ["query"],
    },
  },
  async execute(args, ctx) {
    const query = String(args.query ?? "").trim();
    if (!query) return { error: "empty_query" };
    const limit = clampInt(args.limit, 1, 20, 6);

    type Hit = {
      chunk_id: string;
      document_id: string;
      filename: string;
      chunk_index: number;
      content: string;
      similarity?: number;
    };
    const merged: Hit[] = [];
    const seen = new Set<string>();
    const push = (rows: Hit[] | null | undefined) => {
      for (const r of rows ?? []) {
        if (seen.has(r.chunk_id)) continue;
        seen.add(r.chunk_id);
        merged.push(r);
      }
    };

    // 1. Semantic pass — same best-effort shape as `recall`: embed the
    //    query, skip silently (fall through to keyword pass) on any
    //    failure (no key, quota, network).
    let semanticUsed = false;
    const queryEmbedding = await embedText(query, ctx.apiKey, "RETRIEVAL_QUERY");
    if (queryEmbedding) {
      const { data: sem, error: semErr } = await ctx.supabase.rpc("match_document_chunks", {
        query_embedding: toVectorLiteral(queryEmbedding),
        match_count: limit,
      });
      if (!semErr) {
        semanticUsed = true;
        push(sem as Hit[] | null);
      } else {
        await ctx.logEvent(
          "warn",
          "tool.search_documents",
          `match_document_chunks RPC failed: ${semErr.message}`,
          { query } as Json,
        );
      }
    }

    // 2. Keyword fallback/backfill — ILIKE on chunk content, always runs so
    //    a missing/failed embedding still returns something useful instead
    //    of a hard error. Two simple queries (chunks, then a filename
    //    lookup) rather than an embedded join — same discipline as
    //    `getEnabledToolsForAgent` below, avoiding a hand-maintained
    //    embedded-relation type that could drift from the generated schema.
    if (merged.length < limit) {
      const kwQuery = sanitizeForOrFilter(query);
      if (kwQuery) {
        const { data: kw } = await ctx.supabase
          .from("document_chunks")
          .select("id, document_id, chunk_index, content")
          .eq("user_id", ctx.userId)
          .ilike("content", `%${kwQuery}%`)
          .limit(limit - merged.length);
        const rows = kw ?? [];
        if (rows.length > 0) {
          const docIds = [...new Set(rows.map((r) => r.document_id))];
          const { data: docs } = await ctx.supabase
            .from("documents")
            .select("id, filename")
            .in("id", docIds);
          const filenameById = new Map((docs ?? []).map((d) => [d.id, d.filename]));
          push(
            rows.map((r) => ({
              chunk_id: r.id,
              document_id: r.document_id,
              filename: filenameById.get(r.document_id) ?? "unknown",
              chunk_index: r.chunk_index,
              content: r.content,
            })),
          );
        }
      }
    }

    const results = merged.slice(0, limit);
    await ctx.logEvent(
      "info",
      "tool.search_documents",
      `${query} → ${results.length} hits${semanticUsed ? " (semantic)" : ""}`,
      { query, hits: results.length, semantic: semanticUsed } as Json,
    );
    return { count: results.length, chunks: results };
  },
};

// ---------------------------------------------------------------------------
// Producer tool — generate a downloadable document (pptx/docx/pdf)
// ---------------------------------------------------------------------------

// First tool in this app that produces a FILE instead of returning
// text/data through the JSON tool-call channel: bytes go to the private
// 'generated' Storage bucket (owner-scoped paths, same idiom as
// 'documents') and the model gets back a signed download URL to hand to
// the user in chat. The heavy build libraries (pptxgenjs/docx/pdf-lib +
// the embedded PDF font) are dynamically imported so they only load when
// a document is actually being generated, not on every runtime start.

const SIGNED_URL_TTL_SECONDS = 7 * 24 * 3600; // 7 days

const generateDocumentTool: Tool = {
  declaration: {
    name: "generate_document",
    description:
      "Generate a downloadable file — a presentation (pptx), a Word document (docx), or a PDF — from structured content, and return a download link. Call it ONCE with the complete, final content: a title and a list of sections, each with a heading plus paragraph text and/or bullet points. Write real content in the user's language, never placeholders.",
    parameters: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["pptx", "docx", "pdf"],
          description: "Output file format.",
        },
        title: { type: "string", description: "Document/presentation title." },
        subtitle: { type: "string", description: "Optional subtitle shown under the title." },
        filename: {
          type: "string",
          description: "Optional filename (without extension). Defaults to the title.",
        },
        sections: {
          type: "array",
          description:
            "Ordered sections (slides for pptx, headed sections for docx/pdf). Each needs a heading and real content: paragraph text, bullet points, or both.",
          items: {
            type: "object",
            properties: {
              heading: { type: "string", description: "Section/slide heading." },
              content: { type: "string", description: "Paragraph text for this section." },
              bullets: {
                type: "array",
                items: { type: "string" },
                description: "Bullet points for this section.",
              },
            },
            required: ["heading"],
          },
        },
      },
      required: ["format", "title", "sections"],
    },
  },
  async execute(args, ctx) {
    const { normalizeDocSpec, buildDocument, CONTENT_TYPES } = await import("./producer.server");
    const normalized = normalizeDocSpec(args);
    if (!normalized.ok) {
      await ctx.logEvent("warn", "tool.generate_document", `rejected: ${normalized.error}`, {
        run_id: ctx.runId,
      } as Json);
      return { error: normalized.error };
    }
    const spec = normalized.spec;

    let bytes: Uint8Array;
    try {
      bytes = await buildDocument(spec);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.logEvent(
        "error",
        "tool.generate_document",
        `build failed (${spec.format}): ${msg}`,
        {
          run_id: ctx.runId,
        } as Json,
      );
      return { error: `build_failed: ${msg}` };
    }

    const path = `${ctx.userId}/${crypto.randomUUID()}/${spec.filename}`;
    const { error: uploadErr } = await ctx.supabase.storage
      .from("generated")
      .upload(path, bytes, { contentType: CONTENT_TYPES[spec.format] });
    if (uploadErr) {
      await ctx.logEvent("error", "tool.generate_document", `upload failed: ${uploadErr.message}`, {
        run_id: ctx.runId,
        path,
      } as Json);
      return { error: `storage_upload_failed: ${uploadErr.message}` };
    }

    const { data: signed, error: signErr } = await ctx.supabase.storage
      .from("generated")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: spec.filename });
    if (signErr || !signed?.signedUrl) {
      await ctx.logEvent(
        "error",
        "tool.generate_document",
        `signed url failed: ${signErr?.message ?? "no url"}`,
        { run_id: ctx.runId, path } as Json,
      );
      return { error: `signed_url_failed: ${signErr?.message ?? "unknown"}` };
    }

    await ctx.logEvent(
      "info",
      "tool.generate_document",
      `${spec.format} generated: ${spec.filename} (${bytes.byteLength} bytes, ${spec.sections.length} sections)`,
      { run_id: ctx.runId, path, size_bytes: bytes.byteLength } as Json,
    );
    return {
      ok: true,
      format: spec.format,
      filename: spec.filename,
      sections: spec.sections.length,
      size_bytes: bytes.byteLength,
      download_url: signed.signedUrl,
      link_valid_days: 7,
      instruction:
        "Do NOT copy or retype download_url into your reply — the system appends the download link below your message automatically, and a hand-copied token breaks the signature. Just summarize what was generated.",
    };
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
  listNotesTool,
  deleteNote,
  remember,
  recall,
  createTask,
  listTasks,
  updateTask,
  deleteTask,
  scanErrors,
  runStats,
  checkDelegation,
  listDocumentsTool,
  searchDocumentsTool,
  generateDocumentTool,
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
