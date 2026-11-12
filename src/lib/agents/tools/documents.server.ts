// Narzędzia agentów — documents. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import type { Json } from "@/integrations/supabase/types";
import { embedText, toVectorLiteral } from "@/lib/ai/embed";
import { recordBrainTrace } from "./memory.server";
import { type Tool, clampInt, sanitizeForOrFilter, toolLedger } from "./shared.server";

// ---------------------------------------------------------------------------
// M.E.T.R.I.C. tools — RAG over public.documents / public.document_chunks
// ---------------------------------------------------------------------------

export const listDocumentsTool: Tool = {
  risk: "read",
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

export const searchDocumentsTool: Tool = {
  risk: "read",
  untrustedOutput: true,
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
    const queryEmbedding = await embedText(query, ctx.apiKey, "RETRIEVAL_QUERY", {
      ledger: toolLedger(ctx, "embed"),
    });
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
    await recordBrainTrace(
      ctx,
      "search_documents",
      query,
      results.map((r) => ({
        type: "document" as const,
        id: r.document_id,
        score: r.similarity ?? null,
      })),
    );
    return { count: results.length, chunks: results };
  },
};

export const readDocumentTool: Tool = {
  risk: "read",
  untrustedOutput: true,
  declaration: {
    name: "read_document",
    description:
      "Return the FULL text of one uploaded document (all its chunks, concatenated in order) — use for summarizing, comparing sections, or any question that needs the whole document rather than a handful of matching fragments from search_documents. Find the id with list_documents first. Very long documents are truncated; the response says so when it happens.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "The document id, from list_documents." },
      },
      required: ["document_id"],
    },
  },
  async execute(args, ctx) {
    const documentId = String(args.document_id ?? "").trim();
    if (!documentId) return { error: "missing_document_id" };

    const { data: doc, error: docErr } = await ctx.supabase
      .from("documents")
      .select("id, filename, status")
      .eq("id", documentId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (docErr) {
      await ctx.logEvent("error", "tool.read_document", docErr.message, {
        document_id: documentId,
      } as Json);
      return { error: docErr.message };
    }
    if (!doc) return { error: "document_not_found" };

    const { data: chunks, error: chunksErr } = await ctx.supabase
      .from("document_chunks")
      .select("chunk_index, content")
      .eq("document_id", documentId)
      .eq("user_id", ctx.userId)
      .order("chunk_index", { ascending: true });
    if (chunksErr) {
      await ctx.logEvent("error", "tool.read_document", chunksErr.message, {
        document_id: documentId,
      } as Json);
      return { error: chunksErr.message };
    }

    const MAX_CHARS = 60_000;
    let content = (chunks ?? []).map((c) => c.content).join("\n\n");
    let truncated = false;
    if (content.length > MAX_CHARS) {
      content = content.slice(0, MAX_CHARS);
      truncated = true;
    }

    await ctx.logEvent("info", "tool.read_document", `read: ${doc.filename}`, {
      document_id: documentId,
      chars: content.length,
      truncated,
    } as Json);
    return { filename: doc.filename, status: doc.status, truncated, content };
  },
};

// ---------------------------------------------------------------------------
// M.E.T.R.I.C. tools — read access to F.O.R.G.E.'s output. generated_files is
// a separate table from documents/document_chunks (no chunking/embedding —
// F.O.R.G.E. writes it, never the user), so this needed its own pair of
// tools rather than reusing list_documents/search_documents.
// ---------------------------------------------------------------------------

export const listGeneratedFilesTool: Tool = {
  risk: "read",
  declaration: {
    name: "list_generated_files",
    description:
      "List presentations/documents F.O.R.G.E. has generated for the user (pptx/docx), with title, format and section count. Use to check what's available before read_generated_file, or to answer 'what files/decks have I generated'. Separate from list_documents, which is for files the user uploaded, not ones F.O.R.G.E. built.",
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
      .from("generated_files")
      .select("id, filename, format, title, section_count, image_status, created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      await ctx.logEvent("error", "tool.list_generated_files", error.message);
      return { error: error.message };
    }
    return { count: data?.length ?? 0, files: data ?? [] };
  },
};

export const readGeneratedFileTool: Tool = {
  risk: "read",
  untrustedOutput: true,
  declaration: {
    name: "read_generated_file",
    description:
      "Return the text content (title + each section's heading/paragraph/bullets) of a presentation/document F.O.R.G.E. generated, for analysis, summarizing or answering questions about it. Find the id with list_generated_files first. Files generated before this tool existed may have no stored content — the response says so rather than guessing.",
    parameters: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "The generated file's id, from list_generated_files.",
        },
      },
      required: ["file_id"],
    },
  },
  async execute(args, ctx) {
    const fileId = String(args.file_id ?? "").trim();
    if (!fileId) return { error: "missing_file_id" };

    const { data: file, error } = await ctx.supabase
      .from("generated_files")
      .select("id, filename, format, title, spec")
      .eq("id", fileId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (error) {
      await ctx.logEvent("error", "tool.read_generated_file", error.message, {
        file_id: fileId,
      } as Json);
      return { error: error.message };
    }
    if (!file) return { error: "file_not_found" };

    // Prezentacja trzyma bloki pod `slides`, dokument pod `sections`. Czytamy
    // oba: wcześniej ta funkcja znała tylko kształt wordowy i KAŻDEJ
    // prezentacji odpowiadała „treść nie została zarchiwizowana" — choć
    // była, tyle że pod drugą nazwą. Agent analizujący własny plik dostawał
    // więc zapewnienie, że nie ma czego analizować.
    type Block = { heading?: string; content?: string; bullets?: string[] };
    const spec = file.spec as {
      title?: string;
      subtitle?: string;
      sections?: Block[];
      slides?: Block[];
    } | null;
    const blocks = spec?.sections ?? spec?.slides;

    if (!blocks) {
      return {
        filename: file.filename,
        format: file.format,
        title: file.title,
        content_available: false,
        note: "Treść tego pliku nie została zarchiwizowana do analizy — dostępne są tylko metadane (tytuł, format).",
      };
    }

    return {
      filename: file.filename,
      format: file.format,
      title: spec?.title ?? file.title,
      subtitle: spec?.subtitle ?? null,
      content_available: true,
      sections: blocks.map((s) => ({
        heading: s.heading ?? "",
        content: s.content ?? "",
        bullets: s.bullets ?? [],
      })),
    };
  },
};
