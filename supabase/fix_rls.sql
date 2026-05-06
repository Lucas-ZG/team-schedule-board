create extension if not exists pgcrypto;

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
with check (auth.uid() = user_id);

drop policy if exists "Users can update own daily statuses"
  on public.daily_status;
create policy "Users can update own daily statuses"
on public.daily_status
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own daily statuses"
  on public.daily_status;
create policy "Users can delete own daily statuses"
on public.daily_status
for delete
to authenticated
using (auth.uid() = user_id);

update public.workplaces
set name = 'Dayoff', color = '#dc2626', is_dayoff = true, is_active = true
where lower(name) = 'dayoff'
  and name <> 'Dayoff'
  and not exists (
    select 1
    from public.workplaces existing
    where existing.name = 'Dayoff'
  );

insert into public.workplaces (name, color, is_dayoff, is_active)
values
  ('K3', '#2563eb', false, true),
  ('K5', '#0891b2', false, true),
  ('Office', '#475569', false, true),
  ('ITEK', '#7c3aed', false, true),
  ('Customer Site', '#9333ea', false, true),
  ('Dayoff', '#dc2626', true, true)
on conflict (name) do update
set
  color = excluded.color,
  is_dayoff = excluded.is_dayoff,
  is_active = excluded.is_active;

update public.workplaces
set is_active = false
where name = 'Home';

with target as (
  select id
  from public.workplaces
  where name = 'Dayoff'
  limit 1
),
sources as (
  select id
  from public.workplaces
  where lower(name) = 'dayoff'
    and name <> 'Dayoff'
)
update public.daily_status
set workplace_id = (select id from target)
where workplace_id in (select id from sources)
  and exists (select 1 from target);

update public.workplaces
set is_active = false
where lower(name) = 'dayoff'
  and name <> 'Dayoff';
