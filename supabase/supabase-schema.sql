-- CostTrack typed Supabase schema.
-- Run this script as a database owner in the Supabase SQL editor. It is
-- intentionally rerunnable and backfills supported app_records collections;
-- demo users are excluded and the original JSON rows remain archived/locked.
-- Provision staff manually: create/confirm the user in Supabase Auth, copy its
-- Auth user UUID, then insert the matching profile as an administrator:
--   insert into public.profiles (id, email, full_name, role)
--   values ('<AUTH_USER_UUID>'::uuid, '<EMAIL>', '<FULL_NAME>', 'Administrator');
-- Repeat with an allowed role for each real user; never insert demo credentials.
-- Change roles through public.costtrack_update_profile_role; profile deletion is disabled.

-- Lock the old JSON endpoint before making any schema changes. The rows remain
-- available to this migration as the database owner, but not through the API.
do $$
declare
  policy_row record;
begin
  if to_regclass('public.app_records') is not null then
    alter table public.app_records enable row level security;
    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = 'app_records'
    loop
      execute format('drop policy if exists %I on public.app_records', policy_row.policyname);
    end loop;
    revoke all on table public.app_records from public, anon, authenticated;
  end if;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null check (role in (
    'Administrator',
    'Manager',
    'Chef / Kitchen Staff',
    'Receptionist',
    'Inventory Clerk'
  )),
  account_status text not null default 'Active'
    check (account_status in ('Pending', 'Active', 'Deactivated', 'Cancelled')),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_lower_uidx
  on public.profiles (lower(email));

create table if not exists public.ingredients (
  id text primary key,
  name text not null,
  category text not null default '',
  unit text not null,
  cost numeric not null default 0 check (cost >= 0),
  stock numeric not null default 0 check (stock >= 0),
  minimum numeric not null default 0 check (minimum >= 0),
  preferred_supplier text not null default '',
  track_expiry boolean not null default false,
  shelf_life_days integer check (shelf_life_days is null or shelf_life_days between 1 and 3650),
  notes text not null default '',
  updated_at timestamptz not null default now()
);

-- PHASE 1: recipes.price is now recipes.menu_price.
create table if not exists public.recipes (
  id text primary key,
  name text not null,
  category text not null default '',
  menu_price numeric not null default 0 check (menu_price >= 0),
  wastage numeric not null default 0 check (wastage >= 0),
  updated_at timestamptz not null default now()
);

-- PHASE 1: retain rerun support for databases created before menu_price.
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

create table if not exists public.recipe_ingredients (
  recipe_id text not null references public.recipes (id) on delete cascade,
  ingredient_id text not null references public.ingredients (id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  updated_at timestamptz not null default now(),
  primary key (recipe_id, ingredient_id)
);

create table if not exists public.inventory_transactions (
  id text primary key,
  ingredient_id text not null references public.ingredients (id) on delete restrict,
  quantity numeric not null check (quantity <> 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  transaction_date date not null default current_date,
  transaction_type text not null,
  note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.production_logs (
  id text primary key,
  recipe_id text not null references public.recipes (id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  production_date date not null default current_date,
  mode text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.waste_logs (
  id text primary key,
  ingredient_id text not null references public.ingredients (id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  reason text not null default '',
  waste_date date not null default current_date,
  recorded_at timestamptz default now(),
  recorded_by uuid references auth.users (id) on delete set null,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.physical_counts (
  id text primary key,
  ingredient_id text not null references public.ingredients (id) on delete restrict,
  expected numeric not null check (expected >= 0),
  actual numeric not null check (actual >= 0),
  count_date date not null default current_date,
  updated_at timestamptz not null default now()
);

-- PHASE 1: revenue status retains Voided alongside Draft and Confirmed.
create table if not exists public.revenue_records (
  id text primary key,
  business_date date not null,
  meal_period text not null,
  adult_customers integer not null default 0 check (adult_customers >= 0),
  adult_rate numeric not null default 0 check (adult_rate >= 0),
  child_customers integer not null default 0 check (child_customers >= 0),
  child_rate numeric not null default 0 check (child_rate >= 0),
  senior_pwd_customers integer not null default 0 check (senior_pwd_customers >= 0),
  senior_pwd_rate numeric not null default 0 check (senior_pwd_rate >= 0),
  status text not null default 'Confirmed' check (status in ('Draft', 'Confirmed', 'Voided')),
  remarks text not null default '',
  recorded_by text not null default '',
  recorded_at timestamptz not null default now(),
  last_edited_by text not null default '',
  last_edited_at timestamptz,
  edit_reason text not null default '',
  voided_by text not null default '',
  void_reason text not null default '',
  voided_at timestamptz,
  updated_at timestamptz not null default now()
);

-- PHASE 1: reservation type and lifecycle timestamps/covers.
create table if not exists public.reservations (
  id text primary key,
  name text not null,
  email text,
  phone text,
  reservation_date date not null,
  reservation_time text not null,
  guests integer not null check (guests > 0),
  type text not null default 'Reservation',
  adults integer not null default 0 check (adults >= 0),
  senior_pwd_count integer not null default 0 check (senior_pwd_count >= 0),
  children integer not null default 0 check (children >= 0),
  source text check (source is null or source in ('Website', 'Phone', 'Facebook', 'Walk-in', 'Other')),
  occasion text not null default '',
  status text not null default 'Pending' check (status in ('Pending', 'Confirmed', 'Cancelled', 'Seated', 'Completed', 'No-show')),
  seated_at timestamptz,
  completed_at timestamptz,
  actual_covers integer check (actual_covers is null or actual_covers >= 0),
  preference text not null default '',
  request text not null default '',
  last_correction_reason text not null default '',
  table_id text,
  -- Keep the original creator UUID as immutable reservation history.
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_contact_check check (
    type = 'Walk-in'
    or nullif(btrim(coalesce(email, '')), '') is not null
    or nullif(btrim(coalesce(phone, '')), '') is not null
  )
);
alter table public.reservations
  add column if not exists last_correction_reason text not null default '';
comment on column public.reservations.last_correction_reason is
  'Reason for the most recent privileged correction to a past reservation; changes are also stored in audit_logs.';

-- PHASE 1: buffet pricing structure.
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

-- PHASE 3: private rate-limit ledger for public reservation submissions.
create table if not exists public.public_reservation_attempts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  contact_key text not null,
  ip text not null default 'unknown'
);
alter table public.public_reservation_attempts enable row level security;
revoke all on table public.public_reservation_attempts from public, anon, authenticated;

create unique index if not exists buffet_rates_active_range_uidx
  on public.buffet_rates (meal_period, day_type, effective_from)
  where is_active;

create extension if not exists btree_gist;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
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
  ('RATE-ALL-DAY-WEEKDAY-20260101', 'All Day', 'weekday', 449, 225, 360, '2026-01-01', null, true),
  ('RATE-ALL-DAY-WEEKEND-20260101', 'All Day', 'weekend', 449, 225, 360, '2026-01-01', null, true),
  ('RATE-ALL-DAY-HOLIDAY-20260101', 'All Day', 'holiday', 449, 225, 360, '2026-01-01', null, true)
on conflict (id) do nothing;

-- PHASE 1: batch quantity remains quantity; covers are tracked separately.
alter table public.production_logs
  add column if not exists covers_produced integer
  constraint production_logs_covers_produced_check
  check (covers_produced is null or covers_produced >= 0);

alter table public.waste_logs
  add column if not exists production_log_id text
  references public.production_logs (id) on delete set null;

-- PHASE 1: link revenue to reservations and buffet rate snapshots.
alter table public.revenue_records
  add column if not exists reservation_id text
  references public.reservations (id) on delete set null,
  add column if not exists rate_id text
  references public.buffet_rates (id) on delete set null;

create index if not exists revenue_records_reservation_id_idx
  on public.revenue_records (reservation_id);
create index if not exists revenue_records_rate_id_idx
  on public.revenue_records (rate_id);
create index if not exists waste_logs_production_log_id_idx
  on public.waste_logs (production_log_id);
create index if not exists waste_logs_recorded_at_idx
  on public.waste_logs (recorded_at desc)
  where recorded_at is not null;
create index if not exists waste_logs_recorded_by_idx
  on public.waste_logs (recorded_by);
create index if not exists reservations_date_time_idx
  on public.reservations (reservation_date, reservation_time);

comment on column public.production_logs.quantity is
  'Number of recipe batches produced.';
comment on column public.production_logs.covers_produced is
  'Nullable number of buffet covers produced by the batches.';
-- Guest totals include adults, Senior/PWD, and kids. Legacy records may
-- intentionally have only the total, so leave this constraint unvalidated.
alter table public.reservations
  drop constraint if exists reservations_guest_count_check;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reservations'::regclass
      and conname = 'reservations_guest_count_check'
  ) then
    alter table public.reservations
      add constraint reservations_guest_count_check
      check (guests = adults + senior_pwd_count + children) not valid;
  end if;
end;
$$;

-- A negative inventory movement is valid for issues/adjustments, but zero is not.
alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_quantity_check;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.inventory_transactions'::regclass
      and conname = 'inventory_transactions_quantity_nonzero_check'
  ) then
    alter table public.inventory_transactions
      add constraint inventory_transactions_quantity_nonzero_check check (quantity <> 0);
  end if;
end;
$$;

create table if not exists public.restaurant_tables (
  id text primary key,
  seats integer not null check (seats > 0),
  table_type text not null default 'Unassigned',
  area text not null default 'Unassigned',
  status text not null default 'Available',
  x numeric not null default 0,
  y numeric not null default 0,
  guest text not null default '',
  constraint restaurant_tables_table_type_check
    check (table_type in ('Family', 'Casual', 'Unassigned')),
  constraint restaurant_tables_area_check
    check (area in ('Front', 'Back', 'Unassigned')),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_tables
  add column if not exists table_type text not null default 'Unassigned',
  add column if not exists area text not null default 'Unassigned';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.restaurant_tables'::regclass
      and conname = 'restaurant_tables_table_type_check'
  ) then
    alter table public.restaurant_tables
      add constraint restaurant_tables_table_type_check
      check (table_type in ('Family', 'Casual', 'Unassigned'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.restaurant_tables'::regclass
      and conname = 'restaurant_tables_area_check'
  ) then
    alter table public.restaurant_tables
      add constraint restaurant_tables_area_check
      check (area in ('Front', 'Back', 'Unassigned'));
  end if;
end;
$$;

comment on column public.restaurant_tables.table_type is
  'Restaurant seating category: Family, Casual, or Unassigned.';
comment on column public.restaurant_tables.area is
  'Restaurant seating area: Front, Back, or Unassigned.';

-- PHASE 3: normalize table status values used by lifecycle automation.
update public.restaurant_tables
set status = case lower(status)
  when 'available' then 'Available'
  when 'occupied' then 'Occupied'
  when 'reserved' then 'Reserved'
  else status
end
where lower(status) in ('available', 'occupied', 'reserved');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reservations'::regclass
      and conname = 'reservations_table_id_fkey'
  ) then
    alter table public.reservations
      add constraint reservations_table_id_fkey
      foreign key (table_id) references public.restaurant_tables (id)
      on update cascade on delete set null not valid;
  end if;
end;
$$;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default clock_timestamp()
);

create table if not exists public.profile_admin_guard (
  singleton boolean primary key default true check (singleton),
  administrator_count integer not null check (administrator_count >= 0)
);
insert into public.profile_admin_guard (singleton, administrator_count)
select true, count(*)::integer
from public.profiles
where role = 'Administrator'
  and account_status = 'Active'
on conflict (singleton) do nothing;

create table if not exists public.profile_role_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  old_role text not null,
  new_role text not null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default clock_timestamp(),
  reason text not null default '' check (char_length(reason) <= 500)
);

create table if not exists public.user_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  role text not null check (role in (
    'Administrator',
    'Manager',
    'Receptionist',
    'Inventory Clerk',
    'Chef / Kitchen Staff'
  )),
  status text not null default 'Pending'
    check (status in ('Pending', 'Accepted', 'Expired', 'Cancelled')),
  invited_by uuid not null
    references public.profiles (id) on delete restrict,
  invited_at timestamptz not null default clock_timestamp(),
  accepted_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint user_invites_email_valid check (
    char_length(email) between 3 and 254
    and char_length(split_part(email, '@', 1)) between 1 and 64
    and email = lower(btrim(email))
    and email ~ $invite_email$^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$invite_email$
  ),
  constraint user_invites_full_name_valid check (
    char_length(btrim(full_name)) between 1 and 160
  ),
  constraint user_invites_expiry_after_invite check (expires_at > invited_at),
  constraint user_invites_accepted_at_matches_status check (
    (status = 'Accepted' and accepted_at is not null)
    or (status <> 'Accepted' and accepted_at is null)
  )
);

create table if not exists public.profile_account_status_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  old_status text not null check (
    old_status in ('Pending', 'Active', 'Deactivated', 'Cancelled')
  ),
  new_status text not null check (
    new_status in ('Pending', 'Active', 'Deactivated', 'Cancelled')
  ),
  changed_by uuid references auth.users (id) on delete set null,
  invitation_id uuid references public.user_invites (id) on delete restrict,
  changed_at timestamptz not null default clock_timestamp(),
  reason text not null default '' check (char_length(reason) <= 500)
);

create unique index if not exists user_invites_one_pending_per_email_uidx
  on public.user_invites (email)
  where status = 'Pending';
create index if not exists user_invites_status_invited_at_idx
  on public.user_invites (status, invited_at desc);

create table if not exists public.app_records_migrations (
  migration_key text primary key,
  applied_at timestamptz not null default clock_timestamp()
);
alter table public.app_records_migrations enable row level security;
revoke all on table public.app_records_migrations from public, anon, authenticated;

create table if not exists public.app_records_migration_errors (
  migration_key text primary key,
  error_text text not null,
  detected_at timestamptz not null default clock_timestamp()
);
alter table public.app_records_migration_errors enable row level security;
revoke all on table public.app_records_migration_errors from public, anon, authenticated;

create index if not exists recipe_ingredients_ingredient_idx
  on public.recipe_ingredients (ingredient_id);
create index if not exists inventory_transactions_ingredient_date_idx
  on public.inventory_transactions (ingredient_id, transaction_date desc);
create index if not exists production_logs_recipe_date_idx
  on public.production_logs (recipe_id, production_date desc);
create index if not exists waste_logs_ingredient_date_idx
  on public.waste_logs (ingredient_id, waste_date desc);
create index if not exists physical_counts_ingredient_date_idx
  on public.physical_counts (ingredient_id, count_date desc);
create index if not exists revenue_records_business_date_idx
  on public.revenue_records (business_date desc);
create unique index if not exists revenue_records_active_period_uidx
  on public.revenue_records (business_date, meal_period)
  where status in ('Draft', 'Confirmed');
create index if not exists reservations_date_status_idx
  on public.reservations (reservation_date, status);
create index if not exists reservations_table_id_idx
  on public.reservations (table_id);
create index if not exists reservations_created_by_idx
  on public.reservations (created_by);
create unique index if not exists reservations_active_assigned_table_uidx
  on public.reservations (table_id, reservation_date, reservation_time)
  where table_id is not null and status not in ('Cancelled', 'Completed', 'No-show');
create index if not exists audit_logs_table_record_time_idx
  on public.audit_logs (table_name, record_id, occurred_at desc);
create index if not exists audit_logs_actor_time_idx
  on public.audit_logs (actor_id, occurred_at desc);

-- Backfill the legacy JSON store as one atomic, repeat-safe migration. Any
-- malformed row, unsupported value, FK failure, or conflicting typed id aborts
-- the whole block and leaves every app_records row untouched for resolution.
-- The marker makes subsequent schema reruns skip an already completed import.
do $$
declare
  source_row record;
  ingredient_row jsonb;
  ingredient_key text;
  ingredient_quantity numeric;
  migration_key_value constant text := 'typed_app_records_backfill_v1';
