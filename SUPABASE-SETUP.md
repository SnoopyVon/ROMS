# Supabase deployment and account setup

## Apply the schema

1. Back up the project before changing its database.
2. Run [`supabase-schema.sql`](./supabase/supabase-schema.sql) in the Supabase SQL Editor as the project database owner.
3. Check `public.app_records_migrations` for `typed_app_records_backfill_v1`. The supported collections are copied into typed tables atomically; the legacy JSON table remains locked as an archive.
4. If the migration marker is missing, inspect `public.app_records_migration_errors` in the SQL Editor, repair the reported legacy row, and rerun the schema. A failed backfill does not delete the source records.
5. Confirm the migrated counts in the typed tables before deploying the updated browser files.

The schema deliberately does not import the old `users` collection as real accounts. It removes the former anonymous `app_records` policies and grants public access only to the reservation RPCs.

## Phase 1 inventory foundation

The Phase 1 migration is additive and depends on the base schema above. Before applying it, make and verify a database backup, then run [`phase8_inventory_architecture_migration.sql`](./supabase/phase8_inventory_architecture_migration.sql) as the database owner in a non-production project first. Do not apply it to a live project until the non-production checks pass.

If you already applied an earlier version of Phase 8, do **not** paste and rerun the full Phase 8 file. Back up the database, then run [`phase8_receiving_invoice_upgrade.sql`](./supabase/phase8_receiving_invoice_upgrade.sql) instead. It adds only the invoice fields and receiving batch/RPC behavior, and is safe to rerun. If Phase 8 has not been applied at all, apply the current full Phase 8 migration first; do not run both files for the same database.

For an existing Phase 8 database, also run [`phase8_product_details_upgrade.sql`](./supabase/phase8_product_details_upgrade.sql) after the receiving invoice upgrade. This separate, rerunnable upgrade adds preferred supplier, expiry tracking, and product notes. Do not rerun the full Phase 8 migration to add these fields. Fresh installations using the current full Phase 8 migration do not need this additional upgrade.

After it runs:

1. Inspect `public.inventory_migration_issues` for products with unknown unit conversions, duplicate product names, and legacy production rows without a recipe mapping. Resolve each issue before relying on converted quantities or migrated recipe versions.
2. Verify each positive existing stock balance has exactly one opening batch and matching opening movement. Its received date is the migration date and it has no expiration date because legacy data did not store either value.
3. Verify duplicate legacy recipe names are represented as versions with only the latest recipe active; compare recipe versions and ingredient quantities with the source tables.
4. Confirm the application loads product and recipe data through `costtrack_load_products()` and `costtrack_load_recipes()`, product edits use `costtrack_save_product()`, and recipe edits use `save_recipe()`. The product form uses active category, unit, and supplier suggestions; expiry-tracked products require an expiration date when received.
5. Test all roles, especially that Chef / Kitchen Staff cannot read product costs, recipe prices, or reports, and that only Administrators can create or edit products.
6. After applying the full migration or the receiving upgrade, the receiving panel saves an invoice and multiple product lines through `costtrack_receive_delivery()`. Confirm the supplier, invoice, dates, quantities, costs, lot numbers, and expiration dates are saved with their stock movements and inventory batches.

The new dish/version tables are a migration baseline; recipe edits still use the legacy recipe tables and RPC until those workflows are migrated. The new receiving RPC records each delivery as a batch and stock movement, while the existing inventory transaction trigger updates on-hand stock. Until Phase 9 is applied, production, waste, and physical-count writes remain on their legacy workflows. Phase 9 adds a production status queue but still uses the existing production stock trigger; FIFO/FEFO consumption is not enabled. Do not replay old inventory movements into opening batches or apply both legacy and new writes for the same receipt. The migration is designed to be rerunnable but has no automatic rollback; restore the verified backup if rollback is required.

## Phase 9 buffet production board

After the Phase 8 inventory migration and any required Phase 8 upgrades above are complete, back up the database and run [`phase9_buffet_production_migration.sql`](./supabase/phase9_buffet_production_migration.sql) once in the Supabase SQL Editor as the database owner. Do not rerun Phase 8 to enable the production board.

