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
//   2. W godzinnym przebiegu briefingu — bo użytkownik może nie wrócić przez
//      dobę, a zadanie ma się dokończyć samo.
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
