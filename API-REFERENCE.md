# CostTrack API and endpoint reference

## Architecture

CostTrack is a browser application that uses Supabase as its backend-as-a-service:

```text
Browser UI
  -> Supabase REST/PostgREST, RPC, Auth, and Realtime APIs
  -> Supabase PostgreSQL database
```

There is no separate Node.js, PHP, Python, or Express API server in this repository. The Supabase client is created in `supabase-config.js` with the project URL and publishable key.

## Base URL and endpoint meaning

The project base URL is:

```text
https://niiodqunoflblfcgdods.supabase.co
```

An endpoint is a URL that receives a request for one operation, such as reading reservations or calling a database function. Supabase generates these endpoints from the database schema and functions.

The browser sends requests through `@supabase/supabase-js`; application code normally uses `.from()`, `.rpc()`, `.auth`, and `.channel()` instead of constructing URLs manually.

## REST table API

Supabase exposes database tables through PostgREST:

```text
https://niiodqunoflblfcgdods.supabase.co/rest/v1/<table>
```

The client uses standard REST operations:

| Client operation | HTTP operation | Purpose |
| --- | --- | --- |
| `.select()` | GET | Read rows |
| `.insert()` | POST | Create rows |
| `.update()` | PATCH | Update rows |
| `.delete()` | DELETE | Delete rows |

Tables and views used by the application include:

- `profiles` — staff profiles and roles
- `product_categories` — active product categories
- `units` — active units and abbreviations
- `suppliers` — active suppliers
- `ingredients` — product records
- `recipes` — recipe records
- `inventory_transactions` — inventory movements
- `production_logs` — production records
- `revenue_records` — revenue records
- `waste_logs` — waste records
- `physical_counts` — stock-count records
- `reservations` — reservation records
- `restaurant_tables` — restaurant table records
- `buffet_rates` — buffet-rate records

Examples:

```text
GET    /rest/v1/reservations
PATCH  /rest/v1/restaurant_tables
GET    /rest/v1/waste_logs
```

Endpoint inventory and purpose:

| Endpoint path | Main method(s) | Purpose |
| --- | --- | --- |
| `/rest/v1/profiles` | GET | Load staff profiles; profile writes are RPC/Edge-Function only |
| `/rest/v1/user_invites` | GET | Read invitation history as an active Administrator |
| `/rest/v1/product_categories` | GET | Load active product categories for product forms |
| `/rest/v1/units` | GET | Load active measurement units |
| `/rest/v1/suppliers` | GET | Load active suppliers |
| `/rest/v1/ingredients` | GET | Read active and inactive product records; application writes use guarded RPCs |
| `/rest/v1/recipes` | GET, POST, PATCH, DELETE | Read and manage recipe records when direct table access is used |
| `/rest/v1/inventory_transactions` | GET, POST, PATCH, DELETE | Read and manage inventory movements |
| `/rest/v1/production_logs` | GET, POST, PATCH, DELETE | Read and manage production records |
| `/rest/v1/revenue_records` | GET | Read historical revenue archive (read-only for application roles) |
| `/rest/v1/waste_logs` | GET, validated POST | Read waste records; inserts are append-only and database-validated |
| `/rest/v1/physical_counts` | GET, POST, PATCH, DELETE | Read and manage physical stock counts |
| `/rest/v1/reservations` | GET, POST, PATCH, DELETE | Read and manage reservations |
| `/rest/v1/restaurant_tables` | GET, POST, PATCH, DELETE | Read and manage restaurant tables |
| `/rest/v1/buffet_rates` | GET, POST, PATCH, DELETE | Read and manage buffet rates |

Some sensitive product, recipe, waste, receiving, and production operations use RPC instead of direct table writes so the database can validate the complete transaction. The actual filters, selected columns, and version checks are defined in `supabase-config.js`.

Product lifecycle writes are performed through `costtrack_product_lifecycle(action_value, product_id_value, reason_value)`, not direct table DML. It is Administrator-only and supports `inspect`, `delete`, `deactivate`, and `reactivate`. Hard deletion is refused for any recorded reference; deactivation requires a reason and is refused while an active recipe uses the product. Every lifecycle change is audited with product and actor identity snapshots. Inactive products remain readable for history and reports but cannot be used in new receiving, recipe, waste, or count entries. Migration 023 adds the audit/RPC/guards without changing the existing Phase 8 `ingredients.is_active` column; migration 024 orders the waste inactive-product guard before stock deduction.