begin
  if to_regclass('public.app_records') is null then
    return;
  end if;

  if exists (
    select 1 from public.app_records_migrations
    where migration_key = migration_key_value
  ) then
    return;
  end if;

  begin
  -- Collections and mappings:
  -- ingredients -> ingredients
  -- recipes (+ ingredients[].ingredientId/ingredient_id) -> recipes and recipe_ingredients
  -- inventoryTransactions -> inventory_transactions
  -- productionLogs -> production_logs
  -- wasteLogs -> waste_logs
  -- physicalCounts -> physical_counts
  -- revenueRecords -> revenue_records
  -- reservations -> reservations
  -- restaurantTables -> restaurant_tables
  -- users are deliberately excluded (demo identities are not Auth users).

  for source_row in
    select record_id, data
    from public.app_records
    where collection = 'ingredients'
    order by record_id
  loop
    begin
      if jsonb_typeof(source_row.data) is distinct from 'object'
         or nullif(source_row.record_id, '') is null
         or (source_row.data ? 'id' and source_row.data ->> 'id' is distinct from source_row.record_id)
         or nullif(source_row.data ->> 'name', '') is null
         or source_row.data ->> 'category' is null
         or nullif(source_row.data ->> 'unit', '') is null
         or source_row.data ->> 'cost' is null
         or source_row.data ->> 'stock' is null
         or source_row.data ->> 'minimum' is null then
        raise exception 'missing or inconsistent required ingredient fields';
      end if;
      if exists (select 1 from public.ingredients where id = source_row.record_id) then
        raise exception 'typed ingredients id already exists; resolve the collision before backfill';
      end if;
      insert into public.ingredients (id, name, category, unit, cost, stock, minimum)
      values (
        source_row.record_id, source_row.data ->> 'name', source_row.data ->> 'category',
        source_row.data ->> 'unit', (source_row.data ->> 'cost')::numeric,
        (source_row.data ->> 'stock')::numeric, (source_row.data ->> 'minimum')::numeric
      );
    exception when others then
      raise exception 'Cannot backfill app_records ingredients/%: %', source_row.record_id, sqlerrm;
    end;
  end loop;

  for source_row in
    select record_id, data
    from public.app_records
    where collection = 'recipes'
    order by record_id
  loop
    begin
      if jsonb_typeof(source_row.data) is distinct from 'object'
         or nullif(source_row.record_id, '') is null
         or (source_row.data ? 'id' and source_row.data ->> 'id' is distinct from source_row.record_id)
         or nullif(source_row.data ->> 'name', '') is null
         or source_row.data ->> 'category' is null
         or source_row.data ->> 'price' is null
         or source_row.data ->> 'wastage' is null
         or jsonb_typeof(source_row.data -> 'ingredients') is distinct from 'array' then
        raise exception 'missing or inconsistent required recipe fields';
      end if;
      if exists (select 1 from public.recipes where id = source_row.record_id) then
        raise exception 'typed recipes id already exists; resolve the collision before backfill';
      end if;
      insert into public.recipes (id, name, category, menu_price, wastage)
      values (
        source_row.record_id, source_row.data ->> 'name', source_row.data ->> 'category',
        (source_row.data ->> 'price')::numeric, (source_row.data ->> 'wastage')::numeric
      );

      for ingredient_row in
        select value from jsonb_array_elements(source_row.data -> 'ingredients')
      loop
        if jsonb_typeof(ingredient_row) is distinct from 'object'
           or nullif(coalesce(ingredient_row ->> 'ingredientId', ingredient_row ->> 'ingredient_id'), '') is null
           or ingredient_row ->> 'quantity' is null then
          raise exception 'recipe ingredient is missing ingredientId/ingredient_id or quantity';
        end if;
        ingredient_key := coalesce(ingredient_row ->> 'ingredientId', ingredient_row ->> 'ingredient_id');
        ingredient_quantity := (ingredient_row ->> 'quantity')::numeric;
        insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity)
        values (source_row.record_id, ingredient_key, ingredient_quantity);
      end loop;
    exception when others then
      raise exception 'Cannot backfill app_records recipes/%: %', source_row.record_id, sqlerrm;
    end;
  end loop;

  for source_row in
    select record_id, data
    from public.app_records
    where collection = 'inventoryTransactions'
    order by record_id
  loop
    begin
      if jsonb_typeof(source_row.data) is distinct from 'object'
         or nullif(source_row.record_id, '') is null
         or (source_row.data ? 'id' and source_row.data ->> 'id' is distinct from source_row.record_id)
         or nullif(source_row.data ->> 'ingredientId', '') is null
         or source_row.data ->> 'quantity' is null
         or source_row.data ->> 'unitCost' is null
         or coalesce(source_row.data ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
         or nullif(source_row.data ->> 'type', '') is null then
        raise exception 'missing or inconsistent required inventory transaction fields';
      end if;
      if exists (select 1 from public.inventory_transactions where id = source_row.record_id) then
        raise exception 'typed inventory_transactions id already exists; resolve the collision before backfill';
      end if;
      insert into public.inventory_transactions (
        id, ingredient_id, quantity, unit_cost, transaction_date, transaction_type, note
      ) values (
        source_row.record_id, source_row.data ->> 'ingredientId',
        (source_row.data ->> 'quantity')::numeric, (source_row.data ->> 'unitCost')::numeric,
        (source_row.data ->> 'date')::date, source_row.data ->> 'type',
        coalesce(source_row.data ->> 'note', '')
      );
    exception when others then
      raise exception 'Cannot backfill app_records inventoryTransactions/%: %', source_row.record_id, sqlerrm;
    end;
  end loop;

  for source_row in
    select record_id, data
    from public.app_records
    where collection = 'productionLogs'
    order by record_id
  loop
    begin
      if jsonb_typeof(source_row.data) is distinct from 'object'
         or nullif(source_row.record_id, '') is null
         or (source_row.data ? 'id' and source_row.data ->> 'id' is distinct from source_row.record_id)
         or nullif(source_row.data ->> 'recipeId', '') is null
         or source_row.data ->> 'quantity' is null
         or coalesce(source_row.data ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
         or source_row.data ->> 'mode' is null then
        raise exception 'missing or inconsistent required production log fields';
      end if;
      if exists (select 1 from public.production_logs where id = source_row.record_id) then
        raise exception 'typed production_logs id already exists; resolve the collision before backfill';
      end if;
      insert into public.production_logs (id, recipe_id, quantity, production_date, mode)
      values (
        source_row.record_id, source_row.data ->> 'recipeId',
        (source_row.data ->> 'quantity')::numeric, (source_row.data ->> 'date')::date,
        source_row.data ->> 'mode'
      );
    exception when others then
      raise exception 'Cannot backfill app_records productionLogs/%: %', source_row.record_id, sqlerrm;
    end;
  end loop;

  for source_row in
    select record_id, data
    from public.app_records
    where collection = 'wasteLogs'
    order by record_id
  loop
    begin
      if jsonb_typeof(source_row.data) is distinct from 'object'
         or nullif(source_row.record_id, '') is null
         or (source_row.data ? 'id' and source_row.data ->> 'id' is distinct from source_row.record_id)
         or nullif(source_row.data ->> 'ingredientId', '') is null
         or source_row.data ->> 'quantity' is null
         or source_row.data ->> 'reason' is null
         or coalesce(source_row.data ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'missing or inconsistent required waste log fields';
      end if;
      if exists (select 1 from public.waste_logs where id = source_row.record_id) then
        raise exception 'typed waste_logs id already exists; resolve the collision before backfill';
      end if;
      insert into public.waste_logs (
        id, ingredient_id, quantity, reason, waste_date, recorded_at
      )
      values (
        source_row.record_id, source_row.data ->> 'ingredientId',
        (source_row.data ->> 'quantity')::numeric, source_row.data ->> 'reason',
        (source_row.data ->> 'date')::date, null
      );
    exception when others then
      raise exception 'Cannot backfill app_records wasteLogs/%: %', source_row.record_id, sqlerrm;
    end;
  end loop;

  for source_row in
    select record_id, data
    from public.app_records
    where collection = 'physicalCounts'
    order by record_id
  loop
    begin
      if jsonb_typeof(source_row.data) is distinct from 'object'
         or nullif(source_row.record_id, '') is null
         or (source_row.data ? 'id' and source_row.data ->> 'id' is distinct from source_row.record_id)
         or nullif(source_row.data ->> 'ingredientId', '') is null
         or source_row.data ->> 'expected' is null
         or source_row.data ->> 'actual' is null
         or coalesce(source_row.data ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'missing or inconsistent required physical count fields';
      end if;
      if exists (select 1 from public.physical_counts where id = source_row.record_id) then
        raise exception 'typed physical_counts id already exists; resolve the collision before backfill';
      end if;
      insert into public.physical_counts (id, ingredient_id, expected, actual, count_date)
      values (
        source_row.record_id, source_row.data ->> 'ingredientId',
        (source_row.data ->> 'expected')::numeric, (source_row.data ->> 'actual')::numeric,
        (source_row.data ->> 'date')::date
      );
    exception when others then
      raise exception 'Cannot backfill app_records physicalCounts/%: %', source_row.record_id, sqlerrm;
    end;
  end loop;

  for source_row in
    select record_id, data
    from public.app_records
    where collection = 'revenueRecords'
    order by record_id
  loop
    begin
      if jsonb_typeof(source_row.data) is distinct from 'object'
         or nullif(source_row.record_id, '') is null
         or (source_row.data ? 'id' and source_row.data ->> 'id' is distinct from source_row.record_id)
         or coalesce(source_row.data ->> 'business_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
         or nullif(source_row.data ->> 'meal_period', '') is null
         or source_row.data ->> 'adult_customers' is null
         or source_row.data ->> 'adult_rate' is null
         or source_row.data ->> 'child_customers' is null
         or source_row.data ->> 'child_rate' is null
         or source_row.data ->> 'senior_pwd_customers' is null
         or source_row.data ->> 'senior_pwd_rate' is null
         or nullif(source_row.data ->> 'status', '') is null then
        raise exception 'missing or inconsistent required revenue fields';
      end if;
      if exists (select 1 from public.revenue_records where id = source_row.record_id) then
        raise exception 'typed revenue_records id already exists; resolve the collision before backfill';
      end if;
      insert into public.revenue_records (
        id, business_date, meal_period, adult_customers, adult_rate,
        child_customers, child_rate, senior_pwd_customers, senior_pwd_rate,
        status, remarks, recorded_by, recorded_at, last_edited_by,
        last_edited_at, edit_reason, voided_by, void_reason, voided_at
      ) values (
        source_row.record_id, (source_row.data ->> 'business_date')::date,
        source_row.data ->> 'meal_period', (source_row.data ->> 'adult_customers')::integer,
        (source_row.data ->> 'adult_rate')::numeric, (source_row.data ->> 'child_customers')::integer,
        (source_row.data ->> 'child_rate')::numeric, (source_row.data ->> 'senior_pwd_customers')::integer,
        (source_row.data ->> 'senior_pwd_rate')::numeric,
        case when source_row.data ->> 'status' = 'Active' then 'Confirmed'
             else source_row.data ->> 'status' end,
        coalesce(source_row.data ->> 'remarks', ''), coalesce(source_row.data ->> 'recorded_by', ''),
        coalesce((source_row.data ->> 'recorded_at')::timestamptz, now()),
        coalesce(source_row.data ->> 'last_edited_by', ''),
        (source_row.data ->> 'last_edited_at')::timestamptz,
        coalesce(source_row.data ->> 'edit_reason', ''), coalesce(source_row.data ->> 'voided_by', ''),
        coalesce(source_row.data ->> 'void_reason', ''), (source_row.data ->> 'voided_at')::timestamptz
      );
    exception when others then
      raise exception 'Cannot backfill app_records revenueRecords/%: %', source_row.record_id, sqlerrm;
    end;
  end loop;

  for source_row in
    select record_id, data
    from public.app_records
    where collection = 'restaurantTables'
    order by record_id
  loop
    begin
      if jsonb_typeof(source_row.data) is distinct from 'object'
         or nullif(source_row.record_id, '') is null
         or (source_row.data ? 'id' and source_row.data ->> 'id' is distinct from source_row.record_id)
         or source_row.data ->> 'seats' is null
         or source_row.data ->> 'status' is null
         or source_row.data ->> 'x' is null
         or source_row.data ->> 'y' is null then
        raise exception 'missing or inconsistent required restaurant table fields';
      end if;
      if exists (select 1 from public.restaurant_tables where id = source_row.record_id) then
        raise exception 'typed restaurant_tables id already exists; resolve the collision before backfill';
      end if;
      insert into public.restaurant_tables (id, seats, status, x, y, guest)
      values (
        source_row.record_id, (source_row.data ->> 'seats')::integer,
        source_row.data ->> 'status', (source_row.data ->> 'x')::numeric,
        (source_row.data ->> 'y')::numeric, coalesce(source_row.data ->> 'guest', '')
      );
    exception when others then
      raise exception 'Cannot backfill app_records restaurantTables/%: %', source_row.record_id, sqlerrm;
    end;
  end loop;

  for source_row in
    select record_id, data
    from public.app_records
    where collection = 'reservations'
    order by record_id
  loop
    begin
      if jsonb_typeof(source_row.data) is distinct from 'object'
         or nullif(source_row.record_id, '') is null
         or (source_row.data ? 'id' and source_row.data ->> 'id' is distinct from source_row.record_id)
         or nullif(source_row.data ->> 'name', '') is null
         or coalesce(source_row.data ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
         or nullif(source_row.data ->> 'time', '') is null
         or source_row.data ->> 'guests' is null then
        raise exception 'missing or inconsistent required reservation fields';
      end if;
      if exists (select 1 from public.reservations where id = source_row.record_id) then
        raise exception 'typed reservations id already exists; resolve the collision before backfill';
      end if;
      insert into public.reservations (
        id, name, email, phone, reservation_date, reservation_time, guests,
        adults, children, occasion, status, preference, request, table_id,
        created_by, created_at
      ) values (
        source_row.record_id, source_row.data ->> 'name',
        nullif(source_row.data ->> 'email', ''), nullif(source_row.data ->> 'phone', ''),
        (source_row.data ->> 'date')::date, source_row.data ->> 'time',
        (source_row.data ->> 'guests')::integer,
        coalesce(nullif(source_row.data ->> 'adults', '')::integer, (source_row.data ->> 'guests')::integer),
        coalesce(nullif(source_row.data ->> 'children', '')::integer, 0),
        coalesce(source_row.data ->> 'occasion', ''), coalesce(source_row.data ->> 'status', 'Pending'),
        coalesce(source_row.data ->> 'preference', ''),
        coalesce(source_row.data ->> 'request', source_row.data ->> 'requests', ''),
        nullif(coalesce(source_row.data ->> 'table', source_row.data ->> 'table_id'), ''),
        null,
        coalesce((source_row.data ->> 'created_at')::timestamptz, now())
      );
    exception when others then
      raise exception 'Cannot backfill app_records reservations/%: %', source_row.record_id, sqlerrm;
    end;
  end loop;

  -- Mark completion only after every supported collection has imported. The
  -- source JSON remains intact and locked; users and unknown collections are
  -- deliberately not copied into typed business tables.
  insert into public.app_records_migrations (migration_key)
  values (migration_key_value);
  delete from public.app_records_migration_errors
  where migration_key = migration_key_value;
  exception when others then
    -- This exception rolls back every typed insert above, but records a
    -- precise failure while allowing the rest of the schema to finish locking
    -- app_records. The source rows remain intact for repair and safe retry.
    insert into public.app_records_migration_errors (migration_key, error_text)
    values (migration_key_value, sqlerrm)
    on conflict (migration_key) do update
      set error_text = excluded.error_text,
          detected_at = clock_timestamp();
  end;
end;
$$;

-- Timestamp values are returned by PostgREST and can be used as the
-- optimistic-concurrency token in .update/.delete(...).eq('updated_at', token).
-- Apply the exact returned token as an additional equality filter per typed row;
-- zero affected rows means the cached version is stale and should be reloaded.
-- Stock balances are ledger-maintained: insert movement/count records rather
-- than updating ingredients.stock directly.
do $$
begin
  begin
    alter table public.reservations
      validate constraint reservations_guest_count_check;
    delete from public.app_records_migration_errors
    where migration_key = 'typed_app_records_backfill_v1'
      and error_text like 'Typed reservations contain guest counts%';
  exception when check_violation then
    insert into public.app_records_migration_errors (migration_key, error_text)
    values (
      'typed_app_records_backfill_v1',
      'Typed reservations contain guest counts where guests does not equal adults + senior_pwd_count + children; correct those rows to validate reservations_guest_count_check.'
    )
    on conflict (migration_key) do update
      set error_text = excluded.error_text, detected_at = clock_timestamp();
  end;
  begin
    alter table public.reservations
      validate constraint reservations_table_id_fkey;
    delete from public.app_records_migration_errors
    where migration_key = 'typed_app_records_backfill_v1'
      and error_text like 'Typed reservations reference missing restaurant_tables%';
  exception when foreign_key_violation then
    insert into public.app_records_migration_errors (migration_key, error_text)
    values (
      'typed_app_records_backfill_v1',
      'Typed reservations reference missing restaurant_tables rows; correct the table assignments to validate reservations_table_id_fkey.'
    )
    on conflict (migration_key) do update
      set error_text = excluded.error_text, detected_at = clock_timestamp();
  end;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

create or replace function public.guard_user_invite()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  inviter_role text;
begin
  if tg_op = 'INSERT' then
    new.email := lower(btrim(new.email));
    new.full_name := btrim(new.full_name);
    new.invited_at := clock_timestamp();
    new.created_at := new.invited_at;
    new.updated_at := new.invited_at;

    if new.status <> 'Pending' then
      raise exception 'New invitations must start as Pending'
        using errcode = '23514';
    end if;

    select profile.role
    into inviter_role
    from public.profiles as profile
    where profile.id = new.invited_by
      and profile.account_status = 'Active'
    for share;

    if inviter_role is distinct from 'Administrator' then
      raise exception 'The inviter must be an active Administrator'
        using errcode = '42501';
    end if;

    if exists (
      select 1
      from public.profiles as profile
      where lower(profile.email) = new.email
    ) then
      raise exception 'A profile already exists for this email address'
        using errcode = '23505';
    end if;

    return new;
  elsif tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.full_name is distinct from old.full_name
      or new.role is distinct from old.role
      or new.invited_by is distinct from old.invited_by
      or new.invited_at is distinct from old.invited_at
      or new.created_at is distinct from old.created_at then
      raise exception 'Invitation identity fields cannot be changed'
        using errcode = '55000';
    end if;

    if old.status not in ('Pending', 'Expired')
      and new.expires_at is distinct from old.expires_at then
      raise exception 'A completed invitation expiry cannot be changed'
        using errcode = '55000';
    end if;

    if new.status is distinct from old.status then
      if auth.role() is distinct from 'service_role' then
        raise exception 'Invitation status changes must use the authorized lifecycle workflow'
          using errcode = '42501';
      end if;
      if old.status not in ('Pending', 'Expired') then
        raise exception 'A completed invitation cannot change status'
          using errcode = '55000';
      end if;

      if new.status = 'Accepted' then
        if old.status <> 'Pending' or old.expires_at <= clock_timestamp() then
          raise exception 'An expired invitation cannot be accepted'
            using errcode = '23514';
        end if;
        new.accepted_at := clock_timestamp();
        if new.accepted_at < old.invited_at
          or new.accepted_at > clock_timestamp() then
          raise exception 'The acceptance timestamp is invalid'
            using errcode = '23514';
        end if;
      elsif new.status = 'Expired' then
        if old.status <> 'Pending' or old.expires_at > clock_timestamp() then
          raise exception 'An invitation cannot expire before its expiry time'
            using errcode = '23514';
        end if;
        new.accepted_at := null;
      elsif new.status = 'Cancelled' then
        new.accepted_at := null;
      else
        raise exception 'Unsupported invitation status transition'
          using errcode = '23514';
      end if;
    elsif new.accepted_at is distinct from old.accepted_at then
      raise exception 'Acceptance timestamps can only change with invitation status'
        using errcode = '55000';
    end if;

    return new;
  elsif tg_op = 'DELETE' then
    raise exception 'Invitation records cannot be deleted; change their status instead'
      using errcode = '55000';
  end if;

  raise exception 'Unsupported user_invites operation: %', tg_op
    using errcode = '55000';
end;
$$;

revoke all on function public.guard_user_invite() from public, anon, authenticated;

drop trigger if exists user_invites_guard on public.user_invites;
create trigger user_invites_guard
  before insert or update or delete on public.user_invites
  for each row execute function public.guard_user_invite();

drop trigger if exists user_invites_touch_updated_at on public.user_invites;
create trigger user_invites_touch_updated_at
  before update on public.user_invites
  for each row execute function public.touch_updated_at();

-- The trigger is installed on every mutable typed table (not the append-only audit log).
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'profiles',
    'ingredients',
    'recipes',
    'recipe_ingredients',
    'inventory_transactions',
    'production_logs',
    'waste_logs',
    'physical_counts',
    'revenue_records',
    'reservations',
    'restaurant_tables'
  ] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', relation_name);
    execute format(
      'create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()',
      relation_name
    );
  end loop;
end;
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select p.role
  from public.profiles as p
  where p.id = auth.uid()
    and p.account_status = 'Active'
$$;

create or replace function public.has_app_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = auth.uid()
      and p.account_status = 'Active'
      and p.role = any (allowed_roles)
  )
$$;

create or replace function public.costtrack_mark_table_clean(p_table_id text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated_table_id text;
begin
  if not public.has_app_role(array['Receptionist']) then
    raise exception 'Only Receptionists can use this table-cleaning action.'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_table_id), '') is null then
    raise exception 'A table is required.';
  end if;

  update public.restaurant_tables
  set status = 'Available'
  where id = p_table_id
    and status = 'Needs cleaning'
  returning id into updated_table_id;

  if updated_table_id is null then
    raise exception 'This table no longer needs cleaning.'
      using errcode = '55000';
  end if;
  return true;
end;
$$;

create or replace function public.apply_inventory_transaction_stock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  prior_stock_permission text;
  stock_updated boolean;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Inventory transactions are append-only' using errcode = '55000';
  end if;

  prior_stock_permission := current_setting('costtrack.stock_movement', true);
  perform set_config('costtrack.stock_movement', 'on', true);
  update public.ingredients
  set stock = stock + new.quantity,
      cost = case
        when new.transaction_type = 'Receiving'
             and new.unit_cost > 0
          then new.unit_cost
        else cost
      end
  where id = new.ingredient_id
    and stock + new.quantity >= 0;
  stock_updated := found;
  perform set_config('costtrack.stock_movement', coalesce(prior_stock_permission, ''), true);
  if not stock_updated then
    raise exception 'Inventory movement would make stock negative or ingredient is missing'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- PHASE 3: revenue rows cannot contain positive rates with zero covers.
create or replace function public.validate_revenue_record()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.adult_customers = 0
     and new.child_customers = 0
     and new.senior_pwd_customers = 0
     and (new.adult_rate > 0 or new.child_rate > 0 or new.senior_pwd_rate > 0) then
    raise exception 'Revenue records require at least one customer when rates are positive'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- PHASE 3: only administrators may void revenue or edit void metadata.
create or replace function public.prevent_unauthorized_revenue_void()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not public.has_app_role(array['Administrator'])
     and (
       new.status = 'Voided'
       or new.status is distinct from old.status
          and old.status = 'Voided'
       or new.voided_by is distinct from old.voided_by
       or new.void_reason is distinct from old.void_reason
       or new.voided_at is distinct from old.voided_at
     ) then
    raise exception 'Only an Administrator may void revenue records'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- PHASE 3: enforce reservation lifecycle, timestamps, and table occupancy.
create or replace function public.enforce_reservation_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  table_is_held boolean;
begin
  if tg_op = 'INSERT' then
    if new.type = 'Walk-in' then
      if new.status not in ('Pending', 'Seated') then
        raise exception 'Walk-ins may start only as Pending or Seated'
          using errcode = '23514';
      end if;
    elsif new.status <> 'Pending' then
      raise exception 'Reservations must start as Pending'
        using errcode = '23514';
    end if;
  elsif new.status is distinct from old.status then
    if not (
      (old.status = 'Pending' and new.status in ('Confirmed', 'Cancelled', 'No-show'))
      or (old.status = 'Confirmed' and new.status in ('Seated', 'Cancelled', 'No-show'))
      or (old.status = 'Seated' and new.status = 'Completed')
    ) then
      raise exception 'Invalid reservation status transition from % to %',
        old.status, new.status using errcode = '23514';
    end if;
  end if;

  if new.status = 'Seated' then
    if coalesce(new.actual_covers, 0) <= 0 then
      raise exception 'actual_covers must be greater than zero when seated'
        using errcode = '23514';
    end if;
    if new.seated_at is null then
      new.seated_at := clock_timestamp();
    end if;
  end if;
  if new.status = 'Completed' and new.completed_at is null then
    new.completed_at := clock_timestamp();
  end if;

  if tg_op = 'INSERT'
     or new.status is distinct from old.status
     or new.table_id is distinct from old.table_id
     or new.reservation_date is distinct from old.reservation_date
     or new.reservation_time is distinct from old.reservation_time then
    if new.table_id is not null and new.status = 'Seated' then
      update public.restaurant_tables
      set status = 'Occupied',
          guest = new.name
      where id = new.table_id;
    elsif new.table_id is not null
          and new.status in ('Completed', 'Cancelled', 'No-show') then
      select exists (
        select 1
        from public.reservations as r
        where r.id <> new.id
          and r.table_id = new.table_id
          and r.reservation_date = new.reservation_date
          and r.reservation_time = new.reservation_time
          and r.status in ('Pending', 'Confirmed', 'Seated')
      ) into table_is_held;
      if table_is_held then
        update public.restaurant_tables
        set status = 'Reserved'
        where id = new.table_id;
      else
        update public.restaurant_tables
        set status = 'Available',
            guest = ''
        where id = new.table_id;
      end if;
    end if;
  elsif tg_op = 'UPDATE'
        and new.status = 'Seated'
        and new.table_id is not null
        and new.reservation_date >= current_date
        and new.name is distinct from old.name then
    update public.restaurant_tables
    set guest = new.name
    where id = new.table_id;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_reservation_table_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  table_capacity integer;
  total_covers integer;
  capacity_covers integer;
  guest_counts_changed boolean;
begin
  total_covers := coalesce(new.adults, 0)
    + coalesce(new.senior_pwd_count, 0)
    + coalesce(new.children, 0);
  guest_counts_changed := tg_op = 'INSERT'
    or new.adults is distinct from old.adults
    or new.senior_pwd_count is distinct from old.senior_pwd_count
    or new.children is distinct from old.children;

  if guest_counts_changed or new.guests is distinct from old.guests then
    if total_covers < 1 or total_covers > 1000 then
      raise exception 'Reservation guest counts must total between 1 and 1,000'
        using errcode = '23514';
    end if;
    new.guests := total_covers;
  end if;
  capacity_covers := case
    when new.type = 'Walk-in' and total_covers > 0 then total_covers
    when total_covers > 0 then coalesce(new.actual_covers, total_covers)
    else coalesce(new.actual_covers, new.guests, 0)
  end;

  if new.type = 'Walk-in' and new.status = 'Seated'
     and (tg_op = 'INSERT' or guest_counts_changed
       or new.status is distinct from old.status) then
    new.actual_covers := total_covers;
  end if;

  if tg_op = 'INSERT'
     or new.table_id is distinct from old.table_id
     or new.guests is distinct from old.guests
     or new.adults is distinct from old.adults
     or new.senior_pwd_count is distinct from old.senior_pwd_count
     or new.children is distinct from old.children
     or new.actual_covers is distinct from old.actual_covers then
    if new.table_id is not null then
      select seats into table_capacity
      from public.restaurant_tables
      where id = new.table_id;
      if not found then
        raise exception 'The selected table does not exist'
          using errcode = '23503';
      end if;
      if capacity_covers > table_capacity then
        raise exception 'The selected table does not have enough seats for this reservation'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.set_public_reservation_source()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.id like 'RSV-%' then
    new.source := 'Website';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_reservation_table_overlap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  new_start integer;
begin
  if new.table_id is null or new.status not in ('Pending', 'Confirmed', 'Seated') then
    return new;
  end if;

  if not public.reservation_time_within_open_hours(new.reservation_time) then
    raise exception 'The two-hour reservation window must fit between 10:00 AM and 9:00 PM'
      using errcode = '23514';
  end if;
  new_start := public.reservation_time_to_minutes(new.reservation_time);

  perform pg_advisory_xact_lock(hashtext(new.table_id), hashtext(new.reservation_date::text));

  if exists (
    select 1
    from public.reservations existing
    where existing.table_id = new.table_id
      and existing.id <> new.id
      and existing.status in ('Pending', 'Confirmed', 'Seated')
      and (
        (existing.status = 'Seated' and existing.reservation_date < new.reservation_date and new.reservation_date = current_date)
        or (
          existing.reservation_date = new.reservation_date
          and new_start < public.reservation_time_to_minutes(existing.reservation_time) + 120
          and public.reservation_time_to_minutes(existing.reservation_time) < new_start + 120
        )
      )
  ) then
    raise exception 'The selected table already has an overlapping two-hour reservation'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_restaurant_table_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Table identifiers cannot be changed after creation'
      using errcode = '23514';
  end if;
  if new.seats is distinct from old.seats
     and exists (
       select 1
       from public.reservations
       where table_id = old.id
         and reservation_date >= current_date
         and status in ('Pending', 'Confirmed', 'Seated')
         and coalesce(actual_covers, guests) > new.seats
     ) then
    raise exception 'Table capacity cannot be reduced below an assigned active party'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_table_delete_with_reservations()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1
    from public.reservations
    where table_id = old.id
  ) then
    raise exception 'Tables linked to reservation history cannot be deleted'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

create or replace function public.apply_production_stock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  recipe_line record;
  ingredient_updated boolean;
  prior_stock_permission text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Production logs are append-only' using errcode = '55000';
  end if;

  prior_stock_permission := current_setting('costtrack.stock_movement', true);
  perform set_config('costtrack.stock_movement', 'on', true);
  for recipe_line in
    select ingredient_id, quantity
    from public.recipe_ingredients
    where recipe_id = new.recipe_id
    order by ingredient_id
  loop
    update public.ingredients
    set stock = stock - (recipe_line.quantity * new.quantity)
    where id = recipe_line.ingredient_id
      and stock >= recipe_line.quantity * new.quantity;
    ingredient_updated := found;
    if not ingredient_updated then
      raise exception 'Production would make stock negative for ingredient %',
        recipe_line.ingredient_id using errcode = '23514';
    end if;
  end loop;
  perform set_config('costtrack.stock_movement', coalesce(prior_stock_permission, ''), true);
  return new;
end;
$$;

create or replace function public.apply_waste_stock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  prior_stock_permission text;
  stock_updated boolean;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Waste logs are append-only' using errcode = '55000';
  end if;

  if new.recorded_at is null and auth.uid() is not null then
    new.recorded_at := now();
  end if;
  new.recorded_by := auth.uid();

  prior_stock_permission := current_setting('costtrack.stock_movement', true);
  perform set_config('costtrack.stock_movement', 'on', true);
  update public.ingredients
  set stock = stock - new.quantity
  where id = new.ingredient_id
    and stock >= new.quantity;
  stock_updated := found;
  perform set_config('costtrack.stock_movement', coalesce(prior_stock_permission, ''), true);
  if not stock_updated then
    raise exception 'Waste entry would make stock negative or ingredient is missing'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.apply_physical_count_stock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  prior_stock_permission text;
  stock_updated boolean;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Physical counts are append-only' using errcode = '55000';
  end if;

  prior_stock_permission := current_setting('costtrack.stock_movement', true);
  perform set_config('costtrack.stock_movement', 'on', true);
  update public.ingredients
  set stock = new.actual
  where id = new.ingredient_id;
  stock_updated := found;
  perform set_config('costtrack.stock_movement', coalesce(prior_stock_permission, ''), true);
  if not stock_updated then
    raise exception 'Physical count ingredient does not exist' using errcode = '23503';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_direct_stock_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.stock is distinct from old.stock
     and current_setting('costtrack.stock_movement', true) is distinct from 'on' then
    raise exception 'Stock changes must be recorded through inventory transactions, production, waste, or physical counts'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_reservation_date()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is not null
     and public.has_app_role(array['Administrator', 'Manager', 'Receptionist'])
     and new.reservation_date < current_date
     and (
       tg_op = 'INSERT'
       or new.reservation_date is distinct from old.reservation_date
     ) then
    raise exception 'Reservations cannot be created or moved to a past date'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.reservation_time_to_minutes(time_value text)
returns integer
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  normalized text := upper(btrim(coalesce(time_value, '')));
  clock_value text;
  meridiem text;
  hour_value integer;
  minute_value integer;
begin
  if normalized ~ '^(0?[1-9]|1[0-2]):[0-5][0-9][[:space:]]*(AM|PM)$' then
    clock_value := regexp_replace(normalized, '[[:space:]]*(AM|PM)$', '');
    meridiem := right(normalized, 2);
  elsif normalized ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    clock_value := normalized;
    meridiem := null;
  else
    return null;
  end if;

  hour_value := split_part(clock_value, ':', 1)::integer;
  minute_value := split_part(clock_value, ':', 2)::integer;
  if meridiem = 'AM' then
    if hour_value = 12 then hour_value := 0; end if;
  elsif meridiem = 'PM' and hour_value < 12 then
    hour_value := hour_value + 12;
  end if;

  return hour_value * 60 + minute_value;
end;
$$;

create or replace function public.reservation_time_within_open_hours(time_value text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  start_minutes integer := public.reservation_time_to_minutes(time_value);
begin
  return start_minutes is not null
    and start_minutes >= 10 * 60
    and start_minutes + 120 <= 21 * 60;
end;
$$;

create or replace function public.enforce_reservation_hours()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if not public.reservation_time_within_open_hours(new.reservation_time) then
      raise exception 'The two-hour reservation window must fit between 10:00 AM and 9:00 PM'
        using errcode = '23514';
    end if;
  elsif new.reservation_date is distinct from old.reservation_date
        or new.reservation_time is distinct from old.reservation_time then
    if not public.reservation_time_within_open_hours(new.reservation_time) then
      raise exception 'The two-hour reservation window must fit between 10:00 AM and 9:00 PM'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_reservation_start_not_past()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  business_now timestamp without time zone :=
    timezone('Asia/Manila', clock_timestamp());
  now_minutes numeric;
  start_minutes integer;
  schedule_changed boolean;
begin
  if new.type = 'Walk-in' then
    return new;
  end if;

  schedule_changed := tg_op = 'INSERT'
    or new.reservation_date is distinct from old.reservation_date
    or new.reservation_time is distinct from old.reservation_time
    or new.type is distinct from old.type;

  if schedule_changed and new.reservation_date = business_now::date then
    start_minutes := public.reservation_time_to_minutes(new.reservation_time);
    now_minutes :=
      extract(hour from business_now) * 60
      + extract(minute from business_now)
      + extract(second from business_now) / 60;

    if start_minutes is not null and start_minutes < now_minutes then
      raise exception 'Reservation start time has already passed'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_reservation_history_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if old.reservation_date < current_date then
      raise exception 'Past reservations cannot be deleted'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if btrim(coalesce(new.last_correction_reason, '')) <> '' then
      raise exception 'A correction reason can only be recorded when correcting a past reservation'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Reservation identity and creation details cannot be changed'
        using errcode = '42501';
    end if;

    if old.reservation_date < current_date then
      if not public.has_app_role(array['Administrator', 'Manager']) then
        raise exception 'Past reservations are read-only for this role'
          using errcode = '42501';
      end if;

      if row(
        new.reservation_date, new.reservation_time, new.guests, new.type,
        new.adults, new.children, new.status, new.seated_at,
        new.completed_at, new.actual_covers, new.table_id
      ) is distinct from row(
        old.reservation_date, old.reservation_time, old.guests, old.type,
        old.adults, old.children, old.status, old.seated_at,
        old.completed_at, old.actual_covers, old.table_id
      ) then
        raise exception 'Historical corrections cannot change booking date, time, party size, table, or status'
          using errcode = '42501';
      end if;

      if length(btrim(coalesce(new.last_correction_reason, ''))) not between 10 and 500 then
        raise exception 'A correction reason between 10 and 500 characters is required'
          using errcode = '23514';
      end if;
      if btrim(new.last_correction_reason) is not distinct from btrim(coalesce(old.last_correction_reason, '')) then
        raise exception 'Enter a new reason for each historical correction'
          using errcode = '23514';
      end if;
      if row(new.name, new.email, new.phone, new.occasion, new.preference, new.request)
         is not distinct from row(old.name, old.email, old.phone, old.occasion, old.preference, old.request) then
        raise exception 'A historical correction must change a guest detail or note'
          using errcode = '23514';
      end if;
      if new.name is distinct from old.name
         and (nullif(btrim(new.name), '') is null or length(new.name) > 160) then
        raise exception 'A valid reservation name is required'
          using errcode = '23514';
      end if;
      if new.email is distinct from old.email
         and nullif(btrim(new.email), '') is not null
         and (length(new.email) > 254
           or new.email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$') then
        raise exception 'A valid email address is required'
          using errcode = '23514';
      end if;
      if new.phone is distinct from old.phone
         and nullif(btrim(new.phone), '') is not null
         and (length(new.phone) > 40
           or length(regexp_replace(new.phone, '[^0-9]', '', 'g')) not between 7 and 15) then
        raise exception 'A valid phone number is required'
          using errcode = '23514';
      end if;
      if (new.occasion is distinct from old.occasion and length(new.occasion) > 120)
         or (new.preference is distinct from old.preference and length(new.preference) > 500)
         or (new.request is distinct from old.request and length(new.request) > 2000) then
        raise exception 'Reservation details exceed the allowed length'
          using errcode = '23514';
      end if;
      new.last_correction_reason := btrim(new.last_correction_reason);
    elsif new.last_correction_reason is distinct from old.last_correction_reason then
      raise exception 'Correction reasons may only be set for past reservation corrections'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_historical_reservation_phase_a_changes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if old.reservation_date < current_date
     and (new.senior_pwd_count is distinct from old.senior_pwd_count
       or new.source is distinct from old.source) then
    raise exception 'Historical corrections cannot change Senior/PWD count or reservation source'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' then
    if auth.uid() = old.id and new.role is distinct from old.role then
      raise exception 'Users cannot change their own role'
        using errcode = '42501';
    end if;

    if new.account_status is distinct from old.account_status
      and (
        auth.role() is distinct from 'service_role'
        or current_setting('costtrack.account_status_change', true) is distinct from 'on'
      ) then
      raise exception 'User account status must be changed through the authorized lifecycle workflow'
        using errcode = '42501';
    end if;

    if old.role = 'Administrator' and new.role is distinct from old.role
      and old.account_status = 'Active' then
      update public.profile_admin_guard
      set administrator_count = administrator_count - 1
      where singleton and administrator_count > 1;

      if not found then
        if exists (
          select 1 from public.profile_admin_guard where singleton
        ) then
          raise exception 'Cannot remove or demote the last active Administrator'
            using errcode = '23514';
        end if;
        raise exception 'Administrator protection state is unavailable'
          using errcode = '55000';
      end if;
    end if;

    if old.role is distinct from new.role then
      if auth.uid() is null
        or not coalesce(public.has_app_role(array['Administrator']), false) then
        raise exception 'Only Administrators may change user roles'
          using errcode = '42501';
      end if;
    end if;

    if old.role is distinct from new.role
      and new.role = 'Administrator'
      and new.account_status = 'Active' then
      update public.profile_admin_guard
      set administrator_count = administrator_count + 1
      where singleton;
      if not found then
        raise exception 'Administrator protection state is unavailable'
          using errcode = '55000';
      end if;
    end if;

    if old.role = 'Administrator'
      and new.role = old.role
      and old.account_status is distinct from new.account_status then
      if old.account_status = 'Active' then
        update public.profile_admin_guard
        set administrator_count = administrator_count - 1
        where singleton and administrator_count > 1;
        if not found then
          raise exception 'Cannot deactivate the last active Administrator'
            using errcode = '23514';
        end if;
      elsif new.account_status = 'Active' then
        update public.profile_admin_guard
        set administrator_count = administrator_count + 1
        where singleton;
        if not found then
          raise exception 'Administrator protection state is unavailable'
            using errcode = '55000';
        end if;
      end if;
    end if;

    return new;
  elsif tg_op = 'INSERT' then
    if new.role = 'Administrator' and new.account_status = 'Active' then
      update public.profile_admin_guard
      set administrator_count = administrator_count + 1
      where singleton;
      if not found then
        raise exception 'Administrator protection state is unavailable'
          using errcode = '55000';
      end if;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.account_status in ('Pending', 'Cancelled') then
      return old;
    end if;
    if old.role = 'Administrator'
      and old.account_status = 'Active'
      and exists (
        select 1
        from public.profile_admin_guard
        where singleton and administrator_count <= 1
      ) then
      raise exception 'Cannot delete the last active Administrator; profile deletion is not supported'
        using errcode = '55000';
    end if;
    raise exception 'Profile deletion is not supported for active or deactivated users'
      using errcode = '55000';
  end if;

  raise exception 'Unsupported profiles operation: %', tg_op
    using errcode = '55000';
end;
$$;

drop trigger if exists prevent_self_role_change on public.profiles;
create trigger prevent_self_role_change
  before insert or update or delete on public.profiles
  for each row execute function public.prevent_self_role_change();

create or replace function public.audit_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if old.role is distinct from new.role then
    insert into public.profile_role_audit (
      user_id, old_role, new_role, changed_by, reason
    ) values (
      old.id,
      old.role,
      new.role,
      auth.uid(),
      coalesce(nullif(btrim(current_setting('costtrack.role_change_reason', true)), ''), '')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_profile_role_change on public.profiles;
create trigger audit_profile_role_change
  after update on public.profiles
  for each row
  when (old.role is distinct from new.role)
  execute function public.audit_profile_role_change();

create or replace function public.costtrack_update_profile_role(
  p_user_id uuid,
  p_new_role text,
  p_reason text default ''
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  existing_role text;
  previous_reason text;
begin
  if auth.uid() is null
    or not coalesce(public.has_app_role(array['Administrator']), false) then
    raise exception 'Only Administrators may change user roles'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'A user profile is required'
      using errcode = '22023';
  end if;

  if p_new_role is null or p_new_role not in (
    'Administrator',
    'Manager',
    'Receptionist',
    'Inventory Clerk',
    'Chef / Kitchen Staff'
  ) then
    raise exception 'The requested role is not a valid staff role'
      using errcode = '22023';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) > 500 then
    raise exception 'The role-change reason must be 500 characters or fewer'
      using errcode = '22023';
  end if;

  perform 1
  from public.profile_admin_guard
  where singleton
  for update;
  if not found then
    raise exception 'Administrator protection state is unavailable'
      using errcode = '55000';
  end if;

  select profile.role
  into existing_role
  from public.profiles as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception 'User profile not found'
      using errcode = 'P0002';
  end if;

  if existing_role = p_new_role then
    return false;
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Users cannot change their own role'
      using errcode = '42501';
  end if;

  previous_reason := current_setting('costtrack.role_change_reason', true);
  perform set_config(
    'costtrack.role_change_reason',
    btrim(coalesce(p_reason, '')),
    true
  );

  update public.profiles
  set role = p_new_role
  where id = p_user_id;

  if not found then
    raise exception 'User profile was not updated'
      using errcode = 'P0002';
  end if;

  perform set_config(
    'costtrack.role_change_reason',
    coalesce(previous_reason, ''),
    true
  );

  return true;
end;
$$;

create or replace function public.costtrack_set_profile_account_status(
  p_user_id uuid,
  p_new_status text,
  p_actor_id uuid,
  p_reason text default ''
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  prior_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'This account operation requires the authorized server workflow'
      using errcode = '42501';
  end if;
  if p_user_id is null or p_actor_id is null
    or p_new_status not in ('Active', 'Deactivated')
    or char_length(btrim(coalesce(p_reason, ''))) > 500 then
    raise exception 'The account status request is invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles as actor
    where actor.id = p_actor_id
      and actor.role = 'Administrator'
      and actor.account_status = 'Active'
  ) then
    raise exception 'Only active Administrators may manage user accounts'
      using errcode = '42501';
  end if;
  if p_new_status = 'Deactivated' and p_user_id = p_actor_id then
    raise exception 'Administrators cannot deactivate their own account'
      using errcode = '42501';
  end if;

  perform 1
  from public.profile_admin_guard
  where singleton
  for update;
  if not found then
    raise exception 'Administrator protection state is unavailable'
      using errcode = '55000';
  end if;

  select profile.account_status
  into prior_status
  from public.profiles as profile
  where profile.id = p_user_id
  for update;
  if not found then
    raise exception 'User profile not found'
      using errcode = 'P0002';
  end if;
  if prior_status not in ('Active', 'Deactivated') then
    raise exception 'Only active or deactivated staff accounts can change status'
      using errcode = '55000';
  end if;
  if prior_status = p_new_status then
    return false;
  end if;

  perform set_config('costtrack.account_status_change', 'on', true);
  update public.profiles
  set account_status = p_new_status,
      updated_at = clock_timestamp()
  where id = p_user_id;

  insert into public.profile_account_status_audit (
    user_id, old_status, new_status, changed_by, reason
  ) values (
    p_user_id,
    prior_status,
    p_new_status,
    p_actor_id,
    btrim(coalesce(p_reason, ''))
  );
  return true;
end;
$$;

create or replace function public.costtrack_accept_user_invitation(
  p_invitation_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  invitation public.user_invites%rowtype;
  profile_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Invitation acceptance requires the authorized server workflow'
      using errcode = '42501';
  end if;
  if p_invitation_id is null or p_user_id is null then
    raise exception 'The invitation acceptance request is invalid'
      using errcode = '22023';
  end if;

  perform 1
  from public.profile_admin_guard
  where singleton
  for update;
  if not found then
    raise exception 'Administrator protection state is unavailable'
      using errcode = '55000';
  end if;

  select *
  into invitation
  from public.user_invites
  where id = p_invitation_id
  for update;
  if not found then
    raise exception 'Invitation not found'
      using errcode = 'P0002';
  end if;
  if invitation.status = 'Accepted' then
    return false;
  end if;
  if invitation.status <> 'Pending'
    or invitation.expires_at <= clock_timestamp() then
    raise exception 'Invitation is no longer pending or has expired'
      using errcode = '23514';
  end if;

  select profile.account_status
  into profile_status
  from public.profiles as profile
  where profile.id = p_user_id
    and lower(profile.email) = invitation.email
  for update;
  if not found or profile_status <> 'Pending' then
    raise exception 'The invited account is not pending acceptance'
      using errcode = '42501';
  end if;

  update public.user_invites
  set status = 'Accepted'
  where id = invitation.id
    and status = 'Pending';
  if not found then
    raise exception 'Invitation acceptance could not be recorded'
      using errcode = '40001';
  end if;

  perform set_config('costtrack.account_status_change', 'on', true);
  update public.profiles
  set account_status = 'Active',
      updated_at = clock_timestamp()
  where id = p_user_id;

  insert into public.profile_account_status_audit (
    user_id, old_status, new_status, changed_by, invitation_id, reason
  ) values (
    p_user_id,
    'Pending',
    'Active',
    p_user_id,
    invitation.id,
    'Invitation accepted'
  );
  return true;
end;
$$;

create or replace function public.costtrack_cancel_user_invitation(
  p_invitation_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  invitation public.user_invites%rowtype;
  target_user_id uuid;
  prior_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Invitation cancellation requires the authorized server workflow'
      using errcode = '42501';
  end if;
  if p_invitation_id is null or p_actor_id is null then
    raise exception 'The invitation cancellation request is invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles as actor
    where actor.id = p_actor_id
      and actor.role = 'Administrator'
      and actor.account_status = 'Active'
  ) then
    raise exception 'Only active Administrators may cancel invitations'
      using errcode = '42501';
  end if;

  perform 1
  from public.profile_admin_guard
  where singleton
  for update;
  if not found then
    raise exception 'Administrator protection state is unavailable'
      using errcode = '55000';
  end if;

  select *
  into invitation
  from public.user_invites
  where id = p_invitation_id
  for update;
  if not found then
    raise exception 'Invitation not found'
      using errcode = 'P0002';
  end if;

  select profile.id, profile.account_status
  into target_user_id, prior_status
  from public.profiles as profile
  where lower(profile.email) = invitation.email
  for update;

  if invitation.status = 'Accepted' then
    raise exception 'An accepted invitation cannot be cancelled; deactivate the staff account instead'
      using errcode = '55000';
  end if;
  if invitation.status not in ('Pending', 'Expired', 'Cancelled') then
    raise exception 'This invitation cannot be cancelled'
      using errcode = '55000';
  end if;
  if prior_status in ('Active', 'Deactivated') then
    raise exception 'This invitation is linked to an existing staff account'
      using errcode = '55000';
  end if;

  if invitation.status <> 'Cancelled' then
    update public.user_invites
    set status = 'Cancelled'
    where id = invitation.id;
  end if;

  if target_user_id is not null and prior_status = 'Pending' then
    perform set_config('costtrack.account_status_change', 'on', true);
    update public.profiles
    set account_status = 'Cancelled',
        updated_at = clock_timestamp()
    where id = target_user_id;

    insert into public.profile_account_status_audit (
      user_id, old_status, new_status, changed_by, invitation_id, reason
    ) values (
      target_user_id,
      'Pending',
      'Cancelled',
      p_actor_id,
      invitation.id,
      'Invitation cancelled'
    );
  end if;
  return target_user_id;
end;
$$;

drop trigger if exists prevent_direct_stock_change on public.ingredients;
create trigger prevent_direct_stock_change
  before update of stock on public.ingredients
  for each row execute function public.prevent_direct_stock_change();

drop trigger if exists enforce_reservation_date on public.reservations;
create trigger enforce_reservation_date
  before insert or update on public.reservations
  for each row execute function public.enforce_reservation_date();

drop trigger if exists enforce_reservation_capacity on public.reservations;
create trigger enforce_reservation_capacity
  before insert or update on public.reservations
  for each row execute function public.enforce_reservation_table_capacity();

drop trigger if exists set_public_reservation_source on public.reservations;
create trigger set_public_reservation_source
  before insert on public.reservations
  for each row execute function public.set_public_reservation_source();

drop trigger if exists prevent_historical_reservation_phase_a_changes on public.reservations;
create trigger prevent_historical_reservation_phase_a_changes
  before update on public.reservations
  for each row execute function public.prevent_historical_reservation_phase_a_changes();

drop trigger if exists enforce_reservation_table_overlap on public.reservations;
create trigger enforce_reservation_table_overlap
  before insert or update on public.reservations
  for each row execute function public.enforce_reservation_table_overlap();

drop trigger if exists enforce_reservation_hours on public.reservations;
create trigger enforce_reservation_hours
  before insert or update on public.reservations
  for each row execute function public.enforce_reservation_hours();

drop trigger if exists enforce_reservation_start_not_past on public.reservations;
create trigger enforce_reservation_start_not_past
  before insert or update on public.reservations
  for each row execute function public.enforce_reservation_start_not_past();

drop trigger if exists enforce_reservation_history_guard on public.reservations;
create trigger enforce_reservation_history_guard
  before insert or update or delete on public.reservations
  for each row execute function public.enforce_reservation_history_guard();

-- PHASE 3: lifecycle runs after date validation and before audit logging.
drop trigger if exists enforce_reservation_lifecycle on public.reservations;
create trigger enforce_reservation_lifecycle
  before insert or update on public.reservations
  for each row execute function public.enforce_reservation_lifecycle();

drop trigger if exists prevent_table_delete_with_reservations on public.restaurant_tables;
create trigger prevent_table_delete_with_reservations
  before delete on public.restaurant_tables
  for each row execute function public.prevent_table_delete_with_reservations();

drop trigger if exists enforce_restaurant_table_update on public.restaurant_tables;
create trigger enforce_restaurant_table_update
  before update on public.restaurant_tables
  for each row execute function public.enforce_restaurant_table_update();

drop trigger if exists validate_revenue_record on public.revenue_records;
create trigger validate_revenue_record
  before insert or update on public.revenue_records
  for each row execute function public.validate_revenue_record();

drop trigger if exists prevent_unauthorized_revenue_void on public.revenue_records;
create trigger prevent_unauthorized_revenue_void
  before update on public.revenue_records
  for each row execute function public.prevent_unauthorized_revenue_void();

drop trigger if exists apply_inventory_transaction_stock on public.inventory_transactions;
create trigger apply_inventory_transaction_stock
  before insert or update or delete on public.inventory_transactions
  for each row execute function public.apply_inventory_transaction_stock();
drop trigger if exists apply_production_stock on public.production_logs;
create trigger apply_production_stock
  before insert or update or delete on public.production_logs
  for each row execute function public.apply_production_stock();
drop trigger if exists apply_waste_stock on public.waste_logs;
create trigger apply_waste_stock
  before insert or update or delete on public.waste_logs
  for each row execute function public.apply_waste_stock();
drop trigger if exists apply_physical_count_stock on public.physical_counts;
create trigger apply_physical_count_stock
  before insert or update or delete on public.physical_counts
  for each row execute function public.apply_physical_count_stock();

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  prior_row jsonb;
  next_row jsonb;
  row_id text;
begin
  if tg_op = 'INSERT' then
    next_row := to_jsonb(new);
    row_id := coalesce(
      next_row ->> 'id',
      (next_row ->> 'recipe_id') || ':' || (next_row ->> 'ingredient_id')
    );
  elsif tg_op = 'UPDATE' then
    prior_row := to_jsonb(old);
    next_row := to_jsonb(new);
    row_id := coalesce(
      next_row ->> 'id',
      (next_row ->> 'recipe_id') || ':' || (next_row ->> 'ingredient_id')
    );
  else
    prior_row := to_jsonb(old);
    row_id := coalesce(
      prior_row ->> 'id',
      (prior_row ->> 'recipe_id') || ':' || (prior_row ->> 'ingredient_id')
    );
  end if;

  insert into public.audit_logs (
    actor_id, table_name, record_id, action, old_data, new_data, occurred_at
  ) values (
    auth.uid(), tg_table_name, row_id, tg_op, prior_row, next_row, clock_timestamp()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'profiles',
    'ingredients',
    'recipes',
    'recipe_ingredients',
    'inventory_transactions',
    'production_logs',
    'waste_logs',
    'physical_counts',
    'revenue_records',
    'reservations',
    'restaurant_tables'
  ] loop
    execute format('drop trigger if exists write_audit_log on public.%I', relation_name);
    execute format(
      'create trigger write_audit_log after insert or update or delete on public.%I for each row execute function public.write_audit_log()',
      relation_name
    );
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.production_logs enable row level security;
alter table public.waste_logs enable row level security;
alter table public.physical_counts enable row level security;
alter table public.revenue_records enable row level security;
alter table public.reservations enable row level security;
-- PHASE 2: finalize the Phase 1 temporary buffet-rate policies.
alter table public.buffet_rates enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.audit_logs enable row level security;
alter table public.profile_admin_guard enable row level security;
alter table public.profile_role_audit enable row level security;
alter table public.profile_account_status_audit enable row level security;
alter table public.user_invites enable row level security;

-- PHASE 2: remove old policies before defining the final restrictive role set.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'profiles',
        'ingredients',
        'recipes',
        'recipe_ingredients',
        'inventory_transactions',
        'production_logs',
        'waste_logs',
        'physical_counts',
        'revenue_records',
        'reservations',
        'buffet_rates',
        'restaurant_tables',
        'audit_logs',
        'profile_role_audit',
        'profile_account_status_audit',
        'user_invites'
      ])
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

create policy profiles_self_read
  on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_admin_read
  on public.profiles for select to authenticated
  using (public.has_app_role(array['Administrator']));
create policy profiles_admin_insert
  on public.profiles for insert to authenticated
  with check (public.has_app_role(array['Administrator']));
create policy profile_role_audit_admin_read
  on public.profile_role_audit for select to authenticated
  using (public.has_app_role(array['Administrator']));
create policy profile_account_status_audit_admin_read
  on public.profile_account_status_audit for select to authenticated
  using (public.has_app_role(array['Administrator']));
create policy user_invites_admin_select
  on public.user_invites for select to authenticated
  using (public.has_app_role(array['Administrator']));

create policy ingredients_read
  on public.ingredients for select to authenticated
  using (public.has_app_role(array[
    'Administrator', 'Manager', 'Chef / Kitchen Staff', 'Inventory Clerk'
  ]));
create policy ingredients_insert
  on public.ingredients for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager', 'Inventory Clerk']));
create policy ingredients_update
  on public.ingredients for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Inventory Clerk']))
  with check (public.has_app_role(array['Administrator', 'Manager', 'Inventory Clerk']));
create policy ingredients_delete
  on public.ingredients for delete to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']));

create policy recipes_read
  on public.recipes for select to authenticated
  using (public.has_app_role(array[
    'Administrator', 'Manager', 'Chef / Kitchen Staff', 'Inventory Clerk'
  ]));
create policy recipes_insert
  on public.recipes for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']));
create policy recipes_update
  on public.recipes for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']))
  with check (public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']));
create policy recipes_delete
  on public.recipes for delete to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']));

create policy recipe_ingredients_read
  on public.recipe_ingredients for select to authenticated
  using (public.has_app_role(array[
    'Administrator', 'Manager', 'Chef / Kitchen Staff', 'Inventory Clerk'
  ]));
create policy recipe_ingredients_insert
  on public.recipe_ingredients for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']));
create policy recipe_ingredients_update
  on public.recipe_ingredients for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']))
  with check (public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']));
create policy recipe_ingredients_delete
  on public.recipe_ingredients for delete to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']));

create policy inventory_transactions_read
  on public.inventory_transactions for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Inventory Clerk']));
create policy inventory_transactions_insert
  on public.inventory_transactions for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager', 'Inventory Clerk']));

create policy production_logs_read
  on public.production_logs for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']));
create policy production_logs_insert
  on public.production_logs for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']));

create policy waste_logs_read
  on public.waste_logs for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff', 'Inventory Clerk']));
create policy waste_logs_insert
  on public.waste_logs for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff', 'Inventory Clerk']));

create policy physical_counts_read
  on public.physical_counts for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Inventory Clerk']));
create policy physical_counts_insert
  on public.physical_counts for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager', 'Inventory Clerk']));

create policy revenue_records_read
  on public.revenue_records for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']));
create policy revenue_records_insert
  on public.revenue_records for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager']));
create policy revenue_records_update
  on public.revenue_records for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));
create policy revenue_records_delete
  on public.revenue_records for delete to authenticated
  using (public.has_app_role(array['Administrator']));

create policy reservations_read
  on public.reservations for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));
create policy reservations_insert
  on public.reservations for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));
