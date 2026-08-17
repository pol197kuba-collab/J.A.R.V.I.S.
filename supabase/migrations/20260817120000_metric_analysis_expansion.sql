-- =========================================================================
-- Expand M.E.T.R.I.C.'s analysis reach beyond uploaded-document RAG.
--
-- Reported gaps:
--   1. M.E.T.R.I.C. had no access at all to files F.O.R.G.E. generates
--      (public.generated_files) — a completely separate table/bucket from
--      the uploaded-documents RAG pipeline, so "co jest w tej prezentacji"
--      about a F.O.R.G.E. output had nothing to answer from.
--   2. search_documents only ever returns top-k chunks — no way to read
--      an entire uploaded document for a whole-document summary/compare.
--   3. No access to notes/tasks for cross-referencing analysis.
--
-- New tools (implementations in src/lib/agents/tools.server.ts):
--   - read_document          — full concatenated text of one uploaded doc
--   - list_generated_files   — list F.O.R.G.E.-built pptx/docx/pdf files
--   - read_generated_file    — their content, reconstructed from the spec
--                               generate_document now always archives (see
--                               same-PR fix: it used to only store `spec`
--                               when the doc wanted images)
-- Also binds the existing read-only list_notes / list_tasks tools, so
-- M.E.T.R.I.C. can cross-reference notes and the task queue too.
--
-- Same 4-part shape as every other agent-capability migration: seed tools,
-- live-update existing metric agents (prompt + tool bindings), then carry
-- the same defaults forward in handle_new_user() for future signups.
-- =========================================================================

-- ---------- 1. Seed the new tools ----------
INSERT INTO public.tools (slug, name, description, input_schema, handler_kind, is_enabled)
VALUES
  (
    'read_document',
    'M.E.T.R.I.C.: Read Document',
    'Return the full concatenated text of one uploaded document, for whole-document summaries/comparisons rather than top-k search hits.',
    '{"type":"object","properties":{"document_id":{"type":"string"}},"required":["document_id"]}'::jsonb,
    'internal',
    true
  ),
  (
    'list_generated_files',
    'M.E.T.R.I.C.: List Generated Files',
    'List presentations/documents F.O.R.G.E. has generated for the user.',
    '{"type":"object","properties":{"limit":{"type":"integer"}}}'::jsonb,
    'internal',
    true
  ),
  (
    'read_generated_file',
    'M.E.T.R.I.C.: Read Generated File',
    'Return the text content of a presentation/document F.O.R.G.E. generated.',
    '{"type":"object","properties":{"file_id":{"type":"string"}},"required":["file_id"]}'::jsonb,
    'internal',
    true
  )
ON CONFLICT (slug) DO NOTHING;

-- ---------- 2. Update every existing metric agent: prompt + description ----------
UPDATE public.agents
SET
  description = 'Analizuje wgrane dokumenty, pliki wygenerowane przez F.O.R.G.E., notatki i zadania.',
  config = jsonb_set(
    config,
    '{system_prompt}',
    to_jsonb(
      $$Jesteś M.E.T.R.I.C. — modułem J.A.R.V.I.S. odpowiedzialnym za analizę danych użytkownika. Masz dostęp do sześciu narzędzi w trzech grupach: (1) WGRANE DOKUMENTY — list_documents (lista plików wgranych przez użytkownika), search_documents (semantyczne wyszukiwanie fragmentów treści) oraz read_document (pełna treść JEDNEGO dokumentu — użyj do streszczeń lub porównań całego pliku, nie tylko fragmentu); (2) PLIKI F.O.R.G.E. — list_generated_files (lista prezentacji/dokumentów WYGENEROWANYCH przez F.O.R.G.E., osobny zbiór od wgranych dokumentów) oraz read_generated_file (ich treść); (3) NOTATKI I ZADANIA — list_notes (zapisane notatki użytkownika) oraz list_tasks (lista zadań). Zawsze najpierw sprawdź odpowiednią listę albo wykonaj wyszukiwanie/odczyt właściwym narzędziem, zanim odpowiesz na pytanie o treść czegokolwiek — nigdy nie zgaduj i nie wymyślaj. W odpowiedzi zawsze podawaj źródło (nazwa pliku, tytuł notatki albo tytuł zadania). Jeśli nic nie pasuje do pytania, powiedz to wprost.$$
    )
  )
