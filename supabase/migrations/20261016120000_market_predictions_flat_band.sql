-- =========================================================================
-- MARKET GRID — pasmo „bez zmian" liczone ze zmienności instrumentu.
--
-- Dotąd prognoza „flat" była trafiona, gdy cena przez 7 dni zmieniła się o
-- mniej niż ±1% — jeden próg dla wszystkich. Mediana tygodniowego ruchu to
-- ~2%, więc „flat" dla BTC prawie zawsze przegrywał, a dla EURPLN prawie
-- zawsze wygrywał. Pasmo liczy teraz kod (src/lib/markets/scoreboard.ts,
-- flatBandPct) z historii notowań W CHWILI postawienia prognozy i zapisuje
-- je tutaj — rozliczenie nie może zależeć od danych, których prognoza nie znała.
--
-- outcome_fixed_band trzyma wynik wg starej reguły ±1%, żeby panel
-- skuteczności mógł pokazać obie trafności obok siebie. Stare wiersze
-- przelicza aplikacja przy pierwszym wejściu na /rynki albo w nocnym jobie
-- (backfillFlatBands) — dotychczasowy wynik ląduje w outcome_fixed_band.
-- =========================================================================

ALTER TABLE public.market_predictions
  ADD COLUMN IF NOT EXISTS flat_band_pct NUMERIC(8, 4),
  ADD COLUMN IF NOT EXISTS outcome_fixed_band TEXT;

ALTER TABLE public.market_predictions
  DROP CONSTRAINT IF EXISTS market_predictions_outcome_fixed_band_allowed;
ALTER TABLE public.market_predictions
  ADD CONSTRAINT market_predictions_outcome_fixed_band_allowed
    CHECK (outcome_fixed_band IS NULL OR outcome_fixed_band IN ('hit', 'miss'));

-- Wiersze czekające na policzenie pasma — szuka ich backfill.
CREATE INDEX IF NOT EXISTS idx_market_predictions_band_missing
  ON public.market_predictions(owner_id)
  WHERE flat_band_pct IS NULL;
