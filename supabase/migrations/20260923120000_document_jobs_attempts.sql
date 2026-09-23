-- =========================================================================
-- Zadania dokumentowe: licznik podejść.
--
-- AWARIA, KTÓRA TO WYMUSIŁA. Potok Insight → Forge jest odpalany przez
-- PRZEGLĄDARKĘ (klient woła runDocumentJobFn i nie czeka na wynik). Gdy
-- telefon uśpi albo wyrzuci kartę z pamięci, żądanie zostaje zerwane razem
-- z wywołaniem po stronie serwera — nikt nie zapisuje ani wyniku, ani błędu.
-- Wiersz zostaje w `running` NA ZAWSZE, a strażnik idempotencji w kodzie
-- (`status !== 'queued'` → odmowa) sprawiał, że nawet ponowna próba nie
-- mogła go odblokować.
--
-- Licznik pozwala podnieść takie zadanie ograniczoną liczbę razy, a potem
-- zamknąć je uczciwie jako nieudane — zamiast wskrzeszać w nieskończoność
-- albo zostawić w ciszy.
--
-- Pulsem zadania jest istniejące `updated_at` (ustawiane triggerem przy
-- każdej zmianie wiersza) — osobna kolumna na to byłaby duplikatem.
-- =========================================================================

ALTER TABLE public.document_jobs
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

-- Zadania już zakończone dostają licznik na 1, żeby statystyka „ile razy
-- podchodziliśmy" nie zaczynała się od zera dla czegoś, co przebiegło raz.
UPDATE public.document_jobs
SET attempts = 1
WHERE attempts = 0
  AND status IN ('done', 'error');

-- Wpisy zaklinowane PRZED tą migracją: nie da się ich dokończyć (brak
-- historii podejść, model dawno stracił kontekst), ale nie wolno ich
-- zostawić w stanie sugerującym trwającą pracę. Zamykamy je z uczciwym
-- powodem; nowe zadania obsługuje już mechanizm ponowień.
UPDATE public.document_jobs
SET status = 'error',
    error = COALESCE(
      error,
      'Przerwane przed wdrożeniem ponowień — najpewniej zamknięcie lub uśpienie aplikacji w trakcie generowania. Poproś o ten dokument jeszcze raz.'
    ),
    finished_at = COALESCE(finished_at, now())
WHERE status = 'running'
  AND updated_at < now() - INTERVAL '1 hour';

-- Ratownik pyta zawsze o to samo: niedokończone zadania, od najstarszych.
CREATE INDEX IF NOT EXISTS idx_document_jobs_unfinished
  ON public.document_jobs(status, updated_at)
  WHERE status IN ('queued', 'running');
