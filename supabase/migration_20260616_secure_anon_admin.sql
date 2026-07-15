-- migration_20260616_secure_anon_admin.sql
-- For DEPLOYED environments: run this in Supabase Dashboard → SQL Editor.
-- Fully revokes anon access (no public-safe view is kept -- the /view
-- page that would have consumed it no longer exists, see section 3),
-- removes hardcoded admin email from the handle_new_user trigger, and
-- pushes the viewer role down into the daily_status RLS policies on
-- top of -- not instead of -- the existing 7-day self-edit window and
-- entered_by protection from add_entered_by_tracking.sql (section 7).
--
-- Migration order context (what was run before):
--   schema.sql → add_admin_role.sql → fix_rls.sql → add_anon_read.sql
--   add_sort_order.sql → add_workplace_ids.sql → add_entered_by_tracking.sql

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
-- 3. The /view public page has been removed (see commit 2e1a90a:
--    "feat: add viewer role and remove /view public page").
--    src/app/view no longer exists and is unreachable via routing,
--    so anon has no remaining legitimate read path. Drop the
--    public-safe views created for it and revoke anon entirely
--    instead of leaving a partial read channel open.
-- ============================================================
DROP VIEW IF EXISTS public.v_profiles_public;
DROP VIEW IF EXISTS public.v_workplaces_public;
DROP VIEW IF EXISTS public.v_daily_status_public;

-- ============================================================
-- 4. Fully revoke anon access (no read path remains)
-- ============================================================
REVOKE ALL ON SCHEMA public FROM anon;

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

-- ============================================================
-- 7. Push viewer role down to RLS on daily_status, layered ON TOP
--    of the existing 7-day self-edit window and entered_by
--    protection defined in add_entered_by_tracking.sql -- both of
--    those conditions are preserved unchanged here, not replaced.
--    Previous policies (pre this migration) only checked
--    `auth.uid() = user_id` (+ the 7-day window / entered_by
--    guard), so a logged-in role='viewer' account could still
--    INSERT/UPDATE/DELETE its own daily_status rows within that
--    window via a direct API call, even though the frontend
--    (Calendar.tsx isViewer/canEdit) blocks the UI path. Admins
--    must still be able to write on behalf of any user with no
--    window/viewer restriction (Calendar.tsx targetUserId =
--    isAdmin ? payload.userId : user.id), so the admin branch is
--    unchanged; the self-write branch now additionally requires
--    role = 'user' (AND'd with the pre-existing conditions).
-- ============================================================
DROP POLICY IF EXISTS "Users can insert own daily statuses" ON public.daily_status;
CREATE POLICY "Users can insert own daily statuses"
ON public.daily_status
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  )
  OR (
    auth.uid() = user_id
    AND work_date >= ((now() AT TIME ZONE 'Asia/Seoul')::date - interval '7 days')
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'user'
    )
  )
);

DROP POLICY IF EXISTS "Users can update own daily statuses" ON public.daily_status;
CREATE POLICY "Users can update own daily statuses"
ON public.daily_status
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  )
  OR (
    auth.uid() = user_id
    AND (entered_by IS NULL OR entered_by = user_id)
    AND work_date >= ((now() AT TIME ZONE 'Asia/Seoul')::date - interval '7 days')
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'user'
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  )
  OR (
    auth.uid() = user_id
    AND (entered_by IS NULL OR entered_by = user_id)
    AND work_date >= ((now() AT TIME ZONE 'Asia/Seoul')::date - interval '7 days')
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'user'
    )
  )
);

DROP POLICY IF EXISTS "Users can delete own daily statuses" ON public.daily_status;
CREATE POLICY "Users can delete own daily statuses"
ON public.daily_status
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  )
  OR (
    auth.uid() = user_id
    AND (entered_by IS NULL OR entered_by = user_id)
    AND work_date >= ((now() AT TIME ZONE 'Asia/Seoul')::date - interval '7 days')
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'user'
    )
  )
);

-- ============================================================
-- 8. Fix ot_periods policies calling undefined public.is_admin_user().
--    That function is never defined anywhere in this repo (see
--    RLS_COMPLETION_AUDIT.md section 3); replace with the same
--    inline EXISTS pattern used everywhere else in this project
--    (see add_admin_role.sql / schema.sql daily_status policies).
-- ============================================================
DROP POLICY IF EXISTS "Only admin can insert ot_periods" ON public.ot_periods;
CREATE POLICY "Only admin can insert ot_periods"
ON public.ot_periods
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

DROP POLICY IF EXISTS "Only admin can update ot_periods" ON public.ot_periods;
CREATE POLICY "Only admin can update ot_periods"
ON public.ot_periods
FOR UPDATE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

DROP POLICY IF EXISTS "Only admin can delete ot_periods" ON public.ot_periods;
CREATE POLICY "Only admin can delete ot_periods"
ON public.ot_periods
FOR DELETE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
