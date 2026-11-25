begin;

do $migration$
declare
  function_definition text;
  previous_roles constant text :=
    '''Manager'', ''Receptionist'', ''Inventory Clerk'', ''Chef / Kitchen Staff''';
  allowed_roles constant text :=
    '''Administrator'', ''Manager'', ''Receptionist'', ''Inventory Clerk'', ''Chef / Kitchen Staff''';
begin
  select pg_get_functiondef(
    'public.costtrack_create_verified_user_account(uuid,uuid,text,text,text,jsonb)'::regprocedure
  )
  into function_definition;

  if position(allowed_roles in function_definition) > 0 then
    return;
  end if;
  if position(previous_roles in function_definition) = 0 then
    raise exception 'Could not identify the verified-account role allowlist';
  end if;

  execute replace(function_definition, previous_roles, allowed_roles);
end;
$migration$;

commit;
