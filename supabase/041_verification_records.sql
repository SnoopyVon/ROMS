-- Verification audit records are append-only. Rollback deliberately preserves
-- records and the private evidence bucket.
begin;

create table if not exists public.verification_records (
  id uuid primary key default gen_random_uuid(),
  applicant_name text not null
    check (char_length(btrim(applicant_name)) between 1 and 160),
  id_type text not null
    check (char_length(btrim(id_type)) between 1 and 100),
  id_number_masked text
    check (
      id_number_masked is null
      or id_number_masked ~ '^\*{4}[A-Za-z0-9]{1,4}$'
    ),
  ocr_summary jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(ocr_summary) = 'object'
      and not (ocr_summary ? 'id_number')
    ),
  face_match_score numeric(5, 2)
    check (face_match_score is null or face_match_score between 0 and 100),
  face_match_result text not null
    check (face_match_result in ('match', 'no_match', 'unable')),
  override_used boolean not null default false,
  override_reason text,
  verified_by uuid not null
    references public.profiles (id) on delete restrict,
  verified_at timestamptz not null default clock_timestamp(),
  role_assigned text
    check (
      role_assigned is null
      or role_assigned in (
        'Administrator',
        'Manager',
        'Receptionist',
        'Inventory Clerk',
        'Chef / Kitchen Staff'
      )
    ),
  assigned_by uuid references public.profiles (id) on delete restrict,
  assigned_at timestamptz,
  invitation_id uuid references public.user_invites (id) on delete restrict,
  profile_id uuid references public.profiles (id) on delete restrict,
  id_image_path text,
  selfie_path text,
  consent_given boolean not null default false,
  consent_at timestamptz,
  final_status text not null
    check (final_status in ('Approved', 'Rejected', 'Cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  retention_until timestamptz not null
    default (clock_timestamp() + interval '90 days'),
  supersedes_id uuid
    references public.verification_records (id) on delete restrict,
  constraint verification_records_override_reason_check check (
    (override_used and char_length(btrim(coalesce(override_reason, ''))) between 1 and 500)
    or (not override_used and override_reason is null)
  ),
  constraint verification_records_consent_check check (
    (consent_given and consent_at is not null)
    or (not consent_given and consent_at is null)
  ),
  constraint verification_records_status_links_check check (
    (
      final_status = 'Approved'
      and invitation_id is not null
      and profile_id is not null
      and role_assigned is not null
      and assigned_by is not null
      and assigned_at is not null
      and id_image_path is not null
      and selfie_path is not null
    )
    or (
      final_status in ('Rejected', 'Cancelled')
      and profile_id is null
    )
  )
);

create index if not exists verification_records_verified_at_idx
  on public.verification_records (verified_at desc);
create index if not exists verification_records_applicant_name_idx
  on public.verification_records (lower(applicant_name));

create or replace function public.reject_verification_record_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Verification records are append-only'
    using errcode = '55000';
end;
$$;

revoke all on function public.reject_verification_record_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists verification_records_append_only
  on public.verification_records;
create trigger verification_records_append_only
  before update or delete on public.verification_records
  for each row execute function public.reject_verification_record_mutation();

alter table public.verification_records enable row level security;
revoke all on table public.verification_records
  from public, anon, authenticated, service_role;
grant select on table public.verification_records to authenticated;

drop policy if exists verification_records_admin_read
  on public.verification_records;
create policy verification_records_admin_read
  on public.verification_records
  for select to authenticated
  using (public.has_app_role(array['Administrator']));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'verification-evidence',
  'verification-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/png']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists verification_evidence_admin_select
  on storage.objects;
drop policy if exists verification_evidence_admin_insert
  on storage.objects;
drop policy if exists verification_evidence_admin_update
  on storage.objects;
drop policy if exists verification_evidence_admin_delete
  on storage.objects;
drop policy if exists verification_evidence_admin_select_boundary
  on storage.objects;
drop policy if exists verification_evidence_admin_insert_boundary
  on storage.objects;
drop policy if exists verification_evidence_admin_update_boundary
  on storage.objects;
