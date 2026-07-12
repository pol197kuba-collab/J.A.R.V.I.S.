-- event_log's original insert policy let any authenticated user write a
-- user_id=NULL "global" row, which the matching select policy then exposes
-- to every other user. Nothing in the app relies on that global-row path
-- today; it just leaves a spoofable telemetry hole open. Server-side code
-- that legitimately needs a system-wide event should use the service role,
-- which bypasses RLS entirely — ordinary authenticated clients should only
-- ever be able to write their own rows, same as system_events already does.
DROP POLICY IF EXISTS "EventLog: insert own" ON public.event_log;
CREATE POLICY "EventLog: insert own" ON public.event_log
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
