begin;

do $$
declare
  function_oid regprocedure;
  function_definition text;
  updated_definition text;
  anchor text := '  for open_bill in';
  day_guard text := $guard$  if (shift_row.opened_at at time zone 'Asia/Manila')::date <>
    (now() at time zone 'Asia/Manila')::date then
    raise exception 'A cashier shift can only be closed on the same Manila business day it was opened.'
      using errcode = '22023';
  end if;
$guard$;
begin
  function_oid := to_regprocedure('public.pos_close_shift(text,numeric,text)');
  if function_oid is null then
    raise exception 'Required cashier function is missing: pos_close_shift.';
  end if;

  function_definition := pg_get_functiondef(function_oid);
  if position('A cashier shift can only be closed on the same Manila business day it was opened.' in function_definition) > 0 then
    raise exception 'The same-day close guard is already installed.';
  end if;
  if length(function_definition) - length(replace(function_definition, anchor, '')) <> length(anchor) then
    raise exception 'Could not locate the open-bill check in pos_close_shift.';
  end if;

  updated_definition := replace(function_definition, anchor, day_guard || anchor);
  execute updated_definition;
end;
$$;

commit;
