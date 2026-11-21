# Supabase deployment and account setup

## Initial schema versus upgrades

Run [`supabase-schema.sql`](./supabase/supabase-schema.sql) only when initializing a new or empty Supabase project. For a database that already contains production data, do not rerun this 4,000+ line baseline to install later changes. Back up the database and apply only the incremental migration files that have not already succeeded, in order. The recent cashier-shift and Activity Log updates are documented under migrations 036 and 037 below.

### Initial setup for a new project

1. Back up the project before changing its database.
2. Run [`supabase-schema.sql`](./supabase/supabase-schema.sql) in the Supabase SQL Editor as the project database owner.
3. Check `public.app_records_migrations` for `typed_app_records_backfill_v1`. The supported collections are copied into typed tables atomically; the legacy JSON table remains locked as an archive.
4. If the migration marker is missing, inspect `public.app_records_migration_errors` in the SQL Editor, repair the reported legacy row, and rerun the schema. A failed backfill does not delete the source records.
5. Confirm the migrated counts in the typed tables before deploying the updated browser files.

The schema deliberately does not import the old `users` collection as real accounts. It removes the former anonymous `app_records` policies and grants public access only to the reservation RPCs.

## Reservation reference email

The Landing Page sends a reservation reference email only after `public_create_reservation` succeeds. The `send-reservation-email` Edge Function verifies the reference and email against a Website reservation and reports its current status (normally **Pending**); it does not change the reservation workflow. If email delivery fails, the customer still sees the saved reference and the reservation remains saved.

The function uses Nodemailer with Gmail SMTP and a Gmail App Password; Google Cloud OAuth credentials are not used. Enable 2-Step Verification on the sender's Google account, then create an App Password in the account's Security settings. Set `GMAIL_USER` to that account and `GMAIL_APP_PASSWORD` to its 16-character App Password in Supabase Edge Function secrets. Do not put either value in browser code or commit them. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions.

Deploy with:

```text
supabase functions deploy send-reservation-email --no-verify-jwt
```

JWT verification is disabled for this public customer flow. The function accepts only a reservation reference and email, checks both against the database using the server-side service key, and builds the email from the matched row. Keep the service key and Gmail App Password server-side. Test delivery with a real Website reservation in a non-production project before using the function for customer bookings.

SMTP availability depends on the Edge Function runtime and network policy. A successful deployment does not guarantee Gmail SMTP can be reached. After setting the secrets, send a test reservation and check the `send-reservation-email` function logs. If the runtime blocks Gmail SMTP, use an email service with an HTTPS API instead.

## Phase 1 inventory foundation

The Phase 1 migration is additive and depends on the base schema above. Before applying it, make and verify a database backup, then run [`phase8_inventory_architecture_migration.sql`](./supabase/phase8_inventory_architecture_migration.sql) as the database owner in a non-production project first. Do not apply it to a live project until the non-production checks pass.

If you already applied an earlier version of Phase 8, do **not** paste and rerun the full Phase 8 file. Back up the database, then run [`phase8_receiving_invoice_upgrade.sql`](./supabase/phase8_receiving_invoice_upgrade.sql) instead. It adds only the invoice fields and receiving batch/RPC behavior, and is safe to rerun. If Phase 8 has not been applied at all, apply the current full Phase 8 migration first; do not run both files for the same database.

For an existing Phase 8 database, also run [`phase8_product_details_upgrade.sql`](./supabase/phase8_product_details_upgrade.sql) after the receiving invoice upgrade. This separate, rerunnable upgrade adds preferred supplier, expiry tracking, and product notes. Do not rerun the full Phase 8 migration to add these fields. Fresh installations using the current full Phase 8 migration do not need this additional upgrade.

After it runs:

1. Inspect `public.inventory_migration_issues` for products with unknown unit conversions, duplicate product names, and legacy production rows without a recipe mapping. Resolve each issue before relying on converted quantities or migrated recipe versions.
2. Verify each positive existing stock balance has exactly one opening batch and matching opening movement. Its received date is the migration date and it has no expiration date because legacy data did not store either value.
3. Verify duplicate legacy recipe names are represented as versions with only the latest recipe active; compare recipe versions and ingredient quantities with the source tables.
4. Confirm the application loads product and recipe data through `costtrack_load_products()` and `costtrack_load_recipes()`, product edits use `costtrack_save_product()`, and recipe edits use `save_recipe()`. The product form uses active category, unit, and supplier suggestions; expiry-tracked products require an expiration date when received.
5. Test all roles, especially that Chef / Kitchen Staff cannot read product or recipe costs, and that only Administrators can create or edit products.
6. After applying the full migration or the receiving upgrade, the receiving panel saves an invoice and multiple product lines through `costtrack_receive_delivery()`. Confirm the supplier, invoice, dates, quantities, costs, lot numbers, and expiration dates are saved with their stock movements and inventory batches.

