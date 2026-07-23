-- =========================================================================
-- Async slide graphics for the Producer.
--
-- The image model (gemini-2.5-flash-image, preview) is slow and 503-prone,
-- and doing it inline blew the server-function time budget — presentations
-- came back with no images or failed outright. New flow: generate_document
-- builds + returns the file IMMEDIATELY (text-only, instant link), records
-- the spec + a 'pending' image status, and the client kicks a SEPARATE
-- enrichDocumentImages call (its own time budget) that generates the images,
-- rebuilds the file in place, and flips the status to 'ready'.
--
--   image_status: 'none'    — no image prompts, nothing to do
--                 'pending' — file built text-only, enrichment queued
--                 'ready'   — images generated and merged into the file
--                 'failed'  — enrichment ran but produced no usable images
--   spec: the normalized DocSpec (jsonb) so enrichment can rebuild the exact
--         same document with images, without the model in the loop again.
-- =========================================================================

ALTER TABLE public.generated_files
  ADD COLUMN IF NOT EXISTS image_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS spec jsonb;
