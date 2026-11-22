begin;

drop trigger if exists costtrack_products_require_inactive_delete
  on public.ingredients;
drop function if exists public.costtrack_require_inactive_product_delete();

commit;
