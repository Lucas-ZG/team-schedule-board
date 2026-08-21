-- migration_20260821_activity_logs.sql
-- For DEPLOYED environments: run this in Supabase Dashboard -> SQL Editor.
-- Adds an append-only activity log table used by the admin-only "Logs" page
-- (src/app/admin/logs/page.tsx) to record:
--   1. who logged in and when (event_type = 'login')
--   2. who created/updated/deleted a daily_status (shift/OT/leave) record,
--      and when (event_type = 'create' | 'update' | 'delete')
--
-- IMPORTANT LIMITATION (see README changelog / FINDINGS_PERMISSION_CHECK.md):
-- the 'login' event is written by a client-side call right after
-- supabase.auth.signInWithPassword() succeeds (src/app/login/page.tsx). A
-- client that calls the Supabase Auth API directly, bypassing this app's
-- login page, would not produce a 'login' row. This table is therefore a
-- usage/activity log, not a tamper-proof security audit trail.

-- ============================================================
-- 1. Table
-- ============================================================
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('login', 'create', 'update', 'delete')),
  target_table text,
  target_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_at_idx
  on public.activity_logs (created_at desc);

create index if not exists activity_logs_user_id_idx
  on public.activity_logs (user_id);

-- ============================================================
-- 2. RLS
-- ============================================================
alter table public.activity_logs enable row level security;

-- SELECT: admin only, same inline EXISTS pattern used everywhere else in
-- this project (see migration_20260616_secure_anon_admin.sql, add_admin_role.sql).
drop policy if exists "Admins can read activity logs" on public.activity_logs;
create policy "Admins can read activity logs"
on public.activity_logs
for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'admin'
  )
);

-- INSERT: any signed-in user may write a row for themselves only. Deliberately
-- does NOT check role, so every role (admin/user/viewer) can log its own
-- login event.
drop policy if exists "Users can insert own activity logs" on public.activity_logs;
create policy "Users can insert own activity logs"
on public.activity_logs
for insert
to authenticated
with check (user_id = auth.uid());

-- UPDATE / DELETE: intentionally no policies at all. With RLS enabled and
-- zero matching policies, every role (including admin) is denied -- the log
-- is append-only / non-tamperable by design. If a cleanup mechanism is ever
-- needed, add an explicit admin-only DELETE policy in a new migration and
-- call it out clearly in that migration's header comment; do not add one here.

-- ============================================================
-- 3. Grants (RLS above still applies on top of these)
-- ============================================================
grant select, insert on public.activity_logs to authenticated;
