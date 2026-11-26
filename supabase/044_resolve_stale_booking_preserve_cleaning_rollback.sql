begin;

do $$
declare
  function_oid regprocedure;
  function_definition text;
  updated_definition text;
  marker text := '    -- Migration 044: preserve table cleaning state';
  old_guard text := $old$
  if outcome_value <> 'close_without_charge'
     and table_row.status = 'Needs cleaning' then
    raise exception 'The table already needs cleaning and cannot be marked Available by this booking resolution.'
      using errcode = '55000';
  end if;
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
  old_table_update text := $old$
    update public.restaurant_tables
    set status = case
      when outcome_value = 'close_without_charge' then 'Needs cleaning'
      else 'Available'
    end
    where id = reservation_row.table_id;
$old$;
  new_result_status text := $new$
    'table_status', case
      when reservation_row.table_id is null then null
      when outcome_value = 'close_without_charge'
        or table_row.status = 'Needs cleaning' then 'Needs cleaning'
      else 'Available'
    end,
$new$;
  old_result_status text := $old$
    'table_status', case
      when reservation_row.table_id is null then null
      when outcome_value = 'close_without_charge' then 'Needs cleaning'
      else 'Available'
    end,
$old$;
  bill_list_anchor text := '  select coalesce(array_agg(b.id order by b.created_at, b.id), ''{}''::text[])';
begin
  function_oid := to_regprocedure(
    'public.pos_resolve_stale_booking(text,text,text,boolean,text,text,text)'
  );
  if function_oid is null then
    raise exception 'Required stale-booking function is missing: pos_resolve_stale_booking.';
  end if;

  function_definition := pg_get_functiondef(function_oid);
  if position(marker in function_definition) = 0 then
    raise exception 'Migration 044 table-cleaning behavior is not installed.';
  end if;
  if position('The table already needs cleaning and cannot be marked Available by this booking resolution.' in function_definition) > 0 then
    raise exception 'The legacy table-cleaning rejection is already present.';
  end if;
  if length(function_definition) - length(replace(function_definition, new_table_update, '')) <> length(new_table_update) then
    raise exception 'Could not locate the updated stale-booking table-status update.';
  end if;
  if length(function_definition) - length(replace(function_definition, new_result_status, '')) <> length(new_result_status) then
    raise exception 'Could not locate the updated stale-booking table-status response.';
  end if;
  if length(function_definition) - length(replace(function_definition, bill_list_anchor, '')) <> length(bill_list_anchor) then
    raise exception 'Could not locate the stale-booking bill-list query.';
  end if;

  updated_definition := replace(function_definition, new_table_update, old_table_update);
  updated_definition := replace(updated_definition, new_result_status, old_result_status);
  updated_definition := replace(updated_definition, marker || E'\n', '');
  updated_definition := replace(updated_definition, bill_list_anchor, old_guard || bill_list_anchor);
  execute updated_definition;
end;
$$;

commit;
