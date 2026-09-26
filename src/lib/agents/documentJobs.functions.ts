// Background Insight → Forge pipeline, kicked by the client (fire-and-forget)
// right after a chat turn's queue_document_job tool call returns. Runs in its
// OWN server-function invocation — its own time budget — so research and
// document assembly are no longer squeezed into the single HTTP request of
// the user's chat turn (that's what made generated decks come back thin).
//
// Same idiom already proven by enrichDocumentImagesFn (generated.functions.ts):
// a client-kicked, best-effort background pass. Additions over that pattern:
//   - each agent hop gets a bounded retry instead of failing on the first
//     transient error (503s are common and expected here);
//   - a QA gate reads back what was actually built (section/image counts +
//     a cheap Gemini judgement against the original brief) BEFORE anything is
//     handed to the user, with one corrective Forge retry if it fails;
//   - completion (success, success-with-warnings, or failure) always lands as
//     a row in public.notifications with honest wording — the old
//     image-enrichment pass had none, and "done" used to mean the same thing
//     whether or not the images actually made it in.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { DEFAULT_GEMINI_MODEL } from "@/lib/agents/models";
import { enrichGeneratedFileImages } from "@/lib/documents/generated.functions";
import { logServerError, logServerWarn } from "@/lib/system/logServerError";
import { notifyOwner } from "@/lib/notifications/notify.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { AgentRunResult } from "./runtime.functions";
import type { OrchestratorInput } from "./runtime.server";
import { blocksOf } from "./docSpec";
import type { ProducerSpec } from "./producer.server";

const RunInput = z.object({ jobId: z.string().uuid() });

/** Klient Supabase: sesja użytkownika z aplikacji albo logowanie z joba. */
type JobDb = SupabaseClient<Database>;

export type RunDocumentJobResult = { ok: true } | { ok: false; reason: string };

// Transient failures (rate limits, 503 storms on the shared-capacity model)
// are the common case here, not the exception — one retry with a short
// pause covers most of them without meaningfully delaying the notification.
const AGENT_RETRY_ATTEMPTS = 2;
const AGENT_RETRY_BACKOFF_MS = 2000;

async function runOrchestratorWithRetry(args: OrchestratorInput): Promise<AgentRunResult> {
  const { runOrchestrator } = await import("./runtime.server");
  let last: AgentRunResult | null = null;
  for (let attempt = 1; attempt <= AGENT_RETRY_ATTEMPTS; attempt++) {
    try {
      const result = await runOrchestrator(args);
      if (result.status === "done" && result.output.trim()) return result;
      last = result;
    } catch (err) {
      last = {
        runId: "",
        status: "error",
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (attempt < AGENT_RETRY_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, AGENT_RETRY_BACKOFF_MS * attempt));
    }
  }
  return last!;
}

