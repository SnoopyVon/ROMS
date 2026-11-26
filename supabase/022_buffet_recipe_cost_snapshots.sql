begin;

alter table public.recipes
  add column if not exists is_active boolean not null default true;

alter table public.production_logs
  add column if not exists batch_cost_snapshot numeric(14,4)
    check (batch_cost_snapshot is null or batch_cost_snapshot >= 0),
  add column if not exists cost_snapshot_at timestamptz;

drop function if exists public.costtrack_load_recipes();
create function public.costtrack_load_recipes()
returns table (
  id text,
  name text,
  category text,
  wastage numeric,
  batch_yield integer,
  prep_target integer,
  prep_notes text,
  updated_at timestamptz,
  is_active boolean,
  ingredients jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']) then
    raise exception 'Not authorized to read recipes' using errcode = '42501';
  end if;
  return query
  select recipe.id, recipe.name, recipe.category,
    case when public.current_app_role() = 'Chef / Kitchen Staff'
      then null::numeric else recipe.wastage end,
    recipe.batch_yield, recipe.prep_target, recipe.prep_notes,
    recipe.updated_at, recipe.is_active,
    coalesce(
      jsonb_agg(jsonb_build_object(
        'ingredient_id', recipe_ingredient.ingredient_id,
        'quantity', recipe_ingredient.quantity
      )) filter (where recipe_ingredient.ingredient_id is not null),
      '[]'::jsonb
    )
  from public.recipes as recipe
  left join public.recipe_ingredients as recipe_ingredient
    on recipe_ingredient.recipe_id = recipe.id
  group by recipe.id, recipe.name, recipe.category, recipe.wastage,
    recipe.batch_yield, recipe.prep_target, recipe.prep_notes,
    recipe.updated_at, recipe.is_active
  order by recipe.name;
end;
$$;
revoke all on function public.costtrack_load_recipes() from public, anon, authenticated;
grant execute on function public.costtrack_load_recipes() to authenticated;

create or replace function public.save_recipe(
  payload jsonb,
  expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  batch_yield_value integer;
  prep_target_value integer;
  prep_notes_value text;
  menu_price_value numeric;
  active_value boolean;
  existing_active boolean;
  saved_recipe jsonb;
  saved_updated_at timestamptz;
  recipe_id_value text;
  legacy_payload jsonb;
begin
  if not public.has_app_role(array['Administrator', 'Manager']) then
    raise exception 'Only Administrators and Managers may manage recipes'
      using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Recipe payload must be a JSON object';
  end if;

  recipe_id_value := nullif(btrim(payload ->> 'id'), '');
  if recipe_id_value is null then
    raise exception 'Recipe id is required';
  end if;

  select recipe.menu_price, recipe.is_active
    into menu_price_value, existing_active
  from public.recipes as recipe
  where recipe.id = recipe_id_value
  for update;
  menu_price_value := coalesce(menu_price_value, 0);
  active_value := coalesce((payload ->> 'is_active')::boolean, existing_active, true);

  batch_yield_value := coalesce(nullif(payload ->> 'batch_yield', '')::integer, 30);
  prep_target_value := coalesce(nullif(payload ->> 'prep_target', '')::integer, 30);
  prep_notes_value := left(btrim(coalesce(payload ->> 'prep_notes', '')), 1000);
  if batch_yield_value <= 0 or prep_target_value <= 0 then
    raise exception 'Portions per base recipe and daily production target must be positive whole numbers';
  end if;

  legacy_payload := (payload - 'is_active' - 'batch_yield' - 'prep_target' - 'prep_notes')
    || jsonb_build_object('menu_price', menu_price_value);
  saved_recipe := public.costtrack_save_recipe_legacy(
    legacy_payload,
    expected_updated_at
  );
  update public.recipes as recipe
  set batch_yield = batch_yield_value,
      prep_target = prep_target_value,
      prep_notes = prep_notes_value,
      is_active = active_value,
      updated_at = clock_timestamp()
  where recipe.id = recipe_id_value
  returning recipe.updated_at into saved_updated_at;

  return (saved_recipe - 'menu_price') || jsonb_build_object(
    'wastage', saved_recipe -> 'wastage',
    'batch_yield', batch_yield_value,
    'prep_target', prep_target_value,
    'prep_notes', prep_notes_value,
    'is_active', active_value,
    'ingredients', coalesce(payload -> 'ingredients', '[]'::jsonb),
    'updated_at', saved_updated_at
  );
end;
$$;
revoke all on function public.save_recipe(jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.save_recipe(jsonb, timestamptz) to authenticated;

create or replace function public.costtrack_require_active_recipe_for_production()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.recipes as recipe
    where recipe.id = new.recipe_id
      and recipe.is_active
  ) then
    raise exception 'Inactive recipes cannot be started for new production'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.costtrack_require_active_recipe_for_production()
  from public, anon, authenticated;
drop trigger if exists production_batches_require_active_recipe
  on public.production_batches;
create trigger production_batches_require_active_recipe
  before insert on public.production_batches
  for each row execute function public.costtrack_require_active_recipe_for_production();

create or replace function public.apply_production_stock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  recipe_line record;
  ingredient_updated boolean;
  prior_stock_permission text;
  production_factor numeric;
  batch public.production_batches%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Production logs are append-only' using errcode = '55000';
  end if;

  production_factor := new.quantity;
  if new.production_batch_id is not null then
    select * into batch
    from public.production_batches as production_batch
    where production_batch.id = new.production_batch_id;
    if not found or batch.recipe_id <> new.recipe_id or batch.status <> 'Cooking' then
      raise exception 'The linked production batch is missing or is not cooking';
    end if;
    production_factor := batch.expected_covers::numeric / batch.batch_yield;
  elsif not exists (
    select 1
    from public.recipes as recipe
    where recipe.id = new.recipe_id and recipe.is_active
  ) then
    raise exception 'Inactive recipes cannot be used for new production'
      using errcode = '23514';
  end if;

  select round(
    coalesce(sum(recipe_line.quantity * inventory.cost), 0)
      * (1 + coalesce(recipe.wastage, 0) / 100.0)
      * production_factor,
    4
  )
  into new.batch_cost_snapshot
  from public.recipes as recipe
  left join public.recipe_ingredients as recipe_line
    on recipe_line.recipe_id = recipe.id
  left join public.ingredients as inventory
    on inventory.id = recipe_line.ingredient_id
  where recipe.id = new.recipe_id;
  new.cost_snapshot_at := clock_timestamp();

  prior_stock_permission := current_setting('costtrack.stock_movement', true);
  perform set_config('costtrack.stock_movement', 'on', true);
  for recipe_line in
    select ingredient_id, quantity
    from public.recipe_ingredients
    where recipe_id = new.recipe_id
    order by ingredient_id
  loop
    update public.ingredients
    set stock = stock - (recipe_line.quantity * production_factor)
    where id = recipe_line.ingredient_id
      and stock >= recipe_line.quantity * production_factor;
    ingredient_updated := found;
    if not ingredient_updated then
      raise exception 'Production would make stock negative for ingredient %',
        recipe_line.ingredient_id using errcode = '23514';
    end if;
  end loop;
  perform set_config('costtrack.stock_movement', coalesce(prior_stock_permission, ''), true);
  return new;
end;
$$;
revoke all on function public.apply_production_stock() from public, anon, authenticated;
drop trigger if exists apply_production_stock on public.production_logs;
create trigger apply_production_stock
  before insert or update or delete on public.production_logs
  for each row execute function public.apply_production_stock();

create or replace function public.costtrack_food_cost_report_with_snapshots(
  p_start_date date,
  p_end_date date,
  p_group_by text default 'day',
  p_include_waste boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  group_by_value text := lower(btrim(coalesce(p_group_by, 'day')));
  result_value jsonb;
begin
  if auth.uid() is null
     or not public.has_app_role(array['Administrator', 'Manager']) then
    raise exception 'Only Managers and Administrators may read food-cost reports.'
      using errcode = '42501';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
     or p_end_date - p_start_date > 366 then
    raise exception 'A valid report date range of no more than 366 days is required.'
      using errcode = '22023';
  end if;
  if group_by_value not in ('day', 'week', 'month') then
    raise exception 'Group by must be day, week, or month.'
      using errcode = '22023';
  end if;

  with periods as (
    select distinct date_trunc(group_by_value, days.day)::date as period
    from generate_series(
      p_start_date::timestamp, p_end_date::timestamp, interval '1 day'
    ) as days(day)
  ),
  revenue as (
    select date_trunc(group_by_value, bill.business_date::timestamp)::date as period,
      sum(bill.net_revenue) as revenue
    from public.pos_closed_bill_revenue_v as bill
    where bill.business_date between p_start_date and p_end_date
    group by 1
  ),
  production as (
    select date_trunc(group_by_value, production.production_date::timestamp)::date as period,
      sum(coalesce(
        production.batch_cost_snapshot,
        production.quantity * coalesce(recipe_cost.batch_cost, 0)
      )) as production_cost
    from public.production_logs as production
    join public.recipes as recipe on recipe.id = production.recipe_id
    left join lateral (
      select sum(recipe_ingredient.quantity * inventory.cost)
        * (1 + coalesce(recipe.wastage, 0) / 100.0) as batch_cost
      from public.recipe_ingredients as recipe_ingredient
      join public.ingredients as inventory
        on inventory.id = recipe_ingredient.ingredient_id
      where recipe_ingredient.recipe_id = recipe.id
    ) as recipe_cost on true
    where production.production_date between p_start_date and p_end_date
    group by 1
  ),
  waste as (
    select date_trunc(group_by_value, waste_log.waste_date::timestamp)::date as period,
      sum(waste_log.quantity * inventory.cost) as waste_cost
    from public.waste_logs as waste_log
    join public.ingredients as inventory on inventory.id = waste_log.ingredient_id
    where coalesce(p_include_waste, true)
      and waste_log.waste_date between p_start_date and p_end_date
    group by 1
  )
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(to_jsonb(report_row) order by report_row.period), '[]'::jsonb),
    'target_pct', 32,
    'includes_waste', coalesce(p_include_waste, true)
  )
  into result_value
  from (
    select periods.period,
      coalesce(revenue.revenue, 0) as revenue,
      coalesce(production.production_cost, 0) as production_cost,
      coalesce(waste.waste_cost, 0) as waste_cost,
      coalesce(production.production_cost, 0) + coalesce(waste.waste_cost, 0) as food_cost,
      case when coalesce(revenue.revenue, 0) = 0 then null
        else (coalesce(production.production_cost, 0)
          + coalesce(waste.waste_cost, 0)) / revenue.revenue * 100
      end as food_cost_pct
    from periods
    left join revenue using (period)
    left join production using (period)
    left join waste using (period)
  ) as report_row;
  return result_value;
end;
$$;
revoke all on function public.costtrack_food_cost_report_with_snapshots(date, date, text, boolean)
  from public, anon, authenticated;
grant execute on function public.costtrack_food_cost_report_with_snapshots(date, date, text, boolean)
  to authenticated;

alter function public.pos_revenue_report(text, date, date, text, boolean, integer, integer)
  rename to costtrack_pos_revenue_report_legacy;
revoke all on function public.costtrack_pos_revenue_report_legacy(text, date, date, text, boolean, integer, integer)
  from public, anon, authenticated;

create function public.pos_revenue_report(
  p_report_key text,
  p_start_date date default null,
  p_end_date date default null,
  p_group_by text default 'day',
  p_include_waste boolean default true,
  p_page integer default 1,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if lower(btrim(coalesce(p_report_key, ''))) = 'food_cost' then
    if coalesce(p_page, 1) < 1 or coalesce(p_page_size, 100) < 1
       or coalesce(p_page_size, 100) > 500 then
      raise exception 'Page must be positive and page size must be between 1 and 500.'
        using errcode = '22023';
    end if;
    return public.costtrack_food_cost_report_with_snapshots(
      p_start_date, p_end_date, p_group_by, p_include_waste
    );
  end if;
  return public.costtrack_pos_revenue_report_legacy(
    p_report_key, p_start_date, p_end_date, p_group_by,
    p_include_waste, p_page, p_page_size
  );
end;
$$;
revoke all on function public.pos_revenue_report(text, date, date, text, boolean, integer, integer)
  from public, anon;
grant execute on function public.pos_revenue_report(text, date, date, text, boolean, integer, integer)
  to authenticated;

create or replace function public.costtrack_production_report_with_snapshots(
  start_date_value date,
  end_date_value date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  result_value jsonb;
begin
  if auth.uid() is null
     or not public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']) then
    raise exception 'Not authorized to read production reports'
      using errcode = '42501';
  end if;
  if start_date_value is null or end_date_value is null
     or end_date_value < start_date_value
     or end_date_value - start_date_value > 366 then
    raise exception 'Invalid production report date range'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(to_jsonb(report_row) order by report_row.batches desc), '[]'::jsonb)
  )
  into result_value
  from (
    select recipe.name as recipe,
      sum(production.quantity) as batches,
      sum(coalesce(
        production.batch_cost_snapshot,
        production.quantity * coalesce(recipe_cost.batch_cost, 0)
      )) as production_cost,
      sum(production.covers_produced)
        filter (where production.covers_produced is not null) as covers_produced
    from public.production_logs as production
    join public.recipes as recipe on recipe.id = production.recipe_id
    left join lateral (
      select sum(recipe_ingredient.quantity * inventory.cost)
        * (1 + coalesce(recipe.wastage, 0) / 100.0) as batch_cost
      from public.recipe_ingredients as recipe_ingredient
      join public.ingredients as inventory
        on inventory.id = recipe_ingredient.ingredient_id
      where recipe_ingredient.recipe_id = recipe.id
    ) as recipe_cost on true
    where production.production_date between start_date_value and end_date_value
    group by recipe.id, recipe.name
  ) as report_row;
  return result_value;
end;
$$;
revoke all on function public.costtrack_production_report_with_snapshots(date, date)
  from public, anon, authenticated;
grant execute on function public.costtrack_production_report_with_snapshots(date, date)
  to authenticated;

create or replace function public.report_analytics(
  report_key text,
  start_date date,
  end_date date,
  group_by text default 'day',
  include_waste boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  report_result jsonb;
begin
  if report_key = 'production' then
    return public.costtrack_production_report_with_snapshots(start_date, end_date);
  end if;
  if report_key in ('revenue', 'food_cost') then
    if not public.has_app_role(array['Administrator', 'Manager']) then
      raise exception 'Not authorized to read financial reports.'
        using errcode = '42501';
    end if;
    return public.pos_revenue_report(
      case when report_key = 'revenue' then 'daily_revenue' else 'food_cost' end,
      start_date, end_date, group_by, include_waste
    );
  end if;
  if report_key = 'waste' then
    if not public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff', 'Inventory Clerk']) then
      raise exception 'Not authorized to read waste reports.'
        using errcode = '42501';
    end if;
  elsif not public.has_app_role(array['Administrator', 'Manager', 'Inventory Clerk']) then
    raise exception 'Not authorized to read operational reports.'
      using errcode = '42501';
  end if;
  report_result := public.costtrack_report_analytics_legacy(
    report_key, start_date, end_date, group_by, include_waste
  );
  if public.has_app_role(array['Administrator', 'Manager']) then
    return report_result;
  end if;
  if report_key = 'waste' then
    report_result := jsonb_set(report_result, '{by_ingredient}', coalesce((
      select jsonb_agg(item.value - 'waste_cost')
      from jsonb_array_elements(coalesce(report_result->'by_ingredient', '[]'::jsonb)) as item(value)
    ), '[]'::jsonb));
    report_result := jsonb_set(report_result, '{by_reason}', coalesce((
      select jsonb_agg(item.value - 'waste_cost')
      from jsonb_array_elements(coalesce(report_result->'by_reason', '[]'::jsonb)) as item(value)
    ), '[]'::jsonb));
    report_result := jsonb_set(report_result, '{by_day}', coalesce((
      select jsonb_agg(item.value - 'waste_cost')
      from jsonb_array_elements(coalesce(report_result->'by_day', '[]'::jsonb)) as item(value)
    ), '[]'::jsonb));
  elsif report_key = 'inventory' then
    report_result := jsonb_set(report_result, '{valuation_by_category}', coalesce((
      select jsonb_agg(item.value - 'valuation')
      from jsonb_array_elements(coalesce(report_result->'valuation_by_category', '[]'::jsonb)) as item(value)
    ), '[]'::jsonb));
    report_result := jsonb_set(report_result, '{variance}', coalesce((
      select jsonb_agg(item.value - 'variance_cost')
      from jsonb_array_elements(coalesce(report_result->'variance', '[]'::jsonb)) as item(value)
    ), '[]'::jsonb));
  end if;
  return report_result;
end;
$$;
revoke all on function public.report_analytics(text, date, date, text, boolean)
  from public, anon;
grant execute on function public.report_analytics(text, date, date, text, boolean)
  to authenticated;

commit;
