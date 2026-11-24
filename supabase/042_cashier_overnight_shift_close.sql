begin;

do $$
declare
  function_oid regprocedure;
  function_definition text;
  updated_definition text;
  anchor text := '  if shift_row.status <> ''Open'' then';
  authorization_guard text := $guard$  -- Migration 042: cashier close authorization
  if public.current_app_role() = 'Receptionist'
    and shift_row.opened_by is distinct from auth.uid() then
    raise exception 'Receptionists can close only their own shift.' using errcode = '42501';
  end if;
  if shift_row.status = 'Open'
    and public.current_app_role() in ('Manager', 'Administrator')
    and shift_row.opened_by is distinct from auth.uid()
    and nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception 'A reason is required when closing another cashier''s shift.'
      using errcode = '22023';
  end if;
$guard$;
begin
  function_oid := to_regprocedure('public.pos_close_shift(text,numeric,text)');
  if function_oid is null then
    raise exception 'Required cashier function is missing: pos_close_shift.';
  end if;

  function_definition := pg_get_functiondef(function_oid);
  if position('-- Migration 042: cashier close authorization' in function_definition) > 0 then
    raise exception 'Migration 042 cashier close authorization is already installed.';
  end if;
  if length(function_definition) - length(replace(function_definition, anchor, '')) <> length(anchor) then
    raise exception 'Could not locate the shift status check in pos_close_shift.';
  end if;

  updated_definition := replace(function_definition, anchor, authorization_guard || anchor);
  if updated_definition = function_definition then
    raise exception 'Could not install cashier close authorization.';
  end if;
  execute updated_definition;
end;
$$;

commit;
