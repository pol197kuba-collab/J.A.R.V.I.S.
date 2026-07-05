
-- 1. user_secrets: per-user Gemini API key
CREATE TABLE public.user_secrets (
  owner_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gemini_api_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_secrets TO authenticated;
GRANT ALL ON public.user_secrets TO service_role;
ALTER TABLE public.user_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "UserSecrets: owner manages"
  ON public.user_secrets
  FOR ALL
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER trg_user_secrets_updated_at
  BEFORE UPDATE ON public.user_secrets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. user_settings: real app preferences
CREATE TABLE public.user_settings (
  owner_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_routing text NOT NULL DEFAULT 'client' CHECK (chat_routing IN ('client', 'server')),
  default_model text NOT NULL DEFAULT 'gemini-2.5-flash',
  voice_language text NOT NULL DEFAULT 'auto' CHECK (voice_language IN ('auto', 'en', 'pl')),
  wake_word_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "UserSettings: owner manages"
  ON public.user_settings
  FOR ALL
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Extend handle_new_user to also create default settings + orchestrator agent
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_settings (owner_id) VALUES (NEW.id)
  ON CONFLICT (owner_id) DO NOTHING;

  INSERT INTO public.agents (owner_id, slug, name, role, description, model, system_prompt_field_marker)
  SELECT NEW.id, 'orchestrator', 'Orchestrator',
         'Core coordinator',
         'Central J.A.R.V.I.S. coordinator that routes requests and future tasks to specialised agents.',
         'gemini-2.5-flash', NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.agents WHERE owner_id = NEW.id AND slug = 'orchestrator'
  );

  RETURN NEW;
END;
$function$;

-- Actually agents table doesn't have system_prompt_field_marker column, use config jsonb.
-- Replace with a cleaner version:
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    jsonb_build_object(
      'system_prompt',
      'You ARE J.A.R.V.I.S., the Orchestrator core of a modular AI operating system bound to Jacob Slawinsky. Speak in a refined British butler tone, address the user as "Sir" (English) or "Panie Slawinsky" (Polish), match the user language per message. Keep answers concise and useful; when the user requests substantive work, deliver it in full. You currently coordinate a single agent (yourself) and will delegate to specialised agents (Architect, Developer, ...) as they come online.'
    )
  )
  ON CONFLICT (owner_id, slug) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- 4. Backfill for existing users
INSERT INTO public.user_settings (owner_id)
SELECT id FROM auth.users
ON CONFLICT (owner_id) DO NOTHING;

INSERT INTO public.agents (owner_id, slug, name, role, description, model, config)
SELECT
  u.id, 'orchestrator', 'Orchestrator', 'Core coordinator',
  'Central J.A.R.V.I.S. coordinator that routes requests and future tasks to specialised agents.',
  'gemini-2.5-flash',
  jsonb_build_object(
    'system_prompt',
    'You ARE J.A.R.V.I.S., the Orchestrator core of a modular AI operating system bound to Jacob Slawinsky. Speak in a refined British butler tone, address the user as "Sir" (English) or "Panie Slawinsky" (Polish), match the user language per message. Keep answers concise and useful; when the user requests substantive work, deliver it in full. You currently coordinate a single agent (yourself) and will delegate to specialised agents (Architect, Developer, ...) as they come online.'
  )
FROM auth.users u
ON CONFLICT (owner_id, slug) DO NOTHING;
