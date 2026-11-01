-- =========================================================================
-- MARKET GRID NA ŻYWO — przebieg co 15 minut (scripts/markets-live.ts).
--
-- 1. market_live_events: zdarzenia z ciągu dnia z ceną i chwilą
--    (realizacja prognozy, stop-loss, take-profit, alarm modelu). Fundusz
--    liczy historię od zera przy każdym przeliczeniu — z tymi wierszami
--    wynik jest zawsze ten sam, bez przechowywania surowych ticków.
-- 2. pg_cron co 15 minut prosi GitHuba o uruchomienie market-live.yml
--    (ten sam mechanizm co Market Grid o 20:00 i poranny briefing).
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.market_live_events (
  id          BIGSERIAL PRIMARY KEY,
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- klucz gracza funduszu (src/lib/fund/players.ts), np. 'ai', 'monkey'
  player      TEXT NOT NULL CHECK (player ~ '^[a-z][a-z0-9_]{1,40}$'),
  symbol      TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('fill', 'stop', 'take', 'alarm', 'alarm_hold')),
  -- chwila notowania, po którym zdarzenie zaszło
  at          TIMESTAMPTZ NOT NULL,
  -- cena środkowa w walucie instrumentu (spread dolicza silnik)
  price       NUMERIC(20, 8) NOT NULL CHECK (price > 0),
  side        TEXT CHECK (side IN ('long', 'short')),
  -- fill: dzień prognozy, którą realizuje
  signal_on   DATE,
  reason      TEXT,
  model       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_live_events_owner_at
  ON public.market_live_events (owner_id, at);
-- Ten sam gracz nie realizuje tej samej prognozy dwa razy (powtórzony przebieg).
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_live_events_fill
  ON public.market_live_events (owner_id, player, symbol, signal_on)
  WHERE kind = 'fill';

GRANT SELECT, INSERT, DELETE ON public.market_live_events TO authenticated;
GRANT USAGE ON SEQUENCE public.market_live_events_id_seq TO authenticated;
GRANT ALL ON public.market_live_events TO service_role;
ALTER TABLE public.market_live_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Market live events: owner manages" ON public.market_live_events;
CREATE POLICY "Market live events: owner manages" ON public.market_live_events
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- ---------- harmonogram: co 15 minut ----------

CREATE OR REPLACE FUNCTION public.dispatch_due_market_live() RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count INT := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT s.owner_id FROM public.user_secrets s
    WHERE NULLIF(trim(s.github_token), '') IS NOT NULL
  LOOP
    -- przebieg skończył się przed chwilą — nie ma po co
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.job_runs j
      WHERE j.owner_id = r.owner_id AND j.workflow = 'market-live.yml'
        AND j.finished_at > now() - interval '10 minutes'
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'market-live-dispatch') THEN
    PERFORM cron.unschedule('market-live-dispatch');
  END IF;
END $$;
SELECT cron.schedule(
  'market-live-dispatch',
  '*/15 * * * *',
  $cron$SELECT public.dispatch_due_market_live()$cron$
);
