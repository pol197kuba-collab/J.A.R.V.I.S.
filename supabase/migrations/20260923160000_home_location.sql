-- =========================================================================
-- Współrzędne domowe — pogoda w porannym briefingu.
--
-- PO CO OSOBNE POLA, SKORO PRZEGLĄDARKA ZNA LOKALIZACJĘ. Bo briefing składa
-- się w nocy, na serwerze, gdzie żadnej przeglądarki nie ma. Moduł pogody na
-- pulpicie pyta `navigator.geolocation` przy każdym wejściu; nocny job nie ma
-- kogo zapytać. Bez zapisanego punktu rubryka mogłaby mówić o pogodzie
-- najwyżej w mieście wpisanym na sztywno w kod — czyli nie o tej za oknem.
--
-- DOKŁADNOŚĆ JEST CELOWO OBCIĘTA. NUMERIC(6,2) to dwa miejsca po przecinku,
-- czyli około kilometra. Prognoza dobowa na kilometr i tak się nie różni, a
-- to, co nie jest potrzebne, nie ma po co leżeć w bazie.
-- =========================================================================

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS home_lat NUMERIC(6, 2);
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS home_lon NUMERIC(6, 2);

-- NULL znaczy „nie podano" i jest stanem normalnym: dopóki użytkownik nie
-- kliknie przycisku w Ustawieniach, briefing po prostu nie mówi o pogodzie.
-- Zakresy pilnują tylko tego, żeby zamiana miejscami szerokości z długością
-- albo pomyłka w jednostkach nie weszła po cichu do bazy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_home_lat_range'
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_home_lat_range
      CHECK (home_lat IS NULL OR (home_lat >= -90 AND home_lat <= 90));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_home_lon_range'
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_home_lon_range
      CHECK (home_lon IS NULL OR (home_lon >= -180 AND home_lon <= 180));
  END IF;
END $$;
