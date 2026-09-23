-- =========================================================================
-- PORANNY BRIEFING — jedna rubryka dziennie, składana w nocy.
--
-- DLACZEGO TO JEST W BAZIE, A NIE LICZONE PRZY WEJŚCIU NA STRONĘ. Briefing
-- czyta kilkanaście tabel i — gdy jest czym — prosi model o przepisanie
-- tekstu. Liczony na żądanie znaczyłby kilka sekund pustego ekranu przy
-- każdym wejściu na pulpit i rachunek za model przy każdym odświeżeniu,
-- żeby dostać dokładnie ten sam tekst co minutę wcześniej. Raz dziennie,
-- w jobie, po zaciągu danych.
--
-- DLACZEGO NIE JEST TYLKO POWIADOMIENIEM. Powiadomienie się czyta i gubi;
-- briefing ma zostać na pulpicie przez cały dzień i dać się odtworzyć
-- głosem po powrocie. Powiadomienie jest wysyłane OBOK, jako sygnał, że
-- rubryka na dziś już jest.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.daily_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Dzień, którego briefing dotyczy. DATE, nie TIMESTAMPTZ: „briefing z
  -- 23 września" to pojęcie kalendarzowe, a nie chwila.
  brief_date DATE NOT NULL,

  greeting TEXT NOT NULL,

  -- Sekcje w postaci, w jakiej składa je src/lib/brief/compose.ts:
  -- [{ kind, heading, lines: [] }]. jsonb, bo liczba i rodzaj sekcji
  -- zmieniają się razem z tym, co system potrafi obserwować — a to nie
  -- powód, żeby co raz migrować schemat.
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Wersja mówiona: jeden akapit, bez list i znaków, których synteza mowy
  -- nie przeczyta. Trzymana obok sekcji, nie zamiast nich — tekst na
  -- ekranie i tekst w głośniku mają różne wymagania.
  spoken TEXT NOT NULL,

  -- Surowe liczby, z których briefing powstał. Do diagnostyki („skąd on
  -- wziął ten spadek") i do ewentualnego przeliczenia tekstu bez
  -- ponownego odpytywania wszystkich tabel.
  facts JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- 'facts' = złożony z samych liczb; 'model:<nazwa>' = przepisany przez
  -- model. Briefing powstaje ZAWSZE, model tylko poprawia język — ta
  -- kolumna mówi, który wariant akurat widać.
  generated_by TEXT NOT NULL DEFAULT 'facts',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Jeden briefing na dzień. Powtórny przebieg job ma NADPISAĆ wczorajszą
  -- próbę, a nie dołożyć drugą rubrykę pod tą samą datą.
  CONSTRAINT daily_briefs_unique_day UNIQUE (owner_id, brief_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_briefs TO authenticated;
GRANT ALL ON public.daily_briefs TO service_role;
ALTER TABLE public.daily_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Daily briefs: owner manages" ON public.daily_briefs;
CREATE POLICY "Daily briefs: owner manages" ON public.daily_briefs
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- Pulpit pyta zawsze o to samo: najnowszy briefing tego użytkownika.
CREATE INDEX IF NOT EXISTS idx_daily_briefs_owner_date
  ON public.daily_briefs(owner_id, brief_date DESC);

DROP TRIGGER IF EXISTS trg_daily_briefs_updated_at ON public.daily_briefs;
CREATE TRIGGER trg_daily_briefs_updated_at BEFORE UPDATE ON public.daily_briefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
