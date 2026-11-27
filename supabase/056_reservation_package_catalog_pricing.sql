-- Reservation package prices come from the selected catalog item.
-- Guest counts on the reservation determine the package quantity.
begin;

alter table public.pos_walkin_package_overrides
  alter column package_tier_id drop not null;

alter table public.reservations
  drop constraint if exists reservations_package_booking_check;
alter table public.reservations
  add constraint reservations_package_booking_check check (
    (package_charge_item_id is null and package_tier_id is null and package_pax_count is null)
    or (package_charge_item_id is not null
      and package_pax_count is not null and package_pax_count > 0)
  );

create or replace function public.guard_walkin_reservation_package()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  package_changed boolean;
  walkin_related boolean;
  override_reason text;
begin
  if tg_op = 'INSERT' then
    package_changed := new.package_charge_item_id is not null
      or new.package_tier_id is not null
      or new.package_pax_count is not null;
    walkin_related := new.type = 'Walk-in';
  else
    package_changed := row(new.package_charge_item_id, new.package_tier_id, new.package_pax_count)
      is distinct from row(old.package_charge_item_id, old.package_tier_id, old.package_pax_count)
      or (
        new.type is distinct from old.type
        and (new.package_charge_item_id is not null or old.package_charge_item_id is not null)
      );
    walkin_related := new.type = 'Walk-in' or old.type = 'Walk-in';
  end if;

  if package_changed and walkin_related then
    if auth.uid() is null
      or not public.has_app_role(array['Administrator', 'Manager']) then
      raise exception 'Walk-ins cannot have event packages without a Manager or Administrator override.'
        using errcode = '42501';
    end if;
    if new.type = 'Walk-in' and new.package_charge_item_id is not null then
      override_reason := btrim(coalesce(new.package_override_reason, ''));
      if length(override_reason) not between 10 and 500 then
        raise exception 'A package override reason between 10 and 500 characters is required.'
          using errcode = '22023';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.audit_walkin_reservation_package_override()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  package_changed boolean;
begin
  if tg_op = 'INSERT' then
    package_changed := true;
  else
    package_changed := new.type is distinct from old.type
      or row(new.package_charge_item_id, new.package_tier_id, new.package_pax_count)
        is distinct from row(old.package_charge_item_id, old.package_tier_id, old.package_pax_count);
  end if;

  if new.type = 'Walk-in'
    and new.package_charge_item_id is not null
    and package_changed then
    insert into public.pos_walkin_package_overrides (
      reservation_id, package_charge_item_id, package_tier_id,
      package_pax_count, overridden_by, reason
    ) values (
      new.id, new.package_charge_item_id, new.package_tier_id,
      new.package_pax_count, auth.uid(), btrim(new.package_override_reason)
    );
  end if;
  return new;
end;
$$;

create or replace function public.guard_walkin_bill_package_line()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reservation_row public.reservations%rowtype;
  reservation_id_value text;