create policy reservations_update
  on public.reservations for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']))
  with check (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));
create policy reservations_delete
  on public.reservations for delete to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']));

create policy restaurant_tables_read
  on public.restaurant_tables for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));
create policy restaurant_tables_insert
  on public.restaurant_tables for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager']));
create policy restaurant_tables_update
  on public.restaurant_tables for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));
create policy restaurant_tables_delete
  on public.restaurant_tables for delete to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']));

create policy audit_logs_admin_read
  on public.audit_logs for select to authenticated
  using (public.has_app_role(array['Administrator']));
create policy audit_logs_actor_read
  on public.audit_logs for select to authenticated
  using (actor_id = auth.uid());

-- PHASE 2: buffet rates are visible to front-of-house roles only; managers
-- and administrators maintain the catalog. These replace the Phase 1 policies.
drop policy if exists buffet_rates_phase1_read on public.buffet_rates;
drop policy if exists buffet_rates_phase1_insert on public.buffet_rates;
drop policy if exists buffet_rates_phase1_update on public.buffet_rates;
drop policy if exists buffet_rates_phase1_delete on public.buffet_rates;
create policy buffet_rates_read
  on public.buffet_rates for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));
create policy buffet_rates_insert
  on public.buffet_rates for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager']));
create policy buffet_rates_update
  on public.buffet_rates for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));
