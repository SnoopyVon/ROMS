begin;

drop function if exists public.costtrack_product_lifecycle(text, text, text);
alter function public.costtrack_product_lifecycle_before_040(text, text, text)
  rename to costtrack_product_lifecycle;
drop function if exists public.costtrack_delete_inactive_product_history(text, text);

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

grant execute on function public.costtrack_product_lifecycle(text, text, text)
  to authenticated;

commit;
