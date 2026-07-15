-- =========================================================================
-- Milestone 1: real agent capabilities — Memory + Tasks.
--
-- Turns the Orchestrator from a stateless "search + chat" agent into one that
-- can REMEMBER durable facts across sessions and TRACK/ASSIGN work items.
--
-- This migration:
--   1. Creates public.tasks (a lightweight, owner-scoped task queue the agents
--      can create, list and update). The `memories` table already existed
--      since the initial schema — it just had no tool wired to it, so no new
--      table is needed for memory.
--   2. Seeds public.tools with the 5 new tool slugs (remember, recall,
--      create_task, list_tasks, update_task). Implementations live in code
--      (src/lib/agents/tools.server.ts) — the slugs here MUST match.
--   3. Binds all 5 to every existing 'orchestrator' agent.
--   4. Extends handle_new_user() so future users auto-get the same bindings.
-- =========================================================================

-- ---------- 1. Tasks table ----------
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by_agent UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  -- Which agent should handle this (free-form slug, nullable = unassigned).
  -- Kept as text (not FK) so a task can be assigned to an agent slug before
  -- that agent row necessarily exists, mirroring how delegation targets work.
  assignee_slug TEXT,
  title TEXT NOT NULL,
  details TEXT,
  -- todo | in_progress | done | cancelled
  status TEXT NOT NULL DEFAULT 'todo',
  -- 1 = highest priority … 5 = lowest
  priority SMALLINT NOT NULL DEFAULT 3,
  result TEXT,
  due_at TIMESTAMPTZ,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tasks: owner manages" ON public.tasks
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_tasks_user_status ON public.tasks(user_id, status, priority, created_at);
CREATE INDEX idx_tasks_assignee ON public.tasks(user_id, assignee_slug);
CREATE INDEX idx_tasks_tags ON public.tasks USING GIN(tags);
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 2. Seed the tool registry ----------
INSERT INTO public.tools (slug, name, description, input_schema, handler_kind, is_enabled)
VALUES
  (
    'remember',
    'Remember',
    'Store a durable fact/preference in long-term memory so it survives across sessions.',
    '{"type":"object","properties":{"value":{"type":"string"},"key":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}},"importance":{"type":"integer"}},"required":["value"]}'::jsonb,
    'internal',
    true
  ),
  (
    'recall',
    'Recall',
    'Search long-term memory for previously stored facts/preferences.',
    '{"type":"object","properties":{"query":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}},"limit":{"type":"integer"}}}'::jsonb,
    'internal',
    true
  ),
  (
    'create_task',
    'Create Task',
    'Create a tracked task/to-do item, optionally assigned to a specific agent.',
    '{"type":"object","properties":{"title":{"type":"string"},"details":{"type":"string"},"assignee_slug":{"type":"string"},"priority":{"type":"integer"},"due_at":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}}},"required":["title"]}'::jsonb,
    'internal',
    true
  ),
  (
    'list_tasks',
    'List Tasks',
    'List the user''s tasks, optionally filtered by status or assignee.',
    '{"type":"object","properties":{"status":{"type":"string"},"assignee_slug":{"type":"string"},"limit":{"type":"integer"}}}'::jsonb,
    'internal',
    true
  ),
  (
    'update_task',
    'Update Task',
    'Update a task''s status, result, priority or details (e.g. mark it done).',
    '{"type":"object","properties":{"id":{"type":"string"},"status":{"type":"string"},"result":{"type":"string"},"priority":{"type":"integer"},"details":{"type":"string"}},"required":["id"]}'::jsonb,
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
  AND t.slug IN ('remember', 'recall', 'create_task', 'list_tasks', 'update_task')
ON CONFLICT (agent_id, tool_id) DO NOTHING;

-- ---------- 4. handle_new_user: auto-bind the new tools too ----------
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
      'web_search', 'fetch_url', 'save_note',
      'remember', 'recall', 'create_task', 'list_tasks', 'update_task'
    )
    ON CONFLICT (agent_id, tool_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, authenticated, anon;
