-- =========================================================================
-- MOJE TRASY DOJAZDU — zapisane warianty z punktami pośrednimi.
--
-- Automatyczna trasa z mapy bywa inna niż ta, którą się naprawdę jeździ.
-- Zapisana trasa to nazwa + 1–3 punkty pośrednie, przez które liczymy
-- przejazd osobnym zapytaniem — automatyczne propozycje liczą się bez tych
-- punktów, więc ich nie zaburzają. Jedna trasa na kierunek jest DOMYŚLNA:
-- to ją czytają briefing, kafelek, dock i alerty. Brak domyślnej = trasa
-- automatyczna, jak dotąd.
--
-- Kierunki są niezależne ('to' = z domu do pracy, 'back' = z pracy do domu):
-- powrót bywa inną drogą niż dojazd.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.commute_routes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction  TEXT NOT NULL CHECK (direction IN ('to', 'back')),
  name       TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- [{"lat":50.1,"lon":21.9,"label":"Rzeszów"}, …] — najwyżej 3 punkty.
  via        JSONB NOT NULL DEFAULT '[]'::jsonb
             CHECK (jsonb_typeof(via) = 'array' AND jsonb_array_length(via) <= 3),
  is_default BOOLEAN NOT NULL DEFAULT false,
  position   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commute_routes_owner
  ON public.commute_routes (owner_id, direction, position);

-- Najwyżej jedna domyślna na kierunek — pilnuje tego baza, nie tylko kod.
CREATE UNIQUE INDEX IF NOT EXISTS commute_routes_one_default
  ON public.commute_routes (owner_id, direction) WHERE is_default;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commute_routes TO authenticated;
GRANT ALL ON public.commute_routes TO service_role;
ALTER TABLE public.commute_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Commute routes: owner manages" ON public.commute_routes;
CREATE POLICY "Commute routes: owner manages" ON public.commute_routes
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
