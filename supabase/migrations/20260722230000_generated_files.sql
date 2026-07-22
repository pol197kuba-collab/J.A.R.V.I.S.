-- =========================================================================
-- generated_files — metadata index for Producer-generated documents.
--
-- Until now Producer files lived only in the 'generated' Storage bucket and
-- were reachable solely via the one-time signed URL dropped in chat. This
-- table makes them a first-class, browsable archive (a second panel on
-- /documents alongside the uploaded-docs archive), the same way public.documents
-- indexes user uploads. The bytes still live in Storage; this is metadata +
-- an owner-scoped RLS handle for listing, re-signing on demand, and deletion.
--
-- preview_path: pptx has no in-browser renderer, so generate_document also
-- writes a PDF rendering of the same deck (identical builder, same images)
-- to the bucket and records its path here — the /documents preview modal
-- shows that PDF in an <iframe>. Null for pdf (previewed directly) and docx
-- (rendered client-side via docx-preview).
-- =========================================================================

CREATE TABLE public.generated_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  format TEXT NOT NULL, -- 'pptx' | 'docx' | 'pdf'
  storage_path TEXT NOT NULL,
  preview_path TEXT, -- pptx-only: PDF rendering for in-app preview
  size_bytes INTEGER NOT NULL,
  title TEXT,
  section_count INTEGER,
  image_count INTEGER,
  run_id UUID, -- agent_runs.id that produced it (best-effort, not FK)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_files TO authenticated;
GRANT ALL ON public.generated_files TO service_role;
ALTER TABLE public.generated_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Generated files: owner manages" ON public.generated_files
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX generated_files_user_created_idx
  ON public.generated_files (user_id, created_at DESC);
