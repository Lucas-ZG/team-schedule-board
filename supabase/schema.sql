create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  role text not null default 'user' check (role in ('admin', 'user', 'viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.workplaces (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text,
  is_dayoff boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  workplace_id uuid not null references public.workplaces(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_status_user_date_unique unique (user_id, work_date)
);

create index if not exists daily_status_work_date_idx
  on public.daily_status (work_date);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_daily_status_updated_at on public.daily_status;
create trigger set_daily_status_updated_at
before update on public.daily_status
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email, role)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(new.email, '@', 1)
    ),
    new.email,
    'user'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

insert into public.profiles (id, display_name, email, role)
select
  users.id,
  coalesce(
    nullif(users.raw_user_meta_data ->> 'display_name', ''),
    split_part(users.email, '@', 1)
  ),
  users.email,
  'user'
from auth.users
on conflict (id) do update
set
  email = excluded.email,
  display_name = coalesce(public.profiles.display_name, excluded.display_name),
  role = coalesce(public.profiles.role, 'user');
-- To grant admin, run:
--   UPDATE public.profiles SET role = 'admin' WHERE email = 'admin@example.com';

alter table public.profiles enable row level security;
alter table public.workplaces enable row level security;
alter table public.daily_status enable row level security;

drop policy if exists "Authenticated users can read all profiles"
  on public.profiles;
create policy "Authenticated users can read all profiles"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "Users can insert own profile"
  on public.profiles;
create policy "Users can insert own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "Users can update own profile"
  on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Authenticated users can read active workplaces"
  on public.workplaces;
create policy "Authenticated users can read active workplaces"
on public.workplaces
for select
to authenticated
using (is_active = true);

drop policy if exists "Authenticated users can read all daily statuses"
  on public.daily_status;
create policy "Authenticated users can read all daily statuses"
on public.daily_status
for select
to authenticated
using (true);

drop policy if exists "Users can insert own daily statuses"
  on public.daily_status;
create policy "Users can insert own daily statuses"
on public.daily_status
for insert
to authenticated
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

drop policy if exists "Users can update own daily statuses"
  on public.daily_status;
create policy "Users can update own daily statuses"
on public.daily_status
for update
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

drop policy if exists "Users can delete own daily statuses"
  on public.daily_status;
create policy "Users can delete own daily statuses"
on public.daily_status
for delete
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

insert into public.workplaces (name, color, is_dayoff, is_active)
values
  ('K3', '#2563eb', false, true),
  ('K5', '#0891b2', false, true),
  ('Office', '#475569', false, true),
  ('Home', '#16a34a', false, true),
  ('Customer Site', '#9333ea', false, true),
  ('dayoff', '#dc2626', true, true)
on conflict (name) do update
set
  color = excluded.color,
  is_dayoff = excluded.is_dayoff,
  is_active = excluded.is_active;

grant usage on schema public to authenticated;
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.workplaces to authenticated;
grant select, insert, update, delete on public.daily_status to authenticated;
