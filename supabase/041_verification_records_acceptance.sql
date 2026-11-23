-- Run as the database owner after migration 041 and after deploying the
-- verification-aware invite-user Edge Function.
-- Requires an active Administrator, one active profile for each staff role,
-- a test Auth user with no profile, and no existing invite for that test email.
-- The test Auth user's email must be verification-test@example.test.
-- All fixture rows and storage objects are rolled back.
begin;

do $$
declare
  admin_id uuid;
  test_auth_id uuid;
  test_email text;
  role_profiles jsonb;
  role_count integer;
  batch_id uuid := gen_random_uuid();
  invitation_id uuid;
  id_path text;
  selfie_path text;
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

  select jsonb_agg(jsonb_build_object('id', id, 'role', role) order by role),
         count(distinct role)
  into role_profiles, role_count
  from (
    select distinct on (role) id, role
    from public.profiles
    where role in (
      'Manager',
      'Receptionist',
      'Inventory Clerk',
      'Chef / Kitchen Staff'
    )
      and account_status = 'Active'
    order by role, id
  ) as fixtures;
  if coalesce(role_count, 0) <> 4 then
    raise exception 'FAIL: provision one active Manager, Receptionist, Inventory Clerk, and Chef / Kitchen Staff profile first.';
  end if;

  select auth_user.id, lower(auth_user.email)
  into test_auth_id, test_email
  from auth.users as auth_user
  where lower(auth_user.email) = 'verification-test@example.test'
    and not exists (
      select 1 from public.profiles as profile
      where profile.id = auth_user.id
    )
    and not exists (
      select 1 from public.user_invites as invite
      where invite.email = lower(auth_user.email)
        and invite.status in ('Pending', 'Expired')
    )
  order by auth_user.created_at desc
  limit 1;
  if test_auth_id is null then
    raise exception 'FAIL: create an Auth-only test user with email verification-test@example.test and no profile.';
  end if;

  id_path := admin_id::text || '/' || batch_id::text || '/id.jpg';
  selfie_path := admin_id::text || '/' || batch_id::text || '/selfie.jpg';

  perform set_config('costtrack.test.admin_id', admin_id::text, true);
  perform set_config('costtrack.test.test_auth_id', test_auth_id::text, true);
  perform set_config('costtrack.test.test_email', test_email, true);
  perform set_config('costtrack.test.role_profiles', role_profiles::text, true);
  perform set_config('costtrack.test.id_path', id_path, true);
  perform set_config('costtrack.test.selfie_path', selfie_path, true);
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );

  if (select public_bucket.public
      from storage.buckets as public_bucket
      where public_bucket.id = 'verification-evidence') is distinct from false then
    raise exception 'FAIL: verification-evidence bucket is not private.';
  end if;

  insert into public.user_invites (
    email,
    full_name,
    role,
    invited_by,
    expires_at
  ) values (
    test_email,
    'Verification Acceptance Fixture',
    'Manager',
    admin_id,
    clock_timestamp() + interval '7 days'
  )
  returning id into invitation_id;
  perform set_config('costtrack.test.invitation_id', invitation_id::text, true);

  insert into storage.objects (bucket_id, name, metadata) values
    (
      'verification-evidence',
      id_path,
      jsonb_build_object('mimetype', 'image/jpeg', 'size', 1)
    ),
    (
      'verification-evidence',
      selfie_path,
      jsonb_build_object('mimetype', 'image/jpeg', 'size', 1)
    );
end;
$$;

create function public.verification_acceptance_fail_record()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id_type = 'Acceptance Failure Fixture' then
    raise exception 'Acceptance failure fixture'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger verification_acceptance_fail_record
  before insert on public.verification_records
  for each row execute function public.verification_acceptance_fail_record();

set local role authenticated;

savepoint verification_record_success;
select set_config(
  'costtrack.test.record_id',
  public.costtrack_create_verification_record(
    null,
    current_setting('costtrack.test.test_auth_id')::uuid,
    current_setting('costtrack.test.test_email'),
    'Verification Acceptance Fixture',
    'Manager',
    current_setting('costtrack.test.invitation_id')::uuid,
    'Verification Acceptance Fixture',
    'Test ID',
    '****5678',
    jsonb_build_object(
      'full_name', 'Verification Acceptance Fixture',
      'dob', '1990-01-02',
      'address', 'Acceptance Test Address',
      'id_number', 'RAW-ID-MUST-NOT-BE-STORED-12345678',
      'ocr_passed', true
    ),
    97,
    'match',
    false,
    null,
    current_setting('costtrack.test.id_path'),
    current_setting('costtrack.test.selfie_path'),
    false,
    null,
    'Approved',
    null
  )::text,
  true
);

