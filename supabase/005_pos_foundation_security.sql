-- CostTrack POS security and role matrix.
-- Run after 004_pos_foundation_schema.sql.
-- This file enables RLS for the cashier/billing tables and restricts access to the
-- agreed role matrix: Administrator and Manager can manage POS catalog, settings,
-- and approvals; Receptionist can use cashier screens and process bills but cannot
-- manage the catalog or see revenue/profit screens; Inventory Clerk and Chef have no POS access.

begin;

alter table public.pos_charge_items enable row level security;
alter table public.pos_charge_item_variants enable row level security;
alter table public.pos_package_tiers enable row level security;
alter table public.pos_package_inclusions enable row level security;
alter table public.pos_discounts enable row level security;
alter table public.pos_settings enable row level security;
alter table public.pos_shifts enable row level security;
alter table public.pos_cash_movements enable row level security;
alter table public.pos_bills enable row level security;
alter table public.pos_bill_lines enable row level security;
alter table public.pos_bill_payments enable row level security;
alter table public.pos_reservation_deposits enable row level security;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'pos_charge_items', 'pos_charge_item_variants', 'pos_package_tiers',
        'pos_package_inclusions', 'pos_discounts', 'pos_settings', 'pos_shifts',
        'pos_cash_movements', 'pos_bills', 'pos_bill_lines', 'pos_bill_payments',
        'pos_reservation_deposits'
      ])
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename
    );
  end loop;
end;
$$;

create policy pos_charge_items_admin_full on public.pos_charge_items
  for all to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));

create policy pos_charge_items_receptionist_read on public.pos_charge_items
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_charge_item_variants_admin_full on public.pos_charge_item_variants
  for all to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));

create policy pos_charge_item_variants_receptionist_read on public.pos_charge_item_variants
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_package_tiers_admin_full on public.pos_package_tiers
  for all to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));

create policy pos_package_tiers_receptionist_read on public.pos_package_tiers
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_package_inclusions_admin_full on public.pos_package_inclusions
  for all to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));

create policy pos_package_inclusions_receptionist_read on public.pos_package_inclusions
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_discounts_admin_full on public.pos_discounts
  for all to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));

create policy pos_discounts_receptionist_read on public.pos_discounts
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_settings_admin_full on public.pos_settings
  for all to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));

create policy pos_settings_receptionist_read on public.pos_settings
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_shifts_admin_full on public.pos_shifts
  for all to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
  with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_cash_movements_admin_full on public.pos_cash_movements
  for all to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
  with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_bills_admin_full on public.pos_bills
  for all to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));

create policy pos_bills_receptionist_ops on public.pos_bills
  for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_bills_receptionist_update on public.pos_bills
  for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
  with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_bills_receptionist_select on public.pos_bills
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_bill_lines_admin_full on public.pos_bill_lines
  for all to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));

create policy pos_bill_lines_receptionist_ops on public.pos_bill_lines
  for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_bill_lines_receptionist_update on public.pos_bill_lines
  for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
  with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_bill_lines_receptionist_select on public.pos_bill_lines
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_bill_payments_admin_full on public.pos_bill_payments
  for all to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));

create policy pos_bill_payments_receptionist_ops on public.pos_bill_payments
  for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_bill_payments_receptionist_update on public.pos_bill_payments
  for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
  with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_bill_payments_receptionist_select on public.pos_bill_payments
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_reservation_deposits_admin_full on public.pos_reservation_deposits
  for all to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));

create policy pos_reservation_deposits_receptionist_ops on public.pos_reservation_deposits
  for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_reservation_deposits_receptionist_update on public.pos_reservation_deposits
  for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
  with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_reservation_deposits_receptionist_select on public.pos_reservation_deposits
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

revoke all on function public.set_updated_at() from public, anon;
grant execute on function public.set_updated_at() to authenticated;

commit;
