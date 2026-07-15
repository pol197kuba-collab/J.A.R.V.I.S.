-- =========================================================================
-- CRUD parity gap: the chat agent could save notes and tasks but never
-- delete them (and had no way to discover a note's id to delete it, since
-- it has no memory of ids across conversations).
--
-- Adds list_notes / delete_note / delete_task tools (implementations in
-- src/lib/agents/tools.server.ts), seeds them into public.tools, binds them
-- to every existing 'orchestrator' agent, and extends handle_new_user() so
-- future users get them automatically.
--
-- update_task already supports status='done'/'cancelled' — no new tool
-- needed for "mark as done".
-- =========================================================================

INSERT INTO public.tools (slug, name, description, input_schema, handler_kind, is_enabled)
VALUES
  (
    'list_notes',
    'List Notes',
    'List or search the user''s saved notes, to find a note''s id before deleting it.',
    '{"type":"object","properties":{"query":{"type":"string"},"limit":{"type":"integer"}}}'::jsonb,
    'internal',
    true
  ),
  (
    'delete_note',
    'Delete Note',
    'Delete a note by id.',
    '{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}'::jsonb,
    'internal',
    true
  ),
  (
    'delete_task',
    'Delete Task',
    'Permanently delete a task by id.',
    '{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}'::jsonb,
    'internal',
    true
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.agent_tools (agent_id, tool_id, is_enabled)
SELECT a.id, t.id, true
FROM public.agents a
CROSS JOIN public.tools t
WHERE a.slug = 'orchestrator'
  AND t.slug IN ('list_notes', 'delete_note', 'delete_task')
ON CONFLICT (agent_id, tool_id) DO NOTHING;

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
    WHERE t.slug IN (
      'web_search', 'fetch_url', 'save_note', 'list_notes', 'delete_note',
      'remember', 'recall', 'create_task', 'list_tasks', 'update_task', 'delete_task'
    )
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, authenticated, anon;
