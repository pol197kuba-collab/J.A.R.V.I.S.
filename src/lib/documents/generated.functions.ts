// Producer-generated files archive — list / sign / delete.
//
// Companion to documents.functions.ts (uploaded docs). The bytes live in the
// private 'generated' Storage bucket; these owner-scoped server functions
// list the metadata rows, mint short-lived signed URLs on demand (for the
// /documents preview modal + download button), and delete a file with its
// Storage objects. Signed URLs are minted here rather than stored so they
// can't leak long-lived and can be re-issued after they expire.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { logServerError, logServerWarn } from "@/lib/system/logServerError";

// Short-lived on purpose: these are re-minted per preview/download click, so
// there's no reason to hand out a week-long URL the way the chat link does.
const PREVIEW_URL_TTL_SECONDS = 60 * 30; // 30 min

export type GeneratedFileSummary = {
  id: string;
  filename: string;
  format: string;
  size_bytes: number;
  title: string | null;
  section_count: number | null;
  image_count: number | null;
  /** 'none' | 'pending' | 'ready' | 'failed' — background graphics status. */
  image_status: string;
  has_preview: boolean;
  created_at: string;
};

export const listGeneratedFilesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GeneratedFileSummary[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("generated_files")
      .select(
        "id, filename, format, size_bytes, title, section_count, image_count, image_status, preview_path, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      await logServerError(supabase, userId, "generated_files", error);
      throw new Error(error.message);
    }
    return (data ?? []).map((r) => ({
      id: r.id,
      filename: r.filename,
      format: r.format,
      size_bytes: r.size_bytes,
      title: r.title,
      section_count: r.section_count,
      image_count: r.image_count,
      image_status: r.image_status,
      has_preview: !!r.preview_path,
      created_at: r.created_at,
    }));
  });

// ---------------------------------------------------------------------------
// enrichDocumentImages — background pass that adds AI graphics to a file
// ---------------------------------------------------------------------------

// Kicked by the client (fire-and-forget) right after generate_document
// returns a text-only file with image_status 'pending'. Runs in its OWN
// server-function invocation — its own time budget — so slow/503-prone image
// generation can't blow the budget of the chat turn that produced the file.
// Rebuilds the SAME document (from the stored spec) with images, replaces the
// bytes in place, and flips the status. Idempotent-ish: only acts on a
// 'pending' row, so a double-kick won't double-generate.

const EnrichInput = z.object({ fileId: z.string().uuid() });

export type EnrichResult =
  | { ok: true; imageCount: number; status: "ready" | "failed" }
  | { ok: false; reason: string };

