-- Pricing & Billing Setup governance.
-- Run after 052_fix_verified_account_ocr_validation.sql.

begin;

do $$
declare
  policy_row record;
  table_names text[] := array[
    'pos_charge_items',
    'pos_charge_item_variants',
    'pos_package_tiers',
    'pos_package_inclusions',
    'pos_discounts',
    'pos_settings',
    'buffet_rates'
  ];
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (table_names)
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename
    );
  end loop;
end;
$$;

alter table public.pos_charge_items enable row level security;
alter table public.pos_charge_item_variants enable row level security;
alter table public.pos_package_tiers enable row level security;
alter table public.pos_package_inclusions enable row level security;
alter table public.pos_discounts enable row level security;
alter table public.pos_settings enable row level security;
alter table public.buffet_rates enable row level security;

create policy pos_charge_items_admin_full on public.pos_charge_items
  for all to authenticated
  using (public.has_app_role(array['Administrator']))
  with check (public.has_app_role(array['Administrator']));
create policy pos_charge_items_operational_read on public.pos_charge_items
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_charge_item_variants_admin_full on public.pos_charge_item_variants
  for all to authenticated
  using (public.has_app_role(array['Administrator']))
  with check (public.has_app_role(array['Administrator']));
create policy pos_charge_item_variants_operational_read on public.pos_charge_item_variants
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_package_tiers_admin_full on public.pos_package_tiers
  for all to authenticated
  using (public.has_app_role(array['Administrator']))
  with check (public.has_app_role(array['Administrator']));
create policy pos_package_tiers_operational_read on public.pos_package_tiers
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_package_inclusions_admin_full on public.pos_package_inclusions
  for all to authenticated
  using (public.has_app_role(array['Administrator']))
  with check (public.has_app_role(array['Administrator']));
create policy pos_package_inclusions_operational_read on public.pos_package_inclusions
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_discounts_admin_full on public.pos_discounts
  for all to authenticated
  using (public.has_app_role(array['Administrator']))
  with check (public.has_app_role(array['Administrator']));
create policy pos_discounts_operational_read on public.pos_discounts
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));
create policy pos_discounts_manager_toggle on public.pos_discounts
  for update to authenticated
  using (public.has_app_role(array['Manager']))
  with check (public.has_app_role(array['Manager']));

create policy pos_settings_admin_full on public.pos_settings
  for all to authenticated
  using (public.has_app_role(array['Administrator']))
  with check (public.has_app_role(array['Administrator']));
create policy pos_settings_operational_read on public.pos_settings
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy buffet_rates_admin_full on public.buffet_rates
  for all to authenticated
  using (public.has_app_role(array['Administrator']))
  with check (public.has_app_role(array['Administrator']));
create policy buffet_rates_operational_read on public.buffet_rates
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create or replace function public.prevent_pricing_rule_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Pricing records cannot be deleted. Mark them inactive instead.'
    using errcode = '55000';
end;
$$;