Form save requests use a 15-second client timeout. Once a write succeeds, the UI applies the returned/saved record locally and refreshes the collection separately. A failed refresh is reported as “Saved, but the list could not refresh” with a retry action; it does not change the database write result. A timed-out request is not proof that the server rolled back, so check the list before repeating a non-idempotent operation.

Kitchen waste uses `costtrack_waste_server_time()` for the read-only Manila-local display and `costtrack_log_waste(payload)` for writes. The database ignores client-supplied dates/timestamps and sets the record time and `waste_date` from its current Asia/Manila time. Both the RPC and insert trigger require a supported reason; `Other` requires a non-blank note. The insert trigger remains append-only and deducts stock exactly once. Same-ID retries of the RPC return the original row, while reports continue grouping by `waste_date` and reason and calculating cost from the current ingredient cost. Migration 021 aligns direct-insert access with the RPC/UI roles (Administrator, Manager, Chef / Kitchen Staff); Inventory Clerk retains waste-report read access.

### Buffet recipe costing (migration 022)

Recipes are production formulas, not individually sold items. `costtrack_load_recipes()` returns active state and production fields without exposing legacy `menu_price`; `save_recipe(payload, expected_updated_at)` preserves the stored legacy price without accepting or using a new one. `batch_yield` is the portions per base recipe and remains the stock-scaling basis; `prep_target` remains the separate daily target. Only Administrators and Managers may manage recipes or read recipe costs. Inactive recipes remain readable but the database rejects starting new production batches with them.

The production-log insert trigger records `batch_cost_snapshot` and `cost_snapshot_at` atomically with the stock movement. The snapshot is the total cost of the completed production quantity, including the recipe wastage allowance. It is not updated when recipes or ingredient costs later change. Existing production logs are not backfilled and continue to use current-cost estimates in reports. `pos_revenue_report(food_cost)` and `report_analytics(production)` prefer snapshots where present.

Apply `supabase/022_buffet_recipe_cost_snapshots.sql` after 021, then run `supabase/022_buffet_recipe_cost_snapshots_acceptance.sql`. The rollback restores the pre-022 RPC behavior but deliberately retains the additive active-state and snapshot columns so rollback does not discard data.

## RPC endpoints

RPC means Remote Procedure Call. In this application, an RPC call invokes a PostgreSQL function through Supabase PostgREST:

```text
POST https://niiodqunoflblfcgdods.supabase.co/rest/v1/rpc/<function_name>
```

The frontend sends JSON arguments, and the PostgreSQL function validates and processes the operation.

RPC functions used by the application:

| Function | Application purpose |
| --- | --- |
| `costtrack_load_products` | Load products with database-controlled product data |
| `costtrack_load_recipes` | Load recipes |
| `costtrack_waste_server_time` | Return the database timestamp used for the waste form display |
| `costtrack_log_waste` | Record waste and apply its stock movement |
| `costtrack_save_product` | Create or update a product with validation |
| `costtrack_product_lifecycle` | Administrator-only product usage inspection, hard delete, deactivation, and reactivation |
| `save_recipe` | Create or update a recipe |
| `public_create_reservation` | Create a public reservation |
| `public_get_reservation_status` | Retrieve public reservation status |
| `pos_reservation_deposit_history` | Read a reservation’s deposit and action history |
| `pos_list_unresolved_stale_bookings` | Read past unresolved bookings for Front of House roles |
| `pos_resolve_stale_booking` | Atomically resolve an eligible past reservation and any held deposit |
| `report_analytics` | Return report and analytics data |
| `pos_revenue_report` | Return Manager/Administrator closed-bill revenue, customer, shift, and food-cost reports |
| `costtrack_receive_delivery` | Record receiving, invoice lines, batches, and stock movements |
| `get_expected_covers` | Calculate expected covers for a service |
| `costtrack_load_production_batches` | Load production batches |
| `costtrack_start_production_batches` | Start production batches |
| `costtrack_load_production_history` | Load production history |
| `costtrack_complete_production_batch` | Complete a production batch |
| `pos_seat_and_open_walkin` | Atomically create a Seated Walk-in and its Open POS bill |

Full RPC endpoint inventory:

