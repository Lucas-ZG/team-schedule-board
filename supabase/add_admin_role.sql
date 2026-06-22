alter table public.profiles
add column if not exists email text;

alter table public.profiles
add column if not exists role text not null default 'user';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
    add constraint profiles_role_check
    check (role in ('admin', 'user', 'viewer'));
  end if;
end $$;

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
    'user'  -- new users start as 'user'; grant admin via profiles.role = 'admin'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    role = coalesce(public.profiles.role, 'user');

  return new;
end;
$$;

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

update public.profiles
set role = 'user'
where role is null;
-- To grant admin: UPDATE public.profiles SET role = 'admin' WHERE email = 'admin@example.com';

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

update public.workplaces
set name = 'dayoff', color = '#dc2626', is_dayoff = true, is_active = true
where name = 'Dayoff'
  and not exists (
    select 1
    from public.workplaces existing
    where existing.name = 'dayoff'
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

with target as (
  select id
  from public.workplaces
  where name = 'dayoff'
  limit 1
),
sources as (
  select id
  from public.workplaces
  where name = 'Dayoff'
)
update public.daily_status
set workplace_id = (select id from target)
where workplace_id in (select id from sources)
  and exists (select 1 from target);

update public.workplaces
set is_active = false
where name in ('Dayoff', 'ITEK');

grant usage on schema public to authenticated;
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.workplaces to authenticated;
grant select, insert, update, delete on public.daily_status to authenticated;
