-- Plan naprawczy, etap 8C. Zgoda właściciela w sesji 2026-11-13 na usunięcie
-- danych: tabele lokalnego workera i Dev Wing oraz kolumna przełącznika
-- czatu (czat zawsze idzie przez serwer od etapu 5).
--
-- Kod, który ich używał, zniknął w 8B (#246) i jest opublikowany w Lovable
-- (potwierdzenie właściciela 2026-11-13), więc żadna wersja aplikacji ich
-- już nie czyta. Bez CASCADE: gdyby coś jeszcze od nich zależało, migracja
-- ma się wywrócić, a nie po cichu zabrać zależny obiekt.
DROP TABLE IF EXISTS public.local_jobs;
DROP TABLE IF EXISTS public.dev_sessions;
ALTER TABLE public.user_settings DROP COLUMN IF EXISTS chat_routing;
