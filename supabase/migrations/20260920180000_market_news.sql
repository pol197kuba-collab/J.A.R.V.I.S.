-- =========================================================================
-- MARKET GRID — newsy i ocena ich wpływu na obserwowane instrumenty.
-- Etap 2 modułu /rynki.
--
-- Układ jak w fuel_news_items (20260920090000): tabela współdzielona, bo
-- nagłówki prasowe są identyczne dla każdego konta; odczyt dla każdego
-- zalogowanego, zapis również (powód w
-- 20260920140000_fuel_grid_authenticated_writes.sql — service_role jest w
-- tej instalacji poza zasięgiem właściciela).
--
-- RÓŻNICA WOBEC MODUŁU PALIW: tam kierunek był jeden, bo instrument był
-- jeden. Tutaj ten sam nagłówek bywa bullish dla złota i bearish dla akcji,
-- więc wiersz niesie `symbols` — listę instrumentów, których dotyczy.
-- Pusta tablica znaczy „news ogólnorynkowy", a nie „nieprzypisany".
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.market_news_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Klucz deduplikacji: <guid> z RSS, a gdy go brak — link.
  guid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  source TEXT,
  published_at TIMESTAMPTZ,
  -- Etykieta kanału, z którego przyszedł news ('macro', 'crypto', 'gpw'...).
  feed_tag TEXT,
  -- Symbole z katalogu (src/lib/markets/assets.ts), których news dotyczy.
  symbols TEXT[] NOT NULL DEFAULT '{}',
  -- 'bullish' | 'bearish' | 'neutral' — ZAWSZE względem instrumentów z
  -- `symbols`, nigdy jako globalny nastrój rynku.
  impact TEXT,
  impact_score INTEGER,
  summary_pl TEXT,
  -- 'ai' | 'heuristic' — skąd wzięła się ocena. Bez tego nie da się
  -- odróżnić oceny modelu od słownikowej zgadywanki.
  classified_by TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT market_news_impact_allowed
    CHECK (impact IS NULL OR impact IN ('bullish', 'bearish', 'neutral')),
  CONSTRAINT market_news_score_range
    CHECK (impact_score IS NULL OR (impact_score >= 0 AND impact_score <= 100))
);

GRANT SELECT, INSERT, UPDATE ON public.market_news_items TO authenticated;
GRANT ALL ON public.market_news_items TO service_role;
ALTER TABLE public.market_news_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Market news: any signed-in user reads" ON public.market_news_items;
CREATE POLICY "Market news: any signed-in user reads" ON public.market_news_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Market news: signed-in users refresh cache" ON public.market_news_items;
CREATE POLICY "Market news: signed-in users refresh cache" ON public.market_news_items
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Market news: signed-in users correct cache" ON public.market_news_items;
CREATE POLICY "Market news: signed-in users correct cache" ON public.market_news_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_market_news_published
  ON public.market_news_items(published_at DESC);

-- Filtrowanie „newsy dla tego instrumentu" idzie po zawieraniu w tablicy,
-- więc indeks GIN, nie B-tree.
CREATE INDEX IF NOT EXISTS idx_market_news_symbols
  ON public.market_news_items USING GIN (symbols);
