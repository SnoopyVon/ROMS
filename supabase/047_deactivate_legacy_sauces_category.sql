begin;

do $$
begin
  if to_regclass('public.product_categories') is null then
    raise exception 'Product categories are unavailable. Apply the Phase 8 inventory migration first.';
  end if;
  if not exists (
    select 1
    from public.product_categories
    where lower(name) = lower('Sauces, Condiments & Seasonings')
      and is_active
  ) then
    raise exception 'The active Sauces, Condiments & Seasonings category is required before retiring Sauces.';
  end if;
end;
$$;

update public.product_categories
set is_active = false,
    updated_at = clock_timestamp()
where lower(name) = lower('Sauces')
  and is_active;

commit;
