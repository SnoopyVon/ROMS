-- Fix the legacy recipe RPC's final jsonb_to_recordset call.
-- jsonb_to_recordset returns record and requires explicit output column types.
-- Apply after the existing recipe migrations; CREATE OR REPLACE preserves the
-- function's existing grants.
begin;

create or replace function public.costtrack_save_recipe_legacy(
  payload jsonb,
  expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  recipe_id_value text;
  ingredient_item jsonb;
  saved_recipe public.recipes%rowtype;
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']) then
    raise exception 'Not authorized to save recipes' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Recipe payload must be a JSON object';
  end if;
  if jsonb_typeof(payload -> 'ingredients') is distinct from 'array' then
    raise exception 'Recipe ingredients must be a JSON array';
  end if;

  recipe_id_value := nullif(btrim(payload ->> 'id'), '');
  if recipe_id_value is null
     or nullif(btrim(payload ->> 'name'), '') is null
     or nullif(btrim(payload ->> 'category'), '') is null
     or payload ->> 'menu_price' is null
     or payload ->> 'wastage' is null then
    raise exception 'Recipe id, name, category, menu_price, and wastage are required';
  end if;

  for ingredient_item in
    select value from jsonb_array_elements(payload -> 'ingredients')
  loop
    if jsonb_typeof(ingredient_item) is distinct from 'object'
       or nullif(btrim(ingredient_item ->> 'ingredient_id'), '') is null
       or ingredient_item ->> 'quantity' is null
       or (ingredient_item ->> 'quantity')::numeric <= 0 then
      raise exception 'Each recipe ingredient needs an id and positive quantity';
    end if;
    if not exists (
      select 1 from public.ingredients as i
      where i.id = ingredient_item ->> 'ingredient_id'
    ) then
      raise exception 'Unknown ingredient id: %', ingredient_item ->> 'ingredient_id';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_to_recordset(payload -> 'ingredients')
      as ingredient_rows(ingredient_id text, quantity numeric)
    group by ingredient_rows.ingredient_id
    having count(*) > 1
  ) then
    raise exception 'Recipe ingredient ids must be unique';
  end if;

  select * into saved_recipe from public.recipes
  where id = recipe_id_value for update;
  if found then
    if expected_updated_at is null
       or saved_recipe.updated_at is distinct from expected_updated_at then
      raise exception 'Recipe was changed by another user; reload before saving'
        using errcode = '40001';
    end if;
    update public.recipes
    set name = btrim(payload ->> 'name'),
        category = btrim(payload ->> 'category'),
        menu_price = (payload ->> 'menu_price')::numeric,
        wastage = (payload ->> 'wastage')::numeric
    where id = recipe_id_value
    returning * into saved_recipe;
  else
    if expected_updated_at is not null then
      raise exception 'Recipe no longer exists; reload before saving'
        using errcode = '40001';
    end if;
    insert into public.recipes (id, name, category, menu_price, wastage)
    values (
      recipe_id_value, btrim(payload ->> 'name'), btrim(payload ->> 'category'),
      (payload ->> 'menu_price')::numeric, (payload ->> 'wastage')::numeric
    )
    returning * into saved_recipe;
  end if;

  delete from public.recipe_ingredients where recipe_id = recipe_id_value;
  insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity)
  select recipe_id_value, rows.ingredient_id, rows.quantity
  from jsonb_to_recordset(payload -> 'ingredients')
    as rows(ingredient_id text, quantity numeric);

  return to_jsonb(saved_recipe);
end;
$$;

commit;