| Endpoint path | Purpose |
| --- | --- |
| `/rest/v1/rpc/costtrack_load_products` | Load products using database-controlled fields |
| `/rest/v1/rpc/costtrack_load_recipes` | Load recipes using database-controlled fields |
| `/rest/v1/rpc/costtrack_waste_server_time` | Return the current database timestamp for the waste form |
| `/rest/v1/rpc/costtrack_log_waste` | Record waste and apply its stock deduction |
| `/rest/v1/rpc/costtrack_save_product` | Validate and save a product |
| `/rest/v1/rpc/costtrack_product_lifecycle` | Inspect or change product lifecycle with database authorization and audit |
| `/rest/v1/rpc/save_recipe` | Validate and save a recipe and its ingredients |
| `/rest/v1/rpc/public_create_reservation` | Create a reservation from the public booking page |
| `/rest/v1/rpc/public_get_reservation_status` | Return public status for a reservation |
| `/rest/v1/rpc/pos_reservation_deposit_history` | Read reservation deposits and audit actions |
| `/rest/v1/rpc/pos_list_unresolved_stale_bookings` | Return unresolved past bookings with bill and held-deposit summaries |
| `/rest/v1/rpc/pos_resolve_stale_booking` | Resolve a stale booking and its held deposit atomically |
| `/rest/v1/rpc/report_analytics` | Return report and analytics results |
| `/rest/v1/rpc/pos_revenue_report` | Return guarded closed-bill revenue and operational report data |
| `/rest/v1/rpc/costtrack_receive_delivery` | Save receiving data, batches, and inventory movements |
| `/rest/v1/rpc/get_expected_covers` | Calculate expected covers for a service |
| `/rest/v1/rpc/costtrack_load_production_batches` | Load production batches for a service date |
| `/rest/v1/rpc/costtrack_start_production_batches` | Start selected production batches |
| `/rest/v1/rpc/costtrack_load_production_history` | Load filtered production history |
| `/rest/v1/rpc/costtrack_complete_production_batch` | Mark a production batch ready and apply its completion logic |
| `/rest/v1/rpc/pos_seat_and_open_walkin` | Validate and atomically seat a Walk-in and open its server-priced bill |

## POS access rules

Migration 010 is the current POS security layer. RLS policies are authoritative; listing a REST operation above does not mean every role can perform it.

| POS data | Administrator / Manager | Receptionist | Inventory Clerk / Chef |
| --- | --- | --- | --- |
| Charge catalog, package tiers/inclusions, discounts | Read and manage | Read only | No POS access |
| POS settings | Administrator manages; Manager reads | Read only | No POS access |
| Bills, bill lines, bill payments | Read all | Own bills only (`created_by = auth.uid()`); save, close, and void requests use RPC | No POS access |
| Shifts and cash movements | Read all; approved operations use RPC | Read own shift and its movements; cashier operations use RPC | No POS access |
| Reservation deposits and deposit action history | Read all; Manager-only refund/forfeit through RPC | Read and record deposits through RPC; cannot refund or forfeit | No POS access |
| Bill approvals | Read all and decide through RPC | Read own requests; can request but cannot approve | No POS access |
| Revenue records | Read-only historical archive | No access | No access |

Receptionist bill visibility is enforced twice: RLS filters database reads by `created_by`, and the Cashier UI lists only bills created by the signed-in Receptionist. Billing writes, closing, void requests, and deposit operations remain RPC-controlled.

The former `create_revenue_draft(text)` and `confirm_revenue(text, jsonb)` functions are not active application APIs. Migration 020 disables legacy revenue writes and preserves existing `revenue_records` as an archive. Phase 4 revenue comes only from bills currently in `Closed` status; voided, open, draft, deposit, estimate, and legacy rows do not contribute.

### Phase 4 — closed-bill revenue reporting (migration 020)

`pos_revenue_report(p_report_key, p_start_date, p_end_date, p_group_by, p_include_waste, p_page, p_page_size)` is a Manager/Administrator-only `SECURITY DEFINER` read RPC. The `dashboard` key returns today's Manila-business-date net revenue, closed bill count, actual customer counts, average check, discounts, and separate void count/amount. Other keys provide `daily_revenue`, `revenue_trend`, `customer_count`, `shift_revenue`, `closed_bill_summary`, and `food_cost`. Revenue views filter to current `Closed` bills with `closed_at`, and derive the business date from `closed_at` in `Asia/Manila`.

The amount is calculated in the database as `max(0, subtotal + service_charge - discount_total)`. Deposits are excluded from sales and appear only in separate operational columns. Voids are excluded; reversed amount is shown separately only when a voided bill had previously closed. The UI requests these reports with a 15-second timeout and does not fall back to `revenue_records`.

