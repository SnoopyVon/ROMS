# CostTrack ERD Relationships

This document lists the database relationships declared in the Supabase schema and migrations. It is intended to help connect the tables in an existing ERD.

## Reading the relationships

- `Parent 1 → many Child` means the child table has a foreign key to the parent.
- `?` means the child’s foreign-key value is nullable.
- Unless noted as unique, a parent may be referenced by multiple child rows.
- Relationships listed below are declared by database foreign keys, except where explicitly labeled as application-level or polymorphic.

The list is based on the SQL files in `supabase/`, not a live database inspection.

## 1. Recipes, ingredients, and production

| Parent | Child | Relationship |
| --- | --- | --- |
| `recipes` | `recipe_ingredients` | 1 → many; `recipe_ingredients.recipe_id` |
| `ingredients` | `recipe_ingredients` | 1 → many; `recipe_ingredients.ingredient_id` |
| `recipes` | `production_logs` | 1 → many; `production_logs.recipe_id` |
| `ingredients` | `inventory_transactions` | 1 → many; `inventory_transactions.ingredient_id` |
| `ingredients` | `waste_logs` | 1 → many; `waste_logs.ingredient_id` |
| `production_logs` | `waste_logs` | 1 → many; optional `waste_logs.production_log_id` |
| `ingredients` | `physical_counts` | 1 → many; `physical_counts.ingredient_id` |

`recipe_ingredients` is the junction table between `recipes` and `ingredients`. Together, the two relationships form a many-to-many relationship.

`prepared_food_waste_logs` is separate from ingredient-linked `waste_logs` and has no ingredient foreign key. Its quantity is recorded in portions; it does not restore or deduct ingredient stock.

## 2. Revenue and reservations

| Parent | Child | Relationship |
| --- | --- | --- |
| `reservations` | `revenue_records` | 1 → many; optional `revenue_records.reservation_id` |
| `buffet_rates` | `revenue_records` | 1 → many; optional `revenue_records.rate_id` |
| `restaurant_tables` | `reservations` | 1 → many; optional `reservations.table_id` |

A table can be used by reservations at different times. The schema also prevents active reservations from being assigned the same table at the same date and time.

## 3. Inventory and dish recipes

| Parent | Child | Relationship |
| --- | --- | --- |
| `product_categories` | `ingredients` | 1 → many; optional `ingredients.category_id` |
| `units` | `ingredients` | 1 → many; optional `ingredients.unit_id` |
| `ingredients` | `inventory_batches` | 1 → many; `inventory_batches.product_id` |
| `inventory_transactions` | `inventory_batches` | 1 → 0..1; optional, unique `inventory_batches.source_transaction_id` |
| `ingredients` | `stock_movements` | 1 → many; `stock_movements.product_id` |
| `inventory_batches` | `stock_movements` | 1 → many; `stock_movements.batch_id` |
| `production_logs` | `production_consumption` | 1 → many; `production_consumption.production_id` |
| `ingredients` | `production_consumption` | 1 → many; `production_consumption.product_id` |
| `inventory_batches` | `production_consumption` | 1 → many; `production_consumption.batch_id` |
| `food_categories` | `dishes` | 1 → many; `dishes.food_category_id` |
| `dishes` | `dish_recipe_versions` | 1 → many; `dish_recipe_versions.dish_id` |
| `dish_recipe_versions` | `dish_recipe_ingredients` | 1 → many; `dish_recipe_ingredients.recipe_version_id` |
| `ingredients` | `dish_recipe_ingredients` | 1 → many; `dish_recipe_ingredients.product_id` |
| `units` | `dish_recipe_ingredients` | 1 → many; `dish_recipe_ingredients.unit_id` |
| `recipes` | `dish_recipe_versions` | 1 → 0..1; optional, unique `dish_recipe_versions.legacy_recipe_id` |

`dish_recipe_ingredients` connects recipe versions to ingredients, forming a many-to-many relationship between those entities, with a unit and quantity recorded for each ingredient.

### Legacy mapping tables

| Parent | Child | Relationship |
| --- | --- | --- |
| `recipes` | `legacy_recipe_mappings` | 1 → 0..1; `legacy_recipe_id` is the mapping’s primary key |
| `dishes` | `legacy_recipe_mappings` | 1 → many |
| `dish_recipe_versions` | `legacy_recipe_mappings` | 1 → 0..1; mapping’s `recipe_version_id` is unique |
| `production_logs` | `legacy_production_mappings` | 1 → 0..1; `production_log_id` is the mapping’s primary key |
| `recipes` | `legacy_production_mappings` | 1 → many |
| `dishes` | `legacy_production_mappings` | 1 → many; optional mapping link |
| `dish_recipe_versions` | `legacy_production_mappings` | 1 → many; optional mapping link |
| `recipes` | `production_batches` | 1 → many |
| `production_logs` | `production_batches` | 1 → 0..1; optional, unique `production_log_id` |
| `production_batches` | `prepared_food_waste_logs` | 1 → many; optional `production_batch_id` |

