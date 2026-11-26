begin;

do $$
declare
  function_oid regprocedure;
  function_definition text;
  updated_definition text;
  old_guard text := $old$
    if outcome_value <> 'close_without_charge'
       and table_row.status = 'Needs cleaning' then
      raise exception 'The table already needs cleaning and cannot be marked Available by this booking resolution.'
        using errcode = '55000';
    end if;
$old$;
  old_table_update text := $old$
    update public.restaurant_tables
    set status = case
      when outcome_value = 'close_without_charge' then 'Needs cleaning'
      else 'Available'
    end
    where id = reservation_row.table_id;
$old$;
  new_table_update text := $new$
    update public.restaurant_tables
    set status = case
      when outcome_value = 'close_without_charge'
        or table_row.status = 'Needs cleaning' then 'Needs cleaning'
      else 'Available'
    end
    where id = reservation_row.table_id;
$new$;
  old_result_status text := $old$
    'table_status', case
      when reservation_row.table_id is null then null
      when outcome_value = 'close_without_charge' then 'Needs cleaning'
      else 'Available'
    end,
$old$;
  new_result_status text := $new$
    'table_status', case
      when reservation_row.table_id is null then null
      when outcome_value = 'close_without_charge'
        or table_row.status = 'Needs cleaning' then 'Needs cleaning'
      else 'Available'
    end,
$new$;
begin
  function_oid := to_regprocedure(
    'public.pos_resolve_stale_booking(text,text,text,boolean,text,text,text)'
  );
  if function_oid is null then
    raise exception 'Required stale-booking function is missing: pos_resolve_stale_booking.';
  end if;

  function_definition := pg_get_functiondef(function_oid);
  if position('-- Migration 044: preserve table cleaning state' in function_definition) > 0 then
    raise exception 'Migration 044 table-cleaning behavior is already installed.';
  end if;
  if length(function_definition) - length(replace(function_definition, old_guard, '')) <> length(old_guard) then
    raise exception 'Could not locate the stale-booking cleaning-state rejection.';
  end if;
  if length(function_definition) - length(replace(function_definition, old_table_update, '')) <> length(old_table_update) then
    raise exception 'Could not locate the stale-booking table-status update.';
  end if;
  if length(function_definition) - length(replace(function_definition, old_result_status, '')) <> length(old_result_status) then
    raise exception 'Could not locate the stale-booking table-status response.';
  end if;

  updated_definition := replace(function_definition, old_guard, '');
  updated_definition := replace(updated_definition, old_table_update,
    '    -- Migration 044: preserve table cleaning state' || E'\n' || new_table_update);
  updated_definition := replace(updated_definition, old_result_status, new_result_status);
  execute updated_definition;
end;
$$;

commit;
