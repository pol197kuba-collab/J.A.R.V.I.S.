-- =========================================================================
-- FUNDUSZ J.A.R.V.I.S. (PLAN.md, S3.1) — portfele na papierze.
--
-- Każdy gracz (źródło prognoz signals/ai/ai_learned, koszyk „kup i trzymaj
-- wszystko”, małpa z rzutkami) ma jeden portfel: start 100 000 PLN.
-- Silnik (src/lib/fund) liczy CAŁĄ historię od nowa przy każdym przebiegu
-- i podmienia wiersze właściciela — tabele są wynikiem, nie stanem, który
-- trzeba ostrożnie przesuwać dzień po dniu.
--
-- Tylko papier: żadnego brokera, żadnych prawdziwych pieniędzy.
-- =========================================================================

-- ---------- 1. portfele (gracze) ----------

CREATE TABLE IF NOT EXISTS public.fund_portfolios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player         TEXT NOT NULL CHECK (player ~ '^[a-z][a-z0-9_]{1,40}$'),
  label          TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('source', 'benchmark', 'monkey')),
  start_cash_pln NUMERIC(14, 2) NOT NULL DEFAULT 100000,
  started_on     DATE,
  -- Ostatnie metryki (zwrot, obsunięcie, Sharpe, obrót, liczba transakcji,
  -- prowizje) — ranking bez przeliczania historii w przeglądarce.
  metrics        JSONB NOT NULL DEFAULT '{}'::jsonb,
  cash_pln       NUMERIC(14, 2) NOT NULL DEFAULT 100000,
  computed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, player)
);

-- ---------- 2. zlecenia (zrealizowane transakcje) ----------

CREATE TABLE IF NOT EXISTS public.fund_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id  UUID NOT NULL REFERENCES public.fund_portfolios(id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  units         NUMERIC(24, 10) NOT NULL CHECK (units > 0),
  price         NUMERIC(20, 8) NOT NULL CHECK (price > 0),
  fx_rate       NUMERIC(14, 6) NOT NULL CHECK (fx_rate > 0),
  notional_pln  NUMERIC(14, 2) NOT NULL,
  fee_pln       NUMERIC(14, 2) NOT NULL,
  realized_pln  NUMERIC(14, 2),
  signal_on     DATE NOT NULL,
  executed_on   DATE NOT NULL CHECK (executed_on > signal_on),
  prediction_id UUID REFERENCES public.market_predictions(id) ON DELETE SET NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('up', 'down', 'flat')),
  confidence    SMALLINT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  -- Powód = uzasadnienie prognozy, która wywołała transakcję.
  reason        TEXT
);

CREATE INDEX IF NOT EXISTS idx_fund_orders_portfolio
  ON public.fund_orders (portfolio_id, executed_on DESC);

-- ---------- 3. pozycje (stan na ostatni dzień) ----------

CREATE TABLE IF NOT EXISTS public.fund_positions (
  owner_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES public.fund_portfolios(id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  units        NUMERIC(24, 10) NOT NULL,
  cost_pln     NUMERIC(14, 2) NOT NULL,
  value_pln    NUMERIC(14, 2) NOT NULL,
  as_of        DATE NOT NULL,
  PRIMARY KEY (portfolio_id, symbol)
);

-- ---------- 4. dzienna wycena (krzywa kapitału) ----------

CREATE TABLE IF NOT EXISTS public.fund_nav_daily (
  owner_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES public.fund_portfolios(id) ON DELETE CASCADE,
  nav_date     DATE NOT NULL,
  nav_pln      NUMERIC(14, 2) NOT NULL,
  cash_pln     NUMERIC(14, 2) NOT NULL,
  invested_pln NUMERIC(14, 2) NOT NULL,
  PRIMARY KEY (portfolio_id, nav_date)
);

-- ---------- 5. dostęp ----------

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.fund_portfolios, public.fund_orders, public.fund_positions, public.fund_nav_daily
  TO authenticated;
GRANT ALL ON
  public.fund_portfolios, public.fund_orders, public.fund_positions, public.fund_nav_daily
  TO service_role;

ALTER TABLE public.fund_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_nav_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Fund portfolios: owner manages" ON public.fund_portfolios;
CREATE POLICY "Fund portfolios: owner manages"
  ON public.fund_portfolios FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Fund orders: owner manages" ON public.fund_orders;
CREATE POLICY "Fund orders: owner manages"
  ON public.fund_orders FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Fund positions: owner manages" ON public.fund_positions;
CREATE POLICY "Fund positions: owner manages"
  ON public.fund_positions FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Fund NAV: owner manages" ON public.fund_nav_daily;
CREATE POLICY "Fund NAV: owner manages"
  ON public.fund_nav_daily FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