export const enrichDocumentImagesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EnrichInput.parse(input))
  .handler(async ({ data, context }): Promise<EnrichResult> => {
    const { supabase, userId } = context;
    const { generateDocImages, buildDocument, CONTENT_TYPES } =
      await import("@/lib/agents/producer.server");
    type ProducerDocSpec = import("@/lib/agents/producer.server").DocSpec;

    const { data: row, error } = await supabase
      .from("generated_files")
      .select("id, format, storage_path, preview_path, image_status, spec")
      .eq("id", data.fileId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !row) return { ok: false, reason: "not_found" };
    if (row.image_status !== "pending") return { ok: false, reason: "not_pending" };
    if (!row.spec) return { ok: false, reason: "no_spec" };

    const spec = row.spec as unknown as ProducerDocSpec;

    const { data: secret } = await supabase
      .from("user_secrets")
      .select("gemini_api_key")
      .eq("owner_id", userId)
      .maybeSingle();
    const apiKey = secret?.gemini_api_key?.trim();
    if (!apiKey) {
      await supabase.from("generated_files").update({ image_status: "failed" }).eq("id", row.id);
      return { ok: false, reason: "no_api_key" };
    }

    const images = await generateDocImages(spec, apiKey, (message) =>
      logServerWarn(supabase, userId, "generated_files", `enrich: ${message}`, {
        file_id: row.id,
      } as Json),
    );
    const imageCount = (images.hero ? 1 : 0) + images.sections.size;

    if (imageCount === 0) {
      // Every image failed (503 storm etc). Leave the text-only file as-is,
      // mark failed so the UI can offer a retry instead of spinning forever.
      await supabase.from("generated_files").update({ image_status: "failed" }).eq("id", row.id);
      return { ok: true, imageCount: 0, status: "failed" };
    }

    try {
      const bytes = await buildDocument(spec, images);
      const { error: upErr } = await supabase.storage
        .from("generated")
        .update(row.storage_path, bytes, { contentType: CONTENT_TYPES[spec.format] });
      if (upErr) throw new Error(upErr.message);

      // pptx: rebuild the PDF preview with images too.
      if (spec.format === "pptx" && row.preview_path) {
        const previewBytes = await buildDocument({ ...spec, format: "pdf" }, images);
        await supabase.storage
          .from("generated")
          .update(row.preview_path, previewBytes, { contentType: CONTENT_TYPES.pdf });
      }

      await supabase
        .from("generated_files")
        .update({ image_status: "ready", image_count: imageCount, size_bytes: bytes.byteLength })
        .eq("id", row.id);
      return { ok: true, imageCount, status: "ready" };
    } catch (err) {
      await supabase.from("generated_files").update({ image_status: "failed" }).eq("id", row.id);
      await logServerError(supabase, userId, "generated_files", err, { file_id: row.id } as Json);
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

const UrlInput = z.object({
  fileId: z.string().uuid(),
  // "download" forces a Content-Disposition attachment; "preview" serves the
  // (pptx→pdf) preview object inline for the <iframe>.
  kind: z.enum(["download", "preview"]).default("download"),
});

export type GeneratedFileUrlResult =
  | { ok: true; url: string; filename: string; format: string }
  | { ok: false; reason: string };

export const getGeneratedFileUrlFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UrlInput.parse(input))
  .handler(async ({ data, context }): Promise<GeneratedFileUrlResult> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("generated_files")
      .select("filename, format, storage_path, preview_path")
      .eq("id", data.fileId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !row) return { ok: false, reason: "not_found" };

    const usePreview = data.kind === "preview" && !!row.preview_path;
    const path = usePreview ? row.preview_path! : row.storage_path;
    const { data: signed, error: signErr } = await supabase.storage
      .from("generated")
      .createSignedUrl(
        path,
        PREVIEW_URL_TTL_SECONDS,
        // Inline for previews, attachment for downloads.
        data.kind === "download" ? { download: row.filename } : undefined,
      );
    if (signErr || !signed?.signedUrl) {
      return { ok: false, reason: signErr?.message ?? "sign_failed" };
    }
    return { ok: true, url: signed.signedUrl, filename: row.filename, format: row.format };
  });

const DeleteInput = z.object({ fileId: z.string().uuid() });

export const deleteGeneratedFileFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; reason?: string }> => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("generated_files")
      .select("storage_path, preview_path")
      .eq("id", data.fileId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!row) return { ok: false, reason: "not_found" };

    const paths = [row.storage_path, row.preview_path].filter(Boolean) as string[];
    const { error: storageErr } = await supabase.storage.from("generated").remove(paths);
    if (storageErr) {
      // Same philosophy as deleteDocumentFn: proceed with the row delete
      // regardless (an orphaned Storage object is recoverable), but log it.
      await logServerWarn(
        supabase,
        userId,
        "generated_files",
        `storage removal failed for ${paths.join(", ")}: ${storageErr.message}`,
      );
    }

    const { error } = await supabase.from("generated_files").delete().eq("id", data.fileId);
    if (error) {
      await logServerError(supabase, userId, "generated_files", error, {
        file_id: data.fileId,
      } as Json);
      return { ok: false, reason: error.message };
    }
    return { ok: true };
  });
