begin;

create table if not exists public.user_removal_audit (
  id uuid primary key default gen_random_uuid(),
  removed_user_id uuid not null,
  removed_role text not null,
  removed_status text not null
    check (removed_status in ('Active', 'Deactivated')),
  removed_by uuid references auth.users (id) on delete set null,
  removed_at timestamptz not null default clock_timestamp()
);

create table if not exists public.user_removal_requests (
  user_id uuid primary key,
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default clock_timestamp()
);

alter table public.user_removal_requests enable row level security;
revoke all on table public.user_removal_requests
  from public, anon, authenticated, service_role;

alter table public.user_removal_audit enable row level security;
revoke all on table public.user_removal_audit
  from public, anon, authenticated;
grant select on table public.user_removal_audit to authenticated;
drop policy if exists user_removal_audit_admin_read
  on public.user_removal_audit;
create policy user_removal_audit_admin_read
  on public.user_removal_audit for select to authenticated
  using (public.has_app_role(array['Administrator']));

drop trigger if exists user_removal_audit_append_only
  on public.user_removal_audit;
create trigger user_removal_audit_append_only
  before update or delete on public.user_removal_audit
  for each row execute function public.prevent_audit_mutation();

do $$
declare
  foreign_key record;
begin
  -- Keep immutable audit rows and their historical actor/profile IDs after removal.
  for foreign_key in
    select constraint_row.conrelid::regclass as table_name,
      constraint_row.conname
    from pg_constraint as constraint_row
    join pg_attribute as attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
      and attribute_row.attnum = any (constraint_row.conkey)
    where constraint_row.contype = 'f'
      and (
        (
          constraint_row.conrelid = 'public.user_invites'::regclass
          and constraint_row.confrelid = 'public.profiles'::regclass
          and attribute_row.attname = 'invited_by'
        )
        or (
          constraint_row.conrelid = 'public.verification_records'::regclass
          and constraint_row.confrelid = 'public.profiles'::regclass
          and attribute_row.attname in ('verified_by', 'assigned_by', 'profile_id')
        )
        or (
          constraint_row.conrelid = 'public.pos_stale_booking_resolutions'::regclass
          and constraint_row.confrelid = 'auth.users'::regclass
          and attribute_row.attname = 'actor_id'
        )
      )
  loop
    execute format(
      'alter table %s drop constraint %I',
      foreign_key.table_name,
      foreign_key.conname
    );
  end loop;
end;
$$;

drop trigger if exists prevent_self_role_change on public.profiles;
create trigger prevent_self_role_change
  before insert or update on public.profiles
  for each row execute function public.prevent_self_role_change();

create or replace function public.guard_profile_removal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  removal_request public.user_removal_requests%rowtype;
begin
  select *
  into removal_request
  from public.user_removal_requests
  where user_id = old.id
  for update;
  if not found then
    raise exception 'Profile removal requires the authorized account workflow'
      using errcode = '42501';
  end if;

  if old.account_status not in ('Active', 'Deactivated') then
    raise exception 'Only active or deactivated staff profiles can be removed'
      using errcode = '55000';
  end if;

  if old.role = 'Administrator' and old.account_status = 'Active' then
    update public.profile_admin_guard
    set administrator_count = administrator_count - 1
    where singleton and administrator_count > 1;

    if not found then
      if exists (
        select 1 from public.profile_admin_guard where singleton
      ) then
        raise exception 'Cannot remove the last active Administrator'
          using errcode = '23514';
      end if;
      raise exception 'Administrator protection state is unavailable'
        using errcode = '55000';
    end if;
  end if;

  insert into public.user_removal_audit (
    removed_user_id, removed_role, removed_status, removed_by
  ) values (
    old.id, old.role, old.account_status, removal_request.requested_by
  );
  delete from public.user_removal_requests where user_id = old.id;

  return old;
end;
$$;

revoke all on function public.guard_profile_removal()
  from public, anon, authenticated, service_role;

drop trigger if exists profiles_remove_guard on public.profiles;
create trigger profiles_remove_guard
  before delete on public.profiles
  for each row execute function public.guard_profile_removal();

create or replace function public.costtrack_prepare_user_removal(
  p_user_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_role text;
  target_status text;
  active_admin_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'This account operation requires the authorized server workflow'
      using errcode = '42501';
  end if;
  if p_user_id is null or p_actor_id is null or p_user_id = p_actor_id then
    raise exception 'The account removal request is invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles as actor
    where actor.id = p_actor_id
      and actor.role = 'Administrator'
      and actor.account_status = 'Active'
  ) then
    raise exception 'Only active Administrators may remove staff accounts'
      using errcode = '42501';
  end if;

  perform 1
  from public.profile_admin_guard
  where singleton
  for update;
  if not found then
    raise exception 'Administrator protection state is unavailable'
      using errcode = '55000';
  end if;
  select administrator_count
  into active_admin_count
  from public.profile_admin_guard
  where singleton;

  select profile.role, profile.account_status
  into target_role, target_status
  from public.profiles as profile
  where profile.id = p_user_id
  for update;
  if not found then
    return false;
  end if;
  if target_status not in ('Active', 'Deactivated') then
    raise exception 'Only active or deactivated staff accounts can be removed'
      using errcode = '55000';
  end if;
  if target_role = 'Administrator'
    and target_status = 'Active'
    and active_admin_count <= 1 then
    raise exception 'Cannot remove the last active Administrator'
      using errcode = '23514';
  end if;

  insert into public.user_removal_requests (user_id, requested_by)
  values (p_user_id, p_actor_id)
  on conflict (user_id) do update
  set requested_by = excluded.requested_by,
      requested_at = clock_timestamp();

  return true;
end;
$$;

revoke all on function public.costtrack_prepare_user_removal(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.costtrack_prepare_user_removal(uuid, uuid)
  to service_role;

commit;