async function failJob(
  supabase: SupabaseClient<Database>,
  userId: string,
  jobId: string,
  title: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("document_jobs")
    .update({
      status: "error",
      error: reason.slice(0, 2000),
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  await notifyOwner(supabase, userId, {
    kind: "document_failed",
    title: `Nie udało się: ${title}`,
    body: reason.slice(0, 500),
    payload: { job_id: jobId } as Json,
    url: "/documents",
  });
}

// ---------------------------------------------------------------------------
// QA gate — reads back what was actually built and judges it against the
// original brief BEFORE the user ever sees a link. Fails OPEN on its own
// infrastructure errors (bad response, network) — a QA outage must never be
// the reason a real file never reaches the user — but a clear model
// judgement that the content is inadequate blocks delivery until one
// corrective retry has been tried.
// ---------------------------------------------------------------------------

type QaVerdict = { ok: boolean; reason: string };

/**
 * Skrót treści dla bramki jakości: tytuł i to, co naprawdę stoi w blokach.
 *
 * BIERZE `blocksOf`, A NIE `spec.sections` — i to jest tu cała historia.
 * Wcześniej ta funkcja brała `DocSpec`, czyli kształt WORDOWY, i chodziła po
 * `spec.sections`. Prezentacja ma `slides`, nie `sections`, więc dla każdej
 * prezentacji zbudowanej w tle `spec.sections` było `undefined` i całe
 * zadanie wywracało się na `.entries()` — już PO wygenerowaniu pliku, tuż
 * przed dostarczeniem go użytkownikowi. Rzutowanie `as unknown as DocSpec`
 * w wywołaniu zdejmowało jedyne ostrzeżenie, które mogło to złapać.
 *
 * Slajdy „metrics" i „compare" trzymają treść poza `content`/`bullets`.
 * Bez nich sędzia widziałby puste pozycje i mógł odrzucić poprawną
 * prezentację — a odrzucenie kosztuje ponowny przebieg Forge'a.
 */
export function buildDigest(spec: ProducerSpec): string {
  const lines = [`Tytuł: ${spec.title}`];
  if (spec.subtitle) lines.push(`Podtytuł: ${spec.subtitle}`);
  for (const [i, block] of blocksOf(spec).entries()) {
    const parts: string[] = [];
    const content = (block.content ?? "").slice(0, 200);
    if (content) parts.push(content);
    if ("metrics" in block && block.metrics?.length) {
      parts.push(block.metrics.map((m) => `${m.value}${m.label ? ` ${m.label}` : ""}`).join("; "));
    }
    if ("columns" in block && block.columns) {
      parts.push(
        block.columns.map((c) => `${c.heading}: ${c.bullets.slice(0, 3).join(", ")}`).join(" | "),
      );
    }
    const bulletPreview = (block.bullets ?? []).slice(0, 3).join("; ");
    lines.push(
      `${i + 1}. ${block.heading} — ${parts.join(" ")}${bulletPreview ? ` [${bulletPreview}]` : ""}`,
    );
  }
  return lines.join("\n").slice(0, 6000);
}

async function judgeDocument(apiKey: string, brief: string, digest: string): Promise<QaVerdict> {
  const prompt =
    `ZADANIE UŻYTKOWNIKA:\n${brief}\n\n` +
    `TREŚĆ WYBUDOWANEGO DOKUMENTU (nagłówki + skrót treści każdej sekcji):\n${digest}\n\n` +
    `Czy ten dokument realnie i wystarczająco szczegółowo spełnia zadanie użytkownika? ` +
    `Odpowiedz WYŁĄCZNIE surowym JSON: {"ok": boolean, "reason": "krótkie uzasadnienie po polsku, max 200 znaków"}.`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 150,
              responseMimeType: "application/json",
            },
          }),
        },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok)
      return {
        ok: true,
        reason: `QA niedostępne (HTTP ${res.status}) — plik dostarczony bez weryfikacji`,
      };
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(text) as { ok?: unknown; reason?: unknown };
    if (typeof parsed.ok !== "boolean") throw new Error("malformed QA response");
    return {
      ok: parsed.ok,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : "",
    };
  } catch (err) {
    // Fail open: a broken QA call must never block a real, already-built file.
    return {
      ok: true,
      reason: `QA niedostępne (${err instanceof Error ? err.message : String(err)}) — plik dostarczony bez weryfikacji`,
    };
  }
}

/**
 * Wykonuje zadanie dokumentowe. Rdzeń — bez warstwy HTTP, żeby mógł go wołać
 * zarówno klient (przez `runDocumentJobFn`), jak i ratownik z nocnego joba.
 *
 * `allowResume` wpuszcza zadanie, które utknęło w `running`. Domyślnie jest
 * WYŁĄCZONE: kliknięcie klienta ma prawo uruchomić tylko świeżą kolejkę,
 * inaczej podwójne kliknięcie zdublowałoby trwającą pracę. Ratownik włącza
 * je świadomie, dopiero po sprawdzeniu, że zadanie od kwadransa nie daje
 * znaku życia (documentJobs.recovery.ts).
 */
