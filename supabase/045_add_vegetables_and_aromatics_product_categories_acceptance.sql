do $$
begin
  if exists (
    select required.name
    from (values ('Vegetables'), ('Aromatics')) as required(name)
    left join public.product_categories as category
      on lower(category.name) = lower(required.name)
     and category.is_active
    where category.id is null
  ) then
    raise exception 'FAIL: Vegetables and Aromatics must both be active product categories.';
  end if;
end;
$$;
