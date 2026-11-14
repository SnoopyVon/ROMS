-- POS Phase 2: server-calculated bills, discount/void approvals, and cash close.
-- Run after 004_pos_foundation_schema.sql and 005_pos_foundation_security.sql.
-- Cashier writes to bills, lines, payments, and approvals are RPC-only.
-- Sales do not mutate inventory.

begin;

alter table public.pos_bills
  add column if not exists adult_count integer not null default 0 check (adult_count >= 0),
  add column if not exists senior_count integer not null default 0 check (senior_count >= 0),
  add column if not exists kids_count integer not null default 0 check (kids_count >= 0),
  add column if not exists comped_count integer not null default 0 check (comped_count >= 0),
  add column if not exists adult_rate_snapshot numeric(12,2) not null default 0,
  add column if not exists senior_rate_snapshot numeric(12,2) not null default 0,
  add column if not exists kids_rate_snapshot numeric(12,2) not null default 0,
  add column if not exists discount_id text,
  add column if not exists discount_reason text not null default '',
  add column if not exists discount_type_snapshot text,
  add column if not exists discount_value_snapshot numeric(12,2),
  add column if not exists discount_minimum_snapshot numeric(12,2),
  add column if not exists food_revenue_total numeric(12,2) not null default 0,
  add column if not exists non_food_revenue_total numeric(12,2) not null default 0,
  add column if not exists customers_served integer not null default 0,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid,
  add column if not exists void_reason text,
  add column if not exists create_idempotency_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_bills'::regclass
      and conname = 'pos_bills_discount_id_fkey'
  ) then
    alter table public.pos_bills
      add constraint pos_bills_discount_id_fkey
      foreign key (discount_id) references public.pos_discounts(id) on delete restrict;
  end if;
end;
$$;

alter table public.pos_bill_lines
  add column if not exists is_food_revenue_snapshot boolean not null default true;

alter table public.pos_bill_payments
  add column if not exists tendered_amount numeric(12,2) not null default 0,
  add column if not exists change_amount numeric(12,2) not null default 0,
  add column if not exists idempotency_key text;

update public.pos_bill_payments
set tendered_amount = amount
where tendered_amount = 0 and amount > 0;

create table if not exists public.pos_bill_approvals (
  id text primary key default gen_random_uuid()::text,
  bill_id text not null references public.pos_bills(id) on delete cascade,
  request_type text not null check (request_type in ('full_discount', 'void')),
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  discount_id text references public.pos_discounts(id) on delete set null,
  bill_subtotal_snapshot numeric(12,2) not null default 0,
  request_reason text not null,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text not null default ''
);

alter table public.pos_bill_approvals
  add column if not exists bill_subtotal_snapshot numeric(12,2) not null default 0;
update public.pos_bill_approvals a
set bill_subtotal_snapshot = b.subtotal
from public.pos_bills b
where a.bill_id = b.id
  and a.bill_subtotal_snapshot = 0
  and b.subtotal > 0;

create index if not exists pos_bill_approvals_bill_idx
  on public.pos_bill_approvals (bill_id, requested_at desc);
create index if not exists pos_bill_approvals_status_idx
  on public.pos_bill_approvals (status, requested_at desc);
create unique index if not exists pos_bills_create_idempotency_idx
  on public.pos_bills (create_idempotency_key)
  where create_idempotency_key is not null;
create unique index if not exists pos_bill_payments_idempotency_idx
  on public.pos_bill_payments (bill_id, idempotency_key)
  where idempotency_key is not null;

-- The original Phase 1 sample tiers are corrected to the agreed cashier rates.
update public.pos_package_tiers
set code = 'ADULT', name = 'Adult', base_price = 449.00, is_active = true
where id = 'pos-package-tier-regular';
update public.pos_package_tiers
set code = 'SENIOR', name = 'Senior / PWD', base_price = 360.00, is_active = true
where id = 'pos-package-tier-premium';
update public.pos_package_tiers
set code = 'KIDS', name = 'Kids', base_price = 225.00, is_active = true
where id = 'pos-package-tier-children';

-- Correct only the original untouched sample buffet rates, not manager-edited rates.
update public.buffet_rates
set adult_rate = 449.00, child_rate = 225.00, senior_pwd_rate = 360.00
where id in (
  'RATE-ALL-DAY-WEEKDAY-20260101',
  'RATE-ALL-DAY-WEEKEND-20260101',
  'RATE-ALL-DAY-HOLIDAY-20260101'
)
and adult_rate = 499.00
and child_rate = 299.00
and senior_pwd_rate = 399.00;

