-- Run as the database owner after migrations 049 and 050.
-- Requires an active Administrator and one active non-Administrator profile.
-- All fixture changes are rolled back.
begin;

do $$
declare
  admin_id uuid;
  other_id uuid;
  other_role text;
  orphan_profile_id uuid := gen_random_uuid();
  cleanup_profile_id uuid;
  removed_invitation_id uuid;
  other_invitation_id uuid;
  removed_record_id uuid;
  removed_correction_id uuid;
  other_record_id uuid := gen_random_uuid();
  removed_record_count integer;
begin
  select id
  into admin_id
  from public.profiles
  where role = 'Administrator'
    and account_status = 'Active'
  order by id
  limit 1;
  if admin_id is null then
    raise exception 'FAIL: provision an active Administrator first.';
  end if;

  select id, role
  into other_id, other_role
  from public.profiles
  where role <> 'Administrator'
    and account_status = 'Active'
  order by id
  limit 1;
  if other_id is null then
    raise exception 'FAIL: provision an active non-Administrator profile first.';
  end if;

  insert into public.user_invites (
    email, full_name, role, invited_by, expires_at
  ) values (
    'remove-old-history-' || replace(gen_random_uuid()::text, '-', '') || '@example.test',
    'Removed History Fixture',
    other_role,
    admin_id,
    clock_timestamp() + interval '7 days'
  )
  returning id into removed_invitation_id;

  insert into public.user_invites (
    email, full_name, role, invited_by, expires_at
  ) values (
    'retain-old-history-' || replace(gen_random_uuid()::text, '-', '') || '@example.test',
    'Retained History Fixture',
    other_role,
    admin_id,
    clock_timestamp() + interval '7 days'
  )
  returning id into other_invitation_id;

  insert into public.user_removal_audit (
    removed_user_id, removed_role, removed_status, removed_by
  ) values (
    orphan_profile_id, other_role, 'Active', admin_id
  );

  insert into public.verification_records (
    applicant_name,
    id_type,
    id_number_masked,
    ocr_summary,
    face_scan_passed,
    face_match_score,
    face_match_result,
    override_used,
    verified_by,
    role_assigned,
    assigned_by,
    assigned_at,
    invitation_id,
    profile_id,
    id_image_path,
    selfie_path,
    consent_given,
    consent_at,
    final_status
  ) values (
    'Removed History Fixture',
    'Cleanup Acceptance Fixture',
    '****1234',
    jsonb_build_object('full_name', 'Removed History Fixture', 'ocr_passed', true),
    true,
    95,
    'match',
    false,
    admin_id,
    other_role,
    admin_id,
    clock_timestamp(),
    removed_invitation_id,
    orphan_profile_id,
    'cleanup-acceptance-id.jpg',
    'cleanup-acceptance-selfie.jpg',
    true,
    clock_timestamp(),
    'Approved'
  )
  returning id into removed_record_id;

  insert into public.verification_records (
    applicant_name,
    id_type,
    id_number_masked,
    ocr_summary,
    face_scan_passed,
    face_match_score,
    face_match_result,
    override_used,
    verified_by,
    role_assigned,
    assigned_by,
    assigned_at,
    invitation_id,
    profile_id,
    id_image_path,
    selfie_path,
    consent_given,
    consent_at,
    final_status,
    supersedes_id
  ) values (
    'Removed History Fixture',
    'Cleanup Acceptance Correction',
    '****1234',
    jsonb_build_object('full_name', 'Removed History Fixture', 'ocr_passed', true),
    true,
    96,
    'match',
    false,
    admin_id,
    other_role,
    admin_id,
    clock_timestamp(),
    removed_invitation_id,
    orphan_profile_id,
    'cleanup-acceptance-correction-id.jpg',
    'cleanup-acceptance-correction-selfie.jpg',
    true,
    clock_timestamp(),
    'Approved',
    removed_record_id
  )
  returning id into removed_correction_id;

  insert into public.verification_records (
    id,
    applicant_name,
    id_type,
    id_number_masked,
    ocr_summary,
    face_scan_passed,
    face_match_score,
    face_match_result,
    override_used,
    verified_by,
    role_assigned,
    assigned_by,
    assigned_at,
    invitation_id,
    profile_id,
    id_image_path,
    selfie_path,
    consent_given,
    consent_at,
    final_status
  ) values (
    other_record_id,
    'Retained History Fixture',
    'Cleanup Acceptance Fixture',
    '****5678',
    jsonb_build_object('full_name', 'Retained History Fixture', 'ocr_passed', true),
    true,
    95,
    'match',
    false,
    admin_id,
    other_role,
    admin_id,
    clock_timestamp(),
    other_invitation_id,
    other_id,
    'retained-cleanup-acceptance-id.jpg',
    'retained-cleanup-acceptance-selfie.jpg',
    true,
    clock_timestamp(),
    'Approved'
  );

  for cleanup_profile_id in
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
    values (cleanup_profile_id, admin_id);

    loop
      delete from public.verification_records as target_record
      where target_record.profile_id = cleanup_profile_id
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
      where profile_id = cleanup_profile_id
    ) then
      raise exception 'FAIL: old verification history for the removed profile remains.';
    end if;

    delete from public.user_removal_requests
    where user_id = cleanup_profile_id;
  end loop;

  if exists (
    select 1
    from public.verification_records
    where profile_id = orphan_profile_id
       or id in (removed_record_id, removed_correction_id)
  ) then
    raise exception 'FAIL: old verification history for the removed profile remains.';
  end if;

  if not exists (
    select 1
    from public.verification_records
    where id = other_record_id
      and profile_id = other_id
  ) then
    raise exception 'FAIL: an unrelated profile verification record was removed.';
  end if;
  if not exists (
    select 1
    from public.user_removal_audit
    where removed_user_id = orphan_profile_id
  ) then
    raise exception 'FAIL: the user-removal audit record was removed.';
  end if;
  if exists (
    select 1
    from public.user_removal_requests
    where user_id = orphan_profile_id
  ) then
    raise exception 'FAIL: the temporary cleanup authorization was not removed.';
  end if;
end;
$$;

rollback;
