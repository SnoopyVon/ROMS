-- Run as the database owner after migrations 042 and 043.
-- Requires active Receptionist, Manager, and Administrator profiles without
-- open shifts or open bills. All fixture shifts are rolled back.
begin;

do $$
declare
  receptionist_id uuid;
  manager_id uuid;
  administrator_id uuid;
  manager_shift_id text := 'SHIFT-042-' || gen_random_uuid()::text;
  receptionist_shift_id text := 'SHIFT-042-' || gen_random_uuid()::text;
  administrator_shift_id text := 'SHIFT-042-' || gen_random_uuid()::text;
  own_shift_id text := 'SHIFT-042-' || gen_random_uuid()::text;
  result jsonb;
  access_denied boolean;
  note_required boolean;
begin
  if exists (
    select 1 from public.pos_shifts where status = 'Open'
  ) then
    raise exception 'Acceptance prerequisite: close the existing shared cashier shift first.';
  end if;

  select p.id into receptionist_id
  from public.profiles p
  where p.role = 'Receptionist'
    and p.account_status = 'Active'
    and not exists (
      select 1 from public.pos_shifts s
      where s.opened_by = p.id and s.status = 'Open'
    )
    and not exists (
      select 1 from public.pos_bills b
      where b.created_by = p.id and b.status = 'Open'
    )
  order by p.id
  limit 1;

  select p.id into manager_id
  from public.profiles p
  where p.role = 'Manager'
    and p.account_status = 'Active'
    and not exists (
      select 1 from public.pos_shifts s
      where s.opened_by = p.id and s.status = 'Open'
    )
    and not exists (
      select 1 from public.pos_bills b
      where b.created_by = p.id and b.status = 'Open'
    )
  order by p.id
  limit 1;

  select p.id into administrator_id
  from public.profiles p
  where p.role = 'Administrator'
    and p.account_status = 'Active'
    and not exists (
      select 1 from public.pos_shifts s
      where s.opened_by = p.id and s.status = 'Open'
    )
    and not exists (
      select 1 from public.pos_bills b
      where b.created_by = p.id and b.status = 'Open'
    )
  order by p.id
  limit 1;

  if receptionist_id is null or manager_id is null or administrator_id is null then
    raise exception 'Acceptance prerequisites: one active Receptionist, Manager, and Administrator without open shifts or open bills.';
  end if;

  insert into public.pos_shifts (id, shift_code, opened_by, opened_at, opening_float, status)
  values (
    manager_shift_id, manager_shift_id, manager_id,
    now() - interval '1 day', 0, 'Open'
  );
  if (select (opened_at at time zone 'Asia/Manila')::date
      from public.pos_shifts where id = manager_shift_id)
      >= (now() at time zone 'Asia/Manila')::date then
    raise exception 'FAIL: shift fixture was not opened on a prior Manila business day.';
  end if;

  perform set_config('request.jwt.claim.sub', receptionist_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', receptionist_id, 'role', 'authenticated')::text,
    true
  );
  access_denied := false;
  begin
    perform public.pos_close_shift(manager_shift_id, 0, '');
  exception
    when insufficient_privilege then access_denied := true;
  end;
  if not access_denied then
    raise exception 'FAIL: Receptionist closed a shift opened by someone else.';
  end if;

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', manager_id, 'role', 'authenticated')::text,
    true
  );
  result := public.pos_close_shift(manager_shift_id, 0, '');
  if result #>> '{shift,status}' is distinct from 'Closed'
    or result #>> '{shift,closed_by}' is distinct from manager_id::text then
    raise exception 'FAIL: Manager could not close their own overnight shift.';
  end if;

  insert into public.pos_shifts (id, shift_code, opened_by, opened_at, opening_float, status)
  values (
    receptionist_shift_id, receptionist_shift_id, receptionist_id,
    now() - interval '1 day', 0, 'Open'
  );
  note_required := false;
  begin
    perform public.pos_close_shift(receptionist_shift_id, 0, '');
  exception
    when invalid_parameter_value then note_required := true;
  end;
  if not note_required then
    raise exception 'FAIL: Manager closed another cashier''s shift without a reason.';
  end if;
  result := public.pos_close_shift(
    receptionist_shift_id, 0, 'Acceptance: manager closing on cashier''s behalf'
  );
  if result #>> '{shift,status}' is distinct from 'Closed'
    or result #>> '{shift,closed_by}' is distinct from manager_id::text then
    raise exception 'FAIL: Manager could not close another cashier''s overnight shift with a reason.';
  end if;

  insert into public.pos_shifts (id, shift_code, opened_by, opened_at, opening_float, status)
  values (
    administrator_shift_id, administrator_shift_id, receptionist_id,
    now() - interval '1 day', 0, 'Open'
  );
  perform set_config('request.jwt.claim.sub', administrator_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', administrator_id, 'role', 'authenticated')::text,
    true
  );
  note_required := false;
  begin
    perform public.pos_close_shift(administrator_shift_id, 0, '');
  exception
    when invalid_parameter_value then note_required := true;
  end;
  if not note_required then
    raise exception 'FAIL: Administrator closed another cashier''s shift without a reason.';
  end if;
  result := public.pos_close_shift(
    administrator_shift_id, 0, 'Acceptance: administrator closing on cashier''s behalf'
  );
  if result #>> '{shift,status}' is distinct from 'Closed'
    or result #>> '{shift,closed_by}' is distinct from administrator_id::text then
    raise exception 'FAIL: Administrator could not close another cashier''s overnight shift with a reason.';
  end if;

  insert into public.pos_shifts (id, shift_code, opened_by, opened_at, opening_float, status)
  values (
    own_shift_id, own_shift_id, receptionist_id,
    now() - interval '1 day', 0, 'Open'
  );
  perform set_config('request.jwt.claim.sub', receptionist_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', receptionist_id, 'role', 'authenticated')::text,
    true
  );
  result := public.pos_close_shift(own_shift_id, 0, 'Acceptance: overnight reconciliation');
  if result #>> '{shift,status}' is distinct from 'Closed'
    or result #>> '{shift,closed_by}' is distinct from receptionist_id::text then
    raise exception 'FAIL: Receptionist could not close their own overnight shift.';
  end if;
end;
$$;

rollback;