Phase 9 adds recipe batch yield, per-service prep targets, and Chef-facing preparation notes. It also creates a separately numbered batch queue; starting a batch does not deduct stock, while marking it Ready creates the append-only production log and applies the existing stock deduction atomically. Historical production logs are summarized as Ready batches, with unknown cooking/ready times left blank.

After applying it, confirm that `costtrack_load_recipes()` returns the new recipe fields and the app can load, start, and complete batches for today. Test all three actions with a recipe that has enough inventory, then test a batch with insufficient inventory to confirm it remains Cooking and no stock is deducted. Chef / Kitchen Staff can run the board but cannot edit recipe setup or view recipe costs; Administrators and Managers can configure categories, ingredients, yield, target, and prep notes. Apply this migration before deploying the updated app files.

## Phase 10 custom portions and production history

After Phase 9 is applied, back up the database and run [`phase10_custom_portions_production_history.sql`](./supabase/phase10_custom_portions_production_history.sql) as the database owner before deploying the updated app. This additive upgrade lets the Chef start each numbered cooking batch with half/full recipe yield or a custom whole-number portion amount (1–10,000). Recipe ingredient stock use is scaled to the chosen portions while each production log still counts as one physical batch.

The board’s Production history can filter by date range (up to 91 days), activity time, dish, and Cooking/Ready status. Activity time means the start time for a cooking batch or the ready time for a completed batch. Phase 9 backfilled earlier logs as completed batches but could not recover their exact times; these older entries are shown as “Not recorded (legacy)” and are excluded when a time filter is applied. Test a half-yield and custom-size batch, then confirm the stock deduction is proportional and its history shows the selected portions and timestamps.

## Phase 11 quick waste logging

After Phase 10, back up the database and run [`phase11_waste_workflow_migration.sql`](./supabase/phase11_waste_workflow_migration.sql) as the database owner before deploying the updated app. It adds waste-entry notes, an activity timestamp, and the authenticated staff ID. Existing waste entries remain intact; their historical times and staff are left unknown.

The waste form has searchable ingredient selection, one-tap common reasons, a stock balance preview, optional notes, and optional production-log context. Before saving, the user confirms the quantity and estimated remaining stock. The database still records each entry as append-only and atomically deducts stock once; it rejects a deduction that would make stock negative. Waste history can be filtered by date, time, ingredient, reason, and staff (including legacy entries). Estimated costs remain restricted to Administrators and Managers.

Only items actually being discarded belong in Waste Logs. Food stored safely or reused is not recorded as waste; if it is later discarded, log it then. This avoids counting retained food as a loss or deducting stock twice.

## Phase 12 past reservation protection

For an existing database using the current base schema, back up the project and run [`phase12_reservation_history_guard.sql`](./supabase/phase12_reservation_history_guard.sql) in the Supabase SQL Editor as the database owner before deploying the updated app. Fresh installations using the current `supabase-schema.sql` already include these protections.

Past reservations remain visible but are read-only for Receptionists. Administrators and Managers can correct the guest name, contact details, occasion, seating preference, or special-request notes only; date, time, party size, table, status, and seating/completion outcomes are locked. Every such correction requires a new reason of 10–500 characters, which is stored on the reservation and included in the existing Administrator-readable audit log. Past reservations cannot be deleted or have their status changed. The database enforces these rules even if a client bypasses the UI.

After applying the migration, test as Receptionist, Manager, and Administrator: view a past booking as Receptionist and confirm there is no save/status/delete action; make an allowed correction as Manager or Administrator with a reason; verify the audit row records the actor and old/new values; then confirm direct attempts to alter a past booking's status/date or delete it are rejected. Upcoming reservation behavior is unchanged.

## Phase 13 restaurant reservation hours

For an existing database, back up the project and run [`phase13_reservation_hours.sql`](./supabase/phase13_reservation_hours.sql) in the Supabase SQL Editor as the database owner before deploying the updated app. Fresh installations using the current `supabase-schema.sql` already include this rule.

Phase 16 below supersedes Phase 13's former start-time-only rule. After Phase 16 is applied, reservations must fit a two-hour window between 10:00 AM and 9:00 PM, so the latest selectable start is 7:00 PM.