Run `supabase/020_closed_bill_revenue_reporting.sql` after migration 019, followed by `supabase/020_closed_bill_revenue_reporting_acceptance.sql` as the database owner. The acceptance script ends with `ROLLBACK`. Roll back migration 020 with `supabase/020_closed_bill_revenue_reporting_rollback.sql` before rolling back 019. Deployment and acceptance against a Supabase project must be verified separately; repository presence does not prove that the migration is deployed.

### Atomic Walk-in billing and Phase C safeguards (migrations 013–016)

`pos_seat_and_open_walkin` is executable by authenticated Administrator, Manager, and Receptionist users. It requires the caller’s own open cashier shift and accepts `p_customer_name`, `p_phone`, `p_email`, `p_reservation_date`, `p_reservation_time`, `p_table_id`, `p_adult_count`, `p_senior_count`, `p_kids_count`, `p_notes`, and `p_idempotency_key`. It validates counts and seating/table constraints, inserts the Seated reservation, calls the existing Phase 3 bill RPC within the same transaction, records the cashier-scoped idempotency key, and returns JSON containing `reservation`, `bill`, `lines`, and `already_created`. A retry with the same cashier/key returns the original result. A failure at any point rolls back the reservation and bill.

The browser exposes this operation as **Seat and open bill**; **Seat only** remains available. The operation has the existing 15-second timeout behavior, and retries from the same form reuse its key. Payment is still taken after the meal.

#### Create Bill wizard Phase B1

The wizard UI calls only existing POS RPCs: `pos_save_bill_phase3` for party, count, package, and bill preview/save changes; `pos_seat_and_open_walkin` for the New walk-in shortcut; and existing close/approval RPCs remain unchanged for later screens. Party selection uses local seated reservation and POS bill collections; no new read query or migration is required. Server-calculated totals, shift ownership, table/price/rate lookup, and duplicate-open-bill rules are not changed by this flow.

#### Create Bill wizard Phase B2

Screen 3 saves catalog extras, the selected bill discount and reason, optional extra-pax charging, and notes using the existing `pos_save_bill_phase3` adapter and unchanged RPC arguments. Screen 4 reads the saved bill/lines returned by that RPC and requests deposit and balance values from `pos_bill_close_preview`. The UI does not calculate authoritative bill totals. Final cash payment and closure use the existing `pos_close_bill_phase3` adapter with the payment idempotency key; approval, eligible deposit application, final change, and close status remain database-controlled. No new endpoint, RPC, query, migration, or database rule is introduced. After success, the browser updates returned records locally, refreshes related collections separately, and attempts the existing billing statement print.

Migration 013 also adds database guards for event packages attached to Walk-ins. A Manager or Administrator must provide a 10–500 character reason when adding or changing the package booking; the actor, reason, package, tier, pax, and timestamp are written to `pos_walkin_package_overrides`. A package bill line for a Walk-in must match both its current authorized reservation package and an override audit row. Direct table/RPC attempts by Receptionists cannot bypass this rule. Non-package extras remain available.

For a new bill, changing the selected party's adult, Senior/PWD, kid, or comped counts requires cashier confirmation before save. When editing an existing Open bill, its saved counts remain confirmed unless a value changes; changed counts require a fresh confirmation. The count editor shows the saved baseline and changed values. Closing without a linked table shows a confirmation warning. **Add Leftover charge** reads the active `LEFTOVER` item from `pos_charge_items`; the server remains the source of price and totals. Exact, ₱500, and ₱1,000 payment shortcuts set the tender input, and manual cash entry previews change or any shortfall; `pos_close_bill_phase3` remains responsible for authoritative payment and change calculation. Bill-close requests and the follow-up related-record refresh have 15-second limits so the UI exits its loading state and reports a timeout or refresh warning. Retrying from the same payment form reuses its idempotency key.

Migration 014 corrects the reservation guard so ordinary Walk-in inserts with no package are not treated as package overrides. Migration 015 permits a past Seated reservation to transition to Completed only when its linked bill has been closed and fully settled by the current actor in the same transaction; other historical edits remain protected. Run `supabase/015_past_reservation_bill_close.sql` after 014, then run the 013 and 015 acceptance scripts; both end with `ROLLBACK`. The 013 rollback removes the atomic entry point but intentionally retains idempotency/audit records and package enforcement. The 014 rollback restores the original guard defect and is not recommended. The 015 rollback restores the prior historical guard.