The new dish/version tables are a migration baseline; recipe edits still use the legacy recipe tables and RPC until those workflows are migrated. The new receiving RPC records each delivery as a batch and stock movement, while the existing inventory transaction trigger updates on-hand stock. Until Phase 9 is applied, production, waste, and physical-count writes remain on their legacy workflows. Phase 9 adds a production status queue but still uses the existing production stock trigger; FIFO/FEFO consumption is not enabled. Do not replay old inventory movements into opening batches or apply both legacy and new writes for the same receipt. The migration is designed to be rerunnable but has no automatic rollback; restore the verified backup if rollback is required.

## Automatic invoice, batch, and shelf-life values

After the existing inventory migrations, apply [`034_inventory_automatic_receipt_dates.sql`](./supabase/034_inventory_automatic_receipt_dates.sql) as the database owner. This additive migration adds `shelf_life_days` to products and replaces the receiving RPC with server-validated automatic behavior.

The browser generates a unique invoice number and lot/batch number for display, while the RPC generates the authoritative fallback lot number and recalculates expiration dates for products with an Administrator-configured shelf life. Invoice and received dates use the Manila business date and cannot be future-dated or earlier than the invoice date. A manual expiration date remains allowed only for tracked products that do not have a configured shelf life.

## Phase 9 buffet production board

After the Phase 8 inventory migration and any required Phase 8 upgrades above are complete, back up the database and run [`phase9_buffet_production_migration.sql`](./supabase/phase9_buffet_production_migration.sql) once in the Supabase SQL Editor as the database owner. Do not rerun Phase 8 to enable the production board.

Phase 9 adds recipe batch yield, per-service prep targets, and Chef-facing preparation notes. It also creates a separately numbered batch queue; starting a batch does not deduct stock, while marking it Ready creates the append-only production log and applies the existing stock deduction atomically. Historical production logs are summarized as Ready batches, with unknown cooking/ready times left blank.

After applying it, confirm that `costtrack_load_recipes()` returns the new recipe fields and the app can load, start, and complete batches for today. Test all three actions with a recipe that has enough inventory, then test a batch with insufficient inventory to confirm it remains Cooking and no stock is deducted. Chef / Kitchen Staff can run the board but cannot edit recipe setup or view recipe costs; Administrators and Managers can configure categories, ingredients, yield, target, and prep notes. Apply this migration before deploying the updated app files.

## Phase 10 custom portions and production history

After Phase 9 is applied, back up the database and run [`phase10_custom_portions_production_history.sql`](./supabase/phase10_custom_portions_production_history.sql) as the database owner before deploying the updated app. This additive upgrade lets the Chef start each numbered cooking batch with half/full recipe yield or a custom whole-number portion amount (1–10,000). Recipe ingredient stock use is scaled to the chosen portions while each production log still counts as one physical batch.

The board’s Production history can filter by date range (up to 91 days), activity time, dish, and Cooking/Ready status. Activity time means the start time for a cooking batch or the ready time for a completed batch. Phase 9 backfilled earlier logs as completed batches but could not recover their exact times; these older entries are shown as “Not recorded (legacy)” and are excluded when a time filter is applied. Test a half-yield and custom-size batch, then confirm the stock deduction is proportional and its history shows the selected portions and timestamps.

## Phase 11 quick waste logging

After Phase 10, back up the database and run [`phase11_waste_workflow_migration.sql`](./supabase/phase11_waste_workflow_migration.sql) as the database owner before deploying the updated app. It adds waste-entry notes, an activity timestamp, and the authenticated staff ID. Existing waste entries remain intact; their historical times and staff are left unknown.

The waste form has searchable ingredient selection, a required single-choice reason chip group, a server-time display, a stock balance preview, optional notes, and optional production-log context. “Other” requires a note. The Manila-local server timestamp is read-only; the database replaces any client-supplied timestamp and date on both RPC and direct inserts. Before saving, the user confirms the quantity and estimated remaining stock. Waste entries remain append-only, and the database atomically deducts stock once and rejects a deduction that would make stock negative. Waste history can be filtered by date, time, ingredient, reason, and staff (including legacy entries). Estimated costs remain restricted to Administrators and Managers.

