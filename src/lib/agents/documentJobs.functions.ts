// Background Insight → Forge pipeline, kicked by the client (fire-and-forget)
// right after a chat turn's queue_document_job tool call returns. Runs in its
// OWN server-function invocation — its own time budget — so research and
// document assembly are no longer squeezed into the single HTTP request of
// the user's chat turn (that's what made generated decks come back thin).
//
// Same idiom already proven by enrichDocumentImagesFn (generated.functions.ts):
// a client-kicked, best-effort background pass. The one addition here is that
// completion (success OR failure) always lands as a row in public.notifications
// — the old image-enrichment pass had none, which is exactly why it could
// silently fail and leave the user guessing.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { enrichGeneratedFileImages } from "@/lib/documents/generated.functions";
import { logServerError, logServerWarn } from "@/lib/system/logServerError";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

const RunInput = z.object({ jobId: z.string().uuid() });

export type RunDocumentJobResult = { ok: true } | { ok: false; reason: string };

async function failJob(
  supabase: SupabaseClient<Database>,
  userId: string,
  jobId: string,
  title: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("document_jobs")
    .update({ status: "error", error: reason.slice(0, 2000), finished_at: new Date().toISOString() })
    .eq("id", jobId);
  await supabase.from("notifications").insert({
    owner_id: userId,
    kind: "document_failed",
    title: `Nie udało się: ${title}`,
    body: reason.slice(0, 500),
    payload: { job_id: jobId } as Json,
  });
}

export const runDocumentJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunInput.parse(input))
  .handler(async ({ data, context }): Promise<RunDocumentJobResult> => {
    const { supabase, userId } = context;

    const { data: job, error: loadErr } = await supabase
      .from("document_jobs")
      .select("id, run_id, title, brief, status")
      .eq("id", data.jobId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (loadErr || !job) return { ok: false, reason: "not_found" };
    // Idempotency guard: a double-kick (e.g. a flaky network retry on the
    // client) must not run the pipeline twice.
    if (job.status !== "queued") return { ok: false, reason: "not_queued" };

    await supabase.from("document_jobs").update({ status: "running" }).eq("id", job.id);

    try {
      const { runOrchestrator } = await import("./runtime.server");

      const insightResult = await runOrchestrator({
        supabase,
        userId,
        agentSlug: AGENT_SLUGS.INSIGHT,
        input: job.brief,
        history: [],
        delegationDepth: 1,
        parentRunId: job.run_id,
      });
      if (insightResult.status !== "done" || !insightResult.output.trim()) {
        await failJob(
          supabase,
          userId,
          job.id,
          job.title,
          `research nie powiódł się: ${insightResult.error ?? "brak treści"}`,
        );
        return { ok: false, reason: "insight_failed" };
      }

      const forgeResult = await runOrchestrator({
        supabase,
        userId,
        agentSlug: AGENT_SLUGS.FORGE,
        input: insightResult.output,
        history: [],
        delegationDepth: 1,
        parentRunId: job.run_id,
      });
      const attachment = forgeResult.attachments?.[0];
      if (forgeResult.status !== "done" || !attachment) {
        await failJob(
          supabase,
          userId,
          job.id,
          job.title,
          `budowa pliku nie powiodła się: ${forgeResult.error ?? "brak pliku"}`,
        );
        return { ok: false, reason: "forge_failed" };
      }

      // Best-effort — a failed image pass still leaves a valid text-only
      // file, so it must never turn a real success into a reported failure.
      if (forgeResult.enrichDocument) {
        try {
          await enrichGeneratedFileImages(supabase, userId, forgeResult.enrichDocument.id);
        } catch (err) {
          await logServerWarn(
            supabase,
            userId,
            "document_jobs",
            `image enrichment failed: ${err instanceof Error ? err.message : String(err)}`,
            { job_id: job.id } as Json,
          );
        }
      }

      await supabase
        .from("document_jobs")
        .update({
          status: "done",
          result: { filename: attachment.filename, download_url: attachment.url } as Json,
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      await supabase.from("notifications").insert({
        owner_id: userId,
        kind: "document_ready",
        title: job.title,
        body: `${attachment.filename} jest gotowy do pobrania.`,
        payload: {
          job_id: job.id,
          filename: attachment.filename,
          download_url: attachment.url,
          document_id: forgeResult.enrichDocument?.id ?? null,
        } as Json,
      });

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logServerError(supabase, userId, "document_jobs", err, { job_id: job.id } as Json);
      await failJob(supabase, userId, job.id, job.title, msg);
      return { ok: false, reason: msg };
    }
  });
