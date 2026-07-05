-- Hard allowlist: only the owner's email may create an auth.users row.
-- Applies to email/password signups AND OAuth (Google) first sign-ins.
CREATE OR REPLACE FUNCTION public.enforce_owner_only_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) <> 'pol197.kuba@gmail.com' THEN
    RAISE EXCEPTION 'Signups are disabled on this platform.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_owner_only_signup ON auth.users;
CREATE TRIGGER enforce_owner_only_signup
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.enforce_owner_only_signup();

-- Auto-grant admin role to the owner when their account is created.
CREATE OR REPLACE FUNCTION public.grant_owner_admin_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) = 'pol197.kuba@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_grant_owner ON auth.users;
CREATE TRIGGER on_auth_user_created_grant_owner
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_owner_admin_role();

-- Also promote if the owner already exists (idempotent).
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users
WHERE lower(email) = 'pol197.kuba@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;