After migration 020, apply [`021_waste_server_timestamp.sql`](./supabase/021_waste_server_timestamp.sql) as the database owner before deploying the matching browser files. Migration 021 does not rewrite existing waste rows. It enforces the supported reason list and non-blank “Other” notes, sets timestamps and Manila dates on the server, and aligns direct-insert RLS with the waste RPC/UI roles; Inventory Clerk read access to waste reports is unchanged. Run [`021_waste_server_timestamp_acceptance.sql`](./supabase/021_waste_server_timestamp_acceptance.sql) as the database owner; it requires an existing Manager profile and an ingredient with stock, checks server timestamps, validation, idempotent retry, stock deduction, and existing report aggregation, then rolls back all fixtures. Roll back 021 with [`021_waste_server_timestamp_rollback.sql`](./supabase/021_waste_server_timestamp_rollback.sql) before rolling back migration 020.

## Prepared-food and leftover waste

After Phase 9 has created `production_batches` and migration 021 is installed, back up the project and apply [`035_prepared_food_waste.sql`](./supabase/035_prepared_food_waste.sql) as the database owner before deploying the matching app. This additive migration stores cooked-dish waste in `prepared_food_waste_logs`, separate from `waste_logs`; its append-only RPC validates portions and reasons, captures the staff and time, audits the entry, and never invokes an ingredient-stock trigger. An optional ready production batch is stored as context only. Run [`035_prepared_food_waste_acceptance.sql`](./supabase/035_prepared_food_waste_acceptance.sql) to verify RLS, append-only enforcement, audit fields, idempotent retry, role denial, and unchanged ingredient stock. The acceptance requires Manager and Inventory Clerk profiles plus an ingredient with positive stock, and rolls back its fixture. The rollback script refuses to drop the feature if any prepared-food waste records exist.

The Waste Logs page asks staff to choose Ingredient Waste or Prepared Food / Leftovers before entering details. Ingredient waste retains its existing stock preview, confirmation, and deduction. Prepared-food entries record dish, portions, reason, date, and optional batch without returning or deducting recipe ingredients. Reports show ingredient units and prepared portions separately; combined totals represent waste-entry counts, not a sum of unlike units or a new waste-cost calculation.

## Phase 12 buffet recipe costs and production snapshots

After migration 021, back up the project and apply [`022_buffet_recipe_cost_snapshots.sql`](./supabase/022_buffet_recipe_cost_snapshots.sql) as the database owner before deploying the matching browser files. It retains the legacy recipe price column but removes price/margin from recipe editing and reporting, adds recipe active state, and records the total production cost on each new production log. Existing recipe and production rows are not rewritten. Inactive recipes cannot be selected for new batches, while their existing production history remains available.

Run [`022_buffet_recipe_cost_snapshots_acceptance.sql`](./supabase/022_buffet_recipe_cost_snapshots_acceptance.sql) to verify the added columns, RPCs, and triggers. In staging, create a recipe with known ingredient costs and compare the displayed total batch cost and per-portion cost with a hand calculation; complete a scaled batch, change the recipe afterward, and confirm the stored snapshot and reports remain unchanged. Mark a recipe inactive and confirm it is absent from the production board and a direct attempt to start it is rejected. Migration 022 intentionally leaves existing snapshots null; historical report costs are estimates from current ingredient costs. Its rollback restores prior function behavior but keeps the active-state and snapshot columns to preserve saved data.

## Phase 13 product lifecycle

After 022, apply [`023_product_lifecycle.sql`](./supabase/023_product_lifecycle.sql), then [`024_waste_inactive_product_guard_order.sql`](./supabase/024_waste_inactive_product_guard_order.sql), as the database owner. Then run [`023_product_lifecycle_acceptance.sql`](./supabase/023_product_lifecycle_acceptance.sql). The acceptance script requires one existing profile for each application role, tests Administrator deletion/deactivation/reactivation, product-use and active-recipe guards, inactive receiving/waste/count/recipe rejection, role denials, audit records, and that rejected waste does not alter stock; it ends with `ROLLBACK`. Migration 024 ensures inactive-product validation runs before waste stock deduction. The lifecycle migration uses the existing Phase 8 `ingredients.is_active` column. Inactive products remain in historical records and reports but are excluded from new operational pickers and stock alerts. To roll back, first apply [`024_waste_inactive_product_guard_order_rollback.sql`](./supabase/024_waste_inactive_product_guard_order_rollback.sql), then [`023_product_lifecycle_rollback.sql`](./supabase/023_product_lifecycle_rollback.sql); both retain product rows and audit records.