create policy buffet_rates_delete
  on public.buffet_rates for delete to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']));

-- Atomically save a recipe and replace its ingredients.
-- PHASE 1: Payload shape: {id,name,category,menu_price,wastage,ingredients:[{ingredient_id,quantity}]}.
-- The adapter must pass null expected_updated_at for inserts and the selected
-- row's exact updated_at for edits; direct recipe saves are intentionally denied.
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
  menu_price_value numeric;
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
     or payload ->> 'wastage' is null then
    raise exception 'Recipe id, name, category, and wastage are required';
  end if;

  for ingredient_item in
    select value from jsonb_array_elements(payload -> 'ingredients')
  loop
    if jsonb_typeof(ingredient_item) is distinct from 'object'
       or nullif(btrim(ingredient_item ->> 'ingredient_id'), '') is null
       or ingredient_item ->> 'quantity' is null
       or (ingredient_item ->> 'quantity')::numeric <= 0 then
      raise exception 'Each recipe ingredient needs an id and positive quantity';
    end if;
    if not exists (
      select 1
      from public.ingredients as i
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

  select * into saved_recipe
  from public.recipes
  where id = recipe_id_value
  for update;

  if found then
    if expected_updated_at is null
       or saved_recipe.updated_at is distinct from expected_updated_at then
      raise exception 'Recipe was changed by another user; reload before saving'
        using errcode = '40001';
    end if;
    menu_price_value := coalesce(
      nullif(btrim(payload ->> 'menu_price'), '')::numeric,
      saved_recipe.menu_price
    );
    update public.recipes
    set name = btrim(payload ->> 'name'),
        category = btrim(payload ->> 'category'),
        menu_price = menu_price_value,
        wastage = (payload ->> 'wastage')::numeric
    where id = recipe_id_value
    returning * into saved_recipe;
  else
    if expected_updated_at is not null then
      raise exception 'Recipe no longer exists; reload before saving'
        using errcode = '40001';
    end if;
    menu_price_value := coalesce(
      nullif(btrim(payload ->> 'menu_price'), '')::numeric,
      0
    );
    begin
      insert into public.recipes (id, name, category, menu_price, wastage)
      values (
        recipe_id_value,
        btrim(payload ->> 'name'),
        btrim(payload ->> 'category'),
        menu_price_value,
        (payload ->> 'wastage')::numeric
      )
      returning * into saved_recipe;
    exception when unique_violation then
      raise exception 'Recipe was concurrently inserted; reload before saving'
        using errcode = '40001';
    end;
  end if;

  delete from public.recipe_ingredients
  where recipe_id = recipe_id_value;

  insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity)
  select recipe_id_value, rows.ingredient_id, rows.quantity
  from jsonb_to_recordset(payload -> 'ingredients')
    as rows(ingredient_id text, quantity numeric);

  return to_jsonb(saved_recipe);
