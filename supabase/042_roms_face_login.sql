begin;

create table if not exists public.user_face_templates (
  user_id uuid primary key
    references auth.users (id) on delete cascade,
  descriptor double precision[] not null
    check (cardinality(descriptor) = 128),
  created_at timestamptz not null default clock_timestamp()
);

alter table public.user_face_templates enable row level security;
revoke all on table public.user_face_templates
  from public, anon, authenticated;
grant all on table public.user_face_templates to service_role;

create table if not exists public.face_login_rate_limits (
  ip_hash text primary key
    check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0)
);

alter table public.face_login_rate_limits enable row level security;
revoke all on table public.face_login_rate_limits
  from public, anon, authenticated;
grant all on table public.face_login_rate_limits to service_role;

create or replace function public.costtrack_check_face_login_rate_limit(
  p_ip_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window interval;
  v_attempt_count integer;
begin
  if p_ip_hash is null
    or p_ip_hash !~ '^[0-9a-f]{64}$'
    or p_limit is null
    or p_limit < 1
    or p_limit > 100
    or p_window_seconds is null
    or p_window_seconds < 60
    or p_window_seconds > 3600
  then
    raise exception 'Invalid face login rate limit parameters'
      using errcode = '22023';
  end if;

  v_window := make_interval(secs => p_window_seconds);
  delete from public.face_login_rate_limits
  where window_started_at < v_now - interval '24 hours';

  insert into public.face_login_rate_limits as current_limit (
    ip_hash,
    window_started_at,
    attempt_count
  ) values (
    p_ip_hash,
    v_now,
    1
  )
  on conflict (ip_hash) do update
  set
    window_started_at = case
      when current_limit.window_started_at <= v_now - v_window then v_now
      else current_limit.window_started_at
    end,
    attempt_count = case
      when current_limit.window_started_at <= v_now - v_window then 1
      else current_limit.attempt_count + 1
    end
  returning attempt_count into v_attempt_count;

  return v_attempt_count <= p_limit;
end;
$$;

revoke all on function public.costtrack_check_face_login_rate_limit(
  text,
  integer,
  integer
) from public, anon, authenticated;
grant execute on function public.costtrack_check_face_login_rate_limit(
  text,
  integer,
  integer
) to service_role;

commit;