## Phase 14 shared notifications

After migrations 023 and 024, apply [`025_shared_notification_read_state.sql`](./supabase/025_shared_notification_read_state.sql) as the database owner before deploying the matching browser files. The shared bell combines role-visible stock/expiry, reservation, unresolved-booking, and POS alerts; POS notifications remain visible only to Managers and Administrators. Per-role read state is stored in PostgreSQL, and Realtime refreshes source alerts and read state across sessions.

Run [`025_shared_notification_read_state_acceptance.sql`](./supabase/025_shared_notification_read_state_acceptance.sql) as the database owner. It requires existing Manager, Receptionist, Inventory Clerk, and Chef / Kitchen Staff profiles, checks role-isolated read state and denies Receptionist access to POS read state, then ends with `ROLLBACK`. To roll back, run [`025_shared_notification_read_state_rollback.sql`](./supabase/025_shared_notification_read_state_rollback.sql); it removes the RPC/policy entry points but deliberately retains read-state rows.

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

The Table Management page is available to Administrators, Managers, and Receptionists. It shows date-based table availability, booking details, capacity, and unassigned-booking assignment; only Administrators and Managers can add, edit, or delete table records. Receptionists can also assign an eligible table while confirming a pending reservation from the Reservations page; both changes are saved together. If no suitable table is available, the reservation can still be confirmed as unassigned. Table capacity, assignment conflicts, and reservation-history deletion protection are also enforced by database triggers and row-level security. No-show bookings do not block reassignment. Phase 16 adds the two-hour overlap rule for assigned active bookings.

After applying the migration, test as Receptionist and Manager: confirm the Receptionist can view tables and assign an eligible booking but cannot add, edit, or delete tables; confirm a Manager can manage table capacity; verify an undersized table, duplicate active table/time assignment, and capacity reduction below an active party are rejected. Confirm a table referenced by any reservation history cannot be deleted, including by direct database writes.

## Phase 15 restaurant seating layout

After Phase 14, back up the project and run [`phase15_restaurant_table_layout.sql`](./supabase/phase15_restaurant_table_layout.sql) as the database owner before deploying the updated table-management UI. Fresh installations using the current `supabase-schema.sql` already include the `table_type` and `area` columns.

The requested layout is 15 tables and 91 seats: 3 Family tables (two 12-seat and one 8-seat); and 12 Casual tables (one 8-seat at the back, three 6-seat tables with two front and one back, three 5-seat tables at the back, four 4-seat tables with three front and one back, and one 2-seat table at the front). Managers and Administrators can use **Set up restaurant layout** to reconcile existing records to those exact capacities and categories, adding only missing slots. Existing table IDs and reservation history are preserved; legacy IDs are assigned in natural ID order. Extra legacy tables are kept as Unclassified rather than deleted. A capacity reduction is blocked if it would make an upcoming Pending, Confirmed, or Seated reservation larger than the table; resolve or reassign that reservation before retrying setup. Historical and cancelled reservations do not block the layout. Reservation records keep their existing table IDs.

Use the Table type and Area filters to browse Family/Casual groups and Front/Back areas. Test setup on a database backup or staging project first, then confirm the table total and each group count before assigning new reservations.

## Phase 16 two-hour table stays

Back up the existing Supabase project, then run [`phase16_two_hour_table_stays.sql`](./supabase/phase16_two_hour_table_stays.sql) in the SQL Editor as the database owner. Apply it after the already-applied Phases 12–15 and before deploying the updated app. Do not paste the full baseline schema into an existing database or rerun Phases 12–15. Fresh installations using the updated `supabase-schema.sql` already include these rules.

Reservations and walk-ins get a two-hour window. The full window must fit between 10:00 AM and 9:00 PM, making 7:00 PM the latest start. The database rejects out-of-hours active bookings and prevents overlapping Pending, Confirmed, or Seated bookings on the same table and date, including concurrent assignments. Back-to-back bookings at the exact two-hour boundary are allowed. Walk-ins also count as Seated reservation records and use the same table availability rules.

