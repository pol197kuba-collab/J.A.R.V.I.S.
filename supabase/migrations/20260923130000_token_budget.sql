-- =========================================================================
-- Licznik kosztów i budżet miesięczny.
--
-- CO BYŁO. `agent_runs` zapisywało `tokens_input` i `tokens_output`, a panel
-- pokazywał ich surową sumę. Suma tokenów Opusa i Gemini w jednym worku to
-- liczba bez interpretacji: te same dziesięć tysięcy tokenów kosztuje
-- kilkadziesiąt razy więcej po jednej stronie niż po drugiej.
--
-- CZEGO BRAKOWAŁO NAJBARDZIEJ. Tokenów cache'u. Dostawca zwraca je osobno,
-- a kosztują inaczej niż zwykłe wejście: odczyt ~0,1 stawki, zapis ~1,25.
-- Koszt liczony z samego `tokens_input` rozjeżdżałby się z rachunkiem w OBIE
-- strony — i to niezauważalnie, bo wyglądałby wiarygodnie.
-- =========================================================================

-- ---------- 1. Zużycie i koszt per przebieg ----------
-- Który model wykonał przebieg. Bez tego koszt jest liczbą, której nie da
-- się wytłumaczyć: te same tokeny kosztują kilkadziesiąt razy więcej po
-- jednej stronie niż po drugiej, a panel ma odpowiadać na pytanie „co
-- pochłania najwięcej", nie tylko „ile".
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS model TEXT;

ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER;

-- Koszt w USD, policzony W CHWILI ZAPISU po ówczesnym cenniku.
--
-- Kolumna, a nie liczenie w locie z tokenów — i to jest tu decyzja, nie
-- optymalizacja. Cennik się zmienia; przebieg sprzed miesiąca ma kosztować
-- tyle, ile kosztował wtedy. Przeliczanie historii aktualnym cennikiem
-- znaczyłoby, że jeden commit po cichu przepisuje wszystkie dotychczasowe
-- rachunki.
--
-- NULL to nie zero: znaczy „model spoza cennika, nie wiem ile kosztował".
-- Wliczenie takiego przebiegu jako zera zaniżałoby budżet dokładnie wtedy,
-- gdy ktoś dołożył nowy, nieopisany model.
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12, 6);

-- Panel budżetu pyta zawsze o to samo: koszty właściciela od początku
-- miesiąca. Indeks częściowy, bo przebiegi bez kosztu i tak go nie interesują.
CREATE INDEX IF NOT EXISTS idx_agent_runs_owner_cost
  ON public.agent_runs(user_id, created_at DESC)
  WHERE cost_usd IS NOT NULL;

-- ---------- 2. Limit miesięczny ----------
-- W USD, bo w USD rozliczają się obaj dostawcy. Przeliczanie na złotówki
-- wymagałoby kursu z dnia i wprowadzało różnicę między tym, co pokazuje
-- panel, a tym, co widać na rachunku.
--
-- 0 znaczy „nie pilnuj" — świadome wyłączenie, nie brak ustawienia.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS monthly_budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 5;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_budget_non_negative'
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_budget_non_negative
      CHECK (monthly_budget_usd >= 0);
  END IF;
END $$;