The Phase 13 migration remains part of the migration history; do not rerun it to enable the two-hour rule.

## Phase 14 table management

For an existing database, back up the project and run [`phase14_table_management.sql`](./supabase/phase14_table_management.sql) in the Supabase SQL Editor as the database owner before deploying the updated app. Fresh installations using the current `supabase-schema.sql` already include these protections.

The Table Management page is available to Administrators, Managers, and Receptionists. It shows date-based table availability, booking details, capacity, and unassigned-booking assignment; only Administrators and Managers can add, edit, or delete table records. Table capacity, assignment conflicts, and reservation-history deletion protection are also enforced by database triggers and row-level security. No-show bookings do not block reassignment. Phase 16 adds the two-hour overlap rule for assigned active bookings.

After applying the migration, test as Receptionist and Manager: confirm the Receptionist can view tables and assign an eligible booking but cannot add, edit, or delete tables; confirm a Manager can manage table capacity; verify an undersized table, duplicate active table/time assignment, and capacity reduction below an active party are rejected. Confirm a table referenced by any reservation history cannot be deleted, including by direct database writes.

## Phase 15 restaurant seating layout

After Phase 14, back up the project and run [`phase15_restaurant_table_layout.sql`](./supabase/phase15_restaurant_table_layout.sql) as the database owner before deploying the updated table-management UI. Fresh installations using the current `supabase-schema.sql` already include the `table_type` and `area` columns.

The requested layout is 15 tables and 91 seats: 3 Family tables (two 12-seat and one 8-seat); and 12 Casual tables (one 8-seat at the back, three 6-seat tables with two front and one back, three 5-seat tables at the back, four 4-seat tables with three front and one back, and one 2-seat table at the front). Managers and Administrators can use **Set up restaurant layout** to reconcile existing records to those exact capacities and categories, adding only missing slots. Existing table IDs and reservation history are preserved; legacy IDs are assigned in natural ID order. Extra legacy tables are kept as Unclassified rather than deleted. A capacity reduction is blocked if it would make an upcoming Pending, Confirmed, or Seated reservation larger than the table; resolve or reassign that reservation before retrying setup. Historical and cancelled reservations do not block the layout. Reservation records keep their existing table IDs.

Use the Table type and Area filters to browse Family/Casual groups and Front/Back areas. Test setup on a database backup or staging project first, then confirm the table total and each group count before assigning new reservations.

## Phase 16 two-hour table stays

Back up the existing Supabase project, then run [`phase16_two_hour_table_stays.sql`](./supabase/phase16_two_hour_table_stays.sql) in the SQL Editor as the database owner. Apply it after the already-applied Phases 12–15 and before deploying the updated app. Do not paste the full baseline schema into an existing database or rerun Phases 12–15. Fresh installations using the updated `supabase-schema.sql` already include these rules.

Reservations and walk-ins get a two-hour window. The full window must fit between 10:00 AM and 9:00 PM, making 7:00 PM the latest start. The database rejects out-of-hours active bookings and prevents overlapping Pending, Confirmed, or Seated bookings on the same table and date, including concurrent assignments. Back-to-back bookings at the exact two-hour boundary are allowed. Walk-ins also count as Seated reservation records and use the same table availability rules.

Live table status is derived from reservations and walk-ins; cached `restaurant_tables.status` and `guest` values are no longer used to decide whether a table is Available, Reserved, or Occupied. Realtime database changes refresh the app, and the Reservations/Table Management views also recalculate every minute. A Seated party stays Occupied after two hours until staff confirms departure and marks it Completed. The app displays a “two-hour limit reached” reminder for staff; it does not automatically complete a reservation, release a table, or message a guest.

The migration does not rewrite existing bookings or resolve any overlaps that were already present. Before relying on table assignments, review active same-table bookings for overlapping two-hour windows and resolve any conflicts through normal reservation status or assignment actions. An unresolved Seated booking from a prior day also keeps the table Occupied today and blocks new assignments for today until staff marks it Completed. Then test a reservation at 10:00 AM and 7:00 PM, confirm that 7:30 PM and later starts are rejected, verify that a 1:00 PM booking conflicts with 2:30 PM but allows 3:00 PM, and confirm that a still-Seated party remains Occupied after its two-hour limit until staff marks it Completed.

