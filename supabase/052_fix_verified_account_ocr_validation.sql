begin;

do $migration$
declare
  function_definition text;
  previous_expression constant text :=
    'p_verification_record->''ocr_summary'' - array[';
  corrected_expression constant text :=
    '(p_verification_record->''ocr_summary'') - array[';
begin
  select pg_get_functiondef(
    'public.costtrack_create_verified_user_account(uuid,uuid,text,text,text,jsonb)'::regprocedure
  )
  into function_definition;

  if position(corrected_expression in function_definition) > 0 then
    return;
  end if;
  if position(previous_expression in function_definition) = 0 then
    raise exception 'Could not identify the verified-account OCR validation expression';
  end if;

  execute replace(function_definition, previous_expression, corrected_expression);
end;
$migration$;

commit;
