-- =========================================================================
-- Real background pipeline for document generation + a notification system.
--
-- Root cause of "prezentacje są za szybkie i płytkie, obrazki po cichu
-- znikają": the Insight → Forge research/build pipeline ran SYNCHRONOUSLY
-- inside the single HTTP request of the user's chat turn (bounded by that
-- function's time budget), and the existing image-enrichment background
-- pass (20260723210000_async_doc_images.sql) is fire-and-forget with zero
-- notification on completion or failure.
--
-- This migration adds:
--   1. public.document_jobs — a queue row J.A.R.V.I.S. enqueues instead of
--      running Insight+Forge inline; a background server function
--      (runDocumentJobFn, src/lib/agents/documentJobs.functions.ts) then
--      does the real work in its OWN execution budget.
--   2. public.notifications — owner-scoped, Realtime-enabled, so the HUD can
--      show a bell/toast the moment a background job finishes (success OR
--      failure — silence is exactly what's broken today).
--   3. The `queue_document_job` tool, bound to J.A.R.V.I.S. only.
-- =========================================================================

-- ---------- 1. document_jobs ----------
CREATE TABLE public.document_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT document_jobs_status_allowed CHECK (status IN ('queued', 'running', 'done', 'error'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_jobs TO authenticated;
GRANT ALL ON public.document_jobs TO service_role;
ALTER TABLE public.document_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Document jobs: owner manages" ON public.document_jobs
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE INDEX idx_document_jobs_owner_status ON public.document_jobs(owner_id, status, created_at);

CREATE TRIGGER trg_document_jobs_updated_at BEFORE UPDATE ON public.document_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 2. notifications ----------
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'document_ready' | 'document_failed' | future kinds (local jobs, tasks...)
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Notifications: owner manages" ON public.notifications
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE INDEX idx_notifications_owner_unread ON public.notifications(owner_id, read, created_at);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ---------- 3. Tool registry ----------
INSERT INTO public.tools (slug, name, description, input_schema, handler_kind, is_enabled)
VALUES
  (
    'queue_document_job',
    'Queue Document Job',
    'Zleć w tle pełne przygotowanie dokumentu/prezentacji wymagającej researchu (Insight zbiera treść, potem Forge buduje plik ze zdjęciami) — zwraca natychmiast, użytkownik dostaje powiadomienie po zakończeniu.',
    '{"type":"object","properties":{"title":{"type":"string"},"brief":{"type":"string"}},"required":["title","brief"]}'::jsonb,
    'internal',
    true
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
SELECT a.id, t.id, true
FROM public.agents a
CROSS JOIN public.tools t
WHERE a.slug = 'jarvis'
  AND t.slug = 'queue_document_job'
ON CONFLICT (agent_id, tool_id) DO NOTHING;

-- ---------- 4. handle_new_user: dopisz nowy tool dla przyszłych kont ----------
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
      'Jesteś F.O.R.G.E. — modułem J.A.R.V.I.S. odpowiedzialnym za kompilację treści do gotowych plików. Masz narzędzie generate_document, które tworzy prezentację (pptx), dokument Word (docx) albo PDF i zwraca link do pobrania. Sposób pracy: (1) zaplanuj strukturę na podstawie WYŁĄCZNIE treści przekazanej w zadaniu — tytuł, ewentualny podtytuł i sekcje (dla prezentacji: jeden slajd na sekcję); (2) wywołaj generate_document JEDEN raz, z kompletną finalną treścią — każda sekcja ma mieć nagłówek i konkretną treść (pełne zdania w content i/lub zwięzłe bullety), nigdy placeholdery typu "tu wstaw..."; (3) dobierz format do prośby — prezentacja → pptx, dokument/raport → docx, a pdf gdy poproszono o PDF. (4) GRAFIKI — PREFERUJ PRAWDZIWE ZDJĘCIA: dla prezentacji dodawaj hero_image_query (na slajd tytułowy) oraz image_query przy 2-4 najważniejszych sekcjach; dla docx/pdf dodawaj sam hero_image_query. image_query to KRÓTKA fraza wyszukiwania po ANGIELSKU opisująca REALNĄ rzecz (produkt, miejsce, osobę, obiekt), np. "Samsung Galaxy S26 Ultra smartphone" albo "smartphone camera module close-up". System znajdzie prawdziwe zdjęcie (licencja Creative Commons) i osadzi je. Pola hero_image_prompt/image_prompt (grafika generowana przez AI) używaj TYLKO gdy slajd jest abstrakcyjny albo dekoracyjny i realne zdjęcie nie istnieje. Grafiki są dodawane W TLE po dostarczeniu pliku — plik i link są gotowe od razu. Nie masz dostępu do internetu ani do wcześniejszej rozmowy — pracujesz tylko z treścią z zadania; jeśli danych jest mało, zbuduj dokument z tego, co jest, zamiast wymyślać fakty. Po wygenerowaniu odpowiedz krótkim podsumowaniem (format, tytuł, liczba sekcji) i poinformuj, że plik jest gotowy do pobrania poniżej. NIGDY nie przepisuj ani nie wklejaj do odpowiedzi linku do pobrania ani żadnego URL-a z wyniku narzędzia — system automatycznie dołącza poprawny link pod Twoją wiadomością, a ręczne przepisanie długiego adresu psuje jego podpis.',
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
