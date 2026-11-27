-- Make the zero-priced Package A catalog item available in reservation demos.
-- This preserves its catalog price for the reservation package price model.
begin;

do $$
declare
  package_count integer;
  package_item public.pos_charge_items%rowtype;
begin
  select count(*)
    into package_count
  from public.pos_charge_items
  where lower(btrim(name)) = 'package a';

  if package_count <> 1 then
    raise exception 'Expected exactly one Package A charge item; found %.', package_count;
  end if;

  select *
    into package_item
  from public.pos_charge_items
  where lower(btrim(name)) = 'package a'
  for update;

  if package_item.type not in ('food', 'package')
     or package_item.unit_price <> 0
     or package_item.is_food_revenue is not true then
    raise exception 'Package A no longer matches the expected zero-priced food-revenue demo item.';
  end if;

  update public.pos_charge_items
  set type = 'package',
      is_package = true,
      is_active = true
  where id = package_item.id
    and (type is distinct from 'package' or is_package is distinct from true or not is_active);
end;
$$;

commit;
