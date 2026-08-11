-- =========================================================================
-- Agent identity refactor — Stark-style acronym rebrand + status-widget
-- structure.
--
-- Renames every existing agent's slug/name/role (and, where we own the
-- text, the self-identification line inside config.system_prompt) to the
-- new Stark Industries-style acronym identities:
--
--   orchestrator -> jarvis    "J.A.R.V.I.S."  Primary Brain / Core
--   guardian     -> shield    "S.H.I.E.L.D."  Security & Compliance
--   researcher   -> insight   "I.N.S.I.G.H.T." Deep Research
--   marketer     -> herald    "H.E.R.A.L.D."  Strategy & Content
--   producer     -> forge     "F.O.R.G.E."    Content Creation / Execution
--   analityk     -> metric    "M.E.T.R.I.C."  Performance Insights
--
-- 'marketer' -> 'herald' deliberately avoids the literal word "vision" for
-- the Strategy & Content module: an unrelated /vision route + VisionScanner
-- component (optical camera scanner) already own that word in this
-- codebase, and reusing it as an agent slug/event-log source would be a
-- constant source of confusion in logs, code search and the delegate_to_agent
-- vocabulary. H.E.R.A.L.D. keeps the Stark/Avengers acronym house style
-- (see J.A.R.V.I.S., S.H.I.E.L.D.) without the collision.
--
-- 'marketer' itself was historically created ad-hoc via the UI/DB (see
-- 20260716150000_guardian_agent.sql's header comment and TODO.md) rather
-- than through a migration, so this file also seeds 'herald' properly for
-- every existing user (backfill) and for all future users (handle_new_user),
-- closing that long-standing gap instead of just renaming it.
--
-- Also adds the columns the new interactive agent-status widget needs:
--   status              (existing column) — now constrained to
--                        'idle' | 'busy' | 'error'.
--   current_task         text   — human-readable label of what the agent is
--                                 doing right now (null when idle).
--   progress              smallint 0-100 — coarse completion percentage of
--                                 the current task.
--   time_elapsed_seconds  integer — wall-clock duration of the current /
--                                 most recently finished task.
-- runOrchestrator (src/lib/agents/runtime.server.ts) now writes these on
-- every run start/finish, so the columns are live, not decorative.
-- =========================================================================

-- ---------- 1. Widget-status columns on public.agents ----------
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS current_task text,
  ADD COLUMN IF NOT EXISTS progress smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_elapsed_seconds integer NOT NULL DEFAULT 0;

-- Normalise any status value a from-scratch rebuild or manual edit might
-- have left outside the widget's vocabulary, so the new CHECK below can
-- never fail to apply.
UPDATE public.agents SET status = 'idle' WHERE status NOT IN ('idle', 'busy', 'error');

ALTER TABLE public.agents
  ADD CONSTRAINT agents_status_allowed CHECK (status IN ('idle', 'busy', 'error'));
ALTER TABLE public.agents
  ADD CONSTRAINT agents_progress_range CHECK (progress BETWEEN 0 AND 100);
ALTER TABLE public.agents
  ADD CONSTRAINT agents_time_elapsed_non_negative CHECK (time_elapsed_seconds >= 0);

-- ---------- 2. Rename existing agent rows (identity + own prompt text) ----------
-- Each UPDATE renames slug/name/role and, only when this agent actually owns
-- a config.system_prompt (guardian/analityk/researcher/producer always do;
-- marketer might, depending on how it was hand-created), swaps the leading
-- Polish self-identification line for the new acronym. The rest of each
-- prompt (instructions, tool names) is untouched — only the "Jesteś X —"
-- opener changes.

UPDATE public.agents
SET slug = 'jarvis', name = 'J.A.R.V.I.S.', role = 'Primary Brain / Core'
WHERE slug = 'orchestrator';

UPDATE public.agents
SET
  slug = 'shield',
  name = 'S.H.I.E.L.D.',
  role = 'Security & Compliance',
  config = CASE
    WHEN config ? 'system_prompt' THEN jsonb_set(
      config,
      '{system_prompt}',
      to_jsonb(regexp_replace(
        config ->> 'system_prompt',
        '^Jesteś Strażnikiem — modułem J\.A\.R\.V\.I\.S\.',
        'Jesteś S.H.I.E.L.D. — modułem J.A.R.V.I.S.'
      ))
    )
    ELSE config
  END
WHERE slug = 'guardian';

UPDATE public.agents
SET
  slug = 'metric',
  name = 'M.E.T.R.I.C.',
  role = 'Performance Insights',
  config = CASE
    WHEN config ? 'system_prompt' THEN jsonb_set(
      config,
      '{system_prompt}',
      to_jsonb(regexp_replace(
        config ->> 'system_prompt',
        '^Jesteś Analitykiem — modułem J\.A\.R\.V\.I\.S\.',
        'Jesteś M.E.T.R.I.C. — modułem J.A.R.V.I.S.'
      ))
    )
    ELSE config
  END
WHERE slug = 'analityk';

UPDATE public.agents
SET
  slug = 'insight',
  name = 'I.N.S.I.G.H.T.',
  role = 'Deep Research',
  config = CASE
    WHEN config ? 'system_prompt' THEN jsonb_set(
      config,
      '{system_prompt}',
      to_jsonb(regexp_replace(
        config ->> 'system_prompt',
        '^Jesteś Researcherem — modułem J\.A\.R\.V\.I\.S\.',
        'Jesteś I.N.S.I.G.H.T. — modułem J.A.R.V.I.S.'
      ))
    )
    ELSE config
  END
WHERE slug = 'researcher';

UPDATE public.agents
SET
  slug = 'forge',
  name = 'F.O.R.G.E.',
  role = 'Content Creation / Execution',
  config = CASE
    WHEN config ? 'system_prompt' THEN jsonb_set(
      config,
      '{system_prompt}',
      to_jsonb(regexp_replace(
        config ->> 'system_prompt',
        '^Jesteś Producerem — modułem J\.A\.R\.V\.I\.S\.',
        'Jesteś F.O.R.G.E. — modułem J.A.R.V.I.S.'
      ))
    )
    ELSE config
  END
WHERE slug = 'producer';

-- marketer's prompt text (if any) was never captured in a migration, so the
-- exact wording is unknown here — best-effort, non-anchored, global replace
-- that safely no-ops if "Jesteś Marketerem" never occurs in it.
UPDATE public.agents
SET
  slug = 'herald',
  name = 'H.E.R.A.L.D.',
  role = 'Strategy & Content',
  config = CASE
    WHEN config ? 'system_prompt' THEN jsonb_set(
      config,
      '{system_prompt}',
      to_jsonb(regexp_replace(config ->> 'system_prompt', 'Jesteś Marketerem', 'Jesteś H.E.R.A.L.D.', 'g'))
    )
    ELSE config
  END
WHERE slug = 'marketer';

-- ---------- 3. Propagate the rename to every free-form slug reference ----------
-- tasks.assignee_slug, user_settings.active_agent_slug and the event-log
-- `source` columns all store the agent slug as plain text (by design — see
-- tasks.assignee_slug's column comment), not a foreign key, so they need
-- their own rename pass.
DO $$
DECLARE
  mapping CONSTANT jsonb := '{
    "orchestrator": "jarvis",
    "guardian": "shield",
    "researcher": "insight",
    "marketer": "herald",
    "producer": "forge",
    "analityk": "metric"
  }'::jsonb;
  old_slug text;
BEGIN
  FOR old_slug IN SELECT jsonb_object_keys(mapping) LOOP
    UPDATE public.tasks SET assignee_slug = mapping ->> old_slug WHERE assignee_slug = old_slug;
    UPDATE public.user_settings SET active_agent_slug = mapping ->> old_slug WHERE active_agent_slug = old_slug;
    UPDATE public.system_events SET source = mapping ->> old_slug WHERE source = old_slug;
    UPDATE public.event_log SET source = mapping ->> old_slug WHERE source = old_slug;
  END LOOP;
END $$;

ALTER TABLE public.user_settings ALTER COLUMN active_agent_slug SET DEFAULT 'jarvis';

-- ---------- 4. Re-brand the S.H.I.E.L.D. tool labels ----------
-- Tool `slug`s stay exactly as-is (guardian_scan_errors, ...) — they're
-- routing keys matched against src/lib/agents/tools.server.ts and renaming
-- them would be a functional change, not a cosmetic one. Only the
-- display `name` shown in Settings / the Agent Console updates.
UPDATE public.tools SET name = 'S.H.I.E.L.D.: Scan Errors' WHERE slug = 'guardian_scan_errors';
UPDATE public.tools SET name = 'S.H.I.E.L.D.: Run Stats' WHERE slug = 'guardian_run_stats';
UPDATE public.tools SET name = 'S.H.I.E.L.D.: Check Delegation' WHERE slug = 'guardian_check_delegation';

-- ---------- 5. Backfill H.E.R.A.L.D. for every EXISTING user missing it ----------
-- Same shape as guardian_agent.sql's backfill — 'herald' gets no tool
-- bindings, same as 'marketer' before it (a prompt-only persona; see
-- TODO.md, "Cheap to add: prompt-only persona like Marketer").
INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
SELECT DISTINCT
  a.owner_id,
  'herald',
  'H.E.R.A.L.D.',
  'Strategy & Content',
  'Tworzy treści strategiczne i marketingowo-komunikacyjne: hasła, opisy, posty, komunikaty kampanii.',
  'gemini-2.5-flash',
  jsonb_build_object(
    'system_prompt',
    'Jesteś H.E.R.A.L.D. — modułem J.A.R.V.I.S. odpowiedzialnym za strategię i treści marketingowo-komunikacyjne. Twoim zadaniem jest pisanie tekstów: haseł, opisów produktów, postów social media, treści kampanii i komunikatów prasowych — zawsze dopasowanych tonem, językiem i długością do zadania. Pisz konkretnie i angażująco, unikaj pustych sloganów i ogólników. Gdy zadanie nie precyzuje kanału/formatu, przyjmij najbardziej uniwersalną formę: krótki tekst główny plus 2-3 warianty nagłówka. Nie masz dostępu do internetu ani do wcześniejszej rozmowy — pracuj wyłącznie z treścią przekazaną w zadaniu.'
  )
FROM public.agents a
WHERE a.slug = 'jarvis'
  AND NOT EXISTS (
    SELECT 1 FROM public.agents h WHERE h.owner_id = a.owner_id AND h.slug = 'herald'
  )
ON CONFLICT (owner_id, slug) DO NOTHING;

-- ---------- 6. handle_new_user: seed the renamed roster (+ H.E.R.A.L.D.) for future users ----------
-- Full redeclaration carrying every prior agent forward, as always.
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
      'remember', 'recall', 'create_task', 'list_tasks', 'update_task', 'delete_task'
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

  -- H.E.R.A.L.D. — Strategy & Content. Prompt-only persona, no dedicated
  -- tools (same shape 'marketer' always had) — closes the "seeded ad-hoc via
  -- the UI, never in a migration" gap called out in this file's header.
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
