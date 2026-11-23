-- Disable verification writes only after rolling back the invite-user
-- Edge Function. Audit rows, read access, append-only protection, and the
-- private evidence bucket are intentionally retained.
begin;

drop function if exists public.costtrack_create_verification_record(
  uuid, uuid, text, text, text, uuid, text, text, text, jsonb, numeric,
  text, boolean, text, text, text, boolean, timestamptz, text, uuid
);

commit;
