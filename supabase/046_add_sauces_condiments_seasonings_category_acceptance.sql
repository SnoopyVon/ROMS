do $$
begin
  if not exists (
    select 1
    from public.product_categories
    where name = 'Sauces, Condiments & Seasonings'
      and is_active
  ) then
    raise exception 'FAIL: Sauces, Condiments & Seasonings must be an active product category.';
  end if;
end;
$$;