## Provision real users

Do not add signup or service-role credentials to the browser. For each employee:

1. Create or invite the account in **Supabase Dashboard → Authentication → Users** and confirm the email.
2. Copy the Auth user's UUID.
3. In the SQL Editor, create its profile. Create the first Administrator this way:

```sql
insert into public.profiles (id, email, full_name, role)
values ('<AUTH_USER_UUID>'::uuid, '<EMAIL>', '<FULL_NAME>', 'Administrator');
```

Use one of these exact roles for other profiles: `Manager`, `Inventory Clerk`, `Chef / Kitchen Staff`, or `Receptionist`. The profile role is authoritative; users cannot change their own role from the app. User creation remains an administrator-controlled Supabase operation.

## Auth redirect configuration

Serve the files over HTTP(S), not `file://`. In **Authentication → URL Configuration**, set the production Site URL and add the dashboard URL (ending in `/index.html`) to the allowed Redirect URLs so password-reset links return to the app.

## Reservation calendar

The **Tables / Calendar** page uses FullCalendar 7.1.4 from jsDelivr and reads the reservations already loaded from Supabase. It provides month, week, day, and agenda views, with status/type filters and guest search. Timed views display 10:00 AM–9:00 PM. Select a date to open the existing reservation form with that date prefilled, or click a time slot to prefill both the date and time; select a booking to edit it. The calendar does not save bookings directly; existing reservation validation, permissions, and Supabase persistence still apply.

The calendar assets are served by the CDN, so the calendar page requires an internet connection; the Reservations page remains available as a fallback if those assets cannot load. Reservations currently store a start time but no duration, so week/day views show only a short visual marker and do not imply or save a booking length.

## Operational checks

- Confirm anonymous clients cannot select, insert, update, or delete business tables or profiles.
- Confirm authenticated roles can only access the modules assigned by the RLS policies; Revenue is limited to Administrators and Managers.
- Confirm recipe writes use the atomic `save_recipe` RPC and reservation status lookups require both a reference and matching email/phone.
- Keep the publishable key in the browser; never expose a Supabase `service_role` key.
- Use the app's connection indicator to retry queued changes. Resolve stale-record conflicts by reloading before reapplying a change.

## POS Phase 2 billing workflow

Apply the POS migrations in this order as the database owner, after the base schema and its prerequisites:

1. [`004_pos_foundation_schema.sql`](./supabase/004_pos_foundation_schema.sql) — Phase 1 catalog, package tiers, discounts, settings, and billing tables.
2. [`005_pos_foundation_security.sql`](./supabase/005_pos_foundation_security.sql) — Phase 1 RLS and role matrix.
3. [`006_pos_billing_workflow.sql`](./supabase/006_pos_billing_workflow.sql) — server-calculated bills, payment and approval RPCs, and RPC-only bill writes.

Phase 2 seeds Adult 449, Senior/PWD 360, Kids 225, Comped 0, and a 200 non-food Leftover charge example. The service-charge mode remains `none`. Deposits are bill-payment records; they are not discounts. Bills with applied payments cannot be voided in this phase because refunds are not implemented.

After applying the migrations, [`006_pos_billing_workflow_acceptance.sql`](./supabase/006_pos_billing_workflow_acceptance.sql) checks the worked example, role denials, approval audit fields, cash change, and repeated close. It requires profiles for Receptionist, Manager, Inventory Clerk, and Chef / Kitchen Staff. The script rolls its rows back, but PostgreSQL sequence values do not roll back, so it may leave harmless bill-number gaps.

If Phase 2 must be rolled back, back up the database and run [`006_pos_billing_workflow_rollback.sql`](./supabase/006_pos_billing_workflow_rollback.sql). It removes only Phase 2 POS changes and restores the Phase 1 bill/settings policies; the bill-number sequence is intentionally retained to prevent reuse. Do not run the Phase 1 rollback unless you also intend to remove the POS foundation.
