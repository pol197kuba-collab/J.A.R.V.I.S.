-- =========================================================================
-- MÓZG 3D (PLAN.md, S1.3) — ślad RAG i wyszukiwanie w notatkach.
--
-- 1. match_notes — semantyczne wyszukiwanie w notatkach (bliźniak
--    match_memories). Notatki mają embeddingi od S1.1, ale J.A.R.V.I.S.
--    ich nie przeszukiwał: `recall` sięgał tylko do wspomnień, więc
--    pytanie o coś zapisanego w notatce zostawało bez odpowiedzi.
--
-- 2. brain_traces — „skąd J.A.R.V.I.S. to wie”: każde wywołanie `recall`
--    i `search_documents` zapisuje, które gwiazdy trafiły do odpowiedzi.
--    Strona /mozg słucha nowych śladów przez Realtime i rozświetla te
--    gwiazdy liniami z rdzenia; starsze ślady można odtworzyć z listy.
--    Wpisy starsze niż 30 dni sprząta pg_cron.
-- =========================================================================

-- ---------- 1. match_notes ----------
CREATE INDEX IF NOT EXISTS idx_notes_embedding ON public.notes
  USING hnsw (embedding extensions.vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_notes(
  query_embedding extensions.vector(768),
  match_count integer DEFAULT 8,
  min_similarity double precision DEFAULT 0.35
)
RETURNS TABLE (
  id uuid,
  title text,
  body text,
  tags text[],
  updated_at timestamptz,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    n.id,
    n.title,
    n.body,
    n.tags,
    n.updated_at,
    1 - (n.embedding <=> query_embedding) AS similarity
  FROM public.notes n
  WHERE n.owner_id = auth.uid()
    AND n.embedding IS NOT NULL
    AND 1 - (n.embedding <=> query_embedding) >= min_similarity
  ORDER BY n.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 25);
$$;

GRANT EXECUTE ON FUNCTION public.match_notes(extensions.vector(768), integer, double precision)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.match_notes(extensions.vector(768), integer, double precision)
  FROM anon, PUBLIC;

-- ---------- 2. brain_traces ----------
CREATE TABLE IF NOT EXISTS public.brain_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Przebieg agenta, w którym padło wyszukiwanie (bez FK — ślad ma
  -- przetrwać sprzątanie agent_runs).
  run_id UUID,
  tool TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  -- [{"type": "memory"|"note"|"document", "id": uuid, "score": 0–1 | null}]
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_traces_owner_created
  ON public.brain_traces (owner_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.brain_traces TO authenticated;
GRANT ALL ON public.brain_traces TO service_role;
ALTER TABLE public.brain_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brain traces: owner reads" ON public.brain_traces
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Brain traces: owner writes" ON public.brain_traces
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Brain traces: owner deletes" ON public.brain_traces
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- Realtime: /mozg dostaje nowe ślady na żywo (RLS obowiązuje także tu).
ALTER PUBLICATION supabase_realtime ADD TABLE public.brain_traces;

SELECT cron.schedule(
  'brain-traces-cleanup',
  '20 3 * * *',
  $cron$DELETE FROM public.brain_traces WHERE created_at < now() - interval '30 days'$cron$
);
