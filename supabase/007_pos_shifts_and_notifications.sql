-- POS Phase 3 (part 1): shift ownership, cash movements, reconciliation,
-- and deduplicated manager/admin operational alerts.
-- Run after 006_pos_billing_workflow.sql.

begin;

alter table public.pos_shifts
  add column if not exists expected_cash numeric(12,2),
  add column if not exists cash_variance numeric(12,2),
  add column if not exists closed_by uuid;

alter table public.pos_cash_movements
  add column if not exists idempotency_key text;

alter table public.pos_bills
  add column if not exists shift_id text,
  add column if not exists table_id text;

alter table public.pos_bill_payments
  add column if not exists shift_id text;

alter table public.pos_reservation_deposits
  add column if not exists received_shift_id text,
  add column if not exists receipt_amount numeric(12,2);

update public.pos_reservation_deposits
set receipt_amount = case when payment_method = 'cash' then amount else 0 end
where receipt_amount is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_bills'::regclass
      and conname = 'pos_bills_shift_id_fkey'
  ) then
    alter table public.pos_bills
      add constraint pos_bills_shift_id_fkey
      foreign key (shift_id) references public.pos_shifts(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_bills'::regclass
      and conname = 'pos_bills_table_id_fkey'
  ) then
    alter table public.pos_bills
      add constraint pos_bills_table_id_fkey
      foreign key (table_id) references public.restaurant_tables(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_bill_payments'::regclass
      and conname = 'pos_bill_payments_shift_id_fkey'
  ) then
    alter table public.pos_bill_payments
      add constraint pos_bill_payments_shift_id_fkey
      foreign key (shift_id) references public.pos_shifts(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_reservation_deposits'::regclass
      and conname = 'pos_reservation_deposits_received_shift_id_fkey'
  ) then
    alter table public.pos_reservation_deposits
      add constraint pos_reservation_deposits_received_shift_id_fkey
      foreign key (received_shift_id) references public.pos_shifts(id) on delete restrict;
  end if;
end;
$$;

create unique index if not exists pos_shifts_one_open_per_cashier_uidx
  on public.pos_shifts (opened_by)
  where status = 'Open';
create unique index if not exists pos_shifts_one_per_cashier_business_day_uidx
  on public.pos_shifts (
    opened_by,
    ((opened_at at time zone 'Asia/Manila')::date)
  );
create unique index if not exists pos_cash_movements_idempotency_uidx
  on public.pos_cash_movements (shift_id, idempotency_key)
  where idempotency_key is not null;

insert into public.pos_settings
  (id, setting_key, setting_value, setting_type, description, is_system)
values
  ('pos-setting-max-shift-hours', 'pos_max_shift_hours', '12', 'number',
   'Notify managers when an open cashier shift exceeds this many hours.', true)
on conflict (setting_key) do nothing;

