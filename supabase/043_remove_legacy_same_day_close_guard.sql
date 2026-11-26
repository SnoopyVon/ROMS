begin;

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
  if public.current_app_role() = 'Receptionist'
    and shift_row.opened_by is distinct from auth.uid() then
    raise exception 'Receptionists can close only their own shift.' using errcode = '42501';
  end if;
  if shift_row.status <> 'Open' then
    return jsonb_build_object('shift', to_jsonb(shift_row), 'already_closed', true);
  end if;
  if public.current_app_role() in ('Manager', 'Administrator')
    and shift_row.opened_by is distinct from auth.uid()
    and nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception 'A reason is required when closing another cashier''s shift.'
      using errcode = '22023';
  end if;

  for open_bill in
    select b.id, b.bill_number
    from public.pos_bills b
    where b.status = 'Open'
      and (b.shift_id = shift_row.id
        or (b.shift_id is null
          and (b.created_at at time zone 'Asia/Manila')::date =
            (shift_row.opened_at at time zone 'Asia/Manila')::date))
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

  if exists (
    select 1
    from public.pos_bills b
    where b.status = 'Open'
      and (b.shift_id = shift_row.id
        or (b.shift_id is null
          and (b.created_at at time zone 'Asia/Manila')::date =
            (shift_row.opened_at at time zone 'Asia/Manila')::date))
  ) or exists (
    select 1
    from public.pos_bills b
    join public.pos_bill_approvals a on a.bill_id = b.id
    where a.status = 'Pending'
      and (b.shift_id = shift_row.id
        or (b.shift_id is null
          and (b.created_at at time zone 'Asia/Manila')::date =
            (shift_row.opened_at at time zone 'Asia/Manila')::date))
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

commit;
