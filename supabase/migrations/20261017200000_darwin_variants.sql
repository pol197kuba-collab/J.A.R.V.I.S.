-- =========================================================================
-- DARWIN (PLAN.md, S2.1) — warianty promptów agentów.
--
-- agent_variants: wersje promptu jednego agenta (agent_slug — także
-- pseudo-agenta „typer”, który nie jest wierszem w `agents`). Statusy:
--   candidate — nowy, jeszcze bez ruchu na żywo (tylko arena, S2.2),
--   active    — pretendent: dostaje część ruchu na żywo,
--   champion  — główna wersja, większość ruchu (najwyżej jeden na agenta),
--   retired   — wycofany, zostaje dla historii i drzewa genealogicznego.
-- Sekcje zablokowane ([[LOCK nazwa]] … [[/LOCK]]) pilnuje kod
-- (src/lib/darwin/prompt.ts) — tu tylko limit długości.
--
-- variant_scores: oceny wariantu w skali 0..1 z podaniem, kto ocenił
-- (outcome = rozliczona prognoza, arena, human = 👍/👎, judge = model-
-- sędzia, cost = kara za koszt/czas). Zapisy oceny przychodzą w S2.2;
-- losowanie (Thompson sampling) czyta je przez agent_variant_stats().
--
-- agent_runs.variant_id / market_predictions.variant_id: który wariant
-- wykonał bieg / prognozę. NULL = przed Darwinem albo agent bez wariantów.
-- =========================================================================

-- ---------- 1. agent_variants ----------

CREATE TABLE IF NOT EXISTS public.agent_variants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_slug    TEXT NOT NULL CHECK (agent_slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  generation    INT NOT NULL DEFAULT 0 CHECK (generation >= 0),
  parent_ids    UUID[] NOT NULL DEFAULT '{}',
  prompt        TEXT NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 20000),
  mutation_note TEXT CHECK (mutation_note IS NULL OR char_length(mutation_note) <= 2000),
  status        TEXT NOT NULL DEFAULT 'candidate'
                CHECK (status IN ('candidate', 'active', 'champion', 'retired')),
  promoted_at   TIMESTAMPTZ,
  retired_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Najwyżej jeden champion na agenta — awans to zamiana w jednej transakcji.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_variants_champion
  ON public.agent_variants (owner_id, agent_slug)
  WHERE status = 'champion';

CREATE INDEX IF NOT EXISTS idx_agent_variants_live
  ON public.agent_variants (owner_id, agent_slug, status);

DROP TRIGGER IF EXISTS trg_agent_variants_updated_at ON public.agent_variants;
CREATE TRIGGER trg_agent_variants_updated_at
  BEFORE UPDATE ON public.agent_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_variants TO authenticated;
GRANT ALL ON public.agent_variants TO service_role;
ALTER TABLE public.agent_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agent variants: owner manages" ON public.agent_variants;
CREATE POLICY "Agent variants: owner manages"
  ON public.agent_variants FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ---------- 2. variant_scores ----------

CREATE TABLE IF NOT EXISTS public.variant_scores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant_id    UUID NOT NULL REFERENCES public.agent_variants(id) ON DELETE CASCADE,
  run_id        UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  prediction_id UUID REFERENCES public.market_predictions(id) ON DELETE SET NULL,
  score         NUMERIC(6, 4) NOT NULL CHECK (score >= 0 AND score <= 1),
  scorer        TEXT NOT NULL CHECK (scorer IN ('outcome', 'arena', 'human', 'judge', 'cost')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ta sama prognoza / ten sam bieg oceniany przez tego samego oceniającego
-- tylko raz — ponowne rozliczenie nie podwaja wyniku.
CREATE UNIQUE INDEX IF NOT EXISTS uq_variant_scores_prediction
  ON public.variant_scores (variant_id, prediction_id, scorer)
  WHERE prediction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_variant_scores_run
  ON public.variant_scores (variant_id, run_id, scorer)
  WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_variant_scores_variant
  ON public.variant_scores (variant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.variant_scores TO authenticated;
GRANT ALL ON public.variant_scores TO service_role;
ALTER TABLE public.variant_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Variant scores: owner manages" ON public.variant_scores;
CREATE POLICY "Variant scores: owner manages"
  ON public.variant_scores FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ---------- 3. który wariant wykonał bieg / prognozę ----------

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.agent_variants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_variant
  ON public.agent_runs (variant_id) WHERE variant_id IS NOT NULL;

ALTER TABLE public.market_predictions
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.agent_variants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_market_predictions_variant
  ON public.market_predictions (variant_id) WHERE variant_id IS NOT NULL;

-- ---------- 4. statystyki do losowania ----------

-- Liczba ocen i ich suma per wariant (rozkład Beta w Thompson sampling).
-- SECURITY INVOKER: zalogowany widzi przez RLS tylko swoje; nocny skrypt
-- (service_role) filtruje po p_owner.
CREATE OR REPLACE FUNCTION public.agent_variant_stats(p_owner UUID, p_slug TEXT)
RETURNS TABLE (variant_id UUID, n BIGINT, total NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT s.variant_id, count(*)::bigint, coalesce(sum(s.score), 0)
  FROM public.variant_scores s
  JOIN public.agent_variants v ON v.id = s.variant_id
  WHERE v.owner_id = p_owner AND v.agent_slug = p_slug
  GROUP BY s.variant_id
$$;

REVOKE ALL ON FUNCTION public.agent_variant_stats(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_variant_stats(UUID, TEXT) TO authenticated, service_role;
