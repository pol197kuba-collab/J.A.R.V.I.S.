-- =========================================================================
-- VISION AR (PLAN.md, S4.1) — potwierdzone skany.
--
-- Skaner czyta zdjęcie do pól trybu (paragon / licznik / dokument /
-- lodówka), użytkownik je poprawia i dopiero wtedy zapisuje — tu trafia
-- wyłącznie to, co zatwierdził. S4.2 rozprowadzi skany dalej (paragon →
-- Wydatki, licznik → vehicle_log, dokument → RAG).
--
-- Zdjęcie leży w prywatnym buckecie 'scans' pod <owner_id>/..., przez
-- 30 dni (photo_expires_at). Po terminie serwer usuwa plik i zeruje
-- photo_path przy następnym zapisie skanu — dane z paragonu zostają.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.vision_scans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode             TEXT NOT NULL CHECK (mode IN ('receipt', 'odometer', 'document', 'fridge')),
  -- Zatwierdzone pola (walidowane zodem po stronie serwera, schemat per tryb).
  data             JSONB NOT NULL,
  -- Ile pól użytkownik zmienił względem odczytu modelu — miara jakości OCR.
  edited_fields    SMALLINT NOT NULL DEFAULT 0 CHECK (edited_fields >= 0),
  model            TEXT,
  photo_path       TEXT,
  photo_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vision_scans_owner
  ON public.vision_scans (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vision_scans_photo_expiry
  ON public.vision_scans (owner_id, photo_expires_at)
  WHERE photo_path IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vision_scans TO authenticated;
GRANT ALL ON public.vision_scans TO service_role;
ALTER TABLE public.vision_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vision scans: owner manages" ON public.vision_scans;
CREATE POLICY "Vision scans: owner manages" ON public.vision_scans
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ---------- prywatny bucket na zdjęcia skanów ----------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('scans', 'scans', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Scans storage: owner can upload" ON storage.objects;
CREATE POLICY "Scans storage: owner can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'scans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Scans storage: owner can read" ON storage.objects;
CREATE POLICY "Scans storage: owner can read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'scans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Scans storage: owner can delete" ON storage.objects;
CREATE POLICY "Scans storage: owner can delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'scans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
