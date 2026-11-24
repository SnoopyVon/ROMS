begin;

do $$
declare
  function_oid regprocedure;
  function_definition text;
  updated_definition text;
  marker text := '  -- Migration 042: cashier close authorization';
  anchor text := '  if shift_row.status <> ''Open'' then';
  marker_position integer;
  anchor_position integer;
begin
  function_oid := to_regprocedure('public.pos_close_shift(text,numeric,text)');
  if function_oid is null then
    raise exception 'Required cashier function is missing: pos_close_shift.';
  end if;

  function_definition := pg_get_functiondef(function_oid);
  marker_position := position(marker in function_definition);
  if marker_position = 0 then
    raise exception 'Migration 042 cashier close authorization is not installed.';
  end if;

  anchor_position := position(anchor in substring(function_definition from marker_position));
  if anchor_position = 0 then
    raise exception 'Could not locate the shift status check after the Migration 042 guard.';
  end if;

  updated_definition := left(function_definition, marker_position - 1)
    || substring(function_definition from marker_position + anchor_position - 1);
  execute updated_definition;
end;
$$;

commit;
