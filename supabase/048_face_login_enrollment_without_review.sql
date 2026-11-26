begin;

create or replace function public.costtrack_create_verified_user_account(
  p_actor_id uuid,
  p_profile_id uuid,
  p_email text,
  p_full_name text,
  p_role text,
  p_verification_record jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_record_id uuid;
  v_id_image_path text;
  v_selfie_path text;
  v_override_used boolean;
begin
  if p_actor_id is null
    or p_profile_id is null
    or p_email is null
    or p_full_name is null
    or p_role is null
    or p_role not in (
      'Administrator', 'Manager', 'Receptionist', 'Inventory Clerk', 'Chef / Kitchen Staff'
    )
    or p_verification_record is null
    or jsonb_typeof(p_verification_record) <> 'object' then
    raise exception 'Invalid verified account details'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles as actor
    where actor.id = p_actor_id
      and actor.role = 'Administrator'
      and actor.account_status = 'Active'
  ) then
    raise exception 'Only an active Administrator can create a staff account'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_profile_id
      and lower(auth_user.email) = lower(btrim(p_email))
      and auth_user.email_confirmed_at is not null
  ) then
    raise exception 'The confirmed sign-in account does not match the employee email'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id = p_profile_id
      or lower(profile.email) = lower(btrim(p_email))
  ) then
    raise exception 'An account already exists for this email address'
      using errcode = '23505';
  end if;

  if coalesce(p_verification_record->>'applicant_name', '') <> btrim(p_full_name)
    or nullif(btrim(coalesce(p_verification_record->>'id_type', '')), '') is null
    or (
      p_verification_record->>'id_number_masked' is not null
      and p_verification_record->>'id_number_masked' !~ '^\*{4}[A-Za-z0-9]{1,4}$'
    )
    or jsonb_typeof(p_verification_record->'ocr_summary') is distinct from 'object'
    or coalesce(p_verification_record->'ocr_summary'->>'full_name', '') <> btrim(p_full_name)
    or p_verification_record->>'face_scan_passed' <> 'true'
    or p_verification_record->>'face_match_result' not in ('match', 'manual_review')
    or nullif(p_verification_record->>'face_match_score', '') is null
    or (
      p_verification_record->>'face_match_result' = 'match'
      and (p_verification_record->>'face_match_score')::numeric < 85
    )
    or (
      p_verification_record->>'face_match_result' = 'manual_review'
      and (
        (p_verification_record->>'face_match_score')::numeric < 70
        or (p_verification_record->>'face_match_score')::numeric >= 85
      )
    )
    or coalesce(p_verification_record->>'override_used', '') not in ('true', 'false')
    or coalesce(p_verification_record->>'consent_given', 'false') <> 'true'
    or jsonb_typeof(p_verification_record->'face_descriptor') is distinct from 'array'
    or (
      p_verification_record->>'override_used' = 'false'
      and (
        coalesce(p_verification_record->'ocr_summary'->>'ocr_passed', 'false') <> 'true'
        or p_verification_record->>'face_match_result' <> 'match'
      )
    )
    or (
      p_verification_record->>'override_used' = 'true'
      and (
        (
          coalesce(p_verification_record->'ocr_summary'->>'ocr_passed', 'true') <> 'false'
          and p_verification_record->>'face_match_result' <> 'manual_review'
        )
        or char_length(btrim(coalesce(p_verification_record->>'override_reason', ''))) not between 1 and 500
      )
    )
    or ((p_verification_record->'ocr_summary') - array[
      'full_name', 'dob', 'address', 'ocr_passed'
    ]::text[]) <> '{}'::jsonb
    or p_verification_record->'ocr_summary' ? 'id_number' then
    raise exception 'ID, face match, and consent checks must all pass before account creation'
      using errcode = '23514';
  end if;

  if (p_verification_record->>'face_match_score')::numeric not between 0 and 100 then
    raise exception 'The face match score is invalid'
      using errcode = '22023';
  end if;
  v_override_used := p_verification_record->>'override_used' = 'true';

  v_id_image_path := p_verification_record->>'id_image_path';
  v_selfie_path := p_verification_record->>'selfie_path';
  if v_id_image_path !~ (
    '^' || p_actor_id::text || '/[0-9a-f-]{36}/id[.](jpg|png)$'
  ) or v_selfie_path !~ (
    '^' || p_actor_id::text || '/[0-9a-f-]{36}/selfie[.]jpg$'
  ) or split_part(v_id_image_path, '/', 2)
    <> split_part(v_selfie_path, '/', 2) then
    raise exception 'Verification image paths are invalid'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'verification-evidence'
      and name = v_id_image_path
  ) or not exists (
    select 1 from storage.objects
    where bucket_id = 'verification-evidence'
      and name = v_selfie_path
  ) then
    raise exception 'Both verification images must be in private storage'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.user_face_templates as template
    where template.user_id = p_profile_id
  ) then
    raise exception 'A verified face template is required for the new account'
      using errcode = '23514';
  end if;

  insert into public.profiles (
    id, email, full_name, role, account_status
  ) values (
    p_profile_id, lower(btrim(p_email)), btrim(p_full_name), p_role, 'Active'
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
    override_reason,
    verified_by,
    role_assigned,
    assigned_by,
    assigned_at,
    profile_id,
    id_image_path,
    selfie_path,
    consent_given,
    consent_at,
    final_status
  ) values (
    p_verification_record->>'applicant_name',
    p_verification_record->>'id_type',
    p_verification_record->>'id_number_masked',
    p_verification_record->'ocr_summary',
    true,
    (p_verification_record->>'face_match_score')::numeric,
    p_verification_record->>'face_match_result',
    v_override_used,
    case when v_override_used
      then btrim(p_verification_record->>'override_reason')
      else null
    end,
    p_actor_id,
    p_role,
    p_actor_id,
    clock_timestamp(),
    p_profile_id,
    v_id_image_path,
    v_selfie_path,
    true,
    clock_timestamp(),
    'Approved'
  )
  returning id into v_record_id;

  return v_record_id;
end;
$$;

revoke all on function public.costtrack_create_verified_user_account(
  uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.costtrack_create_verified_user_account(
  uuid, uuid, text, text, text, jsonb
) to service_role;

commit;
