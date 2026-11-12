// Ratownik zadań dokumentowych — warstwa z bazą.
//
// Decyzja („czy to zadanie jest porzucone") siedzi w documentJobs.recovery.ts
// i jest pokryta testami bez bazy. Tutaj jest wyłącznie odczyt, wznowienie i
// zamknięcie tego, czego już nie da się uratować.
//
// KIEDY TO BIEGNIE. W dwóch momentach, celowo różnych:
//   1. Przy wejściu do aplikacji — bo najczęstszy scenariusz to „wróciłem i
//      zastanawiam się, gdzie moja prezentacja". Wznowienie następuje wtedy
//      od razu, bez czekania na harmonogram.
//   2. W kolejce w tle (scripts/document-jobs.ts, uruchamiany przez pg_cron,
//      plan naprawczy etap 6) — kilka minut po tym, jak przeglądarka nie
//      dokończyła zadania, bez czekania na powrót użytkownika.
//   3. W godzinnym przebiegu briefingu — zapas, do usunięcia, gdy kolejka
//      przepracuje tydzień bez usterek.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { notifyOwner } from "@/lib/notifications/notify.server";
import { classifyJob, exhaustedReason } from "./documentJobs.recovery";

type Db = SupabaseClient<Database>;

export type RescueSummary = {
  /** Zadania wznowione i dokończone w tym przebiegu. */
  resumed: number;
  /** Zadania zamknięte jako nieudane, bo skończyły się podejścia. */
  failed: number;
  /** Zadania niedokończone, ale jeszcze nie porzucone — zostawione w spokoju. */
  skipped: number;
  errors: string[];
};

/** Ile zadań ratujemy w jednym przebiegu. Każde kosztuje pełny potok. */
const MAX_PER_SWEEP = 2;

/**
 * Podnosi porzucone zadania dokumentowe właściciela.
 *
 * Zadania wykonujemy PO KOLEI, nie równolegle: każde to pełny potok Insight →
 * Forge z wywołaniami modelu, a dwa naraz konkurowałyby o ten sam limit
 * dostawcy i potrafiłyby wywrócić się nawzajem.
 */
export async function rescueDocumentJobs(
  db: Db,
  ownerId: string,
  now: Date = new Date(),
): Promise<RescueSummary> {
  const summary: RescueSummary = { resumed: 0, failed: 0, skipped: 0, errors: [] };

  const { data: rows, error } = await db
    .from("document_jobs")
    .select("id, title, status, attempts, updated_at")
    .eq("owner_id", ownerId)
    .in("status", ["queued", "running"])
    .order("updated_at", { ascending: true })
    .limit(20);

  if (error) {
    summary.errors.push(`odczyt zadań: ${error.message}`);
    return summary;
  }
  if (!rows || rows.length === 0) return summary;

  for (const row of rows) {
    const verdict = classifyJob(
      { status: row.status, updatedAt: row.updated_at, attempts: row.attempts ?? 0 },
      now,
    );

    if (verdict === "healthy") {
      summary.skipped += 1;
      continue;
    }

    if (verdict === "exhausted") {
      const reason = exhaustedReason(row.attempts ?? 0);
      const { error: closeErr } = await db
        .from("document_jobs")
        .update({ status: "error", error: reason, finished_at: now.toISOString() })
        .eq("id", row.id);
      if (closeErr) {
        summary.errors.push(`zamknięcie ${row.id}: ${closeErr.message}`);
        continue;
      }
      // Cisza byłaby tu najgorszą odpowiedzią: użytkownik poprosił o plik i
      // ma prawo wiedzieć, że nie powstanie — razem z powodem.
      await notifyOwner(db, ownerId, {
        kind: "document_failed",
        title: `Nie udało się: ${row.title}`,
        body: reason,
        payload: { job_id: row.id, attempts: row.attempts } as unknown as Json,
        url: "/documents",
      });
      summary.failed += 1;
      continue;
    }

    if (summary.resumed >= MAX_PER_SWEEP) {
      summary.skipped += 1;
      continue;
    }

    const { runDocumentJobCore } = await import("./documentJobs.functions");
    const result = await runDocumentJobCore(db, ownerId, row.id, { allowResume: true });
    if (result.ok) summary.resumed += 1;
    else summary.errors.push(`wznowienie ${row.id}: ${result.reason}`);
  }

  return summary;
}

export type ImageSweepSummary = { enriched: number; skipped: number; errors: string[] };

/** Ile plików dogrywamy w jednym przebiegu — każdy to kilka wywołań modelu obrazów. */
const MAX_IMAGES_PER_SWEEP = 3;

/**
 * Dogrywa grafiki plików, których przeglądarka nie dokończyła (plan
 * naprawczy, etap 6). Decyzja w enrichQueue.ts (czysta, z testami); przejęcie
 * pliku jest warunkowe w enrichGeneratedFileImages, więc równoległa
 * przeglądarka nie zrobi tego samego drugi raz.
 */
export async function sweepPendingImages(
  db: Db,
  ownerId: string,
  now: Date = new Date(),
): Promise<ImageSweepSummary> {
  const summary: ImageSweepSummary = { enriched: 0, skipped: 0, errors: [] };
  const { data: rows, error } = await db
    .from("generated_files")
    .select("id, image_status, created_at, image_claimed_at")
    .eq("user_id", ownerId)
    .eq("image_status", "pending")
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    summary.errors.push(`odczyt plików: ${error.message}`);
    return summary;
  }

  const { imageNeedsEnrich } = await import("@/lib/documents/enrichQueue");
  for (const row of rows ?? []) {
    const due = imageNeedsEnrich(
      { imageStatus: row.image_status, createdAt: row.created_at, claimedAt: row.image_claimed_at },
      now,
    );
    if (!due || summary.enriched >= MAX_IMAGES_PER_SWEEP) {
      summary.skipped += 1;
      continue;
    }
    const { enrichGeneratedFileImages } = await import("@/lib/documents/generated.functions");
    const result = await enrichGeneratedFileImages(db, ownerId, row.id);
    if (result.ok) summary.enriched += 1;
    else if (result.reason !== "not_pending")
      summary.errors.push(`grafiki ${row.id}: ${result.reason}`);
  }
  return summary;
}
