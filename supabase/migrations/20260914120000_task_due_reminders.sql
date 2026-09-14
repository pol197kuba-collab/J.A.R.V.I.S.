-- =========================================================================
-- Proactive layer, slice 1: due-date reminders for tasks.
--
-- Why this exists (audited 2026-09-14, see CODEX.md → "Proactivity"):
-- nothing in this system runs unless a browser tab is open. `tasks.due_at`
-- has been written and displayed since Milestone 1 and has never triggered
-- anything, and every existing "background" path (runDocumentJobFn) is
-- fire-and-forgotten BY THE CLIENT — close the tab and it dies.
--
-- Deliberate scope: this slice runs ENTIRELY INSIDE POSTGRES. pg_cron calls
-- a plpgsql function that inserts into the existing public.notifications
-- table; NotificationBell.tsx already renders any `kind` over Realtime.
-- No LLM call, no HTTP call, no new service — so the first proactive
-- feature costs nothing per run and has exactly one failure mode ("cron
-- didn't run"). The later slices (morning briefing, weekly S.H.I.E.L.D.
-- check) DO need a model and will have to reach the app via pg_net; that is
-- a strictly bigger step and is intentionally not taken here.
--
-- Adds:
--   1. public.task_reminders — dedupe ledger, one row per (task, stage).
--   2. public.dispatch_due_task_reminders() — the scan, run by cron.
--   3. The pg_cron schedule (guarded: skipped with a NOTICE if the
--      extension isn't enabled yet).
-- =========================================================================

-- ---------- 0. user_settings.timezone ----------
-- Caught by a real test run, not by review: the reminder body is rendered
-- in the DATABASE's timezone (UTC), so a task due at 09:33 Polish time
-- announced itself as "Zaplanowane na 07:33" — wrong by two hours, on the
-- one piece of information the whole feature exists to deliver.
--
-- Fixed here rather than papered over with a hardcoded offset, because
-- every later slice of the proactive layer needs the same answer: a
-- morning briefing "at 7:30" is meaningless without knowing whose 7:30.
-- Europe/Warsaw as the default matches the app's language; a named zone
-- (not a fixed +02:00) so DST is handled by Postgres, not by us.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/Warsaw';

-- ---------- 1. task_reminders (dedupe ledger) ----------
-- A separate table rather than columns on `tasks`, for two reasons:
--   * deleting or reading a notification must never resurrect a reminder —
--     the ledger is the source of truth, not the notification row;
--   * `tasks` keeps its shape, so nothing that reads/writes tasks today has
--     to learn about reminders.
-- The UNIQUE constraint is what makes the whole design safe: the cron job
-- runs every 5 minutes and is free to re-scan the same task forever, but a
-- given (task, stage) can only ever be inserted — and therefore only ever
-- announced — once.
CREATE TABLE public.task_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- due_24h | due_1h | overdue
  stage TEXT NOT NULL,
  -- False for a stage that was skipped rather than announced: a task that
  -- is already overdue when it's first seen must not also fire a cheerful
  -- "due in 24h" afterwards, so the passed-over stages are recorded as
  -- handled without producing a notification.
  announced BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT task_reminders_stage_allowed CHECK (stage IN ('due_24h', 'due_1h', 'overdue')),
  CONSTRAINT task_reminders_unique_stage UNIQUE (task_id, stage)
);

GRANT SELECT ON public.task_reminders TO authenticated;
GRANT ALL ON public.task_reminders TO service_role;
ALTER TABLE public.task_reminders ENABLE ROW LEVEL SECURITY;

-- Read-only for the owner: rows are written exclusively by the SECURITY
-- DEFINER function below, never by the client.
CREATE POLICY "Task reminders: owner reads" ON public.task_reminders
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX idx_task_reminders_task ON public.task_reminders(task_id);

-- Makes the per-run scan an index scan instead of a full table sweep once
-- the task list grows: only open tasks that actually carry a deadline can
-- ever produce a reminder.
CREATE INDEX idx_tasks_open_due_at ON public.tasks(due_at)
  WHERE due_at IS NOT NULL AND status IN ('todo', 'in_progress');