drop policy if exists verification_evidence_admin_delete_boundary
  on storage.objects;

create policy verification_evidence_admin_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'verification-evidence'
    and public.has_app_role(array['Administrator'])
  );
create policy verification_evidence_admin_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verification-evidence'
    and public.has_app_role(array['Administrator'])
  );
create policy verification_evidence_admin_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'verification-evidence'
    and public.has_app_role(array['Administrator'])
  )
  with check (
    bucket_id = 'verification-evidence'
    and public.has_app_role(array['Administrator'])
  );
create policy verification_evidence_admin_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'verification-evidence'
    and public.has_app_role(array['Administrator'])
  );

-- Restrictive bucket-scoped boundaries prevent any broader Storage policy
-- from granting non-Administrator access to verification evidence.
create policy verification_evidence_admin_select_boundary
  on storage.objects as restrictive for select to public
  using (
    bucket_id <> 'verification-evidence'
    or public.has_app_role(array['Administrator'])
  );
create policy verification_evidence_admin_insert_boundary
  on storage.objects as restrictive for insert to public
  with check (
    bucket_id <> 'verification-evidence'
    or public.has_app_role(array['Administrator'])
  );
create policy verification_evidence_admin_update_boundary
  on storage.objects as restrictive for update to public
  using (
    bucket_id <> 'verification-evidence'
    or public.has_app_role(array['Administrator'])
  )
  with check (
    bucket_id <> 'verification-evidence'
    or public.has_app_role(array['Administrator'])
  );
create policy verification_evidence_admin_delete_boundary
  on storage.objects as restrictive for delete to public
  using (
    bucket_id <> 'verification-evidence'
    or public.has_app_role(array['Administrator'])
  );

