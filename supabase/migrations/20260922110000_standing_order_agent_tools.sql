-- =========================================================================
-- Narzędzia stałych rozkazów w rejestrze narzędzi.
--
-- Implementacja w src/lib/agents/tools.server.ts nie wystarcza: runtime pyta
-- bazę, które narzędzia agent ma włączone (getEnabledToolsForAgent), więc
-- narzędzie nieobecne TUTAJ po prostu nie istnieje dla modelu. Ta sama
-- pułapka, co przy market_outlook/fuel_outlook (migracja 20260921150000).
-- =========================================================================

-- ---------- 1. Rejestr ----------
INSERT INTO public.tools (slug, name, description, input_schema, handler_kind, is_enabled)
VALUES
  (
    'create_standing_order',
    'Rozkazy: Wydaj',
    'Zostawia warunek, który system sprawdza sam po każdym nocnym zaciągu i melduje, gdy się spełni (np. „powiadom mnie, gdy Bitcoin spadnie o 5%").',
    '{"type":"object","properties":{"subject_kind":{"type":"string"},"subject":{"type":"string"},"condition":{"type":"string"},"threshold":{"type":"number"},"window_days":{"type":"number"},"expires_in_days":{"type":"number"},"phrase":{"type":"string"}},"required":["subject_kind","subject","condition","threshold"]}'::jsonb,
    'internal',
    true
  ),
  (
    'list_standing_orders',
    'Rozkazy: Lista',
    'Wylicza stałe rozkazy użytkownika — czego system pilnuje, czy rozkaz jest aktywny i ile razy się wyzwolił.',
    '{"type":"object","properties":{"subject_kind":{"type":"string"}}}'::jsonb,
    'internal',
    true
  ),
  (
    'cancel_standing_order',
    'Rozkazy: Odwołaj',
    'Odwołuje stały rozkaz albo tylko go wycisza.',
    '{"type":"object","properties":{"order_id":{"type":"string"},"mode":{"type":"string"}},"required":["order_id"]}'::jsonb,
    'internal',
    true
  )
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      input_schema = EXCLUDED.input_schema,
      is_enabled = true;

-- ---------- 2. Podpięcie do agenta ----------
-- Tylko 'jarvis': to on rozmawia z użytkownikiem wprost, w konsoli czatu i w
-- komendzie głosowej. Rozkaz jest zobowiązaniem wobec konkretnej osoby, więc
-- nie ma powodu, żeby mógł go wydać agent pomocniczy w trakcie delegacji.
INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
SELECT a.id, t.id, true
FROM public.agents a
CROSS JOIN public.tools t
WHERE a.slug = 'jarvis'
  AND t.slug IN ('create_standing_order', 'list_standing_orders', 'cancel_standing_order')
ON CONFLICT (agent_id, tool_id) DO NOTHING;

-- ---------- 3. Nowe konta ----------
-- handle_new_user() wylicza listę slugów wprost — dopisujemy się do KAŻDEJ
-- takiej listy w treści funkcji, nie przepisując jej całej (funkcja była
-- zmieniana kilkoma migracjami; nadpisanie stałą treścią cofnęłoby tamte).
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
  ELSIF v_src LIKE '%create_standing_order%' THEN
    RAISE NOTICE 'handle_new_user() już zna rozkazy — pomijam krok 3.';
  ELSE
    v_src := replace(
      v_src,
      '''market_outlook'', ''fuel_outlook''',
      '''market_outlook'', ''fuel_outlook'', ''create_standing_order'', ''list_standing_orders'', ''cancel_standing_order'''
    );
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$%s$fn$',
      v_src
    );
    RAISE NOTICE 'handle_new_user() rozszerzona o narzędzia rozkazów.';
  END IF;
END $$;

-- Sprawdzenie: powinny wrócić 3 wiersze (agent 'jarvis' × 3 narzędzia).
-- SELECT a.slug AS agent, t.slug AS tool
-- FROM public.agent_tools at
-- JOIN public.agents a ON a.id = at.agent_id
-- JOIN public.tools t ON t.id = at.tool_id
-- WHERE t.slug LIKE '%standing_order%'
-- ORDER BY t.slug;
