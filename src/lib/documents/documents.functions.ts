// Document upload + processing pipeline for RAG (Analityk).
//
// First use of Supabase Storage in this codebase — no prior upload
// precedent, so the flow is deliberately the standard Supabase shape:
// the client uploads bytes directly to Storage under its own authenticated
// session (RLS-equivalent storage policies scope every path to
// `${user_id}/...`, see the migration), and these server functions only
// ever handle metadata + the actual text-extraction/chunking/embedding
// work — never raw file bytes over the request body, which this app's
// server-function runtime has no existing multipart/base64 handling for.
//
// v1 scope (explicit product decision, 2026-07-20): .txt/.md + PDF only.
// Kept conservative on purpose — this environment's server-function
// execution budget is a real, previously-confirmed constraint (see
// flightRadar.ts's timeout history), so processing is capped hard rather
// than left to silently run long or time out. Every cap below fails with
// an explicit `documents.status = 'error'` + human-readable message
// instead of a silent partial result, same philosophy as flightRadar's
// `area_too_large` discriminated result.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { logServerError, logServerWarn } from "@/lib/system/logServerError";
// tools.server.ts is a .server.ts module — this file is a *.functions.ts
// file, which ships to the client bundle (see client.server.ts's own
// comment on this). Load it dynamically inside the handler, same pattern
// runtime.functions.ts already uses for runtime.server.ts, never as a
// top-level import here.

export const ALLOWED_EXTENSIONS = [".txt", ".md", ".markdown", ".pdf"] as const;
type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

// Raw upload cap — a fast pre-check before any download/extraction work.
// Deliberately small; the real gate is MAX_CHUNKS_PER_DOCUMENT below, since
// bytes don't map 1:1 to extractable characters (especially for PDF).
export const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB

// Chunking: paragraph-aware, ~1200 chars per chunk with 150 chars of
// overlap so a fact split across a chunk boundary is still findable from
// either side.
const CHUNK_SIZE_CHARS = 1200;
const CHUNK_OVERLAP_CHARS = 150;

// Hard cap on chunks processed per document. Chosen conservatively: even
// in the pathological worst case (every embedding call individually
// timing out at embedText's own 10s internal limit, run in batches of
// EMBED_BATCH_SIZE), this stays well under a minute — a deliberately
// tight budget given this environment's execution-time behavior has bitten
// this project before (flightRadar needed its timeout raised from 10s to
// 25s just for a single external call). Raise once real processing
// latency is observed live, not upfront.
export const MAX_CHUNKS_PER_DOCUMENT = 40;
const EMBED_BATCH_SIZE = 8;

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

function isAllowedExtension(ext: string): ext is AllowedExtension {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

// Paragraph-aware chunker: fills chunks up to CHUNK_SIZE_CHARS from whole
// paragraphs, carrying the tail of the previous chunk forward as overlap.
// A single paragraph larger than the chunk size is hard-sliced with the
// same overlap rather than left oversized.
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const paragraphs = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > chunkSize) {
      pushCurrent();
      let start = 0;
      while (start < para.length) {
        const end = Math.min(start + chunkSize, para.length);
        chunks.push(para.slice(start, end));
        if (end === para.length) break;
        start = end - overlap;
      }
      continue;
    }
    if (current.length + para.length + 2 > chunkSize) {
      pushCurrent();
      const tail = chunks[chunks.length - 1]?.slice(-overlap) ?? "";
      current = tail ? `${tail}\n\n${para}` : para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  pushCurrent();
  return chunks;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

// ---------------------------------------------------------------------------
// createDocumentFn — reserve a documents row + storage path before upload
// ---------------------------------------------------------------------------

const CreateInput = z.object({
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

export type CreateDocumentResult =
  | { ok: true; documentId: string; storagePath: string; bucket: "documents" }
  | { ok: false; reason: "unsupported_type" | "too_large" | "db_error"; message?: string };

export const createDocumentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }): Promise<CreateDocumentResult> => {
    const { supabase, userId } = context;

    const ext = extensionOf(data.filename);
    if (!isAllowedExtension(ext)) {
      return { ok: false, reason: "unsupported_type" };
    }
    if (data.sizeBytes > MAX_FILE_SIZE_BYTES) {
      return { ok: false, reason: "too_large" };
    }

    const documentId = crypto.randomUUID();
    const storagePath = `${userId}/${documentId}/${sanitizeFilename(data.filename)}`;

    const { error } = await supabase.from("documents").insert({
      id: documentId,
      user_id: userId,
      filename: data.filename.slice(0, 200),
      mime_type: data.mimeType,
      storage_path: storagePath,
      size_bytes: data.sizeBytes,
      status: "uploading",
    });
    if (error) {
      await logServerError(supabase, userId, "documents", error, {
        filename: data.filename,
      } as Json);
      return { ok: false, reason: "db_error", message: error.message };
    }

    return { ok: true, documentId, storagePath, bucket: "documents" };
  });

// ---------------------------------------------------------------------------
// processDocumentFn — download, extract, chunk, embed, store
// ---------------------------------------------------------------------------

const ProcessInput = z.object({ documentId: z.string().uuid() });

export type ProcessDocumentResult =
  | { ok: true; chunkCount: number; charCount: number; embeddedCount: number }
  | { ok: false; reason: string };

