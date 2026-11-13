-- =========================================================================
-- STARE WPISY PAMIĘCI → POCHODZENIE „user” (plan naprawczy, etap 6b, A2d).
--
-- Od etapu 6b wpis o pochodzeniu `unknown` zwrócony przez `recall` jest obcą
-- treścią: akcje `external` w tej turze czekają na potwierdzenie. Wszystkie
-- wpisy właściciela sprzed migracji 20261111120000 (10 wierszy, 2026-11-13)
-- mają `unknown`, więc potwierdzenia byłyby przy każdym przypomnieniu.
-- Właściciel zdecydował 2026-11-13 („oznacz”): stare wpisy to jego wpisy.
--
-- Zmienia tylko kolumnę `origin`, nic nie kasuje. Nowe wpisy dostają
-- pochodzenie przy zapisie (`user` / `tool`), więc `unknown` więcej nie
-- powstaje; powtórne uruchomienie nie zmienia nic.
-- =========================================================================

UPDATE public.memories
   SET origin = 'user'
 WHERE origin = 'unknown';
