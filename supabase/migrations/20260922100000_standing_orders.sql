-- =========================================================================
-- STAŁE ROZKAZY — warunki, które system sprawdza sam, bez pytania.
--
-- PO CO. Do tej pory cały system był pytanie–odpowiedź. Nocne joby zaciągały
-- dane i na tym kończyły: nikt nic nie mówił, dopóki użytkownik sam nie
-- wszedł na /rynki albo /paliwa. Stały rozkaz odwraca kierunek — to
-- użytkownik zostawia warunek, a system melduje, kiedy warunek zajdzie.
--
-- DLACZEGO JEDNA TABELA NA OBA MODUŁY. Moduł paliwowy miał już własne progi
-- (`fuel_price_alerts`, migracja 20260920090000) — działające, ale zamknięte
-- na jedną dziedzinę: kolumna `product_id INTEGER` nie pomieści symbolu
-- 'BTC'. Dołożenie bliźniaczej `market_price_alerts` dałoby dwa mechanizmy
-- robiące to samo, dwa ewaluatory do utrzymania i — co gorsza — narzędzie
-- agenta, które musiałoby zgadywać, do której tabeli trafia zdanie
-- „powiadom mnie, kiedy…". Dlatego jedna tabela z `subject_kind`.
--
-- STARE PROGI PALIWOWE SĄ PRZENOSZONE, NIE PORZUCANE (krok 3). Sama tabela
-- `fuel_price_alerts` zostaje w bazie nietknięta — nowy kod już do niej nie
-- pisze, ale dane zostają, gdyby przeniesienie wymagało sprawdzenia.
-- =========================================================================

-- ---------- 1. Tabela ----------
CREATE TABLE IF NOT EXISTS public.standing_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Z którego modułu pochodzi obserwowana wielkość. Rozstrzyga, skąd
  -- ewaluator bierze serię i w jakiej jednostce jest próg.
  --   'market' — cena instrumentu z market_quotes, w walucie notowania
  --   'fuel'   — hurtowa cena Orlenu z orlen_fuel_prices, w PLN/m³
  subject_kind TEXT NOT NULL,

  -- Co obserwujemy, w postaci kanonicznej dla swojego modułu: symbol z
  -- src/lib/markets/assets.ts ('BTC', 'CDR.PL') albo kod produktu z
  -- src/lib/fuel/orlen.ts ('ON', 'PB95'). Tekst, nie klucz obcy — słowniki
  -- żyją w kodzie i mają się dać rozszerzać bez migracji.
  subject TEXT NOT NULL,

  -- Warunek. Świadomie krótka lista — każdy warunek musi dać się wyjaśnić
  -- jednym zdaniem i policzyć z samej serii, bez dodatkowego stanu:
  --   'level_above'     — wartość >= próg
  --   'level_below'     — wartość <= próg
  --   'change_pct_up'   — zmiana w oknie >= +próg %
  --   'change_pct_down' — zmiana w oknie <= -próg %
  --   'change_abs'      — |zmiana w oknie| >= próg (w jednostce instrumentu)
  condition TEXT NOT NULL,

  threshold NUMERIC(20, 8) NOT NULL,

  -- Okno dla warunków zmianowych, w dniach kalendarzowych. Dla warunków
  -- poziomu nie ma znaczenia i zostaje na 1.
  window_days INTEGER NOT NULL DEFAULT 1,

  -- Anty-spam. Rozkaz na poziomie ceny po przekroczeniu progu jest prawdziwy
  -- każdego kolejnego dnia — bez wyciszenia meldowałby to samo w kółko.
  cooldown_hours INTEGER NOT NULL DEFAULT 24,

  -- Zdanie, którym użytkownik to zamówił. Trzymane dosłownie, bo rozkaz
  -- zakładany głosem ma wracać w meldunku tym samym językiem, którym został
  -- wydany — a nie jako „ON change_abs 120".
  phrase TEXT,

  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- „Obserwuj przez tydzień" — po terminie rozkaz przestaje być sprawdzany,
  -- ale zostaje na liście, żeby było widać, że wygasł, a nie zniknął.
  expires_at TIMESTAMPTZ,

  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT standing_orders_subject_kind_allowed
    CHECK (subject_kind IN ('market', 'fuel')),
  CONSTRAINT standing_orders_condition_allowed
    CHECK (condition IN (
      'level_above', 'level_below', 'change_pct_up', 'change_pct_down', 'change_abs'
    )),
  CONSTRAINT standing_orders_threshold_positive CHECK (threshold > 0),
  CONSTRAINT standing_orders_window_sane CHECK (window_days BETWEEN 1 AND 90),
  CONSTRAINT standing_orders_cooldown_sane CHECK (cooldown_hours BETWEEN 1 AND 720),

  -- Ten sam warunek na ten sam instrument z tym samym progiem to ten sam
  -- rozkaz. Bez tego powtórzona komenda głosowa dawałaby dwa meldunki.
  CONSTRAINT standing_orders_unique_rule
    UNIQUE (owner_id, subject_kind, subject, condition, threshold, window_days)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.standing_orders TO authenticated;
