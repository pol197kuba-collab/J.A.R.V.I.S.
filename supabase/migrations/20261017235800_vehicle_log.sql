-- =========================================================================
-- DZIENNIK AUTA (PLAN.md, S4.2) — odczyty licznika z Vision.
--
-- Każdy zatwierdzony skan licznika to wiersz: przebieg, a przy tankowaniu
-- litry i kwota z dystrybutora. Koszt kilometra liczy src/lib/vehicle/
-- costs.ts metodą „do pełna”: paliwo z tankowania pokrywa km od poprzedniego
-- odczytu. Bez kwoty — szacunek z hurtowej ceny Orlen ON z dnia odczytu
-- (orlen_fuel_prices) + marża stacji + VAT, zawsze oznaczony jako szacunek.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.vehicle_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_id     UUID REFERENCES public.vision_scans(id) ON DELETE SET NULL,
  logged_on   DATE NOT NULL,
  odometer_km INTEGER NOT NULL CHECK (odometer_km BETWEEN 0 AND 3000000),
  fuel_liters NUMERIC(7, 2) CHECK (fuel_liters > 0),
  amount_pln  NUMERIC(10, 2) CHECK (amount_pln > 0),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_log_owner_km
  ON public.vehicle_log (owner_id, odometer_km DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_log TO authenticated;
GRANT ALL ON public.vehicle_log TO service_role;
ALTER TABLE public.vehicle_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vehicle log: owner manages" ON public.vehicle_log;
CREATE POLICY "Vehicle log: owner manages" ON public.vehicle_log
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
