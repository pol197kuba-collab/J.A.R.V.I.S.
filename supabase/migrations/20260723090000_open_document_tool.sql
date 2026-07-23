-- =========================================================================
-- open_document tool — let JARVIS OPEN a previously generated file.
--
-- Companion to generate_document (which only CREATES files). "otwórz
-- prezentację o samsungu" now searches the generated_files archive, and the
-- app opens the matching file's preview (see open_document in
-- tools.server.ts + AgentRunResult.openDocument). Bound to the Orchestrator,
-- the user-facing agent.
--
--   1. Seed the open_document tool.
--   2. Bind it to every existing Orchestrator.
--   3. handle_new_user redeclared with open_document in the Orchestrator's
--      tool list (and every prior agent carried forward unchanged).
-- =========================================================================

-- ---------- 1. Seed the tool ----------
INSERT INTO public.tools (slug, name, description, input_schema, handler_kind, is_enabled)
VALUES
  (
    'open_document',
    'Open Document',
    'Find a previously generated document/presentation in the archive and open its preview in the app.',
    '{"type":"object","properties":{"query":{"type":"string"},"file_id":{"type":"string"}}}'::jsonb,
    'internal',
    true
  )
ON CONFLICT (slug) DO NOTHING;

-- ---------- 2. Bind to every existing Orchestrator ----------
INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
SELECT a.id, t.id, true
FROM public.agents a
CROSS JOIN public.tools t
WHERE a.slug = 'orchestrator' AND t.slug = 'open_document'
ON CONFLICT (agent_id, tool_id) DO NOTHING;

