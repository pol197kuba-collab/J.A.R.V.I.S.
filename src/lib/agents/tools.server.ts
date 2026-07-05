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
// web_search — DuckDuckGo HTML (free, no key) with Wikipedia fallback
// ---------------------------------------------------------------------------

type SearchResult = { title: string; description: string; url: string };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        signal: ctrl.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
      },
    );
    if (!res.ok) return [];
    const html = await res.text();
    const results: SearchResult[] = [];
    const linkRe =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe =
      /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const snippets: string[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = snippetRe.exec(html)) !== null) {
      snippets.push(decodeEntities(sm[1].replace(/<[^>]+>/g, "")).trim());
    }
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null && results.length < 5) {
      let url = m[1];
      // DDG wraps URLs: //duckduckgo.com/l/?uddg=<encoded>&rut=...
      const uddg = url.match(/[?&]uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
      if (url.startsWith("//")) url = "https:" + url;
      if (!/^https?:\/\//i.test(url)) continue;
      const title = decodeEntities(m[2].replace(/<[^>]+>/g, "")).trim();
      if (!title) continue;
      results.push({
        title,
        description: snippets[results.length] ?? "",
        url,
      });
    }
    return results;
  } finally {
    clearTimeout(timer);
  }
}

async function searchWikipedia(query: string, lang: "en" | "pl"): Promise<SearchResult[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    // Full-text search (srsearch) handles natural-language queries far better
    // than opensearch title matching.
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srlimit=5&format=json&origin=*&srsearch=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: { search?: Array<{ title: string; snippet: string }> };
    };
    return (data.query?.search ?? []).map((r) => ({
      title: r.title,
      description: decodeEntities(r.snippet.replace(/<[^>]+>/g, "")),
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
    }));
  } finally {
    clearTimeout(timer);
  }
}

const webSearch: Tool = {
  declaration: {
    name: "web_search",
    description:
      "Search the web for a topic and return up to 5 relevant results (title + short description + URL). Use for factual questions, current events, quick research. Keep the query short and keyword-focused (e.g. 'best AI agents 2026'), not a full sentence.",
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
    try {
      let results: SearchResult[] = [];
      let engine = "duckduckgo";
      try {
        results = await searchDuckDuckGo(query);
      } catch {
        results = [];
      }
      if (results.length === 0) {
        engine = "wikipedia";
        try {
          results = await searchWikipedia(query, lang);
        } catch {
          results = [];
        }
      }
      await ctx.logEvent(
        results.length > 0 ? "info" : "warn",
        "tool.web_search",
        `${query} → ${results.length} results (${engine})`,
        {
        query,
        lang,
        engine,
        count: results.length,
      } as Json);
      if (results.length === 0) {
        return {
          query,
          results: [],
          hint: "No results. Retry with a shorter, keyword-only query (2-4 words).",
        };
      }
      return { query, lang, results };
    } catch (err) {
      await ctx.logEvent("error", "tool.web_search", err instanceof Error ? err.message : String(err), {
        query,
      } as Json);
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