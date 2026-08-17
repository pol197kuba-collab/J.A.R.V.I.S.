-- =========================================================================
-- Dev Wing — Phase 0: data model only, zero behavior change.
--
-- Groundwork for letting J.A.R.V.I.S. run real programming tasks (via a
-- future D.R.O.I.D. coordinator agent + GitHub Actions/Claude Code Action —
-- not built yet). This migration only adds the schema:
--
--   1. public.projects       — one row per project the user is developing.
--   2. public.tasks.project_id — nullable link; existing tasks are
--      unaffected (NULL = general task, exactly like today).
--   3. public.dev_sessions   — audit log of coding sessions dispatched
--      against a task (queued/running/review/done/failed + PR link). Not
--      written to yet — no code creates rows here until the coordinator
--      agent and its tools ship.
--
-- Seeds exactly one pilot project for every existing user, pointing at this
-- very repository — the agreed pilot. Not added to handle_new_user(): a
-- project pointing at the J.A.R.V.I.S. dev repo isn't a sensible default for
-- a hypothetical new signup of this app, unlike the agent roster.
-- =========================================================================

-- ---------- 1. projects ----------
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- GitHub repo this project's dev tasks are dispatched against. Nullable —
  -- a project can exist before it's wired to a repo.
  repo_owner TEXT,
  repo_name TEXT,
  -- Free-text "CLAUDE.md for this project" — stack, conventions, how to run
  -- tests. Prepended to every dev task's prompt once the coordinator ships.
  context_doc TEXT,
  -- active | paused | archived
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Projects: owner manages" ON public.projects
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE INDEX idx_projects_owner_status ON public.projects(owner_id, status);
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 2. tasks.project_id ----------
ALTER TABLE public.tasks
  ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX idx_tasks_project ON public.tasks(user_id, project_id);

-- ---------- 3. dev_sessions ----------
CREATE TABLE public.dev_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  -- queued | running | review | done | failed
  status TEXT NOT NULL DEFAULT 'queued',
  pr_url TEXT,
  pr_number INTEGER,
  summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dev_sessions TO authenticated;
GRANT ALL ON public.dev_sessions TO service_role;
ALTER TABLE public.dev_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dev sessions: owner manages" ON public.dev_sessions
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE INDEX idx_dev_sessions_project ON public.dev_sessions(owner_id, project_id, status);
CREATE INDEX idx_dev_sessions_task ON public.dev_sessions(task_id);

-- ---------- 4. Seed the pilot project for every existing user ----------
INSERT INTO public.projects (owner_id, name, description, repo_owner, repo_name, context_doc, status)
SELECT DISTINCT
  owner_id,
  'J.A.R.V.I.S.',
  'Ten system — pilotażowy projekt dla D.R.O.I.D.-a, zanim ruszy na inne repozytoria.',
  'pol197kuba-collab',
  'J.A.R.V.I.S.',
  'Zobacz CLAUDE.md w repo — konwencje projektu, wzorce PR (restart brancha z main, prettier + eslint przed push), styl kodu.',
  'active'
FROM public.agents
WHERE slug = 'jarvis'
ON CONFLICT (owner_id, name) DO NOTHING;
