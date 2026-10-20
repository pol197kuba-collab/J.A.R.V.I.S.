-- =========================================================================
-- MARKET GRID O CZASIE — ten sam mechanizm co poranny briefing
-- (20261020090000_brief_dispatch.sql).
--
-- PROBLEM. Cron GitHuba „0 18 * * *” (20:00 latem, 19:00 zimą) w praktyce
-- ruszał koło 22:00–00:30 czasu PL. pg_cron co 5 minut sprawdza, czy w
-- Warszawie wybiła 20:00 i czy w ciągu ostatnich 12 godzin nie było
-- przebiegu — wtedy prosi GitHuba o uruchomienie market-grid.yml.
--
-- Skąd baza wie, że przebieg był: job_runs. Wpisuje go skrypt
-- (scripts/markets-daily.ts) po dojściu do końca, także gdy pojedyncze kroki
-- się nie udały — powtórka z tego powodu to tylko drugie wywołanie modelu
-- z tym samym wynikiem. Brak wpisu = job padł w całości i warto ponowić.
--
-- Cron GitHuba zostaje jako zapas: spóźniony przebieg z crona widzi wpis
-- z ostatnich 12 godzin i kończy się bez pracy (src/lib/markets/schedule.ts).
-- Bezpieczniki jak przy briefingu: najwyżej 4 próby dziennie, co 20 minut.
-- =========================================================================

-- ---------- 1. ślad przebiegów jobów ----------

CREATE TABLE IF NOT EXISTS public.job_runs (
  id           BIGSERIAL PRIMARY KEY,
  owner_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- nazwa pliku workflow, np. 'market-grid.yml'
  workflow     TEXT NOT NULL,
  -- github.event_name: 'schedule' (cron GitHuba) albo 'workflow_dispatch'
  -- (baza lub ręcznie)
  trigger      TEXT,
  started_at   TIMESTAMPTZ NOT NULL,
  finished_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  failures     INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_job_runs_owner
  ON public.job_runs (owner_id, workflow, finished_at DESC);

-- Skrypt może działać z kontem użytkownika (bez service_role), stąd INSERT.
GRANT SELECT, INSERT ON public.job_runs TO authenticated;
GRANT USAGE ON SEQUENCE public.job_runs_id_seq TO authenticated;
GRANT ALL ON public.job_runs TO service_role;
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Job runs: owner reads" ON public.job_runs;
CREATE POLICY "Job runs: owner reads" ON public.job_runs
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "Job runs: owner writes" ON public.job_runs;
CREATE POLICY "Job runs: owner writes" ON public.job_runs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

-- ---------- 2. czy już pora na Market Grid (pg_cron co 5 min) ----------

CREATE OR REPLACE FUNCTION public.dispatch_due_market_grid() RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  -- ta sama godzina co MARKET_HOUR w src/lib/markets/schedule.ts
  c_hour CONSTANT INT := 20;
  v_now_pl TIMESTAMP := now() AT TIME ZONE 'Europe/Warsaw';
  v_today DATE := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_count INT := 0;
  r RECORD;
BEGIN
  -- od 20:00 do północy; po północy czeka na następny wieczór
  IF EXTRACT(HOUR FROM v_now_pl) < c_hour THEN
    RETURN 0;
  END IF;
  FOR r IN
    SELECT s.owner_id FROM public.user_secrets s
    WHERE NULLIF(trim(s.github_token), '') IS NOT NULL
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.job_runs j
      WHERE j.owner_id = r.owner_id AND j.workflow = 'market-grid.yml'
        AND j.finished_at > now() - interval '12 hours'
    );
    CONTINUE WHEN (
      SELECT count(*) FROM public.job_dispatches d
      WHERE d.owner_id = r.owner_id AND d.reason = 'market_hour'
        AND (d.created_at AT TIME ZONE 'Europe/Warsaw')::date = v_today
    ) >= 4;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.job_dispatches d
      WHERE d.owner_id = r.owner_id AND d.reason = 'market_hour'
        AND d.created_at > now() - interval '20 minutes'
    );
    IF public.dispatch_github_workflow(r.owner_id, 'market-grid.yml', 'market_hour') IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_due_market_grid() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_due_market_grid() FROM authenticated;

-- ---------- 3. harmonogram ----------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'market-grid-dispatch') THEN
    PERFORM cron.unschedule('market-grid-dispatch');
  END IF;
END $$;
SELECT cron.schedule(
  'market-grid-dispatch',
  '*/5 * * * *',
  $cron$SELECT public.dispatch_due_market_grid()$cron$
);