Migration 016 originally added `pos_resolve_stale_walkin(p_reservation_id text, p_reason text)`. Migration 019 retires that entry point; callers must use `pos_resolve_stale_booking` so the Manager/Administrator records an explicit outcome and any held-deposit action.

Migration 017 rejects a new same-day reservation, or a changed reservation schedule, when its start time has passed in the restaurant's Asia/Manila time zone. Walk-ins are exempt because their start time is recorded as guests arrive; edits that leave an existing reservation's date and time unchanged remain allowed. The four-step staff reservation wizard and public reservation form filter out today's elapsed slots and validate again on submit. Run `supabase/017_prevent_past_reservation_times.sql` after 016, then run `supabase/017_prevent_past_reservation_times_acceptance.sql` after 10:00 AM Asia/Manila; the acceptance ends with `ROLLBACK`. Roll back with `supabase/017_prevent_past_reservation_times_rollback.sql` before rolling back 016.

Migration 018 restores the narrow past Seated Walk-in completion exception in `enforce_reservation_history_guard()` that migration 016 adds. It requires the existing 016 transaction-context helper and preserves the 015 settled-bill exception and historical edit checks. It changes no data. Apply `supabase/018_restore_stale_walkin_history_guard.sql` after 017, then rerun the 016 and 013 acceptance scripts. Its rollback restores the pre-018 (015) history guard; run that rollback before rolling back 017 or 016.

### Phase D — stale-booking resolution (migration 019)

`pos_list_unresolved_stale_bookings()` is a read-only, role-checked RPC for Administrator, Manager, and Receptionist. It returns past Pending/Confirmed bookings and past Seated bookings without a Closed zero-balance bill, including reservation ID/name/date/time/type/table/guest count/status, bill-status summary, Held-deposit total, age in Manila calendar days, and a `Payable` or `Unresolved` label. A Seated booking with an Open bill is labelled `Payable`; the UI offers the existing cashier flow and does not resolve it.

`pos_resolve_stale_booking(p_reservation_id text, p_outcome text, p_reason text, p_confirm_no_meal boolean, p_deposit_action text, p_deposit_reason text, p_idempotency_key text)` is a Manager/Administrator-only `SECURITY DEFINER` RPC. Outcomes are `close_without_charge`, `no_show`, and `cancel`. Close without charge is limited to past Seated Reservation/Walk-in rows, requires a 10–500 character reason and explicit confirmation that no meal was served or the record is a test/error, and refuses an Open or otherwise unsettled linked bill. It creates no bill, payment, or revenue. No-show/Cancelled is limited to past Pending/Confirmed rows.

When Held deposits exist, the same request must explicitly choose `refund` or `forfeit`; the action reason is required. Refund is recorded through the existing cash-movement mechanism and requires the Manager's own open shift. Deposit settlement, reservation status, table status, audit record, and idempotency record are atomic. Seated close-without-charge marks a linked table `Needs cleaning`; No-show/Cancelled frees its table to `Available`. Each resolution stores the actor, timestamp, reason, outcome, and related bill/deposit/cash-movement IDs in `pos_stale_booking_resolutions`. Repeating a matching idempotency key returns its prior result; reuse with different input is rejected.

The Reservations **Unresolved** filter displays the list and count to Receptionists, Managers, and Administrators. Rows with an Open bill show **Payable** and an **Open bill** action using the cashier flow. Managers/Administrators receive a Resolve dialog with outcome, reason, confirmation, deposit choice, and a refund/open-shift warning; Receptionists have no resolve or deposit action. Table Management links an unresolved past Seated booking to its item rather than presenting a dead in-use action. Resolution and list requests use a 15-second timeout; failures display errors and restore form state. Run `supabase/019_resolve_stale_bookings.sql` after 018, then `supabase/019_resolve_stale_bookings_acceptance.sql`; the acceptance transaction ends with `ROLLBACK`. Roll back 019 before 018 with `supabase/019_resolve_stale_bookings_rollback.sql`.

## Reservation guest counts and source (Phase A)

The `reservations` table stores:

| Column | Meaning |
| --- | --- |
| `adults` | Adult guest count |
| `senior_pwd_count` | Senior/PWD guest count; defaults to `0` for existing and new rows |
| `children` | Kids guest count |
| `source` | Optional `Website`, `Phone`, `Facebook`, `Walk-in`, or `Other` source |

