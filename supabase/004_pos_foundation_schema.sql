-- CostTrack POS foundation schema.
-- Run order: 1) 004_pos_foundation_schema.sql
--             2) 005_pos_foundation_security.sql
--             3) optional rollback: 004_pos_foundation_schema_rollback.sql
--
-- This file adds the cashier/billing foundation without mutating inventory stock.
-- Deposits are modeled as payments applied to a bill instead of discounts.
-- Service charge defaults to none until a manager sets a configured rule.

begin;

create extension if not exists pgcrypto;

create table if not exists public.pos_charge_items (
  id text primary key default gen_random_uuid()::text,
  code text not null unique,
  name text not null,
  type text not null check (type in ('food', 'non_food', 'service_charge', 'package', 'deposit', 'discount', 'other')),
  category text not null default 'General',
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  default_quantity numeric(12,2) not null default 1 check (default_quantity > 0),
  is_active boolean not null default true,
  is_food_revenue boolean not null default true,
  is_package boolean not null default false,
  requires_approval boolean not null default false,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_charge_item_variants (
  id text primary key default gen_random_uuid()::text,
  charge_item_id text not null references public.pos_charge_items(id) on delete cascade,
  variant_name text not null,
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_package_tiers (
  id text primary key default gen_random_uuid()::text,
  code text not null unique,
  name text not null,
  default_meal_period text not null default 'All Day',
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  is_active boolean not null default true,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_package_inclusions (
  id text primary key default gen_random_uuid()::text,
  package_tier_id text not null references public.pos_package_tiers(id) on delete cascade,
  charge_item_id text references public.pos_charge_items(id) on delete set null,
  quantity numeric(12,2) not null default 1 check (quantity >= 0),
  is_included boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_discounts (
  id text primary key default gen_random_uuid()::text,
  code text not null unique,
  name text not null,
  discount_type text not null check (discount_type in ('percent', 'fixed', 'waive')),
  value numeric(12,2) not null default 0 check (value >= 0),
  minimum_amount numeric(12,2) not null default 0 check (minimum_amount >= 0),
  applies_to text not null default 'bill' check (applies_to in ('bill', 'line', 'service_charge', 'package')),
  is_active boolean not null default true,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_settings (
  id text primary key default gen_random_uuid()::text,
  setting_key text not null unique,
  setting_value text not null default '',
  setting_type text not null default 'text' check (setting_type in ('text', 'number', 'boolean', 'json')),
  description text,
  is_system boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_shifts (
  id text primary key default gen_random_uuid()::text,
  shift_code text not null unique,
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  status text not null default 'Open' check (status in ('Open', 'Closed', 'Needs review')),
  opening_float numeric(12,2) not null default 0 check (opening_float >= 0),
  cash_sales numeric(12,2) not null default 0 check (cash_sales >= 0),
  card_sales numeric(12,2) not null default 0 check (card_sales >= 0),
  declared_cash numeric(12,2) not null default 0 check (declared_cash >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_cash_movements (
  id text primary key default gen_random_uuid()::text,
  shift_id text references public.pos_shifts(id) on delete set null,
  movement_type text not null check (movement_type in ('opening_float', 'cash_sale', 'refund', 'payout', 'deposit', 'adjustment')),
  amount numeric(12,2) not null check (amount >= 0),
  reason text not null default '',
  reference text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_bills (
  id text primary key default gen_random_uuid()::text,
  bill_number text not null unique,
  reservation_id text references public.reservations(id) on delete set null,
  customer_name text not null default 'Walk-in',
  status text not null default 'Open' check (status in ('Open', 'Closed', 'Voided')),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  service_charge numeric(12,2) not null default 0 check (service_charge >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  deposit_total numeric(12,2) not null default 0 check (deposit_total >= 0),
  paid_total numeric(12,2) not null default 0 check (paid_total >= 0),
  balance_due numeric(12,2) not null default 0 check (balance_due >= 0),
  printed_title text not null default 'BILLING STATEMENT (not an official receipt)',
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_bill_lines (
  id text primary key default gen_random_uuid()::text,
  bill_id text not null references public.pos_bills(id) on delete cascade,
  charge_item_id text references public.pos_charge_items(id) on delete set null,
  package_tier_id text references public.pos_package_tiers(id) on delete set null,
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  line_type text not null default 'charge_item' check (line_type in ('charge_item', 'package', 'service_charge', 'discount', 'deposit', 'adjustment')),
  food_revenue_amount numeric(12,2) not null default 0 check (food_revenue_amount >= 0),
  non_food_revenue_amount numeric(12,2) not null default 0 check (non_food_revenue_amount >= 0),
  is_voided boolean not null default false,
  void_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_bill_payments (
  id text primary key default gen_random_uuid()::text,
  bill_id text not null references public.pos_bills(id) on delete cascade,
  payment_method text not null check (payment_method in ('cash', 'card', 'gcash', 'maya', 'bank_transfer', 'deposit', 'other')),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  reference_no text,
  paid_by uuid,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_reservation_deposits (
  id text primary key default gen_random_uuid()::text,
  reservation_id text references public.reservations(id) on delete cascade,
  bill_id text references public.pos_bills(id) on delete set null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  payment_method text not null default 'cash' check (payment_method in ('cash', 'card', 'gcash', 'maya', 'bank_transfer', 'deposit', 'other')),
  status text not null default 'Outstanding' check (status in ('Outstanding', 'Applied', 'Refunded', 'Voided')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create index if not exists pos_charge_items_type_idx on public.pos_charge_items (type, is_active);
create index if not exists pos_package_tiers_active_idx on public.pos_package_tiers (is_active, default_meal_period);
create index if not exists pos_bill_status_idx on public.pos_bills (status, created_at DESC);
create index if not exists pos_bill_lines_bill_id_idx on public.pos_bill_lines (bill_id, is_voided);
create index if not exists pos_reservation_deposits_reservation_idx on public.pos_reservation_deposits (reservation_id, status);

insert into public.pos_charge_items (id, code, name, type, category, unit_price, default_quantity, is_active, is_food_revenue, is_package, requires_approval, notes)
values
  ('pos-charge-package', 'PACKAGE', 'Package sale', 'package', 'Food', 449.00, 1, true, true, true, false, 'Package revenue is counted as food revenue as a whole.'),
  ('pos-charge-service', 'SERVICE', 'Service charge', 'service_charge', 'Service', 0.00, 1, true, false, false, true, 'Defaults to none until the manager enables a configured rule.'),
  ('pos-charge-addon-decor', 'ADDON-DECOR', 'Decor add-on', 'non_food', 'Decor', 0.00, 1, true, false, false, false, 'Non-food add-on revenue.'),
  ('pos-charge-addon-lettering', 'ADDON-LETTERING', 'Lettering add-on', 'non_food', 'Decor', 0.00, 1, true, false, false, false, 'Non-food add-on revenue.'),
  ('pos-charge-addon-motif', 'ADDON-MOTIF', 'Motif add-on', 'non_food', 'Decor', 0.00, 1, true, false, false, false, 'Non-food add-on revenue.'),
  ('pos-charge-deposit', 'DEPOSIT', 'Reservation deposit', 'deposit', 'Payment', 0.00, 1, true, false, false, false, 'Deposits are tracked as bill payments, not discounts.')
on conflict (code) do nothing;

insert into public.pos_package_tiers (id, code, name, default_meal_period, base_price, is_active, notes)
values
  ('pos-package-tier-regular', 'ADULT', 'Adult', 'All Day', 449.00, true, 'Adult cashier rate.'),
  ('pos-package-tier-premium', 'SENIOR', 'Senior / PWD', 'All Day', 360.00, true, 'Senior/PWD cashier rate.'),
  ('pos-package-tier-children', 'KIDS', 'Kids', 'All Day', 225.00, true, 'Kids cashier rate.'),
  ('pos-package-tier-comped', 'COMPED', 'Comped guest', 'All Day', 0.00, true, 'Comped guests count as served and are priced at zero.')
on conflict (code) do nothing;

insert into public.pos_discounts (id, code, name, discount_type, value, minimum_amount, applies_to, is_active, notes)
values
  ('pos-discount-early-bird', 'EARLY-BIRD', 'Early bird discount', 'percent', 10.00, 0.00, 'bill', true, 'Example preset; manager can disable or replace.'),
  ('pos-discount-vip', 'VIP', 'VIP courtesy', 'fixed', 100.00, 0.00, 'bill', true, 'Example preset for courtesy adjustments.'),
  ('pos-discount-complimentary', 'COMPLIMENTARY', 'Comped guest', 'waive', 100.00, 0.00, 'bill', true, 'Use only with approved exception.' )
on conflict (code) do nothing;

insert into public.pos_settings (id, setting_key, setting_value, setting_type, description, is_system)
values
  ('pos-setting-service-charge-mode', 'pos_service_charge_mode', 'none', 'text', 'Allowed values: none, percent, per_head. Defaults to none until confirmed by the client.', true),
  ('pos-setting-print-title', 'pos_print_title', 'BILLING STATEMENT (not an official receipt)', 'text', 'Print title for all cashier statements.', true),
  ('pos-setting-default-currency', 'pos_default_currency', 'PHP', 'text', 'Default billing currency.', true),
  ('pos-setting-approval-required', 'pos_requires_approval_for_manual_charge', 'true', 'boolean', 'Manual charge edits require manager approval.', true)
on conflict (setting_key) do nothing;

create trigger set_pos_updated_at
before update on public.pos_charge_items
for each row execute procedure public.set_updated_at();

create trigger set_pos_variant_updated_at
before update on public.pos_charge_item_variants
for each row execute procedure public.set_updated_at();

create trigger set_pos_package_tier_updated_at
before update on public.pos_package_tiers
for each row execute procedure public.set_updated_at();

create trigger set_pos_package_inclusion_updated_at
before update on public.pos_package_inclusions
for each row execute procedure public.set_updated_at();

create trigger set_pos_discount_updated_at
before update on public.pos_discounts
for each row execute procedure public.set_updated_at();

create trigger set_pos_setting_updated_at
before update on public.pos_settings
for each row execute procedure public.set_updated_at();

create trigger set_pos_shift_updated_at
before update on public.pos_shifts
for each row execute procedure public.set_updated_at();

create trigger set_pos_cash_movement_updated_at
before update on public.pos_cash_movements
for each row execute procedure public.set_updated_at();

create trigger set_pos_bill_updated_at
before update on public.pos_bills
for each row execute procedure public.set_updated_at();

create trigger set_pos_bill_line_updated_at
before update on public.pos_bill_lines
for each row execute procedure public.set_updated_at();

create trigger set_pos_bill_payment_updated_at
before update on public.pos_bill_payments
for each row execute procedure public.set_updated_at();

create trigger set_pos_reservation_deposit_updated_at
before update on public.pos_reservation_deposits
for each row execute procedure public.set_updated_at();

commit;
