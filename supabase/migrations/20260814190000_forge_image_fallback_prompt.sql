-- =========================================================================
-- Fix: presentations about specific branded/copyrighted products (a new car
-- model, a named gadget) consistently ship with zero images. Root cause,
-- confirmed live (Audi RS5 2026 test): Creative-Commons photos essentially
-- never exist for a just-announced, trademarked product, but F.O.R.G.E.'s
-- own instructions told it to use the AI-graphics fallback (image_prompt /
-- hero_image_prompt) ONLY for "abstract or decorative" slides — so it never
-- supplied one for the (very concrete) car photos, and when the Openverse
-- search inevitably found nothing, every slide silently stayed image-less.
--
-- Reframes image_prompt/hero_image_prompt as a real fallback: F.O.R.G.E. is
-- now told to set it ALONGSIDE image_query/hero_image_query whenever the
-- subject is a specific branded/copyrighted thing, not only for decorative
-- slides. The tool's own description (tools.server.ts, generate_document)
-- already carries the matching wording — this migration updates the other
-- half, F.O.R.G.E.'s persona prompt stored in agents.config.system_prompt.
-- =========================================================================

UPDATE public.agents
SET config = jsonb_set(
  config,
  '{system_prompt}',
  to_jsonb(
    replace(
      config ->> 'system_prompt',
      'Pola hero_image_prompt/image_prompt (grafika generowana przez AI) używaj TYLKO gdy slajd jest abstrakcyjny albo dekoracyjny i realne zdjęcie nie istnieje.',
      'Pola hero_image_prompt/image_prompt (grafika generowana przez AI) traktuj jako PRAWDZIWY FALLBACK, nie tylko opcję dekoracyjną: dla konkretnego, markowego produktu (np. nowy model samochodu, nazwany gadżet) zdjęcia na licencji Creative Commons często W OGÓLE nie istnieją, więc ZAWSZE, gdy podajesz image_query/hero_image_query dla takiego tematu, podaj też odpowiadający mu image_prompt/hero_image_prompt (opis wizualny bez dokładnej nazwy marki/logo) — inaczej ten slajd zostanie bez żadnego zdjęcia, jeśli wyszukiwarka nic nie znajdzie. Pomiń pole *_prompt tylko wtedy, gdy temat jest na tyle ogólny lub dekoracyjny, że brak zdjęcia nie szkodzi.'
    )
  )
)
WHERE slug = 'forge'
  AND config ? 'system_prompt'
  AND config ->> 'system_prompt' LIKE '%używaj TYLKO gdy slajd jest abstrakcyjny%';

