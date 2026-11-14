-- Rollback for the POS foundation schema.
-- Safe to run when any or all POS objects are already missing.
-- This removes only the POS tables and their attached policies/triggers.

begin;

-- Drop policies only when their POS table exists. This also handles policies
-- added to these POS tables after the original migration.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'pos_charge_items',
        'pos_charge_item_variants',
        'pos_package_tiers',
        'pos_package_inclusions',
        'pos_discounts',
        'pos_settings',
        'pos_shifts',
        'pos_cash_movements',
        'pos_bills',
        'pos_bill_lines',
        'pos_bill_payments',
        'pos_reservation_deposits'
      ])
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

-- DROP TRIGGER requires its table to exist, so check before each drop.
do $$
declare
  trigger_row record;
begin
  for trigger_row in
    select *
    from (values
      ('pos_reservation_deposits', 'set_pos_reservation_deposit_updated_at'),
      ('pos_bill_payments', 'set_pos_bill_payment_updated_at'),
      ('pos_bill_lines', 'set_pos_bill_line_updated_at'),
      ('pos_bills', 'set_pos_bill_updated_at'),
      ('pos_cash_movements', 'set_pos_cash_movement_updated_at'),
      ('pos_shifts', 'set_pos_shift_updated_at'),
      ('pos_settings', 'set_pos_setting_updated_at'),
      ('pos_discounts', 'set_pos_discount_updated_at'),
      ('pos_package_inclusions', 'set_pos_package_inclusion_updated_at'),
      ('pos_package_tiers', 'set_pos_package_tier_updated_at'),
      ('pos_charge_item_variants', 'set_pos_variant_updated_at'),
      ('pos_charge_items', 'set_pos_updated_at')
    ) as pos_triggers(table_name, trigger_name)
  loop
    if to_regclass(format('public.%I', trigger_row.table_name)) is not null then
      execute format(
        'drop trigger if exists %I on public.%I',
        trigger_row.trigger_name,
        trigger_row.table_name
      );
    end if;
  end loop;
end;
$$;

-- Child tables are removed before the POS tables they reference.
drop table if exists public.pos_reservation_deposits cascade;
drop table if exists public.pos_bill_payments cascade;
drop table if exists public.pos_bill_lines cascade;
drop table if exists public.pos_bills cascade;
drop table if exists public.pos_cash_movements cascade;
drop table if exists public.pos_shifts cascade;
drop table if exists public.pos_settings cascade;
drop table if exists public.pos_discounts cascade;
drop table if exists public.pos_package_inclusions cascade;
drop table if exists public.pos_package_tiers cascade;
drop table if exists public.pos_charge_item_variants cascade;
drop table if exists public.pos_charge_items cascade;

-- set_updated_at() has a generic, non-POS name. Remove it only when no
-- database object still depends on it; otherwise leave the shared helper intact.
do $$
declare
  updater_function oid;
begin
  updater_function := to_regprocedure('public.set_updated_at()')::oid;

  if updater_function is not null
    and not exists (
      select 1
      from pg_depend
      where refclassid = 'pg_proc'::regclass
        and refobjid = updater_function
        and deptype not in ('i', 'e')
    )
  then
    execute 'drop function if exists public.set_updated_at()';
  end if;
end;
$$;

commit;
