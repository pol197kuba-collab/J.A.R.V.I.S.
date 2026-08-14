-- =========================================================================
-- Fix: images generated for a document never actually made it into the
-- file. Confirmed live (GTA VI pdf): system log showed
-- "generated_files: new row violates row-level security policy" right
-- after "pdf generated: ... images pending" — the images themselves were
-- resolving fine (real photos or AI-generated fallback), but rebuilding
-- the file with them embedded and saving it back to Storage failed.
--
-- Root cause: the 'generated' Storage bucket (20260722160000_producer_agent
-- .sql) only ever got INSERT/SELECT/DELETE policies on storage.objects.
-- The background image-enrichment pass calls
-- supabase.storage.from("generated").update(path, bytes, ...) to REPLACE
-- the already-uploaded text-only file with the image-embedded version —
-- Storage's .update() is implemented as an upsert under the hood, which
-- needs an UPDATE policy for the "row already exists, overwrite it"
-- branch. With no such policy, Postgres RLS rejected every single one of
-- these rebuilds, so every generated file was permanently stuck without
-- images regardless of whether image resolution itself succeeded.
-- =========================================================================

CREATE POLICY "Generated storage: owner can update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'generated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'generated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
