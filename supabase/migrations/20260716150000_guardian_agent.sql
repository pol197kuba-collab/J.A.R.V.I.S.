-- =========================================================================
-- Guardian ("Strażnik") agent — system health monitoring.
--
-- A new specialised agent, not just new tools on the Orchestrator (unlike
-- every migration since wire_tool_registry.sql). Scope, deliberately narrow:
-- read-only observability + active smoke-tests over data we already log
-- (event_log, agent_runs) — no filesystem/code access, no UI test
-- automation. See TODO.md for the fuller reasoning.
--
-- This migration:
--   1. Seeds 3 new tools (implementations in src/lib/agents/tools.server.ts):
--      guardian_scan_errors, guardian_run_stats, guardian_check_delegation.
--   2. Creates a 'guardian' agent for every EXISTING user (unlike 'marketer',
--      which was created ad-hoc via the UI and was invisible from git —
--      the lesson from that mistake, per CODEX.md, is to always seed new
--      agents through a migration).
--   3. Binds the 3 new tools to every existing guardian agent.
--   4. Extends handle_new_user() so future users get the same agent + tools.
-- =========================================================================

-- ---------- 1. Seed the tool registry ----------
INSERT INTO public.tools (slug, name, description, input_schema, handler_kind, is_enabled)
VALUES
  (
    'guardian_scan_errors',
    'Guardian: Scan Errors',
    'Scan event_log and agent_runs for recent warnings/errors across the whole system.',
    '{"type":"object","properties":{"hours":{"type":"integer"},"limit":{"type":"integer"}}}'::jsonb,
    'internal',
    true
  ),
  (
    'guardian_run_stats',
    'Guardian: Run Stats',
    'Aggregate agent run statistics (status counts, avg latency) over a time window, per agent.',
    '{"type":"object","properties":{"hours":{"type":"integer"}}}'::jsonb,
    'internal',
    true
  ),
  (
    'guardian_check_delegation',
    'Guardian: Check Delegation',
    'Smoke-test that delegated agent runs correctly link back via parent_run_id.',
    '{"type":"object","properties":{"limit":{"type":"integer"}}}'::jsonb,
    'internal',
    true
  )
ON CONFLICT (slug) DO NOTHING;

-- ---------- 2 & 3. Create the guardian agent for every existing user, bind tools ----------
WITH new_guardians AS (
  INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
  SELECT DISTINCT
    owner_id,
    'guardian',
    'Strażnik',
    'Nadzorca logów i kondycji systemu',
    'Obserwuje logi zdarzeń i uruchomienia agentów, wykrywa błędy i anomalie, weryfikuje kondycję delegacji między agentami.',
    'gemini-2.5-flash',
    jsonb_build_object(
      'system_prompt',
      'Jesteś Strażnikiem — modułem J.A.R.V.I.S. odpowiedzialnym za monitoring kondycji systemu. Masz dostęp do trzech narzędzi: guardian_scan_errors (ostatnie błędy/ostrzeżenia z logów i nieudane uruchomienia agentów), guardian_run_stats (statystyki uruchomień w oknie czasowym — trendy błędów i wydajności per agent) oraz guardian_check_delegation (weryfikacja, czy śledzenie delegowanych zadań między agentami działa poprawnie). Zawsze najpierw sprawdzaj dane tymi narzędziami, zanim odpowiesz na pytanie o stan systemu — nigdy nie zgaduj. Jeśli nic niepokojącego nie znajdziesz, powiedz to wprost, zamiast wymyślać problem, który nie istnieje.'
    )
  FROM public.agents
  WHERE slug = 'orchestrator'
  ON CONFLICT (owner_id, slug) DO NOTHING
  RETURNING id
)
INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
SELECT g.id, t.id, true
FROM new_guardians g
CROSS JOIN public.tools t
WHERE t.slug IN ('guardian_scan_errors', 'guardian_run_stats', 'guardian_check_delegation')
ON CONFLICT (agent_id, tool_id) DO NOTHING;

-- ---------- 4. handle_new_user: create the guardian agent for future users too ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent_id uuid;
  v_guardian_id uuid;
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
      'remember', 'recall', 'create_task', 'list_tasks', 'update_task', 'delete_task'
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

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, authenticated, anon;
