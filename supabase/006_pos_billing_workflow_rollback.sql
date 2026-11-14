-- Roll back Phase 2 POS billing changes only.
-- WARNING: This removes Phase 2 bill counts, snapshots, approvals, and payment
-- change metadata. Back up the database and retain 004/005 if the POS foundation
-- is still in use.
-- The bill-number sequence is intentionally retained: consumed numbers must
-- never be reused, even if this migration is rolled back and reapplied.

begin;

-- Remove policies safely when the corresponding table exists.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'pos_bills', 'pos_bill_lines', 'pos_bill_payments', 'pos_bill_approvals'
      ])
  loop
    execute format('drop policy if exists %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end;
$$;

drop function if exists public.pos_close_bill(text, numeric, text);
drop function if exists public.pos_request_bill_void(text, text);
drop function if exists public.pos_decide_bill_approval(text, text, text);
drop function if exists public.pos_save_bill(text, text, text, text, integer, integer, integer, integer, text, text, jsonb, numeric, text);
drop function if exists public.pos_recalculate_bill(text);

drop index if exists public.pos_bill_approvals_bill_idx;
drop index if exists public.pos_bill_approvals_status_idx;
drop index if exists public.pos_bills_create_idempotency_idx;
drop index if exists public.pos_bill_payments_idempotency_idx;

drop table if exists public.pos_bill_approvals cascade;

alter table if exists public.pos_bills
  drop constraint if exists pos_bills_discount_id_fkey;

alter table if exists public.pos_bills drop column if exists adult_count;
alter table if exists public.pos_bills drop column if exists senior_count;
alter table if exists public.pos_bills drop column if exists kids_count;
alter table if exists public.pos_bills drop column if exists comped_count;
alter table if exists public.pos_bills drop column if exists adult_rate_snapshot;
alter table if exists public.pos_bills drop column if exists senior_rate_snapshot;
alter table if exists public.pos_bills drop column if exists kids_rate_snapshot;
alter table if exists public.pos_bills drop column if exists discount_id;
alter table if exists public.pos_bills drop column if exists discount_reason;
alter table if exists public.pos_bills drop column if exists discount_type_snapshot;
alter table if exists public.pos_bills drop column if exists discount_value_snapshot;
alter table if exists public.pos_bills drop column if exists discount_minimum_snapshot;
alter table if exists public.pos_bills drop column if exists food_revenue_total;
alter table if exists public.pos_bills drop column if exists non_food_revenue_total;
alter table if exists public.pos_bills drop column if exists customers_served;
alter table if exists public.pos_bills drop column if exists closed_at;
alter table if exists public.pos_bills drop column if exists closed_by;
alter table if exists public.pos_bills drop column if exists voided_at;
alter table if exists public.pos_bills drop column if exists voided_by;
alter table if exists public.pos_bills drop column if exists void_reason;
alter table if exists public.pos_bills drop column if exists create_idempotency_key;

alter table if exists public.pos_bill_lines
  drop column if exists is_food_revenue_snapshot;
alter table if exists public.pos_bill_payments
  drop column if exists tendered_amount;
alter table if exists public.pos_bill_payments
  drop column if exists change_amount;
alter table if exists public.pos_bill_payments
  drop column if exists idempotency_key;

-- Restore the Phase 1 bill policies and browser privileges.
do $$
begin
  if to_regclass('public.pos_settings') is not null then
    execute 'drop policy if exists pos_settings_admin_full on public.pos_settings';
    execute $policy$
      create policy pos_settings_admin_full on public.pos_settings
        for all to authenticated
        using (public.has_app_role(array['Administrator', 'Manager']))
        with check (public.has_app_role(array['Administrator', 'Manager']))
    $policy$;
  end if;

  if to_regclass('public.pos_bills') is not null then
    execute $policy$
      create policy pos_bills_admin_full on public.pos_bills
        for all to authenticated
        using (public.has_app_role(array['Administrator', 'Manager']))
        with check (public.has_app_role(array['Administrator', 'Manager']))
    $policy$;
    execute $policy$
      create policy pos_bills_receptionist_ops on public.pos_bills
        for insert to authenticated
        with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
    $policy$;
    execute $policy$
      create policy pos_bills_receptionist_update on public.pos_bills
        for update to authenticated
        using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
        with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
    $policy$;
    execute $policy$
      create policy pos_bills_receptionist_select on public.pos_bills
        for select to authenticated
        using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
    $policy$;
    grant select, insert, update, delete on public.pos_bills to authenticated;
  end if;

  if to_regclass('public.pos_bill_lines') is not null then
    execute $policy$
      create policy pos_bill_lines_admin_full on public.pos_bill_lines
        for all to authenticated
        using (public.has_app_role(array['Administrator', 'Manager']))
        with check (public.has_app_role(array['Administrator', 'Manager']))
    $policy$;
    execute $policy$
      create policy pos_bill_lines_receptionist_ops on public.pos_bill_lines
        for insert to authenticated
        with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
    $policy$;
    execute $policy$
      create policy pos_bill_lines_receptionist_update on public.pos_bill_lines
        for update to authenticated
        using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
        with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
    $policy$;
    execute $policy$
      create policy pos_bill_lines_receptionist_select on public.pos_bill_lines
        for select to authenticated
        using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
    $policy$;
    grant select, insert, update, delete on public.pos_bill_lines to authenticated;
  end if;

  if to_regclass('public.pos_bill_payments') is not null then
    execute $policy$
      create policy pos_bill_payments_admin_full on public.pos_bill_payments
        for all to authenticated
        using (public.has_app_role(array['Administrator', 'Manager']))
        with check (public.has_app_role(array['Administrator', 'Manager']))
    $policy$;
    execute $policy$
      create policy pos_bill_payments_receptionist_ops on public.pos_bill_payments
        for insert to authenticated
        with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
    $policy$;
    execute $policy$
      create policy pos_bill_payments_receptionist_update on public.pos_bill_payments
        for update to authenticated
        using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
        with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
    $policy$;
    execute $policy$
      create policy pos_bill_payments_receptionist_select on public.pos_bill_payments
        for select to authenticated
        using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
    $policy$;
    grant select, insert, update, delete on public.pos_bill_payments to authenticated;
  end if;
end;
$$;

commit;