insert into public.pos_package_tiers (id, code, name, default_meal_period, base_price, is_active, notes)
values ('pos-package-tier-comped', 'COMPED', 'Comped guest', 'All Day', 0.00, true,
        'Comped guests count as served and are priced at zero.')
on conflict (code) do update
set name = excluded.name, base_price = excluded.base_price, is_active = true;

insert into public.pos_charge_items
  (id, code, name, type, category, unit_price, default_quantity, is_active, is_food_revenue, is_package, requires_approval, notes)
values
  ('pos-charge-leftover', 'LEFTOVER', 'Leftover charge', 'non_food', 'Service', 200.00, 1, true, false, false, false,
   'Example non-food charge; managers may adjust this catalog price.')
on conflict (code) do nothing;

insert into public.pos_settings
  (id, setting_key, setting_value, setting_type, description, is_system)
values
  ('pos-setting-service-charge-percent', 'pos_service_charge_percent', '0', 'number',
   'Percent service charge when pos_service_charge_mode is percent.', true),
  ('pos-setting-service-charge-per-head', 'pos_service_charge_per_head', '0', 'number',
   'Per-paying-head service charge when pos_service_charge_mode is per_head.', true)
on conflict (setting_key) do nothing;

-- Keep an existing sequence as-is; a consumed bill number is never reused.
do $$
declare
  largest_existing_number bigint;
begin
  if to_regclass('public.pos_bill_number_seq') is null then
    execute 'create sequence public.pos_bill_number_seq start with 1 increment by 1 no cycle';
    select coalesce(max(substring(bill_number from '^POS-[0-9]{4}-([0-9]+)$')::bigint), 0)
    into largest_existing_number
    from public.pos_bills;
    if largest_existing_number > 0 then
      perform setval('public.pos_bill_number_seq', largest_existing_number, true);
    end if;
  end if;
end;
$$;
revoke all on sequence public.pos_bill_number_seq from public, anon, authenticated;

