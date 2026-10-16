-- =========================================================================
-- Etap 0 (PLAN.md): harmonogram i HTTP po stronie bazy.
--
-- pg_cron — zadania o stałych porach uruchamiane przez samą bazę (np.
--           przeliczenie Mózgu 3D nocą, ewolucja Darwina), zamiast crona
--           w GitHub Actions, którego nie da się ustawić per użytkownik.
-- pg_net  — asynchroniczne żądania HTTP z SQL, czyli sposób, w jaki zadanie
--           pg_cron albo trigger woła funkcję serwerową / Edge Function.
--
-- Sama migracja niczego jeszcze nie harmonogramuje — pierwsze zadania
-- przyjdą z modułami, które ich potrzebują. Składnia wg dokumentacji
-- Supabase (pg_cron w pg_catalog, pg_net w extensions).
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
