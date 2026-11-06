-- =========================================================================
-- FUNDUSZ — ustawienia gry (src/lib/fund/settings.ts).
--
-- Jeden wiersz na właściciela: dzień startu, pokrętła wspólne i nadpisania
-- dla graczy AI, częstotliwość przebiegu „na żywo”. JSON, bo kształt
-- pilnuje parseFundSettings (braki = wartości domyślne). Zmiana ustawień
-- uruchamia przeliczenie funduszu od dnia startu — tabele funduszu są
-- wynikiem, nie stanem.
-- Bez wiersza obowiązują ustawienia domyślne (start 31.10.2026).
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.fund_settings (
  owner_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fund_settings TO authenticated;
GRANT ALL ON public.fund_settings TO service_role;
ALTER TABLE public.fund_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Fund settings: owner manages" ON public.fund_settings;
CREATE POLICY "Fund settings: owner manages" ON public.fund_settings
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
