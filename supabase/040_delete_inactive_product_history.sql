begin;

alter function public.costtrack_product_lifecycle(text, text, text)
  rename to costtrack_product_lifecycle_before_040;
revoke all on function public.costtrack_product_lifecycle_before_040(text, text, text)
  from public, anon, authenticated;

create or replace function public.apply_inventory_transaction_stock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  prior_stock_permission text;
  stock_updated boolean;
begin
  if tg_op = 'DELETE'
     and current_setting('costtrack.product_delete', true) = 'on'
     and public.has_app_role(array['Administrator']) then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'Inventory transactions are append-only' using errcode = '55000';
  end if;

  prior_stock_permission := current_setting('costtrack.stock_movement', true);
  perform set_config('costtrack.stock_movement', 'on', true);
  update public.ingredients
  set stock = stock + new.quantity,
      cost = case
        when new.transaction_type = 'Receiving' and new.unit_cost > 0
          then new.unit_cost
        else cost
      end
  where id = new.ingredient_id
    and stock + new.quantity >= 0;
  stock_updated := found;
  perform set_config('costtrack.stock_movement', coalesce(prior_stock_permission, ''), true);
  if not stock_updated then
    raise exception 'Inventory movement would make stock negative or ingredient is missing'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.apply_waste_stock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  prior_stock_permission text;
  stock_updated boolean;
begin
  if tg_op = 'DELETE'
     and current_setting('costtrack.product_delete', true) = 'on'
     and public.has_app_role(array['Administrator']) then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'Waste logs are append-only' using errcode = '55000';
  end if;

  new.reason := left(btrim(coalesce(new.reason, '')), 250);
  if new.reason not in (
    'Expired', 'Spoiled', 'Burned', 'Over-preparation', 'Spillage',
    'Dropped / contaminated', 'Prep trim', 'Other'
  ) then
    raise exception 'Choose a valid waste reason' using errcode = '22023';
  end if;
  new.notes := left(coalesce(new.notes, ''), 500);
  if new.reason = 'Other' and btrim(new.notes) = '' then
    raise exception 'Add a short explanation for the Other reason' using errcode = '22023';
  end if;

  new.recorded_at := pg_catalog.clock_timestamp();
  new.waste_date := (new.recorded_at at time zone 'Asia/Manila')::date;
  new.recorded_by := auth.uid();

  prior_stock_permission := current_setting('costtrack.stock_movement', true);
  perform set_config('costtrack.stock_movement', 'on', true);
  update public.ingredients
  set stock = stock - new.quantity
  where id = new.ingredient_id
    and stock >= new.quantity;
  stock_updated := found;
  perform set_config('costtrack.stock_movement', coalesce(prior_stock_permission, ''), true);
  if not stock_updated then
    raise exception 'Waste entry would make stock negative or ingredient is missing'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.apply_physical_count_stock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  prior_stock_permission text;
  stock_updated boolean;
begin
  if tg_op = 'DELETE'
     and current_setting('costtrack.product_delete', true) = 'on'
     and public.has_app_role(array['Administrator']) then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'Physical counts are append-only' using errcode = '55000';
  end if;

  prior_stock_permission := current_setting('costtrack.stock_movement', true);
  perform set_config('costtrack.stock_movement', 'on', true);
  update public.ingredients
  set stock = new.actual
  where id = new.ingredient_id;
  stock_updated := found;
  perform set_config('costtrack.stock_movement', coalesce(prior_stock_permission, ''), true);
  if not stock_updated then
    raise exception 'Physical count ingredient does not exist' using errcode = '23503';
  end if;
  return new;
end;
$$;

create or replace function public.costtrack_delete_inactive_product_history(
  product_id_value text,
  reason_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  product_row public.ingredients%rowtype;
  reason_text text;
  prior_delete_mode text;
begin
  if not public.has_app_role(array['Administrator']) then
    raise exception 'Only Administrators may delete products'
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
  if product_row.is_active then
    raise exception 'Deactivate this product before deleting it'
      using errcode = '23514';
  end if;
  reason_text := coalesce(
    nullif(btrim(reason_value), ''),
    'Inactive product and linked records deleted by Administrator'
  );
  if length(reason_text) > 500 then
    raise exception 'The deletion reason must be 500 characters or fewer'
      using errcode = '22023';
  end if;

  prior_delete_mode := current_setting('costtrack.product_delete', true);
  perform set_config('costtrack.product_delete', 'on', true);

  delete from public.recipe_ingredients
  where ingredient_id = product_id_value;
  delete from public.dish_recipe_ingredients
  where product_id = product_id_value;
  delete from public.production_consumption
  where product_id = product_id_value;
  delete from public.stock_movements
  where product_id = product_id_value;
  delete from public.inventory_batches
  where product_id = product_id_value;
  delete from public.waste_logs
  where ingredient_id = product_id_value;
  delete from public.physical_counts
  where ingredient_id = product_id_value;
  delete from public.inventory_transactions
  where ingredient_id = product_id_value;
  delete from public.inventory_migration_issues
  where (source_table = 'ingredients' and source_id = product_id_value)
     or details -> 'product_ids' ? product_id_value;

  perform set_config('costtrack.product_delete', coalesce(prior_delete_mode, ''), true);

  delete from public.product_lifecycle_audit
  where product_id = product_id_value;
  insert into public.product_lifecycle_audit (
    product_id, product_name, action, reason, actor_id, actor_name
  ) values (
    product_row.id, product_row.name, 'delete', reason_text, auth.uid(),
    coalesce((
      select nullif(btrim(profile.full_name), '')
      from public.profiles as profile where profile.id = auth.uid()
    ), auth.uid()::text)
  );
  delete from public.ingredients where id = product_id_value;

  return jsonb_build_object(
    'action', 'delete', 'product_id', product_row.id,
    'product_name', product_row.name, 'is_active', null
  );
end;
$$;
revoke all on function public.costtrack_delete_inactive_product_history(text, text)
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
  if action_value = 'delete' then
    return public.costtrack_delete_inactive_product_history(product_id_value, reason_value);
  end if;
  return public.costtrack_product_lifecycle_before_040(
    action_value, product_id_value, reason_value
  );
end;
$$;
revoke all on function public.costtrack_product_lifecycle(text, text, text)
  from public, anon, authenticated;
grant execute on function public.costtrack_product_lifecycle(text, text, text)
  to authenticated;

commit;