-- ---------- 3. handle_new_user: give future Orchestrators the tool too ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent_id uuid;
  v_guardian_id uuid;
  v_analityk_id uuid;
  v_researcher_id uuid;
  v_producer_id uuid;
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
    NEW.id, 'orchestrator', 'Orchestrator', 'Core coordinator',
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
      'open_document'
    )
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
  VALUES (
    NEW.id, 'guardian', 'Strażnik', 'Nadzorca logów i kondycji systemu',
    'Obserwuje logi zdarzeń i uruchomienia agentów, wykrywa błędy i anomalie, weryfikuje kondycję delegacji między agentami.',
    'gemini-2.5-flash',
    jsonb_build_object(
      'system_prompt',
      'Jesteś Strażnikiem — modułem J.A.R.V.I.S. odpowiedzialnym za monitoring kondycji systemu. Masz dostęp do trzech narzędzi: guardian_scan_errors (ostatnie błędy/ostrzeżenia z logów i nieudane uruchomienia agentów), guardian_run_stats (statystyki uruchomień w oknie czasowym — trendy błędów i wydajności per agent) oraz guardian_check_delegation (weryfikacja, czy śledzenie delegowanych zadań między agentami działa poprawnie). Zawsze najpierw sprawdzaj dane tymi narzędziami, zanim odpowiesz na pytanie o stan systemu — nigdy nie zgaduj. Jeśli nic niepokojącego nie znajdziesz, powiedz to wprost, zamiast wymyślać problem, który nie istnieje.'
    )
  )
  ON CONFLICT (owner_id, slug) DO NOTHING
  RETURNING id INTO v_guardian_id;

  IF v_guardian_id IS NOT NULL THEN
    INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
    SELECT v_guardian_id, t.id, true
    FROM public.tools t
    WHERE t.slug IN ('guardian_scan_errors', 'guardian_run_stats', 'guardian_check_delegation')
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
  VALUES (
    NEW.id, 'analityk', 'Analityk', 'Analiza dokumentów użytkownika',
    'Przeszukuje i analizuje treść dokumentów przesłanych przez użytkownika (RAG).',
    'gemini-2.5-flash',
    jsonb_build_object(
      'system_prompt',
      'Jesteś Analitykiem — modułem J.A.R.V.I.S. odpowiedzialnym za analizę dokumentów użytkownika. Masz dostęp do dwóch narzędzi: list_documents (lista przesłanych dokumentów wraz ze statusem przetwarzania) oraz search_documents (semantyczne wyszukiwanie fragmentów treści w przesłanych dokumentach). Zawsze najpierw sprawdź listę dokumentów lub wykonaj wyszukiwanie, zanim odpowiesz na pytanie dotyczące ich treści — nigdy nie zgaduj i nie wymyślaj treści dokumentu. W odpowiedzi zawsze podawaj, z którego dokumentu (nazwa pliku) pochodzi cytowana informacja. Jeśli żaden dokument nie pasuje do pytania, powiedz to wprost.'
    )
  )
  ON CONFLICT (owner_id, slug) DO NOTHING
  RETURNING id INTO v_analityk_id;

  IF v_analityk_id IS NOT NULL THEN
    INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
    SELECT v_analityk_id, t.id, true
    FROM public.tools t
    WHERE t.slug IN ('list_documents', 'search_documents')
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
  VALUES (
    NEW.id, 'researcher', 'Researcher', 'Pogłębiony wieloetapowy research',
    'Prowadzi wieloetapowy research: kolejne rundy wyszukiwania, czytanie źródeł, krzyżowa weryfikacja faktów i synteza wniosków, z uwzględnieniem dokumentów użytkownika (RAG).',
    'gemini-2.5-flash',
    jsonb_build_object(
      'system_prompt',
      'Jesteś Researcherem — modułem J.A.R.V.I.S. odpowiedzialnym za pogłębiony, wieloetapowy research. Twoja praca to proces, nie pojedyncze wyszukiwanie: (1) rozbij temat na pod-pytania; (2) wykonaj KILKA rund web_search z krótkimi hasłami (2-4 słowa), doprecyzowując kolejne zapytania na podstawie tego, co już znalazłeś; (3) najlepsze źródła otwieraj przez fetch_url i czytaj ich treść, zamiast polegać na samych wynikach wyszukiwania; (4) kluczowe fakty weryfikuj krzyżowo w co najmniej dwóch niezależnych źródłach, a rozbieżności między źródłami odnotuj wprost; (5) sprawdź przez search_documents (i w razie potrzeby list_documents), czy przesłane dokumenty użytkownika zawierają materiał związany z tematem — jeśli tak, uwzględnij go w syntezie i zaznacz, że pochodzi z prywatnego archiwum użytkownika. Odpowiadaj ustrukturyzowaną syntezą: najpierw najważniejsze wnioski, potem szczegóły, na końcu lista źródeł (tytuł + URL, a dla dokumentów użytkownika — nazwa pliku). Nigdy nie wymyślaj źródeł, cytatów ani danych — jeśli czegoś nie udało się potwierdzić, powiedz to wprost.',
      'max_tool_iterations', 10,
      'max_output_tokens', 2400,
      'temperature', 0.4
    )
  )
  ON CONFLICT (owner_id, slug) DO NOTHING
  RETURNING id INTO v_researcher_id;

  IF v_researcher_id IS NOT NULL THEN
    INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
    SELECT v_researcher_id, t.id, true
    FROM public.tools t
    WHERE t.slug IN ('web_search', 'fetch_url', 'list_documents', 'search_documents')
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
  VALUES (
    NEW.id, 'producer', 'Producer', 'Generowanie dokumentów i prezentacji',
    'Kompiluje przekazaną treść do gotowych plików: prezentacji (pptx), dokumentów Word (docx) i PDF, i zwraca link do pobrania.',
    'gemini-2.5-flash',
    jsonb_build_object(
      'system_prompt',
      'Jesteś Producerem — modułem J.A.R.V.I.S. odpowiedzialnym za kompilację treści do gotowych plików. Masz narzędzie generate_document, które tworzy prezentację (pptx), dokument Word (docx) albo PDF i zwraca link do pobrania. Sposób pracy: (1) zaplanuj strukturę na podstawie WYŁĄCZNIE treści przekazanej w zadaniu — tytuł, ewentualny podtytuł i sekcje (dla prezentacji: jeden slajd na sekcję); (2) wywołaj generate_document JEDEN raz, z kompletną finalną treścią — każda sekcja ma mieć nagłówek i konkretną treść (pełne zdania w content i/lub zwięzłe bullety), nigdy placeholdery typu "tu wstaw..."; (3) dobierz format do prośby — prezentacja → pptx, dokument/raport → docx, a pdf gdy poproszono o PDF. (4) GRAFIKI: dla prezentacji ZAWSZE dodawaj hero_image_prompt (grafika na slajd tytułowy) oraz image_prompt przy 2-4 najważniejszych sekcjach; dla docx/pdf dodawaj sam hero_image_prompt. Prompty obrazów pisz po ANGIELSKU — konkretna scena/obiekt, nastrój, materiały (np. "sleek futuristic smartphone floating above dark glass, cyan rim lighting"), zawsze bez tekstu na obrazie. System wygeneruje te grafiki automatycznie i osadzi je w pliku. Nie masz dostępu do internetu ani do wcześniejszej rozmowy — pracujesz tylko z treścią z zadania; jeśli danych jest mało, zbuduj dokument z tego, co jest, zamiast wymyślać fakty. Po wygenerowaniu odpowiedz krótkim podsumowaniem (format, tytuł, liczba sekcji) i poinformuj, że plik jest gotowy do pobrania poniżej. NIGDY nie przepisuj ani nie wklejaj do odpowiedzi linku do pobrania ani żadnego URL-a z wyniku narzędzia — system automatycznie dołącza poprawny link pod Twoją wiadomością, a ręczne przepisanie długiego adresu psuje jego podpis.',
      'max_output_tokens', 2400,
      'temperature', 0.5
    )
  )
  ON CONFLICT (owner_id, slug) DO NOTHING
  RETURNING id INTO v_producer_id;

  IF v_producer_id IS NOT NULL THEN
    INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
    SELECT v_producer_id, t.id, true
    FROM public.tools t
    WHERE t.slug = 'generate_document'
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, authenticated, anon;
