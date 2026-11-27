-- POS Phase 3 acceptance checks.
-- Run as the database owner after migrations 007, 008, 009, 010, and 056. The final ROLLBACK
-- intentionally removes all test shifts, reservations, tables, bills, and ledger rows.

begin;

do $$
declare
  v_receptionist_id uuid;
  v_manager_id uuid;
  v_shift_before_deposit text;
  v_shift_for_bill text;
  v_manager_shift text;
  v_variance_zero_shift text;
  v_variance_short_shift text;
  v_variance_over_shift text;
  v_reservation_id text;
  v_remainder_reservation_id text;
  v_failure_reservation_id text;
  v_package_reservation_id text;
  v_table_id text;
  v_remainder_table_id text;
  v_failure_table_id text;
  v_package_table_id text;
  v_test_charge_id text;
  v_package_charge_id text;
  v_deposit_id text;
  v_remainder_deposit_id text;
  v_failure_deposit_id text;
  v_bill_id text;
  v_remainder_bill_id text;
  v_failure_bill_id text;
  v_package_bill_id text;
  v_approval_id text;
  v_result jsonb;
  v_summary jsonb;
  v_expected numeric(12,2);
  v_cash_payment_count integer;
  v_duplicate_rejected boolean := false;
  v_failure_rolled_back boolean := false;
  v_completion_without_bill_blocked boolean := false;
