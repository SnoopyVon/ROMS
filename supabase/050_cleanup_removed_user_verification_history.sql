begin;

do $$
declare
  cleanup_admin_id uuid;
  removed_profile_id uuid;
  removed_record_count integer;
begin
  if exists (
    select 1
    from public.user_removal_audit as removal_audit
    join public.verification_records as record
      on record.profile_id = removal_audit.removed_user_id
    where not exists (
      select 1
      from public.profiles as profile
      where profile.id = removal_audit.removed_user_id
    )
  ) then
    select id
    into cleanup_admin_id
    from public.profiles
    where role = 'Administrator'
      and account_status = 'Active'
    order by id
    limit 1;

    if cleanup_admin_id is null then
      raise exception 'An active Administrator is required to clean removed-user verification history'
        using errcode = '42501';
    end if;

    for removed_profile_id in
      select distinct removal_audit.removed_user_id
      from public.user_removal_audit as removal_audit
      join public.verification_records as record
        on record.profile_id = removal_audit.removed_user_id
      where not exists (
        select 1
        from public.profiles as profile
        where profile.id = removal_audit.removed_user_id
      )
      order by removal_audit.removed_user_id
    loop
      insert into public.user_removal_requests (user_id, requested_by)
      values (removed_profile_id, cleanup_admin_id)
      on conflict (user_id) do update
      set requested_by = excluded.requested_by,
          requested_at = clock_timestamp();

      loop
        delete from public.verification_records as target_record
        where target_record.profile_id = removed_profile_id
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
        where profile_id = removed_profile_id
      ) then
        raise exception 'Verification history for removed profile % is linked to another record and cannot be safely removed',
          removed_profile_id
          using errcode = '23503';
      end if;

      delete from public.user_removal_requests
      where user_id = removed_profile_id;
    end loop;
  end if;
end;
$$;

commit;