-- ---------- 2. The scan ----------
CREATE OR REPLACE FUNCTION public.dispatch_due_task_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sent integer;
BEGIN
  WITH candidate AS (
    -- One row per open, dated task, carrying only the MOST URGENT stage it
    -- currently qualifies for. A task due in 30 minutes matches both
    -- 'due_24h' and 'due_1h'; announcing both in the same breath is noise.
    SELECT
      t.id AS task_id,
      t.user_id AS owner_id,
      t.title,
      t.due_at,
      t.priority,
      COALESCE(us.timezone, 'Europe/Warsaw') AS tz,
      CASE
        WHEN t.due_at < now() THEN 'overdue'
        WHEN t.due_at <= now() + interval '1 hour' THEN 'due_1h'
        ELSE 'due_24h'
      END AS stage
    FROM public.tasks t
    LEFT JOIN public.user_settings us ON us.owner_id = t.user_id
    WHERE t.status IN ('todo', 'in_progress')
      AND t.due_at IS NOT NULL
      AND t.due_at <= now() + interval '24 hours'
      -- Floor on how far back we look. Without it, the very first run after
      -- this migration lands would announce every task that has ever gone
      -- past due — potentially dozens of notifications at once, which is
      -- how a new feature teaches its user to ignore it on day one.
      AND t.due_at > now() - interval '7 days'
  ),
  -- Stages the task has effectively passed: recorded as handled so they can
  -- never fire late, but not announced.
  superseded AS (
    INSERT INTO public.task_reminders (task_id, owner_id, stage, announced)
    SELECT c.task_id, c.owner_id, s.stage, false
    FROM candidate c
    CROSS JOIN LATERAL (
      SELECT unnest(
        CASE c.stage
          WHEN 'overdue' THEN ARRAY['due_24h', 'due_1h']
          WHEN 'due_1h' THEN ARRAY['due_24h']
          ELSE ARRAY[]::text[]
        END
      ) AS stage
    ) s
    ON CONFLICT (task_id, stage) DO NOTHING
    RETURNING 1
  ),
  -- The stage we actually announce. ON CONFLICT DO NOTHING is the dedupe:
  -- if this pair is already in the ledger, RETURNING yields no row and no
  -- notification is produced.
  claimed AS (
    INSERT INTO public.task_reminders (task_id, owner_id, stage, announced)
    SELECT c.task_id, c.owner_id, c.stage, true
    FROM candidate c
    ON CONFLICT (task_id, stage) DO NOTHING
    RETURNING task_id, owner_id, stage
  ),
  announced AS (
    INSERT INTO public.notifications (owner_id, kind, title, body, payload)
    SELECT
      cl.owner_id,
      'task_' || cl.stage,
      CASE cl.stage
        WHEN 'overdue' THEN 'Termin minął: ' || c.title
        WHEN 'due_1h' THEN 'Termin za godzinę: ' || c.title
        ELSE 'Termin jutro: ' || c.title
      END,
      CASE cl.stage
        WHEN 'overdue' THEN 'Zadanie było na ' || to_char(c.due_at AT TIME ZONE c.tz, 'DD.MM HH24:MI') || ' i wciąż jest otwarte.'
        ELSE 'Zaplanowane na ' || to_char(c.due_at AT TIME ZONE c.tz, 'DD.MM HH24:MI') || '.'
      END,
      jsonb_build_object(
        'task_id', cl.task_id,
        'stage', cl.stage,
        'due_at', c.due_at,
        'priority', c.priority
      )
    FROM claimed cl
    JOIN candidate c ON c.task_id = cl.task_id
    RETURNING owner_id
  ),
  -- Telemetry into the table the runtime already writes to, so S.H.I.E.L.D.
  -- can see this subsystem at all. One row per owner per non-empty run:
  -- system_events.owner_id is NOT NULL and this scan is cross-user, and a
  -- heartbeat every 5 minutes forever would bury every other event in the
  -- log anyway.
  logged AS (
    INSERT INTO public.system_events (owner_id, level, source, message, meta)
    SELECT
      a.owner_id,
      'info',
      'scheduler',
      'Wysłano przypomnienia o terminach: ' || count(*),
      jsonb_build_object('sent', count(*))
    FROM announced a
    GROUP BY a.owner_id
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_sent FROM announced;

  RETURN v_sent;
END;
$function$;

-- Called only by cron (as the table owner), never by a client.
REVOKE ALL ON FUNCTION public.dispatch_due_task_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_due_task_reminders() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_due_task_reminders() TO service_role;

-- ---------- 3. Schedule ----------
-- Guarded rather than unconditional: pg_cron is enabled per-project (SQL
-- editor or Dashboard → Database → Extensions), and this migration must
-- still apply cleanly — installing the table and the function — on a
-- project where it hasn't been enabled yet. Without the guard the whole
-- migration would fail on `cron.schedule` not existing, and the user would
-- be left with neither the schedule NOR the feature.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule('dispatch-due-task-reminders')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-due-task-reminders');

    PERFORM cron.schedule(
      'dispatch-due-task-reminders',
      '*/5 * * * *',
      $cron$SELECT public.dispatch_due_task_reminders();$cron$
    );
    RAISE NOTICE 'Zaplanowano dispatch-due-task-reminders (co 5 minut).';
  ELSE
    RAISE NOTICE 'pg_cron nie jest włączony — tabela i funkcja są gotowe, ale nic ich nie wywołuje. Włącz rozszerzenie pg_cron, a potem uruchom: SELECT cron.schedule(''dispatch-due-task-reminders'', ''*/5 * * * *'', ''SELECT public.dispatch_due_task_reminders();'');';
  END IF;
END
$do$;
