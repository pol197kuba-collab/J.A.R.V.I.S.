-- =========================================================================
-- MARKET GRID — reżim rynku i kopie prognoz.
--
-- regime: sytuacja rynkowa w chwili prognozy (src/lib/markets/regime.ts):
--   uptrend | uptrend_pullback | downtrend | downtrend_bounce | sideways.
--   Trafność „w danej sytuacji" to podstawa uczenia typera — przegląd z
--   2026-10 pokazał 65 prognoz wzrostu z rzędu dla krypto w konsolidacji,
--   bo średnie kroczące wciąż pamiętały wrześniowe wzrosty.
--
-- stale: prognoza postawiona na tych samych, nieodświeżonych notowaniach co
--   poprzednia (identyczna cena wejściowa) — kopia, nie nowa obserwacja.
--   Panel pomija je w trafności. Nowych kopii aplikacja już nie zapisuje.
--
-- context_version: którą wersją aplikacja uzupełniła kontekst wiersza
--   (pasmo, reżim, kopia). NULL = jeszcze nie; przelicza je
--   backfillPredictionContext przy wejściu na /rynki albo w nocnym jobie.
-- =========================================================================

ALTER TABLE public.market_predictions
  ADD COLUMN IF NOT EXISTS regime TEXT,
  ADD COLUMN IF NOT EXISTS stale BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS context_version SMALLINT;

ALTER TABLE public.market_predictions
  DROP CONSTRAINT IF EXISTS market_predictions_regime_allowed;
ALTER TABLE public.market_predictions
  ADD CONSTRAINT market_predictions_regime_allowed
    CHECK (regime IS NULL OR regime IN
      ('uptrend', 'uptrend_pullback', 'downtrend', 'downtrend_bounce', 'sideways'));

CREATE INDEX IF NOT EXISTS idx_market_predictions_context_missing
  ON public.market_predictions(owner_id)
  WHERE context_version IS NULL;
