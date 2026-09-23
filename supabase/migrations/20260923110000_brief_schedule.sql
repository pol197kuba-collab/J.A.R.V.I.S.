-- =========================================================================
-- Briefing: własna godzina i cichy tryb.
--
-- GODZINA JEST LOKALNA (Europe/Warsaw), nie UTC. Użytkownik myśli „chcę go
-- o siódmej", a nie „o piątej czasu uniwersalnego" — przeliczenie należy do
-- kodu (src/lib/format/warsaw.ts), nie do właściciela.
--
-- GRANULACJA GODZINOWA JEST ŚWIADOMA. Harmonogram GitHub Actions bywa
-- spóźniony o kilkanaście minut, więc obietnica „7:45" byłaby obietnicą,
-- której nie kontrolujemy. Job biegnie co godzinę i składa rubrykę przy
-- pierwszym przebiegu po wybranej godzinie.
-- =========================================================================

-- Godzina lokalna, o której briefing ma być gotowy. 7 = „rano".
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS brief_hour SMALLINT NOT NULL DEFAULT 7;

-- Czy o gotowej rubryce powiadomić urządzenia. FALSE = briefing cichy:
-- powstaje i czeka na pulpicie, ale nie budzi telefonu. Wiersz w
-- `notifications` powstaje w obu wypadkach — to on jest zapisem
-- kanonicznym, a dzwonek w aplikacji ma świecić niezależnie od tego, czy
-- użytkownik zgodził się na powiadomienia systemowe.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS brief_push BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_brief_hour_range'
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_brief_hour_range
      CHECK (brief_hour >= 0 AND brief_hour <= 23);
  END IF;
END $$;
