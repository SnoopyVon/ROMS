-- Verify public package discovery, package persistence, and server-derived quantity.
-- All reservation rows and rate-limit entries are rolled back.

begin;

do $$
declare
  package_item public.pos_charge_items%rowtype;
  payload_value jsonb;
  reference_value text;
  reservation_row public.reservations%rowtype;
  rejected boolean := false;
  public_email text := 'package-' || replace(gen_random_uuid()::text, '-', '') || '@example.test';
  public_phone text := '09' || lpad((floor(random() * 100000000))::bigint::text, 8, '0');
  public_ip text := '198.51.100.' || (floor(random() * 254) + 1)::integer::text;
begin
  select *
    into package_item
  from public.pos_charge_items
  where type = 'package'
    and is_package
    and is_active
  order by name
  limit 1;
  if not found then
    raise exception 'FAIL: no active reservation package is configured.';
  end if;

  if not exists (
    select 1
    from public.public_list_reservation_packages() as available_package
    where available_package.id = package_item.id
      and available_package.name = package_item.name
      and available_package.unit_price = package_item.unit_price
  ) then
    raise exception 'FAIL: public package listing omitted an active package or its catalog price.';
  end if;

  perform set_config(
    'request.headers',
    jsonb_build_object('x-forwarded-for', public_ip)::text,
    true
  );
  payload_value := jsonb_build_object(
    'name', 'Package acceptance guest',
    'email', public_email,
    'phone', public_phone,
    'reservation_date', (current_date + 1)::text,
    'reservation_time', '11:00 AM',
    'adults', 3,
    'senior_pwd_count', 1,
    'children', 2,
    'guests', 6,
    'package_charge_item_id', package_item.id,
    'package_unit_price', package_item.unit_price,
    'website', ''
  );
  reference_value := public.public_create_reservation(payload_value);
  select *
    into reservation_row
  from public.reservations
  where id = reference_value;
  if not found
     or reservation_row.package_charge_item_id is distinct from package_item.id
     or reservation_row.package_tier_id is not null
     or reservation_row.package_pax_count is distinct from 6
     or reservation_row.guests is distinct from 6
     or reservation_row.source is distinct from 'Website'
     or reservation_row.status is distinct from 'Pending' then
    raise exception 'FAIL: selected package or validated guest quantity was not persisted correctly.';
  end if;

  rejected := false;
  begin
    perform public.public_create_reservation(
      payload_value || jsonb_build_object(
        'name', 'Invalid package acceptance guest',
        'email', 'invalid-' || replace(gen_random_uuid()::text, '-', '') || '@example.test',
        'package_charge_item_id', 'missing-package-' || replace(gen_random_uuid()::text, '-', '')
      )
    );
  exception when others then
    rejected := position('selected reservation package is no longer available' in lower(sqlerrm)) > 0;
  end;
  if not rejected then
    raise exception 'FAIL: an inactive or unknown reservation package was accepted.';
  end if;
  if exists (
    select 1
    from public.reservations
    where name = 'Invalid package acceptance guest'
  ) then
    raise exception 'FAIL: invalid package selection left a reservation behind.';
  end if;

  rejected := false;
  begin
    perform public.public_create_reservation(
      payload_value || jsonb_build_object(
        'name', 'Stale package price acceptance guest',
        'email', 'stale-price-' || replace(gen_random_uuid()::text, '-', '') || '@example.test',
        'package_unit_price', package_item.unit_price + 1
      )
    );
  exception when others then
    rejected := position('reservation package price has changed' in lower(sqlerrm)) > 0;
  end;
  if not rejected then
    raise exception 'FAIL: stale package catalog pricing was accepted.';
  end if;
  if exists (
    select 1
    from public.reservations
    where name = 'Stale package price acceptance guest'
  ) then
    raise exception 'FAIL: stale package price left a reservation behind.';
  end if;
end;
$$;

rollback;