create table if not exists public.pos_notifications (
  id text primary key default gen_random_uuid()::text,
  notification_type text not null check (
    notification_type in ('open_bill_shift_close', 'long_open_shift', 'pending_approval')
  ),
  source_type text not null check (source_type in ('bill', 'shift', 'approval')),
  source_id text not null,
  target_role text not null check (target_role in ('Manager', 'Administrator')),
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create unique index if not exists pos_notifications_source_recipient_uidx
  on public.pos_notifications (notification_type, source_id, target_role);
create index if not exists pos_notifications_unread_idx
  on public.pos_notifications (target_role, created_at desc)
  where read_at is null;

alter table public.pos_notifications enable row level security;
drop policy if exists pos_notifications_role_read on public.pos_notifications;
create policy pos_notifications_role_read on public.pos_notifications
  for select to authenticated
  using (target_role = public.current_app_role()
    and public.has_app_role(array['Administrator', 'Manager']));
revoke all on public.pos_notifications from public, anon, authenticated;
grant select on public.pos_notifications to authenticated;

-- Shift and ledger rows are read-only to browser clients.
alter table public.pos_shifts enable row level security;
alter table public.pos_cash_movements enable row level security;
drop policy if exists pos_shifts_admin_full on public.pos_shifts;
drop policy if exists pos_cash_movements_admin_full on public.pos_cash_movements;
drop policy if exists pos_shifts_phase3_read on public.pos_shifts;
drop policy if exists pos_cash_movements_phase3_read on public.pos_cash_movements;
create policy pos_shifts_phase3_read on public.pos_shifts
  for select to authenticated
  using (
    public.has_app_role(array['Administrator', 'Manager'])
    or (public.has_app_role(array['Receptionist']) and opened_by = auth.uid())
  );
create policy pos_cash_movements_phase3_read on public.pos_cash_movements
  for select to authenticated
  using (exists (
    select 1 from public.pos_shifts s
    where s.id = shift_id
      and (
        public.has_app_role(array['Administrator', 'Manager'])
        or (public.has_app_role(array['Receptionist']) and s.opened_by = auth.uid())
      )
  ));
revoke all on public.pos_shifts, public.pos_cash_movements from public, anon, authenticated;
grant select on public.pos_shifts, public.pos_cash_movements to authenticated;

create or replace function public.pos_open_shift(
  p_opening_cash numeric,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  shift_row public.pos_shifts%rowtype;
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Receptionist'])
    or auth.uid() is null then
    raise exception 'Your role cannot open a cashier shift.' using errcode = '42501';
  end if;
  if p_opening_cash is null or p_opening_cash < 0
    or p_opening_cash <> round(p_opening_cash, 2) then
    raise exception 'Starting cash must be a non-negative amount with at most two decimals.'
      using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 500 then
    raise exception 'Shift notes cannot exceed 500 characters.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.pos_shifts
    where opened_by = auth.uid() and status = 'Open'
  ) then
    raise exception 'You already have an open shift.' using errcode = '23505';
  end if;
  if exists (
    select 1
    from public.pos_shifts
    where opened_by = auth.uid()
      and ((opened_at at time zone 'Asia/Manila')::date =
           (now() at time zone 'Asia/Manila')::date)
  ) then
    raise exception 'You can open only one cashier shift per Manila business day.'
      using errcode = '23505';
  end if;

  insert into public.pos_shifts (
    id, shift_code, opened_by, opening_float, status, notes
  ) values (
    gen_random_uuid()::text,
    'SHIFT-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || upper(substr(gen_random_uuid()::text, 1, 6)),
    auth.uid(), p_opening_cash, 'Open', nullif(trim(coalesce(p_notes, '')), '')
  )
  returning * into shift_row;

  return jsonb_build_object('shift', to_jsonb(shift_row));
end;
$$;

create or replace function public.pos_record_cash_movement(
  p_shift_id text,
  p_movement_type text,
  p_amount numeric,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  shift_row public.pos_shifts%rowtype;
  movement_row public.pos_cash_movements%rowtype;
  movement_value text := lower(trim(coalesce(p_movement_type, '')));
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Receptionist'])
    or auth.uid() is null then
    raise exception 'Your role cannot record POS cash movements.' using errcode = '42501';
  end if;
  if movement_value not in ('paid_in', 'paid_out') then
    raise exception 'Choose Paid in or Paid out.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Amount must be greater than zero and have at most two decimals.'
      using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 or length(trim(p_reason)) > 500 then
    raise exception 'Enter a reason of 1 to 500 characters.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) = 0 or length(p_idempotency_key) > 200 then
    raise exception 'A valid movement idempotency key is required.' using errcode = '22023';
  end if;

  select * into shift_row
  from public.pos_shifts
  where id = p_shift_id
  for update;
  if not found or shift_row.status <> 'Open' then
    raise exception 'The selected shift is not open.' using errcode = '55000';
  end if;
  if shift_row.opened_by <> auth.uid() then
    raise exception 'You can record cash movements only on your own shift.'
      using errcode = '42501';
  end if;

  select * into movement_row
  from public.pos_cash_movements
  where shift_id = p_shift_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('movement', to_jsonb(movement_row), 'already_recorded', true);
  end if;

  insert into public.pos_cash_movements (
    id, shift_id, movement_type, amount, reason, created_by, idempotency_key
  ) values (
    gen_random_uuid()::text, p_shift_id, movement_value, p_amount,
    trim(p_reason), auth.uid(), p_idempotency_key
  )
  returning * into movement_row;

  return jsonb_build_object('movement', to_jsonb(movement_row), 'already_recorded', false);
end;
$$;

create or replace function public.pos_shift_summary(p_shift_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  shift_row public.pos_shifts%rowtype;
  cash_payments numeric(12,2);
  deposit_receipts numeric(12,2);
  paid_in numeric(12,2);
  paid_out numeric(12,2);
  cash_refunds numeric(12,2);
  expected_value numeric(12,2);
  open_bill_count integer;
  pending_approval_count integer;
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Receptionist']) then
    raise exception 'Your role cannot view cashier shifts.' using errcode = '42501';
  end if;
  select * into shift_row from public.pos_shifts where id = p_shift_id;
  if not found then
    raise exception 'Shift not found.' using errcode = 'P0002';
  end if;
  if public.current_app_role() = 'Receptionist' and shift_row.opened_by <> auth.uid() then
    raise exception 'Receptionists can view only their own shifts.' using errcode = '42501';
  end if;

  select coalesce(sum(p.amount), 0) into cash_payments
  from public.pos_bill_payments p
  join public.pos_bills b on b.id = p.bill_id
  where b.shift_id = shift_row.id and p.payment_method = 'cash';

  select coalesce(sum(d.receipt_amount), 0) into deposit_receipts
  from public.pos_reservation_deposits d
  where d.received_shift_id = shift_row.id and d.payment_method = 'cash';

  select
    coalesce(sum(amount) filter (where movement_type = 'paid_in'), 0),
    coalesce(sum(amount) filter (where movement_type = 'paid_out'), 0),
    coalesce(sum(amount) filter (where movement_type in ('refund', 'cash_refund')), 0)
  into paid_in, paid_out, cash_refunds
  from public.pos_cash_movements
  where shift_id = shift_row.id;

  expected_value := round(shift_row.opening_float + cash_payments + deposit_receipts
    + paid_in - paid_out - cash_refunds, 2);

  select count(*) into open_bill_count
  from public.pos_bills b
  where b.status = 'Open'
    and (b.shift_id = shift_row.id
      or (b.shift_id is null and b.created_by = shift_row.opened_by));
  select count(distinct b.id) into pending_approval_count
  from public.pos_bills b
  join public.pos_bill_approvals a on a.bill_id = b.id
  where a.status = 'Pending'
    and (b.shift_id = shift_row.id
      or (b.shift_id is null and b.created_by = shift_row.opened_by));

  return jsonb_build_object(
    'shift', to_jsonb(shift_row),
    'cash_payments', cash_payments,
    'deposit_receipts', deposit_receipts,
    'paid_in', paid_in,
    'paid_out', paid_out,
    'cash_refunds', cash_refunds,
    'expected_cash', expected_value,
    'cash_variance', case when shift_row.declared_cash is null then null
      else round(shift_row.declared_cash - expected_value, 2) end,
    'open_bill_count', open_bill_count,
    'pending_approval_count', pending_approval_count
  );
end;
$$;

create or replace function public.pos_close_shift(
  p_shift_id text,
  p_counted_cash numeric,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  shift_row public.pos_shifts%rowtype;
  expected_value numeric(12,2);
  variance_value numeric(12,2);
  open_bill record;
  alert_role text;
  summary jsonb;
begin
  if not public.has_app_role(array['Administrator', 'Manager', 'Receptionist'])
    or auth.uid() is null then
    raise exception 'Your role cannot close cashier shifts.' using errcode = '42501';
  end if;
  if p_counted_cash is null or p_counted_cash < 0
    or p_counted_cash <> round(p_counted_cash, 2) then
    raise exception 'Counted cash must be non-negative with at most two decimals.'
      using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 500 then
    raise exception 'Shift notes cannot exceed 500 characters.' using errcode = '22023';
  end if;

  select * into shift_row from public.pos_shifts where id = p_shift_id for update;
  if not found then
    raise exception 'Shift not found.' using errcode = 'P0002';
  end if;
  if public.current_app_role() = 'Receptionist' and shift_row.opened_by <> auth.uid() then
    raise exception 'Receptionists can close only their own shift.' using errcode = '42501';
  end if;
  if shift_row.status <> 'Open' then
    return jsonb_build_object('shift', to_jsonb(shift_row), 'already_closed', true);
  end if;
  for open_bill in
    select b.id, b.bill_number
    from public.pos_bills b
    where b.status = 'Open'
      and (b.shift_id = shift_row.id
        or (b.shift_id is null and b.created_by = shift_row.opened_by))
  loop
    foreach alert_role in array array['Manager', 'Administrator']
    loop
      insert into public.pos_notifications (
        notification_type, source_type, source_id, target_role, title, message
      ) values (
        'open_bill_shift_close', 'bill', open_bill.id, alert_role,
        'Bill remains open at shift close',
        format('%s remains open while shift %s was submitted for closing.', open_bill.bill_number, shift_row.shift_code)
      )
      on conflict (notification_type, source_id, target_role) do nothing;
    end loop;
  end loop;

  if exists (select 1 from public.pos_bills b
      where b.status = 'Open'
        and (b.shift_id = shift_row.id
          or (b.shift_id is null and b.created_by = shift_row.opened_by)))
    or exists (
      select 1
      from public.pos_bills b
      join public.pos_bill_approvals a on a.bill_id = b.id
      where a.status = 'Pending'
        and (b.shift_id = shift_row.id
          or (b.shift_id is null and b.created_by = shift_row.opened_by))
    ) then
    return jsonb_build_object(
      'shift', to_jsonb(shift_row),
      'blocked', true,
      'message', 'Resolve all open bills and pending approvals before closing this shift.',
      'summary', public.pos_shift_summary(shift_row.id)
    );
  end if;

  summary := public.pos_shift_summary(shift_row.id);
  expected_value := (summary->>'expected_cash')::numeric;
  variance_value := round(p_counted_cash - expected_value, 2);
  update public.pos_shifts
  set status = case when variance_value = 0 then 'Closed' else 'Needs review' end,
      closed_at = now(),
      closed_by = auth.uid(),
      declared_cash = p_counted_cash,
      expected_cash = expected_value,
      cash_variance = variance_value,
      cash_sales = coalesce((summary->>'cash_payments')::numeric, 0),
      notes = concat_ws(E'\n', nullif(notes, ''), nullif(trim(coalesce(p_notes, '')), ''))
  where id = shift_row.id
  returning * into shift_row;

  return jsonb_build_object(
    'shift', to_jsonb(shift_row),
    'blocked', false,
    'expected_cash', expected_value,
    'counted_cash', p_counted_cash,
    'cash_variance', variance_value,
    'shortage', variance_value < 0,
    'overage', variance_value > 0
  );
end;
$$;

create or replace function public.pos_refresh_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  threshold_hours numeric := 12;
  inserted_count integer := 0;
  affected_rows integer := 0;
  notification_role text;
  source_row record;
begin
  if not public.has_app_role(array['Administrator', 'Manager']) then
    raise exception 'Only Managers and Administrators can refresh POS notifications.'
      using errcode = '42501';
  end if;

  select coalesce(nullif(setting_value, '')::numeric, 12)
  into threshold_hours
  from public.pos_settings
  where setting_key = 'pos_max_shift_hours';
  threshold_hours := coalesce(threshold_hours, 12);
  if threshold_hours < 1 or threshold_hours > 72 then
    raise exception 'POS maximum shift hours must be between 1 and 72.' using errcode = '22023';
  end if;

  for source_row in
    select id, shift_code, opened_at
    from public.pos_shifts
    where status = 'Open'
      and opened_at < now() - make_interval(hours => threshold_hours::integer)
  loop
    foreach notification_role in array array['Manager', 'Administrator']
    loop
      insert into public.pos_notifications (
        notification_type, source_type, source_id, target_role, title, message
      ) values (
        'long_open_shift', 'shift', source_row.id, notification_role,
        'Cashier shift has been open too long',
        format('Shift %s has been open since %s.', source_row.shift_code, source_row.opened_at)
      )
      on conflict (notification_type, source_id, target_role) do nothing;
      get diagnostics affected_rows = row_count;
      inserted_count := inserted_count + affected_rows;
    end loop;
  end loop;

  insert into public.pos_notifications (
    notification_type, source_type, source_id, target_role, title, message
  )
  select
    'pending_approval', 'approval', a.id, roles.target_role,
    'POS approval is pending',
    format('%s approval for bill %s is awaiting review.', a.request_type, b.bill_number)
  from public.pos_bill_approvals a
  join public.pos_bills b on b.id = a.bill_id
  cross join (values ('Manager'), ('Administrator')) as roles(target_role)
  where a.status = 'Pending'
  on conflict (notification_type, source_id, target_role) do nothing;

  get diagnostics affected_rows = row_count;
  inserted_count := inserted_count + affected_rows;
  return inserted_count;
end;
$$;

create or replace function public.pos_mark_notification_read(p_notification_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_app_role(array['Administrator', 'Manager']) then
    raise exception 'Only Managers and Administrators can update notifications.'
      using errcode = '42501';
  end if;
  update public.pos_notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id and target_role = public.current_app_role();
  if not found then
    raise exception 'Notification not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.pos_open_shift(numeric, text) from public, anon;
revoke all on function public.pos_record_cash_movement(text, text, numeric, text, text) from public, anon;
revoke all on function public.pos_shift_summary(text) from public, anon;
revoke all on function public.pos_close_shift(text, numeric, text) from public, anon;
revoke all on function public.pos_refresh_notifications() from public, anon;
revoke all on function public.pos_mark_notification_read(text) from public, anon;
grant execute on function public.pos_open_shift(numeric, text) to authenticated;
grant execute on function public.pos_record_cash_movement(text, text, numeric, text, text) to authenticated;
grant execute on function public.pos_shift_summary(text) to authenticated;
grant execute on function public.pos_close_shift(text, numeric, text) to authenticated;
grant execute on function public.pos_refresh_notifications() to authenticated;
grant execute on function public.pos_mark_notification_read(text) to authenticated;

commit;