create or replace function public.guard_manager_discount_activation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.current_app_role() = 'Manager'
    and (to_jsonb(new) - 'is_active' - 'updated_at')
      is distinct from (to_jsonb(old) - 'is_active' - 'updated_at') then
    raise exception 'Managers may only enable or disable an approved promotion.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.guard_booked_package_tier_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.pos_bills b where b.status = 'Open') then
      raise exception 'Close all open POS bills before adding a package tier.'
        using errcode = '55000';
    end if;
    return new;
  end if;

  if (old.code, old.name, old.default_meal_period, old.base_price, old.is_active)
      is distinct from
     (new.code, new.name, new.default_meal_period, new.base_price, new.is_active)
    and (
      exists (
        select 1
        from public.reservations r
        where r.package_tier_id = old.id
          and r.status in ('Pending', 'Confirmed', 'Seated')
      ) or exists (
        select 1
        from public.pos_bills b
        where b.status = 'Open'
      )
    ) then
    raise exception 'This package is attached to an active reservation, or a POS bill is open. Close open bills and create a new package tier for future bookings.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.guard_open_bill_charge_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.pos_bills b where b.status = 'Open') then
      raise exception 'Close all open POS bills before adding an additional charge.'
        using errcode = '55000';
    end if;
    return new;
  end if;

  if (old.code, old.name, old.type, old.unit_price, old.is_active,
      old.is_food_revenue, old.is_package)
      is distinct from
     (new.code, new.name, new.type, new.unit_price, new.is_active,
      new.is_food_revenue, new.is_package)
    and exists (
      select 1
      from public.pos_bills b
      where b.status = 'Open'
    ) then
    raise exception 'Close all open POS bills before changing additional charge rules; create a new charge for future transactions.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.guard_open_bill_discount_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.pos_bills b where b.status = 'Open') then
      raise exception 'Close all open POS bills before adding a promotion.'
        using errcode = '55000';
    end if;
    return new;
  end if;

  if (old.code, old.name, old.discount_type, old.value, old.minimum_amount,
      old.applies_to, old.is_active)
      is distinct from
     (new.code, new.name, new.discount_type, new.value, new.minimum_amount,
      new.applies_to, new.is_active)
    and exists (select 1 from public.pos_bills b where b.status = 'Open') then
    raise exception 'Close all open POS bills before changing promotion rules.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.guard_booked_package_item_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (old.name, old.type, old.is_active, old.is_package)
      is distinct from
     (new.name, new.type, new.is_active, new.is_package)
    and exists (
      select 1
      from public.reservations r
      where r.package_charge_item_id = old.id
        and r.status in ('Pending', 'Confirmed', 'Seated')
    ) then
    raise exception 'This package item is attached to an active reservation and cannot be changed until those bookings are resolved.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.guard_open_bill_pricing_settings()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.setting_key in (
      'pos_extra_pax_rate',
      'pos_service_charge_mode',
      'pos_service_charge_percent',
      'pos_service_charge_per_head'
    )
    and old.setting_value is distinct from new.setting_value
    and exists (select 1 from public.pos_bills b where b.status = 'Open') then
    raise exception 'Close all open bills before changing pricing rules used during bill recalculation.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

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
begin
  foreach relation_name in array pricing_tables loop
    execute format('drop trigger if exists prevent_pricing_rule_delete on public.%I', relation_name);
    execute format(
      'create trigger prevent_pricing_rule_delete before delete on public.%I for each row execute function public.prevent_pricing_rule_delete()',
      relation_name
    );
    execute format('drop trigger if exists write_audit_log on public.%I', relation_name);
    execute format(
      'create trigger write_audit_log after insert or update on public.%I for each row execute function public.write_audit_log()',
      relation_name
    );
  end loop;
end;
$$;

drop trigger if exists guard_manager_discount_activation on public.pos_discounts;
create trigger guard_manager_discount_activation
  before update on public.pos_discounts
  for each row execute function public.guard_manager_discount_activation();

drop trigger if exists guard_booked_package_tier_change on public.pos_package_tiers;
create trigger guard_booked_package_tier_change
  before insert or update on public.pos_package_tiers
  for each row execute function public.guard_booked_package_tier_change();

drop trigger if exists guard_open_bill_charge_change on public.pos_charge_items;
create trigger guard_open_bill_charge_change
  before insert or update on public.pos_charge_items
  for each row execute function public.guard_open_bill_charge_change();

drop trigger if exists guard_open_bill_discount_change on public.pos_discounts;
create trigger guard_open_bill_discount_change
  before insert or update on public.pos_discounts
  for each row execute function public.guard_open_bill_discount_change();

drop trigger if exists guard_booked_package_item_change on public.pos_charge_items;
create trigger guard_booked_package_item_change
  before update on public.pos_charge_items
  for each row execute function public.guard_booked_package_item_change();

drop trigger if exists guard_open_bill_pricing_settings on public.pos_settings;
create trigger guard_open_bill_pricing_settings
  before update on public.pos_settings
  for each row execute function public.guard_open_bill_pricing_settings();

revoke all on function public.prevent_pricing_rule_delete() from public, anon, authenticated;
revoke all on function public.guard_manager_discount_activation() from public, anon, authenticated;
revoke all on function public.guard_booked_package_tier_change() from public, anon, authenticated;
revoke all on function public.guard_open_bill_charge_change() from public, anon, authenticated;
revoke all on function public.guard_open_bill_discount_change() from public, anon, authenticated;
revoke all on function public.guard_booked_package_item_change() from public, anon, authenticated;
revoke all on function public.guard_open_bill_pricing_settings() from public, anon, authenticated;

commit;