begin
  if new.line_type <> 'package' or new.is_voided then
    return new;
  end if;

  select b.reservation_id into reservation_id_value
  from public.pos_bills b where b.id = new.bill_id;
  if reservation_id_value is null then
    raise exception 'Package lines require a reservation with an approved package booking.'
      using errcode = '42501';
  end if;

  select * into reservation_row
  from public.reservations r where r.id = reservation_id_value;
  if reservation_row.type = 'Walk-in'
    and (
      reservation_row.package_charge_item_id is distinct from new.charge_item_id
      or reservation_row.package_tier_id is distinct from new.package_tier_id
      or not exists (
        select 1
        from public.pos_walkin_package_overrides o
        where o.reservation_id = reservation_row.id
          and o.package_charge_item_id = new.charge_item_id
          and o.package_tier_id is not distinct from new.package_tier_id
      )
    ) then
    raise exception 'A package line on a Walk-in requires a Manager or Administrator override with a recorded reason.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.pos_save_bill_phase3(
  p_bill_id text,
  p_customer_name text,
  p_notes text,
  p_reservation_id text,
  p_adult_count integer,
  p_senior_count integer,
  p_kids_count integer,
  p_comped_count integer,
  p_discount_id text,
  p_discount_reason text,
  p_extra_lines jsonb,
  p_idempotency_key text,
  p_table_id text,
  p_charge_extra_pax boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  shift_row public.pos_shifts%rowtype;
  reservation_row public.reservations%rowtype;
  bill_row public.pos_bills%rowtype;
  existing_reservation_id text;
  package_item public.pos_charge_items%rowtype;
  extra_rate numeric(12,2);
  actual_pax integer;
  extra_pax integer;
  bill_result jsonb;
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Receptionist'])
    or auth.uid() is null then
    raise exception 'Your role cannot create or edit POS bills.' using errcode = '42501';
  end if;

  select * into shift_row from public.pos_shifts
  where opened_by = auth.uid() and status = 'Open' for update;
  if not found then
    raise exception 'Open your cashier shift before creating or editing a bill.'
      using errcode = '55000';
  end if;

  if p_reservation_id is not null then
    select * into reservation_row from public.reservations
    where id = p_reservation_id for update;
    if not found then raise exception 'Reservation not found.' using errcode = 'P0002'; end if;
    if reservation_row.status <> 'Seated' and reservation_row.status <> 'Completed' then
      raise exception 'A POS bill can be opened only for a seated reservation.'
        using errcode = '55000';
    end if;
  end if;
  if p_bill_id is not null then
    select reservation_id into existing_reservation_id
    from public.pos_bills
    where id = p_bill_id
    for update;
    if not found then raise exception 'Bill not found.' using errcode = 'P0002'; end if;
    if existing_reservation_id is distinct from p_reservation_id then
      raise exception 'A saved bill cannot be reassigned to a different reservation.'
        using errcode = '22023';
    end if;
  end if;

  bill_result := public.pos_save_bill(
    p_bill_id => p_bill_id,
    p_customer_name => p_customer_name,
    p_notes => p_notes,
    p_reservation_id => p_reservation_id,
    p_adult_count => p_adult_count,
    p_senior_count => p_senior_count,
    p_kids_count => p_kids_count,
    p_comped_count => p_comped_count,
    p_discount_id => p_discount_id,
    p_discount_reason => p_discount_reason,
    p_extra_lines => coalesce(p_extra_lines, '[]'::jsonb),
    p_initial_deposit => 0,
    p_idempotency_key => p_idempotency_key
  );
  select * into bill_row from public.pos_bills
  where id = bill_result->'bill'->>'id' for update;

  if bill_row.shift_id is not null and bill_row.shift_id <> shift_row.id then
    raise exception 'This bill belongs to a different cashier shift.' using errcode = '42501';
  end if;
  if bill_row.shift_id is null then
    update public.pos_bills
    set shift_id = shift_row.id,
        table_id = coalesce(p_table_id, reservation_row.table_id)
    where id = bill_row.id returning * into bill_row;
  elsif p_table_id is not null and bill_row.table_id is distinct from p_table_id then
    update public.pos_bills set table_id = p_table_id
    where id = bill_row.id returning * into bill_row;
  end if;

  if p_reservation_id is not null and reservation_row.package_charge_item_id is not null
    and not exists (
      select 1 from public.pos_bill_lines
      where bill_id = bill_row.id and line_type = 'package' and not is_voided
    ) then
    select * into package_item from public.pos_charge_items
    where id = reservation_row.package_charge_item_id
      and type = 'package' and is_package and is_active;
    if not found then raise exception 'The reservation package is no longer active.' using errcode = '55000'; end if;

    insert into public.pos_bill_lines (
      id, bill_id, charge_item_id, package_tier_id, description, quantity, unit_price,
      line_type, food_revenue_amount, non_food_revenue_amount,
      is_food_revenue_snapshot, created_by
    ) values (
      gen_random_uuid()::text, bill_row.id, package_item.id, reservation_row.package_tier_id,
      package_item.name, reservation_row.package_pax_count, package_item.unit_price, 'package',
      case when package_item.is_food_revenue
        then round(reservation_row.package_pax_count * package_item.unit_price, 2) else 0 end,
      case when not package_item.is_food_revenue
        then round(reservation_row.package_pax_count * package_item.unit_price, 2) else 0 end,
      package_item.is_food_revenue, auth.uid()
    );

    actual_pax := coalesce(
      nullif(reservation_row.actual_covers, 0),
      reservation_row.guests
    );
    extra_pax := greatest(0, actual_pax - reservation_row.package_pax_count);
    if extra_pax > 0 and coalesce(p_charge_extra_pax, false) then
      select coalesce(nullif(setting_value, '')::numeric, 0)
      into extra_rate from public.pos_settings where setting_key = 'pos_extra_pax_rate';
      if coalesce(extra_rate, 0) <= 0 then
        raise exception 'No extra-pax rate is configured; save without the extra-pax charge or ask an Administrator to set one.'
          using errcode = '55000';
      end if;
      insert into public.pos_bill_lines (
        id, bill_id, charge_item_id, package_tier_id, description, quantity, unit_price,
        line_type, food_revenue_amount, non_food_revenue_amount,
        is_food_revenue_snapshot, created_by
      ) values (
        gen_random_uuid()::text, bill_row.id, package_item.id, reservation_row.package_tier_id,
        'Extra pax · ' || package_item.name, extra_pax, extra_rate, 'package',
        case when package_item.is_food_revenue then round(extra_pax * extra_rate, 2) else 0 end,
        case when not package_item.is_food_revenue then round(extra_pax * extra_rate, 2) else 0 end,
        package_item.is_food_revenue, auth.uid()
      );
    end if;
  end if;

  bill_result := jsonb_build_object(
    'bill', public.pos_recalculate_bill(bill_row.id),
    'lines', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at)
      from public.pos_bill_lines x where x.bill_id = bill_row.id
    ), '[]'::jsonb),
    'already_created', coalesce((bill_result->>'already_created')::boolean, false)
  );
  return bill_result;
end;
$$;

commit;