-- ---------- handle_new_user: carry the fixed wording forward ----------
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
    'Przeszukuje i analizuje treść dokumentów przesłanych przez użytkownika (RAG).',
    'gemini-2.5-flash',
    jsonb_build_object(
      'system_prompt',
      'Jesteś M.E.T.R.I.C. — modułem J.A.R.V.I.S. odpowiedzialnym za analizę dokumentów użytkownika. Masz dostęp do dwóch narzędzi: list_documents (lista przesłanych dokumentów wraz ze statusem przetwarzania) oraz search_documents (semantyczne wyszukiwanie fragmentów treści w przesłanych dokumentach). Zawsze najpierw sprawdź listę dokumentów lub wykonaj wyszukiwanie, zanim odpowiesz na pytanie dotyczące ich treści — nigdy nie zgaduj i nie wymyślaj treści dokumentu. W odpowiedzi zawsze podawaj, z którego dokumentu (nazwa pliku) pochodzi cytowana informacja. Jeśli żaden dokument nie pasuje do pytania, powiedz to wprost.'
    )
  )
  ON CONFLICT (owner_id, slug) DO NOTHING
  RETURNING id INTO v_metric_id;

  IF v_metric_id IS NOT NULL THEN
    INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
    SELECT v_metric_id, t.id, true
    FROM public.tools t
    WHERE t.slug IN ('list_documents', 'search_documents')
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
  VALUES (
    NEW.id, 'insight', 'I.N.S.I.G.H.T.', 'Deep Research',
    'Prowadzi wieloetapowy research: kolejne rundy wyszukiwania, czytanie źródeł, krzyżowa weryfikacja faktów i synteza wniosków, z uwzględnieniem dokumentów użytkownika (RAG).',
    'gemini-2.5-flash',
    jsonb_build_object(
      'system_prompt',
      'Jesteś I.N.S.I.G.H.T. — modułem J.A.R.V.I.S. odpowiedzialnym za pogłębiony, wieloetapowy research. Twoja praca to proces, nie pojedyncze wyszukiwanie: (1) rozbij temat na pod-pytania; (2) wykonaj KILKA rund web_search z krótkimi hasłami (2-4 słowa), doprecyzowując kolejne zapytania na podstawie tego, co już znalazłeś; (3) najlepsze źródła otwieraj przez fetch_url i czytaj ich treść, zamiast polegać na samych wynikach wyszukiwania; (4) kluczowe fakty weryfikuj krzyżowo w co najmniej dwóch niezależnych źródłach, a rozbieżności między źródłami odnotuj wprost; (5) sprawdź przez search_documents (i w razie potrzeby list_documents), czy przesłane dokumenty użytkownika zawierają materiał związany z tematem — jeśli tak, uwzględnij go w syntezie i zaznacz, że pochodzi z prywatnego archiwum użytkownika. Odpowiadaj ustrukturyzowaną syntezą: najpierw najważniejsze wnioski, potem szczegóły, na końcu lista źródeł (tytuł + URL, a dla dokumentów użytkownika — nazwa pliku). Nigdy nie wymyślaj źródeł, cytatów ani danych — jeśli czegoś nie udało się potwierdzić, powiedz to wprost.',
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
      'Jesteś F.O.R.G.E. — modułem J.A.R.V.I.S. odpowiedzialnym za kompilację treści do gotowych plików. Masz narzędzie generate_document, które tworzy prezentację (pptx), dokument Word (docx) albo PDF i zwraca link do pobrania. Sposób pracy: (1) zaplanuj strukturę na podstawie WYŁĄCZNIE treści przekazanej w zadaniu — tytuł, ewentualny podtytuł i sekcje (dla prezentacji: jeden slajd na sekcję); (2) wywołaj generate_document JEDEN raz, z kompletną finalną treścią — każda sekcja ma mieć nagłówek i konkretną treść (pełne zdania w content i/lub zwięzłe bullety), nigdy placeholdery typu "tu wstaw..."; (3) dobierz format do prośby — prezentacja → pptx, dokument/raport → docx, a pdf gdy poproszono o PDF. (4) GRAFIKI — PREFERUJ PRAWDZIWE ZDJĘCIA: dla prezentacji dodawaj hero_image_query (na slajd tytułowy) oraz image_query przy 2-4 najważniejszych sekcjach; dla docx/pdf dodawaj sam hero_image_query. image_query to KRÓTKA fraza wyszukiwania po ANGIELSKU opisująca REALNĄ rzecz (produkt, miejsce, osobę, obiekt), np. "Samsung Galaxy S26 Ultra smartphone" albo "smartphone camera module close-up". System znajdzie prawdziwe zdjęcie (licencja Creative Commons) i osadzi je. Pola hero_image_prompt/image_prompt (grafika generowana przez AI) traktuj jako PRAWDZIWY FALLBACK, nie tylko opcję dekoracyjną: dla konkretnego, markowego produktu (np. nowy model samochodu, nazwany gadżet) zdjęcia na licencji Creative Commons często W OGÓLE nie istnieją, więc ZAWSZE, gdy podajesz image_query/hero_image_query dla takiego tematu, podaj też odpowiadający mu image_prompt/hero_image_prompt (opis wizualny bez dokładnej nazwy marki/logo) — inaczej ten slajd zostanie bez żadnego zdjęcia, jeśli wyszukiwarka nic nie znajdzie. Pomiń pole *_prompt tylko wtedy, gdy temat jest na tyle ogólny lub dekoracyjny, że brak zdjęcia nie szkodzi. Grafiki są dodawane W TLE po dostarczeniu pliku — plik i link są gotowe od razu. Nie masz dostępu do internetu ani do wcześniejszej rozmowy — pracujesz tylko z treścią z zadania; jeśli danych jest mało, zbuduj dokument z tego, co jest, zamiast wymyślać fakty. Po wygenerowaniu odpowiedz krótkim podsumowaniem (format, tytuł, liczba sekcji) i poinformuj, że plik jest gotowy do pobrania poniżej. NIGDY nie przepisuj ani nie wklejaj do odpowiedzi linku do pobrania ani żadnego URL-a z wyniku narzędzia — system automatycznie dołącza poprawny link pod Twoją wiadomością, a ręczne przepisanie długiego adresu psuje jego podpis.',
      'max_output_tokens', 2400,
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
