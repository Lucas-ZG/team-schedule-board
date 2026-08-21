-- migration_20260821_remove_entered_by_lock.sql
-- Removes the "admin-entered records are locked for the owner" rule from
-- daily_status UPDATE/DELETE RLS policies, while keeping the unrelated
-- 7-day self-edit window rule untouched. Before this migration, a
-- non-admin user could not edit/delete their own daily_status row if it
-- had been entered on their behalf by an admin (entered_by != user_id).
-- After this migration, ownership of the row (user_id) and the 7-day
-- window are the only conditions that matter for a non-admin; entered_by
-- itself and its populating trigger (set_daily_status_entered_by from
-- add_entered_by_tracking.sql) are left in place for activity-log
-- attribution, just no longer used to gate edit permission.
--
-- This policy body is written from the repo's own migration history (see
-- migration_20260616_secure_anon_admin.sql section 7), with only the
-- `AND (entered_by IS NULL OR entered_by = user_id)` line removed from
-- the UPDATE and DELETE policies. The INSERT policy never had this
-- condition, so it is not touched.
--
-- IMPORTANT -- what's actually live in production does not match that
-- migration file: probing production directly (2026-08-21, see
-- IMPLEMENTATION_REPORT.md in the team-schedule-enhancements-2026-08-21
-- task folder) found that the `entered_by` column does not exist on the
-- live daily_status table at all, and the 7-day self-edit window was NOT
-- being enforced at the RLS layer -- only the frontend was blocking it,
-- and a direct REST call could bypass it. So applying this migration is
-- not just "removing a lock that's already gone"; it will be the first
-- time the 7-day window is actually enforced by the database, closing a
-- real gap. The 7-day condition below is unchanged from the documented
-- design, not a new restriction being introduced by this task.

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
    AND work_date >= ((now() AT TIME ZONE 'Asia/Seoul')::date - interval '7 days')
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'user'
    )
  )
);
