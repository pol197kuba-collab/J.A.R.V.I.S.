-- =========================================================================
-- MARKET GRID — cache notowań akcji, krypto, surowców, indeksów i walut
-- plus watchlista użytkownika. Etap 1 modułu /rynki.
--
-- Źródła są publiczne i bez CORS (CoinGecko, Stooq, Yahoo Finance,
-- Frankfurter), więc pobieranie idzie przez server function, a wynik ląduje
-- tutaj — dokładnie ten sam układ co ORLEN FUEL GRID
-- (20260920090000_orlen_fuel_grid.sql).
--
-- ŚWIADOME ODSTĘPSTWO OD KONWENCJI owner_id, identyczne jak w module paliw:
-- notowania to dane publiczne i identyczne dla każdego konta, więc
-- market_quotes jest współdzielone. Prywatna jest tylko watchlista — i ta
-- ma klasyczne owner_id z polityką właściciela.
--
-- Zapis do cache'u dostają zalogowani użytkownicy (nie tylko service_role) z
-- powodu opisanego w 20260920140000_fuel_grid_authenticated_writes.sql:
-- ta instalacja jest zarządzana przez Lovable i klucz service_role jest poza
-- zasięgiem właściciela, więc inaczej nic nie miałoby prawa zapełnić
-- cache'u. Ten sam kompromis i ta sama ścieżka wyjścia: przy większej
-- liczbie kont zawęzić te polityki do administratora.
-- =========================================================================

-- ---------- 1. Cache notowań (współdzielony) ----------
CREATE TABLE IF NOT EXISTS public.market_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nasz kanoniczny symbol z src/lib/markets/assets.ts (np. 'BTC',
  -- 'CDR.PL', 'XAUUSD'), nigdy identyfikator zewnętrznego API — dzięki temu
  -- zmiana dostawcy nie unieważnia zgromadzonej historii.
  symbol TEXT NOT NULL,
  quote_date DATE NOT NULL,
  close NUMERIC(20, 8) NOT NULL,
  -- Waluta notowania, kopiowana ze słownika w kodzie. Trzymana przy wierszu,
  -- żeby dane historyczne pozostały czytelne, gdyby słownik kiedyś zmienił
  -- walutę instrumentu.
  currency TEXT NOT NULL,
  -- Który dostawca faktycznie oddał ten punkt: 'stooq' | 'yahoo' |
  -- 'coingecko' | 'frankfurter'. Diagnostyka — przy zawodnych darmowych
  -- źródłach to pierwsza rzecz, o którą się pyta, gdy wykres wygląda dziwnie.
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT market_quotes_unique_day UNIQUE (symbol, quote_date)
);

GRANT SELECT, INSERT, UPDATE ON public.market_quotes TO authenticated;
GRANT ALL ON public.market_quotes TO service_role;
ALTER TABLE public.market_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Market quotes: any signed-in user reads" ON public.market_quotes;
CREATE POLICY "Market quotes: any signed-in user reads" ON public.market_quotes
  FOR SELECT TO authenticated USING (true);

-- Upsert wymaga OBU polityk: INSERT dla nowych dni i UPDATE dla korekty
-- punktu już zapisanego (ostatnia sesja dnia potrafi się jeszcze zmienić).
DROP POLICY IF EXISTS "Market quotes: signed-in users refresh cache" ON public.market_quotes;
CREATE POLICY "Market quotes: signed-in users refresh cache" ON public.market_quotes
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Market quotes: signed-in users correct cache" ON public.market_quotes;
CREATE POLICY "Market quotes: signed-in users correct cache" ON public.market_quotes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_market_quotes_symbol_date
  ON public.market_quotes(symbol, quote_date DESC);

DROP TRIGGER IF EXISTS trg_market_quotes_updated_at ON public.market_quotes;
CREATE TRIGGER trg_market_quotes_updated_at BEFORE UPDATE ON public.market_quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 2. Watchlista (per użytkownik) ----------
CREATE TABLE IF NOT EXISTS public.market_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  -- Kolejność na liście. Nowa pozycja ląduje na końcu (max+1), więc zmiana
  -- kolejności nie wymaga przepisywania całej tabeli.
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT market_watchlist_unique_symbol UNIQUE (owner_id, symbol)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_watchlist TO authenticated;
GRANT ALL ON public.market_watchlist TO service_role;
ALTER TABLE public.market_watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Market watchlist: owner manages" ON public.market_watchlist;
CREATE POLICY "Market watchlist: owner manages" ON public.market_watchlist
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_market_watchlist_owner
  ON public.market_watchlist(owner_id, position);

DROP TRIGGER IF EXISTS trg_market_watchlist_updated_at ON public.market_watchlist;
CREATE TRIGGER trg_market_watchlist_updated_at BEFORE UPDATE ON public.market_watchlist
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
