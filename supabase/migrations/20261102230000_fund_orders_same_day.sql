-- =========================================================================
-- FUNDUSZ — realizacja tego samego dnia co prognoza.
--
-- Granie na żywo (20261102090000_market_live.sql) realizuje prognozę po
-- pierwszej cenie z ciągu dnia PO chwili jej postawienia — często tego
-- samego dnia. Pierwotne ograniczenie executed_on > signal_on (z czasów
-- realizacji wyłącznie po kolejnym zamknięciu) odrzucało takie wiersze i
-- zapis funduszu się wywracał. Uczciwość (brak zaglądania w przyszłość)
-- pilnuje silnik po CZASIE (market_live_events.at > made_at), nie po dacie.
-- =========================================================================

ALTER TABLE public.fund_orders DROP CONSTRAINT IF EXISTS fund_orders_check;
ALTER TABLE public.fund_orders DROP CONSTRAINT IF EXISTS fund_orders_executed_after_signal;
ALTER TABLE public.fund_orders
  ADD CONSTRAINT fund_orders_executed_after_signal CHECK (executed_on >= signal_on);