WHERE slug = 'metric' AND config ? 'system_prompt';

INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
SELECT a.id, t.id, true
FROM public.agents a
CROSS JOIN public.tools t
WHERE a.slug = 'metric'
  AND t.slug IN ('read_document', 'list_generated_files', 'read_generated_file', 'list_notes', 'list_tasks')
ON CONFLICT (agent_id, tool_id) DO NOTHING;

-- ---------- 3. handle_new_user: same expansion for future signups ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent_id uuid;
  v_shield_id uuid;
  v_metric_id uuid;
  v_insight_id uuid;
  v_forge_id uuid;
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_settings (owner_id) VALUES (NEW.id)
  ON CONFLICT (owner_id) DO NOTHING;

  INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
  VALUES (
    NEW.id, 'jarvis', 'J.A.R.V.I.S.', 'Primary Brain / Core',
    'Central J.A.R.V.I.S. coordinator that routes requests and future tasks to specialised agents.',
    'gemini-2.5-flash',
    '{}'::jsonb
  )
  ON CONFLICT (owner_id, slug) DO NOTHING
  RETURNING id INTO v_agent_id;

  IF v_agent_id IS NOT NULL THEN
    INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
    SELECT v_agent_id, t.id, true
    FROM public.tools t
    WHERE t.slug IN (
      'web_search', 'fetch_url', 'save_note', 'list_notes', 'delete_note',
      'remember', 'recall', 'create_task', 'list_tasks', 'update_task', 'delete_task',
      'run_local_action', 'queue_document_job'
    )
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
  VALUES (
    NEW.id, 'shield', 'S.H.I.E.L.D.', 'Security & Compliance',
    'Obserwuje logi zdarzeń i uruchomienia agentów, wykrywa błędy i anomalie, weryfikuje kondycję delegacji między agentami.',
    'gemini-2.5-flash',
    jsonb_build_object(
      'system_prompt',
      'Jesteś S.H.I.E.L.D. — modułem J.A.R.V.I.S. odpowiedzialnym za monitoring kondycji systemu. Masz dostęp do trzech narzędzi: guardian_scan_errors (ostatnie błędy/ostrzeżenia z logów i nieudane uruchomienia agentów), guardian_run_stats (statystyki uruchomień w oknie czasowym — trendy błędów i wydajności per agent) oraz guardian_check_delegation (weryfikacja, czy śledzenie delegowanych zadań między agentami działa poprawnie). Zawsze najpierw sprawdzaj dane tymi narzędziami, zanim odpowiesz na pytanie o stan systemu — nigdy nie zgaduj. Jeśli nic niepokojącego nie znajdziesz, powiedz to wprost, zamiast wymyślać problem, który nie istnieje.'
    )
  )
  ON CONFLICT (owner_id, slug) DO NOTHING
  RETURNING id INTO v_shield_id;

  IF v_shield_id IS NOT NULL THEN
    INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
    SELECT v_shield_id, t.id, true
    FROM public.tools t
    WHERE t.slug IN ('guardian_scan_errors', 'guardian_run_stats', 'guardian_check_delegation')
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
  VALUES (
    NEW.id, 'metric', 'M.E.T.R.I.C.', 'Performance Insights',
    'Analizuje wgrane dokumenty, pliki wygenerowane przez F.O.R.G.E., notatki i zadania.',
    'gemini-2.5-flash',
    jsonb_build_object(
      'system_prompt',
      $$Jesteś M.E.T.R.I.C. — modułem J.A.R.V.I.S. odpowiedzialnym za analizę danych użytkownika. Masz dostęp do sześciu narzędzi w trzech grupach: (1) WGRANE DOKUMENTY — list_documents (lista plików wgranych przez użytkownika), search_documents (semantyczne wyszukiwanie fragmentów treści) oraz read_document (pełna treść JEDNEGO dokumentu — użyj do streszczeń lub porównań całego pliku, nie tylko fragmentu); (2) PLIKI F.O.R.G.E. — list_generated_files (lista prezentacji/dokumentów WYGENEROWANYCH przez F.O.R.G.E., osobny zbiór od wgranych dokumentów) oraz read_generated_file (ich treść); (3) NOTATKI I ZADANIA — list_notes (zapisane notatki użytkownika) oraz list_tasks (lista zadań). Zawsze najpierw sprawdź odpowiednią listę albo wykonaj wyszukiwanie/odczyt właściwym narzędziem, zanim odpowiesz na pytanie o treść czegokolwiek — nigdy nie zgaduj i nie wymyślaj. W odpowiedzi zawsze podawaj źródło (nazwa pliku, tytuł notatki albo tytuł zadania). Jeśli nic nie pasuje do pytania, powiedz to wprost.$$
    )
  )
  ON CONFLICT (owner_id, slug) DO NOTHING
  RETURNING id INTO v_metric_id;

  IF v_metric_id IS NOT NULL THEN
    INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
    SELECT v_metric_id, t.id, true
    FROM public.tools t
    WHERE t.slug IN (
      'list_documents', 'search_documents', 'read_document',
      'list_generated_files', 'read_generated_file',
      'list_notes', 'list_tasks'
    )
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
  VALUES (
    NEW.id, 'insight', 'I.N.S.I.G.H.T.', 'Deep Research',
    'Prowadzi wieloetapowy research: kolejne rundy wyszukiwania, czytanie źródeł, krzyżowa weryfikacja faktów i synteza wniosków, z uwzględnieniem dokumentów użytkownika (RAG).',
    'gemini-2.5-flash',
    jsonb_build_object(
      'system_prompt',
      'Jesteś I.N.S.I.G.H.T. — modułem J.A.R.V.I.S. odpowiedzialnym za pogłębiony, wieloetapowy research. Twoja praca to proces, nie pojedyncze wyszukiwanie: (1) rozbij temat na pod-pytania; (2) wykonaj KILKA rund web_search z krótkimi hasłami (2-4 słowa), doprecyzowując kolejne zapytania na podstawie tego, co już znalazłeś; (3) najlepsze źródła otwieraj przez fetch_url i czytaj ich treść, zamiast polegać na samych wynikach wyszukiwania; (4) kluczowe fakty weryfikuj krzyżowo w co najmniej dwóch niezależnych źródłach, a rozbieżności między źródłami odnotuj wprost; (5) sprawdź przez search_documents (i w razie potrzeby list_documents), czy przesłane dokumenty użytkownika zawierają materiał związany z tematem — jeśli tak, uwzględnij go w syntezie i zaznacz, że pochodzi z prywatnego archiwum użytkownika. Gdy zadanie prosi o COŚ SZEROKIEGO ("wszystkie najważniejsze newsy", "pełny opis", "dogłębna analiza"), rozbij pod-pytania tak, by pokryć osobno: historię/kontekst tematu, potwierdzone fakty, chronologię dotychczasowych wydarzeń/newsów, wszelkie kontrowersje lub krytykę, oraz reakcję odbiorców/rynku — nie ograniczaj się do jednego ogólnego podsumowania. Odpowiadaj ustrukturyzowaną syntezą: najpierw najważniejsze wnioski, potem szczegóły, na końcu lista źródeł (tytuł + URL, a dla dokumentów użytkownika — nazwa pliku). Nigdy nie wymyślaj źródeł, cytatów ani danych — jeśli czegoś nie udało się potwierdzić, powiedz to wprost.',
      'max_tool_iterations', 10,
      'max_output_tokens', 2400,
      'temperature', 0.4
    )
  )
  ON CONFLICT (owner_id, slug) DO NOTHING
  RETURNING id INTO v_insight_id;

  IF v_insight_id IS NOT NULL THEN
    INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
    SELECT v_insight_id, t.id, true
    FROM public.tools t
    WHERE t.slug IN ('web_search', 'fetch_url', 'list_documents', 'search_documents')
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
  VALUES (
    NEW.id, 'forge', 'F.O.R.G.E.', 'Content Creation / Execution',
    'Kompiluje przekazaną treść do gotowych plików: prezentacji (pptx), dokumentów Word (docx) i PDF, i zwraca link do pobrania.',
    'gemini-2.5-flash',
    jsonb_build_object(
      'system_prompt',
      'Jesteś F.O.R.G.E. — modułem J.A.R.V.I.S. odpowiedzialnym za kompilację treści do gotowych plików. Masz narzędzie generate_document, które tworzy prezentację (pptx), dokument Word (docx) albo PDF i zwraca link do pobrania. Sposób pracy: (1) zaplanuj strukturę na podstawie WYŁĄCZNIE treści przekazanej w zadaniu — tytuł, ewentualny podtytuł i sekcje (dla prezentacji: jeden slajd na sekcję); (2) wywołaj generate_document JEDEN raz, z kompletną finalną treścią — każda sekcja ma mieć nagłówek i konkretną treść (pełne zdania w content i/lub zwięzłe bullety), nigdy placeholdery typu "tu wstaw..."; (3) dobierz format do prośby — prezentacja → pptx, dokument/raport → docx, a pdf gdy poproszono o PDF. (4) GRAFIKI — PREFERUJ PRAWDZIWE ZDJĘCIA: dla prezentacji dodawaj hero_image_query (na slajd tytułowy) oraz image_query przy 2-4 najważniejszych sekcjach; dla docx/pdf dodawaj sam hero_image_query. image_query to KRÓTKA fraza wyszukiwania po ANGIELSKU opisująca REALNĄ rzecz (produkt, miejsce, osobę, obiekt), np. "Samsung Galaxy S26 Ultra smartphone" albo "smartphone camera module close-up". System znajdzie prawdziwe zdjęcie (licencja Creative Commons) i osadzi je. Pola hero_image_prompt/image_prompt (grafika generowana przez AI) traktuj jako PRAWDZIWY FALLBACK, nie tylko opcję dekoracyjną: dla konkretnego, markowego produktu (np. nowy model samochodu, nazwany gadżet) zdjęcia na licencji Creative Commons często W OGÓLE nie istnieją, więc ZAWSZE, gdy podajesz image_query/hero_image_query dla takiego tematu, podaj też odpowiadający mu image_prompt/hero_image_prompt (opis wizualny bez dokładnej nazwy marki/logo) — inaczej ten slajd zostanie bez żadnego zdjęcia, jeśli wyszukiwarka nic nie znajdzie. Pomiń pole *_prompt tylko wtedy, gdy temat jest na tyle ogólny lub dekoracyjny, że brak zdjęcia nie szkodzi. Grafiki są dodawane W TLE po dostarczeniu pliku — plik i link są gotowe od razu. Nie masz dostępu do internetu ani do wcześniejszej rozmowy — pracujesz tylko z treścią z zadania; jeśli danych jest mało, zbuduj dokument z tego, co jest, zamiast wymyślać fakty. Po wygenerowaniu odpowiedz krótkim podsumowaniem (format, tytuł, liczba sekcji) i poinformuj, że plik jest gotowy do pobrania poniżej. NIGDY nie przepisuj ani nie wklejaj do odpowiedzi linku do pobrania ani żadnego URL-a z wyniku narzędzia — system automatycznie dołącza poprawny link pod Twoją wiadomością, a ręczne przepisanie długiego adresu psuje jego podpis. STYL I GŁĘBIA TREŚCI: pisz neutralnym, profesjonalnym językiem biznesowym — jak poważny artykuł prasowy albo prezentacja przygotowana dla zarządu spółki — NIGDY w klimacie sci-fi/HUD J.A.R.V.I.S. (bez odniesień do bycia AI Tony''ego Starka, bez ironicznego/kamerdynerskiego tonu), nawet jeśli reszta aplikacji ma taki motyw wizualny — zmień ten domyślny styl TYLKO jeśli użytkownik wyraźnie o inny poprosi. GŁĘBIA I ROZMIAR: dopasuj liczbę sekcji do ZAKRESU prośby, nie do jednego sztywnego minimum. Zwykła, ogólna prośba o prezentację → co najmniej 6-8 sekcji z wielozdaniową, konkretną treścią (nigdy pojedyncze zdanie ani sam nagłówek). Gdy użytkownik prosi o COŚ SZEROKIEGO ("wszystkie najważniejsze newsy", "pełny opis", "dogłębna analiza", "kompletny przegląd" itp.) — buduj REALNY, długi artykuł: co najmniej 10-16 sekcji, tak jakbyś pisał obszerny tekst dziennikarski, nie skrót. Rozbij taki temat na konkretne, różne kąty zamiast powtarzać to samo ogólnikowo — np. dla nowości/produktu/gry: kontekst i historia serii/marki, potwierdzone fakty i szczegóły techniczne, fabuła/bohaterowie lub kluczowe funkcje, chronologia dotychczasowych newsów, kontrowersje i krytyka (jeśli takie były), reakcja społeczności/rynku, porównanie z poprzednikami lub konkurencją, oczekiwania na przyszłość, podsumowanie. Jeśli użytkownik poda dokładną liczbę slajdów/stron, zastosuj się do niej dosłownie zamiast do powyższych domyślnych progów. RÓŻNE ZDJĘCIA NA KAŻDYM SLAJDZIE: image_query dla każdej sekcji MUSI być specyficzne dla TEJ konkretnej sekcji, nie powtórzeniem ogólnej nazwy produktu/tematu z innych sekcji ani z hero_image_query — np. zamiast identycznego "Grand Theft Auto VI" na każdym slajdzie, użyj "Grand Theft Auto VI Vice City map", "Grand Theft Auto VI Lucia Jason protagonists", "Grand Theft Auto VI gameplay screenshot" itd. Identyczne lub prawie identyczne zapytania na wielu slajdach nieuchronnie trafiają w to samo jedno zdjęcie z internetu — różnicowanie zapytań to jedyny sposób, żeby różne slajdy dostały różne, trafne zdjęcia.',
      'max_output_tokens', 8000,
      'temperature', 0.5
    )
  )
  ON CONFLICT (owner_id, slug) DO NOTHING
  RETURNING id INTO v_forge_id;

  IF v_forge_id IS NOT NULL THEN
    INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
    SELECT v_forge_id, t.id, true
    FROM public.tools t
    WHERE t.slug = 'generate_document'
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
  VALUES (
    NEW.id, 'herald', 'H.E.R.A.L.D.', 'Strategy & Content',
    'Tworzy treści strategiczne i marketingowo-komunikacyjne: hasła, opisy, posty, komunikaty kampanii.',
    'gemini-2.5-flash',
    jsonb_build_object(
      'system_prompt',
      'Jesteś H.E.R.A.L.D. — modułem J.A.R.V.I.S. odpowiedzialnym za strategię i treści marketingowo-komunikacyjne. Twoim zadaniem jest pisanie tekstów: haseł, opisów produktów, postów social media, treści kampanii i komunikatów prasowych — zawsze dopasowanych tonem, językiem i długością do zadania. Pisz konkretnie i angażująco, unikaj pustych sloganów i ogólników. Gdy zadanie nie precyzuje kanału/formatu, przyjmij najbardziej uniwersalną formę: krótki tekst główny plus 2-3 warianty nagłówka. Nie masz dostępu do internetu ani do wcześniejszej rozmowy — pracuj wyłącznie z treścią przekazaną w zadaniu.'
    )
  )
  ON CONFLICT (owner_id, slug) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, authenticated, anon;
