begin;

drop index if exists public.pos_shifts_one_per_cashier_business_day_uidx;

drop policy if exists pos_shifts_phase3_read on public.pos_shifts;
create policy pos_shifts_phase3_read on public.pos_shifts
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

drop policy if exists pos_cash_movements_phase3_read on public.pos_cash_movements;
create policy pos_cash_movements_phase3_read on public.pos_cash_movements
  for select to authenticated
  using (exists (
    select 1
    from public.pos_shifts s
    where s.id = shift_id
      and public.has_app_role(array['Administrator', 'Manager', 'Receptionist'])
  ));

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['pos_shifts', 'pos_cash_movements'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.pos_open_shift(
  p_opening_cash numeric,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  shift_row public.pos_shifts%rowtype;
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Receptionist'])
    or auth.uid() is null then
    raise exception 'Your role cannot open a cashier shift.' using errcode = '42501';
  end if;
  if p_opening_cash is null or p_opening_cash < 0
    or p_opening_cash <> round(p_opening_cash, 2) then
    raise exception 'Starting cash must be a non-negative amount with at most two decimals.'
      using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 500 then
    raise exception 'Shift notes cannot exceed 500 characters.'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'pos-shift-open:' || (now() at time zone 'Asia/Manila')::date::text,
    0
  ));
  if exists (
    select 1
    from public.pos_shifts
    where status = 'Open'
  ) then
    raise exception 'The restaurant already has an open cashier shift.'
      using errcode = '23505';
  end if;
  if exists (
    select 1
    from public.pos_shifts
    where (opened_at at time zone 'Asia/Manila')::date =
      (now() at time zone 'Asia/Manila')::date
  ) then
    raise exception 'The restaurant can open only one cashier shift per Manila business day.'
      using errcode = '23505';
  end if;

  insert into public.pos_shifts (
    id, shift_code, opened_by, opening_float, status, notes
  ) values (
    gen_random_uuid()::text,
    'SHIFT-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || upper(substr(gen_random_uuid()::text, 1, 6)),
    auth.uid(), p_opening_cash, 'Open', nullif(trim(coalesce(p_notes, '')), '')
  )
  returning * into shift_row;

  return jsonb_build_object('shift', to_jsonb(shift_row));
end;
$$;

