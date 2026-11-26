-- Keep immutable reservation attribution when an Auth account is removed.
begin;

alter table public.reservations
  drop constraint if exists reservations_created_by_fkey;

commit;
