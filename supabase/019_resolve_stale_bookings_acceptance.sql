-- Acceptance checks for Phase D1 stale-booking resolution.
-- Run as the database owner after migrations 013 through 019 and 044.
-- Test data and cash movements are rolled back; the Manila business-day rule stays enabled.

begin;

do $$
declare
  manager_id uuid;
  no_shift_manager_id uuid;
  receptionist_id uuid;
  inventory_clerk_id uuid;
  chef_id uuid;
  manager_shift_id text;
  shift_result jsonb;
  result jsonb;
  business_date_value date := public.pos_business_date();
  seated_id text := 'D1-SEATED-' || gen_random_uuid()::text;
  refund_id text := 'D1-REFUND-' || gen_random_uuid()::text;
  forfeit_id text := 'D1-FORFEIT-' || gen_random_uuid()::text;
  open_bill_id text := 'D1-OPEN-' || gen_random_uuid()::text;
  no_show_id text := 'D1-NOSHOW-' || gen_random_uuid()::text;
  cancel_id text := 'D1-CANCEL-' || gen_random_uuid()::text;
  same_day_id text := 'D1-TODAY-' || gen_random_uuid()::text;
  completed_id text := 'D1-COMPLETED-' || gen_random_uuid()::text;
  completed_bill_id text := 'D1-COMPLETED-BILL-' || gen_random_uuid()::text;
  cancelled_id text := 'D1-CANCELLED-' || gen_random_uuid()::text;
  role_denial_id text := 'D1-ROLE-' || gen_random_uuid()::text;
  seated_table_id text := 'D1-T-SEATED-' || substr(gen_random_uuid()::text, 1, 12);
  refund_table_id text := 'D1-T-REFUND-' || substr(gen_random_uuid()::text, 1, 12);
  forfeit_table_id text := 'D1-T-FORFEIT-' || substr(gen_random_uuid()::text, 1, 12);
  open_bill_table_id text := 'D1-T-OPEN-' || substr(gen_random_uuid()::text, 1, 12);
  no_show_table_id text := 'D1-T-NOSHOW-' || substr(gen_random_uuid()::text, 1, 12);
  cancel_table_id text := 'D1-T-CANCEL-' || substr(gen_random_uuid()::text, 1, 12);
  role_table_id text := 'D1-T-ROLE-' || substr(gen_random_uuid()::text, 1, 12);
  resolution_reason text := 'No meal was served; manager verified the prior-day booking record.';
  deposit_reason text := 'Return the held cash deposit as requested by the customer.';
  forfeit_reason text := 'Deposit forfeited under the documented cancellation agreement.';
  idempotency_key_value text := gen_random_uuid()::text;
  missing_deposit_action_blocked boolean := false;
  no_shift_refund_blocked boolean := false;
  open_bill_blocked boolean := false;
  no_show_blocked_without_action boolean := false;
  same_day_blocked boolean := false;
  completed_blocked boolean := false;
  cancelled_blocked boolean := false;
  receptionist_rpc_blocked boolean := false;
  clerk_rpc_blocked boolean := false;
  chef_rpc_blocked boolean := false;
  clerk_list_blocked boolean := false;
  chef_list_blocked boolean := false;
  short_reason_blocked boolean := false;
  long_reason_blocked boolean := false;
  revenue_before bigint;
  revenue_after bigint;
  revenue_table_exists boolean;
  reservation_status text;
  table_status text;
  deposit_status text;
  bill_status text;
  bill_balance numeric(12,2);
  cash_refund_count integer;
  resolution_count integer;
  action_count integer;
  audit_count_before integer;
  payment_count integer;
  bill_count integer;
