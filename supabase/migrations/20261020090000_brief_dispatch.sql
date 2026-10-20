-- =========================================================================
-- PORANNY BRIEFING O CZASIE — baza uruchamia job, zamiast czekać na crona.
--
-- PROBLEM. Morning Brief ma w GitHub Actions crona „co godzinę”, ale GitHub
-- realizuje zaplanowane przebiegi z dużym opóźnieniem i część gubi: w
-- praktyce job ruszał co 3–6 godzin (np. 19.10: 02:14, 06:52, 12:54, 19:34
-- czasu PL), więc briefing „na 7:00” przychodził koło południa.
--
-- ROZWIĄZANIE. Ręcznie wywołany workflow (workflow_dispatch) startuje w
-- ciągu minuty. pg_cron co 5 minut sprawdza, czy u właściciela wybiła
-- godzina briefingu (czas warszawski) i czy dzisiejszej rubryki jeszcze nie
-- ma — wtedy pg_net prosi GitHuba o uruchomienie joba. Token: ten sam
-- github_token z Ustawień → Klucze (potrzebuje uprawnienia Actions: write
-- do tego repozytorium). Bez tokenu nic się nie dzieje i działa stary cron.
--
-- Bezpieczniki: najwyżej 4 próby dziennie, co najmniej 20 minut odstępu
-- (job sam też sprawdza, czy rubryka już jest — dwa przebiegi nie dadzą
-- dwóch powiadomień). Cron GitHuba zostaje jako zapas.
--
-- Przy okazji: push_tests — przycisk „Wyślij testowe powiadomienie” w
-- Ustawieniach. Test idzie DOKŁADNIE tą drogą co briefing (baza → job
-- GitHub → web-push → telefon), więc sprawdza całą ścieżkę naraz.
-- =========================================================================

-- ---------- 1. dziennik wywołań ----------

CREATE TABLE IF NOT EXISTS public.job_dispatches (
  id          BIGSERIAL PRIMARY KEY,
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow    TEXT NOT NULL,
  -- 'brief_hour' (godzina briefingu) albo 'push_test' (przycisk testu)
  reason      TEXT NOT NULL,
  -- id żądania pg_net — odpowiedź GitHuba czyta job_dispatch_status()
  request_id  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_dispatches_owner
  ON public.job_dispatches (owner_id, created_at DESC);

GRANT SELECT ON public.job_dispatches TO authenticated;
GRANT ALL ON public.job_dispatches TO service_role;
ALTER TABLE public.job_dispatches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Job dispatches: owner reads" ON public.job_dispatches;
CREATE POLICY "Job dispatches: owner reads" ON public.job_dispatches
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);

-- ---------- 2. testy powiadomień ----------

CREATE TABLE IF NOT EXISTS public.push_tests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- wypełnia job (scripts/morning-brief.ts): ile urządzeń dostało, ile nie
  done_at      TIMESTAMPTZ,
  sent         INT,
  failed       INT,
  pruned       INT,
  skipped      TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_tests_pending
  ON public.push_tests (owner_id, requested_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.push_tests TO authenticated;
GRANT ALL ON public.push_tests TO service_role;
ALTER TABLE public.push_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Push tests: owner manages" ON public.push_tests;
CREATE POLICY "Push tests: owner manages" ON public.push_tests
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ---------- 3. wywołanie workflow w GitHubie ----------

-- Repozytorium aplikacji. Stała, nie ustawienie: to repo, w którym żyją
-- joby tej instalacji J.A.R.V.I.S.
CREATE OR REPLACE FUNCTION public.dispatch_github_workflow(
  p_owner UUID,
  p_workflow TEXT,
  p_reason TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token TEXT;
  v_request BIGINT;
BEGIN
  SELECT NULLIF(trim(github_token), '') INTO v_token
  FROM public.user_secrets WHERE owner_id = p_owner;
  IF v_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://api.github.com/repos/pol197kuba-collab/J.A.R.V.I.S./actions/workflows/'
           || p_workflow || '/dispatches',
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'jarvis-dispatch',
      'Content-Type', 'application/json'
    )
  ) INTO v_request;

  INSERT INTO public.job_dispatches (owner_id, workflow, reason, request_id)
  VALUES (p_owner, p_workflow, p_reason, v_request);
  RETURN v_request;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_github_workflow(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_github_workflow(UUID, TEXT, TEXT) FROM authenticated;

-- ---------- 4. czy już pora na briefing (pg_cron co 5 min) ----------

CREATE OR REPLACE FUNCTION public.dispatch_due_briefs() RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now_pl TIMESTAMP := now() AT TIME ZONE 'Europe/Warsaw';
  v_today DATE := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_count INT := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT s.owner_id, COALESCE(us.brief_hour, 7) AS brief_hour
    FROM public.user_secrets s
    LEFT JOIN public.user_settings us ON us.owner_id = s.owner_id
    WHERE NULLIF(trim(s.github_token), '') IS NOT NULL
  LOOP
    CONTINUE WHEN EXTRACT(HOUR FROM v_now_pl) < r.brief_hour;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.daily_briefs b
      WHERE b.owner_id = r.owner_id AND b.brief_date = v_today
    );
    -- najwyżej 4 próby dziennie, co 20 minut
    CONTINUE WHEN (
      SELECT count(*) FROM public.job_dispatches d
      WHERE d.owner_id = r.owner_id AND d.reason = 'brief_hour'
        AND (d.created_at AT TIME ZONE 'Europe/Warsaw')::date = v_today
    ) >= 4;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.job_dispatches d
      WHERE d.owner_id = r.owner_id AND d.reason = 'brief_hour'
        AND d.created_at > now() - interval '20 minutes'
    );
    IF public.dispatch_github_workflow(r.owner_id, 'morning-brief.yml', 'brief_hour') IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_due_briefs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_due_briefs() FROM authenticated;

-- ---------- 5. test powiadomienia: wiersz → od razu job ----------

CREATE OR REPLACE FUNCTION public.push_test_dispatch() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Bez tokenu test i tak się wykona przy najbliższym przebiegu z crona.
  PERFORM public.dispatch_github_workflow(NEW.owner_id, 'morning-brief.yml', 'push_test');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_push_test_dispatch ON public.push_tests;
CREATE TRIGGER trg_push_test_dispatch
  AFTER INSERT ON public.push_tests
  FOR EACH ROW EXECUTE FUNCTION public.push_test_dispatch();

-- ---------- 6. odpowiedź GitHuba na ostatnie wywołania (dla Ustawień) ----------

CREATE OR REPLACE FUNCTION public.job_dispatch_status()
RETURNS TABLE (created_at TIMESTAMPTZ, reason TEXT, status_code INT, error TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT d.created_at, d.reason, r.status_code, COALESCE(r.error_msg, left(r.content, 200))
  FROM public.job_dispatches d
  LEFT JOIN net._http_response r ON r.id = d.request_id
  WHERE d.owner_id = auth.uid()
  ORDER BY d.created_at DESC
  LIMIT 5
$$;
REVOKE ALL ON FUNCTION public.job_dispatch_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.job_dispatch_status() TO authenticated;

-- ---------- 7. harmonogram ----------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-brief-dispatch') THEN
    PERFORM cron.unschedule('morning-brief-dispatch');
  END IF;
END $$;
SELECT cron.schedule(
  'morning-brief-dispatch',
  '*/5 * * * *',
  $cron$SELECT public.dispatch_due_briefs()$cron$
);