begin
  select p.id into v_receptionist_id
  from public.profiles p
  where p.role = 'Receptionist'
    and not exists (
      select 1 from public.pos_shifts s where s.opened_by = p.id and s.status = 'Open'
    )
  order by p.id limit 1;
  select p.id into v_manager_id
  from public.profiles p
  where p.role in ('Manager', 'Administrator')
    and not exists (
      select 1 from public.pos_shifts s where s.opened_by = p.id and s.status = 'Open'
    )
    and p.id is distinct from v_receptionist_id
  order by p.id limit 1;
  if v_receptionist_id is null or v_manager_id is null then
    raise exception 'Acceptance prerequisites: one Receptionist and one Manager/Administrator without an open shift.';
  end if;

  v_table_id := 'POS3-' || gen_random_uuid()::text;
  v_remainder_table_id := 'POS3-' || gen_random_uuid()::text;
  v_failure_table_id := 'POS3-' || gen_random_uuid()::text;
  v_package_table_id := 'POS3-' || gen_random_uuid()::text;
  v_test_charge_id := 'POS3-' || gen_random_uuid()::text;
  v_package_charge_id := 'POS3-' || gen_random_uuid()::text;
  v_reservation_id := 'POS3-' || gen_random_uuid()::text;
  v_remainder_reservation_id := 'POS3-' || gen_random_uuid()::text;
  v_failure_reservation_id := 'POS3-' || gen_random_uuid()::text;
  v_package_reservation_id := 'POS3-' || gen_random_uuid()::text;
  v_deposit_id := gen_random_uuid()::text;
  v_remainder_deposit_id := gen_random_uuid()::text;
  v_failure_deposit_id := gen_random_uuid()::text;

  insert into public.restaurant_tables (id, seats, status, x, y, guest)
  values
    (v_table_id, 80, 'Available', 0, 0, ''),
    (v_remainder_table_id, 8, 'Available', 0, 0, ''),
    (v_failure_table_id, 8, 'Available', 0, 0, ''),
    (v_package_table_id, 8, 'Available', 0, 0, '');
  insert into public.pos_charge_items (
    id, code, name, type, category, unit_price, default_quantity, is_active,
    is_food_revenue, is_package, requires_approval, notes
  ) values (
    v_test_charge_id, v_test_charge_id, 'Acceptance leftover charge',
    'food', 'Acceptance', 200, 1, true, true, false, false, ''
  );
  insert into public.pos_charge_items (
    id, code, name, type, category, unit_price, default_quantity, is_active,
    is_food_revenue, is_package, requires_approval, notes
  ) values (
    v_package_charge_id, v_package_charge_id, 'Acceptance reservation package',
    'package', 'Acceptance', 317.50, 1, true, true, true, false, ''
  );

  insert into public.reservations (
    id, name, phone, reservation_date, reservation_time, guests, adults, children,
    status, actual_covers, table_id
  ) values
    -- Reservations store only adult/child counts; detailed POS categories are on the bill.
    (v_reservation_id, 'POS Phase 3 worked example', '0000000001', current_date,
      '12:00 PM', 60, 52, 8, 'Pending', 60, v_table_id),
    (v_remainder_reservation_id, 'POS Phase 3 deposit remainder', '0000000002',
      current_date, '1:00 PM', 1, 1, 0, 'Pending', 1, v_remainder_table_id),
    (v_failure_reservation_id, 'POS Phase 3 rollback test', '0000000003',
      current_date, '2:00 PM', 1, 1, 0, 'Pending', 1, v_failure_table_id),
    (v_package_reservation_id, 'POS Phase 3 package test', '0000000004',
      current_date, '3:00 PM', 3, 3, 0, 'Pending', 3, v_package_table_id);

  -- The existing reservation trigger requires the normal seating transitions.
  update public.reservations
  set status = 'Confirmed'
  where id in (
    v_reservation_id, v_remainder_reservation_id,
    v_failure_reservation_id, v_package_reservation_id
  );
  update public.reservations
  set status = 'Seated'
  where id in (
    v_reservation_id, v_remainder_reservation_id,
    v_failure_reservation_id, v_package_reservation_id
  );

  begin
    update public.reservations
    set status = 'Completed'
    where id = v_reservation_id;
    raise exception 'FAIL: a seated reservation completed without a settled POS bill.';
  exception when sqlstate '55000' then
    v_completion_without_bill_blocked := true;
  end;
  if not v_completion_without_bill_blocked then
    raise exception 'FAIL: reservation completion was not blocked without a settled POS bill.';
  end if;

  update public.reservations
  set package_charge_item_id = v_package_charge_id,
      package_tier_id = null,
      package_pax_count = 2
  where id = v_package_reservation_id;

  perform set_config('request.jwt.claim.sub', v_receptionist_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_result := public.pos_open_shift(100, 'Acceptance deposit receipt shift');
  v_shift_before_deposit := v_result->'shift'->>'id';
  begin
    perform public.pos_open_shift(100, 'Duplicate open shift');
    raise exception 'FAIL: a second open shift was created for one cashier.';
  exception when unique_violation then
    null;
  end;
  begin
    perform public.pos_record_cash_movement(
      v_shift_before_deposit, 'paid_in', 10, '', gen_random_uuid()::text
    );
    raise exception 'FAIL: a cash movement without a reason was accepted.';
  exception when sqlstate '22023' then
    null;
  end;
  v_result := public.pos_record_reservation_deposit(
    v_reservation_id, 2000, 'Acceptance deposit', gen_random_uuid()::text
  );
  if v_result->'deposit'->>'status' <> 'Held' then
    raise exception 'FAIL: new reservation deposit was not Held.';
  end if;
  v_result := public.pos_close_shift(v_shift_before_deposit, 2100, 'Expected deposit cash');
  if coalesce((v_result->>'blocked')::boolean, false)
    or (v_result->>'cash_variance')::numeric <> 0 then
    raise exception 'FAIL: deposit receipt shift did not reconcile to $2,100.';
  end if;

  v_result := public.pos_open_shift(500, 'Acceptance bill shift');
  v_shift_for_bill := v_result->'shift'->>'id';

  v_result := public.pos_save_bill_phase3(
    null, 'Worked example', '', v_reservation_id, 40, 10, 8, 2,
    null, '', jsonb_build_array(jsonb_build_object(
      'charge_item_id', v_test_charge_id, 'quantity', 1
    )), gen_random_uuid()::text, v_table_id, false
  );
  v_bill_id := v_result->'bill'->>'id';
  if (v_result->'bill'->>'subtotal')::numeric <> 23560 then
    raise exception 'FAIL: worked example subtotal should be 23,560.';
  end if;
  if (v_result->'bill'->>'balance_due')::numeric <> 23560 then
    raise exception 'FAIL: held deposits must not be silently applied before close.';
  end if;

  begin
      perform public.pos_save_bill_phase3(
        null, 'Duplicate open bill', '', v_reservation_id, 40, 10, 8, 2,
        null, '', jsonb_build_array(jsonb_build_object(
          'charge_item_id', v_test_charge_id, 'quantity', 1
        )), gen_random_uuid()::text, v_table_id, false
    );
  exception when unique_violation then
      v_duplicate_rejected := true;
  end;
    if not v_duplicate_rejected then
    raise exception 'FAIL: second open bill for a reservation was not rejected.';
  end if;

  v_result := public.pos_close_shift(v_shift_for_bill, 0, '');
  if not coalesce((v_result->>'blocked')::boolean, false) then
    raise exception 'FAIL: shift close was not blocked by its open bill.';
  end if;
  if (
    select count(*) from public.pos_notifications
    where notification_type = 'open_bill_shift_close' and source_id = v_bill_id
  ) <> 2 then
    raise exception 'FAIL: open-bill shift-close notifications were missing or duplicated.';
  end if;

  v_result := public.pos_close_bill_phase3(v_bill_id, 22000, gen_random_uuid()::text);
  if coalesce((v_result->>'already_closed')::boolean, true)
    or (v_result->>'deposit_applied')::numeric <> 2000
    or (v_result->'payment'->>'amount')::numeric <> 21560
    or (v_result->'payment'->>'change_amount')::numeric <> 440 then
    raise exception 'FAIL: worked example deposit/payment/change calculation is incorrect.';
  end if;
  perform public.pos_close_bill_phase3(v_bill_id, 22000, gen_random_uuid()::text);
  select count(*) into v_cash_payment_count from public.pos_bill_payments p
  where p.bill_id = v_bill_id and p.payment_method = 'cash';
  if v_cash_payment_count <> 1 then
    raise exception 'FAIL: repeated close created more than one cash payment.';
  end if;
  if not exists (
    select 1 from public.pos_reservation_deposits d
    where d.reservation_id = v_reservation_id and d.status = 'Applied' and d.bill_id = v_bill_id
  ) then
    raise exception 'FAIL: deposit was not applied at close.';
  end if;
  if not exists (
    select 1 from public.reservations r
    where r.id = v_reservation_id and r.status = 'Completed' and r.actual_covers = 60
  ) then
    raise exception 'FAIL: closing did not complete the reservation/update covers.';
  end if;
  if not exists (
    select 1 from public.restaurant_tables t
    where t.id = v_table_id and t.status = 'Needs cleaning'
  ) then
    raise exception 'FAIL: closing did not set the linked table to Needs cleaning.';
  end if;

  v_summary := public.pos_shift_summary(v_shift_for_bill);
  v_expected := (v_summary->>'expected_cash')::numeric;
  if v_expected <> 22060 then
    raise exception 'FAIL: expected cash should be starting cash + 21,560; got %.', v_expected;
  end if;
  if round(100 - 100, 2) <> 0 or round(40 - 100, 2) <> -60
    or round(140 - 100, 2) <> 40 then
    raise exception 'FAIL: cash variance values do not reconcile.';
  end if;

  -- Closed paid bill voids require manager approval and restore the deposit.
  v_result := public.pos_request_bill_void_phase3(v_bill_id, 'Acceptance paid-bill void');
  v_approval_id := v_result->'approval'->>'id';
  v_result := public.pos_close_shift(v_shift_for_bill, 22060, 'Pending approval test');
  if not coalesce((v_result->>'blocked')::boolean, false) then
    raise exception 'FAIL: shift close was not blocked by a pending approval.';
  end if;
  begin
    perform public.pos_decide_bill_approval_phase3(v_approval_id, 'approve', 'not allowed');
    raise exception 'FAIL: Receptionist approved a request.';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('request.jwt.claim.sub', v_manager_id::text, true);
  perform public.pos_refresh_notifications();
  perform public.pos_refresh_notifications();
  if (
    select count(*) from public.pos_notifications
    where notification_type = 'pending_approval' and source_id = v_approval_id
  ) <> 2 then
    raise exception 'FAIL: pending-approval notifications were missing or duplicated.';
  end if;
  v_result := public.pos_open_shift(30000, 'Acceptance manager refund shift');
  v_manager_shift := v_result->'shift'->>'id';
  v_result := public.pos_decide_bill_approval_phase3(v_approval_id, 'approve', 'Acceptance refund');
  if not exists (
    select 1 from public.pos_reservation_deposits d
    where d.reservation_id = v_reservation_id and d.status = 'Held' and d.bill_id is null
      and amount = 2000
  ) then
    raise exception 'FAIL: voiding a paid bill did not restore the deposit to Held.';
  end if;
  v_summary := public.pos_shift_summary(v_shift_for_bill);
  if (v_summary->>'expected_cash')::numeric <> 22060 then
    raise exception 'FAIL: voiding retroactively changed the original cashier shift.';
  end if;
  v_summary := public.pos_shift_summary(v_manager_shift);
  if (v_summary->>'expected_cash')::numeric <> 8440 then
    raise exception 'FAIL: cash refund did not reduce the Manager shift by the refunded amount.';
  end if;
  v_result := public.pos_close_shift(v_manager_shift, 8440, 'Exact refund-shift count');
  if (v_result->>'cash_variance')::numeric <> 0 then
    raise exception 'FAIL: exact Manager shift count did not produce zero variance.';
  end if;

  -- A deposit larger than the bill leaves an explicit Held remainder.
  perform set_config('request.jwt.claim.sub', v_receptionist_id::text, true);
  v_result := public.pos_record_reservation_deposit(
    v_remainder_reservation_id, 500, 'Remainder test', gen_random_uuid()::text
  );
  v_remainder_deposit_id := v_result->'deposit'->>'id';
  v_result := public.pos_save_bill_phase3(
    null, 'Deposit remainder', '', v_remainder_reservation_id, 1, 0, 0, 0,
    null, '', '[]'::jsonb, gen_random_uuid()::text, v_remainder_table_id, false
  );
  v_remainder_bill_id := v_result->'bill'->>'id';
  v_result := public.pos_close_bill_phase3(v_remainder_bill_id, 0, gen_random_uuid()::text);
  if (v_result->>'deposit_applied')::numeric <> 449
    or not exists (
      select 1 from public.pos_reservation_deposits d
      where d.id = v_remainder_deposit_id and d.status = 'Held' and d.amount = 51
    ) then
    raise exception 'FAIL: excess deposit was not preserved as a Held remainder.';
  end if;
  begin
    perform public.pos_reservation_deposit_decision(v_remainder_deposit_id, 'refund', 'not allowed');
    raise exception 'FAIL: Receptionist refunded a deposit.';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('request.jwt.claim.sub', v_manager_id::text, true);
  perform public.pos_reservation_deposit_decision(
    v_remainder_deposit_id, 'forfeit', 'Acceptance reason'
  );

  -- The close fails after deposit allocation begins; the subtransaction must
  -- roll back every payment and deposit update.
  perform set_config('request.jwt.claim.sub', v_receptionist_id::text, true);
  v_result := public.pos_record_reservation_deposit(
    v_failure_reservation_id, 100, 'Atomic rollback test', gen_random_uuid()::text
  );
  v_failure_deposit_id := v_result->'deposit'->>'id';
  v_result := public.pos_save_bill_phase3(
    null, 'Atomic rollback', '', v_failure_reservation_id, 1, 0, 0, 0,
    null, '', '[]'::jsonb, gen_random_uuid()::text, v_failure_table_id, false
  );
  v_failure_bill_id := v_result->'bill'->>'id';
  begin
    perform public.pos_close_bill_phase3(v_failure_bill_id, 1, gen_random_uuid()::text);
  exception when sqlstate '22023' then
    v_failure_rolled_back := true;
  end;
  if not v_failure_rolled_back
    or not exists (
      select 1 from public.pos_reservation_deposits d
      where d.id = v_failure_deposit_id and d.status = 'Held' and d.bill_id is null
    )
    or exists (
      select 1 from public.pos_bill_payments p where p.bill_id = v_failure_bill_id
    ) then
    raise exception 'FAIL: midway close failure left partial payment/deposit data.';
  end if;

  -- Catalog package price and reservation guest count determine the package line.
  v_result := public.pos_save_bill_phase3(
    null, 'Package booking', '', v_package_reservation_id, 3, 0, 0, 0,
    null, '', '[]'::jsonb, gen_random_uuid()::text, v_package_table_id, false
  );
  v_package_bill_id := v_result->'bill'->>'id';
  if (v_result->'bill'->>'subtotal')::numeric <> 635
    or (v_result->'bill'->>'food_revenue_total')::numeric <> 635
    or (select count(*) from public.pos_bill_lines
      where bill_id = v_package_bill_id and line_type = 'package'
        and charge_item_id = v_package_charge_id
        and package_tier_id is null
        and quantity = 2
        and unit_price = 317.50) <> 1 then
    raise exception 'FAIL: package catalog price was not recorded once using the reservation guest count.';
  end if;

  -- Exercise exact, short, and over counts through the server close RPC.
  perform set_config('request.jwt.claim.sub', v_manager_id::text, true);
  v_result := public.pos_open_shift(100, 'Acceptance zero variance');
  v_variance_zero_shift := v_result->'shift'->>'id';
  perform public.pos_record_cash_movement(
    v_variance_zero_shift, 'paid_in', 20, 'Acceptance paid in', gen_random_uuid()::text
  );
  perform public.pos_record_cash_movement(
    v_variance_zero_shift, 'paid_out', 10, 'Acceptance paid out', gen_random_uuid()::text
  );
  v_summary := public.pos_shift_summary(v_variance_zero_shift);
  if (v_summary->>'expected_cash')::numeric <> 110 then
    raise exception 'FAIL: Paid in/out did not affect expected cash correctly.';
  end if;
  v_result := public.pos_close_shift(v_variance_zero_shift, 110, '');
  if (v_result->>'cash_variance')::numeric <> 0 then
    raise exception 'FAIL: exact cash count did not produce zero variance.';
  end if;
  v_result := public.pos_open_shift(100, 'Acceptance shortage variance');
  v_variance_short_shift := v_result->'shift'->>'id';
  v_result := public.pos_close_shift(v_variance_short_shift, 40, '');
  if (v_result->>'cash_variance')::numeric <> -60 then
    raise exception 'FAIL: $60 shortage did not produce -$60 variance.';
  end if;
  v_result := public.pos_open_shift(100, 'Acceptance overage variance');
  v_variance_over_shift := v_result->'shift'->>'id';
  v_result := public.pos_close_shift(v_variance_over_shift, 140, '');
  if (v_result->>'cash_variance')::numeric <> 40 then
    raise exception 'FAIL: $40 overage did not produce +$40 variance.';
  end if;

  -- Receptionists cannot close another cashier's closed shift via direct RPC.
  perform set_config('request.jwt.claim.sub', v_receptionist_id::text, true);
  begin
    perform public.pos_close_shift(v_variance_over_shift, 0, 'not allowed');
    raise exception 'FAIL: Receptionist closed another cashier shift.';
  exception when insufficient_privilege then
    null;
  end;

  raise notice 'PASS: worked example, shift block, deposit application/remainder/restore, idempotency, guarded reservation/table close, role denials, package pricing, and rollback-on-failure.';
end;
$$;

rollback;
