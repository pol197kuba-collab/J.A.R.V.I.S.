-- =========================================================================
-- FUNDUSZ — progi ryzyka otwartych pozycji w fund_positions.
--
-- Silnik (src/lib/fund/engine.ts, `live`) trzyma dla każdej pozycji cenę
-- odniesienia (wejście albo ostatnie potwierdzenie prognozą) i progi
-- stop-loss / take-profit jako ułamek ruchu od niej, plus dzień końca
-- horyzontu. Karta gracza (/rynki) pokazuje je przy pozycji.
-- NULL = brak (koszyk, gracz bez stopów, brak zmienności).
-- =========================================================================

ALTER TABLE public.fund_positions
  ADD COLUMN IF NOT EXISTS ref_px     NUMERIC(24, 10),
  ADD COLUMN IF NOT EXISTS stop_pct   NUMERIC(12, 8),
  ADD COLUMN IF NOT EXISTS take_pct   NUMERIC(12, 8),
  ADD COLUMN IF NOT EXISTS expires_on DATE;
