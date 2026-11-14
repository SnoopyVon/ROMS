-- Acceptance checks for 006_pos_billing_workflow.sql.
-- Run after 004, 005, and 006 in a database containing one profile for each
-- required role. All inserted rows roll back; sequence values are not rolled
-- back by PostgreSQL, so running this test may leave harmless bill-number gaps.

begin;

do $$
declare
  receptionist_id uuid;
  manager_id uuid;
  administrator_id uuid;
  clerk_id uuid;
  chef_id uuid;
  discount_id text;
  test_bill_id text;
  discount_test_bill_id text;
  approval_id text;
  result jsonb;
  first_close jsonb;
  second_close jsonb;
  payment_count integer;
begin
  select id into receptionist_id from public.profiles where role = 'Receptionist' limit 1;
  select id into manager_id from public.profiles where role = 'Manager' limit 1;
  select id into administrator_id from public.profiles where role = 'Administrator' limit 1;
  select id into clerk_id from public.profiles where role = 'Inventory Clerk' limit 1;
  select id into chef_id from public.profiles where role = 'Chef / Kitchen Staff' limit 1;
  select id into discount_id from public.pos_discounts where code = 'COMPLIMENTARY' and is_active;

  if receptionist_id is null or manager_id is null or administrator_id is null
    or clerk_id is null or chef_id is null then
    raise exception 'Acceptance test needs Administrator, Manager, Receptionist, Inventory Clerk, and Chef profiles.';
  end if;
  if discount_id is null then
    raise exception 'Acceptance test needs the active COMPLIMENTARY bill discount seed.';
  end if;
  if has_table_privilege('authenticated', 'public.pos_bills', 'INSERT')
    or has_table_privilege('authenticated', 'public.pos_bills', 'UPDATE')
    or has_table_privilege('authenticated', 'public.pos_bill_payments', 'INSERT') then
    raise exception 'Authenticated users retain forbidden direct write privileges.';
  end if;
  if not has_table_privilege('authenticated', 'public.pos_bills', 'SELECT') then
    raise exception 'Authenticated users must retain bill read privileges.';
  end if;

  perform set_config('request.jwt.claim.sub', clerk_id::text, true);
  begin
    perform public.pos_save_bill(
      p_adult_count => 1,
      p_idempotency_key => 'acceptance-clerk-denial-' || gen_random_uuid()::text
    );
    raise exception 'Inventory Clerk unexpectedly created a bill.';
  exception when insufficient_privilege then
    null;
  end;

  perform set_config('request.jwt.claim.sub', chef_id::text, true);
  begin
    perform public.pos_request_bill_void('missing-bill', 'Acceptance denial');
    raise exception 'Chef unexpectedly requested a bill void.';
  exception when insufficient_privilege then
    null;
  end;

  perform set_config('request.jwt.claim.sub', receptionist_id::text, true);
  begin
    perform public.pos_decide_bill_approval('missing-approval', 'approve', '');
    raise exception 'Receptionist unexpectedly decided an approval.';
  exception when insufficient_privilege then
    null;
  end;

  result := public.pos_save_bill(
    p_customer_name => 'Phase 2 acceptance example',
    p_adult_count => 40,
    p_senior_count => 10,
    p_kids_count => 8,
    p_comped_count => 2,
    p_extra_lines => jsonb_build_array(jsonb_build_object(
      'charge_item_id', 'pos-charge-leftover',
      'quantity', 1
    )),
    p_initial_deposit => 2000,
    p_idempotency_key => 'acceptance-example-' || gen_random_uuid()::text
  );
  test_bill_id := result->'bill'->>'id';

  if (result->'bill'->>'subtotal')::numeric <> 23560
    or (result->'bill'->>'deposit_total')::numeric <> 2000
    or (result->'bill'->>'balance_due')::numeric <> 21560
    or (result->'bill'->>'food_revenue_total')::numeric <> 23360
    or (result->'bill'->>'non_food_revenue_total')::numeric <> 200
    or (result->'bill'->>'customers_served')::integer <> 60 then
    raise exception 'Worked-example totals did not match: %', result->'bill';
  end if;

  first_close := public.pos_close_bill(
    test_bill_id, 22000, 'acceptance-close-' || test_bill_id
  );
  second_close := public.pos_close_bill(
    test_bill_id, 22000, 'acceptance-close-' || test_bill_id
  );
  if (first_close->'payment'->>'change_amount')::numeric <> 440
    or coalesce((second_close->>'already_closed')::boolean, false) is not true then
    raise exception 'Cash change or repeated-close idempotency check failed.';
  end if;
  select count(*) into payment_count
  from public.pos_bill_payments
  where pos_bill_payments.bill_id = test_bill_id and payment_method = 'cash';
  if payment_count <> 1 then
    raise exception 'Repeated close created % cash payments; expected 1.', payment_count;
  end if;

  result := public.pos_save_bill(
    p_customer_name => 'Approval acceptance test',
    p_adult_count => 1,
    p_discount_id => discount_id,
    p_discount_reason => 'Acceptance test full discount',
    p_idempotency_key => 'acceptance-discount-' || gen_random_uuid()::text
  );
  test_bill_id := result->'bill'->>'id';
  discount_test_bill_id := test_bill_id;
  approval_id := result->'approval'->>'id';
  if approval_id is null or result->'approval'->>'status' <> 'Pending' then
    raise exception 'Full discount did not create a pending approval: %', result->'approval';
  end if;

  begin
    perform public.pos_decide_bill_approval(approval_id, 'approve', 'Should be denied');
    raise exception 'Requester unexpectedly approved their own request.';
  exception when insufficient_privilege then
    null;
  end;

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  result := public.pos_decide_bill_approval(approval_id, 'approve', 'Acceptance approved');
  if result->'approval'->>'status' <> 'Approved'
    or result->'approval'->>'decided_by' <> manager_id::text
    or result->'approval'->>'decided_at' is null then
    raise exception 'Manager approval audit fields were not recorded: %', result->'approval';
  end if;

  result := public.pos_save_bill(
    p_customer_name => 'Self-approval acceptance test',
    p_adult_count => 1,
    p_discount_id => discount_id,
    p_discount_reason => 'Manager self-approval test',
    p_idempotency_key => 'acceptance-manager-discount-' || gen_random_uuid()::text
  );
  approval_id := result->'approval'->>'id';
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  begin
    perform public.pos_decide_bill_approval(approval_id, 'approve', 'Should be denied');
    raise exception 'Manager unexpectedly approved their own request.';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('request.jwt.claim.sub', administrator_id::text, true);
  result := public.pos_decide_bill_approval(approval_id, 'approve', 'Administrator approval');
  if result->'approval'->>'status' <> 'Approved'
    or result->'approval'->>'decided_by' <> administrator_id::text then
    raise exception 'Administrator did not approve the Manager request.';
  end if;

  perform set_config('request.jwt.claim.sub', receptionist_id::text, true);
  result := public.pos_save_bill(
    p_bill_id => discount_test_bill_id,
    p_customer_name => 'Approval acceptance test',
    p_adult_count => 2,
    p_discount_id => discount_id,
    p_discount_reason => 'Acceptance test full discount',
    p_extra_lines => '[]'::jsonb
  );
  approval_id := result->'approval'->>'id';
  if approval_id is null or result->'approval'->>'status' <> 'Pending'
    or (result->'approval'->>'bill_subtotal_snapshot')::numeric <> 898 then
    raise exception 'Changing a fully discounted bill did not require a new amount-bound approval.';
  end if;

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  result := public.pos_decide_bill_approval(approval_id, 'reject', 'Acceptance rejection');
  if result->'approval'->>'status' <> 'Rejected'
    or result->'approval'->>'decided_by' <> manager_id::text
    or result->'approval'->>'decided_at' is null then
    raise exception 'Manager rejection audit fields were not recorded.';
  end if;

  perform set_config('request.jwt.claim.sub', receptionist_id::text, true);
  result := public.pos_request_bill_void(discount_test_bill_id, 'Acceptance void request');
  approval_id := result->'approval'->>'id';
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  result := public.pos_decide_bill_approval(approval_id, 'approve', 'Acceptance void approval');
  if result->'bill'->>'status' <> 'Voided'
    or result->'bill'->>'voided_by' <> manager_id::text
    or result->'bill'->>'voided_at' is null then
    raise exception 'Approved void did not update the bill and audit fields.';
  end if;
end;
$$;

rollback;
