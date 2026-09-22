-- =========================================================================
-- Narzędzie porannego briefingu w rejestrze.
--
-- Implementacja w src/lib/agents/tools.server.ts nie wystarcza: runtime pyta
-- bazę, które narzędzia agent ma włączone, więc narzędzie nieobecne TUTAJ po
-- prostu nie istnieje dla modelu. Ta sama pułapka co przy market_outlook i
-- przy stałych rozkazach.
-- =========================================================================

INSERT INTO public.tools (slug, name, description, input_schema, handler_kind, is_enabled)
VALUES
  (
    'read_daily_brief',
    'Briefing: Przeczytaj',
    'Odczytuje poranną rubrykę użytkownika: ruchy na watchliście, stan typera, ceny paliw, wyzwolone rozkazy, zadania po terminie i awarie z ostatniej doby.',
    '{"type":"object","properties":{}}'::jsonb,
    'internal',
    true
  )
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      input_schema = EXCLUDED.input_schema,
      is_enabled = true;

-- Tylko 'jarvis' — briefing jest rozmową z właścicielem, nie materiałem
-- roboczym dla agenta pomocniczego w trakcie delegacji.
INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
SELECT a.id, t.id, true
FROM public.agents a
CROSS JOIN public.tools t
WHERE a.slug = 'jarvis'
  AND t.slug = 'read_daily_brief'
ON CONFLICT (agent_id, tool_id) DO NOTHING;

-- Nowe konta dostają to samo. Dopisujemy się do KAŻDEJ listy slugów w treści
-- funkcji, nie przepisując jej całej — była zmieniana kilkoma migracjami.
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
  ELSIF v_src LIKE '%read_daily_brief%' THEN
    RAISE NOTICE 'handle_new_user() już zna briefing — pomijam.';
  ELSE
    v_src := replace(
      v_src,
      '''market_outlook'', ''fuel_outlook''',
      '''market_outlook'', ''fuel_outlook'', ''read_daily_brief'''
    );
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$%s$fn$',
      v_src
    );
    RAISE NOTICE 'handle_new_user() rozszerzona o read_daily_brief.';
  END IF;
END $$;

-- Sprawdzenie: powinien wrócić 1 wiersz (jarvis × read_daily_brief).
-- SELECT a.slug AS agent, t.slug AS tool
-- FROM public.agent_tools at
-- JOIN public.agents a ON a.id = at.agent_id
-- JOIN public.tools t ON t.id = at.tool_id
-- WHERE t.slug = 'read_daily_brief';