Live table status is derived from reservations and walk-ins; cached `restaurant_tables.status` and `guest` values are no longer used to decide whether a table is Available, Reserved, or Occupied. Realtime database changes refresh the app, and the Reservations/Table Management views also recalculate every minute. A Seated party stays Occupied after two hours until staff confirms departure and marks it Completed. The app displays a “two-hour limit reached” reminder for staff; it does not automatically complete a reservation, release a table, or message a guest.

The migration does not rewrite existing bookings or resolve any overlaps that were already present. Before relying on table assignments, review active same-table bookings for overlapping two-hour windows and resolve any conflicts through normal reservation status or assignment actions. A Seated booking remains Occupied after its two-hour window and across dates until its linked bill is settled and closed, or an Administrator/Manager resolves a past Walk-in after confirming the party has left. Then test a reservation at 10:00 AM and 7:00 PM, confirm that 7:30 PM and later starts are rejected, verify that a 1:00 PM booking conflicts with 2:30 PM but allows 3:00 PM, and confirm that a still-Seated party remains Occupied after its two-hour limit until its departure is recorded.

## Phase 17 same-day reservation cutoff

After Phase 16 and migrations 013–016, back up the project and run [`017_prevent_past_reservation_times.sql`](./supabase/017_prevent_past_reservation_times.sql) as the database owner before deploying the matching app. Then run [`017_prevent_past_reservation_times_acceptance.sql`](./supabase/017_prevent_past_reservation_times_acceptance.sql); it verifies past-time inserts and rescheduling and ends with `ROLLBACK`. Run the acceptance script after 10:00 AM in the restaurant's Asia/Manila time zone. Fresh installations using the updated `supabase-schema.sql` already include this rule.

For today's date, both management and public reservation forms remove start times that have already passed and check again on submit. The database independently rejects a new reservation or changed schedule that starts earlier than the current Asia/Manila time. This does not block guest-detail-only edits to an unchanged booking, or Walk-ins whose time is recorded as guests arrive. To roll back, run [`017_prevent_past_reservation_times_rollback.sql`](./supabase/017_prevent_past_reservation_times_rollback.sql); it removes only the trigger and function and does not change existing reservations.

After migration 017, apply [`018_restore_stale_walkin_history_guard.sql`](./supabase/018_restore_stale_walkin_history_guard.sql) when migration 016 is installed. Migration 018 restores the guarded stale-Walk-in completion exception while retaining the historical-edit restrictions and settled-bill exception; it does not change data. Then rerun the 016 and 013 acceptance scripts. To roll back 018, run [`018_restore_stale_walkin_history_guard_rollback.sql`](./supabase/018_restore_stale_walkin_history_guard_rollback.sql) before rolling back 017 or 016.

## POS Phase B/C atomic Walk-in billing and safeguards

After applying the current base schema and POS migrations 007–012, including the Phase 16 two-hour table rules, back up the project and run [`013_walkin_atomic_billing_safeguards.sql`](./supabase/013_walkin_atomic_billing_safeguards.sql), [`014_fix_walkin_insert_package_guard.sql`](./supabase/014_fix_walkin_insert_package_guard.sql), [`015_past_reservation_bill_close.sql`](./supabase/015_past_reservation_bill_close.sql), and [`016_stale_walkin_completion.sql`](./supabase/016_stale_walkin_completion.sql) in order as the database owner before deploying the matching browser files. Migration 014 corrects the reservation trigger so a Walk-in with no package does not require an override. Migration 015 allows completion of a past reservation only as part of closing its settled linked bill. Migration 016 adds a separate, audited Manager/Administrator action for a past Seated Walk-in after the party has left; it refuses linked bills that are not Closed and fully settled, and Held deposits, and makes no payment or inventory changes. Migration 013 aborts without changing existing rows if it finds an existing Walk-in package booking without a matching override audit; reconcile that booking with the client before rerunning. Run the [`013_walkin_atomic_billing_safeguards_acceptance.sql`](./supabase/013_walkin_atomic_billing_safeguards_acceptance.sql), [`015_past_reservation_bill_close_acceptance.sql`](./supabase/015_past_reservation_bill_close_acceptance.sql), and [`016_stale_walkin_completion_acceptance.sql`](./supabase/016_stale_walkin_completion_acceptance.sql) scripts afterward; each ends with `ROLLBACK`.

The 015 acceptance must also run as the database owner. It creates its Seated fixtures for today, then clears the simulated auth subject while moving them to yesterday. The nullable audit actor keeps the audit trigger valid, and the production date guard remains enabled.

