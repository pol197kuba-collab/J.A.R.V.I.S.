-- =========================================================================
-- WYDATKI (PLAN.md, S4.2) — paragony z Vision jako wydatki.
--
-- Zatwierdzony skan paragonu („Zapisz” na ekranie potwierdzenia) od razu
-- tworzy wydatek: nagłówek (sklep, data, suma, waluta) i jego pozycje
-- z kategorią. Strona /wydatki liczy z tego sumy miesięczne i podział na
-- kategorie. scan_id wskazuje skan źródłowy (zdjęcie trzymane 30 dni);
-- usunięcie skanu nie usuwa wydatku.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.expenses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_id    UUID REFERENCES public.vision_scans(id) ON DELETE SET NULL,
  merchant   TEXT NOT NULL CHECK (length(merchant) BETWEEN 1 AND 120),
  spent_on   DATE NOT NULL,
  total      NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  currency   TEXT NOT NULL DEFAULT 'PLN' CHECK (currency ~ '^[A-Z]{3}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_owner_day
  ON public.expenses (owner_id, spent_on DESC);

CREATE TABLE IF NOT EXISTS public.expense_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  position   SMALLINT NOT NULL CHECK (position >= 0),
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  qty        NUMERIC(10, 3) NOT NULL CHECK (qty > 0),
  -- Wartość pozycji (rabat zapisany osobną linią jest ujemny).
  price      NUMERIC(12, 2) NOT NULL,
  -- Słownik w src/lib/vision/modes.ts (EXPENSE_CATEGORIES).
  category   TEXT NOT NULL CHECK (category IN
               ('zywnosc', 'napoje', 'chemia', 'dom', 'zdrowie', 'transport', 'rozrywka', 'inne'))
);

CREATE INDEX IF NOT EXISTS idx_expense_items_expense
  ON public.expense_items (expense_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_items TO authenticated;
GRANT ALL ON public.expenses TO service_role;
GRANT ALL ON public.expense_items TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Expenses: owner manages" ON public.expenses;
CREATE POLICY "Expenses: owner manages" ON public.expenses
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Expense items: owner manages" ON public.expense_items;
CREATE POLICY "Expense items: owner manages" ON public.expense_items
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
