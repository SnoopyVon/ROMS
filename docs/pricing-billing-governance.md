# Pricing & Billing Governance

## Permission rules

| Role | Pricing setup access |
| --- | --- |
| Administrator | Create and edit packages, charges, and discounts; edit POS rules; activate/deactivate pricing rules; view pricing history; participate in the existing waiver approval flow. |
| Manager | View setup and package rates; enable or disable catalogued promotions only. Cannot create, reprice, delete, or change POS rules. |
| Receptionist | No setup route or pricing writes. This is the application's cashier role and retains read access to selected pricing records needed by operational workflows. |
| Inventory Clerk, Chef / Kitchen Staff | No pricing setup access. |

There is no separate `Cashier` application role; cashier operations use `Receptionist`. Pricing-table row-level security is enforced by migration `053`, in addition to the page and write guards.

## Pricing changes and historical transactions

- Pricing records cannot be hard-deleted. Retire them by setting them inactive.
- Package tiers and package items cannot be changed while attached to Pending, Confirmed, or Seated reservations. Package tiers, additional charges, and promotions cannot be added or changed while any POS bill is open. Make catalog changes after open bills are closed so existing transactions cannot use updated rules.
- Changes to extra-guest and service-charge settings are blocked while any POS bill is open, because the current billing workflow reads those settings during bill calculations.
- POS bills already store guest-rate and discount snapshots; bill lines store their unit prices. Closed bills are the source for POS revenue reports, so later catalog changes do not recalculate closed-bill totals.
- Reservations do not store an explicit booked-price snapshot. The active-reservation guard protects their linked package from repricing, but this is not the same as a stored immutable reservation price. The package price is copied to a bill line when the reservation bill is created.
- Service-charge settings are not snapshotted on open bills; the open-bill guard is the mitigation. The protected billing workflow would need changes to support true service-charge snapshots.

These safeguards preserve existing billing and reservation calculations rather than changing them.

## Audit and approvals

Migration `053` attaches the existing `write_audit_log()` trigger to package, charge, discount, POS-setting, and buffet-rate tables. It records actor, action, previous/new row data, and timestamp in `audit_logs`; the setup page exposes the most recent pricing history to Administrators. History begins after the migration is applied; it does not backfill earlier pricing changes.

The existing POS workflow requires a second approver for full-bill waivers and 100% bill discounts and rejects self-approval. The current workflow does not require separate approval for complimentary guest counts or every partial VIP/courtesy discount. Closing those gaps requires changes to POS transaction processing, which was outside this task's scope.

## Dependency validation

| Path | Current behavior |
| --- | --- |
| Pricing setup → Reservations | Reservations reference package item/tier IDs. Active reservations are protected from linked package edits; there is no explicit booked-price column. |
| Pricing setup → Cashier billing | Bill creation reads package rates and configured charges. Guest rates and selected discounts are snapshotted on bills; charge/package line prices are stored on bill lines. Service-charge and extra-guest setting edits are blocked while bills are open. |
| Cashier billing → Revenue tracking | `pos_closed_bill_revenue_v` and `pos_revenue_report()` derive POS revenue from closed bills. Buffet revenue records copy their rates when created. |
| Revenue tracking → Reports & analytics | POS revenue reports read the closed-bill revenue view; buffet revenue reporting reads `revenue_records`. Historical closed bills are not recalculated from current catalog settings. |

## Acceptance status

| Check | Result |
| --- | --- |
| Administrator/Manager UI and write restrictions | Browser-checked with seeded page data and mutation-guard checks; database enforcement is defined in migration `053` and is pending deployment. |
| Manager promotion-toggle-only restriction | Browser-checked; database enforcement is defined by the trigger and RLS policy in migration `053`, pending deployment. |
| Hard deletion prevention and pricing audit triggers | Defined in migration `053`, pending deployment; audit history will be forward-looking only. |
| Existing POS price snapshots and closed-bill reporting paths | Verified in the existing SQL workflow and report definitions. |
| Reservation booked-price snapshot and open-bill service-charge snapshot | Not implemented. Active-reservation package edits and package, charge, discount, extra-guest, and service-charge rule edits while any bill is open are guarded as described above. |
| Approval for complimentary guests and all partial courtesy discounts | Not implemented in the protected POS workflow. |
| Automated application tests | PASS: `node --check frontend/app.js`, `node --check frontend/supabase-config.js`, `node --check frontend/business-logic.js`; `node --test business-logic.test.js supabase-config.test.js` passed 129/129 tests. Database acceptance checks require applying the migration in an approved Supabase environment. |

Apply `053_pricing_billing_governance.sql` to Supabase before relying on database-enforced controls. Then run `053_pricing_billing_governance_acceptance.sql` to verify installed policies, triggers, and existing snapshot columns. Neither script is applied to a live database by this change.
