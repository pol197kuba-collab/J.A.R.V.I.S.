-- =========================================================================
-- Semantic memory: pgvector + match_memories RPC.
--
-- Upgrades `recall` from pure ILIKE keyword matching to meaning-based
-- search. The `memories.embedding` column existed as JSONB since the
-- initial schema but nothing ever wrote it — safe to swap its type to a
-- real pgvector column (768 dims, matching Gemini gemini-embedding-001
-- with outputDimensionality=768).
--
-- Embeddings are written best-effort by the `remember` tool
-- (src/lib/agents/tools.server.ts) using the user's own Gemini key;
-- `recall` embeds the query and calls match_memories(), merging results
-- with the existing ILIKE path so keyword hits and pre-embedding rows are
-- never lost.
-- =========================================================================

-- ---------- 1. pgvector extension ----------
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ---------- 2. Swap memories.embedding JSONB → vector(768) ----------
-- The column has never been written by any code path; dropping loses nothing.
ALTER TABLE public.memories DROP COLUMN embedding;
ALTER TABLE public.memories ADD COLUMN embedding extensions.vector(768);

-- HNSW index for cosine similarity search. Fine to create on an empty
-- column — pgvector builds it incrementally as rows gain embeddings.
CREATE INDEX idx_memories_embedding ON public.memories
  USING hnsw (embedding extensions.vector_cosine_ops);

-- ---------- 3. match_memories RPC ----------
-- SECURITY INVOKER + explicit auth.uid() filter: runs with the caller's
-- rights, so RLS on public.memories applies and one user can never search
-- another user's memories.
CREATE OR REPLACE FUNCTION public.match_memories(
  query_embedding extensions.vector(768),
  match_count integer DEFAULT 8,
  min_similarity double precision DEFAULT 0.35
)
RETURNS TABLE (
  id uuid,
  key text,
  value text,
  tags text[],
  importance integer,
  updated_at timestamptz,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    m.id,
    m.key,
    m.value,
    m.tags,
    m.importance,
    m.updated_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM public.memories m
  WHERE m.user_id = auth.uid()
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) >= min_similarity
  ORDER BY m.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 25);
$$;

GRANT EXECUTE ON FUNCTION public.match_memories(extensions.vector(768), integer, double precision)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.match_memories(extensions.vector(768), integer, double precision)
  FROM anon, PUBLIC;
