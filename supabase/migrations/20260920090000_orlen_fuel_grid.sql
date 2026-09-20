-- =========================================================================
-- ORLEN FUEL GRID — cache hurtowych cen paliw + kontekst rynkowy + newsy.
--
-- Źródłem jest publiczne API Orlenu (tool.orlen.pl/api/wholesalefuelprices),
-- które nie wystawia nagłówka Access-Control-Allow-Origin — przeglądarka nie
-- może go odpytać, więc pobieranie idzie przez server function (Nitro) albo
-- przez nocny job GitHub Actions, a wynik ląduje tutaj.
--
-- ŚWIADOME ODSTĘPSTWO OD KONWENCJI owner_id: ceny hurtowe, notowania Brent,
-- kurs USD/PLN i nagłówki prasowe to dane publiczne i identyczne dla każdego
-- konta. Trzymanie kopii ~26 tys. wierszy cen per użytkownik nie miałoby
-- sensu, więc trzy pierwsze tabele są współdzielone: odczyt dla każdego
-- zalogowanego, zapis WYŁĄCZNIE przez service_role (supabaseAdmin / job),
-- bo nie ma dla authenticated żadnej polityki INSERT/UPDATE/DELETE.
-- Per-użytkownikowe są tylko progi alertów — i te mają klasyczne owner_id.
-- =========================================================================

-- ---------- 1. Ceny hurtowe Orlen ----------
CREATE TABLE public.orlen_fuel_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- productId z API Orlenu: 41 Pb95, 42 Pb98, 43 ON Ekodiesel,
  -- 44 ON Arktyczny 2, 46 Ekoterm. Trzymane jako int (nie enum), żeby
  -- dołożenie produktu nie wymagało migracji — słownik żyje w
  -- src/lib/fuel/orlen.ts (ORLEN_PRODUCTS).
  product_id INTEGER NOT NULL,
  product_code TEXT NOT NULL,
  price_date DATE NOT NULL,
  -- PLN za 1 m³ (1000 l) netto — dokładnie to, co zwraca API w polu `value`,
  -- bez przeliczeń.
  price_per_m3 NUMERIC(10, 2) NOT NULL,
  -- true = dzień bez publikacji cennika (weekend/święto), cena przeniesiona
  -- z ostatniego dnia notowanego. Ta sama semantyka co is_auto_filled
  -- w aplikacji opłaty paliwowej — wykresy rysują ciągłą linię, a statystyki
  -- „ile razy cena realnie się zmieniła” mogą te dni pominąć.
  is_gap_fill BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'Orlen API',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orlen_fuel_prices_unique_day UNIQUE (product_id, price_date)
);

GRANT SELECT ON public.orlen_fuel_prices TO authenticated;
GRANT ALL ON public.orlen_fuel_prices TO service_role;
ALTER TABLE public.orlen_fuel_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fuel prices: any signed-in user reads" ON public.orlen_fuel_prices
  FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_orlen_fuel_prices_product_date
  ON public.orlen_fuel_prices(product_id, price_date DESC);

CREATE TRIGGER trg_orlen_fuel_prices_updated_at BEFORE UPDATE ON public.orlen_fuel_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 2. Kontekst rynkowy (Brent, USD/PLN) ----------
CREATE TABLE public.orlen_market_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'BRENT_USD' (USD za baryłkę, Yahoo Finance BZ=F) |
  -- 'USDPLN' (średni kurs NBP, tabela A)
  symbol TEXT NOT NULL,
  series_date DATE NOT NULL,
  value NUMERIC(14, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orlen_market_series_unique_point UNIQUE (symbol, series_date)
);

GRANT SELECT ON public.orlen_market_series TO authenticated;
GRANT ALL ON public.orlen_market_series TO service_role;
ALTER TABLE public.orlen_market_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Market series: any signed-in user reads" ON public.orlen_market_series
  FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_orlen_market_series_symbol_date
  ON public.orlen_market_series(symbol, series_date DESC);

CREATE TRIGGER trg_orlen_market_series_updated_at BEFORE UPDATE ON public.orlen_market_series
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 3. Newsy wpływające na ceny paliw ----------
CREATE TABLE public.fuel_news_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Klucz deduplikacji: <guid> z RSS, a gdy go brak — znormalizowany link.
  guid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  source TEXT,
  published_at TIMESTAMPTZ,
  -- Etykieta zapytania/kanału, z którego przyszedł news (np. 'opec', 'pl').
  feed_tag TEXT,
  -- 'bullish' (w górę) | 'bearish' (w dół) | 'neutral'
  impact TEXT,
  -- 0-100: jak mocno news może ruszyć cenę wg oceniającego.
  impact_score INTEGER,
  summary_pl TEXT,
  -- 'gemini' | 'heuristic' — skąd wzięła się ocena wpływu.
  classified_by TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fuel_news_items_impact_allowed
    CHECK (impact IS NULL OR impact IN ('bullish', 'bearish', 'neutral')),
  CONSTRAINT fuel_news_items_score_range
    CHECK (impact_score IS NULL OR (impact_score >= 0 AND impact_score <= 100))
);

GRANT SELECT ON public.fuel_news_items TO authenticated;
GRANT ALL ON public.fuel_news_items TO service_role;
ALTER TABLE public.fuel_news_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fuel news: any signed-in user reads" ON public.fuel_news_items
  FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_fuel_news_items_published ON public.fuel_news_items(published_at DESC);

-- ---------- 4. Progi alertów (per użytkownik) ----------
CREATE TABLE public.fuel_price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  -- 'daily_change_abs' — |zmiana dzienna| >= threshold (PLN/m³)
  -- 'level_above'      — cena >= threshold
  -- 'level_below'      — cena <= threshold
  kind TEXT NOT NULL,
  threshold NUMERIC(10, 2) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Anty-spam: nocny job odpala alert najwyżej raz na dobę na próg.
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fuel_price_alerts_kind_allowed
    CHECK (kind IN ('daily_change_abs', 'level_above', 'level_below')),
  CONSTRAINT fuel_price_alerts_unique_rule UNIQUE (owner_id, product_id, kind)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_price_alerts TO authenticated;
GRANT ALL ON public.fuel_price_alerts TO service_role;
ALTER TABLE public.fuel_price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fuel alerts: owner manages" ON public.fuel_price_alerts
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE INDEX idx_fuel_price_alerts_owner ON public.fuel_price_alerts(owner_id, is_enabled);

CREATE TRIGGER trg_fuel_price_alerts_updated_at BEFORE UPDATE ON public.fuel_price_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
