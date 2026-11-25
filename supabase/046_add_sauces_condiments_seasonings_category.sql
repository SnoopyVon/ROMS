begin;

do $$
begin
  if to_regclass('public.product_categories') is null then
    raise exception 'Product categories are unavailable. Apply the Phase 8 inventory migration first.';
  end if;
end;
$$;

insert into public.product_categories (name)
values ('Sauces, Condiments & Seasonings')
on conflict do nothing;

update public.product_categories
set name = 'Sauces, Condiments & Seasonings',
    is_active = true,
    updated_at = clock_timestamp()
where lower(name) = lower('Sauces, Condiments & Seasonings')
  and (name <> 'Sauces, Condiments & Seasonings' or not is_active);

commit;
