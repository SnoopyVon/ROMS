-- Read-only verification for 054_fix_recipe_save_recordset_columns.sql.
do $$
declare
  function_definition text;
begin
  function_definition := lower(regexp_replace(
    pg_get_functiondef(
      'public.costtrack_save_recipe_legacy(jsonb,timestamptz)'::regprocedure
    ),
    '[[:space:]]+',
    ' ',
    'g'
  )
  );

  if position(
    'as ingredient_rows(ingredient_id text, quantity numeric)'
    in function_definition
  ) = 0 then
    raise exception 'Recipe duplicate-check recordset is missing its column types.';
  end if;

  if position(
    'as rows(ingredient_id text, quantity numeric)'
    in function_definition
  ) = 0 then
    raise exception 'Recipe ingredient-insert recordset is missing its column types.';
  end if;
end;
$$;