export const processDocumentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProcessInput.parse(input))
  .handler(async ({ data, context }): Promise<ProcessDocumentResult> => {
    const { supabase, userId } = context;
    const { embedText, toVectorLiteral } = await import("@/lib/agents/tools.server");

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("id, filename, storage_path, status")
      .eq("id", data.documentId)
      .eq("user_id", userId)
      .maybeSingle();
    if (docErr || !doc) return { ok: false, reason: "not_found" };

    const fail = async (message: string) => {
      await supabase
        .from("documents")
        .update({ status: "error", error_message: message })
        .eq("id", doc.id);
      await supabase.from("system_events").insert({
        owner_id: userId,
        level: "error",
        source: "documents",
        message: `Document processing failed (${doc.filename}): ${message}`,
        meta: { document_id: doc.id } as Json,
      });
      return { ok: false as const, reason: message };
    };

    await supabase.from("documents").update({ status: "processing" }).eq("id", doc.id);

    const { data: blob, error: dlErr } = await supabase.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlErr || !blob) return fail(`storage download failed: ${dlErr?.message ?? "no data"}`);

    const ext = extensionOf(doc.filename);
    let text: string;
    try {
      if (ext === ".pdf") {
        text = await extractPdfText(new Uint8Array(await blob.arrayBuffer()));
      } else {
        text = await blob.text();
      }
    } catch (err) {
      return fail(`text extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!text.trim()) return fail("no extractable text found in this document");

    const chunks = chunkText(text, CHUNK_SIZE_CHARS, CHUNK_OVERLAP_CHARS);
    if (chunks.length === 0) return fail("no extractable text found in this document");
    if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
      return fail(
        `document too large for now (${chunks.length} chunks, max ${MAX_CHUNKS_PER_DOCUMENT}) — try a shorter document`,
      );
    }

    const { data: secret } = await supabase
      .from("user_secrets")
      .select("gemini_api_key")
      .eq("owner_id", userId)
      .maybeSingle();
    const apiKey = secret?.gemini_api_key?.trim();
    if (!apiKey) {
      return fail("no Gemini key linked — add one in Settings to process documents");
    }

    // Embed in small parallel batches: fast enough to stay inside this
    // environment's execution budget, gentle enough not to hammer the
    // embedding endpoint. Any individual failure yields a null embedding
    // (best-effort, same as `remember`) rather than failing the batch.
    const embeddings: (number[] | null)[] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((c) => embedText(c, apiKey, "RETRIEVAL_DOCUMENT")),
      );
      embeddings.push(...batchResults);
    }

    const rows = chunks.map((content, i) => ({
      document_id: doc.id,
      user_id: userId,
      chunk_index: i,
      content,
      embedding: embeddings[i] ? toVectorLiteral(embeddings[i]!) : null,
    }));
    const { error: insErr } = await supabase.from("document_chunks").insert(rows);
    if (insErr) return fail(`chunk storage failed: ${insErr.message}`);

    const embeddedCount = embeddings.filter(Boolean).length;
    if (embeddedCount === 0 && chunks.length > 0) {
      // The document still processes successfully (keyword-only search
      // still works via search_documents' fallback pass), but total
      // embedding failure across every single chunk is exactly the kind
      // of silent degradation that used to leave zero trace anywhere —
      // e.g. an expired/invalid Gemini key would quietly turn ALL
      // semantic search (memories + documents) into keyword-only with
      // nothing ever recording that it happened.
      await logServerWarn(
        supabase,
        userId,
        "documents",
        `document processed but 0/${chunks.length} chunks embedded (${doc.filename}) — semantic search degraded to keyword-only, check the linked Gemini key`,
        { document_id: doc.id } as Json,
      );
    }
    await supabase
      .from("documents")
      .update({
        status: "ready",
        char_count: text.length,
        chunk_count: chunks.length,
        error_message: null,
      })
      .eq("id", doc.id);

    return { ok: true, chunkCount: chunks.length, charCount: text.length, embeddedCount };
  });

// ---------------------------------------------------------------------------
// listDocumentsFn / deleteDocumentFn — for the /documents UI
// ---------------------------------------------------------------------------

export type DocumentSummary = {
  id: string;
  filename: string;
  mime_type: string;
  status: string;
  size_bytes: number;
  char_count: number | null;
  chunk_count: number | null;
  error_message: string | null;
  created_at: string;
};

export const listDocumentsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DocumentSummary[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("documents")
      .select(
        "id, filename, mime_type, status, size_bytes, char_count, chunk_count, error_message, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      await logServerError(supabase, userId, "documents", error);
      throw new Error(error.message);
    }
    return data ?? [];
  });

const DeleteInput = z.object({ documentId: z.string().uuid() });

export const deleteDocumentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; reason?: string }> => {
    const { supabase, userId } = context;
    const { data: doc } = await supabase
      .from("documents")
      .select("storage_path")
      .eq("id", data.documentId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!doc) return { ok: false, reason: "not_found" };

    // Previously ignored entirely — a failed Storage removal (RLS/path
    // issue) left an orphaned file with zero trace while the DB row
    // deletion proceeded regardless. Still proceed with the DB delete
    // (an orphaned Storage object is recoverable manually; a document row
    // stuck because Storage hiccupped is a worse user-facing outcome),
    // but now at least log it so it's not invisible.
    const { error: storageErr } = await supabase.storage
      .from("documents")
      .remove([doc.storage_path]);
    if (storageErr) {
      await logServerWarn(
        supabase,
        userId,
        "documents",
        `storage removal failed for ${doc.storage_path}: ${storageErr.message}`,
      );
    }

    const { error } = await supabase.from("documents").delete().eq("id", data.documentId);
    if (error) {
      await logServerError(supabase, userId, "documents", error, {
        document_id: data.documentId,
      } as Json);
      return { ok: false, reason: error.message };
    }
    return { ok: true };
  });