end;
$$;

-- Public callers can create reservations through this validator, but cannot
-- query or mutate the reservations table directly.
create or replace function public.public_create_reservation(payload jsonb)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  new_reference text;
  reservation_name text;
  reservation_email text;
  reservation_phone text;
  reservation_day date;
  reservation_time_value text;
  guest_count integer;
  provided_guest_count integer;
  computed_guest_count bigint;
  adult_count integer;
  senior_pwd_count integer;
  child_count integer;
  occasion_value text;
  preference_value text;
  request_value text;
  contact_key_value text;
  ip_value text;
  contact_attempts integer;
  ip_attempts integer;
  contact_limit constant integer := 3;
  contact_window constant interval := interval '10 minutes';
  ip_limit constant integer := 10;
  ip_window constant interval := interval '1 hour';
begin
  if payload is null or jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Reservation payload must be a JSON object';
  end if;
  if nullif(btrim(payload ->> 'website'), '') is not null then
    raise exception 'Unable to process reservation request';
  end if;

  reservation_name := nullif(btrim(payload ->> 'name'), '');
  reservation_email := nullif(btrim(payload ->> 'email'), '');
  reservation_phone := nullif(btrim(payload ->> 'phone'), '');
  if reservation_name is null or length(reservation_name) > 160 then
    raise exception 'A valid reservation name is required';
  end if;
  if reservation_email is not null
     and (length(reservation_email) > 254
       or reservation_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$') then
    raise exception 'A valid email address is required';
  end if;
  if reservation_phone is not null then
    if length(reservation_phone) > 40
       or length(regexp_replace(reservation_phone, '[^0-9]', '', 'g')) not between 7 and 15 then
      raise exception 'A valid phone number is required';
    end if;
  end if;
  if reservation_email is null and reservation_phone is null then
    raise exception 'An email address or phone number is required';
  end if;

  reservation_day := (payload ->> 'reservation_date')::date;
  if reservation_day is null then
    raise exception 'A reservation date is required';
  end if;
  if reservation_day < current_date then
    raise exception 'Reservation date cannot be in the past';
  end if;
  reservation_time_value := nullif(btrim(payload ->> 'reservation_time'), '');
  if reservation_time_value is null or length(reservation_time_value) > 40 then
    raise exception 'A reservation time is required';
  end if;
  if not public.reservation_time_within_open_hours(reservation_time_value) then
    raise exception 'The two-hour reservation window must fit between 10:00 AM and 9:00 PM'
      using errcode = '23514';
  end if;

  provided_guest_count := nullif(payload ->> 'guests', '')::integer;
  adult_count := coalesce(nullif(payload ->> 'adults', '')::integer, provided_guest_count);
  senior_pwd_count := coalesce(nullif(payload ->> 'senior_pwd_count', '')::integer, 0);
  child_count := coalesce(nullif(payload ->> 'children', '')::integer, 0);
  if adult_count is null then
    raise exception 'Guest counts are invalid';
  end if;
  computed_guest_count := adult_count::bigint + senior_pwd_count + child_count;
  if computed_guest_count < 1 or computed_guest_count > 1000
     or adult_count < 0 or senior_pwd_count < 0 or child_count < 0
     or (provided_guest_count is not null
       and provided_guest_count::bigint <> computed_guest_count) then
    raise exception 'Guest counts are invalid';
  end if;
  guest_count := computed_guest_count::integer;

  occasion_value := coalesce(nullif(btrim(payload ->> 'occasion'), ''), '');
  preference_value := coalesce(nullif(btrim(payload ->> 'preference'), ''), '');
  request_value := coalesce(nullif(btrim(payload ->> 'request'), ''), '');
  if length(occasion_value) > 120 or length(preference_value) > 500
     or length(request_value) > 2000 then
    raise exception 'Reservation details exceed the allowed length';
  end if;

  contact_key_value := md5(coalesce(
    nullif(regexp_replace(reservation_phone, '[^0-9]', '', 'g'), ''),
    lower(reservation_email)
  ));
  ip_value := coalesce(
    nullif(split_part(
      coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
        ->> 'x-forwarded-for',
      ',', 1
    ), ''),
    nullif(
      coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
        ->> 'x-real-ip',
      ''
    ),
    'unknown'
  );
  delete from public.public_reservation_attempts
  where created_at < clock_timestamp() - ip_window;
  select count(*) into contact_attempts
  from public.public_reservation_attempts
  where contact_key = contact_key_value
    and created_at >= clock_timestamp() - contact_window;
  select count(*) into ip_attempts
  from public.public_reservation_attempts
  where ip = ip_value
    and created_at >= clock_timestamp() - ip_window;
  if contact_attempts >= contact_limit or ip_attempts >= ip_limit then
    raise exception 'Unable to process reservation request';
  end if;
  insert into public.public_reservation_attempts (contact_key, ip)
  values (contact_key_value, ip_value);

  new_reference := 'RSV-' || upper(replace(gen_random_uuid()::text, '-', ''));
  begin
    insert into public.reservations (
      id, name, email, phone, reservation_date, reservation_time,
      guests, type, adults, senior_pwd_count, children,
      occasion, status, preference, request, created_by
    ) values (
      new_reference, reservation_name, reservation_email, reservation_phone,
      reservation_day, reservation_time_value, guest_count, 'Reservation',
      adult_count, senior_pwd_count, child_count,
      occasion_value, 'Pending', preference_value, request_value, auth.uid()
    );
  exception when unique_violation then
    raise exception 'Reservation reference or table/time slot is already in use'
      using errcode = '23P01';
  end;

  return new_reference;
end;
$$;

-- No row is returned unless the supplied email OR phone matches the record.
-- The result intentionally omits guest contact details, notes, and table assignment.
create or replace function public.public_get_reservation_status(reference text, contact text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'reference', r.id,
    'status', r.status,
    'reservation_date', r.reservation_date,
    'reservation_time', r.reservation_time,
    'guests', r.guests
  )
  from public.reservations as r
  where nullif(btrim($1), '') is not null
    and nullif(btrim($2), '') is not null
    and r.id = btrim($1)
    and (
      (r.email is not null and lower(btrim(r.email)) = lower(btrim($2)))
      or (
        r.phone is not null
        and length(regexp_replace($2, '[^0-9]', '', 'g')) > 0
        and regexp_replace(r.phone, '[^0-9]', '', 'g')
            = regexp_replace($2, '[^0-9]', '', 'g')
      )
    )
$$;

-- PHASE 3: create one revenue draft from seated covers without exposing
-- revenue amounts to the Receptionist.
create or replace function public.create_revenue_draft(reservation_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  reservation_row public.reservations%rowtype;
  rate_row public.buffet_rates%rowtype;
  revenue_id_value text;
  day_type_value text;
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Receptionist']) then
    raise exception 'Not authorized to create revenue drafts' using errcode = '42501';
  end if;
  if nullif(btrim(reservation_id_value), '') is null then
    raise exception 'A reservation id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(reservation_id_value));
  select * into reservation_row
  from public.reservations
  where id = btrim(reservation_id_value);
  if not found then
    raise exception 'Reservation not found';
  end if;
  if reservation_row.status <> 'Seated' then
    raise exception 'Revenue drafts require a Seated reservation';
  end if;
  if coalesce(reservation_row.actual_covers, 0) <= 0 then
    raise exception 'A Seated reservation must have actual_covers greater than zero';
  end if;

  select id into revenue_id_value
  from public.revenue_records
  where reservation_id = reservation_row.id
    and status = 'Draft'
  order by recorded_at
  limit 1;
  if revenue_id_value is not null then
    return jsonb_build_object('id', revenue_id_value, 'status', 'Draft');
  end if;

  day_type_value := case
    when extract(isodow from reservation_row.reservation_date) between 1 and 5
      then 'weekday'
    else 'weekend'
  end;
  select * into rate_row
  from public.buffet_rates
  where meal_period = 'All Day'
    and day_type = day_type_value
    and is_active
    and effective_from <= reservation_row.reservation_date
    and (effective_to is null or effective_to >= reservation_row.reservation_date)
  order by effective_from desc
  limit 1;
  if not found then
    raise exception 'No active buffet rate exists for All Day/% on %',
      day_type_value, reservation_row.reservation_date;
  end if;

  revenue_id_value := 'REV-' || upper(replace(gen_random_uuid()::text, '-', ''));
  insert into public.revenue_records (
    id, business_date, meal_period, adult_customers, adult_rate,
    child_customers, child_rate, senior_pwd_customers, senior_pwd_rate,
    status, reservation_id, rate_id, recorded_by
  ) values (
    revenue_id_value, reservation_row.reservation_date, 'All Day',
    reservation_row.adults, rate_row.adult_rate,
    reservation_row.children, rate_row.child_rate, 0, rate_row.senior_pwd_rate,
    'Draft', reservation_row.id, rate_row.id, coalesce(auth.uid()::text, '')
  );
  return jsonb_build_object('id', revenue_id_value, 'status', 'Draft');
end;
$$;

-- PHASE 3: managers and administrators confirm drafts and may correct counts.
create or replace function public.confirm_revenue(
  revenue_id_value text,
  adjustments jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  adult_count_value integer;
  child_count_value integer;
  senior_count_value integer;
begin
  if not public.has_app_role(array['Administrator', 'Manager']) then
    raise exception 'Not authorized to confirm revenue' using errcode = '42501';
  end if;
  if nullif(btrim(revenue_id_value), '') is null then
    raise exception 'A revenue id is required';
  end if;
  if adjustments is null or jsonb_typeof(adjustments) is distinct from 'object' then
    raise exception 'Revenue adjustments must be a JSON object';
  end if;

  select adult_customers, child_customers, senior_pwd_customers
  into adult_count_value, child_count_value, senior_count_value
  from public.revenue_records
  where id = btrim(revenue_id_value)
    and status = 'Draft'
  for update;
  if not found then
    raise exception 'Draft revenue record not found';
  end if;

  if adjustments ? 'adult_customers' then
    adult_count_value := (adjustments ->> 'adult_customers')::integer;
  end if;
  if adjustments ? 'child_customers' then
    child_count_value := (adjustments ->> 'child_customers')::integer;
  end if;
  if adjustments ? 'senior_pwd_customers' then
    senior_count_value := (adjustments ->> 'senior_pwd_customers')::integer;
  end if;
  if adult_count_value < 0 or child_count_value < 0 or senior_count_value < 0 then
    raise exception 'Customer counts must be non-negative';
  end if;

  update public.revenue_records
  set adult_customers = adult_count_value,
      child_customers = child_count_value,
      senior_pwd_customers = senior_count_value,
      status = 'Confirmed',
      last_edited_by = coalesce(auth.uid()::text, ''),
      last_edited_at = clock_timestamp(),
      edit_reason = 'Confirmed revenue draft'
  where id = btrim(revenue_id_value);
  return jsonb_build_object('id', btrim(revenue_id_value), 'status', 'Confirmed');
end;
$$;

-- Keep app_records as a locked archive after backfill. Demo users and unknown
-- collections remain there for explicit review; they are not exposed through
-- the API or copied into Auth profiles.
do $$
declare
  policy_row record;
begin
  if to_regclass('public.app_records') is not null then
    alter table public.app_records enable row level security;
    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = 'app_records'
    loop
      execute format('drop policy if exists %I on public.app_records', policy_row.policyname);
    end loop;
    revoke all on table public.app_records from public, anon, authenticated;
  end if;
end;
$$;

-- Do not inherit broad Supabase defaults on these application tables.
grant usage on schema public to anon, authenticated;

revoke all on table
  public.profiles,
  public.ingredients,
  public.recipes,
  public.recipe_ingredients,
  public.inventory_transactions,
  public.production_logs,
  public.waste_logs,
  public.physical_counts,
  public.revenue_records,
  public.reservations,
  public.buffet_rates,
  public.restaurant_tables,
  public.public_reservation_attempts,
  public.audit_logs,
  public.profile_admin_guard,
  public.profile_role_audit,
  public.profile_account_status_audit,
  public.user_invites,
  public.app_records_migrations,
  public.app_records_migration_errors
from public, anon, authenticated;

grant select, insert on table public.profiles to authenticated;
grant select, insert, update, delete on table
  public.ingredients,
  public.recipes,
  public.recipe_ingredients,
  public.inventory_transactions,
  public.production_logs,
  public.waste_logs,
  public.physical_counts,
  public.revenue_records,
  public.reservations,
  public.buffet_rates,
  public.restaurant_tables
to authenticated;
revoke update, delete on table
  public.inventory_transactions,
  public.production_logs,
  public.waste_logs,
  public.physical_counts
from public, anon, authenticated;
revoke insert, update on table public.recipes from public, anon, authenticated;
revoke insert, update, delete on table public.recipe_ingredients from public, anon, authenticated;
grant select on table public.audit_logs to authenticated;
grant select on table public.profile_role_audit to authenticated;
grant select on table public.profile_account_status_audit to authenticated;
grant select on table public.user_invites to authenticated;

revoke all on function public.current_app_role() from public, anon;
revoke all on function public.costtrack_mark_table_clean(text)
from public, anon, authenticated;
revoke all on function public.has_app_role(text[]) from public, anon;
revoke all on function public.costtrack_set_profile_account_status(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.costtrack_accept_user_invitation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.costtrack_cancel_user_invitation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.has_app_role(text[]) to authenticated;
grant execute on function public.costtrack_mark_table_clean(text)
  to authenticated;
grant execute on function public.costtrack_set_profile_account_status(uuid, text, uuid, text)
  to service_role;
grant execute on function public.costtrack_accept_user_invitation(uuid, uuid)
  to service_role;
grant execute on function public.costtrack_cancel_user_invitation(uuid, uuid)
  to service_role;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.guard_user_invite() from public, anon, authenticated;
revoke all on function public.apply_inventory_transaction_stock() from public, anon, authenticated;
revoke all on function public.apply_production_stock() from public, anon, authenticated;
revoke all on function public.apply_waste_stock() from public, anon, authenticated;
revoke all on function public.apply_physical_count_stock() from public, anon, authenticated;
revoke all on function public.prevent_direct_stock_change() from public, anon, authenticated;
revoke all on function public.enforce_reservation_date() from public, anon, authenticated;
revoke all on function public.reservation_time_within_open_hours(text) from public, anon, authenticated;
revoke all on function public.reservation_time_to_minutes(text) from public, anon, authenticated;
revoke all on function public.enforce_reservation_hours() from public, anon, authenticated;
revoke all on function public.enforce_reservation_start_not_past() from public, anon, authenticated;
revoke all on function public.enforce_reservation_table_overlap() from public, anon, authenticated;
revoke all on function public.enforce_reservation_table_capacity() from public, anon, authenticated;
revoke all on function public.set_public_reservation_source() from public, anon, authenticated;
revoke all on function public.prevent_historical_reservation_phase_a_changes() from public, anon, authenticated;
revoke all on function public.enforce_restaurant_table_update() from public, anon, authenticated;
revoke all on function public.enforce_reservation_history_guard() from public, anon, authenticated;
revoke all on function public.prevent_table_delete_with_reservations() from public, anon, authenticated;

-- PHASE 2: finalize buffet-rate access. Receptionist can read rates for
-- reservation workflows; kitchen and inventory roles do not need this table.
alter table public.buffet_rates enable row level security;
drop policy if exists buffet_rates_phase1_read on public.buffet_rates;
drop policy if exists buffet_rates_phase1_insert on public.buffet_rates;
drop policy if exists buffet_rates_phase1_update on public.buffet_rates;
drop policy if exists buffet_rates_phase1_delete on public.buffet_rates;
drop policy if exists buffet_rates_read on public.buffet_rates;
drop policy if exists buffet_rates_insert on public.buffet_rates;
drop policy if exists buffet_rates_update on public.buffet_rates;
drop policy if exists buffet_rates_delete on public.buffet_rates;
create policy buffet_rates_read
  on public.buffet_rates for select to authenticated
  using (public.has_app_role(array['Administrator', 'Manager', 'Receptionist']));
create policy buffet_rates_insert
  on public.buffet_rates for insert to authenticated
  with check (public.has_app_role(array['Administrator', 'Manager']));
create policy buffet_rates_update
  on public.buffet_rates for update to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']))
  with check (public.has_app_role(array['Administrator', 'Manager']));
create policy buffet_rates_delete
  on public.buffet_rates for delete to authenticated
  using (public.has_app_role(array['Administrator', 'Manager']));

-- PHASE 2: direct table privileges remain deny-by-default; recipe writes use
-- save_recipe, and append-only ledgers cannot be updated or deleted directly.

-- PHASE 2: security-definer functions are executable only by their intended
-- callers. All security-definer functions retain an explicit pg_catalog path.
revoke all on function public.current_app_role() from public, anon;
revoke all on function public.has_app_role(text[]) from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.has_app_role(text[]) to authenticated;
revoke all on function public.save_recipe(jsonb, timestamptz) from public, anon;
grant execute on function public.save_recipe(jsonb, timestamptz) to authenticated;
revoke all on function public.public_create_reservation(jsonb) from public;
grant execute on function public.public_create_reservation(jsonb) to anon, authenticated;
revoke all on function public.public_get_reservation_status(text, text) from public;
grant execute on function public.public_get_reservation_status(text, text) to anon, authenticated;
-- PHASE 3: RPC callers are checked inside the security-definer functions.
revoke all on function public.create_revenue_draft(text) from public, anon, authenticated;
revoke all on function public.confirm_revenue(text, jsonb) from public, anon;
grant execute on function public.confirm_revenue(text, jsonb) to authenticated;

comment on table public.buffet_rates is
  'PHASE 2; rates are readable by Administrator, Manager, and Receptionist; maintenance is Administrator/Manager only.';
comment on table public.ingredients is
  'PHASE 2; ingredient costs are visible to Administrator, Manager, Chef / Kitchen Staff, and Inventory Clerk. Receptionist has no access.';
revoke all on function public.prevent_self_role_change() from public, anon, authenticated;
revoke all on function public.audit_profile_role_change() from public, anon, authenticated;
revoke all on function public.costtrack_update_profile_role(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.costtrack_update_profile_role(uuid, text, text)
  to authenticated;
revoke all on function public.write_audit_log() from public, anon, authenticated;

revoke all on function public.save_recipe(jsonb, timestamptz) from public, anon;
grant execute on function public.save_recipe(jsonb, timestamptz) to authenticated;
revoke all on function public.public_create_reservation(jsonb) from public;
grant execute on function public.public_create_reservation(jsonb) to anon, authenticated;
revoke all on function public.public_get_reservation_status(text, text) from public;
grant execute on function public.public_get_reservation_status(text, text) to anon, authenticated;

comment on table public.profiles is
  'Auth-linked app profiles. Provision Auth users in Supabase Auth first, then insert their matching id/email/full_name/role here as an administrator or through the SQL editor; do not copy demo users.';
do $$
begin
  if to_regclass('public.app_records') is not null then
    comment on table public.app_records is
          'Locked legacy archive. Supported collections are backfilled atomically; inspect app_records_migration_errors if the retryable backfill stopped. Demo users and unknown collections are excluded.';
  end if;
end;
$$;
comment on function public.save_recipe(jsonb, timestamptz) is
  'Authorized atomic recipe save; inserts only without an expected version and updates only when expected_updated_at matches; replaces recipe_ingredients and returns updated_at.';
comment on function public.public_create_reservation(jsonb) is
  'Validated public reservation entry point; direct public table access is not granted.';
comment on function public.public_get_reservation_status(text, text) is
  'Returns minimal status fields only when reservation reference and email or phone match.';
comment on function public.create_revenue_draft(text) is
  'Retired: revenue now comes from closed POS bills. Execution is revoked.';
comment on function public.confirm_revenue(text, jsonb) is
  'Confirms a revenue draft for Administrator or Manager and optionally corrects customer counts.';
comment on table public.public_reservation_attempts is
  'Private Phase 3 rate-limit ledger for public reservation submissions.';
comment on table public.app_records_migrations is
  'Private completion marker for the atomic typed app_records backfill.';
comment on table public.app_records_migration_errors is
  'Private SQL-owner report for a rolled-back app_records backfill; repair the named row and rerun the schema.';
comment on table public.inventory_transactions is
  'Append-only stock movement ledger; inserts atomically apply quantity delta and positive-movement unit cost to ingredients.';
comment on table public.production_logs is
  'Append-only production ledger; inserts atomically consume recipe ingredient quantities from stock.';
comment on table public.waste_logs is
  'Append-only waste ledger; inserts atomically consume ingredient stock.';
comment on table public.physical_counts is
  'Append-only physical count ledger; inserts atomically set ingredient stock to actual.';
comment on column public.ingredients.stock is
  'Nonnegative on-hand balance maintained by stock ledger insert triggers; direct stock updates are rejected.';

-- PHASE 5: read-only report views and aggregate RPC.
create or replace view public.report_confirmed_revenue_v
with (security_invoker = true)
as
select business_date, meal_period, adult_customers, child_customers,
  senior_pwd_customers,
  adult_customers + child_customers + senior_pwd_customers as covers,
  adult_customers * adult_rate + child_customers * child_rate
    + senior_pwd_customers * senior_pwd_rate as revenue
from public.revenue_records
where status = 'Confirmed';

create or replace view public.report_inventory_valuation_v
with (security_invoker = true)
as
select i.id as ingredient_id, i.name, i.category, i.unit, i.stock, i.cost,
  i.stock * i.cost as valuation, i.minimum, i.stock <= i.minimum as is_low_stock
from public.ingredients as i;

create or replace function public.report_analytics(
  report_key text, start_date date, end_date date,
  group_by text default 'day', include_waste boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare result jsonb;
begin
  if start_date is null or end_date is null or end_date < start_date then
    raise exception 'Invalid report date range';
  end if;
  if end_date - start_date > 366 then
    raise exception 'Report date range cannot exceed 366 days';
  end if;
  if group_by not in ('day', 'week', 'month') then
    raise exception 'Invalid report grouping';
  end if;
  if report_key = 'food_cost' then
    if not public.has_app_role(array['Administrator', 'Manager']) then raise exception 'permission denied'; end if;
    with periods as (
      select generate_series(start_date, end_date, interval '1 day')::date as day
    ), revenue as (
      select date_trunc(group_by, business_date)::date as period, sum(revenue) as revenue
      from public.report_confirmed_revenue_v where business_date between start_date and end_date group by 1
    ), production as (
      select date_trunc(group_by, p.production_date)::date as period,
        sum(p.quantity * ri.quantity * i.cost * (1 + r.wastage / 100.0)) as production_cost
      from public.production_logs p join public.recipes r on r.id = p.recipe_id
      join public.recipe_ingredients ri on ri.recipe_id = r.id
      join public.ingredients i on i.id = ri.ingredient_id
      where p.production_date between start_date and end_date group by 1
    ), waste as (
      select date_trunc(group_by, w.waste_date)::date as period, sum(w.quantity * i.cost) as waste_cost
      from public.waste_logs w join public.ingredients i on i.id = w.ingredient_id
      where include_waste and w.waste_date between start_date and end_date group by 1
    ), rows as (
      select p.day as period, coalesce(rv.revenue, 0) as revenue,
        coalesce(pr.production_cost, 0) as production_cost, coalesce(wa.waste_cost, 0) as waste_cost,
        coalesce(pr.production_cost, 0) + coalesce(wa.waste_cost, 0) as food_cost,
        case when coalesce(rv.revenue, 0) = 0 then null
          else (coalesce(pr.production_cost, 0) + coalesce(wa.waste_cost, 0)) / rv.revenue * 100 end as food_cost_pct
      from (select distinct date_trunc(group_by, day)::date as day from periods) p
      left join revenue rv on rv.period = p.day left join production pr on pr.period = p.day
      left join waste wa on wa.period = p.day order by p.day
    )
    select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(rows)) from rows), '[]'::jsonb),
      'target_pct', 32, 'includes_waste', include_waste) into result;
  elsif report_key = 'revenue' then
    if not public.has_app_role(array['Administrator', 'Manager']) then raise exception 'permission denied'; end if;
    with rows as (
      select business_date as period, meal_period, sum(adult_customers) as adults,
        sum(child_customers) as children, sum(senior_pwd_customers) as senior_pwd,
        sum(covers) as covers, sum(revenue) as revenue,
        coalesce((select sum(p.quantity * ri.quantity * i.cost * (1 + r.wastage / 100.0))
          from public.production_logs p join public.recipes r on r.id = p.recipe_id
          join public.recipe_ingredients ri on ri.recipe_id = r.id
          join public.ingredients i on i.id = ri.ingredient_id
          where p.production_date = business_date), 0) as production_cost,
        coalesce((select sum(w.quantity * i.cost) from public.waste_logs w
          join public.ingredients i on i.id = w.ingredient_id where w.waste_date = business_date), 0) as waste_cost
      from public.report_confirmed_revenue_v where business_date between start_date and end_date
      group by business_date, meal_period order by business_date, meal_period
    )
    select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(rows)) from rows), '[]'::jsonb),
      'no_show_count', (select count(*) from public.reservations where reservation_date between start_date and end_date and status = 'No-show'),
      'reservation_covers', (select coalesce(sum(coalesce(actual_covers, guests)), 0) from public.reservations where reservation_date between start_date and end_date and type = 'Reservation' and status in ('Seated', 'Completed')),
      'walk_in_covers', (select coalesce(sum(coalesce(actual_covers, guests)), 0) from public.reservations where reservation_date between start_date and end_date and type = 'Walk-in' and status in ('Seated', 'Completed'))) into result;
  elsif report_key = 'waste' then
    if not public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff', 'Inventory Clerk']) then raise exception 'permission denied'; end if;
    select jsonb_build_object(
      'by_ingredient', coalesce((select jsonb_agg(
        to_jsonb(x) - (case when public.has_app_role(array['Administrator', 'Manager']) then '' else 'waste_cost' end)
        order by x.waste_cost desc) from (
        select i.id as ingredient_id, i.name, i.unit, sum(w.quantity) as quantity, sum(w.quantity * i.cost) as waste_cost
        from public.waste_logs w join public.ingredients i on i.id = w.ingredient_id
        where w.waste_date between start_date and end_date group by i.id, i.name, i.unit
        order by sum(w.quantity * i.cost) desc limit 10) x), '[]'::jsonb),
      'by_reason', coalesce((select jsonb_agg(
        to_jsonb(x) - (case when public.has_app_role(array['Administrator', 'Manager']) then '' else 'waste_cost' end)
        order by x.waste_cost desc) from (
        select w.reason, sum(w.quantity) as quantity, sum(w.quantity * i.cost) as waste_cost
        from public.waste_logs w join public.ingredients i on i.id = w.ingredient_id
        where w.waste_date between start_date and end_date group by w.reason
        order by sum(w.quantity * i.cost) desc) x), '[]'::jsonb),
      'by_day', coalesce((select jsonb_agg(
        to_jsonb(x) - (case when public.has_app_role(array['Administrator', 'Manager']) then '' else 'waste_cost' end)
        order by x.period) from (
        select w.waste_date as period, sum(w.quantity * i.cost) as waste_cost, sum(w.quantity) as quantity
        from public.waste_logs w join public.ingredients i on i.id = w.ingredient_id
        where w.waste_date between start_date and end_date group by w.waste_date) x), '[]'::jsonb),
      'linked_count', (select count(*) from public.waste_logs where waste_date between start_date and end_date and production_log_id is not null),
      'unlinked_count', (select count(*) from public.waste_logs where waste_date between start_date and end_date and production_log_id is null),
      'revenue_allowed', public.has_app_role(array['Administrator', 'Manager'])) into result;
  elsif report_key = 'inventory' then
    if not public.has_app_role(array['Administrator', 'Manager', 'Inventory Clerk']) then raise exception 'permission denied'; end if;
    select jsonb_build_object(
      'valuation_by_category', coalesce((select jsonb_agg(
        to_jsonb(x) - (case when public.has_app_role(array['Administrator', 'Manager']) then '' else 'valuation' end)
        order by x.valuation desc) from (
        select category, sum(stock * cost) as valuation, count(*) as ingredients
        from public.ingredients group by category order by sum(stock * cost) desc) x), '[]'::jsonb),
      'low_stock', coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (
        select id as ingredient_id, name, category, stock, minimum, unit from public.ingredients
        where stock <= minimum order by name) x), '[]'::jsonb),
      'movements', coalesce((select jsonb_agg(to_jsonb(x) order by x.transaction_type) from (
        select transaction_type, sum(quantity) as quantity, count(*) as entries
        from public.inventory_transactions where transaction_date between start_date and end_date
        group by transaction_type) x), '[]'::jsonb),
      'variance', coalesce((select jsonb_agg(
        to_jsonb(x) - (case when public.has_app_role(array['Administrator', 'Manager']) then '' else 'variance_cost' end)
        order by x.count_date desc) from (
        select c.count_date, i.name, i.unit, c.expected, c.actual, c.actual - c.expected as variance,
          (c.actual - c.expected) * i.cost as variance_cost
        from public.physical_counts c join public.ingredients i on i.id = c.ingredient_id
        where c.count_date between start_date and end_date order by c.count_date desc) x), '[]'::jsonb)) into result;
  elsif report_key = 'production' then
    if not public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']) then raise exception 'permission denied'; end if;
    select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.batches desc) from (
      select r.name as recipe, sum(p.quantity) as batches,
        sum(p.quantity * coalesce((select sum(ri.quantity * i.cost) * (1 + r.wastage / 100.0)
          from public.recipe_ingredients ri join public.ingredients i on i.id = ri.ingredient_id
          where ri.recipe_id = r.id), 0)) as production_cost,
        sum(p.covers_produced) filter (where p.covers_produced is not null) as covers_produced
      from public.production_logs p join public.recipes r on r.id = p.recipe_id
      where p.production_date between start_date and end_date
      group by r.id, r.name, r.wastage order by sum(p.quantity) desc) x), '[]'::jsonb)) into result;
  else raise exception 'Unknown report';
  end if;
  return result;
