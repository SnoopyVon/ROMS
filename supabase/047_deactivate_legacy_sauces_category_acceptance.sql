do $$
begin
  if exists (
    select 1
    from public.product_categories
    where lower(name) = lower('Sauces')
      and is_active
  ) then
    raise exception 'FAIL: the legacy Sauces category must be inactive.';
  end if;
  if not exists (
    select 1
    from public.product_categories
    where name = 'Sauces, Condiments & Seasonings'
      and is_active
  ) then
    raise exception 'FAIL: Sauces, Condiments & Seasonings must remain active.';
  end if;
end;
$$;
