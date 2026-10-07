-- Production-ready Delete User migration. It aborts if the known FK shape drifted.
begin;
do $$
declare v_count integer; v_bad text;
begin
  select count(*) into v_count from pg_constraint c
  where c.conrelid = 'public.daily_status'::regclass and c.contype='f'
    and pg_get_constraintdef(c.oid) = 'FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE';
  if v_count <> 1 then raise exception 'PRECHECK: unexpected daily_status.user_id foreign key'; end if;
  select count(*) into v_count from pg_constraint c
  where c.conrelid = 'public.activity_logs'::regclass and c.contype='f'
    and pg_get_constraintdef(c.oid) = 'FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL';
  if v_count <> 1 then raise exception 'PRECHECK: unexpected activity_logs.user_id foreign key'; end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='daily_status' and column_name='entered_by') then
    raise exception 'PRECHECK: daily_status.entered_by is not expected';
  end if;
  -- The delete-user Logs event becomes a reserved type (guard_reserved_log_events below); a pre-existing row of that shape
  -- cannot be told apart from a client-forged one, so it must not exist. Existing Logs are never modified by this script.
  if exists (select 1 from public.activity_logs where event_type = 'delete' and target_table = 'profiles') then
    raise exception 'PRECHECK: activity_logs already contains reserved delete-user events (event_type=delete, target_table=profiles)';
  end if;
  if to_regclass('public.user_history_labels') is not null then
    raise exception 'PRECHECK: public.user_history_labels already exists (this script is not re-runnable)';
  end if;
  -- profiles may only carry the emergency-patch trigger profiles_guard_role (applied 2026-10-06); unknown triggers abort.
  select string_agg(tgname, ', ') into v_bad from pg_trigger
  where tgrelid = 'public.profiles'::regclass and not tgisinternal and tgname <> 'profiles_guard_role';
  if v_bad is not null then raise exception 'PRECHECK: unexpected trigger(s) on profiles: %', v_bad; end if;
end $$;

create table public.user_history_labels (
  user_id uuid primary key,
  display_name text not null,
  deleted_at timestamptz
);

-- Display-name rule shared with the Edge Function (JS `display_name || email || id`): an empty string counts as missing.
insert into public.user_history_labels (user_id, display_name)
select id, coalesce(nullif(display_name, ''), nullif(email, ''), id::text) from public.profiles;

alter table public.daily_status drop constraint daily_status_user_id_fkey;
alter table public.activity_logs drop constraint activity_logs_user_id_fkey;
alter table public.daily_status add constraint daily_status_user_id_fkey foreign key (user_id) references public.user_history_labels(user_id) on delete restrict;
alter table public.activity_logs add constraint activity_logs_user_id_fkey foreign key (user_id) references public.user_history_labels(user_id) on delete restrict;

alter table public.user_history_labels enable row level security;
create policy user_history_labels_read_authenticated on public.user_history_labels for select to authenticated using (true);
grant select on public.user_history_labels to authenticated, service_role;
revoke all on public.user_history_labels from public, anon;
-- authenticated: SELECT only; service_role: SELECT only (the delete-user status action reads it directly).
revoke insert, update, delete, truncate, references, trigger on public.user_history_labels from authenticated, service_role;

create function public.sync_user_history_label() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.user_history_labels(user_id, display_name, deleted_at)
  values (new.id, coalesce(nullif(new.display_name, ''), nullif(new.email, ''), new.id::text), null)
  on conflict (user_id) do update set display_name = excluded.display_name
  where public.user_history_labels.deleted_at is null;
  return new;
exception when others then
  raise warning 'user history label sync failed for %', new.id;
  return new;
end;
$$;
create trigger sync_user_history_label_after_profile after insert or update of display_name, email on public.profiles
for each row execute function public.sync_user_history_label();
revoke all on function public.sync_user_history_label() from public, anon, authenticated;

-- History of a deleted user is read-only for everyone (including admins and service_role):
-- INSERT/UPDATE/DELETE are rejected when the row belongs to (UPDATE: belonged to OR is moved to) a user marked deleted.
create function public.guard_deleted_user_writes() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and exists (
    select 1 from public.user_history_labels where user_id = old.user_id and deleted_at is not null
  ) then
    raise exception using errcode='P0001', message='deleted_user_read_only';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and exists (
    select 1 from public.user_history_labels where user_id = new.user_id and deleted_at is not null
  ) then
    raise exception using errcode='P0001', message='deleted_user_read_only';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger guard_deleted_daily_status before insert or update or delete on public.daily_status
for each row execute function public.guard_deleted_user_writes();
create trigger guard_deleted_activity_log before insert or update or delete on public.activity_logs
for each row execute function public.guard_deleted_user_writes();
revoke all on function public.guard_deleted_user_writes() from public, anon, authenticated;

-- Reserved Logs event type: event_type='delete' + target_table='profiles' is the delete-user event. Only delete_user_data()
-- (SECURITY DEFINER, so current_user is the function owner) may write it; anon/authenticated may neither INSERT it nor turn
-- an existing row into it (or out of it). SECURITY INVOKER on purpose: current_user must be the caller's role. The Logs page
-- trusts the actor/target name snapshots in detail only for this event type. The check is not an RLS policy, so it also
-- holds if RLS were ever loosened.
create function public.guard_reserved_log_events() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if current_user in ('anon', 'authenticated') and (
       (new.event_type = 'delete' and new.target_table = 'profiles')
    or (tg_op = 'UPDATE' and old.event_type = 'delete' and old.target_table = 'profiles')) then
    raise exception using errcode='42501', message='reserved_event_type';
  end if;
  return new;