create or replace function public.pos_close_shift(
  p_shift_id text,
  p_counted_cash numeric,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  shift_row public.pos_shifts%rowtype;
  expected_value numeric(12,2);
  variance_value numeric(12,2);
  open_bill record;
  alert_role text;
  summary jsonb;
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Receptionist'])
    or auth.uid() is null then
    raise exception 'Your role cannot close cashier shifts.' using errcode = '42501';
  end if;
  if p_counted_cash is null or p_counted_cash < 0
    or p_counted_cash <> round(p_counted_cash, 2) then
    raise exception 'Counted cash must be non-negative with at most two decimals.'
      using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 500 then
    raise exception 'Shift notes cannot exceed 500 characters.' using errcode = '22023';
  end if;

  select * into shift_row from public.pos_shifts where id = p_shift_id for update;
  if not found then
    raise exception 'Shift not found.' using errcode = 'P0002';
  end if;
  if shift_row.status <> 'Open' then
    return jsonb_build_object('shift', to_jsonb(shift_row), 'already_closed', true);
  end if;
  for open_bill in
    select b.id, b.bill_number
    from public.pos_bills b
    where b.status = 'Open'
      and (b.shift_id = shift_row.id
        or (b.shift_id is null
          and (b.created_at at time zone 'Asia/Manila')::date =
            (shift_row.opened_at at time zone 'Asia/Manila')::date))
  loop
    foreach alert_role in array array['Manager', 'Administrator']
    loop
      insert into public.pos_notifications (
        notification_type, source_type, source_id, target_role, title, message
      ) values (
        'open_bill_shift_close', 'bill', open_bill.id, alert_role,
        'Bill remains open at shift close',
        format('%s remains open while shift %s was submitted for closing.', open_bill.bill_number, shift_row.shift_code)
      )
      on conflict (notification_type, source_id, target_role) do nothing;
    end loop;
  end loop;

  if exists (
    select 1
    from public.pos_bills b
    where b.status = 'Open'
      and (b.shift_id = shift_row.id
        or (b.shift_id is null
          and (b.created_at at time zone 'Asia/Manila')::date =
            (shift_row.opened_at at time zone 'Asia/Manila')::date))
  ) or exists (
    select 1
    from public.pos_bills b
    join public.pos_bill_approvals a on a.bill_id = b.id
    where a.status = 'Pending'
      and (b.shift_id = shift_row.id
        or (b.shift_id is null
          and (b.created_at at time zone 'Asia/Manila')::date =
            (shift_row.opened_at at time zone 'Asia/Manila')::date))
  ) then
    return jsonb_build_object(
      'shift', to_jsonb(shift_row),
      'blocked', true,
      'message', 'Resolve all open bills and pending approvals before closing this shift.',
      'summary', public.pos_shift_summary(shift_row.id)
    );
  end if;

  summary := public.pos_shift_summary(shift_row.id);
  expected_value := (summary->>'expected_cash')::numeric;
  variance_value := round(p_counted_cash - expected_value, 2);
  update public.pos_shifts
  set status = case when variance_value = 0 then 'Closed' else 'Needs review' end,
      closed_at = now(),
      closed_by = auth.uid(),
      declared_cash = p_counted_cash,
      expected_cash = expected_value,
      cash_variance = variance_value,
      cash_sales = coalesce((summary->>'cash_payments')::numeric, 0),
      notes = concat_ws(E'\n', nullif(notes, ''), nullif(trim(coalesce(p_notes, '')), ''))
  where id = shift_row.id
  returning * into shift_row;

  return jsonb_build_object(
    'shift', to_jsonb(shift_row),
    'blocked', false,
    'expected_cash', expected_value,
    'counted_cash', p_counted_cash,
    'cash_variance', variance_value,
    'shortage', variance_value < 0,
    'overage', variance_value > 0
  );
end;
$$;

-- Existing cashier RPCs select by opener; retarget them to the shared open shift.
do $$
declare
  function_signature text;
  function_oid regprocedure;
  function_definition text;
  updated_definition text;
  function_signatures text[] := array[
    'public.pos_record_reservation_deposit(text,numeric,text,text)',
    'public.pos_reservation_deposit_decision(text,text,text)',
    'public.pos_save_bill_phase3(text,text,text,text,integer,integer,integer,integer,text,text,jsonb,text,text,boolean)',
    'public.pos_close_bill_phase3(text,numeric,text)',
    'public.pos_decide_bill_approval_phase3(text,text,text)',
    'public.pos_seat_and_open_walkin(text,text,text,date,text,text,integer,integer,integer,text,text)',
    'public.pos_resolve_stale_booking(text,text,text,boolean,text,text,text)'
  ];
begin
  foreach function_signature in array function_signatures loop
    function_oid := to_regprocedure(function_signature);
    if function_oid is null then
      raise exception 'Required cashier function is missing: %', function_signature;
    end if;
    function_definition := pg_get_functiondef(function_oid);
    updated_definition := regexp_replace(
      function_definition,
      'where[[:space:]]+([a-z_][a-z0-9_]*\.)?opened_by[[:space:]]*=[[:space:]]*auth\.uid\(\)[[:space:]]+and[[:space:]]+([a-z_][a-z0-9_]*\.)?status[[:space:]]*=[[:space:]]*''Open''',
      'where status = ''Open'' order by opened_at desc limit 1',
      'gi'
    );
    if updated_definition = function_definition then
      raise exception 'Could not update shared-shift lookup in %', function_signature;
    end if;
    execute updated_definition;
  end loop;

  function_oid := to_regprocedure('public.pos_record_cash_movement(text,text,numeric,text,text)');
  if function_oid is null then
    raise exception 'Required cashier function is missing: pos_record_cash_movement.';
  end if;
  function_definition := pg_get_functiondef(function_oid);
  updated_definition := regexp_replace(
    function_definition,
    '[[:space:]]*if shift_row\.opened_by <> auth\.uid\(\) then[[:space:]]*raise exception ''You can record cash movements only on your own shift\.''[[:space:]]*using errcode = ''42501'';[[:space:]]*end if;',
    '',
    'g'
  );
  if updated_definition = function_definition then
    raise exception 'Could not remove per-user cash movement restriction.';
  end if;
  execute updated_definition;

  function_oid := to_regprocedure('public.pos_shift_summary(text)');
  if function_oid is null then
    raise exception 'Required cashier function is missing: pos_shift_summary.';
  end if;
  function_definition := pg_get_functiondef(function_oid);
  updated_definition := regexp_replace(
    function_definition,
    '[[:space:]]*if public\.current_app_role\(\) = ''Receptionist'' and shift_row\.opened_by <> auth\.uid\(\) then[[:space:]]*raise exception ''Receptionists can view only their own shifts\.''[[:space:]]*using errcode = ''42501'';[[:space:]]*end if;',
    '',
    'g'
  );
  if updated_definition = function_definition then
    raise exception 'Could not remove Receptionist-only shift summary restriction.';
  end if;
  function_definition := updated_definition;
  updated_definition := replace(
    function_definition,
    'b.created_by = shift_row.opened_by',
    '((b.created_at at time zone ''Asia/Manila'')::date = (shift_row.opened_at at time zone ''Asia/Manila'')::date)'
  );
  if updated_definition = function_definition then
    raise exception 'Could not update legacy-bill shift summary.';
  end if;
  execute updated_definition;
end;
$$;

commit;
