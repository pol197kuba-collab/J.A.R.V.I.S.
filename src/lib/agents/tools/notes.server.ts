// Narzędzia agentów — notes. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import type { Json } from "@/integrations/supabase/types";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { embedText, noteEmbeddingText, toVectorLiteral } from "@/lib/ai/embed";
import { type Tool, clampInt, sanitizeForOrFilter, toolLedger } from "./shared.server";

// ---------------------------------------------------------------------------
// save_note — insert into public.notes for the current user
// ---------------------------------------------------------------------------

export const saveNote: Tool = {
  risk: "write",
  declaration: {
    name: "save_note",
    description:
      "Save a note to the user's personal notes widget. Use when the user says 'zapisz notatkę', 'save this', 'remember that', or when you have produced a useful summary the user should keep.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title, max 200 chars." },
        body: { type: "string", description: "Full body / content of the note, max 20000 chars." },
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
    const body = String(args.body ?? "").slice(0, 20_000);
    if (!title) return { error: "missing_title" };
    const tagsInput = Array.isArray(args.tags) ? args.tags : [];
    const tags = tagsInput
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 40))
      .slice(0, 20);
    // Best-effort, jak w `remember`: bez embeddingu notatka i tak się zapisze,
    // a do Mózgu 3D trafi po nocnym przebiegu (scripts/brain-layout.ts).
    const embedding = await embedText(
      noteEmbeddingText(title, body),
      ctx.apiKey,
      "RETRIEVAL_DOCUMENT",
      { ledger: toolLedger(ctx, "embed") },
    );
    const { data, error } = await ctx.supabase
      .from("notes")
      .insert({
        owner_id: ctx.userId,
        title,
        body,
        tags,
        source: AGENT_SLUGS.JARVIS,
        ...(embedding ? { embedding: toVectorLiteral(embedding) } : {}),
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

export const listNotesTool: Tool = {
  risk: "read",
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
        limit: { type: "integer", description: "Max results (default 25, max 100)." },
      },
    },
  },
  async execute(args, ctx) {
    const limit = clampInt(args.limit, 1, 100, 25);
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

export const deleteNote: Tool = {
  risk: "external",
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
