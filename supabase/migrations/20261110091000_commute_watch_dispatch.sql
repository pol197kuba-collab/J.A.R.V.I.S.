-- =========================================================================
-- ALERT O OPÓŹNIENIU DOJAZDU — baza uruchamia job, gdy jest pora.
--
-- Ten sam mechanizm i ten sam powód co przy briefingu
-- (20261020090000_brief_dispatch.sql): cron GitHub Actions spóźnia się o
-- godziny, a alert „wyjdź wcześniej” po wyjeździe z domu jest bezwartościowy.
-- pg_cron co 5 minut sprawdza, czy u właściciela trwa okno przed planowanym
-- wyjazdem (od 45 min przed do 10 min po, dni robocze, czas warszawski) i
-- wtedy prosi GitHuba o uruchomienie workflow commute-watch.yml. Token to ten
-- sam github_token z Ustawień → Klucze (Actions: write).
--
-- Bezpieczniki: najwyżej jedno wywołanie na 10 minut na właściciela. Sam job
-- sprawdza, czy alert już wysłano (user_settings → commute_settings.alert_state),
-- więc dwa przebiegi nie dadzą dwóch powiadomień.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.dispatch_commute_watch() RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now_pl TIMESTAMP := now() AT TIME ZONE 'Europe/Warsaw';
  v_min INT := EXTRACT(HOUR FROM (now() AT TIME ZONE 'Europe/Warsaw'))::INT * 60
             + EXTRACT(MINUTE FROM (now() AT TIME ZONE 'Europe/Warsaw'))::INT;
  v_count INT := 0;
  r RECORD;
BEGIN
  -- 0 = niedziela, 6 = sobota: dojazd dotyczy dni roboczych.
  IF EXTRACT(DOW FROM v_now_pl) IN (0, 6) THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT c.owner_id, c.depart_to_min, c.depart_back_min
    FROM public.commute_settings c
    JOIN public.user_secrets s ON s.owner_id = c.owner_id
    WHERE c.alert_enabled
      AND c.home_lat IS NOT NULL AND c.work_lat IS NOT NULL
      AND NULLIF(trim(s.github_token), '') IS NOT NULL
      AND NULLIF(trim(s.tomtom_api_key), '') IS NOT NULL
  LOOP
    CONTINUE WHEN NOT (
      (v_min BETWEEN r.depart_to_min - 45 AND r.depart_to_min + 10)
      OR (v_min BETWEEN r.depart_back_min - 45 AND r.depart_back_min + 10)
    );
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.job_dispatches d
      WHERE d.owner_id = r.owner_id AND d.reason = 'commute_watch'
        AND d.created_at > now() - interval '10 minutes'
    );
    IF public.dispatch_github_workflow(r.owner_id, 'commute-watch.yml', 'commute_watch') IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_commute_watch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_commute_watch() FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'commute-watch-dispatch') THEN
    PERFORM cron.unschedule('commute-watch-dispatch');
  END IF;
END $$;
SELECT cron.schedule(
  'commute-watch-dispatch',
  '*/5 * * * *',
  $cron$SELECT public.dispatch_commute_watch()$cron$
);