GRANT ALL ON public.standing_orders TO service_role;
ALTER TABLE public.standing_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Standing orders: owner manages" ON public.standing_orders;
CREATE POLICY "Standing orders: owner manages" ON public.standing_orders
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- Ewaluator pyta zawsze o to samo: aktywne rozkazy danej dziedziny.
CREATE INDEX IF NOT EXISTS idx_standing_orders_active
  ON public.standing_orders(subject_kind, is_enabled, owner_id);

DROP TRIGGER IF EXISTS trg_standing_orders_updated_at ON public.standing_orders;
CREATE TRIGGER trg_standing_orders_updated_at BEFORE UPDATE ON public.standing_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 2. Meldunki w dzwonku ----------
-- notifications.kind jest zwykłym tekstem, więc nowy rodzaj 'standing_order'
-- nie wymaga zmiany schematu. Zapisane tutaj, żeby lista rodzajów nie żyła
-- wyłącznie w komentarzu przy tamtej tabeli.
COMMENT ON TABLE public.standing_orders IS
  'Warunki zlecone przez użytkownika, sprawdzane przez nocne joby; trafienie ląduje w notifications (kind = ''standing_order'').';

-- ---------- 3. Przeniesienie progów paliwowych ----------
-- Mapowanie rodzajów jeden do jednego; 'daily_change_abs' to po prostu
-- 'change_abs' w oknie jednodniowym, czyli dokładnie to, co liczył stary
-- ewaluator. Historia wyzwoleń (last_triggered_at) jedzie razem z rozkazem,
-- żeby przeniesienie nie odblokowało meldunku wyciszonego wczoraj.
INSERT INTO public.standing_orders (
  owner_id, subject_kind, subject, condition, threshold, window_days,
  phrase, is_enabled, last_triggered_at
)
SELECT
  a.owner_id,
  'fuel',
  CASE a.product_id
    WHEN 41 THEN 'PB95'
    WHEN 42 THEN 'PB98'
    WHEN 43 THEN 'ON'
    WHEN 44 THEN 'ON_ARCTIC'
    WHEN 46 THEN 'EKOTERM'
    ELSE a.product_id::text
  END,
  CASE a.kind
    WHEN 'daily_change_abs' THEN 'change_abs'
    ELSE a.kind
  END,
  a.threshold,
  1,
  'Przeniesione z progów modułu paliwowego.',
  a.is_enabled,
  a.last_triggered_at
FROM public.fuel_price_alerts a
-- Produkt spoza słownika zostałby przepisany jako goły numer, którego
-- ewaluator i tak by nie rozpoznał — lepiej go nie przenosić wcale.
WHERE a.product_id IN (41, 42, 43, 44, 46)
ON CONFLICT (owner_id, subject_kind, subject, condition, threshold, window_days)
  DO NOTHING;
