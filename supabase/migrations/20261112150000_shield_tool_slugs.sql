-- =========================================================================
-- Narzędzia S.H.I.E.L.D. pod nową nazwą: guardian_* → shield_*.
--
-- Agent „guardian” to od migracji 20260811120000 S.H.I.E.L.D., ale jego trzy
-- narzędzia zostały pod starą nazwą. Właściciel zdecydował (2026-11-12):
-- zmiana w jednym kroku. Między wejściem tej migracji a publikacją nowego
-- kodu w Lovable S.H.I.E.L.D. przez kilka minut nie widzi swoich narzędzi
-- (stary kod zna tylko guardian_*); reszta aplikacji działa normalnie.
--
-- Zmieniamy wyłącznie NAZWY (tekst), nic nie kasujemy:
--   1. public.tools.slug             — identyfikator narzędzia,
--   2. public.agents.config          — prompty, które wymieniają narzędzia,
--   3. public.handle_new_user()      — nowe konta dostają nowe nazwy.
-- Historia (agent_runs.tool_calls, event_log, system_events) zostaje ze
-- starymi nazwami — to zapis tego, co się wtedy wydarzyło.
-- Powtórne uruchomienie niczego nie zmienia (wszystko po LIKE 'guardian_%').
-- =========================================================================

UPDATE public.tools
   SET slug = replace(slug, 'guardian_', 'shield_'),
       updated_at = now()
 WHERE slug IN ('guardian_scan_errors', 'guardian_run_stats', 'guardian_check_delegation');

UPDATE public.agents
   SET config = replace(config::text, 'guardian_', 'shield_')::jsonb
 WHERE config::text LIKE '%guardian\_%';

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE proname = 'handle_new_user'
    AND pronamespace = 'public'::regnamespace
  LIMIT 1;

  IF v_src IS NULL THEN
    RAISE NOTICE 'handle_new_user() nie istnieje — pomijam.';
  ELSIF v_src NOT LIKE '%guardian\_%' THEN
    RAISE NOTICE 'handle_new_user() nie zna już guardian_* — pomijam.';
  ELSE
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$%s$fn$',
      replace(v_src, 'guardian_', 'shield_')
    );
    RAISE NOTICE 'handle_new_user(): guardian_* → shield_*.';
  END IF;
END $$;

-- Sprawdzenie: 3 wiersze shield_*, 0 wierszy guardian_*.
-- SELECT slug FROM public.tools WHERE slug LIKE 'shield\_%' OR slug LIKE 'guardian\_%';
