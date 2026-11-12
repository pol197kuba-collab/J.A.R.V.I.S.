-- =========================================================================
-- ZADANIA W TLE BEZ PRZEGLĄDARKI (plan naprawczy, etap 6, A16).
--
-- Potok dokumentów (Insight → Forge) i dogrywanie grafik startuje
-- przeglądarka zaraz po turze czatu. Gdy telefon uśnie albo karta zniknie,
-- zadanie stało do godzinnego przebiegu briefingu. Teraz baza co minutę
-- sprawdza, czy coś czeka, i wtedy prosi GitHuba o workflow
-- document-jobs.yml — tym samym wzorcem co briefing
-- (20261020090000_brief_dispatch.sql, dispatch_github_workflow).
--
-- Co znaczy „czeka” — te same progi co w kodzie (zmieniać razem):
--   document_jobs  'queued'  bez ruchu > 90 s   (QUEUED_GRACE_MS)
--                  'running' bez ruchu > 15 min (STALE_AFTER_MS)
--   generated_files 'pending' starszy niż 90 s (ENRICH_GRACE_MS), bez
--                  żywego przejęcia: image_claimed_at pusty lub > 10 min
--                  (ENRICH_CLAIM_TTL_MS)
--
-- Bezpieczniki: najwyżej jedno wywołanie na 5 minut i 40 na dobę na
-- właściciela (gdyby job padał przed podjęciem pracy, nie spali minut
-- Actions w nieskończoność). Podwójnego wykonania pilnuje kod: przejęcie
-- zadania i pliku to jeden warunkowy UPDATE.
--
-- Zgodne ze starym kodem: nowa kolumna jest opcjonalna, stary kod jej nie
-- zna i działa jak dotąd.
-- =========================================================================

-- ---------- 1. znacznik przejęcia dogrywania grafik ----------

ALTER TABLE public.generated_files
  ADD COLUMN IF NOT EXISTS image_claimed_at TIMESTAMPTZ;

-- ---------- 2. czy coś czeka (pg_cron co minutę) ----------

CREATE OR REPLACE FUNCTION public.dispatch_document_jobs() RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count INT := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT s.owner_id
    FROM public.user_secrets s
    WHERE NULLIF(trim(s.github_token), '') IS NOT NULL
  LOOP
    CONTINUE WHEN NOT (
      EXISTS (
        SELECT 1 FROM public.document_jobs j
        WHERE j.owner_id = r.owner_id
          AND (
            (j.status = 'queued' AND j.updated_at < now() - interval '90 seconds')
            OR (j.status = 'running' AND j.updated_at < now() - interval '15 minutes')
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.generated_files f
        WHERE f.user_id = r.owner_id
          AND f.image_status = 'pending'
          AND f.created_at < now() - interval '90 seconds'
          AND (f.image_claimed_at IS NULL OR f.image_claimed_at < now() - interval '10 minutes')
      )
    );
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.job_dispatches d
      WHERE d.owner_id = r.owner_id AND d.reason = 'document_jobs'
        AND d.created_at > now() - interval '5 minutes'
    );
    CONTINUE WHEN (
      SELECT count(*) FROM public.job_dispatches d
      WHERE d.owner_id = r.owner_id AND d.reason = 'document_jobs'
        AND d.created_at > now() - interval '1 day'
    ) >= 40;
    IF public.dispatch_github_workflow(r.owner_id, 'document-jobs.yml', 'document_jobs') IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_document_jobs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_document_jobs() FROM authenticated;

-- ---------- 3. harmonogram ----------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'document-jobs-dispatch') THEN
    PERFORM cron.unschedule('document-jobs-dispatch');
  END IF;
END $$;
SELECT cron.schedule(
  'document-jobs-dispatch',
  '* * * * *',
  $cron$SELECT public.dispatch_document_jobs()$cron$
);

-- Sprawdzenie (ręcznie): SELECT public.dispatch_document_jobs();
-- → liczba właścicieli, dla których poprosiliśmy o workflow (zwykle 0).
