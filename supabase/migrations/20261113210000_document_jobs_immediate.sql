-- Potok dokumentów zawsze w tle (zgłoszenie właściciela 2026-11-13).
--
-- Do tej pory telefon wykonywał potok I.N.S.I.G.H.T. → F.O.R.G.E. we własnym
-- zapytaniu: zamknięcie aplikacji zabijało pracę w połowie (dane z 13.11:
-- przebieg insight 19:22 został na zawsze „running”), a kolejka w tle
-- wznawiała ją dopiero po 15 minutach. Teraz aplikacja od razu prosi o
-- workflow document-jobs.yml (request_document_jobs) i niczego sama nie
-- liczy — praca nie zależy od tego, czy telefon jest otwarty.
--
-- 1. request_document_jobs(): wołane przez zalogowanego właściciela zaraz po
--    zleceniu dokumentu. Bezpieczniki: tylko gdy ma zadanie `queued`, najwyżej
--    raz na minutę i 40 razy na dobę (wspólny licznik z pg_cron).
-- 2. dispatch_document_jobs(): `queued` czeka już tylko 30 s (zamiast 90 s) —
--    to siatka bezpieczeństwa, gdyby prośba z aplikacji nie doszła.
--
-- Zgodne ze starym kodem: stara aplikacja dalej sama startuje potok, a
-- podwójnego wykonania pilnuje warunkowe przejęcie zadania (etap 6).

CREATE OR REPLACE FUNCTION public.request_document_jobs() RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_owner UUID := auth.uid();
BEGIN
  IF v_owner IS NULL THEN
    RETURN FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.document_jobs j
    WHERE j.owner_id = v_owner AND j.status = 'queued'
  ) THEN
    RETURN FALSE;
  END IF;
  -- Już poproszone przed chwilą (drugi dokument, ponowione kliknięcie):
  -- uruchomiony job weźmie wszystkie czekające zadania.
  IF EXISTS (
    SELECT 1 FROM public.job_dispatches d
    WHERE d.owner_id = v_owner AND d.reason = 'document_jobs'
      AND d.created_at > now() - interval '1 minute'
  ) THEN
    RETURN TRUE;
  END IF;
  IF (
    SELECT count(*) FROM public.job_dispatches d
    WHERE d.owner_id = v_owner AND d.reason = 'document_jobs'
      AND d.created_at > now() - interval '1 day'
  ) >= 40 THEN
    RETURN FALSE;
  END IF;
  RETURN public.dispatch_github_workflow(v_owner, 'document-jobs.yml', 'document_jobs') IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.request_document_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_document_jobs() TO authenticated;

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
            (j.status = 'queued' AND j.updated_at < now() - interval '30 seconds')
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