Reservation totals and table-capacity checks use `adults + senior_pwd_count + children`. The browser validates whole-number counts; the database enforces a positive total and table capacity. Walk-ins may have no email or phone. Other reservations still require at least one of them, and the application does not fabricate contact details.

The public booking endpoint remains `POST /rest/v1/rpc/public_create_reservation` with the existing `payload` JSON argument. Website requests remain Pending, use the existing contact/rate-limit validation, default `senior_pwd_count` to `0`, and are tagged `Website` by the database. Staff create or update reservations through the existing `reservations` table endpoint subject to RLS, triggers, and constraints; the optional source is selected from the supported list. From the Reservations page, confirming a pending booking can also assign an eligible table in the same update, or leave it unassigned when no table is chosen.

Example:

```js
const { data, error } = await window.supabaseClient.rpc(
  'public_create_reservation',
  { payload: reservation }
);
```

## Authentication API

The application uses Supabase Auth through `window.supabaseClient.auth`:

- `signInWithPassword()` — sign in staff
- `getSession()` — restore/check the current session
- `signOut()` — sign out
- `updateUser()` — update the authenticated user's password
- `resetPasswordForEmail()` — start password recovery
- `onAuthStateChange()` — react to sign-in, sign-out, and session changes

These are handled by Supabase Auth rather than by a custom login endpoint in this repository.

The Auth SDK uses Supabase-managed Auth endpoints under the project URL. The application does not define or expose custom `/api/login` or `/api/logout` routes.

## Realtime WebSocket API

The application does use Supabase Realtime. It creates a channel with a topic shaped like:

```text
costtrack:<authenticated-user-id>:<current-view>
```

The channel is used to subscribe to database changes and refresh the relevant view when another user changes shared data. This is a WebSocket-based connection managed by Supabase, not a custom WebSocket server in the project.

| Realtime resource | Purpose |
| --- | --- |
| `costtrack:<user-id>:<view>` | Subscribe the current signed-in browser to relevant database changes for its active view |

## Security and backend responsibilities

Supabase provides the backend services used here:

- PostgreSQL stores the data.
- Database functions implement protected multi-step operations.
- Row-level security and database policies restrict access.
- Auth identifies the current staff member.
- Realtime distributes selected database changes.

The frontend contains only the publishable Supabase key. A Supabase service-role key must never be placed in browser code.

## Source locations

- Client setup and REST/RPC data access: `supabase-config.js`
- UI calls, authentication flow, and Realtime subscription: `app.js`
- Database tables, functions, triggers, and security policies: `supabase/`
- Deployment and migration instructions: `SUPABASE-SETUP.md`

## Presentation checklist and likely questions

### What backend does the system use?

The system uses Supabase as a backend-as-a-service. Supabase provides the PostgreSQL database, REST API, RPC API, authentication, security policies, and Realtime service. The repository does not contain a separate Express, Node.js, PHP, or Python server.

### What type of API is used?

The system uses several Supabase API services:

1. **REST/PostgREST API** for table reads and direct table changes.
2. **RPC API** for calling PostgreSQL functions that perform validated business operations.
3. **Supabase Auth API** for login, sessions, password changes, and recovery.
4. **Supabase Realtime WebSocket API** for database-change notifications.

### What exactly is RPC in this project?

RPC means Remote Procedure Call. In this project, it is a `POST` request to a Supabase endpoint that executes a named PostgreSQL function:

```text
POST /rest/v1/rpc/<function_name>
```

For example:

```js
await window.supabaseClient.rpc('costtrack_receive_delivery', {
  payload: delivery
});
```

This calls:

```text
https://niiodqunoflblfcgdods.supabase.co/rest/v1/rpc/costtrack_receive_delivery
```

The function can validate input and perform several related database changes atomically. This is safer than making many independent browser requests for one business transaction.

### Why does the system use RPC instead of only REST?

Simple table reads are suitable for REST. More sensitive workflows use RPC so that validation and related changes happen inside the database. Examples include:

- Receiving a delivery and creating its inventory movements.
- Recording waste and deducting stock.
- Saving a product or recipe with validation.
- Confirming revenue.
- Starting or completing production batches.
- Creating reservations with reservation rules.
- Generating analytics results.

This helps prevent incomplete transactions and makes database rules apply even if a user bypasses the interface.

### Shared notification read state

The header notification panel merges role-visible operational alerts with the existing POS notifications. The client calls:

