-- Read-only verification for 055_enable_package_a_reservation_demo.sql.
do $$
begin
  if (
    select count(*)
    from public.pos_charge_items
    where lower(btrim(name)) = 'package a'
      and type = 'package'
      and is_package
      and is_active
      and unit_price = 0
      and is_food_revenue
  ) <> 1 then
    raise exception 'Package A is not configured as the active zero-priced reservation package.';
  end if;

end;
$$;
