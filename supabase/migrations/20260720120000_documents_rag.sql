-- =========================================================================
-- RAG over personal documents: documents/document_chunks + Storage +
-- match_document_chunks RPC.
--
-- Mirrors the memories/match_memories pgvector pattern exactly (vector(768)
-- matching Gemini gemini-embedding-001 with outputDimensionality=768, HNSW
-- index, SECURITY INVOKER RPC with an explicit auth.uid() filter so RLS
-- effectively still applies inside the function). Chunk embeddings are
-- written best-effort by the processing server function
-- (src/lib/documents/documents.functions.ts) using the user's own Gemini
-- key, same as `remember` does for memories — a chunk with a null
-- embedding just isn't semantically searchable yet, it still exists.
--
-- This is the first use of Supabase Storage in this codebase (no prior
-- bucket/upload precedent to follow) — bucket is private, and storage
-- policies scope every object to a `${user_id}/...` path prefix, the
-- standard Supabase per-owner Storage RLS idiom.
-- =========================================================================

-- ---------- 1. documents ----------
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  -- uploading -> processing -> ready, or -> error (see error_message)
  status TEXT NOT NULL DEFAULT 'uploading',
  char_count INTEGER,
  chunk_count INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Documents: owner manages" ON public.documents
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 2. document_chunks ----------
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE public.document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  -- Denormalized from documents.user_id so match_document_chunks can filter
  -- by auth.uid() directly on this table, same shape as match_memories.
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding extensions.vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_chunks TO authenticated;
GRANT ALL ON public.document_chunks TO service_role;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Document chunks: owner manages" ON public.document_chunks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- HNSW index for cosine similarity search — fine to create on an empty
-- column, pgvector builds it incrementally as rows gain embeddings.
CREATE INDEX idx_document_chunks_embedding ON public.document_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX idx_document_chunks_document_id ON public.document_chunks (document_id);

-- ---------- 3. match_document_chunks RPC ----------
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding extensions.vector(768),
  match_count integer DEFAULT 8,
  min_similarity double precision DEFAULT 0.35
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  filename text,
  chunk_index integer,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    c.id AS chunk_id,
    c.document_id,
    d.filename,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks c
  JOIN public.documents d ON d.id = c.document_id
  WHERE c.user_id = auth.uid()
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= min_similarity
  ORDER BY c.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 25);
$$;

GRANT EXECUTE ON FUNCTION public.match_document_chunks(extensions.vector(768), integer, double precision)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.match_document_chunks(extensions.vector(768), integer, double precision)
  FROM anon, PUBLIC;

-- ---------- 4. Storage bucket + owner-scoped policies ----------
-- Private bucket. Object paths are always `${user_id}/${document_id}/${filename}`
-- (enforced client/server-side, not by the database) — storage.foldername(name)
-- picks off that leading path segment for the RLS-equivalent policy check.
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Documents storage: owner can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Documents storage: owner can read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Documents storage: owner can delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
