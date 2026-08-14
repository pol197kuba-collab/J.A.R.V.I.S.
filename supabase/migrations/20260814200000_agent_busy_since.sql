-- =========================================================================
-- Fix: the Agent Matrix widget's progress bar and elapsed-time counter
-- stayed frozen (0% / 0s) for the whole duration of a run.
--
-- Root cause: public.agents.progress was set to 0 once at run start and
-- never touched again until the run finished (where it was reset to 0
-- again) — there was nothing for the widget to see change while a run was
-- in flight. time_elapsed_seconds had the same problem: it was only ever
-- written once, at the very end, so during a run it just showed whatever
-- value was left over from the PREVIOUS run.
--
-- This migration adds agents.busy_since, a stable timestamp set once when
-- an agent starts a run and cleared when it finishes. The client uses it
-- to compute elapsed time live (ticking every second), independent of the
-- ~3s polling interval and independent of any in-flight progress writes.
-- Progress itself is now updated incrementally by the orchestrator after
-- every tool-call iteration (code change, no schema needed for that part).
-- =========================================================================

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS busy_since timestamptz;
