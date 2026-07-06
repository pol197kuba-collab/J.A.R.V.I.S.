-- =========================================================================
-- Wire the tools / agent_tools registry to the Orchestrator runtime.
--
-- Until now these tables existed in the schema but the code
-- (src/lib/agents/tools.server.ts) called a hardcoded array directly,
-- ignoring the DB entirely. This migration:
--   1. Adds a per-agent enable/disable flag on top of the binding itself,
--      so a tool can stay bound to an agent but temporarily switched off
--      (Settings page toggle) without deleting history/permissions.
--   2. Seeds public.tools with the 3 tools currently implemented in code.
--   3. Binds them to the existing 'orchestrator' agent(s).
--   4. Updates handle_new_user() so future users get the same bindings
--      automatically, and stops hardcoding the JARVIS persona text in SQL
--      (moved to the single source of truth: src/lib/ai/persona.ts). A NULL
--      config.system_prompt means "use the code-level default"; per-agent
--      overrides remain possible by setting that key explicitly.
-- =========================================================================

-- ---------- 1. Per-agent tool toggle ----------
ALTER TABLE public.agent_tools
  ADD COLUMN is_enabled boolean NOT NULL DEFAULT true;

-- ---------- 2. Seed the tool registry ----------
INSERT INTO public.tools (slug, name, description, input_schema, handler_kind, is_enabled)
VALUES
  (
    'web_search',
    'Web Search',
    'Search the live web via Google Search grounding for factual, current-event, price or research questions.',
    '{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}'::jsonb,
    'internal',
    true
  ),
  (
    'fetch_url',
    'Fetch URL',
    'Fetch the plain-text contents of a public URL (first ~12kB).',
    '{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}'::jsonb,
    'internal',
    true
  ),
  (
    'save_note',
    'Save Note',
    'Save a note to the user''s personal notes widget.',
    '{"type":"object","properties":{"title":{"type":"string"},"body":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}}},"required":["title","body"]}'::jsonb,
    'internal',
    true
  )
ON CONFLICT (slug) DO NOTHING;

-- ---------- 3. Bind them to every existing 'orchestrator' agent ----------
INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
SELECT a.id, t.id, true
FROM public.agents a
CROSS JOIN public.tools t
WHERE a.slug = 'orchestrator'
  AND t.slug IN ('web_search', 'fetch_url', 'save_note')
ON CONFLICT (agent_id, tool_id) DO NOTHING;

-- ---------- 4. handle_new_user: auto-bind tools, drop hardcoded persona ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent_id uuid;
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
    WHERE t.slug IN ('web_search', 'fetch_url', 'save_note')
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, authenticated, anon;

-- ---------- 5. Drop the now-obsolete hardcoded persona text ----------
-- The code-level DEFAULT_SYSTEM_PROMPT (runtime.server.ts, built from
-- src/lib/ai/persona.ts) takes over for any agent without an explicit
-- override.
UPDATE public.agents
SET config = config - 'system_prompt'
WHERE slug = 'orchestrator' AND config ? 'system_prompt';
