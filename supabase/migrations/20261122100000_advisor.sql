-- =========================================================================
-- DORADCA (src/lib/advisor/) — ustawienia i dziennik zagrań.
--
-- advisor_settings: jeden wiersz na właściciela, JSON pilnowany przez
--   parseAdvisorSettings (kapitał, ryzyko %, limit ekspozycji, próg i okno
--   powiadomień, tabela instrumentów XTB, licznik głębokich analiz).
-- advisor_journal: „zagrałem / pomijam” z kart Doradcy. Pozycje „zagrałem”
--   (status 'open') pilnuje przebieg na żywo: TP / SL / koniec horyzontu /
--   zgodność graczy obrócona przeciw pozycji → push, każdy rodzaj raz
--   (kolumna alerts).
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.advisor_settings (
  owner_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.advisor_settings TO authenticated;
GRANT ALL ON public.advisor_settings TO service_role;
ALTER TABLE public.advisor_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Advisor settings: owner manages" ON public.advisor_settings;
CREATE POLICY "Advisor settings: owner manages" ON public.advisor_settings
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS public.advisor_journal (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  label        TEXT NOT NULL,
  side         TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  action       TEXT NOT NULL CHECK (action IN ('played', 'skipped')),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  strength     INTEGER NOT NULL,
  entry_price  NUMERIC NOT NULL,
  stop_price   NUMERIC NOT NULL,
  take_price   NUMERIC NOT NULL,
  expires_on   DATE NOT NULL,
  lots         NUMERIC,
  units        NUMERIC,
  play         JSONB NOT NULL DEFAULT '{}'::jsonb,
  alerts       TEXT[] NOT NULL DEFAULT '{}',
  closed_reason TEXT,
  closed_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS advisor_journal_owner_open
  ON public.advisor_journal (owner_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.advisor_journal TO authenticated;
GRANT ALL ON public.advisor_journal TO service_role;
ALTER TABLE public.advisor_journal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Advisor journal: owner manages" ON public.advisor_journal;
CREATE POLICY "Advisor journal: owner manages" ON public.advisor_journal
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
