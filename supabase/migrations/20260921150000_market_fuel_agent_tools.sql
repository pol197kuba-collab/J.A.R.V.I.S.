-- =========================================================================
-- J.A.R.V.I.S. dostaje dostęp do własnych modułów rynkowego i paliwowego.
--
-- POWÓD: agent nie miał ŻADNEGO narzędzia sięgającego do /rynki ani /paliwa.
-- Na pytanie „czy przewidujesz wzrost Bitcoina" odpowiadał z ogólnej wiedzy
-- albo szukał w sieci, mając obok gotowy typer policzony na notowaniach tego
-- użytkownika. To nie było ograniczenie rozpoznawania mowy — to był brak
-- narzędzia, a narzędzie musi istnieć i tutaj, nie tylko w kodzie.
--
-- Ta migracja:
--   1. Rejestruje 2 nowe narzędzia (implementacje w
--      src/lib/agents/tools.server.ts — slugi MUSZĄ się zgadzać).
--   2. Podpina je do istniejących agentów 'orchestrator' i 'jarvis'.
--   3. Rozszerza handle_new_user(), żeby nowe konta dostawały je od razu.
-- =========================================================================

-- ---------- 1. Rejestr narzędzi ----------
INSERT INTO public.tools (slug, name, description, input_schema, handler_kind, is_enabled)
VALUES
  (
    'market_outlook',
    'Rynki: Prognoza',
    'Odczytuje własną prognozę użytkownika z modułu /rynki: kierunek, siłę przekonania i przesłanki dla instrumentów z jego watchlisty.',
    '{"type":"object","properties":{"symbol":{"type":"string"}}}'::jsonb,
    'internal',
    true
  ),
  (
    'fuel_outlook',
    'Paliwa: Prognoza',
    'Odczytuje hurtowe ceny paliw Orlenu i krótkoterminową projekcję z modułu /paliwa.',
    '{"type":"object","properties":{"product":{"type":"string"}}}'::jsonb,
    'internal',
    true
  )
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      input_schema = EXCLUDED.input_schema,
      is_enabled = true;

-- ---------- 2. Podpięcie do istniejących agentów ----------
-- Oba agenty, bo oba rozmawiają z użytkownikiem wprost: 'jarvis' w konsoli
-- czatu i w komendzie głosowej, 'orchestrator' przy delegowaniu.
INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
SELECT a.id, t.id, true
FROM public.agents a
CROSS JOIN public.tools t
WHERE a.slug IN ('orchestrator', 'jarvis')
  AND t.slug IN ('market_outlook', 'fuel_outlook')
ON CONFLICT (agent_id, tool_id) DO NOTHING;

-- ---------- 3. Nowe konta dostają to samo ----------
-- handle_new_user() wylicza listę slugów wprost, więc dopisanie narzędzia
-- wymaga dopisania go TUTAJ — inaczej nowe konto miałoby moduły, ale agenta,
-- który o nich nie wie.
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
    RAISE NOTICE 'handle_new_user() nie istnieje — pomijam krok 3.';
  ELSIF v_src LIKE '%market_outlook%' THEN
    RAISE NOTICE 'handle_new_user() już zna nowe narzędzia — pomijam krok 3.';
  ELSE
    -- Dopisujemy slugi do KAŻDEJ listy narzędzi w treści funkcji, nie
    -- przepisując jej całej: funkcja bywała zmieniana kilkoma migracjami i
    -- nadpisanie jej stałą treścią cofnęłoby tamte zmiany.
    v_src := replace(
      v_src,
      '''web_search'', ''fetch_url'', ''save_note''',
      '''web_search'', ''fetch_url'', ''save_note'', ''market_outlook'', ''fuel_outlook'''
    );
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$%s$fn$',
      v_src
    );
    RAISE NOTICE 'handle_new_user() rozszerzona o market_outlook i fuel_outlook.';
  END IF;
END $$;

-- Sprawdzenie: powinno zwrócić po jednym wierszu na agenta i narzędzie.
-- SELECT a.slug AS agent, t.slug AS tool
-- FROM public.agent_tools at
-- JOIN public.agents a ON a.id = at.agent_id
-- JOIN public.tools t ON t.id = at.tool_id
-- WHERE t.slug IN ('market_outlook', 'fuel_outlook')
-- ORDER BY a.slug, t.slug;
