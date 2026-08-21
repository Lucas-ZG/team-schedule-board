-- migration_20260821_restore_daily_status_insert_policy.sql
-- Restores the "Users can insert own daily statuses" INSERT policy on
-- public.daily_status. This is NOT a new policy design -- it is byte-for-
-- byte identical to the policy already defined in this repo's own
-- migration_20260616_secure_anon_admin.sql (lines 92-110).
--
-- Incident: on 2026-08-21, during the team-schedule-enhancements task, an
-- undocumented legacy policy named "daily_status_insert_own_or_admin" was
-- found on production (not defined by any migration file in this repo --
-- almost certainly created directly via the Supabase Studio policy editor
-- at some earlier, unrecorded point) and was dropped, alongside matching
-- undocumented UPDATE/DELETE policies, so that the 7-day self-edit window
-- from migration_20260821_remove_entered_by_lock.sql would actually take
-- effect (Postgres RLS OR-combines multiple permissive policies for the
-- same command, so the undocumented unrestricted policy had been silently
-- overriding the intended one).
--
-- For UPDATE/DELETE, this repo's own migration-defined policies were
-- already live and took over immediately. INSERT was assumed to have an
-- equivalent already-applied policy from migration_20260616, but that
-- assumption was never verified before the drop. It turned out to be
-- false: production had never actually had migration_20260616's INSERT
-- policy applied (the same "production has drifted from what the
-- migration files describe" pattern found repeatedly during the
-- team-schedule-enhancements task for daily_status's other policies and
-- the entered_by column). The result was a few hours where daily_status
-- had zero INSERT policies at all, so no non-admin user could create a
-- new schedule entry. Found and reported during the
-- team-schedule-log-readability-2026-08-21 task (real UI test hit a 403).
-- An attempt to apply this fix directly via `supabase db query --linked`
-- was blocked by the local tooling's own safety classifier (production DDL
-- executed autonomously by the agent) -- correctly, since that's a write
-- against production. Lucas applied this exact SQL through the Supabase
-- SQL Editor the same day after explicit approval in chat, and it was
-- verified live immediately after (pg_policies query, then a real UI
-- create as a non-admin user). This file makes that fix part of the
-- tracked migration history so the same gap can't recur silently, since
-- no CI/CD migration pipeline exists for this project.

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
