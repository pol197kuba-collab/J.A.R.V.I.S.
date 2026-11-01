-- =========================================================================
-- MARKET GRID — dzienny budżet tokenów modelu.
--
-- Każde wywołanie modelu przez moduł rynkowy (prognozy, ocena newsów,
-- później alarmy w ciągu dnia) zapisuje tu zużycie. Przed wywołaniem kod
-- sumuje dzisiejsze wiersze i nie woła modelu, gdy przekroczyłby budżet
-- (src/lib/markets/budget.ts) — wtedy działa już tylko arytmetyka.
-- Doba liczona w czasie warszawskim, bo tak planowane są przebiegi.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.market_model_usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Dzień w Warszawie, liczony przez kod przy zapisie (generated column z
  -- AT TIME ZONE 'Europe/Warsaw' nie jest IMMUTABLE).
  used_on     DATE NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('forecast', 'forecast_learned', 'news', 'alarm')),
  model       TEXT,
  tokens_in   INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out  INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  -- Gemini nie zwraca zużycia — wtedy szacunek z długości tekstu.
  estimated   BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_market_model_usage_owner_day
  ON public.market_model_usage (owner_id, used_on);

GRANT SELECT, INSERT ON public.market_model_usage TO authenticated;
GRANT ALL ON public.market_model_usage TO service_role;

ALTER TABLE public.market_model_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Market model usage: owner reads" ON public.market_model_usage;
CREATE POLICY "Market model usage: owner reads"
  ON public.market_model_usage FOR SELECT TO authenticated
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Market model usage: owner writes" ON public.market_model_usage;
CREATE POLICY "Market model usage: owner writes"
  ON public.market_model_usage FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);