do $$
declare
  record_id uuid := current_setting('costtrack.test.record_id')::uuid;
  raw_id text := 'RAW-ID-MUST-NOT-BE-STORED-12345678';
  denied boolean;
begin
  if not exists (
    select 1
    from public.profiles as profile
    join public.verification_records as record
      on record.profile_id = profile.id
    where record.id = record_id
      and profile.email = current_setting('costtrack.test.test_email')
      and profile.account_status = 'Pending'
  ) then
    raise exception 'FAIL: profile and verification record were not created together.';
  end if;
  if exists (
    select 1
    from public.verification_records as record
    where record.id = record_id
      and (
        record.ocr_summary ? 'id_number'
        or record.ocr_summary::text like '%' || raw_id || '%'
        or record.id_number_masked <> '****5678'
      )
  ) then
    raise exception 'FAIL: raw ID number was stored or the masked value is incorrect.';
  end if;

  denied := false;
  begin
    insert into public.verification_records (
      applicant_name, id_type, face_match_result, verified_by, final_status
    ) values (
      'Unauthorized Direct Insert', 'Test ID', 'match',
      current_setting('costtrack.test.admin_id')::uuid, 'Rejected'
    );
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'FAIL: Administrator direct table insert was not denied.';
  end if;

  denied := false;
  begin
    update public.verification_records
    set applicant_name = 'Changed Applicant'
    where id = record_id;
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'FAIL: verification record update was not denied.';
  end if;

  denied := false;
  begin
    delete from public.verification_records where id = record_id;
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'FAIL: verification record delete was not denied.';
  end if;
end;
$$;

do $$
declare
  actor record;
  denied boolean;
  record_id uuid := current_setting('costtrack.test.record_id')::uuid;
begin
  for actor in
    select *
    from jsonb_to_recordset(current_setting('costtrack.test.role_profiles')::jsonb)
      as profile(id uuid, role text)
  loop
    perform set_config('request.jwt.claim.sub', actor.id::text, true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', actor.id, 'role', 'authenticated')::text,
      true
    );

    if exists (
      select 1 from public.verification_records where id = record_id
    ) then
      raise exception 'FAIL: % can read Administrator verification records.', actor.role;
    end if;
    if exists (
      select 1 from storage.objects
      where bucket_id = 'verification-evidence'
        and name = current_setting('costtrack.test.id_path')
    ) then
      raise exception 'FAIL: % can read private verification evidence.', actor.role;
    end if;

    denied := false;
    begin
      insert into public.verification_records (
        applicant_name, id_type, face_match_result, verified_by, final_status
      ) values (
        'Unauthorized Direct Insert', 'Test ID', 'match',
        current_setting('costtrack.test.admin_id')::uuid, 'Rejected'
      );
    exception when insufficient_privilege then
      denied := true;
    end;
    if not denied then
      raise exception 'FAIL: % direct table insert was not denied.', actor.role;
    end if;

    denied := false;
    begin
      perform public.costtrack_create_verification_record(
        null, null, null, null, null, null, null, null, null,
        '{}'::jsonb, null, null, false, null, null, null,
        false, null, null, null
      );
    exception when insufficient_privilege then
      denied := true;
    end;
    if not denied then
      raise exception 'FAIL: % could call the Administrator-only record RPC.', actor.role;
    end if;
  end loop;

  perform set_config(
    'request.jwt.claim.sub',
    current_setting('costtrack.test.admin_id'),
    true
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', current_setting('costtrack.test.admin_id')::uuid,
      'role', 'authenticated'
    )::text,
    true
  );
end;
$$;

rollback to savepoint verification_record_success;

do $$
declare
  denied boolean := false;
begin
  begin
    perform public.costtrack_create_verification_record(
      null,
      current_setting('costtrack.test.test_auth_id')::uuid,
      current_setting('costtrack.test.test_email'),
      'Verification Acceptance Fixture',
      'Manager',
      current_setting('costtrack.test.invitation_id')::uuid,
      'Verification Acceptance Fixture',
      'Acceptance Failure Fixture',
      '****5678',
      jsonb_build_object('ocr_passed', true),
      97,
      'match',
      false,
      null,
      current_setting('costtrack.test.id_path'),
      current_setting('costtrack.test.selfie_path'),
      false,
      null,
      'Approved',
      null
    );
  exception when check_violation then
    denied := true;
  end;
  if not denied then
    raise exception 'FAIL: the deliberate verification record failure did not occur.';
  end if;
  if exists (
    select 1 from public.profiles
    where id = current_setting('costtrack.test.test_auth_id')::uuid
  ) then
    raise exception 'FAIL: profile creation was not rolled back when record creation failed.';
  end if;
end;
$$;

reset role;
drop trigger verification_acceptance_fail_record
  on public.verification_records;
drop function public.verification_acceptance_fail_record();

rollback;