export async function runDocumentJobCore(
  supabase: JobDb,
  userId: string,
  jobId: string,
  options: { allowResume?: boolean } = {},
): Promise<RunDocumentJobResult> {
  {
    const { data: job, error: loadErr } = await supabase
      .from("document_jobs")
      .select("id, run_id, title, brief, status, attempts")
      .eq("id", jobId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (loadErr || !job) return { ok: false, reason: "not_found" };
    // Strażnik idempotencji: podwójne kliknięcie klienta (np. ponowienie po
    // zerwanej sieci) nie może uruchomić potoku dwa razy.
    const startable = job.status === "queued" || (options.allowResume && job.status === "running");
    if (!startable) return { ok: false, reason: "not_queued" };

    // Licznik rośnie PRZY STARCIE, nie na końcu — zadanie, które zginie w
    // połowie, ma zostawić po sobie ślad, że ktoś już do niego podchodził.
    // Bez tego zerwane podejście byłoby niewidzialne i ratownik wskrzeszałby
    // je w nieskończoność.
    await supabase
      .from("document_jobs")
      .update({ status: "running", attempts: (job.attempts ?? 0) + 1 })
      .eq("id", job.id);

    try {
      const { data: secret } = await supabase
        .from("user_secrets")
        .select("gemini_api_key")
        .eq("owner_id", userId)
        .maybeSingle();
      const apiKey = secret?.gemini_api_key?.trim();

      const insightResult = await runOrchestratorWithRetry({
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
          `research nie powiódł się po ${AGENT_RETRY_ATTEMPTS} próbach: ${insightResult.error ?? "brak treści"}`,
        );
        return { ok: false, reason: "insight_failed" };
      }

      const warnings: string[] = [];

      // buildForgeAndEnrich: one full Forge → generate_document → image
      // enrichment pass. Extracted as a closure (not a top-level function) so
      // the one-shot QA-triggered retry below can call it again unchanged.
      const buildForgeAndEnrich = async (
        forgeInput: string,
      ): Promise<{
        forgeResult: AgentRunResult;
        attachment: { filename: string; url: string } | undefined;
        digest: string | null;
      }> => {
        const forgeResult = await runOrchestratorWithRetry({
          supabase,
          userId,
          agentSlug: AGENT_SLUGS.FORGE,
          input: forgeInput,
          history: [],
          delegationDepth: 1,
          parentRunId: job.run_id,
        });
        const attachment = forgeResult.attachments?.[0];
        let digest: string | null = null;

        if (attachment && forgeResult.enrichDocument) {
          const fileId = forgeResult.enrichDocument.id;
          try {
            const enrichOutcome = await enrichGeneratedFileImages(supabase, userId, fileId);
            if (enrichOutcome.ok && enrichOutcome.status === "failed") {
              warnings.push(
                "nie udało się pobrać/wygenerować żadnego zdjęcia — plik jest tekstowy",
              );
            } else if (!enrichOutcome.ok) {
              warnings.push(`obrazki: ${enrichOutcome.reason}`);
            }
          } catch (err) {
            warnings.push(`obrazki: ${err instanceof Error ? err.message : String(err)}`);
            await logServerWarn(
              supabase,
              userId,
              "document_jobs",
              `image enrichment threw: ${err instanceof Error ? err.message : String(err)}`,
              { job_id: job.id } as Json,
            );
          }

          const { data: fileRow } = await supabase
            .from("generated_files")
            .select("spec")
            .eq("id", fileId)
            .eq("user_id", userId)
            .maybeSingle();
          if (fileRow?.spec) digest = buildDigest(fileRow.spec as unknown as ProducerSpec);
        }

        return { forgeResult, attachment, digest };
      };

      // Forge only ever saw Insight's research digest, never the user's
      // original brief — so concrete asks buried in the brief (an exact
      // slide count, a requested tone/style, a length target) had no way to
      // reach Forge at all; it only had raw facts to work from and had to
      // guess everything about shape and depth, which is exactly why decks
      // came back short and generic regardless of what was actually asked.
      // Prepending the brief verbatim means Forge sees both what the user
      // wanted AND what Insight found.
      const forgeInput =
        `ZADANIE UŻYTKOWNIKA (dokładne wymagania — format, długość, styl, liczba slajdów itd. — ` +
        `zastosuj się do nich dosłownie):\n${job.brief}\n\n` +
        `ZEBRANY RESEARCH (I.N.S.I.G.H.T.):\n${insightResult.output}`;

      let { forgeResult, attachment, digest } = await buildForgeAndEnrich(forgeInput);
      if (forgeResult.status !== "done" || !attachment) {
        await failJob(
          supabase,
          userId,
          job.id,
          job.title,
          `budowa pliku nie powiodła się po ${AGENT_RETRY_ATTEMPTS} próbach: ${forgeResult.error ?? "brak pliku"}`,
        );
        return { ok: false, reason: "forge_failed" };
      }

      // QA gate. Only meaningful when there's a digest to judge and a key to
      // judge it with — otherwise the file still ships (fail open), just
      // without this extra check.
      if (apiKey && digest) {
        let verdict = await judgeDocument(apiKey, job.brief, digest);
        if (!verdict.ok) {
          await logServerWarn(
            supabase,
            userId,
            "document_jobs",
            `QA rejected first draft: ${verdict.reason}`,
            { job_id: job.id } as Json,
          );
          // One corrective retry: hand Forge back its own research plus the
          // concrete QA complaint, so the second attempt targets the actual
          // gap instead of repeating the same thin draft.
          const retryInput =
            `${forgeInput}\n\n` +
            `UWAGA — poprzednia wersja tego dokumentu NIE spełniła wymagań (ocena QA: "${verdict.reason}"). ` +
            `Zbuduj dokument ponownie, wyraźnie adresując ten problem — więcej konkretów, głębsza treść, ` +
            `nie skracaj sekcji.`;
          const retryBuild = await buildForgeAndEnrich(retryInput);
          if (retryBuild.forgeResult.status === "done" && retryBuild.attachment) {
            forgeResult = retryBuild.forgeResult;
            attachment = retryBuild.attachment;
            digest = retryBuild.digest;
            verdict = digest ? await judgeDocument(apiKey, job.brief, digest) : verdict;
          }
          if (!verdict.ok) {
            warnings.push(`może nie w pełni spełniać wymagania: ${verdict.reason}`);
          }
        }
      }

      // Belt-and-suspenders: the QA retry branch reassigns `attachment` from
      // a second build attempt, so re-confirm it's still there right before
      // use rather than trusting control-flow narrowing across that block.
      if (!attachment) {
        await failJob(supabase, userId, job.id, job.title, "brak pliku po korekcie QA");
        return { ok: false, reason: "forge_failed_after_qa_retry" };
      }

      await supabase
        .from("document_jobs")
        .update({
          status: "done",
          result: {
            filename: attachment.filename,
            download_url: attachment.url,
            warnings,
          } as Json,
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      const hasWarnings = warnings.length > 0;
      await notifyOwner(supabase, userId, {
        kind: hasWarnings ? "document_ready_with_warnings" : "document_ready",
        title: hasWarnings ? `Gotowe (ze zastrzeżeniami): ${job.title}` : job.title,
        body: hasWarnings
          ? `${attachment.filename} jest gotowy, ale: ${warnings.join("; ")}`
          : `${attachment.filename} jest gotowy do pobrania.`,
        payload: {
          job_id: job.id,
          filename: attachment.filename,
          download_url: attachment.url,
          warnings,
        } as Json,
        url: "/documents",
      });

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logServerError(supabase, userId, "document_jobs", err, { job_id: job.id } as Json);
      await failJob(supabase, userId, job.id, job.title, msg);
      return { ok: false, reason: msg };
    }
  }
}

/**
 * Podnosi zadania porzucone przy zamknięciu aplikacji.
 *
 * Wołane przy wejściu na pulpit. Najczęstszy scenariusz to „wróciłem i
 * zastanawiam się, gdzie moja prezentacja" — wznowienie ma wtedy nastąpić od
 * razu, a nie przy najbliższym przebiegu harmonogramu. Zwraca podsumowanie,
 * nie rzuca: to pass w tle, a nie coś, co ma prawo zepsuć wejście na stronę.
 */
export const rescueDocumentJobsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { rescueDocumentJobs } = await import("./documentJobs.rescue");
    return rescueDocumentJobs(context.supabase, context.userId);
  });

export const runDocumentJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunInput.parse(input))
  .handler(
    async ({ data, context }): Promise<RunDocumentJobResult> =>
      runDocumentJobCore(context.supabase, context.userId, data.jobId),
  );
