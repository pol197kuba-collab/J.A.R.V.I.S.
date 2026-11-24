-- =========================================================================
-- DOKUMENTY — tabele z arkuszy (.xlsx / .csv) do liczenia przez M.E.T.R.I.C.
--
-- Tekst arkusza (nagłówek + pierwsze wiersze) idzie jak dotąd do
-- document_chunks (wyszukiwanie). Pełne dane trafiają tu, po jednym wierszu
-- na arkusz — narzędzie analyze_table (src/lib/agents/tools/documents.server.ts,
-- logika w src/lib/documents/tableMath.ts) liczy na nich sumy, średnie,
-- grupowania i trendy kodem, a nie „na oko” modelu.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.document_tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sheet_index INTEGER NOT NULL,
  name        TEXT NOT NULL,
  -- wiersze jako tablica tablic tekstu; pierwszy wiersz to zwykle nagłówek
  rows        JSONB NOT NULL,
  row_count   INTEGER NOT NULL,
  col_count   INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, sheet_index)
);

CREATE INDEX IF NOT EXISTS idx_document_tables_user ON public.document_tables (user_id, document_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_tables TO authenticated;
GRANT ALL ON public.document_tables TO service_role;
ALTER TABLE public.document_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Document tables: owner manages" ON public.document_tables;
CREATE POLICY "Document tables: owner manages" ON public.document_tables
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------- narzędzie dla M.E.T.R.I.C.-a ----------
-- Runtime pyta bazę, które narzędzia agent ma włączone — bez tego wiersza
-- narzędzie nie istnieje dla modelu.
INSERT INTO public.tools (slug, name, description, input_schema, handler_kind, is_enabled)
VALUES
  (
    'analyze_table',
    'M.E.T.R.I.C.: Analiza arkusza',
    'Liczenie na danych z wgranego arkusza (.xlsx / .csv): opis kolumn, filtrowanie, grupowanie i agregaty (suma, średnia, min, max, liczność), trend po dacie.',
    '{"type":"object","properties":{"document_id":{"type":"string"},"sheet":{"type":"string"},"operation":{"type":"string","enum":["describe","aggregate","rows"]},"group_by":{"type":"string"},"value_column":{"type":"string"},"agg":{"type":"string","enum":["sum","avg","min","max","count"]},"filters":{"type":"array"},"sort":{"type":"string","enum":["value_desc","value_asc","key"]},"limit":{"type":"integer"}},"required":["document_id","operation"]}'::jsonb,
    'internal',
    true
  )
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      input_schema = EXCLUDED.input_schema,
      is_enabled = true;

INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
SELECT a.id, t.id, true
FROM public.agents a
CROSS JOIN public.tools t
WHERE a.slug = 'metric'
  AND t.slug = 'analyze_table'
ON CONFLICT (agent_id, tool_id) DO NOTHING;

-- Instrukcja M.E.T.R.I.C.-a: dopisek o arkuszach (raz — powtórne
-- uruchomienie migracji nie dubluje tekstu).
UPDATE public.agents
SET config = jsonb_set(
  config,
  '{system_prompt}',
  to_jsonb(
    (config->>'system_prompt') ||
    ' ARKUSZE: dla wgranych plików .xlsx / .csv masz narzędzie analyze_table — liczy kodem na pełnych danych (operation "describe" pokazuje kolumny, "aggregate" sumuje / uśrednia / liczy z group_by i filtrami, sort "key" daje trend po dacie, "rows" zwraca pasujące wiersze). Do każdej liczby z arkusza używaj analyze_table, nie licz w pamięci ani z fragmentów search_documents; zacznij od "describe", żeby poznać nazwy kolumn. ZDJĘCIA: wgrane zdjęcia są w dokumentach jako odczytany tekst i opis — szukaj w nich jak w każdym dokumencie.'
  )
)
WHERE slug = 'metric'
  AND config ? 'system_prompt'
  AND position('analyze_table' in config->>'system_prompt') = 0;