## 4. POS billing and shifts

| Parent | Child | Relationship |
| --- | --- | --- |
| `pos_charge_items` | `pos_charge_item_variants` | 1 → many |
| `pos_package_tiers` | `pos_package_inclusions` | 1 → many |
| `pos_charge_items` | `pos_package_inclusions` | 1 → many; optional inclusion link |
| `reservations` | `pos_bills` | 1 → many; optional `pos_bills.reservation_id` |
| `pos_shifts` | `pos_bills` | 1 → many; optional `pos_bills.shift_id` |
| `restaurant_tables` | `pos_bills` | 1 → many; optional `pos_bills.table_id` |
| `pos_discounts` | `pos_bills` | 1 → many; optional `pos_bills.discount_id` |
| `pos_bills` | `pos_bill_lines` | 1 → many |
| `pos_charge_items` | `pos_bill_lines` | 1 → many; optional line link |
| `pos_package_tiers` | `pos_bill_lines` | 1 → many; optional line link |
| `pos_bills` | `pos_bill_payments` | 1 → many |
| `pos_shifts` | `pos_bill_payments` | 1 → many; optional payment link |
| `pos_reservation_deposits` | `pos_bill_payments` | 1 → many; optional payment link |
| `reservations` | `pos_reservation_deposits` | 1 → many; optional deposit link |
| `pos_bills` | `pos_reservation_deposits` | 1 → many; optional deposit link |
| `pos_reservation_deposits` | `pos_reservation_deposits` | self-reference; a deposit may have a parent deposit |
| `pos_reservation_deposits` | `pos_deposit_actions` | 1 → many |
| `pos_bills` | `pos_deposit_actions` | 1 → many; optional action link |
| `pos_bills` | `pos_bill_approvals` | 1 → many |
| `pos_discounts` | `pos_bill_approvals` | 1 → many; optional approval link |
| `pos_shifts` | `pos_cash_movements` | 1 → many; optional movement link |

## 5. Walk-in billing

| Parent | Child | Relationship |
| --- | --- | --- |
| `reservations` | `pos_walkin_bill_requests` | 1 → 0..1; request’s `reservation_id` is unique |
| `pos_bills` | `pos_walkin_bill_requests` | 1 → 0..1; request’s `bill_id` is unique |
| `reservations` | `pos_walkin_package_overrides` | 1 → many |
| `pos_charge_items` | `pos_walkin_package_overrides` | 1 → many |
| `pos_package_tiers` | `pos_walkin_package_overrides` | 1 → many |

## 6. Supabase Auth user relationships

`auth.users` is Supabase’s authentication table, outside the application’s `public` tables.

| Parent | Child column(s) |
| --- | --- |
| `auth.users` | `profiles.id` — one-to-one profile link |
| `auth.users` | `reservations.created_by`, `waste_logs.recorded_by`, `prepared_food_waste_logs.recorded_by`, `audit_logs.actor_id` |
| `auth.users` | `product_categories.created_by/updated_by`, `units.created_by/updated_by`, `suppliers.created_by/updated_by` |
| `auth.users` | `ingredients.created_by/updated_by`, `inventory_batches.created_by/updated_by`, `stock_movements.user_id` |
| `auth.users` | `inventory_settings.updated_by`, `inventory_migration_issues.resolved_by` |
| `auth.users` | `food_categories.created_by/updated_by`, `dishes.created_by/updated_by` |
| `auth.users` | `dish_recipe_versions.created_by`, `dish_recipe_ingredients.created_by` |
| `auth.users` | `production_consumption.created_by`, `notifications.created_by` |
| `auth.users` | `production_batches.started_by/ready_by` |

These are optional references unless the schema says otherwise. Do not assume every UUID user/actor column is an Auth foreign key: some POS actor columns are UUIDs without a declared FK.

## 7. References that are not foreign keys

These columns may identify related records in application logic, but the schema does not enforce them as ordinary foreign keys. Do not draw solid FK lines for them:

- `audit_logs.table_name` + `record_id`
- `notifications.reference_type` + `reference_id`
- `pos_notifications.source_type` + `source_id`
- `inventory_migration_issues.source_table` + `source_id`
- `stock_movements.reference_type` + `reference_id`

`inventory_transactions.supplier_name` is text, not a link to `suppliers`. The `inventory_batches.receiving_id` field also has no declared FK in the migrations reviewed.

## 8. Standalone/support objects and views

These objects have no direct business-table FK relationships in the schema reviewed:

- `app_records` — legacy JSON archive
- `app_records_migrations` and `app_records_migration_errors` — migration tracking
- `public_reservation_attempts` — rate-limit ledger
- `pos_settings`
- `test_connection`
- `suppliers` — apart from its Auth user audit columns

The following are **views**, not tables:

- `report_confirmed_revenue_v` reads from `revenue_records`.
- `report_inventory_valuation_v` reads from `ingredients`.

Views can be shown separately in an ERD, but they are not normal FK-connected entities.
