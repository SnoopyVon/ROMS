-- Run as the database owner after migration 049.
-- Requires an active Administrator and two other active non-Administrator profiles.
-- All fixture changes are rolled back.
begin;

do $$
declare
  admin_id uuid;
  target_id uuid;
  target_name text;
  target_role text;
  other_id uuid;
  other_role text;
  target_invitation_id uuid;
  other_invitation_id uuid;
  target_record_id uuid;
  target_correction_id uuid := gen_random_uuid();
  other_record_id uuid := gen_random_uuid();
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

  select id, full_name, role
  into target_id, target_name, target_role
  from public.profiles
  where role <> 'Administrator'
    and account_status = 'Active'
  order by id
  limit 1;
  if target_id is null then
    raise exception 'FAIL: provision an active non-Administrator staff profile first.';
  end if;

  select id, role
  into other_id, other_role
  from public.profiles
  where id <> target_id
    and role <> 'Administrator'
    and account_status = 'Active'
  order by id
  limit 1;
  if other_id is null then
    raise exception 'FAIL: provision a second active profile first.';
  end if;

  insert into public.user_invites (
    email, full_name, role, invited_by, expires_at
  ) values (
    'remove-verification-' || replace(gen_random_uuid()::text, '-', '') || '@example.test',
    target_name,
    target_role,
    admin_id,
    clock_timestamp() + interval '7 days'
  )
  returning id into target_invitation_id;

  insert into public.user_invites (
    email, full_name, role, invited_by, expires_at
  ) values (
    'retain-verification-' || replace(gen_random_uuid()::text, '-', '') || '@example.test',
    'Unrelated Verification Fixture',
    other_role,
    admin_id,
    clock_timestamp() + interval '7 days'
  )
  returning id into other_invitation_id;

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
    target_name,
    'Removal Acceptance Fixture',
    '****1234',
    jsonb_build_object('full_name', target_name, 'ocr_passed', true),
    true,
    95,
    'match',
    false,
    admin_id,
    target_role,
    admin_id,
    clock_timestamp(),
    target_invitation_id,
    target_id,
    'removal-acceptance-id.jpg',
    'removal-acceptance-selfie.jpg',
    true,
    clock_timestamp(),
    'Approved'
  )
  returning id into target_record_id;

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
    target_name,
    'Removal Acceptance Correction',
    '****1234',
    jsonb_build_object('full_name', target_name, 'ocr_passed', true),
    true,
    96,
    'match',
    false,
    admin_id,
    target_role,
    admin_id,
    clock_timestamp(),
    target_invitation_id,
    target_id,
    'removal-acceptance-correction-id.jpg',
    'removal-acceptance-correction-selfie.jpg',
    true,
    clock_timestamp(),
    'Approved',
    target_record_id
  )
  returning id into target_correction_id;

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
    'Unrelated Verification Fixture',
    'Removal Acceptance Fixture',
    '****5678',
    jsonb_build_object('full_name', 'Unrelated Verification Fixture', 'ocr_passed', true),
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
    'retained-acceptance-id.jpg',
    'retained-acceptance-selfie.jpg',
    true,
    clock_timestamp(),
    'Approved'
  );

  insert into public.user_removal_requests (user_id, requested_by)
  values (target_id, admin_id);

  delete from public.profiles where id = target_id;

  if exists (
    select 1
    from public.verification_records
    where profile_id = target_id
       or id in (target_record_id, target_correction_id)
  ) then
    raise exception 'FAIL: verification history for the removed profile remains.';
  end if;
  if not exists (
    select 1
    from public.verification_records
    where id = other_record_id
       or (
         profile_id = other_id
         and applicant_name = 'Unrelated Verification Fixture'
       )
  ) then
    raise exception 'FAIL: an unrelated profile verification record was removed.';
  end if;
end;
$$;

rollback;
