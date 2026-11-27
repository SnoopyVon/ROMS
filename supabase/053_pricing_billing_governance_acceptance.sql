-- Read-only checks for 053_pricing_billing_governance.sql.

do $$
declare
  relation_name text;
  pricing_tables text[] := array[
    'pos_charge_items',
    'pos_charge_item_variants',
    'pos_package_tiers',
    'pos_package_inclusions',
    'pos_discounts',
    'pos_settings',
    'buffet_rates'
  ];
  required_column text;
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pos_discounts'
      and policyname = 'pos_discounts_manager_toggle'
      and cmd = 'UPDATE'
  ) then
    raise exception 'Manager promotion status policy is missing.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pos_package_tiers'
      and policyname = 'pos_package_tiers_admin_full'
      and cmd = 'ALL'
  ) then
    raise exception 'Administrator-only package tier policy is missing.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pos_settings'
      and policyname = 'pos_settings_admin_full'
      and cmd = 'ALL'
  ) then
    raise exception 'Administrator-only POS settings policy is missing.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pos_charge_items'::regclass
      and tgname = 'guard_open_bill_charge_change'
      and not tgisinternal
  ) then
    raise exception 'Open-bill additional-charge protection is missing.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pos_package_tiers'::regclass
      and tgname = 'guard_booked_package_tier_change'
      and not tgisinternal
  ) then
    raise exception 'Active-reservation/open-bill package protection is missing.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pos_discounts'::regclass
      and tgname = 'guard_open_bill_discount_change'
      and not tgisinternal
  ) then
    raise exception 'Open-bill promotion protection is missing.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pos_settings'::regclass
      and tgname = 'guard_open_bill_pricing_settings'
      and not tgisinternal
  ) then
    raise exception 'Open-bill pricing-setting protection is missing.';
  end if;

  foreach relation_name in array pricing_tables loop
    if not exists (
      select 1 from pg_class c
      where c.oid = format('public.%I', relation_name)::regclass
        and c.relrowsecurity
    ) then
      raise exception 'Row-level security is disabled for public.%', relation_name;
    end if;
    if not exists (
      select 1 from pg_trigger t
      where t.tgrelid = format('public.%I', relation_name)::regclass
        and t.tgname = 'prevent_pricing_rule_delete'
        and not t.tgisinternal
    ) then
      raise exception 'Hard-delete guard is missing for public.%', relation_name;
    end if;
    if not exists (
      select 1 from pg_trigger t
      where t.tgrelid = format('public.%I', relation_name)::regclass
        and t.tgname = 'write_audit_log'
        and not t.tgisinternal
    ) then
      raise exception 'Pricing audit trigger is missing for public.%', relation_name;
    end if;
  end loop;

  foreach required_column in array array[
    'pos_bills.adult_rate_snapshot',
    'pos_bills.senior_rate_snapshot',
    'pos_bills.kids_rate_snapshot',
    'pos_bills.discount_type_snapshot',
    'pos_bills.discount_value_snapshot',
    'pos_bill_lines.unit_price'
  ] loop
    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and (c.table_name || '.' || c.column_name) = required_column
    ) then
      raise exception 'Expected existing POS snapshot column % is missing.', required_column;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'reservations'
      and c.column_name in ('package_price_snapshot', 'package_unit_price_snapshot')
  ) then
    raise notice 'Acceptance gap: reservations do not store the package price booked.';
  end if;

  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'pos_bills'
      and c.column_name in ('service_charge_mode_snapshot', 'service_charge_rate_snapshot')
  ) then
    raise notice 'Acceptance gap: service-charge rules are not snapshotted for open bills.';
  end if;

  raise notice 'Pricing governance policies, deletion guards, audit triggers, reservation/open-bill protections, and current POS price snapshots are present.';
end;
$$;
