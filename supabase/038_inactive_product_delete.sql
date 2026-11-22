begin;

create or replace function public.costtrack_require_inactive_product_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not public.has_app_role(array['Administrator']) then
    raise exception 'Only Administrators may delete products'
      using errcode = '42501';
  end if;
  if old.is_active then
    raise exception 'Deactivate this product before deleting it'
      using errcode = '23514';
  end if;
  return old;
end;
$$;
revoke all on function public.costtrack_require_inactive_product_delete()
  from public, anon, authenticated;

drop trigger if exists costtrack_products_require_inactive_delete
  on public.ingredients;
create trigger costtrack_products_require_inactive_delete
  before delete on public.ingredients
  for each row execute function public.costtrack_require_inactive_product_delete();

commit;
