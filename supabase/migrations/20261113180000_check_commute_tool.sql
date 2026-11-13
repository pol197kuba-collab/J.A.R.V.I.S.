-- Narzędzie dojazdu dla J.A.R.V.I.S.-a (zgłoszenie właściciela 2026-11-13:
-- na „jak wygląda droga do domu” agent prosił o adres, bo nie miał dostępu
-- do Situation Room). Implementacja: src/lib/agents/tools/commute.server.ts.
--
-- Runtime pyta bazę, które narzędzia agent ma włączone — bez tego wiersza
-- narzędzie nie istnieje dla modelu. Stary kod nie zna `check_commute`,
-- więc wiersz go nie rusza (ALL_TOOLS filtruje po nazwie).
INSERT INTO public.tools (slug, name, description, input_schema, handler_kind, is_enabled)
VALUES
  (
    'check_commute',
    'Dojazd: Sprawdź',
    'Czas dojazdu dom ↔ praca z ruchem na żywo (TomTom), utrudnienia na trasie, objazd i trasy do wyboru — te same dane co Situation Room.',
    '{"type":"object","properties":{"direction":{"type":"string","enum":["to_work","home"]},"when":{"type":"string","enum":["now","planned"]}}}'::jsonb,
    'internal',
    true
  )
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      input_schema = EXCLUDED.input_schema,
      is_enabled = true;

-- J.A.R.V.I.S. odpowiada wprost; S.H.I.E.L.D. prowadzi Situation Room.
INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
SELECT a.id, t.id, true
FROM public.agents a
CROSS JOIN public.tools t
WHERE a.slug IN ('jarvis', 'shield')
  AND t.slug = 'check_commute'
ON CONFLICT (agent_id, tool_id) DO NOTHING;