begin
  if to_regprocedure(
      'public.pos_resolve_stale_booking(text,text,text,boolean,text,text,text)'
    ) is null
    or not has_function_privilege(
      'authenticated',
      'public.pos_resolve_stale_booking(text,text,text,boolean,text,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.pos_resolve_stale_booking(text,text,text,boolean,text,text,text)',
      'EXECUTE'
    ) then
    raise exception 'FAIL: stale-booking RPC is missing or its grants are not authenticated-only.';
  end if;
  if has_function_privilege(
      'authenticated', 'public.pos_resolve_stale_walkin(text,text)', 'EXECUTE'
    ) then
    raise exception 'FAIL: the legacy Walk-in resolver is still executable.';
  end if;

  select p.id into manager_id
  from public.profiles p
  where p.role in ('Manager', 'Administrator')
  order by case when p.role = 'Manager' then 0 else 1 end, p.id
  limit 1;
  select p.id into no_shift_manager_id
  from public.profiles p
  where p.role in ('Manager', 'Administrator')
    and not exists (
      select 1 from public.pos_shifts s
      where s.opened_by = p.id and s.status = 'Open'
    )
  order by case when p.id = manager_id then 0 else 1 end, p.id
  limit 1;
  select p.id into receptionist_id
  from public.profiles p where p.role = 'Receptionist' order by p.id limit 1;
  select p.id into inventory_clerk_id
  from public.profiles p where p.role = 'Inventory Clerk' order by p.id limit 1;
  select p.id into chef_id
  from public.profiles p where p.role = 'Chef / Kitchen Staff' order by p.id limit 1;
  if manager_id is null or no_shift_manager_id is null
     or receptionist_id is null or inventory_clerk_id is null or chef_id is null then
    raise exception 'Prerequisite: Manager/Admin, Manager/Admin without an open shift, Receptionist, Inventory Clerk, and Chef / Kitchen Staff profiles are required.';
  end if;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', manager_id::text, true);

  insert into public.restaurant_tables (id, seats, status, x, y, guest)
  values
    (seated_table_id, 4, 'Available', 0, 0, ''),
    (refund_table_id, 4, 'Available', 1, 0, ''),
    (forfeit_table_id, 4, 'Available', 2, 0, ''),
    (open_bill_table_id, 4, 'Available', 3, 0, ''),
    (no_show_table_id, 4, 'Available', 4, 0, ''),
    (cancel_table_id, 4, 'Available', 5, 0, ''),
    (role_table_id, 4, 'Available', 6, 0, '');

  insert into public.reservations (
    id, name, phone, reservation_date, reservation_time, guests, type,
    adults, senior_pwd_count, children, status, seated_at, actual_covers,
    table_id, source, created_by
  ) values
    (seated_id, 'D1 no-charge reservation', '09170000001',
     business_date_value + 1, '1:00 PM', 4, 'Reservation', 4, 0, 0,
     'Pending', null, null, seated_table_id, 'Phone', manager_id),
    (refund_id, 'D1 refund Walk-in', null,
     business_date_value + 1, '1:30 PM', 2, 'Walk-in', 2, 0, 0,
     'Pending', null, null, refund_table_id, 'Walk-in', manager_id),
    (forfeit_id, 'D1 forfeit Walk-in', null,
     business_date_value + 1, '2:00 PM', 2, 'Walk-in', 2, 0, 0,
     'Pending', null, null, forfeit_table_id, 'Walk-in', manager_id),
    (open_bill_id, 'D1 open bill reservation', '09170000002',
     business_date_value + 1, '2:30 PM', 2, 'Reservation', 2, 0, 0,
     'Pending', null, null, open_bill_table_id, 'Phone', manager_id),
    (no_show_id, 'D1 no-show reservation', '09170000003',
     business_date_value + 1, '3:00 PM', 2, 'Reservation', 2, 0, 0,
     'Pending', null, null, no_show_table_id, 'Phone', manager_id),
    (cancel_id, 'D1 cancel reservation', '09170000004',
     business_date_value + 1, '3:30 PM', 2, 'Reservation', 2, 0, 0,
     'Pending', null, null, cancel_table_id, 'Phone', manager_id),
    (role_denial_id, 'D1 role-denial reservation', '09170000005',
     business_date_value + 1, '4:00 PM', 2, 'Reservation', 2, 0, 0,
     'Pending', null, null, role_table_id, 'Phone', manager_id),
    (completed_id, 'D1 already completed reservation', '09170000006',
     business_date_value + 1, '4:30 PM', 2, 'Reservation', 2, 0, 0,
     'Pending', null, null, null, 'Phone', manager_id),
    (cancelled_id, 'D1 already cancelled reservation', '09170000007',
     business_date_value + 1, '5:00 PM', 2, 'Reservation', 2, 0, 0,
     'Pending', null, null, null, 'Phone', manager_id),
    (same_day_id, 'D1 same-day Walk-in', null,
     business_date_value, '12:00 PM', 2, 'Walk-in', 2, 0, 0,
     'Pending', null, null, null, 'Walk-in', manager_id);

  -- Follow valid lifecycle transitions instead of inserting terminal statuses.
  update public.reservations
  set status = 'Confirmed'
  where id in (
    seated_id, refund_id, forfeit_id, open_bill_id, cancel_id, role_denial_id,
    completed_id, cancelled_id, same_day_id
  );
  update public.reservations
  set status = 'Seated',
      seated_at = clock_timestamp(),
      actual_covers = guests
  where id in (
    seated_id, refund_id, forfeit_id, open_bill_id, role_denial_id,
    completed_id, same_day_id
  );
  update public.reservations
  set status = 'Cancelled'
  where id = cancelled_id;

  -- The completed-status fixture must satisfy the settled-bill guard.
  insert into public.pos_bills (
    id, bill_number, reservation_id, customer_name, status, balance_due,
    created_by, closed_at, closed_by
  ) values (
    completed_bill_id, completed_bill_id, completed_id,
    'D1 already completed reservation', 'Closed', 0,
    manager_id, clock_timestamp(), manager_id
  );
  update public.reservations
  set status = 'Completed'
  where id = completed_id;

  perform set_config('request.jwt.claim.sub', '', true);
  update public.reservations
  set reservation_date = business_date_value - 1
  where id in (
    seated_id, refund_id, forfeit_id, open_bill_id, no_show_id, cancel_id,
    role_denial_id, completed_id, cancelled_id
  );
  perform set_config('request.jwt.claim.sub', manager_id::text, true);

  insert into public.pos_reservation_deposits (
    id, reservation_id, amount, payment_method, status, created_by
  ) values
    (gen_random_uuid()::text, refund_id, 300, 'cash', 'Held', manager_id),
    (gen_random_uuid()::text, forfeit_id, 300, 'cash', 'Held', manager_id),
    (gen_random_uuid()::text, no_show_id, 300, 'cash', 'Held', manager_id);

  insert into public.pos_bills (
    bill_number, reservation_id, customer_name, status, balance_due, created_by
  ) values (
    'D1-' || gen_random_uuid()::text, open_bill_id,
    'D1 open bill reservation', 'Open', 400, manager_id
  );

  perform set_config('request.jwt.claim.sub', receptionist_id::text, true);
  if not exists (
    select 1
    from public.pos_list_unresolved_stale_bookings() as listed
    where listed.reservation_id = seated_id
  ) or not exists (
    select 1
    from public.pos_list_unresolved_stale_bookings() as listed
    where listed.reservation_id = open_bill_id
      and listed.resolution_label = 'Payable'
      and listed.bill_status ilike '%Open%'
  ) then
    raise exception 'FAIL: Receptionist could not see unresolved and Payable list rows.';
  end if;
  perform set_config('request.jwt.claim.sub', inventory_clerk_id::text, true);
  begin
    perform * from public.pos_list_unresolved_stale_bookings();
    raise exception 'FAIL: Inventory Clerk read the unresolved list.';
  exception when insufficient_privilege then
    clerk_list_blocked := true;
  end;
  perform set_config('request.jwt.claim.sub', chef_id::text, true);
  begin
    perform * from public.pos_list_unresolved_stale_bookings();
    raise exception 'FAIL: Chef read the unresolved list.';
  exception when insufficient_privilege then
    chef_list_blocked := true;
  end;
  if not clerk_list_blocked or not chef_list_blocked then
    raise exception 'FAIL: unresolved list role restrictions did not hold.';
  end if;

  perform set_config('request.jwt.claim.sub', manager_id::text, true);

  revenue_table_exists := to_regclass('public.revenue_records') is not null;
  if revenue_table_exists then
    execute 'select count(*) from public.revenue_records' into revenue_before;
  end if;

  begin
    perform public.pos_resolve_stale_booking(
      refund_id, 'close_without_charge', resolution_reason, true,
      null, null, gen_random_uuid()::text
    );
    raise exception 'FAIL: a held deposit was resolved without an action.';
  exception when sqlstate '55000' then
    missing_deposit_action_blocked := true;
  end;
  if not missing_deposit_action_blocked then
    raise exception 'FAIL: missing deposit action was not rejected.';
  end if;

  perform set_config('request.jwt.claim.sub', no_shift_manager_id::text, true);
  begin
    perform public.pos_resolve_stale_booking(
      refund_id, 'close_without_charge', resolution_reason, true,
      'refund', deposit_reason, gen_random_uuid()::text
    );
    raise exception 'FAIL: a cash deposit was refunded without the actor’s open shift.';
  exception when sqlstate '55000' then
    no_shift_refund_blocked := true;
  end;
  if not no_shift_refund_blocked then
    raise exception 'FAIL: refund without an open Manager shift was not rejected.';
  end if;
  perform set_config('request.jwt.claim.sub', manager_id::text, true);

  select s.id into manager_shift_id
  from public.pos_shifts s
  where s.opened_by = manager_id and s.status = 'Open'
  limit 1;
  if manager_shift_id is null then
    shift_result := public.pos_open_shift(0, 'Phase D1 stale-booking acceptance');
    manager_shift_id := shift_result->'shift'->>'id';
  end if;
  if manager_shift_id is null then
    raise exception 'FAIL: could not establish the Manager’s own open shift.';
  end if;

  begin
    perform public.pos_resolve_stale_booking(
      seated_id, 'close_without_charge', 'short', true,
      null, null, gen_random_uuid()::text
    );
    raise exception 'FAIL: a short resolution reason was accepted.';
  exception when sqlstate '22023' then
    short_reason_blocked := true;
  end;
  begin
    perform public.pos_resolve_stale_booking(
      seated_id, 'close_without_charge', repeat('x', 501), true,
      null, null, gen_random_uuid()::text
    );
    raise exception 'FAIL: an overlong resolution reason was accepted.';
  exception when sqlstate '22023' then
    long_reason_blocked := true;
  end;
  if not short_reason_blocked or not long_reason_blocked then
    raise exception 'FAIL: resolution reason bounds were not enforced.';
  end if;

  select count(*) into audit_count_before
  from public.audit_logs a
  where a.actor_id = manager_id
    and a.table_name = 'reservations'
    and a.record_id = seated_id
    and a.action = 'UPDATE';
  result := public.pos_resolve_stale_booking(
    seated_id, 'close_without_charge', resolution_reason, true,
    null, null, idempotency_key_value
  );
  if result->>'status' <> 'Completed'
     or result->>'already_resolved' <> 'false' then
    raise exception 'FAIL: no-charge resolution did not complete the past seated reservation.';
  end if;
  select r.status into reservation_status
  from public.reservations r where r.id = seated_id;
  select t.status into table_status
  from public.restaurant_tables t where t.id = seated_table_id;
  select count(*) into resolution_count
  from public.pos_stale_booking_resolutions x where x.reservation_id = seated_id;
  select count(*) into bill_count
  from public.pos_bills b where b.reservation_id = seated_id;
  select count(*) into payment_count
  from public.pos_bill_payments p
  join public.pos_bills b on b.id = p.bill_id
  where b.reservation_id = seated_id;
  select count(*) into action_count
  from public.audit_logs a
  where a.actor_id = manager_id
    and a.table_name = 'reservations'
    and a.record_id = seated_id
    and a.action = 'UPDATE';
  if revenue_table_exists then
    execute 'select count(*) from public.revenue_records' into revenue_after;
  end if;
  if reservation_status <> 'Completed'
     or table_status <> 'Needs cleaning'
     or resolution_count <> 1
     or action_count <> audit_count_before + 1
     or bill_count <> 0
     or payment_count <> 0
     or (revenue_table_exists and revenue_after <> revenue_before) then
    raise exception 'FAIL: close without charge changed an unexpected financial or table record.';
  end if;

  result := public.pos_resolve_stale_booking(
    seated_id, 'close_without_charge', resolution_reason, true,
    null, null, idempotency_key_value
  );
  select count(*) into resolution_count
  from public.pos_stale_booking_resolutions x where x.reservation_id = seated_id;
  if result->>'already_resolved' <> 'true' or resolution_count <> 1 then
    raise exception 'FAIL: retry created a second stale-booking resolution.';
  end if;

  result := public.pos_resolve_stale_booking(
    refund_id, 'close_without_charge', resolution_reason, true,
    'refund', deposit_reason, gen_random_uuid()::text
  );
  select d.status into deposit_status
  from public.pos_reservation_deposits d where d.reservation_id = refund_id;
  select count(*) into cash_refund_count
  from public.pos_cash_movements m
  join public.pos_stale_booking_resolutions x
    on m.id = any(x.cash_movement_ids)
  join public.pos_shifts s on s.id = m.shift_id
  where x.reservation_id = refund_id
    and m.movement_type = 'cash_refund'
    and m.amount = 300
    and s.opened_by = manager_id
    and s.status = 'Open';
  if result->>'status' <> 'Completed'
     or deposit_status <> 'Refunded'
     or cash_refund_count <> 1 then
    raise exception 'FAIL: Refund did not settle the 300 deposit with exactly one cash-out.';
  end if;
  result := public.pos_resolve_stale_booking(
    refund_id, 'close_without_charge', resolution_reason, true,
    'refund', deposit_reason, result->'resolution'->>'idempotency_key'
  );
  select count(*) into cash_refund_count
  from public.pos_cash_movements m
  join public.pos_stale_booking_resolutions x
    on m.id = any(x.cash_movement_ids)
  where x.reservation_id = refund_id and m.movement_type = 'cash_refund';
  if result->>'already_resolved' <> 'true' or cash_refund_count <> 1 then
    raise exception 'FAIL: Refund retry created a duplicate cash-out.';
  end if;

  result := public.pos_resolve_stale_booking(
    forfeit_id, 'close_without_charge', resolution_reason, true,
    'forfeit', forfeit_reason, gen_random_uuid()::text
  );
  select d.status into deposit_status
  from public.pos_reservation_deposits d where d.reservation_id = forfeit_id;
  select count(*) into cash_refund_count
  from public.pos_cash_movements m
  join public.pos_stale_booking_resolutions x
    on m.id = any(x.cash_movement_ids)
  where x.reservation_id = forfeit_id;
  select count(*) into action_count
  from public.pos_deposit_actions a
  join public.pos_reservation_deposits d on d.id = a.deposit_id
  where d.reservation_id = forfeit_id
    and a.action_type = 'forfeited'
    and a.reason = forfeit_reason;
  if deposit_status <> 'Forfeited'
     or cash_refund_count <> 0
     or action_count <> 1 then
    raise exception 'FAIL: Forfeit did not preserve its reason without recording a cash-out.';
  end if;

  begin
    perform public.pos_resolve_stale_booking(
      open_bill_id, 'close_without_charge', resolution_reason, true,
      null, null, gen_random_uuid()::text
    );
    raise exception 'FAIL: stale Seated booking with an Open bill was resolved.';
  exception when sqlstate '55000' then
    open_bill_blocked := true;
  end;
  select r.status into reservation_status from public.reservations r where r.id = open_bill_id;
  select b.status, b.balance_due into bill_status, bill_balance
  from public.pos_bills b where b.reservation_id = open_bill_id;
  if not open_bill_blocked
     or reservation_status <> 'Seated'
     or bill_status <> 'Open'
     or bill_balance <> 400 then
    raise exception 'FAIL: Open bill blocker changed the reservation.';
  end if;

  begin
    perform public.pos_resolve_stale_booking(
      no_show_id, 'no_show', 'Guest did not arrive for the reservation.',
      false, null, null, gen_random_uuid()::text
    );
    raise exception 'FAIL: a held deposit was ignored for No-show.';
  exception when sqlstate '55000' then
    no_show_blocked_without_action := true;
  end;
  if not no_show_blocked_without_action then
    raise exception 'FAIL: No-show did not require a held-deposit action.';
  end if;
  result := public.pos_resolve_stale_booking(
    no_show_id, 'no_show', 'Guest did not arrive for the reservation.',
    false, 'forfeit', forfeit_reason, gen_random_uuid()::text
  );
  select r.status into reservation_status from public.reservations r where r.id = no_show_id;
  select t.status into table_status from public.restaurant_tables t where t.id = no_show_table_id;
  select d.status into deposit_status
  from public.pos_reservation_deposits d where d.reservation_id = no_show_id;
  if result->>'status' <> 'No-show'
     or reservation_status <> 'No-show'
     or table_status <> 'Available'
     or deposit_status <> 'Forfeited' then
    raise exception 'FAIL: No-show did not settle the deposit and free the table.';
  end if;

  update public.restaurant_tables
  set status = 'Needs cleaning'
  where id = cancel_table_id;
  result := public.pos_resolve_stale_booking(
    cancel_id, 'cancel', 'Manager confirmed the past booking was cancelled.',
    false, null, null, gen_random_uuid()::text
  );
  select r.status into reservation_status from public.reservations r where r.id = cancel_id;
  select t.status into table_status from public.restaurant_tables t where t.id = cancel_table_id;
  if result->>'status' <> 'Cancelled'
     or reservation_status <> 'Cancelled'
     or result->>'table_status' <> 'Needs cleaning'
     or table_status <> 'Needs cleaning' then
    raise exception 'FAIL: Cancelled booking did not resolve while preserving the table cleaning state.';
  end if;

  begin
    perform public.pos_resolve_stale_booking(
      same_day_id, 'close_without_charge', resolution_reason, true,
      null, null, gen_random_uuid()::text
    );
    raise exception 'FAIL: same-day booking was resolved.';
  exception when sqlstate '55000' then
    same_day_blocked := true;
  end;
  begin
    perform public.pos_resolve_stale_booking(
      completed_id, 'close_without_charge', resolution_reason, true,
      null, null, gen_random_uuid()::text
    );
    raise exception 'FAIL: already Completed booking was resolved again.';
  exception when sqlstate '55000' then
    completed_blocked := true;
  end;
  begin
    perform public.pos_resolve_stale_booking(
      cancelled_id, 'cancel', 'Do not resolve an already cancelled booking.',
      false, null, null, gen_random_uuid()::text
    );
    raise exception 'FAIL: already Cancelled booking was resolved again.';
  exception when sqlstate '55000' then
    cancelled_blocked := true;
  end;
  if not same_day_blocked or not completed_blocked or not cancelled_blocked then
    raise exception 'FAIL: same-day, Completed, or Cancelled status guard did not hold.';
  end if;
  select r.status into reservation_status
  from public.reservations r where r.id = same_day_id;
  if reservation_status <> 'Seated' then
    raise exception 'FAIL: rejected same-day resolution changed the reservation.';
  end if;

  perform set_config('request.jwt.claim.sub', receptionist_id::text, true);
  begin
    perform public.pos_resolve_stale_booking(
      role_denial_id, 'close_without_charge', resolution_reason, true,
      null, null, gen_random_uuid()::text
    );
    raise exception 'FAIL: Receptionist called the resolver directly.';
  exception when insufficient_privilege then
    receptionist_rpc_blocked := true;
  end;
  perform set_config('request.jwt.claim.sub', inventory_clerk_id::text, true);
  begin
    perform public.pos_resolve_stale_booking(
      role_denial_id, 'close_without_charge', resolution_reason, true,
      null, null, gen_random_uuid()::text
    );
    raise exception 'FAIL: Inventory Clerk called the resolver directly.';
  exception when insufficient_privilege then
    clerk_rpc_blocked := true;
  end;
  perform set_config('request.jwt.claim.sub', chef_id::text, true);
  begin
    perform public.pos_resolve_stale_booking(
      role_denial_id, 'close_without_charge', resolution_reason, true,
      null, null, gen_random_uuid()::text
    );
    raise exception 'FAIL: Chef called the resolver directly.';
  exception when insufficient_privilege then
    chef_rpc_blocked := true;
  end;
  if not receptionist_rpc_blocked or not clerk_rpc_blocked or not chef_rpc_blocked then
    raise exception 'FAIL: resolver role restrictions did not hold.';
  end if;
  select r.status into reservation_status
  from public.reservations r where r.id = role_denial_id;
  select count(*) into resolution_count
  from public.pos_stale_booking_resolutions x
  where x.reservation_id = role_denial_id;
  if reservation_status <> 'Seated' or resolution_count <> 0 then
    raise exception 'FAIL: a denied role changed or audited the reservation.';
  end if;

  raise notice 'PASS: D1 list access, no-charge completion, cleaning state, deposit refund/forfeit, bill guard, no-show/cancel, idempotency, date/status guards, and role restrictions passed.';
end;
$$;

rollback;