```js
await window.supabaseRecord.notificationReadKeys();
await window.supabaseRecord.markNotificationsRead(['stock:ING-1']);
```

These adapters call `costtrack_notification_read_keys()` and `costtrack_mark_notifications_read(text[])`. PostgreSQL scopes read-state rows to the caller's application role, and only Managers/Administrators may mark POS notification keys. Realtime publishes role-authorized read-state changes so other sessions can refresh their unread badge. Migration and acceptance instructions are in `SUPABASE-SETUP.md`.

### What is an endpoint?

An endpoint is a URL that accepts a request for a particular operation. For example:

```text
GET  /rest/v1/reservations
POST /rest/v1/rpc/public_create_reservation
```

The first reads reservation rows. The second runs the PostgreSQL function that creates a public reservation.

### What should be shown in a presentation?

Recommended files and demonstrations:

1. Open `index.html` and show that the browser loads the Supabase client.
2. Open `supabase-config.js` and show `createClient()`, `.from()`, and `.rpc()`.
3. Show one REST example, such as loading reservations.
4. Show one RPC example, such as `public_create_reservation` or `report_analytics`.
5. Open the corresponding SQL function in `supabase/` and show where validation and database logic run.
6. Show Supabase Dashboard -> Database -> Functions and Table Editor.
7. Explain that authentication and row-level security control who may call or modify data.
8. Explain that Realtime refreshes relevant views when shared database records change.

### What happens during a request?

The normal request flow is:

```text
User action
  -> app.js event handler
  -> supabase-config.js data-access method
  -> Supabase API endpoint
  -> Auth and row-level security checks
  -> PostgreSQL table or function
  -> response returned to the browser
  -> UI state refreshed
```

For an RPC transaction, the PostgreSQL function may also run triggers and related updates before returning its result.

### How is the API secured?

- Users authenticate through Supabase Auth.
- The browser uses only the publishable key.
- Row-level security policies restrict database access by authenticated user and role.
- PostgreSQL functions validate important business operations.
- Database triggers enforce consistency for related changes.
- A service-role key is not included in the frontend and must never be exposed there.

The publishable key is not a password. It is safe to distribute to the browser only when database policies and functions are configured correctly.

### How can the endpoints be tested?

They can be demonstrated through the application, Supabase Dashboard API documentation, or an API client such as Postman. A test request needs the Supabase project URL, the appropriate REST or RPC path, JSON input when required, and an authenticated access token for protected operations. The preferred demonstration is through the application or Supabase's generated API documentation rather than exposing credentials.

### What are the system's limitations?

- There is no custom `/api/...` route folder in this repository.
- Supabase-generated endpoints depend on the database schema and deployed SQL migrations.
- Direct REST access is still controlled by authentication and row-level security.
- RPC functions must exist in the Supabase project before their frontend calls can succeed.
- Realtime works only for configured subscriptions and permitted database changes.
- The retired `create_revenue_draft(text)` RPC is intentionally excluded from the active endpoint inventory.

### Short answer for a professor

> "Our system uses Supabase as a backend-as-a-service. We use its REST API for table operations, its RPC API to execute validated PostgreSQL functions for complex transactions, Supabase Auth for authentication, and Realtime WebSockets for live updates. The frontend calls these services through `supabase-config.js`, while the database tables, functions, triggers, and row-level security policies are defined in the `supabase` SQL files."

## User Management (migration 032)

User Management writes are intentionally not available through direct table DML:

- Authenticated clients can read profiles according to RLS, but cannot insert, update, or delete `profiles`.
- Authenticated clients cannot insert, update, or delete `user_invites`; only active Administrators can read staff and invitation history.
- Role changes call `costtrack_update_profile_role(p_user_id, p_new_role, p_reason)`. It requires an active Administrator and a 1–500 character reason. Self-role changes and demotion of the last active Administrator are rejected by PostgreSQL.
- Account status changes and invite lifecycle writes are performed by the server-side `invite-user` Edge Function using its service-role key. `costtrack_set_profile_account_status` rejects a blank deactivation reason and protects self and the last active Administrator.
- Role, account-status, and invitation audit tables are append-only. Invitation audit records capture actor, timestamp, target email/name/role, action, and old/new status.

The browser calls `POST /functions/v1/invite-user` with the signed-in user's access token and the project's publishable key. Supported actions:

