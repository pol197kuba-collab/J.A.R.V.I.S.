-- =========================================================================
-- KSIĘGA ZUŻYCIA MODELI (plan naprawczy, etap 2: A3, A11, A12, A20).
--
-- Do tej pory koszt znał tylko czat (agent_runs.cost_usd). Prognozy rynków,
-- briefing, Vision, Mózg, embeddingi i klasyfikator płaciły „po cichu", więc
-- budżet miesięczny pokazywał tylko część rachunku. Od teraz KAŻDE wywołanie
-- modelu zostawia tu jeden wiersz: kto, jaki moduł, po co, jaki dostawca
-- i model, ile tokenów (z tokenami myślenia i cache osobno) i ile to kosztuje
-- po cenniku z dnia wywołania. NULL w cost_usd = model spoza cennika, nie zero.
--
-- market_model_usage zostaje bez zmian: dalej pilnuje dziennego limitu
-- tokenów rynków. Moduł rynków pisze RÓWNOLEGLE do obu tabel.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.llm_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Moduł aplikacji (agents, markets, brief, vision, brain, fuel, documents…)
  module          TEXT NOT NULL,
  -- Cel wywołania w module (turn, classifier, forecast, embed…)
  purpose         TEXT NOT NULL,
  provider        TEXT NOT NULL CHECK (provider IN ('gemini', 'anthropic', 'groq')),
  model           TEXT NOT NULL,
  tokens_input    INTEGER NOT NULL DEFAULT 0 CHECK (tokens_input >= 0),
  tokens_output   INTEGER NOT NULL DEFAULT 0 CHECK (tokens_output >= 0),
  tokens_thinking INTEGER NOT NULL DEFAULT 0 CHECK (tokens_thinking >= 0),
  cache_read      INTEGER NOT NULL DEFAULT 0 CHECK (cache_read >= 0),
  cache_write     INTEGER NOT NULL DEFAULT 0 CHECK (cache_write >= 0),
  cost_usd        NUMERIC(12, 6),
  -- Dostawca nie podał zużycia (np. embeddingi) — tokeny oszacowane z długości tekstu.
  estimated       BOOLEAN NOT NULL DEFAULT false,
  run_id          UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_owner_created
  ON public.llm_usage (owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_run
  ON public.llm_usage (run_id) WHERE run_id IS NOT NULL;

GRANT SELECT, INSERT ON public.llm_usage TO authenticated;
GRANT ALL ON public.llm_usage TO service_role;

ALTER TABLE public.llm_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "LLM usage: owner reads" ON public.llm_usage;
CREATE POLICY "LLM usage: owner reads"
  ON public.llm_usage FOR SELECT TO authenticated
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "LLM usage: owner writes" ON public.llm_usage;
CREATE POLICY "LLM usage: owner writes"
  ON public.llm_usage FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- -------------------------------------------------------------------------
-- Wydatki od `p_since`, zsumowane PO STRONIE BAZY (A12: wcześniej kod
-- ściągał wszystkie wiersze, a PostgREST oddaje najwyżej 1000).
--
-- PRZEJŚCIE: księga zaczyna się w połowie miesiąca. Żeby budżet nie spadł do
-- zera w dniu wdrożenia, doliczamy koszty czatu z agent_runs sprzed PIERWSZEGO
-- wpisu w księdze (moduł 'agents (przed księgą)'). Od miesiąca, w którym
-- księga istnieje od pierwszego dnia, ta część jest pusta.
--
-- SECURITY INVOKER: przy kliencie użytkownika i tak działa RLS; skrypty
-- z service role podają owner jawnie.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.llm_spend_by_module(p_owner UUID, p_since TIMESTAMPTZ)
RETURNS TABLE (
  module TEXT, model TEXT, cost_usd NUMERIC, calls BIGINT, unpriced BIGINT, today_usd NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ledger_start AS (
    SELECT min(created_at) AS at FROM public.llm_usage WHERE owner_id = p_owner
  ),
  rows AS (
    SELECT u.module, u.model, u.cost_usd, u.created_at
      FROM public.llm_usage u
     WHERE u.owner_id = p_owner AND u.created_at >= p_since
    UNION ALL
    SELECT 'agents (przed księgą)', coalesce(r.model, '—'), r.cost_usd, r.created_at
      FROM public.agent_runs r, ledger_start s
     WHERE r.user_id = p_owner
       AND r.created_at >= p_since
       AND r.created_at < coalesce(s.at, 'infinity'::timestamptz)
  )
  SELECT module,
         model,
         coalesce(sum(cost_usd), 0)                                   AS cost_usd,
         count(*)                                                     AS calls,
         count(*) FILTER (WHERE cost_usd IS NULL)                     AS unpriced,
         coalesce(sum(cost_usd) FILTER (
           WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
         ), 0)                                                        AS today_usd
    FROM rows
   GROUP BY module, model
$$;

GRANT EXECUTE ON FUNCTION public.llm_spend_by_module(UUID, TIMESTAMPTZ) TO authenticated, service_role;
