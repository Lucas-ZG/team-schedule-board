-- add_entered_by_tracking.sql
-- Adds entered_by tracking to daily_status so that records entered/edited
-- by admin on behalf of a user become read-only for that user, and adds a
-- 7-day self-edit window for users editing their own records.
--
-- NOTE: this project has no is_admin() helper function; existing policies
-- ("Users can insert own daily statuses" / "Users can update own daily
-- statuses" / "Users can delete own daily statuses", defined in
-- add_admin_role.sql and fix_rls.sql) inline the admin check via an EXISTS
-- subquery against public.profiles. This migration keeps that same style
-- and re-defines the same policy names (DROP + CREATE), rather than
-- introducing a new permission function.
--
-- The 7-day self-edit window boundary is computed in Asia/Seoul time
-- ((now() at time zone 'Asia/Seoul')::date - interval '7 days'), matching
-- the Korea-timezone date math used by the frontend in src/lib/calendar.ts
-- (isWithinSelfEditWindow). Using bare current_date here would follow the
-- database/session timezone instead, which could disagree with the
-- frontend around Korean midnight.

alter table public.daily_status
  add column if not exists entered_by uuid references public.profiles(id);

create or replace function public.set_daily_status_entered_by()
returns trigger
language plpgsql
as $$
begin
  new.entered_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists set_daily_status_entered_by on public.daily_status;
create trigger set_daily_status_entered_by
before insert or update on public.daily_status
for each row execute function public.set_daily_status_entered_by();

drop policy if exists "Users can insert own daily statuses"
  on public.daily_status;
create policy "Users can insert own daily statuses"
on public.daily_status
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
  or (
    auth.uid() = user_id
    and work_date >= ((now() at time zone 'Asia/Seoul')::date - interval '7 days')
  )
);

drop policy if exists "Users can update own daily statuses"
  on public.daily_status;
create policy "Users can update own daily statuses"
on public.daily_status
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
  or (
    auth.uid() = user_id
    and (entered_by is null or entered_by = user_id)
    and work_date >= ((now() at time zone 'Asia/Seoul')::date - interval '7 days')
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
  or (
    auth.uid() = user_id
    and (entered_by is null or entered_by = user_id)
    and work_date >= ((now() at time zone 'Asia/Seoul')::date - interval '7 days')
  )
);

drop policy if exists "Users can delete own daily statuses"
  on public.daily_status;
create policy "Users can delete own daily statuses"
on public.daily_status
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
  or (
    auth.uid() = user_id
    and (entered_by is null or entered_by = user_id)
    and work_date >= ((now() at time zone 'Asia/Seoul')::date - interval '7 days')
  )
);
