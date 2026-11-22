-- Run as the database owner after migrations 023, 024, 038, and 039.
-- Requires existing Administrator, Manager, Receptionist, Inventory Clerk,
-- and Chef / Kitchen Staff profiles. All test rows are rolled back.
begin;

do $$
declare
  admin_id uuid;
  manager_id uuid;
  receptionist_id uuid;
  clerk_id uuid;
  chef_id uuid;
  role_id uuid;
  unused_id text := 'P6-UNUSED-' || gen_random_uuid()::text;
  used_id text := 'P6-USED-' || gen_random_uuid()::text;
  blocker_id text := 'P6-RECIPE-BLOCKER-' || gen_random_uuid()::text;
  recipe_id text;
  stock_before_waste numeric;
  result jsonb;
  denied boolean;
begin
  select id into admin_id from public.profiles where role = 'Administrator' limit 1;
  select id into manager_id from public.profiles where role = 'Manager' limit 1;
  select id into receptionist_id from public.profiles where role = 'Receptionist' limit 1;
  select id into clerk_id from public.profiles where role = 'Inventory Clerk' limit 1;
  select id into chef_id from public.profiles where role = 'Chef / Kitchen Staff' limit 1;
  if admin_id is null or manager_id is null or receptionist_id is null
     or clerk_id is null or chef_id is null then
    raise exception 'FAIL: provision one profile for each required role before running acceptance.';
  end if;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', admin_id::text, 'role', 'authenticated')::text, true);

  insert into public.ingredients (id, name, category, unit, cost, stock, minimum)
  values (unused_id, 'P6 unused test product', 'Acceptance', 'unit', 1, 0, 0);
  result := public.costtrack_product_lifecycle('inspect', unused_id);
  if (result ->> 'is_used')::boolean then
    raise exception 'FAIL: an unused product was reported as used.';
  end if;
  begin
    perform public.costtrack_product_lifecycle('delete', unused_id);
    raise exception 'FAIL: an active product was hard deleted.';
  exception when check_violation then
    null;
  end;
  if not exists (select 1 from public.ingredients where id = unused_id) then
    raise exception 'FAIL: active product deletion removed the product.';
  end if;
  perform public.costtrack_product_lifecycle(
    'deactivate', unused_id, 'Acceptance test deactivation reason'
  );
  perform public.costtrack_product_lifecycle('delete', unused_id);
  if exists (select 1 from public.ingredients where id = unused_id)
     or not exists (
       select 1 from public.product_lifecycle_audit
       where product_id = unused_id and action = 'delete' and actor_id = admin_id
     ) then
    raise exception 'FAIL: inactive product deletion or its audit record failed.';
  end if;

  insert into public.ingredients (id, name, category, unit, cost, stock, minimum)
  values (used_id, 'P6 used test product', 'Acceptance', 'unit', 1, 10, 0);
  insert into public.physical_counts (id, ingredient_id, expected, actual, count_date)
  values ('P6-COUNT-' || gen_random_uuid()::text, used_id, 0, 0, current_date);

  select recipe.id into recipe_id
  from public.recipes as recipe where recipe.is_active limit 1;
  if recipe_id is not null then
    insert into public.ingredients (id, name, category, unit, cost, stock, minimum)
    values (blocker_id, 'P6 active recipe blocker', 'Acceptance', 'unit', 1, 0, 0);
    insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity)
    values (recipe_id, blocker_id, 1);
    perform public.costtrack_product_lifecycle(
      'deactivate', blocker_id, 'Acceptance test deactivation reason'
    );
    if (select is_active from public.ingredients where id = blocker_id)
       or not exists (
         select 1 from public.product_lifecycle_audit
         where product_id = blocker_id and action = 'deactivate'
           and actor_id = admin_id and reason = 'Acceptance test deactivation reason'
       ) then
      raise exception 'FAIL: a product used by an active recipe did not deactivate and audit.';
    end if;
  end if;

  result := public.costtrack_product_lifecycle('inspect', used_id);
  if not (result ->> 'is_used')::boolean
     or (result -> 'usage' ->> 'physical_counts')::integer <> 1 then
    raise exception 'FAIL: physical-count history was not reported as product usage.';
  end if;
  begin
    perform public.costtrack_product_lifecycle('delete', used_id);
    raise exception 'FAIL: an active product was hard deleted.';
  exception when check_violation then
    null;
  end;
  if not exists (select 1 from public.ingredients where id = used_id) then
    raise exception 'FAIL: active product deletion removed the product.';
  end;
  perform public.costtrack_product_lifecycle(
    'deactivate', used_id, 'Acceptance test deactivation reason'
  );
  if (select is_active from public.ingredients where id = used_id) then
    raise exception 'FAIL: used product did not deactivate.';
  end if;
  if not exists (
    select 1 from public.product_lifecycle_audit
    where product_id = used_id and action = 'deactivate'
      and actor_id = admin_id and reason = 'Acceptance test deactivation reason'
  ) then
    raise exception 'FAIL: deactivation audit record is missing.';
  end if;

  begin
    perform public.costtrack_receive_delivery(jsonb_build_object(
      'supplier_name', 'P6 acceptance', 'invoice_number', 'P6-INACTIVE',
      'invoice_date', current_date::text, 'received_date', current_date::text,
      'lines', jsonb_build_array(jsonb_build_object(
        'id', 'P6-RCV-' || gen_random_uuid()::text,
        'ingredient_id', used_id, 'quantity', 1, 'unit_cost', 1
      ))
    ));
    raise exception 'FAIL: receiving accepted an inactive product.';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    if position('inactive' in lower(sqlerrm)) = 0 then
      raise exception 'FAIL: receiving rejected the test for an unexpected reason: %', sqlerrm;
    end if;
  end;

  select stock into stock_before_waste
  from public.ingredients where id = used_id;
  begin
    perform public.costtrack_log_waste(jsonb_build_object(
      'id', 'P6-WASTE-' || gen_random_uuid()::text,
      'ingredient_id', used_id, 'quantity', 1, 'reason', 'Expired', 'notes', ''
    ));
    raise exception 'FAIL: waste logging accepted an inactive product.';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    if position('inactive' in lower(sqlerrm)) = 0 then
      raise exception 'FAIL: waste logging rejected the test for an unexpected reason: %', sqlerrm;
    end if;
  end;
  if (select stock from public.ingredients where id = used_id)
     is distinct from stock_before_waste then
    raise exception 'FAIL: rejected waste changed product stock.';
  end if;

  begin
    insert into public.physical_counts (id, ingredient_id, expected, actual, count_date)
    values ('P6-INACTIVE-COUNT-' || gen_random_uuid()::text, used_id, 0, 0, current_date);
    raise exception 'FAIL: physical counting accepted an inactive product.';
  exception when check_violation then
    if position('inactive' in lower(sqlerrm)) = 0 then
      raise exception 'FAIL: count insert rejected the test for an unexpected reason: %', sqlerrm;
    end if;
  end;
  if recipe_id is not null then
    begin
      insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity)
      values (recipe_id, used_id, 1);
      raise exception 'FAIL: recipe editing accepted an inactive product.';
    exception when check_violation then
      if position('inactive' in lower(sqlerrm)) = 0 then
        raise exception 'FAIL: recipe insert rejected the test for an unexpected reason: %', sqlerrm;
      end if;
    end;
  end if;

  foreach role_id in array array[manager_id, receptionist_id, clerk_id, chef_id]
  loop
    perform set_config('request.jwt.claim.sub', role_id::text, true);
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', role_id::text, 'role', 'authenticated')::text, true);
    denied := false;
    begin
      perform public.costtrack_product_lifecycle('reactivate', used_id);
    exception when insufficient_privilege then
      denied := true;
    end;
    if not denied then
      raise exception 'FAIL: a non-Administrator role was allowed to call the lifecycle RPC.';
    end if;
    denied := false;
    begin
      perform public.costtrack_product_lifecycle('delete', used_id);
    exception when insufficient_privilege then
      denied := true;
    end;
    if not denied then
      raise exception 'FAIL: a non-Administrator role was allowed to delete a product.';
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', admin_id::text, 'role', 'authenticated')::text, true);
  perform public.costtrack_product_lifecycle('reactivate', used_id);
  if not (select is_active from public.ingredients where id = used_id)
     or not exists (
       select 1 from public.product_lifecycle_audit
       where product_id = used_id and action = 'reactivate' and actor_id = admin_id
     ) then
    raise exception 'FAIL: reactivation or its audit record failed.';
  end if;
  if not exists (
    select 1 from public.physical_counts where ingredient_id = used_id
  ) then
    raise exception 'FAIL: product lifecycle changed historical physical-count rows.';
  end if;
  perform public.costtrack_product_lifecycle(
    'deactivate', used_id, 'Acceptance test deletion reason'
  );
  perform public.costtrack_product_lifecycle('delete', used_id);
  if exists (select 1 from public.ingredients where id = used_id)
     or exists (select 1 from public.physical_counts where ingredient_id = used_id)
     or not exists (
       select 1 from public.product_lifecycle_audit
       where product_id = used_id and action = 'delete' and actor_id = admin_id
     ) then
    raise exception 'FAIL: product deletion did not remove linked history and preserve its delete audit.';
  end if;
  if recipe_id is not null then
    perform public.costtrack_product_lifecycle('delete', blocker_id);
    if exists (
      select 1 from public.recipe_ingredients as recipe_ingredient
      where recipe_ingredient.ingredient_id = blocker_id
        and recipe_ingredient.recipe_id = recipe_id
    ) then
      raise exception 'FAIL: deleting a product did not remove its recipe ingredient link.';
    end if;
  end if;
end;
$$;

rollback;