end;
$$;

revoke all on function public.report_analytics(text, date, date, text, boolean) from public, anon;
grant execute on function public.report_analytics(text, date, date, text, boolean) to authenticated;
comment on function public.report_analytics(text, date, date, text, boolean) is
  'PHASE 5 read-only aggregate reports; role checks are enforced inside the security-definer function and only confirmed revenue is included.';

-- PHASE 6: realtime publication additions and read-only production planning.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'ingredients', 'recipes', 'recipe_ingredients', 'inventory_transactions',
    'production_logs', 'waste_logs', 'physical_counts', 'reservations',
    'restaurant_tables', 'revenue_records', 'buffet_rates', 'audit_logs'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

create or replace function public.get_expected_covers(
  service_date date,
  meal_period text default null
)
returns table (
  expected_covers integer,
  average_completed_covers numeric,
  sample_days integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Chef / Kitchen Staff']) then
    raise exception 'permission denied';
  end if;
  return query
  with expected as (
    select coalesce(sum(coalesce(actual_covers, guests)), 0)::integer as covers
    from public.reservations
    where reservation_date = service_date
      and status in ('Pending', 'Confirmed', 'Seated')
  ),
  weekday_days as (
    select reservation_date,
      sum(coalesce(actual_covers, guests))::numeric as covers
    from public.reservations
    where reservation_date < service_date
      and extract(dow from reservation_date) = extract(dow from service_date)
      and status in ('Completed')
    group by reservation_date
    order by reservation_date desc
    limit 4
  )
  select expected.covers,
    coalesce((select avg(covers) from weekday_days), 0)::numeric,
    (select count(*)::integer from weekday_days);
end;
$$;

revoke all on function public.get_expected_covers(date, text) from public, anon;
grant execute on function public.get_expected_covers(date, text) to authenticated;
comment on function public.get_expected_covers(date, text) is
  'PHASE 6 read-only planning suggestion; returns expected covers and the average of the last four same-weekday completed days, never revenue or cost.';

-- Migration 032: User Management safety overlay
begin;

drop policy if exists profiles_admin_insert on public.profiles;
revoke insert, update, delete on table public.profiles
  from public, anon, authenticated;
grant select on table public.profiles to authenticated;

create table if not exists public.user_invitation_audit (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null
    references public.user_invites (id) on delete restrict,
  action text not null
    check (action in ('Sent', 'Resent', 'Cancelled')),
  actor_id uuid references auth.users (id) on delete set null,
  email text not null,
  full_name text not null,
  role text not null,
  old_status text check (old_status in ('Pending', 'Expired')),
  new_status text not null check (new_status in ('Pending', 'Cancelled')),
  occurred_at timestamptz not null default clock_timestamp(),
  constraint user_invitation_audit_status_transition check (
    (action = 'Sent' and old_status is null and new_status = 'Pending')
    or (action = 'Resent' and old_status in ('Pending', 'Expired') and new_status = 'Pending')
    or (action = 'Cancelled' and old_status in ('Pending', 'Expired') and new_status = 'Cancelled')
  )
);

create index if not exists user_invitation_audit_invitation_time_idx
  on public.user_invitation_audit (invitation_id, occurred_at desc);

alter table public.user_invitation_audit enable row level security;
revoke all on table public.user_invitation_audit
  from public, anon, authenticated;
grant select on table public.user_invitation_audit to authenticated;
drop policy if exists user_invitation_audit_admin_read
  on public.user_invitation_audit;
create policy user_invitation_audit_admin_read
  on public.user_invitation_audit for select to authenticated
  using (public.has_app_role(array['Administrator']));

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'Audit records are append-only'
    using errcode = '55000';
end;
$$;

revoke all on function public.prevent_audit_mutation()
  from public, anon, authenticated;

drop trigger if exists profile_role_audit_append_only
  on public.profile_role_audit;
create trigger profile_role_audit_append_only
  before update or delete on public.profile_role_audit
  for each row execute function public.prevent_audit_mutation();

drop trigger if exists profile_account_status_audit_append_only
  on public.profile_account_status_audit;
create trigger profile_account_status_audit_append_only
  before update or delete on public.profile_account_status_audit
  for each row execute function public.prevent_audit_mutation();

drop trigger if exists user_invitation_audit_append_only
  on public.user_invitation_audit;
create trigger user_invitation_audit_append_only
  before update or delete on public.user_invitation_audit
  for each row execute function public.prevent_audit_mutation();

create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' then
    if auth.uid() = old.id and new.role is distinct from old.role then
      raise exception 'Users cannot change their own role'
        using errcode = '42501';
    end if;

    if new.account_status is distinct from old.account_status
      and (
        auth.role() is distinct from 'service_role'
        or current_setting('costtrack.account_status_change', true) is distinct from 'on'
      ) then
      raise exception 'User account status must be changed through the authorized lifecycle workflow'
        using errcode = '42501';
    end if;

    if new.account_status = 'Deactivated'
      and new.account_status is distinct from old.account_status
      and nullif(btrim(coalesce(current_setting('costtrack.account_status_reason', true), '')), '') is null then
      raise exception 'A reason is required to deactivate a user'
        using errcode = '22023';
    end if;

    if old.role = 'Administrator' and new.role is distinct from old.role
      and old.account_status = 'Active' then
      update public.profile_admin_guard
      set administrator_count = administrator_count - 1
      where singleton and administrator_count > 1;

      if not found then
        if exists (
          select 1 from public.profile_admin_guard where singleton
        ) then
          raise exception 'Cannot remove or demote the last active Administrator'
            using errcode = '23514';
        end if;
        raise exception 'Administrator protection state is unavailable'
          using errcode = '55000';
      end if;
    end if;

    if old.role is distinct from new.role then
      if auth.uid() is null
        or not coalesce(public.has_app_role(array['Administrator']), false) then
        raise exception 'Only Administrators may change user roles'
          using errcode = '42501';
      end if;
    end if;

    if old.role is distinct from new.role
      and new.role = 'Administrator'
      and new.account_status = 'Active' then
      update public.profile_admin_guard
      set administrator_count = administrator_count + 1
      where singleton;
      if not found then
        raise exception 'Administrator protection state is unavailable'
          using errcode = '55000';
      end if;
    end if;

    if old.role = 'Administrator'
      and new.role = old.role
      and old.account_status is distinct from new.account_status then
      if old.account_status = 'Active' then
        update public.profile_admin_guard
        set administrator_count = administrator_count - 1
        where singleton and administrator_count > 1;
        if not found then
          raise exception 'Cannot deactivate the last active Administrator'
            using errcode = '23514';
        end if;
      elsif new.account_status = 'Active' then
        update public.profile_admin_guard
        set administrator_count = administrator_count + 1
        where singleton;
        if not found then
          raise exception 'Administrator protection state is unavailable'
            using errcode = '55000';
        end if;
      end if;
    end if;

    return new;
  elsif tg_op = 'INSERT' then
    if new.role = 'Administrator' and new.account_status = 'Active' then
      update public.profile_admin_guard
      set administrator_count = administrator_count + 1
      where singleton;
      if not found then
        raise exception 'Administrator protection state is unavailable'
          using errcode = '55000';
      end if;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.account_status in ('Pending', 'Cancelled') then
      return old;
    end if;
    if old.role = 'Administrator'
      and old.account_status = 'Active'
      and exists (
        select 1
        from public.profile_admin_guard
        where singleton and administrator_count <= 1
      ) then
      raise exception 'Cannot delete the last active Administrator; profile deletion is not supported'
        using errcode = '55000';
    end if;
    raise exception 'Profile deletion is not supported for active or deactivated users'
      using errcode = '55000';
  end if;

  raise exception 'Unsupported profiles operation: %', tg_op
    using errcode = '55000';
end;
$$;

create or replace function public.audit_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  reason_value text;
begin
  if old.role is distinct from new.role then
    reason_value := nullif(
      btrim(coalesce(current_setting('costtrack.role_change_reason', true), '')),
      ''
    );
    if reason_value is null then
      raise exception 'A reason is required to change a user role'
        using errcode = '22023';
    end if;
    insert into public.profile_role_audit (
      user_id, old_role, new_role, changed_by, reason
    ) values (
      old.id, old.role, new.role, auth.uid(), reason_value
    );
  end if;
  return new;
end;
$$;

create or replace function public.costtrack_update_profile_role(
  p_user_id uuid,
  p_new_role text,
  p_reason text default ''
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  existing_role text;
  previous_reason text;
  reason_value text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null
    or not coalesce(public.has_app_role(array['Administrator']), false) then
    raise exception 'Only Administrators may change user roles'
      using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'A user profile is required'
      using errcode = '22023';
  end if;
  if p_new_role is null or p_new_role not in (
    'Administrator',
    'Manager',
    'Receptionist',
    'Inventory Clerk',
    'Chef / Kitchen Staff'
  ) then
    raise exception 'The requested role is not a valid staff role'
      using errcode = '22023';
  end if;
  if char_length(reason_value) > 500 then
    raise exception 'The role-change reason must be 500 characters or fewer'
      using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Users cannot change their own role'
      using errcode = '42501';
  end if;

  perform 1
  from public.profile_admin_guard
  where singleton
  for update;
  if not found then
    raise exception 'Administrator protection state is unavailable'
      using errcode = '55000';
  end if;

  select profile.role
  into existing_role
  from public.profiles as profile
  where profile.id = p_user_id
  for update;
  if not found then
    raise exception 'User profile not found'
      using errcode = 'P0002';
  end if;
  if existing_role = p_new_role then
    return false;
  end if;
  if reason_value = '' then
    raise exception 'A reason is required to change a user role'
      using errcode = '22023';
  end if;

  previous_reason := current_setting('costtrack.role_change_reason', true);
  perform set_config('costtrack.role_change_reason', reason_value, true);
  update public.profiles
  set role = p_new_role
  where id = p_user_id;
  if not found then
    raise exception 'User profile was not updated'
      using errcode = 'P0002';
  end if;
  perform set_config(
    'costtrack.role_change_reason',
    coalesce(previous_reason, ''),
    true
  );
  return true;
end;
$$;

create or replace function public.costtrack_set_profile_account_status(
  p_user_id uuid,
  p_new_status text,
  p_actor_id uuid,
  p_reason text default ''
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  prior_status text;
  reason_value text := btrim(coalesce(p_reason, ''));
  previous_status_change text;
  previous_reason text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'This account operation requires the authorized server workflow'
      using errcode = '42501';
  end if;
  if p_user_id is null or p_actor_id is null
    or p_new_status is null
    or p_new_status not in ('Active', 'Deactivated')
    or char_length(reason_value) > 500 then
    raise exception 'The account status request is invalid'
      using errcode = '22023';
  end if;
  if p_new_status = 'Deactivated' and reason_value = '' then
    raise exception 'A reason is required to deactivate a user'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles as actor
    where actor.id = p_actor_id
      and actor.role = 'Administrator'
      and actor.account_status = 'Active'
  ) then
    raise exception 'Only active Administrators may manage user accounts'
      using errcode = '42501';
  end if;
  if p_new_status = 'Deactivated' and p_user_id = p_actor_id then
    raise exception 'Administrators cannot deactivate their own account'
      using errcode = '42501';
  end if;

  perform 1
  from public.profile_admin_guard
  where singleton
  for update;
  if not found then
    raise exception 'Administrator protection state is unavailable'
      using errcode = '55000';
  end if;

  select profile.account_status
  into prior_status
  from public.profiles as profile
  where profile.id = p_user_id
  for update;
  if not found then
    raise exception 'User profile not found'
      using errcode = 'P0002';
  end if;
  if prior_status not in ('Active', 'Deactivated') then
    raise exception 'Only active or deactivated staff accounts can change status'
      using errcode = '55000';
  end if;
  if prior_status = p_new_status then
    return false;
  end if;

  previous_status_change := current_setting('costtrack.account_status_change', true);
  previous_reason := current_setting('costtrack.account_status_reason', true);
  perform set_config('costtrack.account_status_change', 'on', true);
  perform set_config('costtrack.account_status_reason', reason_value, true);
  update public.profiles
  set account_status = p_new_status,
      updated_at = clock_timestamp()
  where id = p_user_id;
  perform set_config(
    'costtrack.account_status_change',
    coalesce(previous_status_change, ''),
    true
  );
  perform set_config(
    'costtrack.account_status_reason',
    coalesce(previous_reason, ''),
    true
  );

  insert into public.profile_account_status_audit (
    user_id, old_status, new_status, changed_by, reason
  ) values (
    p_user_id, prior_status, p_new_status, p_actor_id, reason_value
  );
  return true;
end;
$$;

create or replace function public.guard_user_invite()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  inviter_role text;
  service_workflow boolean := auth.role() = 'service_role';
begin
  if tg_op = 'INSERT' then
    new.email := lower(btrim(new.email));
    new.full_name := btrim(new.full_name);
    new.invited_at := clock_timestamp();
    new.created_at := new.invited_at;
    new.updated_at := new.invited_at;
    if new.status <> 'Pending' then
      raise exception 'New invitations must start as Pending'
        using errcode = '23514';
    end if;
    select profile.role
    into inviter_role
    from public.profiles as profile
    where profile.id = new.invited_by
      and profile.account_status = 'Active'
    for share;
    if inviter_role is distinct from 'Administrator' then
      raise exception 'The inviter must be an active Administrator'
        using errcode = '42501';
    end if;
    if exists (
      select 1
      from public.profiles as profile
      where lower(profile.email) = new.email
    ) then
      raise exception 'A profile already exists for this email address'
        using errcode = '23505';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.full_name is distinct from old.full_name
      or new.role is distinct from old.role
      or new.invited_by is distinct from old.invited_by
      or new.invited_at is distinct from old.invited_at
      or new.created_at is distinct from old.created_at then
      raise exception 'Invitation identity fields cannot be changed'
        using errcode = '55000';
    end if;
    if new.expires_at is distinct from old.expires_at
      and (
        not service_workflow
        or old.status not in ('Pending', 'Expired')
        or new.expires_at <= clock_timestamp()
      ) then
      raise exception 'Invitation expiry can only be refreshed by the authorized resend workflow'
        using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      if not service_workflow then
        raise exception 'Invitation status changes must use the authorized lifecycle workflow'
          using errcode = '42501';
      end if;
      if old.status not in ('Pending', 'Expired') then
        raise exception 'A completed invitation cannot change status'
          using errcode = '55000';
      end if;
      if new.status = 'Accepted' then
        if old.status <> 'Pending' or old.expires_at <= clock_timestamp() then
          raise exception 'An expired invitation cannot be accepted'
            using errcode = '23514';
        end if;
        new.accepted_at := clock_timestamp();
        if new.accepted_at < old.invited_at
          or new.accepted_at > clock_timestamp() then
          raise exception 'The acceptance timestamp is invalid'
            using errcode = '23514';
        end if;
      elsif new.status = 'Expired' then
        if old.status <> 'Pending' or old.expires_at > clock_timestamp() then
          raise exception 'An invitation cannot expire before its expiry time'
            using errcode = '23514';
        end if;
        new.accepted_at := null;
      elsif new.status = 'Cancelled' then
        new.accepted_at := null;
      elsif new.status = 'Pending' and old.status = 'Expired' then
        if new.expires_at <= clock_timestamp() then
          raise exception 'A resent invitation must have a future expiry'
            using errcode = '23514';
        end if;
        new.accepted_at := null;
      else
        raise exception 'Unsupported invitation status transition'
          using errcode = '23514';
      end if;
    elsif new.accepted_at is distinct from old.accepted_at then
      raise exception 'Acceptance timestamps can only change with invitation status'
        using errcode = '55000';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    raise exception 'Invitation records cannot be deleted; change their status instead'
      using errcode = '55000';
  end if;
  raise exception 'Unsupported user_invites operation: %', tg_op
    using errcode = '55000';
end;
$$;

create or replace function public.costtrack_record_user_invitation_sent(
  p_invitation_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  invitation public.user_invites%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Invitation audit requires the authorized server workflow'
      using errcode = '42501';
  end if;
  if p_invitation_id is null or p_actor_id is null then
    raise exception 'The invitation audit request is invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and role = 'Administrator' and account_status = 'Active'
  ) then
    raise exception 'Only active Administrators may send invitations'
      using errcode = '42501';
  end if;
  select * into invitation
  from public.user_invites
  where id = p_invitation_id
  for update;
  if not found or invitation.status <> 'Pending'
    or invitation.expires_at <= clock_timestamp() then
    raise exception 'The invitation is not active and pending'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from public.user_invitation_audit
    where invitation_id = p_invitation_id and action = 'Sent'
  ) then
    return false;
  end if;

  insert into public.user_invitation_audit (
    invitation_id, action, actor_id, email, full_name, role, old_status, new_status
  ) values (
    invitation.id, 'Sent', p_actor_id, invitation.email, invitation.full_name,
    invitation.role, null, 'Pending'
  );
  return true;
end;
$$;

create or replace function public.costtrack_resend_user_invitation(
  p_invitation_id uuid,
  p_actor_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  invitation public.user_invites%rowtype;
  old_status text;
  new_expiry timestamptz := clock_timestamp() + interval '7 days';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Invitation resend requires the authorized server workflow'
      using errcode = '42501';
  end if;
  if p_invitation_id is null or p_actor_id is null then
    raise exception 'The invitation resend request is invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and role = 'Administrator' and account_status = 'Active'
  ) then
    raise exception 'Only active Administrators may resend invitations'
      using errcode = '42501';
  end if;

  select * into invitation
  from public.user_invites
  where id = p_invitation_id
  for update;
  if not found then
    raise exception 'Invitation not found'
      using errcode = 'P0002';
  end if;
  if invitation.status not in ('Pending', 'Expired') then
    raise exception 'Only pending or expired invitations can be resent'
      using errcode = '55000';
  end if;
  old_status := case
    when invitation.status = 'Pending'
      and invitation.expires_at <= clock_timestamp() then 'Expired'
    else invitation.status
  end;
  if exists (
    select 1 from public.profiles
    where lower(email) = invitation.email
      and account_status not in ('Pending')
  ) then
    raise exception 'An account already exists for this email address'
      using errcode = '23505';
  end if;

  update public.user_invites
  set status = 'Pending',
      expires_at = new_expiry
  where id = invitation.id;

  insert into public.user_invitation_audit (
    invitation_id, action, actor_id, email, full_name, role, old_status, new_status
  ) values (
    invitation.id, 'Resent', p_actor_id, invitation.email, invitation.full_name,
    invitation.role, old_status, 'Pending'
  );
  return new_expiry;
end;
$$;

create or replace function public.costtrack_cancel_user_invitation(
  p_invitation_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  invitation public.user_invites%rowtype;
  target_user_id uuid;
  prior_status text;
  effective_old_status text;
  previous_status_change text;
  previous_reason text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Invitation cancellation requires the authorized server workflow'
      using errcode = '42501';
  end if;
  if p_invitation_id is null or p_actor_id is null then
    raise exception 'The invitation cancellation request is invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and role = 'Administrator' and account_status = 'Active'
  ) then
    raise exception 'Only active Administrators may cancel invitations'
      using errcode = '42501';
  end if;

  perform 1
  from public.profile_admin_guard
  where singleton
  for update;
  if not found then
    raise exception 'Administrator protection state is unavailable'
      using errcode = '55000';
  end if;

  select * into invitation
  from public.user_invites
  where id = p_invitation_id
  for update;
  if not found then
    raise exception 'Invitation not found'
      using errcode = 'P0002';
  end if;

  select profile.id, profile.account_status
  into target_user_id, prior_status
  from public.profiles as profile
  where lower(profile.email) = invitation.email
  for update;

  if invitation.status = 'Accepted' then
    raise exception 'An accepted invitation cannot be cancelled; deactivate the staff account instead'
      using errcode = '55000';
  end if;
  if invitation.status not in ('Pending', 'Expired', 'Cancelled') then
    raise exception 'This invitation cannot be cancelled'
      using errcode = '55000';
  end if;
  if prior_status in ('Active', 'Deactivated') then
    raise exception 'This invitation is linked to an existing staff account'
      using errcode = '55000';
  end if;

  effective_old_status := case
    when invitation.status = 'Pending'
      and invitation.expires_at <= clock_timestamp() then 'Expired'
    else invitation.status
  end;
  if invitation.status <> 'Cancelled' then
    update public.user_invites
    set status = 'Cancelled'
    where id = invitation.id;

    insert into public.user_invitation_audit (
      invitation_id, action, actor_id, email, full_name, role, old_status, new_status
    ) values (
      invitation.id, 'Cancelled', p_actor_id, invitation.email, invitation.full_name,
      invitation.role, effective_old_status, 'Cancelled'
    );
  end if;

  if target_user_id is not null and prior_status = 'Pending' then
    previous_status_change := current_setting('costtrack.account_status_change', true);
    previous_reason := current_setting('costtrack.account_status_reason', true);
    perform set_config('costtrack.account_status_change', 'on', true);
    perform set_config('costtrack.account_status_reason', 'Invitation cancelled', true);
    update public.profiles
    set account_status = 'Cancelled',
        updated_at = clock_timestamp()
    where id = target_user_id;
    perform set_config(
      'costtrack.account_status_change',
      coalesce(previous_status_change, ''),
      true
    );
    perform set_config(
      'costtrack.account_status_reason',
      coalesce(previous_reason, ''),
      true
    );

    insert into public.profile_account_status_audit (
      user_id, old_status, new_status, changed_by, invitation_id, reason
    ) values (
      target_user_id, 'Pending', 'Cancelled', p_actor_id, invitation.id,
      'Invitation cancelled'
    );
  end if;
  return target_user_id;
end;
$$;

revoke all on function public.prevent_audit_mutation()
  from public, anon, authenticated;
revoke all on function public.costtrack_record_user_invitation_sent(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.costtrack_resend_user_invitation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.costtrack_cancel_user_invitation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.costtrack_set_profile_account_status(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.costtrack_update_profile_role(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.costtrack_record_user_invitation_sent(uuid, uuid)
  to service_role;
grant execute on function public.costtrack_resend_user_invitation(uuid, uuid)
  to service_role;
grant execute on function public.costtrack_cancel_user_invitation(uuid, uuid)
  to service_role;
grant execute on function public.costtrack_set_profile_account_status(uuid, text, uuid, text)
  to service_role;
grant execute on function public.costtrack_update_profile_role(uuid, text, text)
  to authenticated;

commit;
