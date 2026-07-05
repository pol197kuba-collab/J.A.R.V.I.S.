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
// web_search — Wikipedia OpenSearch (free, no key, permissive)
// ---------------------------------------------------------------------------

const webSearch: Tool = {
  declaration: {
    name: "web_search",
    description:
      "Search the web for a topic and return up to 5 relevant results (title + short description + URL). Use for factual questions, current events, quick research. Language auto-detected — pass a Polish query for Polish results.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query, natural language." },
        lang: { type: "string", description: "Language code: 'en' or 'pl'. Defaults to 'en'." },
      },
      required: ["query"],
    },
  },
  async execute(args, ctx) {
    const query = String(args.query ?? "").trim();
    if (!query) return { error: "empty_query" };
    const lang = String(args.lang ?? "en").toLowerCase() === "pl" ? "pl" : "en";
    const url = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&limit=5&namespace=0&format=json&origin=*&search=${encodeURIComponent(query)}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return { error: `http_${res.status}` };
      const data = (await res.json()) as [string, string[], string[], string[]];
      const [, titles, descriptions, urls] = data;
      const results = titles.map((t, i) => ({
        title: t,
        description: descriptions[i] ?? "",
        url: urls[i] ?? "",
      }));
      await ctx.logEvent("info", "tool.web_search", `${query} → ${results.length} results`, {
        query,
        lang,
        count: results.length,
      } as Json);
      return { query, lang, results };
    } catch (err) {
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
    const title = String(args.title ?? "").trim().slice(0, 200);
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

export const orchestratorTools: Tool[] = [webSearch, fetchUrl, saveNote];

export function getToolByName(name: string): Tool | undefined {
  return orchestratorTools.find((t) => t.declaration.name === name);
}