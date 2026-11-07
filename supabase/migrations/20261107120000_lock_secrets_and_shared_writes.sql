-- =========================================================================
-- Zamknięcie sekretów i zapisu do wspólnych tabel cache.
--
-- !!! KOLEJNOŚĆ WDROŻENIA (inaczej aplikacja przestanie czytać klucze) !!!
--   1. W Lovable ustaw sekret JARVIS_SUPABASE_SERVICE_ROLE_KEY
--      (Supabase → Settings → API → service_role).
--   2. Opublikuj wersję aplikacji z tym commitem (serwer czyta klucze przez
--      src/lib/system/userSecrets.ts, a cache zapisuje przez service_role).
--   3. Dopiero potem wpuść tę migrację (merge do main uruchamia ją sam
--      workflow „DB Migrations").
-- Nowy kod działa jeszcze przed migracją (service_role, gdy jest), stary kod
-- po migracji nie — stąd taka kolejność.
--
-- 1) user_secrets — klucze API (Gemini, Anthropic, Groq, Google CSE), token
--    GitHub i prywatny klucz VAPID.
--    Dotąd rola `authenticated` miała pełny dostęp do własnego wiersza, więc
--    każdy kod w przeglądarce (np. po ewentualnym XSS) mógł pobrać surowe
--    klucze. Teraz przeglądarka nie ma do tabeli żadnego dostępu; czyta ją
--    tylko serwer kluczem service_role, a funkcje SECURITY DEFINER (wysyłka
--    briefów, pg_cron) działają z uprawnieniami właściciela i tego nie
--    dotyka.
--    Politykę „owner manages" usuwamy, żeby ewentualny przyszły GRANT nie
--    otworzył tabeli po cichu: RLS włączone + zero polityk = domyślny zakaz.
--
-- 2) Wspólne tabele cache (ceny paliw, szeregi Orlenu, newsy paliw, notowania
--    i newsy rynków). Migracja 20260920140000 pozwoliła pisać do nich każdemu
--    zalogowanemu, bo klucz service_role był wtedy poza zasięgiem właściciela.
--    Teraz jest dostępny, więc zapis wraca do service_role (aplikacja: serwer,
--    dane: nocne joby). Odczyt dla zalogowanych zostaje bez zmian.
-- =========================================================================

-- ---------- 1. user_secrets ----------

REVOKE ALL ON public.user_secrets FROM PUBLIC;
REVOKE ALL ON public.user_secrets FROM anon;
REVOKE ALL ON public.user_secrets FROM authenticated;
GRANT ALL ON public.user_secrets TO service_role;

ALTER TABLE public.user_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "UserSecrets: owner manages" ON public.user_secrets;

-- ---------- 2. wspólne tabele cache: koniec zapisu dla zalogowanych ----------

REVOKE INSERT, UPDATE, DELETE ON public.orlen_fuel_prices FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.orlen_market_series FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fuel_news_items FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.market_quotes FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.market_news_items FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Fuel prices: signed-in users refresh cache" ON public.orlen_fuel_prices;
DROP POLICY IF EXISTS "Fuel prices: signed-in users correct cache" ON public.orlen_fuel_prices;
DROP POLICY IF EXISTS "Market series: signed-in users refresh cache" ON public.orlen_market_series;
DROP POLICY IF EXISTS "Market series: signed-in users correct cache" ON public.orlen_market_series;
DROP POLICY IF EXISTS "Fuel news: signed-in users refresh cache" ON public.fuel_news_items;
DROP POLICY IF EXISTS "Fuel news: signed-in users correct cache" ON public.fuel_news_items;
DROP POLICY IF EXISTS "Market quotes: signed-in users refresh cache" ON public.market_quotes;
DROP POLICY IF EXISTS "Market quotes: signed-in users correct cache" ON public.market_quotes;
DROP POLICY IF EXISTS "Market news: signed-in users refresh cache" ON public.market_news_items;
DROP POLICY IF EXISTS "Market news: signed-in users correct cache" ON public.market_news_items;

-- service_role zachowuje pełny dostęp (idempotentnie, na wypadek ręcznych zmian).
GRANT ALL ON public.orlen_fuel_prices TO service_role;
GRANT ALL ON public.orlen_market_series TO service_role;
GRANT ALL ON public.fuel_news_items TO service_role;
GRANT ALL ON public.market_quotes TO service_role;
GRANT ALL ON public.market_news_items TO service_role;