| Action | Request fields | Result |
| --- | --- | --- |
| `invite` | `email`, `full_name`, `role` | Creates a Pending invitation/profile and sends the invite email. New invitations support Manager, Receptionist, Inventory Clerk, and Chef / Kitchen Staff; Administrator access is granted by a reasoned role change. |
| `resend` | `invitation_id` | Reissues the Auth invitation for a Pending or Expired invite, refreshes its seven-day database expiry, and records a Resent event. |
| `cancel` | `invitation_id` | Cancels the invitation and revokes an unconfirmed Auth account; the invitation history remains. |
| `accept` | No fields beyond `action` | Records acceptance after the signed-in invitee's email is confirmed. |
| `deactivate` | `user_id`, required `reason` | Blocks Auth sign-in and active-role RLS access; records the reason. |
| `reactivate` | `user_id`, optional `reason` | Restores Auth sign-in and Active status. |

Failures return HTTP status plus a structured JSON body; `error` and `message` contain the same user-displayable text:

```json
{
  "error": "Supabase Auth email rate limit reached. Try again later.",
  "message": "Supabase Auth email rate limit reached. Try again later.",
  "code": "rate_limited",
  "request_id": "..."
}
```

Relevant codes include `invalid_email`, `already_registered`, `pending_invitation_exists`, `not_administrator`, `reason_required`, `rate_limited`, and `server_error`. A duplicate invite returns `pending_invitation_exists`; the UI can offer the Resend action for that invitation. Supabase Auth `422` and `429` responses are mapped to already-registered and rate-limited errors respectively. The server logs a request ID and operation/error code, not the service key.

The Edge Function sends invitation mail through the project's Supabase Auth SMTP configuration. Configure production SMTP in the Supabase Dashboard and deploy the function after applying migration 032. `SUPABASE_SERVICE_ROLE_KEY` must remain a server-managed Edge Function secret and must never be included in browser code.

The Administrator User Management page has a two-card landing view and a Staff / Invitations workspace. The cards show the latest active-staff and pending-invitation counts. Staff can be searched and filtered by role and status; the current account and last active Administrator are labelled Protected. Role and account-status changes require a reason and a styled confirmation before calling the RPC or Edge Function. Deactivation blocks sign-in and CostTrack API access; reactivation restores access.

The invitation form validates name, email, and role before sending. It warns when the address already has an account or a Pending/Expired invitation; an existing invitation can be resent without leaving the form. Invitation history displays inviter, status, invited/expiry/acceptance dates, and only valid Resend or Cancel actions. User Management requests have a 15-second timeout; errors are shown in a toast, while a successful write followed by a failed list refresh is reported as saved with a retry option.

### Verification records (migration 041)

Apply [`041_verification_records.sql`](./supabase/041_verification_records.sql) after migration 040 and deploy the updated `invite-user` Edge Function. An onboarding invite may include a `verification_record` payload containing the applicant name, ID type, a last-four-only masked ID, whitelisted OCR summary fields, local face-match result/heuristic score, any explicit override reason, and private image paths. The Edge Function derives the actor, role, invitation, and Auth profile IDs server-side. The `costtrack_create_verification_record` SECURITY DEFINER RPC inserts the Pending profile and its verification record in one PostgreSQL transaction; direct table writes are denied and Administrator reads are RLS protected. Corrections are new records linked by `supersedes_id`; existing records cannot be updated or deleted.

The `verification-evidence` Storage bucket is private and Administrator-only for reads/writes. It stores ID/selfie objects, while the database stores paths only. `retention_until` defaults to 90 days after the record is written; automatic deletion is future work and no scheduler is configured. No onboarding consent capture exists yet, so current records store `consent_given = false` and `consent_at = null`. Face scores are local heuristic similarity indicators, not calibrated probabilities.

Supabase Auth user creation and invitation email are external to PostgreSQL. If the record/profile RPC fails, the Edge Function attempts to delete the Auth user, cancel the invitation, and remove uploaded evidence; this is compensating cleanup, not a distributed transaction. An onboarding record failure returns an explicit error and does not leave a profile created by the RPC. The Administrator User Management workspace adds a read-only Verification Records tab with applicant-name search and a detail timeline. Run [`041_verification_records_acceptance.sql`](./supabase/041_verification_records_acceptance.sql) after provisioning its documented temporary Auth-only test user; it ends with `ROLLBACK`. Rollback is intentionally non-destructive: deploy the previous Edge Function first, then run [`041_verification_records_rollback.sql`](./supabase/041_verification_records_rollback.sql); audit rows and the private bucket remain.
