begin;

drop policy if exists audit_logs_actor_read on public.audit_logs;
create policy audit_logs_actor_read
  on public.audit_logs for select to authenticated
  using (actor_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'audit_logs'
     ) then
    execute 'alter publication supabase_realtime add table public.audit_logs';
  end if;
end;
$$;

commit;
