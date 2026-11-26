begin;

do $$
begin
  if to_regclass('public.product_categories') is null then
    raise exception 'Product categories are unavailable. Apply the Phase 8 inventory migration first.';
  end if;
end;
$$;

insert into public.product_categories (name)
values ('Vegetables'), ('Aromatics')
on conflict do nothing;

update public.product_categories
set name = case lower(name)
      when 'vegetables' then 'Vegetables'
      when 'aromatics' then 'Aromatics'
    end,
    is_active = true,
    updated_at = clock_timestamp()
where lower(name) in ('vegetables', 'aromatics')
  and (name not in ('Vegetables', 'Aromatics') or not is_active);

commit;
