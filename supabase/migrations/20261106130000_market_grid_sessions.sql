-- Market Grid: dwie sesje decyzji + takt pilnowania z ustawień funduszu.
--
-- 1. Market Grid (market-grid.yml) biegnie dwa razy:
--    - 8:30 czasu PL w dni robocze — akcje, ETF-y, indeksy (decyzja przed
--      otwarciem sesji, z nocnymi newsami),
--    - 20:00 codziennie — krypto, surowce, waluty + domknięcie dnia notowań.
--    Każdy instrument nadal ma JEDNĄ prognozę dziennie (UNIQUE w
--    market_predictions), tylko o porze pasującej do jego rynku. Te same
--    stałe: src/lib/markets/schedule.ts (MORNING_HOUR, MORNING_MINUTE,
--    MARKET_HOUR, SESSION_SPLIT_HOUR).
--    Przebieg należy do sesji porannej, gdy skończył się między 4:00 a 14:00,
--    inaczej do wieczornej — poranny nie wstrzymuje już wieczornego (stare
--    okno „12 godzin” by to zrobiło: 8:30 → 20:00 to 11,5 h).
--
-- 2. Przebieg na żywo (market-live.yml) jest wołany zgodnie z ustawieniem
--    funduszu `liveEveryMin` (fund_settings.settings, 0 = wyłączony), a nie
--    zawsze co 15 minut — przebieg, który skrypt i tak by pominął, kosztuje
--    minuty GitHub Actions.

-- ---------- 1. Market Grid: dwie sesje ----------

CREATE OR REPLACE FUNCTION public.dispatch_due_market_grid() RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  c_morning CONSTANT TIME := TIME '08:30';
  c_split   CONSTANT INT  := 14;
  c_evening CONSTANT INT  := 20;
  v_now_pl  TIMESTAMP := now() AT TIME ZONE 'Europe/Warsaw';
  v_today   DATE := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_hour    INT := EXTRACT(HOUR FROM (now() AT TIME ZONE 'Europe/Warsaw'))::int;
  v_reason  TEXT;
  v_since   TIMESTAMPTZ;
  v_until   TIMESTAMPTZ;
  v_count   INT := 0;
  r RECORD;
BEGIN
  IF v_hour >= c_evening THEN
    v_reason := 'market_hour';
    v_since := (v_today + make_time(c_split, 0, 0)) AT TIME ZONE 'Europe/Warsaw';
    v_until := now();
  ELSIF v_now_pl::time >= c_morning AND v_hour < c_split
        AND EXTRACT(ISODOW FROM v_now_pl) <= 5 THEN
    v_reason := 'market_morning';
    v_since := (v_today + TIME '04:00') AT TIME ZONE 'Europe/Warsaw';
    v_until := (v_today + make_time(c_split, 0, 0)) AT TIME ZONE 'Europe/Warsaw';
  ELSE
    RETURN 0;
  END IF;

  FOR r IN
    SELECT s.owner_id FROM public.user_secrets s
    WHERE NULLIF(trim(s.github_token), '') IS NOT NULL
  LOOP
    -- ta sesja już dziś była
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.job_runs j
      WHERE j.owner_id = r.owner_id AND j.workflow = 'market-grid.yml'
        AND j.finished_at >= v_since AND j.finished_at < v_until
    );
    -- bezpieczniki: najwyżej 4 wywołania sesji dziennie, jedno na 20 minut
    CONTINUE WHEN (
      SELECT count(*) FROM public.job_dispatches d
      WHERE d.owner_id = r.owner_id AND d.reason = v_reason
        AND (d.created_at AT TIME ZONE 'Europe/Warsaw')::date = v_today
    ) >= 4;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.job_dispatches d
      WHERE d.owner_id = r.owner_id AND d.reason = v_reason
        AND d.created_at > now() - interval '20 minutes'
    );
    IF public.dispatch_github_workflow(r.owner_id, 'market-grid.yml', v_reason) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_due_market_grid() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_due_market_grid() FROM authenticated;

-- ---------- 2. Na żywo: takt z ustawień funduszu ----------

CREATE OR REPLACE FUNCTION public.dispatch_due_market_live() RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count INT := 0;
  v_raw   TEXT;
  v_every INT;
  r RECORD;
BEGIN
  FOR r IN
    SELECT s.owner_id FROM public.user_secrets s
    WHERE NULLIF(trim(s.github_token), '') IS NOT NULL
  LOOP
    -- takt z ustawień funduszu; brak / śmieci = 15 (jak parseFundSettings)
    SELECT f.settings->>'liveEveryMin' INTO v_raw
    FROM public.fund_settings f WHERE f.owner_id = r.owner_id;
    v_every := CASE WHEN v_raw IN ('0', '15', '30', '60') THEN v_raw::int ELSE 15 END;
    CONTINUE WHEN v_every = 0;
    -- poprzedni przebieg był niedawno (5 minut luzu na start joba)
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.job_runs j
      WHERE j.owner_id = r.owner_id AND j.workflow = 'market-live.yml'
        AND j.finished_at > now() - make_interval(mins => v_every - 5)
    );
    -- bezpiecznik: najwyżej jedno wywołanie na 12 minut
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.job_dispatches d
      WHERE d.owner_id = r.owner_id AND d.reason = 'market_live'
        AND d.created_at > now() - interval '12 minutes'
    );
    IF public.dispatch_github_workflow(r.owner_id, 'market-live.yml', 'market_live') IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_due_market_live() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_due_market_live() FROM authenticated;
