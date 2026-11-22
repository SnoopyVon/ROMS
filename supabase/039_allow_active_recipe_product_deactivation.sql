begin;

alter function public.costtrack_product_lifecycle(text, text, text)
  rename to costtrack_product_lifecycle_before_039;
revoke all on function public.costtrack_product_lifecycle_before_039(text, text, text)
  from public, anon, authenticated;

create function public.costtrack_deactivate_product(
  product_id_value text,
  reason_value text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  product_row public.ingredients%rowtype;
  reason_text text;
  saved_updated_at timestamptz;
begin
  if not public.has_app_role(array['Administrator']) then
    raise exception 'Only Administrators may manage product lifecycle'
      using errcode = '42501';
  end if;
  product_id_value := nullif(btrim(product_id_value), '');
  if product_id_value is null then
    raise exception 'A product ID is required' using errcode = '22023';
  end if;

  select * into product_row
  from public.ingredients
  where id = product_id_value
  for update;
  if not found then
    raise exception 'This product no longer exists';
  end if;
  if not product_row.is_active then
    raise exception 'This product is already inactive';
  end if;

  reason_text := nullif(btrim(reason_value), '');
  if reason_text is null then
    raise exception 'A reason is required to deactivate a product'
      using errcode = '22023';
  end if;
  if length(reason_text) > 500 then
    raise exception 'The deactivation reason must be 500 characters or fewer'
      using errcode = '22023';
  end if;

  update public.ingredients
  set is_active = false,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  where id = product_id_value;
  select updated_at into saved_updated_at
  from public.ingredients where id = product_id_value;
  insert into public.product_lifecycle_audit (
    product_id, product_name, action, reason, actor_id, actor_name
  ) values (
    product_row.id, product_row.name, 'deactivate', reason_text, auth.uid(),
    coalesce((
      select nullif(btrim(profile.full_name), '')
      from public.profiles as profile where profile.id = auth.uid()
    ), auth.uid()::text)
  );
  return jsonb_build_object(
    'action', 'deactivate', 'product_id', product_row.id,
    'product_name', product_row.name, 'is_active', false,
    'updated_at', saved_updated_at
  );
end;
$$;
revoke all on function public.costtrack_deactivate_product(text, text)
  from public, anon, authenticated;

create function public.costtrack_product_lifecycle(
  action_value text,
  product_id_value text,
  reason_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if action_value = 'deactivate' then
    return public.costtrack_deactivate_product(product_id_value, reason_value);
  end if;
  return public.costtrack_product_lifecycle_before_039(
    action_value, product_id_value, reason_value
  );
end;
$$;
revoke all on function public.costtrack_product_lifecycle(text, text, text)
  from public, anon, authenticated;
grant execute on function public.costtrack_product_lifecycle(text, text, text)
  to authenticated;

commit;
