
-- notes table
CREATE TABLE public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
GRANT ALL ON public.notes TO service_role;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes_owner_all" ON public.notes FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER notes_set_updated_at BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX notes_owner_created_idx ON public.notes(owner_id, created_at DESC);

-- system_events table (real system log)
CREATE TABLE public.system_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error','debug')),
  source text NOT NULL,
  message text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.system_events TO authenticated;
GRANT ALL ON public.system_events TO service_role;
ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "system_events_owner_select" ON public.system_events FOR SELECT TO authenticated
  USING (auth.uid() = owner_id);
CREATE POLICY "system_events_owner_insert" ON public.system_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);
CREATE INDEX system_events_owner_created_idx ON public.system_events(owner_id, created_at DESC);
