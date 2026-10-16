-- =========================================================================
-- MARKET GRID — test A/B: prognoza modelu z wnioskami z własnej historii.
--
-- 'ai'         — model z promptem jak dotąd (grupa kontrolna);
-- 'ai_learned' — ten sam model, ten sam prompt + wnioski policzone z
--                rozliczonych prognoz (src/lib/markets/lessons.ts) +
--                sytuacja rynkowa instrumentu.
-- Porównanie trafności obu źródeł na panelu skuteczności odpowiada, czy
-- wnioski pomagają, czy tylko ładnie brzmią.
--
-- lessons: dokładnie te zdania, które widział model przy tej prognozie —
-- żeby dało się później sprawdzić, który wniosek pomógł, a który zaszkodził.
-- =========================================================================

ALTER TABLE public.market_predictions
  DROP CONSTRAINT IF EXISTS market_predictions_source_allowed;
ALTER TABLE public.market_predictions
  ADD CONSTRAINT market_predictions_source_allowed
    CHECK (source IN ('signals', 'ai', 'ai_learned'));

ALTER TABLE public.market_predictions
  ADD COLUMN IF NOT EXISTS lessons JSONB;
