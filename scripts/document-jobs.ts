/**
 * Kolejka zadań w tle — uruchamiana przez .github/workflows/document-jobs.yml
 * (pg_cron → workflow_dispatch, patrz migracja
 * supabase/migrations/20261112170000_document_jobs_dispatch.sql).
 *
 * Plan naprawczy, etap 6 (A16): potok dokumentów (Insight → Forge) i
 * dogrywanie grafik startuje przeglądarka zaraz po turze czatu. Gdy telefon
 * uśnie, zadanie stało — teraz dokańcza je ten job, bez przeglądarki.
 * Przeglądarka dalej startuje od razu; kolejka to gwarancja, nie zamiennik.
 * Przejęcie zadania i pliku jest warunkowe, więc oba przebiegi naraz nie
 * zrobią tej samej pracy dwa razy.
 *
 * Skrypt jest CIENKI: decyzje w documentJobs.recovery.ts i
 * documents/enrichQueue.ts (czyste, z testami), wykonanie w
 * documentJobs.rescue.ts. Uwierzytelnienie i log: src/lib/jobs/jobRun.ts.
 * Błąd przy dokończeniu zadania albo grafik (także nieudany odczyt kluczy)
 * to awaria — czerwony przebieg (etap 6b).
 */
import { rescueDocumentJobs, sweepPendingImages } from "../src/lib/agents/documentJobs.rescue";
import { startJob } from "../src/lib/jobs/jobRun";

async function main(): Promise<number> {
  const job = startJob("document-jobs");
  const { db, ownerId } = job;

  const jobs = await rescueDocumentJobs(db, ownerId);
  for (const e of jobs.errors) await job.fail("dokumenty", e);

  const images = await sweepPendingImages(db, ownerId);
  for (const e of images.errors) await job.fail("grafiki", e);

  return job.finish(
    `Dokumenty: dokończone ${jobs.resumed}, zamknięte jako nieudane ${jobs.failed}, ` +
      `czekające dalej ${jobs.skipped}; grafiki: dograne ${images.enriched}, ` +
      `pominięte ${images.skipped}.`,
  );
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.log(`::error::${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  });
