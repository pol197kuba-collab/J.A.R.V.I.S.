-- =========================================================================
-- WEB PUSH — meldunek dociera na telefon, nie tylko na dzwonek w aplikacji.
--
-- PO CO OSOBNY KANAŁ. Dzwonek w aplikacji zapala się tylko dla kogoś, kto ma
-- otwartą kartę. Stały rozkaz z definicji wyzwala się wtedy, gdy nikt nie
-- patrzy — nocą, po zaciągu. Meldunek, który czeka na następne wejście na
-- stronę, jest wart tyle co wykres: mówi o tym, co już się stało.
--
-- SUBSKRYPCJA NIE JEST TAJEMNICĄ, ALE JEST PRZEPUSTKĄ. Endpoint nadany przez
-- przeglądarkę pozwala wysłać powiadomienie na TO urządzenie, więc wiersze są
-- zamknięte polityką właściciela tak samo jak reszta danych osobistych.
--
-- KLUCZE VAPID MIESZKAJĄ W user_secrets, nie w sekretach GitHuba. Powód
-- praktyczny: powiadomienia wysyła i aplikacja, i nocny job, a job loguje się
-- kontem właściciela — czyli ma dostęp do tego samego wiersza. Jedno miejsce
-- zamiast dwóch, które trzeba pamiętać, żeby rotować razem.
-- =========================================================================

-- ---------- 1. Klucze VAPID właściciela ----------
ALTER TABLE public.user_secrets ADD COLUMN IF NOT EXISTS vapid_public_key TEXT;
ALTER TABLE public.user_secrets ADD COLUMN IF NOT EXISTS vapid_private_key TEXT;
-- Adres kontaktowy wymagany przez protokół (RFC 8292). Zapisujemy origin
-- aplikacji, a NIE adres e-mail użytkownika: usługa push widzi tę wartość, a
-- nie ma powodu, żeby dostawała czyjąś pocztę.
ALTER TABLE public.user_secrets ADD COLUMN IF NOT EXISTS vapid_subject TEXT;

-- ---------- 2. Subskrypcje urządzeń ----------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Adres nadany przez usługę push przeglądarki. Jednoznaczny per
  -- urządzenie i przeglądarka — stąd na nim klucz unikalności.
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,

  -- Do rozpoznania urządzenia na liście („telefon", „laptop") — sam endpoint
  -- jest nieczytelnym ciągiem znaków.
  user_agent TEXT,

  -- Diagnostyka wygasania: usługi push unieważniają subskrypcje po
  -- odinstalowaniu aplikacji albo wyczyszczeniu danych i odpowiadają wtedy
  -- 404/410. Taki wiersz kasujemy przy pierwszej takiej odpowiedzi.
  last_success_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT push_subscriptions_unique_endpoint UNIQUE (endpoint)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Push subscriptions: owner manages" ON public.push_subscriptions;
CREATE POLICY "Push subscriptions: owner manages" ON public.push_subscriptions
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_owner
  ON public.push_subscriptions(owner_id);

DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
