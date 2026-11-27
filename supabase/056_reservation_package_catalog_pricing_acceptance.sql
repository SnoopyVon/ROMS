-- Read-only verification for 056_reservation_package_catalog_pricing.sql.
do $$
declare
  booking_check text;
  walkin_tier_nullable text;
  phase3_definition text;
begin
  select pg_get_constraintdef(oid)
    into booking_check
  from pg_constraint
  where conrelid = 'public.reservations'::regclass
    and conname = 'reservations_package_booking_check';

  if booking_check is null
     or position('PACKAGE_CHARGE_ITEM_ID IS NOT NULL' in upper(booking_check)) = 0
     or position('PACKAGE_PAX_COUNT IS NOT NULL' in upper(booking_check)) = 0
     or position('PACKAGE_TIER_ID IS NOT NULL' in upper(booking_check)) > 0 then
    raise exception 'Reservation package constraint does not permit a package booking without a guest-rate tier.';
  end if;

  select is_nullable
    into walkin_tier_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'pos_walkin_package_overrides'
    and column_name = 'package_tier_id';

  if walkin_tier_nullable is distinct from 'YES' then
    raise exception 'Walk-in package audit tier column must allow null for new tier-free bookings.';
  end if;

  select pg_get_functiondef(
    'public.pos_save_bill_phase3(text,text,text,text,integer,integer,integer,integer,text,text,jsonb,text,text,boolean)'::regprocedure
  )
    into phase3_definition;

  if position('package_item.unit_price' in lower(phase3_definition)) = 0
     or position('tier_row.base_price' in lower(phase3_definition)) > 0 then
    raise exception 'Package bill line must use the package catalog price rather than a guest-rate tier.';
  end if;
end;
$$;
