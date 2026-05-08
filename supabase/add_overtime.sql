alter table public.daily_status
  add column if not exists overtime_enabled boolean not null default false;
alter table public.daily_status
  add column if not exists overtime_hours numeric(3,1) not null default 0;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'daily_status_overtime_hours_check'
      and conrelid = 'public.daily_status'::regclass
  ) then
    alter table public.daily_status
      add constraint daily_status_overtime_hours_check
      check (
        overtime_hours >= 0
        and overtime_hours <= 24
        and (overtime_hours * 2) = floor(overtime_hours * 2)
      );
  end if;
end $$;
grant select, insert, update, delete on public.daily_status to authenticated;
