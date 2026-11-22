begin;

drop function if exists public.costtrack_product_lifecycle(text, text, text);
alter function public.costtrack_product_lifecycle_before_039(text, text, text)
  rename to costtrack_product_lifecycle;
drop function if exists public.costtrack_deactivate_product(text, text);
grant execute on function public.costtrack_product_lifecycle(text, text, text)
  to authenticated;

commit;
