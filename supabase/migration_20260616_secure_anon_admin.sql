-- migration_20260616_secure_anon_admin.sql
-- For DEPLOYED environments: run this in Supabase Dashboard → SQL Editor.
-- Replaces open anon access with a public-safe view, and removes
-- hardcoded admin email from the handle_new_user trigger.
--
-- Migration order context (what was run before):
--   schema.sql → add_admin_role.sql → fix_rls.sql → add_anon_read.sql
--   add_sort_order.sql → add_workplace_ids.sql

-- ============================================================
-- 1. Remove anon RLS policies on base tables
-- ============================================================
DROP POLICY IF EXISTS "Anon can read profiles"     ON public.profiles;
DROP POLICY IF EXISTS "Anon can read workplaces"   ON public.workplaces;
DROP POLICY IF EXISTS "Anon can read daily_status" ON public.daily_status;

-- ============================================================
-- 2. Revoke anon direct table grants
--    (keep USAGE on schema so the views below still work)
-- ============================================================
REVOKE SELECT ON public.profiles     FROM anon;
REVOKE SELECT ON public.workplaces   FROM anon;
REVOKE SELECT ON public.daily_status FROM anon;

-- ============================================================
-- 3. Public-safe views for the /view page
--    Exposes only the fields the read-only calendar page needs;
--    profiles.email is intentionally excluded.
-- ============================================================
CREATE OR REPLACE VIEW public.v_profiles_public AS
  SELECT id, display_name, sort_order
  FROM public.profiles;

CREATE OR REPLACE VIEW public.v_workplaces_public AS
  SELECT id, name, color, is_dayoff, is_active, created_at
  FROM public.workplaces;

CREATE OR REPLACE VIEW public.v_daily_status_public AS
  SELECT id, user_id, work_date, workplace_id, workplace_ids, created_at
  FROM public.daily_status;

-- ============================================================
-- 4. Grant anon access to views only
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON public.v_profiles_public     TO anon;
GRANT SELECT ON public.v_workplaces_public   TO anon;
GRANT SELECT ON public.v_daily_status_public TO anon;

-- ============================================================
-- 5. Fix handle_new_user: new users always start as 'user'.
--    Admin must be granted manually via profiles.role.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email, role)
  VALUES (
    new.id,
    COALESCE(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    new.email,
    'user'
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email        = excluded.email,
    display_name = COALESCE(public.profiles.display_name, excluded.display_name),
    role         = COALESCE(public.profiles.role, 'user');
  RETURN new;
END;
$$;

-- ============================================================
-- 6. How to grant admin (no SQL rewrite needed):
--    UPDATE public.profiles SET role = 'admin' WHERE email = 'admin@example.com';
-- ============================================================
