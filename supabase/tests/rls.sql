-- =========================================================================
-- Testy RLS / uprawnień — czysty SQL, bez pgTAP.
--
-- Odpalane na bazie z już wgranymi migracjami:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql
-- W CI robi to .github/workflows/rls-tests.yml na lokalnym Supabase
-- (`supabase start`). Cała zawartość idzie w jednej transakcji, którą
-- kończy ROLLBACK, więc baza zostaje czysta. Pierwszy błąd (RAISE
-- EXCEPTION) przerywa skrypt i kończy go kodem ≠ 0.
--
-- Czego pilnują:
--   1. każda tabela w `public` ma włączone RLS,
--   2. żadna polityka nie pozwala zapisywać „każdemu" (USING/CHECK true),
--   3. user_secrets jest niedostępna dla przeglądarki (anon, authenticated),
--   4. wspólne tabele cache są do odczytu, ale nie do zapisu dla zalogowanych,
--   5. użytkownik A nie widzi, nie zmienia i nie podszywa się pod B.
-- =========================================================================

BEGIN;

-- ---------- 1. RLS włączone wszędzie ----------
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS wyłączone na tabelach: %', missing;
  END IF;
END $$;

-- ---------- 2. brak polityk zapisu „dla wszystkich" ----------
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(tablename || ' → ' || policyname, '; ' ORDER BY tablename) INTO offenders
  FROM pg_policies
  WHERE schemaname = 'public'
    AND roles <> ARRAY['service_role']::name[]
    AND (
      (cmd = 'INSERT' AND with_check = 'true')
      OR (cmd IN ('UPDATE', 'DELETE') AND qual = 'true')
      OR (cmd = 'ALL' AND (qual = 'true' OR with_check = 'true'))
    );
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Polityki zapisu bez ograniczeń: %', offenders;
  END IF;
END $$;

-- ---------- 3. user_secrets niedostępna dla przeglądarki ----------
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);

    BEGIN
      PERFORM 1 FROM public.user_secrets LIMIT 1;
      RAISE EXCEPTION 'rola % może CZYTAĆ user_secrets', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      INSERT INTO public.user_secrets (owner_id) VALUES (gen_random_uuid());
      RAISE EXCEPTION 'rola % może ZAPISYWAĆ user_secrets', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      UPDATE public.user_secrets SET gemini_api_key = 'x';
      RAISE EXCEPTION 'rola % może ZMIENIAĆ user_secrets', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      DELETE FROM public.user_secrets;
      RAISE EXCEPTION 'rola % może USUWAĆ z user_secrets', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    RESET ROLE;
  END LOOP;
END $$;

-- ---------- 4. wspólne tabele cache: odczyt tak, zapis nie ----------
DO $$
DECLARE t text;
BEGIN
  SET LOCAL ROLE authenticated;
  FOREACH t IN ARRAY ARRAY[
    'orlen_fuel_prices', 'orlen_market_series', 'fuel_news_items',
    'market_quotes', 'market_news_items'
  ] LOOP
    -- odczyt działa
    EXECUTE format('SELECT count(*) FROM public.%I', t);

    BEGIN
      EXECUTE format('INSERT INTO public.%I DEFAULT VALUES', t);
      RAISE EXCEPTION 'zalogowany może WSTAWIAĆ do %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      EXECUTE format('UPDATE public.%I SET id = id', t);
      RAISE EXCEPTION 'zalogowany może ZMIENIAĆ %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      EXECUTE format('DELETE FROM public.%I', t);
      RAISE EXCEPTION 'zalogowany może USUWAĆ z %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RESET ROLE;
END $$;

-- ---------- 5. izolacja użytkowników (na tabeli notes) ----------
DO $$
DECLARE
  user_a constant uuid := '00000000-0000-4000-8000-0000000000a1';
  user_b constant uuid := '00000000-0000-4000-8000-0000000000b2';
  seen int;
  touched int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (user_a, 'rls-test-a@example.invalid'),
    (user_b, 'rls-test-b@example.invalid');
  INSERT INTO public.notes (owner_id, title) VALUES (user_a, 'notatka A');

  -- A widzi swoją notatkę
  PERFORM set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO seen FROM public.notes;
  IF seen <> 1 THEN RAISE EXCEPTION 'A powinien widzieć 1 notatkę, widzi %', seen; END IF;
  RESET ROLE;

  -- B nie widzi, nie zmienia i nie usuwa cudzej
  PERFORM set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO seen FROM public.notes;
  IF seen <> 0 THEN RAISE EXCEPTION 'B widzi % cudzych notatek', seen; END IF;

  UPDATE public.notes SET title = 'przejęta' WHERE owner_id = user_a;
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched <> 0 THEN RAISE EXCEPTION 'B zmienił % cudzych notatek', touched; END IF;

  DELETE FROM public.notes WHERE owner_id = user_a;
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched <> 0 THEN RAISE EXCEPTION 'B usunął % cudzych notatek', touched; END IF;

  -- B nie może podszyć się pod A przy zapisie
  BEGIN
    INSERT INTO public.notes (owner_id, title) VALUES (user_a, 'podszyty');
    RAISE EXCEPTION 'B wstawił notatkę jako A';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- anon nie widzi nic
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM public.notes LIMIT 1;
    -- jeśli anon ma SELECT, RLS musi zwrócić 0 wierszy
    SELECT count(*) INTO seen FROM public.notes;
    IF seen <> 0 THEN RAISE EXCEPTION 'anon widzi % notatek', seen; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END $$;

SELECT 'RLS: wszystkie testy przeszły' AS wynik;

ROLLBACK;
