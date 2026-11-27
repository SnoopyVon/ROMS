-- CostTrack Phase 1 live-data migration.
-- Run as a database owner. This migration is transactional and preserves
-- existing rows, including revenue_records rows with status = 'Voided'.

begin;

-- PHASE 1: recipes.price -> recipes.menu_price.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recipes' and column_name = 'price'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recipes' and column_name = 'menu_price'
  ) then
    alter table public.recipes rename column price to menu_price;
  end if;
end;
$$;

-- PHASE 1: reservation lifecycle structure.
alter table public.reservations
  add column if not exists type text not null default 'Reservation',
  add column if not exists seated_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists actual_covers integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_type_check'
                 and conrelid = 'public.reservations'::regclass) then
    alter table public.reservations add constraint reservations_type_check
      check (type in ('Reservation', 'Walk-in')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservations_actual_covers_check'
                 and conrelid = 'public.reservations'::regclass) then
    alter table public.reservations add constraint reservations_actual_covers_check
      check (actual_covers is null or actual_covers >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservations_status_phase1_check'
                 and conrelid = 'public.reservations'::regclass) then
    alter table public.reservations add constraint reservations_status_phase1_check
      check (status in ('Pending', 'Confirmed', 'Cancelled', 'Seated', 'Completed', 'No-show')) not valid;
  end if;
end;
$$;

-- PHASE 1: rate catalog and non-overlapping active ranges.
create extension if not exists btree_gist;
create table if not exists public.buffet_rates (
  id text primary key,
  meal_period text not null,
  day_type text not null,
  adult_rate numeric not null check (adult_rate >= 0),
  child_rate numeric not null check (child_rate >= 0),
  senior_pwd_rate numeric not null check (senior_pwd_rate >= 0),
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  constraint buffet_rates_effective_range_check
    check (effective_to is null or effective_to >= effective_from)
);
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.buffet_rates'::regclass
      and conname = 'buffet_rates_active_no_overlap'
  ) then
    alter table public.buffet_rates
      add constraint buffet_rates_active_no_overlap
      exclude using gist (
        meal_period with =,
        day_type with =,
        daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)') with &&
      )
      where (is_active);
  end if;
end;
$$;
insert into public.buffet_rates (
  id, meal_period, day_type, adult_rate, child_rate, senior_pwd_rate,
  effective_from, effective_to, is_active
) values
  ('RATE-ALL-DAY-WEEKDAY-20260101', 'All Day', 'weekday', 499, 299, 399, '2026-01-01', null, true),
  ('RATE-ALL-DAY-WEEKEND-20260101', 'All Day', 'weekend', 499, 299, 399, '2026-01-01', null, true),
  ('RATE-ALL-DAY-HOLIDAY-20260101', 'All Day', 'holiday', 499, 299, 399, '2026-01-01', null, true)
on conflict (id) do nothing;

-- PHASE 1: revenue status preserves the existing void mechanism.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.revenue_records'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.revenue_records drop constraint %I', constraint_name);
  end loop;
end;
$$;
update public.revenue_records
set status = 'Confirmed'
where status = 'Active';
alter table public.revenue_records
  alter column status set default 'Confirmed',
  add column if not exists reservation_id text
    references public.reservations (id) on delete set null,
  add column if not exists rate_id text
    references public.buffet_rates (id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'revenue_records_status_phase1_check'
                 and conrelid = 'public.revenue_records'::regclass) then
    alter table public.revenue_records add constraint revenue_records_status_phase1_check
      check (status in ('Draft', 'Confirmed', 'Voided')) not valid;
  end if;
end;
$$;

-- PHASE 1: production and waste links.
alter table public.production_logs
  add column if not exists covers_produced integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'production_logs_covers_produced_check'
                 and conrelid = 'public.production_logs'::regclass) then
    alter table public.production_logs add constraint production_logs_covers_produced_check
      check (covers_produced is null or covers_produced >= 0) not valid;
  end if;
end;
$$;
alter table public.waste_logs
  add column if not exists production_log_id text
    references public.production_logs (id) on delete set null;

create index if not exists revenue_records_reservation_id_idx
  on public.revenue_records (reservation_id);
create index if not exists revenue_records_rate_id_idx
  on public.revenue_records (rate_id);
create index if not exists waste_logs_production_log_id_idx
  on public.waste_logs (production_log_id);
create index if not exists reservations_date_time_idx
  on public.reservations (reservation_date, reservation_time);
drop index if exists public.revenue_records_active_period_uidx;
create unique index if not exists revenue_records_active_period_uidx
  on public.revenue_records (business_date, meal_period)
  where status in ('Draft', 'Confirmed');

comment on column public.production_logs.quantity is
  'Number of recipe batches produced.';
comment on column public.production_logs.covers_produced is
  'Nullable number of buffet covers produced by the batches.';

-- PHASE 1: update the recipe RPC to use the renamed database column and payload key.
drop function if exists public.save_recipe(jsonb, timestamptz);
create or replace function public.save_recipe(
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
  for ingredient_item in select value from jsonb_array_elements(payload -> 'ingredients')
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

-- PHASE 1: temporary new-table RLS; revisit in Phase 2.
alter table public.buffet_rates enable row level security;
grant select, insert, update, delete on table public.buffet_rates to authenticated;
drop policy if exists buffet_rates_phase1_read on public.buffet_rates;
create policy buffet_rates_phase1_read on public.buffet_rates
  for select to authenticated using (true);
drop policy if exists buffet_rates_phase1_insert on public.buffet_rates;
create policy buffet_rates_phase1_insert on public.buffet_rates
  for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager']));
drop policy if exists buffet_rates_phase1_update on public.buffet_rates;
create policy buffet_rates_phase1_update on public.buffet_rates
  for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));
drop policy if exists buffet_rates_phase1_delete on public.buffet_rates;
create policy buffet_rates_phase1_delete on public.buffet_rates
  for delete to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']));
comment on table public.buffet_rates is
  'PHASE 1; temporary RLS policies mirror has_app_role and must be revisited in Phase 2.';

-- Verification queries (run after COMMIT in a separate SQL session):
-- select count(*) as reservations_total,
--        count(*) filter (where type = 'Reservation') as reservation_type_backfill
-- from public.reservations;
-- select status, count(*) from public.revenue_records group by status order by status;
-- select count(*) as orphan_reservation_links
-- from public.revenue_records r left join public.reservations x on x.id = r.reservation_id
-- where r.reservation_id is not null and x.id is null;
-- select count(*) as orphan_rate_links
-- from public.revenue_records r left join public.buffet_rates x on x.id = r.rate_id
-- where r.rate_id is not null and x.id is null;
-- select count(*) as orphan_production_links
-- from public.waste_logs w left join public.production_logs p on p.id = w.production_log_id
-- where w.production_log_id is not null and p.id is null;
-- select conname from pg_constraint
-- where conrelid = 'public.buffet_rates'::regclass
--   and conname = 'buffet_rates_active_no_overlap';

commit;
