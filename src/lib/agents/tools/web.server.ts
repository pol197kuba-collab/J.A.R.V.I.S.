// Narzędzia agentów — web. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { Json } from "@/integrations/supabase/types";
import { callGemini } from "@/lib/ai/llm/gemini";
import type { GeminiUsageMetadata } from "@/lib/ai/llm/usage";
import { type Tool, toolLedger } from "./shared.server";

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

type WebSearchResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: GroundingChunk[];
      webSearchQueries?: string[];
    };
  }>;
  usageMetadata?: GeminiUsageMetadata;
};

export const webSearch: Tool = {
  risk: "read",
  untrustedOutput: true,
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
      const res = await callGemini<WebSearchResponse>({
        apiKey: ctx.apiKey,
        model: ctx.model,
        body: {
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
        },
        timeoutMs: 15_000,
        ledger: toolLedger(ctx, "web_search"),
      });
      if (!res.ok) {
        if (res.status === null) throw new Error(res.error ?? res.message);
        await ctx.logEvent("error", "tool.web_search", `HTTP ${res.status}`, {
          query,
          body: res.bodyText.slice(0, 300),
        } as Json);
        return { error: `google_search_http_${res.status}` };
      }
      const data = res.data;
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

// A13: jeden limit czasu na całe pobranie (nagłówki I treść) i limit bajtów
// czytanych ze strumienia. Wcześniej timer kończył się po nagłówkach, a
// `res.text()` czytało dowolnie dużą (albo nigdy niekończącą się) odpowiedź.
export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_BYTES = 512 * 1024;

/** Czy odpowiedź to tekst, który ma sens czytać (HTML, tekst, JSON, XML). */
export function isTextualContentType(contentType: string | null): boolean {
  // Brak nagłówka: spróbuj jako tekst — i tak chroni limit bajtów.
  if (!contentType) return true;
  const mime = contentType.split(";")[0].trim().toLowerCase();
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/xhtml+xml" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml")
  );
}

/**
 * Czyta treść strumieniem do `maxBytes`; resztę porzuca. Przerwanie sygnału
 * anuluje czytanie (także w trakcie oczekiwania na kolejny fragment).
 */
async function readBodyCapped(
  res: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ text: string; capped: boolean }> {
  if (!res.body) return { text: "", capped: false };
  const reader = res.body.getReader();
  const onAbort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  let capped = false;
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = maxBytes - bytes;
      if (value.byteLength >= room) {
        text += decoder.decode(value.subarray(0, room), { stream: true });
        capped = true;
        break;
      }
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (capped) await reader.cancel().catch(() => {});
  }
  return { text, capped };
}

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

export const fetchUrl: Tool = {
  risk: "read",
  untrustedOutput: true,
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
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await safeFetch(url, {
        signal: ctrl.signal,
        headers: { "user-agent": "JARVIS-Agent/1.0 (+https://jarvisbyjacob.lovable.app)" },
      });
      const contentType = res.headers.get("content-type");
      if (!isTextualContentType(contentType)) {
        await res.body?.cancel().catch(() => {});
        await ctx.logEvent("warn", "tool.fetch_url", `${url}: nietekstowa treść (${contentType})`, {
          url,
          content_type: contentType,
        } as Json);
        return { error: "unsupported_content_type", content_type: contentType };
      }
      const { text: raw, capped } = await readBodyCapped(res, FETCH_MAX_BYTES, ctrl.signal);
      if (ctrl.signal.aborted) throw new Error("timeout");
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
      return {
        url,
        status: res.status,
        text,
        truncated: capped || stripped.length > MAX_FETCH_BYTES,
      };
    } catch (err) {
      const message = ctrl.signal.aborted
        ? "timeout"
        : err instanceof Error
          ? err.message
          : String(err);
      await ctx.logEvent("error", "tool.fetch_url", `${url}: ${message}`, { url } as Json);
      return { error: message };
    } finally {
      clearTimeout(timer);
    }
  },
};