create or replace function public.pos_recalculate_bill(p_bill_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bill_row public.pos_bills%rowtype;
  extra_total numeric(12,2);
  extra_food numeric(12,2);
  extra_non_food numeric(12,2);
  meal_total numeric(12,2);
  subtotal_value numeric(12,2);
  service_value numeric(12,2);
  discount_value numeric(12,2);
  deposit_value numeric(12,2);
  paid_value numeric(12,2);
  food_value numeric(12,2);
  non_food_value numeric(12,2);
  service_mode text;
  service_percent numeric(12,4);
  service_per_head numeric(12,2);
begin
  select * into bill_row
  from public.pos_bills
  where id = p_bill_id
  for update;

  if not found then
    raise exception 'Bill not found.' using errcode = 'P0002';
  end if;

  meal_total := round(
    bill_row.adult_count * bill_row.adult_rate_snapshot
    + bill_row.senior_count * bill_row.senior_rate_snapshot
    + bill_row.kids_count * bill_row.kids_rate_snapshot,
    2
  );

  select
    coalesce(sum(quantity * unit_price), 0),
    coalesce(sum(food_revenue_amount), 0),
    coalesce(sum(non_food_revenue_amount), 0)
  into extra_total, extra_food, extra_non_food
  from public.pos_bill_lines
  where bill_id = bill_row.id
    and line_type = 'charge_item'
    and not is_voided;

  subtotal_value := round(meal_total + extra_total, 2);
  food_value := round(meal_total + extra_food, 2);
  non_food_value := round(extra_non_food, 2);

  select setting_value into service_mode
  from public.pos_settings
  where setting_key = 'pos_service_charge_mode';
  service_mode := coalesce(service_mode, 'none');

  if service_mode = 'percent' then
    select coalesce(nullif(setting_value, '')::numeric, 0)
    into service_percent
    from public.pos_settings
    where setting_key = 'pos_service_charge_percent';
    if coalesce(service_percent, 0) < 0 or coalesce(service_percent, 0) > 100 then
      raise exception 'Service-charge percent must be between 0 and 100.' using errcode = '22023';
    end if;
    service_value := round(subtotal_value * coalesce(service_percent, 0) / 100, 2);
  elsif service_mode = 'per_head' then
    select coalesce(nullif(setting_value, '')::numeric, 0)
    into service_per_head
    from public.pos_settings
    where setting_key = 'pos_service_charge_per_head';
    if coalesce(service_per_head, 0) < 0 or coalesce(service_per_head, 0) > 10000 then
      raise exception 'Per-head service charge must be between 0 and 10,000.' using errcode = '22023';
    end if;
    service_value := round(
      (bill_row.adult_count + bill_row.senior_count + bill_row.kids_count)
      * coalesce(service_per_head, 0),
      2
    );
  elsif service_mode = 'none' then
    service_value := 0;
  else
    raise exception 'Invalid POS service-charge mode: %.', service_mode using errcode = '22023';
  end if;

  if bill_row.discount_id is null then
    discount_value := 0;
  elsif subtotal_value < coalesce(bill_row.discount_minimum_snapshot, 0) then
    discount_value := 0;
  elsif bill_row.discount_type_snapshot = 'percent' then
    if coalesce(bill_row.discount_value_snapshot, 0) > 100 then
      raise exception 'Percent discounts cannot exceed 100%%.' using errcode = '22023';
    end if;
    discount_value := round(subtotal_value * coalesce(bill_row.discount_value_snapshot, 0) / 100, 2);
  elsif bill_row.discount_type_snapshot = 'fixed' then
    discount_value := least(subtotal_value, coalesce(bill_row.discount_value_snapshot, 0));
  elsif bill_row.discount_type_snapshot = 'waive' then
    discount_value := subtotal_value;
  else
    raise exception 'The selected discount has an invalid snapshot.' using errcode = '22023';
  end if;

  select
    coalesce(sum(amount) filter (where payment_method = 'deposit'), 0),
    coalesce(sum(amount) filter (where payment_method <> 'deposit'), 0)
  into deposit_value, paid_value
  from public.pos_bill_payments
  where bill_id = bill_row.id;

  update public.pos_bills
  set subtotal = subtotal_value,
      service_charge = service_value,
      discount_total = discount_value,
      deposit_total = deposit_value,
      paid_total = paid_value,
      balance_due = greatest(0, subtotal_value + service_value - discount_value - deposit_value - paid_value),
      food_revenue_total = food_value,
      non_food_revenue_total = non_food_value + service_value,
      customers_served = adult_count + senior_count + kids_count + comped_count
  where id = bill_row.id
  returning * into bill_row;

  return to_jsonb(bill_row);
end;
$$;

create or replace function public.pos_save_bill(
  p_bill_id text default null,
  p_customer_name text default 'Walk-in',
  p_notes text default '',
  p_reservation_id text default null,
  p_adult_count integer default 0,
  p_senior_count integer default 0,
  p_kids_count integer default 0,
  p_comped_count integer default 0,
  p_discount_id text default null,
  p_discount_reason text default '',
  p_extra_lines jsonb default '[]'::jsonb,
  p_initial_deposit numeric default 0,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bill_row public.pos_bills%rowtype;
  discount_row public.pos_discounts%rowtype;
  charge_row public.pos_charge_items%rowtype;
  line_row public.pos_bill_lines%rowtype;
  approval_row public.pos_bill_approvals%rowtype;
  extra_row jsonb;
  line_id_value text;
  charge_id_value text;
  quantity_value numeric(12,2);
  kept_line_ids text[] := array[]::text[];
  adult_rate numeric(12,2);
  senior_rate numeric(12,2);
  kids_rate numeric(12,2);
  full_discount boolean;
  totals jsonb;
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Receptionist']) then
    raise exception 'Your role cannot create or edit POS bills.' using errcode = '42501';
  end if;
  if auth.uid() is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;
  if p_adult_count < 0 or p_senior_count < 0 or p_kids_count < 0 or p_comped_count < 0
    or p_adult_count is null or p_senior_count is null or p_kids_count is null or p_comped_count is null
    or p_adult_count + p_senior_count + p_kids_count + p_comped_count > 1000 then
    raise exception 'Head counts must be non-negative and total no more than 1,000.' using errcode = '22023';
  end if;
  if p_initial_deposit < 0 then
    raise exception 'Deposit amount cannot be negative.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Bill notes cannot exceed 1,000 characters.' using errcode = '22023';
  end if;
  if length(coalesce(p_customer_name, '')) > 160 then
    raise exception 'Customer name cannot exceed 160 characters.' using errcode = '22023';
  end if;
  if coalesce(p_initial_deposit, 0) <> round(coalesce(p_initial_deposit, 0), 2) then
    raise exception 'Deposit amount cannot include fractions of a cent.' using errcode = '22023';
  end if;
  if length(coalesce(p_idempotency_key, '')) > 200 then
    raise exception 'Idempotency key cannot exceed 200 characters.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_extra_lines, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_extra_lines, '[]'::jsonb)) > 100 then
    raise exception 'Extra charges must be an array of no more than 100 lines.' using errcode = '22023';
  end if;
  if p_discount_id is not null and length(trim(coalesce(p_discount_reason, ''))) = 0 then
    raise exception 'A reason is required for every discount.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_discount_reason, ''))) > 500 then
    raise exception 'Discount reason cannot exceed 500 characters.' using errcode = '22023';
  end if;

  if p_bill_id is null then
    if length(trim(coalesce(p_idempotency_key, ''))) = 0 then
      raise exception 'A create idempotency key is required.' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
    select * into bill_row
    from public.pos_bills
    where create_idempotency_key = p_idempotency_key;

    if found then
      return jsonb_build_object(
        'bill', to_jsonb(bill_row),
        'already_created', true,
        'lines', coalesce((
          select jsonb_agg(to_jsonb(x) order by x.created_at)
          from public.pos_bill_lines x where x.bill_id = bill_row.id
        ), '[]'::jsonb)
      );
    end if;

    select base_price into adult_rate from public.pos_package_tiers where code = 'ADULT' and is_active;
    select base_price into senior_rate from public.pos_package_tiers where code = 'SENIOR' and is_active;
    select base_price into kids_rate from public.pos_package_tiers where code = 'KIDS' and is_active;
    if adult_rate is null or senior_rate is null or kids_rate is null then
      raise exception 'The Adult, Senior/PWD, and Kids POS rates must be active.' using errcode = '55000';
    end if;

    insert into public.pos_bills (
      id, bill_number, reservation_id, customer_name, notes, status, printed_title,
      created_by, adult_rate_snapshot, senior_rate_snapshot, kids_rate_snapshot,
      create_idempotency_key
    ) values (
      gen_random_uuid()::text,
      'POS-' || to_char(current_date, 'YYYY') || '-' || nextval('public.pos_bill_number_seq')::text,
      p_reservation_id,
      coalesce(nullif(trim(p_customer_name), ''), 'Walk-in'),
      nullif(trim(coalesce(p_notes, '')), ''),
      'Open',
      'BILLING STATEMENT (not an official receipt)',
      auth.uid(),
      adult_rate, senior_rate, kids_rate,
      p_idempotency_key
    )
    returning * into bill_row;
  else
    select * into bill_row
    from public.pos_bills
    where id = p_bill_id
    for update;
    if not found then
      raise exception 'Bill not found.' using errcode = 'P0002';
    end if;
    if bill_row.status <> 'Open' then
      raise exception 'Only open bills can be edited.' using errcode = '55000';
    end if;
    if public.current_app_role() = 'Receptionist' and bill_row.created_by is distinct from auth.uid() then
      raise exception 'Receptionists can edit only bills they created.' using errcode = '42501';
    end if;
    if p_initial_deposit > 0 then
      raise exception 'A deposit can be recorded only when the bill is created.' using errcode = '22023';
    end if;
    update public.pos_bills
    set customer_name = coalesce(nullif(trim(p_customer_name), ''), 'Walk-in'),
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        reservation_id = p_reservation_id
    where id = bill_row.id
    returning * into bill_row;
  end if;

  update public.pos_bills
  set adult_count = p_adult_count,
      senior_count = p_senior_count,
      kids_count = p_kids_count,
      comped_count = p_comped_count,
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = bill_row.id;

  if p_discount_id is null then
    update public.pos_bills
    set discount_id = null, discount_reason = '', discount_type_snapshot = null,
        discount_value_snapshot = null, discount_minimum_snapshot = null
    where id = bill_row.id;
  elsif p_discount_id is distinct from bill_row.discount_id
    or bill_row.discount_type_snapshot is null then
    select * into discount_row
    from public.pos_discounts
    where id = p_discount_id and is_active and applies_to = 'bill';
    if not found then
      raise exception 'The selected bill discount is not active or does not apply to bills.' using errcode = '22023';
    end if;
    if discount_row.discount_type = 'percent' and discount_row.value > 100 then
      raise exception 'Percent discounts cannot exceed 100%%.' using errcode = '22023';
    end if;
    update public.pos_bills
    set discount_id = discount_row.id,
        discount_reason = trim(p_discount_reason),
        discount_type_snapshot = discount_row.discount_type,
        discount_value_snapshot = discount_row.value,
        discount_minimum_snapshot = discount_row.minimum_amount
    where id = bill_row.id;
  else
    update public.pos_bills
    set discount_reason = trim(p_discount_reason)
    where id = bill_row.id;
  end if;

  for extra_row in select value from jsonb_array_elements(coalesce(p_extra_lines, '[]'::jsonb))
  loop
    line_id_value := nullif(trim(extra_row->>'line_id'), '');
    charge_id_value := nullif(trim(extra_row->>'charge_item_id'), '');
    begin
      quantity_value := (extra_row->>'quantity')::numeric(12,2);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Extra charge quantity must be a valid number.' using errcode = '22023';
    end;
    if quantity_value is null or quantity_value <= 0 or quantity_value > 10000 then
      raise exception 'Extra charge quantity must be greater than zero and no more than 10,000.' using errcode = '22023';
    end if;

    if line_id_value is not null then
      if line_id_value = any(kept_line_ids) then
        raise exception 'An extra charge line was submitted more than once.' using errcode = '22023';
      end if;
      select * into line_row
      from public.pos_bill_lines
      where id = line_id_value and bill_id = bill_row.id and line_type = 'charge_item'
      for update;
      if not found then
        raise exception 'An extra charge line does not belong to this bill.' using errcode = '42501';
      end if;
      if charge_id_value is not null and charge_id_value <> line_row.charge_item_id then
        raise exception 'Existing extra charge items cannot be replaced in place.' using errcode = '22023';
      end if;
      update public.pos_bill_lines
      set quantity = quantity_value,
          food_revenue_amount = case when is_food_revenue_snapshot then round(quantity_value * unit_price, 2) else 0 end,
          non_food_revenue_amount = case when is_food_revenue_snapshot then 0 else round(quantity_value * unit_price, 2) end
      where id = line_row.id;
      kept_line_ids := array_append(kept_line_ids, line_row.id);
    else
      if charge_id_value is null then
        raise exception 'Choose a charge item for every extra line.' using errcode = '22023';
      end if;
      select * into charge_row
      from public.pos_charge_items
      where id = charge_id_value
        and is_active
        and type in ('food', 'non_food', 'other')
        and not is_package;
      if not found then
        raise exception 'The selected extra charge is not active or is not a billable add-on.' using errcode = '22023';
      end if;
      insert into public.pos_bill_lines (
        id, bill_id, charge_item_id, description, quantity, unit_price,
        line_type, food_revenue_amount, non_food_revenue_amount,
        is_food_revenue_snapshot, created_by
      ) values (
        gen_random_uuid()::text, bill_row.id, charge_row.id, charge_row.name,
        quantity_value, charge_row.unit_price, 'charge_item',
        case when charge_row.is_food_revenue then round(quantity_value * charge_row.unit_price, 2) else 0 end,
        case when charge_row.is_food_revenue then 0 else round(quantity_value * charge_row.unit_price, 2) end,
        charge_row.is_food_revenue, auth.uid()
      )
      returning * into line_row;
      kept_line_ids := array_append(kept_line_ids, line_row.id);
    end if;
  end loop;

  delete from public.pos_bill_lines
  where bill_id = bill_row.id
    and line_type = 'charge_item'
    and not (id = any(kept_line_ids));

  totals := public.pos_recalculate_bill(bill_row.id);
  select * into bill_row from public.pos_bills where id = bill_row.id;

  if p_bill_id is null and coalesce(p_initial_deposit, 0) > 0 then
    if p_initial_deposit > bill_row.subtotal + bill_row.service_charge - bill_row.discount_total then
      raise exception 'Deposit cannot exceed the bill amount before payments.' using errcode = '22023';
    end if;
    insert into public.pos_bill_payments (
      id, bill_id, payment_method, amount, tendered_amount, change_amount,
      paid_by, idempotency_key
    ) values (
      gen_random_uuid()::text, bill_row.id, 'deposit', p_initial_deposit,
      p_initial_deposit, 0, auth.uid(), 'initial-deposit:' || bill_row.id
    );
    totals := public.pos_recalculate_bill(bill_row.id);
    select * into bill_row from public.pos_bills where id = bill_row.id;
  end if;

  full_discount := bill_row.discount_id is not null
    and (
      bill_row.discount_type_snapshot = 'waive'
      or (bill_row.subtotal > 0 and bill_row.discount_total >= bill_row.subtotal)
    );

  if full_discount then
    update public.pos_bill_approvals
    set status = 'Cancelled', decided_by = auth.uid(), decided_at = now(),
        decision_reason = 'Superseded by a changed discount request.'
    where bill_id = bill_row.id
      and request_type = 'full_discount'
      and status = 'Pending'
      and (
        discount_id is distinct from bill_row.discount_id
        or request_reason <> bill_row.discount_reason
        or bill_subtotal_snapshot is distinct from bill_row.subtotal
      );

    select * into approval_row
    from public.pos_bill_approvals
    where bill_id = bill_row.id
      and request_type = 'full_discount'
      and status = 'Pending'
      and discount_id = bill_row.discount_id
      and request_reason = bill_row.discount_reason
      and bill_subtotal_snapshot = bill_row.subtotal
    order by requested_at desc
    limit 1;

    if not found then
      select * into approval_row
      from public.pos_bill_approvals
      where bill_id = bill_row.id
        and request_type = 'full_discount'
        and status = 'Approved'
        and discount_id = bill_row.discount_id
        and request_reason = bill_row.discount_reason
        and bill_subtotal_snapshot = bill_row.subtotal
      order by decided_at desc
      limit 1;
    end if;

    if not found then
      insert into public.pos_bill_approvals (
        id, bill_id, request_type, status, discount_id, bill_subtotal_snapshot,
        request_reason, requested_by
      ) values (
        gen_random_uuid()::text, bill_row.id, 'full_discount', 'Pending',
        bill_row.discount_id, bill_row.subtotal, bill_row.discount_reason, auth.uid()
      )
      returning * into approval_row;
    end if;
  else
    update public.pos_bill_approvals
    set status = 'Cancelled', decided_by = auth.uid(), decided_at = now(),
        decision_reason = 'Bill no longer has a full-discount request.'
    where bill_id = bill_row.id
      and request_type = 'full_discount'
      and status = 'Pending';
    approval_row := null;
  end if;

  return jsonb_build_object(
    'bill', to_jsonb(bill_row),
    'totals', totals,
    'approval', to_jsonb(approval_row)
  );
end;
$$;

create or replace function public.pos_decide_bill_approval(
  p_approval_id text,
  p_decision text,
  p_decision_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  approval_row public.pos_bill_approvals%rowtype;
  bill_row public.pos_bills%rowtype;
  approval_bill_id text;
  decision_value text := lower(trim(coalesce(p_decision, '')));
begin
  if not public.has_app_role(array['Administrator', 'Manager']) then
    raise exception 'Only a Manager or Administrator can decide POS approvals.' using errcode = '42501';
  end if;
  if decision_value not in ('approve', 'reject') then
    raise exception 'Choose approve or reject.' using errcode = '22023';
  end if;
  if decision_value = 'reject' and length(trim(coalesce(p_decision_reason, ''))) = 0 then
    raise exception 'A reason is required when rejecting an approval.' using errcode = '22023';
  end if;

  select bill_id into approval_bill_id
  from public.pos_bill_approvals
  where id = p_approval_id;
  if not found then
    raise exception 'Approval request not found.' using errcode = 'P0002';
  end if;

  select * into bill_row
  from public.pos_bills
  where id = approval_bill_id
  for update;
  if not found then
    raise exception 'Bill not found.' using errcode = 'P0002';
  end if;

  select * into approval_row
  from public.pos_bill_approvals
  where id = p_approval_id
  for update;
  if not found then
    raise exception 'Approval request not found.' using errcode = 'P0002';
  end if;
  if approval_row.requested_by = auth.uid() then
    raise exception 'You cannot approve or reject your own request.' using errcode = '42501';
  end if;
  if approval_row.status <> 'Pending' then
    if (approval_row.status = 'Approved' and decision_value = 'approve')
      or (approval_row.status = 'Rejected' and decision_value = 'reject') then
      return jsonb_build_object('approval', to_jsonb(approval_row), 'already_decided', true);
    end if;
    raise exception 'This approval request has already been decided.' using errcode = '55000';
  end if;
  if bill_row.status <> 'Open' then
    raise exception 'The bill is no longer open.' using errcode = '55000';
  end if;

  if approval_row.bill_id is distinct from bill_row.id then
    raise exception 'Approval request does not match the bill.' using errcode = '55000';
  end if;
  if approval_row.request_type = 'full_discount'
    and (bill_row.discount_id is distinct from approval_row.discount_id
      or bill_row.discount_reason is distinct from approval_row.request_reason
      or bill_row.subtotal is distinct from approval_row.bill_subtotal_snapshot) then
    raise exception 'This discount request is no longer current.' using errcode = '55000';
  end if;

  update public.pos_bill_approvals
  set status = case when decision_value = 'approve' then 'Approved' else 'Rejected' end,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_reason = case when decision_value = 'approve'
        then coalesce(nullif(trim(p_decision_reason), ''), 'Approved')
        else trim(p_decision_reason)
      end
  where id = approval_row.id
  returning * into approval_row;

  if approval_row.request_type = 'void' and decision_value = 'approve' then
    update public.pos_bills
    set status = 'Voided',
        voided_by = auth.uid(),
        voided_at = now(),
        void_reason = approval_row.request_reason
    where id = bill_row.id
    returning * into bill_row;
    update public.pos_bill_approvals
    set status = 'Cancelled',
        decided_by = auth.uid(),
        decided_at = now(),
        decision_reason = 'Bill was voided.'
    where bill_id = bill_row.id
      and status = 'Pending';
  end if;

  return jsonb_build_object(
    'approval', to_jsonb(approval_row),
    'bill', to_jsonb(bill_row)
  );
end;
$$;

create or replace function public.pos_request_bill_void(
  p_bill_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bill_row public.pos_bills%rowtype;
  approval_row public.pos_bill_approvals%rowtype;
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Receptionist']) then
    raise exception 'Your role cannot request a bill void.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 or length(trim(p_reason)) > 500 then
    raise exception 'Enter a void reason of 1 to 500 characters.' using errcode = '22023';
  end if;

  select * into bill_row
  from public.pos_bills
  where id = p_bill_id
  for update;
  if not found then
    raise exception 'Bill not found.' using errcode = 'P0002';
  end if;
  if bill_row.status <> 'Open' then
    raise exception 'Only open bills can be submitted for void approval.' using errcode = '55000';
  end if;
  if bill_row.deposit_total > 0 or bill_row.paid_total > 0 then
    raise exception 'Bills with applied payments cannot be voided in Phase 2.' using errcode = '55000';
  end if;
  if public.current_app_role() = 'Receptionist' and bill_row.created_by is distinct from auth.uid() then
    raise exception 'Receptionists can request voids only for bills they created.' using errcode = '42501';
  end if;

  select * into approval_row
  from public.pos_bill_approvals
  where bill_id = bill_row.id
    and request_type = 'void'
    and status = 'Pending'
  order by requested_at desc
  limit 1;
  if not found then
    insert into public.pos_bill_approvals (
      id, bill_id, request_type, status, request_reason, requested_by
    ) values (
      gen_random_uuid()::text, bill_row.id, 'void', 'Pending', trim(p_reason), auth.uid()
    )
    returning * into approval_row;
  end if;

  return jsonb_build_object('approval', to_jsonb(approval_row), 'bill', to_jsonb(bill_row));
end;
$$;

create or replace function public.pos_close_bill(
  p_bill_id text,
  p_tendered_amount numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bill_row public.pos_bills%rowtype;
  payment_row public.pos_bill_payments%rowtype;
  totals jsonb;
  full_discount boolean;
  due_value numeric(12,2);
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Receptionist']) then
    raise exception 'Your role cannot close POS bills.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) = 0 then
    raise exception 'A payment idempotency key is required.' using errcode = '22023';
  end if;
  if length(p_idempotency_key) > 200 then
    raise exception 'Idempotency key cannot exceed 200 characters.' using errcode = '22023';
  end if;
  if p_tendered_amount is null or p_tendered_amount < 0 then
    raise exception 'Tendered cash cannot be negative.' using errcode = '22023';
  end if;
  if p_tendered_amount <> round(p_tendered_amount, 2) then
    raise exception 'Tendered cash cannot include fractions of a cent.' using errcode = '22023';
  end if;

  select * into bill_row
  from public.pos_bills
  where id = p_bill_id
  for update;
  if not found then
    raise exception 'Bill not found.' using errcode = 'P0002';
  end if;

  if bill_row.status = 'Closed' then
    select * into payment_row
    from public.pos_bill_payments
    where bill_id = bill_row.id and payment_method = 'cash'
    order by paid_at desc
    limit 1;
    return jsonb_build_object(
      'bill', to_jsonb(bill_row),
      'payment', to_jsonb(payment_row),
      'already_closed', true
    );
  end if;
  if bill_row.status <> 'Open' then
    raise exception 'A voided bill cannot be closed.' using errcode = '55000';
  end if;
  if public.current_app_role() = 'Receptionist' and bill_row.created_by is distinct from auth.uid() then
    raise exception 'Receptionists can close only bills they created.' using errcode = '42501';
  end if;

  totals := public.pos_recalculate_bill(bill_row.id);
  select * into bill_row from public.pos_bills where id = bill_row.id;
  due_value := bill_row.balance_due;

  full_discount := bill_row.discount_id is not null
    and (
      bill_row.discount_type_snapshot = 'waive'
      or (bill_row.subtotal > 0 and bill_row.discount_total >= bill_row.subtotal)
    );
  if full_discount and not exists (
    select 1 from public.pos_bill_approvals
    where bill_id = bill_row.id
      and request_type = 'full_discount'
      and status = 'Approved'
      and discount_id = bill_row.discount_id
      and request_reason = bill_row.discount_reason
      and bill_subtotal_snapshot = bill_row.subtotal
  ) then
    raise exception 'A Manager or Administrator must approve the full discount before closing.' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.pos_bill_approvals
    where bill_id = bill_row.id and request_type = 'void' and status = 'Pending'
  ) then
    raise exception 'A pending void request must be resolved before closing.' using errcode = '55000';
  end if;
  if p_tendered_amount < due_value then
    raise exception 'Tendered cash is less than the balance due (%).', due_value using errcode = '22023';
  end if;
  if due_value = 0 and p_tendered_amount > 0 then
    raise exception 'No cash is due; tendered cash must be zero.' using errcode = '22023';
  end if;

  if due_value > 0 then
    insert into public.pos_bill_payments (
      id, bill_id, payment_method, amount, tendered_amount, change_amount,
      paid_by, idempotency_key
    ) values (
      gen_random_uuid()::text, bill_row.id, 'cash', due_value, p_tendered_amount,
      p_tendered_amount - due_value, auth.uid(), p_idempotency_key
    )
    on conflict (bill_id, idempotency_key) where idempotency_key is not null do nothing
    returning * into payment_row;

    if not found then
      select * into payment_row
      from public.pos_bill_payments
      where bill_id = bill_row.id and idempotency_key = p_idempotency_key;
      if not found then
        raise exception 'Payment idempotency key was already used.' using errcode = '23505';
      end if;
    end if;
  else
    payment_row := null;
  end if;

  totals := public.pos_recalculate_bill(bill_row.id);
  update public.pos_bills
  set status = 'Closed', closed_at = now(), closed_by = auth.uid()
  where id = bill_row.id
  returning * into bill_row;

  return jsonb_build_object(
    'bill', to_jsonb(bill_row),
    'payment', to_jsonb(payment_row),
    'totals', totals,
    'already_closed', false
  );
end;
$$;

-- Bill data is read-only to browser clients. All changes go through the checked RPCs.
alter table public.pos_bills enable row level security;
alter table public.pos_bill_lines enable row level security;
alter table public.pos_bill_payments enable row level security;
alter table public.pos_bill_approvals enable row level security;

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

create policy pos_bills_phase2_select on public.pos_bills
  for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));

create policy pos_bill_lines_phase2_select on public.pos_bill_lines
  for select to authenticated
  using (
    public.has_app_role(array['Administrator', 'Manager', 'Receptionist'])
    and exists (select 1 from public.pos_bills b where b.id = bill_id)
  );

create policy pos_bill_payments_phase2_select on public.pos_bill_payments
  for select to authenticated
  using (
    public.has_app_role(array['Administrator', 'Manager', 'Receptionist'])
    and exists (select 1 from public.pos_bills b where b.id = bill_id)
  );

create policy pos_bill_approvals_phase2_select on public.pos_bill_approvals
  for select to authenticated
  using (
    public.has_app_role(array['Administrator', 'Manager'])
    or (public.has_app_role(array['Receptionist']) and requested_by = auth.uid())
  );

drop policy if exists pos_settings_admin_full on public.pos_settings;
create policy pos_settings_admin_full on public.pos_settings
  for all to authenticated
  using (public.has_app_role(array['Administrator']))
  with check (public.has_app_role(array['Administrator']));

revoke all on public.pos_bills, public.pos_bill_lines, public.pos_bill_payments,
  public.pos_bill_approvals from public, anon, authenticated;
grant select on public.pos_bills, public.pos_bill_lines, public.pos_bill_payments,
  public.pos_bill_approvals to authenticated;

revoke all on function public.pos_recalculate_bill(text) from public, anon, authenticated;
revoke all on function public.pos_save_bill(text, text, text, text, integer, integer, integer, integer, text, text, jsonb, numeric, text) from public, anon;
revoke all on function public.pos_decide_bill_approval(text, text, text) from public, anon;
revoke all on function public.pos_request_bill_void(text, text) from public, anon;
revoke all on function public.pos_close_bill(text, numeric, text) from public, anon;
grant execute on function public.pos_save_bill(text, text, text, text, integer, integer, integer, integer, text, text, jsonb, numeric, text) to authenticated;
grant execute on function public.pos_decide_bill_approval(text, text, text) to authenticated;
grant execute on function public.pos_request_bill_void(text, text) to authenticated;
grant execute on function public.pos_close_bill(text, numeric, text) to authenticated;

commit;
