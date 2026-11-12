// Narzędzia agentów — memory. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import type { Json } from "@/integrations/supabase/types";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { embedText, toVectorLiteral } from "@/lib/ai/embed";
import { buildTraceItems, type TraceItem } from "@/lib/brain/trace";
import { keywordStems, stemsOrFilter } from "@/lib/ai/keywords";
import {
  type Tool,
  type ToolContext,
  clampInt,
  sanitizeForOrFilter,
  toolLedger,
} from "./shared.server";

// ---------------------------------------------------------------------------
// remember — write a durable fact/preference to public.memories
// ---------------------------------------------------------------------------

export const remember: Tool = {
  risk: "write",
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
    // A2d: skąd wpis — od właściciela czy z tury z obcą treścią.
    const origin = ctx.untrustedContent ? "tool" : "user";

    // Embed the value so `recall` can find it by meaning. Best-effort: a null
    // embedding just means this row is keyword-only searchable for now.
    const embedding = await embedText(value, ctx.apiKey, "RETRIEVAL_DOCUMENT", {
      ledger: toolLedger(ctx, "embed"),
    });
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
          .update({
            value,
            tags,
            importance,
            origin,
            source: AGENT_SLUGS.JARVIS,
            ...embeddingPatch,
          })
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
        origin,
        source: AGENT_SLUGS.JARVIS,
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

// Ślad dla Mózgu 3D (/mozg): które gwiazdy trafiły do odpowiedzi.
// Best-effort — brak śladu nigdy nie psuje samego wyszukiwania.
export async function recordBrainTrace(
  ctx: ToolContext,
  tool: string,
  query: string,
  hits: TraceItem[],
): Promise<void> {
  const items = buildTraceItems(hits);
  if (items.length === 0) return;
  try {
    const { error } = await ctx.supabase.from("brain_traces").insert({
      owner_id: ctx.userId,
      run_id: ctx.runId || null,
      tool,
      query: query.slice(0, 500),
      items: items as unknown as Json,
    });
    if (error) await ctx.logEvent("warn", `tool.${tool}`, `brain trace: ${error.message}`);
  } catch {
    /* ślad jest dodatkiem — nie przerywa narzędzia */
  }
}

/** Ile znaków treści notatki wraca do modelu — reszta przez list_notes. */
const RECALL_NOTE_BODY = 600;

export const recall: Tool = {
  risk: "read",
  declaration: {
    name: "recall",
    description:
      "Search your long-term memory for facts/preferences you stored earlier (with the `remember` tool) AND the user's notes. Use at the START of answering when the user refers to themselves, past decisions, 'as I told you', or anything they may have written down. Returns matching memories (newest/most-important first) and matching notes.",
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
    type NoteHit = { id: string; title: string; body: string; similarity?: number };
    const notes: NoteHit[] = [];
    let semanticUsed = false;
    if (rawQuery && ctx.apiKey) {
      const queryEmbedding = await embedText(rawQuery, ctx.apiKey, "RETRIEVAL_QUERY", {
        ledger: toolLedger(ctx, "embed"),
      });
      if (queryEmbedding && tags.length === 0) {
        // Notatki tylko bez filtra tagów — tagi w `recall` dotyczą wspomnień.
        const { data: semNotes, error: notesErr } = await ctx.supabase.rpc("match_notes", {
          query_embedding: toVectorLiteral(queryEmbedding),
          match_count: limit,
        });
        if (notesErr) {
          await ctx.logEvent("warn", "tool.recall", `match_notes RPC failed: ${notesErr.message}`, {
            query: rawQuery,
          } as Json);
        } else {
          for (const n of semNotes ?? []) notes.push(n);
        }
      }
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
          // of "something's wrong and S.H.I.E.L.D. has no idea" gap this pass
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
    // Bez semantyki całe zdanie w ILIKE prawie nigdy nie trafia („skąd wiesz
    // o Marvelu” ≠ „Marvel”) — wtedy szukamy po rdzeniach słów.
    const stems = kwQuery && !semanticUsed ? keywordStems(rawQuery) : [];
    const kwFilter = (cols: [string, string]) =>
      stems.length > 0
        ? stemsOrFilter(stems, cols)
        : `${cols[0]}.ilike.%${kwQuery}%,${cols[1]}.ilike.%${kwQuery}%`;
    if (kwQuery) {
      q = q.or(kwFilter(["value", "key"]));
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

    // Notatki po słowach — gdy semantyka nic nie dała (brak klucza, nowe
    // notatki bez wektora) albo dała mniej niż limit.
    if (kwQuery && tags.length === 0 && notes.length < limit) {
      const { data: kwNotes } = await ctx.supabase
        .from("notes")
        .select("id, title, body")
        .eq("owner_id", ctx.userId)
        .or(kwFilter(["title", "body"]))
        .order("updated_at", { ascending: false })
        .limit(limit - notes.length);
      const seenNotes = new Set(notes.map((n) => n.id));
      for (const n of kwNotes ?? []) if (!seenNotes.has(n.id)) notes.push(n);
    }

    // A2d: pochodzenie wpisu wraca razem z treścią — także dla trafień
    // semantycznych, których RPC nie zwraca tej kolumny. Brak odczytu → "unknown".
    const picked = merged.slice(0, limit);
    const origins = new Map<string, string>();
    if (picked.length > 0) {
      const { data: originRows } = await ctx.supabase
        .from("memories")
        .select("id, origin")
        .in(
          "id",
          picked.map((m) => m.id),
        );
      for (const r of originRows ?? []) origins.set(r.id, r.origin);
    }
    const results = picked.map((m) => ({ ...m, origin: origins.get(m.id) ?? "unknown" }));
    const noteResults = notes.slice(0, limit).map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body.length > RECALL_NOTE_BODY ? `${n.body.slice(0, RECALL_NOTE_BODY)}…` : n.body,
      ...(typeof n.similarity === "number" ? { similarity: n.similarity } : {}),
    }));
    await ctx.logEvent(
      "info",
      "tool.recall",
      `${rawQuery || "(recent)"} → ${results.length} hits, ${noteResults.length} notes${semanticUsed ? " (semantic)" : ""}`,
      {
        query: rawQuery,
        tags,
        hits: results.length,
        notes: noteResults.length,
        semantic: semanticUsed,
      } as Json,
    );
    // Bez zapytania `recall` tylko listuje ostatnie wspomnienia — to nie
    // jest „sięgnięcie po wiedzę”, więc bez śladu w Mózgu.
    if (rawQuery) {
      await recordBrainTrace(ctx, "recall", rawQuery, [
        ...results.map((m) => ({ type: "memory" as const, id: m.id, score: m.similarity ?? null })),
        ...noteResults.map((n) => ({
          type: "note" as const,
          id: n.id,
          score: "similarity" in n ? (n.similarity as number) : null,
        })),
      ]);
    }
    return { count: results.length, memories: results, notes: noteResults };
  },
};
