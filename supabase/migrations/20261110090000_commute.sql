-- =========================================================================
-- DOJAZD DO PRACY — ustawienia trasy, klucz TomTom, stan alertów.
--
-- OSOBNA TABELA, NIE KOLEJNE KOLUMNY W user_settings. Dojazd ma własny
-- cykl życia (adresy, godziny, progi, stan alertu) i własny rodzaj danych:
-- DOKŁADNE współrzędne domu i pracy. Obecne user_settings.home_lat/lon są
-- celowo obcięte do ~1 km (pogoda nie potrzebuje więcej), a trasy nie da
-- się wyznaczyć z dokładnością kilometra — więc dokładny adres żyje tu,
-- a pogodę zostawiamy w spokoju.
--
-- GODZINY TO MINUTY OD PÓŁNOCY (czas warszawski): 06:00 = 360. Liczba
-- zamiast TIME, bo job liczy z nich przedziały i nie ma po co parsować.
-- Dojazd dotyczy dni roboczych (pn–pt) — weekendy pomijamy w kodzie.
-- =========================================================================

ALTER TABLE public.user_secrets ADD COLUMN IF NOT EXISTS tomtom_api_key TEXT;

CREATE TABLE IF NOT EXISTS public.commute_settings (
  owner_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  home_lat        NUMERIC(9, 6),
  home_lon        NUMERIC(9, 6),
  home_label      TEXT,
  work_lat        NUMERIC(9, 6),
  work_lon        NUMERIC(9, 6),
  work_label      TEXT,

  -- Planowany wyjazd z domu / z pracy (minuty od północy, czas PL).
  depart_to_min   INT NOT NULL DEFAULT 360,   -- 06:00
  depart_back_min INT NOT NULL DEFAULT 890,   -- 14:50
  -- Na którą trzeba być w pracy; NULL = nie podano (brak linii „wyjdź o…").
  arrive_by_min   INT,

  -- Alert push, gdy dojazd jest dłuższy od typowego o co najmniej tyle minut.
  alert_enabled   BOOLEAN NOT NULL DEFAULT true,
  alert_delay_min INT NOT NULL DEFAULT 10,
  -- {"day":"2026-11-10","to":true,"back":false} — żeby jeden korek nie
  -- budził telefonu co kwadrans. Zapisuje job alertów.
  alert_state     JSONB NOT NULL DEFAULT '{}'::jsonb,

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commute_settings_ranges') THEN
    ALTER TABLE public.commute_settings ADD CONSTRAINT commute_settings_ranges CHECK (
      (home_lat IS NULL OR home_lat BETWEEN -90 AND 90)
      AND (work_lat IS NULL OR work_lat BETWEEN -90 AND 90)
      AND (home_lon IS NULL OR home_lon BETWEEN -180 AND 180)
      AND (work_lon IS NULL OR work_lon BETWEEN -180 AND 180)
      AND depart_to_min BETWEEN 0 AND 1439
      AND depart_back_min BETWEEN 0 AND 1439
      AND (arrive_by_min IS NULL OR arrive_by_min BETWEEN 0 AND 1439)
      AND alert_delay_min BETWEEN 1 AND 120
    );
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.commute_settings TO authenticated;
GRANT ALL ON public.commute_settings TO service_role;
ALTER TABLE public.commute_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Commute settings: owner manages" ON public.commute_settings;
CREATE POLICY "Commute settings: owner manages" ON public.commute_settings
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
