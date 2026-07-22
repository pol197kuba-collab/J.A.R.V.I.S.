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
        "id, filename, format, size_bytes, title, section_count, image_count, preview_path, created_at",
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
      has_preview: !!r.preview_path,
      created_at: r.created_at,
    }));
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