end;
$$;
create trigger guard_reserved_activity_log_events before insert or update on public.activity_logs
for each row execute function public.guard_reserved_log_events();
revoke all on function public.guard_reserved_log_events() from public, anon, authenticated;

-- Single counting rule shared by the preview action and delete_user_data().
-- Dayoff row: workplace_ids (when non-empty) decides, otherwise the single workplace_id; each row counts once.
create function public.delete_user_counts(p_target_id uuid, p_cutoff date default null)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'cutoffDate', c.cutoff,
    'futureCount', count(d.id) filter (where d.work_date > c.cutoff),
    'futureDayoffCount', count(d.id) filter (where d.work_date > c.cutoff and exists (
      select 1 from public.workplaces w where w.is_dayoff and w.id = any (
        case when coalesce(cardinality(d.workplace_ids), 0) > 0 then d.workplace_ids else array[d.workplace_id] end))),
    'retainedCount', count(d.id) filter (where d.work_date <= c.cutoff))
  from (select coalesce(p_cutoff, (now() at time zone 'Asia/Seoul')::date) as cutoff) c
  left join public.daily_status d on d.user_id = p_target_id
  group by c.cutoff;
$$;
revoke all on function public.delete_user_counts(uuid, date) from public, anon, authenticated;
grant execute on function public.delete_user_counts(uuid, date) to service_role;

create function public.delete_user_data(
  p_actor_id uuid, p_target_id uuid, p_confirm_name text,
  p_expected_cutoff date, p_expected_future_count integer, p_expected_dayoff_count integer,
  p_expected_retained_count integer, p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_label public.user_history_labels%rowtype;
  v_cutoff date := (now() at time zone 'Asia/Seoul')::date;
  v_counts jsonb;
  v_future integer;
  v_dayoff integer;
  v_retained integer;
  v_target_name text;
begin
  select * into v_actor from public.profiles where id=p_actor_id;
  if not found or v_actor.role <> 'admin' then raise exception using errcode='42501', message='admin_required'; end if;
  if p_actor_id=p_target_id then raise exception using errcode='P0001', message='cannot_delete_self'; end if;

  select * into v_target from public.profiles where id=p_target_id for update;
  if not found then
    select * into v_label from public.user_history_labels where user_id=p_target_id;
    if found and v_label.deleted_at is not null then
      return jsonb_build_object('status','already_cleaned','cutoffDate',v_cutoff,'deletedCount',0,'retainedCount',0);
    end if;
    raise exception using errcode='P0002', message='target_not_found';
  end if;
  if v_target.role not in ('user','viewer') then raise exception using errcode='P0001', message='target_role_forbidden'; end if;
  v_target_name := coalesce(nullif(v_target.display_name,''), nullif(v_target.email,''), v_target.id::text);
  if v_target_name <> p_confirm_name then raise exception using errcode='P0001', message='confirmation_mismatch'; end if;

  lock table public.daily_status in share row exclusive mode;
  v_counts := public.delete_user_counts(p_target_id, v_cutoff);
  v_future := (v_counts->>'futureCount')::integer;
  v_dayoff := (v_counts->>'futureDayoffCount')::integer;
  v_retained := (v_counts->>'retainedCount')::integer;
  if p_expected_cutoff is distinct from v_cutoff or p_expected_future_count is distinct from v_future
     or p_expected_dayoff_count is distinct from v_dayoff or p_expected_retained_count is distinct from v_retained then
    -- NOT 40001: PostgREST (hasql) transparently retries serialization failures, which would loop on a stale preview.
    raise exception using errcode='P0001', message='preview_changed';
  end if;

  delete from public.daily_status where user_id=p_target_id and work_date>v_cutoff;
  update public.user_history_labels set display_name=v_target_name, deleted_at=now()
    where user_id=p_target_id;
  insert into public.activity_logs(user_id,event_type,target_table,target_id,detail)
  values (p_actor_id,'delete','profiles',p_target_id,jsonb_build_object(
    'action','delete_user','actor_id',p_actor_id,'actor_name',coalesce(nullif(v_actor.display_name,''),nullif(v_actor.email,''),v_actor.id::text),
    'target_id',p_target_id,'target_name',v_target_name,
    'cutoff_date',v_cutoff,'deleted_count',v_future,'deleted_dayoff_count',v_dayoff,'retained_count',v_retained,'request_id',p_request_id));
  delete from public.profiles where id=p_target_id;
  return jsonb_build_object('status','cleaned','cutoffDate',v_cutoff,'deletedCount',v_future,'retainedCount',v_retained);
end;
$$;
revoke all on function public.delete_user_data(uuid,uuid,text,date,integer,integer,integer,uuid) from public, anon, authenticated;
grant execute on function public.delete_user_data(uuid,uuid,text,date,integer,integer,integer,uuid) to service_role;
commit;