To resolve an old Walk-in after applying 016 and deploying the matching browser code, open its booking from **Table management**, confirm the party has left, enter a 10–500 character reason under **Clear stale table occupancy**, and choose **Mark guests departed**. The server blocks this if a linked bill is not Closed and fully settled, or if a deposit is still Held. This changes reservation status only; it does not record payment or change table configuration.

The **Seat and open bill** action requires the cashier’s own open shift and creates the Seated reservation and Open bill atomically. The same request key returns the existing result after a retry; payment is still taken after the meal. **Seat only** remains available. Receptionist package overrides are blocked at the database layer; Managers/Administrators must provide a 10–500 character reason, which is audited. The bill form also shows category-count differences for confirmation, warns before closing without a table, reads the Leftover charge from the active catalog, and offers cash tender shortcuts while leaving totals/change calculation to the server.

The rollback [`016_stale_walkin_completion_rollback.sql`](./supabase/016_stale_walkin_completion_rollback.sql) removes the stale-Walk-in action and restores the completion guards from migrations 009/015. Run it before [`015_past_reservation_bill_close_rollback.sql`](./supabase/015_past_reservation_bill_close_rollback.sql), which restores the earlier history guard and can make past bill closure fail again. The rollback [`013_walkin_atomic_billing_safeguards_rollback.sql`](./supabase/013_walkin_atomic_billing_safeguards_rollback.sql) removes the RPC entry point only. It intentionally retains package enforcement and audit/idempotency data, so it is not a full reversal; this avoids deleting records or reopening the package restriction. Migration 014's rollback restores the original broken package guard and should not be used in normal operation. Confirm the application no longer calls the RPC before running a rollback.

## Provision real users

Do not add public signup or service-role credentials to the browser. Provision the first Administrator manually because no Administrator exists yet to authorize an invitation:

1. Create the first account in **Supabase Dashboard → Authentication → Users** and confirm its email.
2. Copy the Auth user's UUID.
3. In the SQL Editor, create the initial Administrator profile:

```sql
insert into public.profiles (id, email, full_name, role)
values ('<AUTH_USER_UUID>'::uuid, '<EMAIL>', '<FULL_NAME>', 'Administrator');
```

The profile role is authoritative; users cannot change their own role from the app. Once the invitation Edge Function below is deployed, use it for subsequent staff accounts.

## Auth redirect configuration

Serve the files over HTTP(S), not `file://`. In **Authentication → URL Configuration**, set the production Site URL and add the app URL (ending in `/index.html`) to the allowed Redirect URLs so password-reset and invitation links return to the app.

## Phase 3 administrator invitation Edge Function

This phase adds the `invite-user` Edge Function; it does not add the Administrator's invitation form. The original invitation flow supports two authenticated actions:

- `invite`: only an active Administrator can create an invitation. The function validates the request, writes a `Pending` row to `public.user_invites`, creates the Supabase Auth invite (which sends the email using the project's Auth SMTP configuration), and inserts the matching profile.
- `accept`: after the invitee sets a password through the existing password-update screen, the app calls the function with the invitee's session. The function verifies the confirmed email and matching profile, then changes the invitation to `Accepted`; the database trigger stamps `accepted_at`.

An invitation remains `Pending` after the email is sent because it has not yet been accepted. Failed send/profile setup attempts cancel the pending row when cleanup succeeds. The database invitation expires after seven days. Supabase Auth's email-link expiry is configured separately; ensure it is not shorter than the database expiry, or a still-Pending invitation may have an unusable email link. The function uses a compensating delete if Auth created the invited user but profile insertion fails; if cleanup itself fails, use the returned `request_id` to locate the safe server log entry and reconcile the account.

Deploy from the repository root after Phase 2 migration 029 is applied:

```powershell
supabase functions deploy invite-user
supabase secrets set INVITE_REDIRECT_URL="https://your-site.example/index.html"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are Supabase Edge Function runtime secrets. The only function-specific secret is `INVITE_REDIRECT_URL`; set it to the real app URL (or a localhost URL for local testing) and add that exact URL to **Authentication → URL Configuration → Redirect URLs**. Do not put the service-role key in the repository, Vercel variables exposed to browser code, or any HTML/JavaScript. Configure an Auth SMTP provider in the Supabase Dashboard for reliable email delivery; the function calls Supabase Auth's `inviteUserByEmail` API.

The invitation request shape is:

```json
{
  "action": "invite",
  "email": "staff@example.com",
  "full_name": "Staff Member",
  "role": "Receptionist"
}
```

Call `POST {SUPABASE_URL}/functions/v1/invite-user` with the Administrator's `Authorization: Bearer <access-token>`, `apikey: <publishable-or-anon-key>`, and `Content-Type: application/json`. The access token is the signed-in Administrator's session token, not the service-role key. An accepted invitee's password-update screen invokes the same endpoint with `{"action":"accept"}`.

Database integration:

1. Phase 2's `user_invites` unique partial index prevents concurrent duplicate pending invitations. Its trigger independently validates the email, role, and Administrator inviter.
2. The function verifies the JWT with Supabase Auth and reads the caller's role from `profiles` before creating a service-role client.
3. The service-role client is used only server-side for Auth Admin operations and writes to `user_invites`/`profiles`; RLS is bypassed for these operations, so caller authorization is mandatory.
4. Profile role and invitation status are authoritative in PostgreSQL, not user metadata.

Acceptance tests:

```powershell
deno test supabase/functions/invite-user/validation_test.ts
```

In a development project, invoke the deployed function with an Administrator token and a unique test email. Confirm the new Auth user, profile, Pending invite, seven-day expiry, and delivered email; complete the email link and password update; then verify the row becomes Accepted with `accepted_at`. Repeat with a Manager token, no token, invalid role/email, an existing profile, and the same email twice. Expected results are respectively `403`, `401`, `400`, `409`, and `409`, with no extra Auth users or pending rows. Do not use a real employee address for failure-path tests.

The app invokes `accept` after password setup, and the function requires a confirmed email plus a matching profile and pending invitation. Supabase Auth does not expose a server-verifiable flag proving that a password was set, so a caller with the confirmed invitee session could invoke this action directly; treat `Accepted` as the invitee's acceptance callback, not independent proof of password creation. The status lifecycle has no separate `Sent` value; do not mark a just-sent invitation Accepted. No automatic expiry job or Administrator invite UI is included in this phase.

## Staff account lifecycle

Migration 031 separates invited accounts from active staff and adds audited deactivation/reactivation:

1. Apply `supabase/031_user_account_lifecycle.sql` after migrations 029 and 030.
2. Run `supabase/031_user_account_lifecycle_acceptance.sql`; it runs in a transaction and ends with `ROLLBACK`.
3. Deploy the updated `invite-user` function with `supabase functions deploy invite-user`.

New invitees receive a `Pending` profile that is excluded from the active staff list. The acceptance action atomically changes the invitation to `Accepted` and the profile to `Active`. User Management exposes cancellation for pending/expired invitations; cancellation blocks database access, removes an unconfirmed Auth user and its pending profile, and retains the cancelled invitation record. If the invited email has already been confirmed, cancellation blocks the Auth user but retains the profile for review.

Administrators can deactivate or reactivate existing staff from User Management. Deactivation changes the profile status, blocks role-based RLS access immediately, and bans Auth sign-in while preserving the profile and operational history. An open CostTrack session subscribes to its own profile status and signs out when deactivation arrives. Reactivation restores Auth access and the profile's `Active` state. The last active Administrator and self-deactivation are protected. Account status changes are recorded in `profile_account_status_audit`; only active Administrators can read that audit.

The updated `invite-user` Edge Function supports `invite`, `accept`, `cancel`, `deactivate`, and `reactivate` actions. Invitation creation, acceptance, cancellation, and account status transitions must go through the deployed Edge Function. The migration removes direct authenticated insert/update access to `user_invites`; do not expose the service-role key to the browser. The migration also permits Auth cleanup to remove only `Pending` or `Cancelled` profiles; active and deactivated staff profiles remain non-deletable.

## User Management safety hardening (migration 032)

Apply the server/database safeguards after 031:

1. As the database owner, run `supabase/032_user_management_safety.sql`.
2. Run `supabase/032_user_management_safety_acceptance.sql`. It ends with `ROLLBACK`; it requires one active Administrator and active Manager, Receptionist, Inventory Clerk, and Chef / Kitchen Staff profiles.
3. Deploy the updated Edge Function: `supabase functions deploy invite-user`.
4. Confirm the production app URL is in **Authentication → URL Configuration → Redirect URLs**.

Migration 032 removes authenticated profile INSERT permission (including for Administrators), so invitations and profile creation are possible only through the Administrator-verified Edge Function. Authenticated profile and invitation table writes remain unavailable; role changes use the Administrator-only `costtrack_update_profile_role` RPC. Role changes and deactivation require a non-blank reason in PostgreSQL. The last active Administrator cannot be demoted, deactivated, or deleted, and an Administrator cannot demote or deactivate their own account.

The migration adds append-only invitation audit history for Sent, Resent, and Cancelled events. Resend is available through the Edge Function for Pending or Expired invitations; it refreshes the database expiry to seven days and asks Supabase Auth to reissue the invitation email. A repeated new-invite request returns a structured `pending_invitation_exists` error so the UI can offer Resend. Supabase Auth's `429` email rate-limit response is returned as `rate_limited`; `422` for a registered address is returned as `already_registered`. Error JSON includes `error`, `message`, `code`, and `request_id`.

The User Management UI provides an Administrator-only two-card landing view and a Staff / Invitations workspace. Staff can be searched and filtered by role and status. Role changes and deactivation/reactivation require a reason and a confirmation dialog; the current account and last active Administrator are marked Protected in the UI as well as enforced by PostgreSQL. The invitation history shows inviter and lifecycle dates, with Resend available for Pending or Expired invitations and Cancel available for Pending invitations. The invite form warns about existing accounts and invitations and offers Resend for the latter.

All User Management actions show a success or server-error toast and end their loading state. Requests time out after 15 seconds. After a successful write, the app refreshes the affected lists without a full reload; if that refresh fails, it reports that the save succeeded and offers a retry. These UI protections complement, but do not replace, the migration 032 RLS, RPC, trigger, and Edge Function checks.

No new secret is required for 032. Supabase Edge Functions provide `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as server-managed runtime secrets. Keep `INVITE_REDIRECT_URL` configured as described above; never copy the service-role key into `supabase-config.js`, browser variables, or HTML. Configure a production SMTP provider in **Authentication → SMTP Settings** (host, port, username, password, sender name/address) and ensure its sending limits accommodate the invitation workflow. Supabase Auth remains responsible for sending mail and applying its email rate limits.

The 032 rollback is deliberately data-preserving: run `supabase/032_user_management_safety_rollback.sql` only after redeploying the previous Edge Function. It removes the new resend/sent-event RPCs but retains stricter profile-write and reason checks, append-only protections, and invitation audit data; it does not delete rows or reopen direct profile insertion.

## Receptionist table cleaning (migration 033)

For an existing database, run [`supabase/033_receptionist_table_cleaning.sql`](./supabase/033_receptionist_table_cleaning.sql) as the database owner before deploying the updated app. Run [`supabase/033_receptionist_table_cleaning_acceptance.sql`](./supabase/033_receptionist_table_cleaning_acceptance.sql) afterward; it requires active Receptionist and Chef / Kitchen Staff profiles and ends with `ROLLBACK`. Fresh installations using the updated `supabase-schema.sql` already include the RPC.

Receptionists can mark a table in **Needs cleaning** as **Available** from Table Management. The RPC only permits that single status transition and does not grant direct table-edit access; existing Manager and Administrator table-management permissions remain unchanged. The migration can be reversed with [`supabase/033_receptionist_table_cleaning_rollback.sql`](./supabase/033_receptionist_table_cleaning_rollback.sql).

## Shared cashier shift (migration 036)

For an existing database, apply the updated [`036_cashier_one_shift_per_business_day.sql`](./supabase/036_cashier_one_shift_per_business_day.sql). It changes shifts to one shared restaurant shift per Manila business day for Administrators, Managers, and Receptionists. All three roles can see the shared shift and use it for cashier actions. Historical shift rows are preserved; the previous per-user date index is removed because it can fail when older duplicate records exist. If a shift has already been opened or closed today, no role can open another until the next Manila business day.

If an earlier attempt failed while creating the old unique index, rerun this updated migration; the failed transaction should not have changed data. Confirm the migration completes before applying 037.

## Activity Log (migration 037)

After migration 036 succeeds, apply [`037_activity_log_own_access.sql`](./supabase/037_activity_log_own_access.sql). The Activity Log module is available to every role and shows only record changes made by the signed-in user. It uses the existing append-only `audit_logs` records and intentionally excludes old/new record snapshots from the module. RLS enforces own-actor access for non-Administrators; the existing Administrator audit access remains unchanged. Roll back the module's additional access policy with [`037_activity_log_own_access_rollback.sql`](./supabase/037_activity_log_own_access_rollback.sql).

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