create or replace function public.costtrack_create_verification_record(
  p_actor_id uuid,
  p_profile_id uuid,
  p_profile_email text,
  p_profile_name text,
  p_role_assigned text,
  p_invitation_id uuid,
  p_applicant_name text,
  p_id_type text,
  p_id_number_masked text,
  p_ocr_summary jsonb,
  p_face_match_score numeric,
  p_face_match_result text,
  p_override_used boolean,
  p_override_reason text,
  p_id_image_path text,
  p_selfie_path text,
  p_consent_given boolean,
  p_consent_at timestamptz,
  p_final_status text,
  p_supersedes_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth, storage
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_status text;
  v_invite_email text;
  v_invite_name text;
  v_invite_role text;
  v_invite_actor uuid;
  v_invite_status text;
  v_auth_email text;
  v_existing_profile_email text;
  v_existing_profile_name text;
  v_ocr_passed boolean;
  v_ocr_summary jsonb;
  v_now timestamptz := clock_timestamp();
  v_profile_id uuid;
  v_record_id uuid;
begin
  if auth.role() = 'service_role' then
    v_actor_id := p_actor_id;
  else
    v_actor_id := auth.uid();
    if v_actor_id is null
      or (p_actor_id is not null and p_actor_id is distinct from v_actor_id)
      or not public.has_app_role(array['Administrator']) then
      raise exception 'Only an Administrator may create verification records'
        using errcode = '42501';
    end if;
  end if;

  if v_actor_id is null then
    raise exception 'An Administrator actor is required'
      using errcode = '42501';
  end if;

  select profile.role, profile.account_status
  into v_actor_role, v_actor_status
  from public.profiles as profile
  where profile.id = v_actor_id;
  if not found
    or v_actor_role <> 'Administrator'
    or v_actor_status <> 'Active' then
    raise exception 'The verification record actor must be an active Administrator'
      using errcode = '42501';
  end if;

  if char_length(btrim(coalesce(p_applicant_name, ''))) not between 1 and 160
    or char_length(btrim(coalesce(p_id_type, ''))) not between 1 and 100 then
    raise exception 'Applicant name and ID type are required'
      using errcode = '22023';
  end if;
  if p_id_number_masked is not null
    and p_id_number_masked !~ '^\*{4}[A-Za-z0-9]{1,4}$' then
    raise exception 'Only a masked ID number ending in at most four characters may be stored'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_ocr_summary) is distinct from 'object' then
    raise exception 'OCR summary must be a JSON object'
      using errcode = '22023';
  end if;
  if p_ocr_summary->>'ocr_passed' is null
    or p_ocr_summary->>'ocr_passed' not in ('true', 'false') then
    raise exception 'OCR completion status is required'
      using errcode = '22023';
  end if;
  v_ocr_passed := (p_ocr_summary->>'ocr_passed')::boolean;
  if char_length(coalesce(p_ocr_summary->>'full_name', '')) > 160
    or char_length(coalesce(p_ocr_summary->>'dob', '')) > 40
    or char_length(coalesce(p_ocr_summary->>'address', '')) > 1000 then
    raise exception 'OCR summary fields exceed their allowed lengths'
      using errcode = '22023';
  end if;
  v_ocr_summary := jsonb_strip_nulls(jsonb_build_object(
    'full_name', nullif(btrim(p_ocr_summary->>'full_name'), ''),
    'dob', nullif(btrim(p_ocr_summary->>'dob'), ''),
    'address', nullif(btrim(p_ocr_summary->>'address'), ''),
    'ocr_passed', v_ocr_passed
  ));

  if p_face_match_result is null
    or p_face_match_result not in ('match', 'no_match', 'unable')
    or (p_face_match_score is not null and p_face_match_score not between 0 and 100)
    or (p_face_match_result = 'match' and p_face_match_score is null) then
    raise exception 'Face match result or score is invalid'
      using errcode = '22023';
  end if;
  if p_override_used is null
    or (p_override_used and char_length(btrim(coalesce(p_override_reason, ''))) not between 1 and 500)
    or (not p_override_used and p_override_reason is not null) then
    raise exception 'A valid reason is required for a manual override'
      using errcode = '22023';
  end if;
  if p_consent_given is null
    or (p_consent_given and p_consent_at is null)
    or (not p_consent_given and p_consent_at is not null) then
    raise exception 'Consent value and timestamp do not match'
      using errcode = '22023';
  end if;
  if p_final_status is null
    or p_final_status not in ('Approved', 'Rejected', 'Cancelled') then
    raise exception 'Verification status is invalid'
      using errcode = '22023';
  end if;
  if p_role_assigned is not null and p_role_assigned not in (
    'Administrator', 'Manager', 'Receptionist', 'Inventory Clerk',
    'Chef / Kitchen Staff'
  ) then
    raise exception 'Assigned role is invalid'
      using errcode = '22023';
  end if;
  if p_supersedes_id is not null and not exists (
    select 1
    from public.verification_records as prior_record
    where prior_record.id = p_supersedes_id
      and prior_record.applicant_name = btrim(p_applicant_name)
  ) then
    raise exception 'A correction must reference an earlier record for the same applicant'
      using errcode = '23514';
  end if;

  if p_final_status = 'Approved' then
    if p_profile_id is null
      or p_invitation_id is null
      or p_role_assigned is null
      or p_profile_email is null
      or p_profile_name is null
      or p_id_image_path is null
      or p_selfie_path is null then
      raise exception 'An approved verification record requires its invitation, profile, role, and private evidence'
        using errcode = '22023';
    end if;
    if (not v_ocr_passed or p_face_match_result <> 'match')
      and (not p_override_used or nullif(btrim(p_override_reason), '') is null) then
      raise exception 'Manual review requires an Administrator override reason'
        using errcode = '42501';
    end if;
    if p_role_assigned not in (
      'Manager', 'Receptionist', 'Inventory Clerk', 'Chef / Kitchen Staff'
    ) then
      raise exception 'The invitation role is not supported'
        using errcode = '22023';
    end if;
    if p_id_image_path !~ (
      '^' || v_actor_id::text || '/[0-9a-f-]{36}/id[.](jpg|png)$'
    ) or p_selfie_path !~ (
      '^' || v_actor_id::text || '/[0-9a-f-]{36}/selfie[.]jpg$'
    ) or split_part(p_id_image_path, '/', 2)
      <> split_part(p_selfie_path, '/', 2) then
      raise exception 'Evidence paths are invalid or do not belong to this Administrator'
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'verification-evidence'
        and name = p_id_image_path
    ) or not exists (
      select 1 from storage.objects
      where bucket_id = 'verification-evidence'
        and name = p_selfie_path
    ) then
      raise exception 'Both verification images must be uploaded to private evidence storage'
        using errcode = '23514';
    end if;

    select invite.email, invite.full_name, invite.role, invite.invited_by, invite.status
    into v_invite_email, v_invite_name, v_invite_role, v_invite_actor, v_invite_status
    from public.user_invites as invite
    where invite.id = p_invitation_id
    for update;
    if not found
      or v_invite_role <> p_role_assigned
      or v_invite_email <> lower(btrim(p_profile_email))
      or v_invite_name <> btrim(p_profile_name)
      or v_invite_name <> btrim(p_applicant_name) then
      raise exception 'The invitation does not match the reviewed applicant and assigned role'
        using errcode = '23514';
    end if;

    select lower(auth_user.email)
    into v_auth_email
    from auth.users as auth_user
    where auth_user.id = p_profile_id;
    if not found or v_auth_email <> v_invite_email then
      raise exception 'The Auth account does not match the pending invitation'
        using errcode = '23514';
    end if;

    select lower(profile.email), profile.full_name
    into v_existing_profile_email, v_existing_profile_name
    from public.profiles as profile
    where profile.id = p_profile_id;
    if found then
      if p_supersedes_id is null
        or v_existing_profile_email <> v_invite_email
        or v_existing_profile_name <> v_invite_name
        or not exists (
          select 1
          from public.verification_records as prior_record
          where prior_record.id = p_supersedes_id
            and prior_record.profile_id = p_profile_id
            and prior_record.invitation_id = p_invitation_id
            and prior_record.role_assigned = p_role_assigned
        ) then
        raise exception 'An existing profile can only receive a linked verification correction'
          using errcode = '23514';
      end if;
      v_profile_id := p_profile_id;
    else
      if v_invite_status <> 'Pending' or v_invite_actor <> v_actor_id then
        raise exception 'A new profile requires this Administrator’s pending invitation'
          using errcode = '23514';
      end if;
      insert into public.profiles (
        id,
        email,
        full_name,
        role,
        account_status
      ) values (
        p_profile_id,
        v_invite_email,
        v_invite_name,
        v_invite_role,
        'Pending'
      );
      v_profile_id := p_profile_id;
    end if;
  elsif p_profile_id is not null
    or p_profile_email is not null
    or p_profile_name is not null then
    raise exception 'Rejected or cancelled records cannot create a profile'
      using errcode = '22023';
  end if;

  insert into public.verification_records (
    applicant_name,
    id_type,
    id_number_masked,
    ocr_summary,
    face_match_score,
    face_match_result,
    override_used,
    override_reason,
    verified_by,
    verified_at,
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
    created_at,
    retention_until,
    supersedes_id
  ) values (
    btrim(p_applicant_name),
    btrim(p_id_type),
    p_id_number_masked,
    v_ocr_summary,
    p_face_match_score,
    p_face_match_result,
    p_override_used,
    nullif(btrim(p_override_reason), ''),
    v_actor_id,
    v_now,
    p_role_assigned,
    case when p_role_assigned is null then null else v_actor_id end,
    case when p_role_assigned is null then null else v_now end,
    p_invitation_id,
    v_profile_id,
    p_id_image_path,
    p_selfie_path,
    p_consent_given,
    p_consent_at,
    p_final_status,
    v_now,
    v_now + interval '90 days',
    p_supersedes_id
  )
  returning id into v_record_id;

  return v_record_id;
end;
$$;

revoke all on function public.costtrack_create_verification_record(
  uuid, uuid, text, text, text, uuid, text, text, text, jsonb, numeric,
  text, boolean, text, text, text, boolean, timestamptz, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.costtrack_create_verification_record(
  uuid, uuid, text, text, text, uuid, text, text, text, jsonb, numeric,
  text, boolean, text, text, text, boolean, timestamptz, text, uuid
) to authenticated, service_role;

commit;
