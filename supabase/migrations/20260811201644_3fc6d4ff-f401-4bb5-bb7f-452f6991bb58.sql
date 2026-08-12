ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS current_task text,
  ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_elapsed_seconds integer NOT NULL DEFAULT 0;