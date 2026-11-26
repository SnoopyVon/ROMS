begin;

create or replace function public.reject_verification_record_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE'
    and old.profile_id is not null
    and exists (
      select 1
      from public.user_removal_requests as removal_request
      join public.profiles as actor
        on actor.id = removal_request.requested_by
      where removal_request.user_id = old.profile_id
        and actor.role = 'Administrator'
        and actor.account_status = 'Active'
    ) then
    return old;
  end if;

  raise exception 'Verification records are append-only outside authorized user removal'
    using errcode = '55000';
end;
$$;

revoke all on function public.reject_verification_record_mutation()
  from public, anon, authenticated, service_role;

create or replace function public.guard_profile_removal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  removal_request public.user_removal_requests%rowtype;
  removed_record_count integer;
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

  loop
    delete from public.verification_records as target_record
    where target_record.profile_id = old.id
      and not exists (
        select 1
        from public.verification_records as later_record
        where later_record.supersedes_id = target_record.id
      );
    get diagnostics removed_record_count = row_count;
    exit when removed_record_count = 0;
  end loop;

  if exists (
    select 1
    from public.verification_records
    where profile_id = old.id
  ) then
    raise exception 'Verification history is linked to another record and cannot be safely removed'
      using errcode = '23503';
  end if;

  delete from public.user_removal_requests where user_id = old.id;

  return old;
end;
$$;

revoke all on function public.guard_profile_removal()
  from public, anon, authenticated, service_role;

commit;
