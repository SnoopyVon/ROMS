begin;

drop policy if exists audit_logs_actor_read on public.audit_logs;

commit;
