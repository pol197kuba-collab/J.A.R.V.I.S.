-- =========================================================================
-- MARKET GRID — zapis predykcji i pomiar ich trafności. Etap 3 modułu.
--
-- PO CO TA TABELA: bez niej „typer" jest nieweryfikowalny. Każda prognoza
-- jest zapisywana razem z CENĄ Z MOMENTU JEJ POSTAWIENIA, a po upływie
-- horyzontu rozliczana wobec ceny z cache'u notowań. Trafności nie da się
-- odtworzyć wstecz — albo zapisujemy ją od pierwszego dnia, albo nie
-- dowiemy się nigdy, czy moduł w ogóle działa.
--
-- WŁASNOŚĆ: wiersze są per użytkownik (owner_id), inaczej niż notowania i
-- newsy. To nie są dane publiczne — to historia skuteczności KONKRETNEJ
-- konfiguracji (ten zestaw obserwowanych instrumentów, ten model, te progi).
-- Wymieszanie jej między kontami zafałszowałoby wskaźnik trafności.
--
-- DWA ŹRÓDŁA, ŚWIADOMIE: dla każdego instrumentu zapisujemy osobno
-- prognozę czysto sygnałową ('signals') i prognozę modelu ('ai'), żeby dało
-- się odpowiedzieć na pytanie, które naprawdę ma znaczenie: czy model bije
-- prostą arytmetykę, czy tylko ładniej ją opisuje.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.market_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  made_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Kolumna generowana, żeby można było wymusić „jedna prognoza dziennie na
  -- instrument i źródło" — bez niej każde odświeżenie strony dokładałoby
  -- kolejny wiersz i rozcieńczało statystykę.
  made_on DATE GENERATED ALWAYS AS ((made_at AT TIME ZONE 'UTC')::date) STORED,
  horizon_days INTEGER NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  -- 'up' | 'down' | 'flat'
  direction TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  technical_score INTEGER,
  sentiment_score INTEGER,
  -- Cena w chwili postawienia prognozy. Bez niej rozliczenie byłoby
  -- zgadywaniem, od czego liczyć zmianę.
  price_at_prediction NUMERIC(20, 8) NOT NULL,
  rationale_pl TEXT,
  -- 'signals' (deterministyczne) | 'ai' (model)
  source TEXT NOT NULL,
  model TEXT,

  -- ---------- rozliczenie ----------
  resolved_at TIMESTAMPTZ,
  price_at_resolution NUMERIC(20, 8),
  actual_change_pct NUMERIC(12, 4),
  -- 'hit' | 'miss'. NULL = jeszcze nierozliczona.
  outcome TEXT,

  CONSTRAINT market_predictions_direction_allowed
    CHECK (direction IN ('up', 'down', 'flat')),
  CONSTRAINT market_predictions_source_allowed
    CHECK (source IN ('signals', 'ai')),
  CONSTRAINT market_predictions_outcome_allowed
    CHECK (outcome IS NULL OR outcome IN ('hit', 'miss')),
  CONSTRAINT market_predictions_confidence_range
    CHECK (confidence >= 0 AND confidence <= 100),
  CONSTRAINT market_predictions_unique_daily
    UNIQUE (owner_id, symbol, source, horizon_days, made_on)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_predictions TO authenticated;
GRANT ALL ON public.market_predictions TO service_role;
ALTER TABLE public.market_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Market predictions: owner manages" ON public.market_predictions;
CREATE POLICY "Market predictions: owner manages" ON public.market_predictions
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_market_predictions_owner_made
  ON public.market_predictions(owner_id, made_at DESC);

-- Wyszukiwanie prognoz do rozliczenia: te, którym minął termin i które
-- jeszcze nie mają wyniku.
CREATE INDEX IF NOT EXISTS idx_market_predictions_due
  ON public.market_predictions(owner_id, due_at)
  WHERE outcome IS NULL;
