-- =========================================================================
-- POCHODZENIE WPISU W PAMIĘCI (plan naprawczy, etap 1, A2d).
--
-- `remember` zapisywał każdy fakt tak samo, niezależnie od tego, czy podał
-- go użytkownik, czy model „zapamiętał” coś po przeczytaniu strony albo
-- dokumentu. Treść spoza właściciela może zawierać wstrzyknięte polecenia,
-- a pamięć wraca do modelu w KAŻDEJ przyszłej rozmowie — dlatego `recall`
-- ma mówić, skąd wpis pochodzi.
--
--   user    — zapisany w turze bez obcej treści (to, co powiedział właściciel);
--   tool    — zapisany w turze, w której model widział obcą treść;
--   unknown — wpisy sprzed tej migracji (nie wiemy, skąd są).
--
-- Kolumna `source` zostaje bez zmian (to slug agenta, nie pochodzenie).
-- Zgodne ze starym kodem: insert bez `origin` dostaje 'user'.
-- =========================================================================

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE public.memories ALTER COLUMN origin SET DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'memories_origin_check'
  ) THEN
    ALTER TABLE public.memories
      ADD CONSTRAINT memories_origin_check CHECK (origin IN ('user', 'tool', 'unknown'));
  END IF;
END $$;
