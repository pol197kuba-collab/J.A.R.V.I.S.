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
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "user-agent": "JARVIS-Agent/1.0 (+https://jarvisbyjacob.lovable.app)" },
      });
      clearTimeout(timer);
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

// Full catalog of tool *implementations* known to this codebase. This array
// is the only place `execute` logic lives — it never shrinks based on DB
// state, so a disabled tool's code stays available (just unreachable via the
// declarations sent to the model). Slugs here MUST match `public.tools.slug`
// rows; keep the two in sync by hand (see supabase/migrations for the seed).
export const ALL_TOOLS: Tool[] = [webSearch, fetchUrl, saveNote];

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
