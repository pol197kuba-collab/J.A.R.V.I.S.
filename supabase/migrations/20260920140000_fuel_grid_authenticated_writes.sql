-- =========================================================================
-- Fuel Grid — zapis do tabel cache dla zalogowanych użytkowników.
--
-- Pierwotny projekt zakładał, że pisze wyłącznie service_role: aplikacja
-- albo nocny job. Okazało się, że ta instalacja jest zarządzana w całości
-- przez Lovable i klucz service_role jest poza zasięgiem właściciela —
-- nie ma go ani w panelu sekretów Lovable, ani nigdzie indziej, gdzie
-- użytkownik ma wgląd. Bez tej migracji moduł /paliwa mógłby tylko czytać
-- pusty cache, bo nic nie miałoby prawa go zapełnić.
--
-- Dlatego zapis dostają zalogowani użytkownicy. Serverowe funkcje modułu
-- (src/lib/fuel/fuel.functions.ts) używają wtedy `context.supabase` —
-- klienta zalogowanego jako bieżący użytkownik — dokładnie tak, jak
-- local-worker/worker.py loguje się kluczem anon zamiast service role.
--
-- ŚWIADOMY KOMPROMIS: każde zatwierdzone konto w tej instancji może
-- technicznie wpisać dowolną cenę do cache'u. To są dane publiczne,
-- odtwarzalne jednym przebiegiem z API Orlenu, a instancja jest
-- jednoosobowa — więc koszt tego ustępstwa jest niski, a alternatywą było
-- niedziałające narzędzie. Gdyby aplikacja kiedyś dostała więcej kont,
-- te trzy polityki należy zawęzić do roli administratora (`is_admin`)
-- albo wrócić do service_role.
--
-- `fuel_price_alerts` NIE jest tu ruszane — progi zostają prywatne,
-- ograniczone do właściciela przez politykę z migracji 20260920090000.
-- =========================================================================

GRANT INSERT, UPDATE ON public.orlen_fuel_prices TO authenticated;
GRANT INSERT, UPDATE ON public.orlen_market_series TO authenticated;
GRANT INSERT, UPDATE ON public.fuel_news_items TO authenticated;

-- Upsert wymaga OBU polityk: INSERT dla nowych dni i UPDATE dla korekt
-- ceny już zapisanej (Orlen potrafi poprawić opublikowany cennik wstecz).
--
-- Każda poprzedzona DROP ... IF EXISTS, bo migracje w tym projekcie wkleja
-- się ręcznie do SQL editora (patrz CODEX.md) — a wtedy jeden błąd składni
-- wycofuje całą transakcję i skrypt leci od nowa. Bez tego druga próba
-- wykładałaby się na „policy already exists" dla polityk, które zdążyły
-- powstać za pierwszym razem.
DROP POLICY IF EXISTS "Fuel prices: signed-in users refresh cache" ON public.orlen_fuel_prices;
CREATE POLICY "Fuel prices: signed-in users refresh cache" ON public.orlen_fuel_prices
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Fuel prices: signed-in users correct cache" ON public.orlen_fuel_prices;
CREATE POLICY "Fuel prices: signed-in users correct cache" ON public.orlen_fuel_prices
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Market series: signed-in users refresh cache" ON public.orlen_market_series;
CREATE POLICY "Market series: signed-in users refresh cache" ON public.orlen_market_series
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Market series: signed-in users correct cache" ON public.orlen_market_series;
CREATE POLICY "Market series: signed-in users correct cache" ON public.orlen_market_series
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Fuel news: signed-in users refresh cache" ON public.fuel_news_items;
CREATE POLICY "Fuel news: signed-in users refresh cache" ON public.fuel_news_items
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Fuel news: signed-in users correct cache" ON public.fuel_news_items;
CREATE POLICY "Fuel news: signed-in users correct cache" ON public.fuel_news_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
