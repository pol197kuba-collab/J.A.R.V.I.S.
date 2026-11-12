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
 * documentJobs.rescue.ts. Tutaj tylko uwierzytelnienie i log.
 *
 * Wymaga klucza service role: od etapu 5 (5b) klucze modeli w user_secrets
 * czyta wyłącznie serwer tym kluczem.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";
import { rescueDocumentJobs, sweepPendingImages } from "../src/lib/agents/documentJobs.rescue";

const notice = (m: string) => console.log(`::notice::${m}`);
const warn = (m: string) => console.log(`::warning::${m}`);
const fail = (m: string) => console.log(`::error::${m}`);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`Brak wymaganego sekretu ${name}. Ustaw go w Settings → Secrets → Actions.`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const db = createClient<Database>(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const ownerId = requireEnv("JARVIS_OWNER_ID");

  const jobs = await rescueDocumentJobs(db, ownerId);
  notice(
    `Dokumenty: dokończone ${jobs.resumed}, zamknięte jako nieudane ${jobs.failed}, ` +
      `pominięte ${jobs.skipped}.`,
  );
  for (const e of jobs.errors) warn(`dokumenty: ${e}`);

  const images = await sweepPendingImages(db, ownerId);
  notice(`Grafiki: dograne ${images.enriched}, pominięte ${images.skipped}.`);
  for (const e of images.errors) warn(`grafiki: ${e}`);
}

main().catch((err) => {
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
