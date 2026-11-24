const SUPABASE_URL = 'https://niiodqunoflblfcgdods.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_IVE25Rqzu-lDLFayVYmhfQ_dvPIO6E5';
const POS_BILL_SAVE_TIMEOUT_MS = 15000;
const USER_MANAGEMENT_TIMEOUT_MS = 15000;
const INVITABLE_USER_ROLES = Object.freeze([
  'Manager',
  'Receptionist',
  'Inventory Clerk',
  'Chef / Kitchen Staff'
]);
window.costTrackInviteRoles = INVITABLE_USER_ROLES;

window.costTrackInviteLink = Boolean(
  window.location
  && new URLSearchParams(window.location.hash.slice(1)).get('type') === 'invite'
);

window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } }
);

const recordVersions = new Map();
const tableForCollection = {
  ingredients: 'ingredients',
  recipes: 'recipes',
  inventoryTransactions: 'inventory_transactions',
  inventoryBatches: 'inventory_batches',
  productionLogs: 'production_logs',
  revenueRecords: 'revenue_records',
  wasteLogs: 'waste_logs',
  preparedFoodWasteLogs: 'prepared_food_waste_logs',
  physicalCounts: 'physical_counts',
  users: 'profiles',
  reservations: 'reservations',
  restaurantTables: 'restaurant_tables',
  buffetRates: 'buffet_rates',
  chargeItems: 'pos_charge_items',
  chargeItemVariants: 'pos_charge_item_variants',
  packageTiers: 'pos_package_tiers',
  packageInclusions: 'pos_package_inclusions',
  discounts: 'pos_discounts',
  posSettings: 'pos_settings',
  shifts: 'pos_shifts',
  cashMovements: 'pos_cash_movements',
  posBills: 'pos_bills',
  billLines: 'pos_bill_lines',
  billPayments: 'pos_bill_payments',
  reservationDeposits: 'pos_reservation_deposits',
  billApprovals: 'pos_bill_approvals',
  posNotifications: 'pos_notifications',
  notifications: 'notifications',
  auditLogs: 'audit_logs'
};

function rememberVersion(collection, id, updatedAt) {
  if (updatedAt) recordVersions.set(`${collection}:${id}`, updatedAt);
}

function dateValue(value) {
  const str = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function mapDatabaseRecord(collection, row) {
  if (collection === 'auditLogs') {
    return {
      id: row.id,
      actorId: row.actor_id,
      tableName: row.table_name,
      recordId: row.record_id,
      action: row.action,
      occurredAt: row.occurred_at
    };
  }
  const updatedAt = row.updated_at;
  if (collection === 'users') {
    rememberVersion(collection, row.id, updatedAt);
    return {
      id: row.id,
      name: row.full_name,
      email: row.email,
      role: row.role,
      accountStatus: row.account_status,
      updatedAt: row.updated_at || null
    };
  }
  rememberVersion(collection, row.id, updatedAt);
  if (collection === 'recipes') {
    return {
      id: row.id, name: row.name, category: row.category,
      wastage: row.wastage == null ? null : Number(row.wastage),
      batchYield: Number(row.batch_yield || 30),
      prepTarget: Number(row.prep_target || 30),
      prepNotes: row.prep_notes || '',
      isActive: row.is_active !== false,
      ingredients: (row.recipe_ingredients || row.ingredients || []).map(line => ({
        ingredientId: line.ingredient_id, quantity: Number(line.quantity)
      }))
    };
  }
  if (collection === 'inventoryTransactions') {
    return {
      id: row.id, ingredientId: row.ingredient_id, quantity: Number(row.quantity),
      unitCost: Number(row.unit_cost), date: row.transaction_date,
      type: row.transaction_type, note: row.note || '',
      supplierName: row.supplier_name || '', invoiceNumber: row.invoice_number || '',
      invoiceDate: row.invoice_date || '', batchCode: row.batch_code || '',
      expirationDate: row.expiration_date || ''
    };
  }
  if (collection === 'inventoryBatches') {
    return {
      id: row.id, productId: row.product_id, batchCode: row.batch_code || '',
      quantityRemaining: Number(row.quantity_remaining || 0),
      expirationDate: row.expiration_date || '', receivedDate: row.received_date,
      status: row.status || 'Active', createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    };
  }
  if (collection === 'notifications') {
    return {
      id: row.id, type: row.type, severity: row.severity, message: row.message,
      targetRoles: Array.isArray(row.target_roles) ? row.target_roles : [],
      referenceType: row.reference_type || '', referenceId: row.reference_id || '',
      isRead: Boolean(row.is_read), isResolved: Boolean(row.is_resolved),
      dedupeKey: row.dedupe_key || '', createdAt: row.created_at || null
    };
  }
  if (collection === 'productionLogs') {
    return {
      id: row.id, recipeId: row.recipe_id, quantity: Number(row.quantity),
      coversProduced: row.covers_produced == null ? null : Number(row.covers_produced),
      batchCostSnapshot: row.batch_cost_snapshot == null ? null : Number(row.batch_cost_snapshot),
      costSnapshotAt: row.cost_snapshot_at || null,
      date: row.production_date, mode: row.mode
    };
  }
  if (collection === 'wasteLogs') {
    return {
      id: row.id, ingredientId: row.ingredient_id, quantity: Number(row.quantity),
      reason: row.reason, date: row.waste_date, productionLogId: row.production_log_id || null,
      recordedAt: row.recorded_at || null, recordedBy: row.recorded_by || null, notes: row.notes || ''
    };
  }
  if (collection === 'preparedFoodWasteLogs') {
    return {
      id: row.id, dishName: row.dish_name, productionBatchId: row.production_batch_id || null,
      productionBatchLabel: row.production_batch_label || '', quantity: Number(row.quantity),
      reason: row.reason, date: row.waste_date, recordedAt: row.recorded_at || null,
      recordedBy: row.recorded_by || null, notes: row.notes || ''
    };
  }
  if (collection === 'physicalCounts') {
    return { id: row.id, ingredientId: row.ingredient_id, expected: Number(row.expected), actual: Number(row.actual), date: row.count_date };
  }
  if (collection === 'revenueRecords') {
    return window.CostTrackLogic.createRevenueRecord({
      id: row.id, business_date: row.business_date, meal_period: row.meal_period,
      reservation_id: row.reservation_id,
      adult_customers: row.adult_customers, adult_rate: Number(row.adult_rate),
      child_customers: row.child_customers, child_rate: Number(row.child_rate),
      senior_pwd_customers: row.senior_pwd_customers, senior_pwd_rate: Number(row.senior_pwd_rate),
      status: row.status, remarks: row.remarks, recorded_by: row.recorded_by,
      recorded_at: row.recorded_at, last_edited_by: row.last_edited_by,
      last_edited_at: row.last_edited_at, edit_reason: row.edit_reason,
      voided_by: row.voided_by, void_reason: row.void_reason, voided_at: row.voided_at
    });
  }
  if (collection === 'reservations') {
    return {
      id: row.id, name: row.name, email: row.email, phone: row.phone,
      date: row.reservation_date, time: row.reservation_time, guests: row.guests,
      adults: row.adults, seniorPwdCount: Number(row.senior_pwd_count || 0),
      children: row.children, source: row.source || '', occasion: row.occasion,
      status: row.status, preference: row.preference, request: row.request,
      createdAt: row.created_at || null,
      table: row.table_id, type: row.type, seatedAt: row.seated_at, completedAt: row.completed_at,
      actualCovers: row.actual_covers, correctionReason: row.last_correction_reason || '',
      packageChargeItemId: row.package_charge_item_id || '',
      packageTierId: row.package_tier_id || '',
      packagePaxCount: row.package_pax_count == null ? '' : Number(row.package_pax_count),
      packageOverrideReason: row.package_override_reason || ''
    };
  }
  if (collection === 'restaurantTables') {
    return {
      id: row.id, seats: row.seats, tableType: row.table_type || 'Unassigned',
      area: row.area || 'Unassigned', status: row.status,
      x: Number(row.x), y: Number(row.y), guest: row.guest
    };
  }
  if (collection === 'buffetRates') {
    return { id: row.id, mealPeriod: row.meal_period, dayType: row.day_type,
      adultRate: Number(row.adult_rate), childRate: Number(row.child_rate),
      seniorPwdRate: Number(row.senior_pwd_rate), effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to, isActive: row.is_active };
  }
  if (collection === 'chargeItems') {
    return {
      id: row.id, code: row.code, name: row.name, type: row.type,
      category: row.category || 'General', unitPrice: Number(row.unit_price || 0),
      defaultQuantity: Number(row.default_quantity || 1), isActive: Boolean(row.is_active),
      isFoodRevenue: Boolean(row.is_food_revenue), isPackage: Boolean(row.is_package),
      requiresApproval: Boolean(row.requires_approval), notes: row.notes || ''
    };
  }
  if (collection === 'chargeItemVariants') {
    return {
      id: row.id, chargeItemId: row.charge_item_id, variantName: row.variant_name,
      unitPrice: Number(row.unit_price || 0), isActive: Boolean(row.is_active),
      notes: row.notes || ''
    };
  }
  if (collection === 'packageTiers') {
    return {
      id: row.id, code: row.code, name: row.name, defaultMealPeriod: row.default_meal_period,
      basePrice: Number(row.base_price || 0), isActive: Boolean(row.is_active),
      notes: row.notes || ''
    };
  }
  if (collection === 'packageInclusions') {
    return {
      id: row.id, packageTierId: row.package_tier_id, chargeItemId: row.charge_item_id,
      quantity: Number(row.quantity || 0), isIncluded: Boolean(row.is_included), notes: row.notes || ''
    };
  }
  if (collection === 'discounts') {
    return {
      id: row.id, code: row.code, name: row.name, discountType: row.discount_type,
      value: Number(row.value || 0), minimumAmount: Number(row.minimum_amount || 0),
      appliesTo: row.applies_to || 'bill', isActive: Boolean(row.is_active), notes: row.notes || ''
    };
  }
  if (collection === 'posSettings') {
    return {
      id: row.id, key: row.setting_key, value: row.setting_value, type: row.setting_type,
      description: row.description || '', isSystem: Boolean(row.is_system), updatedAt: row.updated_at
    };
  }
  if (collection === 'shifts') {
    return {
      id: row.id, code: row.shift_code, openedBy: row.opened_by, openedAt: row.opened_at,
      closedAt: row.closed_at, status: row.status, openingFloat: Number(row.opening_float || 0),
      cashSales: Number(row.cash_sales || 0), cardSales: Number(row.card_sales || 0),
      declaredCash: Number(row.declared_cash || 0), expectedCash: row.expected_cash == null ? null : Number(row.expected_cash),
      cashVariance: row.cash_variance == null ? null : Number(row.cash_variance),
      closedBy: row.closed_by || null, notes: row.notes || ''
    };
  }
  if (collection === 'cashMovements') {
    return {
      id: row.id, shiftId: row.shift_id, movementType: row.movement_type, amount: Number(row.amount || 0),
      reason: row.reason || '', reference: row.reference || '', createdBy: row.created_by,
      idempotencyKey: row.idempotency_key || '', createdAt: row.created_at
    };
  }
  if (collection === 'posBills') {
    return {
      id: row.id, billNumber: row.bill_number, reservationId: row.reservation_id,
      shiftId: row.shift_id || null, tableId: row.table_id || null,
      customerName: row.customer_name || '', status: row.status, subtotal: Number(row.subtotal || 0),
      serviceCharge: Number(row.service_charge || 0), discountTotal: Number(row.discount_total || 0),
      depositTotal: Number(row.deposit_total || 0), paidTotal: Number(row.paid_total || 0),
      balanceDue: Number(row.balance_due || 0), notes: row.notes || '', printedTitle: row.printed_title || '',
      adultCount: Number(row.adult_count || 0), seniorCount: Number(row.senior_count || 0),
      kidsCount: Number(row.kids_count || 0), compedCount: Number(row.comped_count || 0),
      adultRate: Number(row.adult_rate_snapshot || 0), seniorRate: Number(row.senior_rate_snapshot || 0),
      kidsRate: Number(row.kids_rate_snapshot || 0), discountId: row.discount_id || '',
      discountReason: row.discount_reason || '', foodRevenueTotal: Number(row.food_revenue_total || 0),
      nonFoodRevenueTotal: Number(row.non_food_revenue_total || 0), customersServed: Number(row.customers_served || 0),
      closedAt: row.closed_at || null, closedBy: row.closed_by || null,
      voidedAt: row.voided_at || null, voidedBy: row.voided_by || null, voidReason: row.void_reason || '',
      createdBy: row.created_by || null, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }
  if (collection === 'billLines') {
    return {
      id: row.id, billId: row.bill_id, chargeItemId: row.charge_item_id, packageTierId: row.package_tier_id,
      description: row.description, quantity: Number(row.quantity || 0), unitPrice: Number(row.unit_price || 0),
      lineType: row.line_type, foodRevenueAmount: Number(row.food_revenue_amount || 0),
      nonFoodRevenueAmount: Number(row.non_food_revenue_amount || 0),
      isFoodRevenueSnapshot: Boolean(row.is_food_revenue_snapshot), isVoided: Boolean(row.is_voided),
      voidReason: row.void_reason || ''
    };
  }
  if (collection === 'billPayments') {
    return {
      id: row.id, billId: row.bill_id, paymentMethod: row.payment_method, amount: Number(row.amount || 0),
      tenderedAmount: Number(row.tendered_amount || 0), changeAmount: Number(row.change_amount || 0),
      idempotencyKey: row.idempotency_key || '', referenceNo: row.reference_no || '',
      shiftId: row.shift_id || null, reservationDepositId: row.reservation_deposit_id || null,
      paidBy: row.paid_by || '', paidAt: row.paid_at || null
    };
  }
  if (collection === 'reservationDeposits') {
    return {
      id: row.id, reservationId: row.reservation_id, billId: row.bill_id, amount: Number(row.amount || 0),
      paymentMethod: row.payment_method, status: row.status, notes: row.notes || '',
      receiptAmount: Number(row.receipt_amount || 0), receivedShiftId: row.received_shift_id || null,
      parentDepositId: row.parent_deposit_id || null, createdBy: row.created_by, createdAt: row.created_at
    };
  }
  if (collection === 'billApprovals') {
    return {
      id: row.id, billId: row.bill_id, requestType: row.request_type, status: row.status,
      discountId: row.discount_id || '', requestReason: row.request_reason,
      requestedBy: row.requested_by, requestedAt: row.requested_at,
      decidedBy: row.decided_by || null, decidedAt: row.decided_at || null,
      decisionReason: row.decision_reason || ''
    };
  }
  if (collection === 'posNotifications') {
    return {
      id: row.id, type: row.notification_type, sourceType: row.source_type,
      sourceId: row.source_id, targetRole: row.target_role, title: row.title,
      message: row.message, createdAt: row.created_at, readAt: row.read_at || null
    };
  }
  return {
    id: row.id, name: row.name, category: row.category, unit: row.unit,
    cost: row.cost == null ? null : Number(row.cost), stock: Number(row.stock), minimum: Number(row.minimum),
    preferredSupplier: row.preferred_supplier || '', trackExpiry: Boolean(row.track_expiry),
    shelfLifeDays: row.shelf_life_days == null ? null : Number(row.shelf_life_days), notes: row.notes || '',
    isActive: row.is_active !== false, updatedAt: row.updated_at
  };
}

function mapApplicationRecord(collection, record) {
  if (collection === 'ingredients') return {
    id: record.id, name: record.name, category: record.category, unit: record.unit,
    cost: record.cost, stock: record.stock, minimum: record.minimum,
    preferred_supplier: record.preferredSupplier || '', track_expiry: record.trackExpiry === true,
    shelf_life_days: record.shelfLifeDays == null ? null : Number(record.shelfLifeDays),
    notes: record.notes || ''
  };
  if (collection === 'recipes') return {
    id: record.id, name: record.name, category: record.category,
    wastage: record.wastage,
    batch_yield: record.batchYield, prep_target: record.prepTarget,
    prep_notes: record.prepNotes || '', is_active: record.isActive !== false,
    ingredients: record.ingredients
  };
  if (collection === 'inventoryTransactions') return {
    id: record.id, ingredient_id: record.ingredientId, quantity: record.quantity,
    unit_cost: record.unitCost, transaction_date: dateValue(record.date),
    transaction_type: record.type, note: record.note || '',
    supplier_name: record.supplierName || '', invoice_number: record.invoiceNumber || '',
    invoice_date: record.invoiceDate ? dateValue(record.invoiceDate) : null,
    batch_code: record.batchCode || null,
    expiration_date: record.expirationDate ? dateValue(record.expirationDate) : null
  };
  if (collection === 'inventoryBatches') return {
    id: record.id, product_id: record.productId, batch_code: record.batchCode || '',
    quantity_remaining: Number(record.quantityRemaining || 0),
    expiration_date: record.expirationDate ? dateValue(record.expirationDate) : null,
    received_date: dateValue(record.receivedDate), status: record.status || 'Active'
  };
  if (collection === 'productionLogs') return { id: record.id, recipe_id: record.recipeId, quantity: record.quantity, covers_produced: record.coversProduced == null ? null : record.coversProduced, production_date: dateValue(record.date), mode: record.mode };
  if (collection === 'wasteLogs') return {
    id: record.id, ingredient_id: record.ingredientId, quantity: record.quantity,
    reason: record.reason, production_log_id: record.productionLogId || null,
    notes: record.notes || ''
  };
  if (collection === 'preparedFoodWasteLogs') return {
    id: record.id, dish_name: String(record.dishName || '').trim(),
    production_batch_id: record.productionBatchId || null,
    quantity: Number(record.quantity), reason: record.reason,
    waste_date: dateValue(record.date), notes: record.notes || ''
  };
  if (collection === 'physicalCounts') return { id: record.id, ingredient_id: record.ingredientId, expected: record.expected, actual: record.actual, count_date: dateValue(record.date) };
  if (collection === 'revenueRecords') return {
    id: record.id, business_date: dateValue(record.business_date), meal_period: record.meal_period,
    reservation_id: record.reservation_id || null,
    adult_customers: record.adult_customers, adult_rate: record.adult_rate,
    child_customers: record.child_customers, child_rate: record.child_rate,
    senior_pwd_customers: record.senior_pwd_customers, senior_pwd_rate: record.senior_pwd_rate,
    status: record.status, remarks: record.remarks || '', recorded_by: record.recorded_by || '',
    recorded_at: record.recorded_at || new Date().toISOString(), last_edited_by: record.last_edited_by || '',
    last_edited_at: record.last_edited_at || null, edit_reason: record.edit_reason || '',
    voided_by: record.voided_by || '', void_reason: record.void_reason || '', voided_at: record.voided_at || null
  };
  if (collection === 'reservations') return {
    id: record.id, name: record.name, email: record.email || '', phone: record.phone || '',
    created_at: record.createdAt || new Date().toISOString(),
    reservation_date: dateValue(record.date), reservation_time: record.time, guests: Number(record.guests || 0),
    adults: record.adults === undefined ? Number(record.guests || 0) : Number(record.adults),
    senior_pwd_count: Number(record.seniorPwdCount || 0), children: Number(record.children || 0),
    source: record.source || null,
    occasion: record.occasion || '', status: record.status || 'Pending', preference: record.preference || '',
    request: record.request || record.requests || '', table_id: record.table || null,
    type: record.type || 'Reservation', seated_at: record.seatedAt || null, completed_at: record.completedAt || null,
    actual_covers: record.actualCovers == null ? null : record.actualCovers,
    last_correction_reason: record.correctionReason || '',
    package_charge_item_id: record.packageChargeItemId || null,
    package_tier_id: record.packageTierId || null,
    package_pax_count: record.packagePaxCount === '' || record.packagePaxCount == null ? null : Number(record.packagePaxCount),
    package_override_reason: record.packageOverrideReason || ''
  };
  if (collection === 'restaurantTables') return {
    id: record.id, seats: record.seats,
    table_type: record.tableType || 'Unassigned',
    area: record.area || 'Unassigned',
    status: record.status, x: record.x, y: record.y, guest: record.guest || ''
  };
  if (collection === 'buffetRates') return {
    id: record.id, meal_period: record.mealPeriod, day_type: record.dayType,
    adult_rate: record.adultRate, child_rate: record.childRate, senior_pwd_rate: record.seniorPwdRate,
    effective_from: dateValue(record.effectiveFrom), effective_to: record.effectiveTo ? dateValue(record.effectiveTo) : null,
    is_active: record.isActive !== false
  };
  if (collection === 'chargeItems') return {
    id: record.id, code: record.code || record.id, name: record.name || '', type: record.type || 'other',
    category: record.category || 'General', unit_price: Number(record.unitPrice || 0),
    default_quantity: Number(record.defaultQuantity || 1), is_active: record.isActive !== false,
    is_food_revenue: record.isFoodRevenue !== false, is_package: Boolean(record.isPackage),
    requires_approval: Boolean(record.requiresApproval), notes: record.notes || ''
  };
  if (collection === 'chargeItemVariants') return {
    id: record.id, charge_item_id: record.chargeItemId, variant_name: record.variantName || '',
    unit_price: Number(record.unitPrice || 0), is_active: record.isActive !== false,
    notes: record.notes || ''
  };
  if (collection === 'packageTiers') return {
    id: record.id, code: record.code || record.id, name: record.name || '', default_meal_period: record.defaultMealPeriod || 'All Day',
    base_price: Number(record.basePrice || 0), is_active: record.isActive !== false,
    notes: record.notes || ''
  };
  if (collection === 'packageInclusions') return {
    id: record.id, package_tier_id: record.packageTierId || null, charge_item_id: record.chargeItemId || null,
    quantity: Number(record.quantity || 0), is_included: record.isIncluded !== false, notes: record.notes || ''
  };
  if (collection === 'discounts') return {
    id: record.id, code: record.code || record.id, name: record.name || '', discount_type: record.discountType || 'percent',
    value: Number(record.value || 0), minimum_amount: Number(record.minimumAmount || 0),
    applies_to: record.appliesTo || 'bill', is_active: record.isActive !== false, notes: record.notes || ''
  };
  if (collection === 'posSettings') return {
    id: record.id, setting_key: record.key || record.id, setting_value: String(record.value ?? ''),
    setting_type: record.type || 'text', description: record.description || '', is_system: Boolean(record.isSystem)
  };
  if (collection === 'shifts') return {
    id: record.id, shift_code: record.code || record.id, opened_by: record.openedBy || null, opened_at: record.openedAt || new Date().toISOString(),
    closed_at: record.closedAt || null, status: record.status || 'Open', opening_float: Number(record.openingFloat || 0),
    cash_sales: Number(record.cashSales || 0), card_sales: Number(record.cardSales || 0),
    declared_cash: Number(record.declaredCash || 0), notes: record.notes || ''
  };
  if (collection === 'cashMovements') return {
    id: record.id, shift_id: record.shiftId || null, movement_type: record.movementType || 'adjustment',
    amount: Number(record.amount || 0), reason: record.reason || '', reference: record.reference || '',
    created_by: record.createdBy || null, created_at: record.createdAt || new Date().toISOString()
  };
  if (collection === 'posBills') return {
    id: record.id, bill_number: record.billNumber || record.id, reservation_id: record.reservationId || null,
    customer_name: record.customerName || '', status: record.status || 'Open', subtotal: Number(record.subtotal || 0),
    service_charge: Number(record.serviceCharge || 0), discount_total: Number(record.discountTotal || 0),
    deposit_total: Number(record.depositTotal || 0), paid_total: Number(record.paidTotal || 0),
    balance_due: Number(record.balanceDue || 0), notes: record.notes || '', printed_title: record.printedTitle || 'BILLING STATEMENT (not an official receipt)',
    created_at: record.createdAt || new Date().toISOString(), updated_at: record.updatedAt || new Date().toISOString()
  };
  if (collection === 'billLines') return {
    id: record.id, bill_id: record.billId, charge_item_id: record.chargeItemId || null, package_tier_id: record.packageTierId || null,
    description: record.description || '', quantity: Number(record.quantity || 0), unit_price: Number(record.unitPrice || 0),
    line_type: record.lineType || 'charge_item', food_revenue_amount: Number(record.foodRevenueAmount || 0),
    non_food_revenue_amount: Number(record.nonFoodRevenueAmount || 0), is_voided: Boolean(record.isVoided), void_reason: record.voidReason || ''
  };
  if (collection === 'billPayments') return {
    id: record.id, bill_id: record.billId, payment_method: record.paymentMethod || 'cash', amount: Number(record.amount || 0),
    reference_no: record.referenceNo || '', paid_by: record.paidBy || '', paid_at: record.paidAt || new Date().toISOString()
  };
  if (collection === 'reservationDeposits') return {
    id: record.id, reservation_id: record.reservationId || null, bill_id: record.billId || null, amount: Number(record.amount || 0),
    payment_method: record.paymentMethod || 'cash', status: record.status || 'Outstanding', created_at: record.createdAt || new Date().toISOString()
  };
  return { id: record.id, name: record.name, category: record.category, unit: record.unit, cost: record.cost, stock: record.stock, minimum: record.minimum };
}

function throwIfError(error) {
  if (error) throw new Error(error.message || 'The database operation failed.');
}

async function throwInvitationError(error) {
  let message = error.message || 'The invitation could not be sent.';
  let code = '';
  if (error.context && typeof error.context.clone === 'function') {
    try {
      const responseBody = await error.context.clone().json();
      if (typeof responseBody?.message === 'string') message = responseBody.message;
      else if (typeof responseBody?.error === 'string') message = responseBody.error;
      if (typeof responseBody?.code === 'string') code = responseBody.code;
    } catch {
      message = error.message || 'The invitation could not be sent.';
    }
  }
  const surfacedError = new Error(message);
  if (code) surfacedError.code = code;
  throw surfacedError;
}

async function withSaveTimeout(requestFactory, label, timeoutMs = POS_BILL_SAVE_TIMEOUT_MS) {
  const controller = new AbortController();
  let timeoutId;
  try {
    const request = requestFactory(controller.signal);
    const timeout = new Promise((resolve, reject) => {
      timeoutId = window.setTimeout(() => {
        controller.abort();
        reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
    });
    return await Promise.race([request, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function abortableRequest(request, signal) {
  return typeof request?.abortSignal === 'function' ? request.abortSignal(signal) : request;
}

function invokeUserManagementFunction(body, label) {
  return withSaveTimeout(
    signal => window.supabaseClient.functions.invoke('invite-user', { body, signal }),
    label,
    USER_MANAGEMENT_TIMEOUT_MS
  );
}

window.supabaseRecord = {
  async inviteUser({ email, fullName, role, verificationRecord = null }) {
    if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 160) {
      throw new TypeError('Full name must be between 1 and 160 characters.');
    }
    if (typeof email !== 'string' || !email.trim()) {
      throw new TypeError('A valid email address is required.');
    }
    if (!INVITABLE_USER_ROLES.includes(role)) {
      throw new TypeError('A valid staff role is required.');
    }
    const body = {
      action: 'invite',
      email: email.trim().toLowerCase(),
      full_name: fullName.trim(),
      role
    };
    if (verificationRecord !== null) body.verification_record = verificationRecord;
    const { data, error } = await invokeUserManagementFunction(
      body,
      'Invitation request'
    );
    if (error) await throwInvitationError(error);
    if (
      !data
      || typeof data.invitation_id !== 'string'
      || data.status !== 'Pending'
      || (verificationRecord !== null && typeof data.verification_record_id !== 'string')
    ) {
      throw new Error('The invitation service returned an invalid response.');
    }
    return data;
  },
  async uploadVerificationEvidence({ idImage, selfie }) {
    const allowedTypes = ['image/jpeg', 'image/png'];
    const isValidImage = image => image
      && typeof image.size === 'number'
      && image.size > 0
      && image.size <= 5 * 1024 * 1024
      && allowedTypes.includes(image.type);
    if (!isValidImage(idImage) || !isValidImage(selfie)) {
      throw new TypeError('Choose valid JPG or PNG ID and selfie images under 5 MB each.');
    }

    const { data: userData, error: userError } = await window.supabaseClient.auth.getUser();
    if (userError) throw userError;
    const actorId = userData.user?.id;
    const folderId = globalThis.crypto?.randomUUID?.();
    if (!actorId || !folderId) {
      throw new Error('A secure Administrator session is required to upload verification evidence.');
    }

    const idExtension = idImage.type === 'image/png' ? 'png' : 'jpg';
    const paths = [
      `${actorId}/${folderId}/id.${idExtension}`,
      `${actorId}/${folderId}/selfie.jpg`
    ];
    const files = [idImage, selfie];
    const storage = window.supabaseClient.storage.from('verification-evidence');
    const uploaded = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        const { error } = await withSaveTimeout(
          signal => abortableRequest(
            storage.upload(paths[index], files[index], {
              cacheControl: '3600',
              contentType: files[index].type,
              upsert: false
            }),
            signal
          ),
          'Verification image upload',
          USER_MANAGEMENT_TIMEOUT_MS
        );
        if (error) throw error;
        uploaded.push(paths[index]);
      }
    } catch (error) {
      if (uploaded.length) {
        const { error: cleanupError } = await withSaveTimeout(
          signal => abortableRequest(storage.remove(uploaded), signal),
          'Verification image cleanup',
          USER_MANAGEMENT_TIMEOUT_MS
        );
        if (cleanupError) {
          console.error('A partial verification image upload could not be removed.', cleanupError);
          throw new Error('A verification image upload failed and partial evidence cleanup needs Administrator review.');
        }
      }
      throw new Error(`Verification images could not be uploaded securely: ${error.message || 'storage request failed'}`);
    }

    return {
      id_image_path: paths[0],
      selfie_path: paths[1]
    };
  },
  async removeVerificationEvidence(paths) {
    if (!Array.isArray(paths) || paths.length === 0) return;
    const { data: userData, error: userError } = await window.supabaseClient.auth.getUser();
    if (userError) throw userError;
    const actorId = userData.user?.id;
    if (!actorId || paths.some(path =>
      typeof path !== 'string'
      || !path.startsWith(`${actorId}/`)
      || path.split('/').includes('..')
    )) {
      throw new TypeError('Only this Administrator’s verification evidence can be removed.');
    }
    const { error } = await withSaveTimeout(
      signal => abortableRequest(
        window.supabaseClient.storage.from('verification-evidence').remove(paths),
        signal
      ),
      'Verification image cleanup',
      USER_MANAGEMENT_TIMEOUT_MS
    );
    throwIfError(error);
  },
  async setUserAccountStatus(userId, accountStatus, reason = '') {
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new TypeError('A user account is required.');
    }
    if (!['Active', 'Deactivated'].includes(accountStatus)) {
      throw new TypeError('A valid user account status is required.');
    }
    if (typeof reason !== 'string' || reason.length > 500) {
      throw new TypeError('The account status reason must be 500 characters or fewer.');
    }
    if (accountStatus === 'Deactivated' && !reason.trim()) {
      throw new TypeError('A reason is required to deactivate a user.');
    }
    const action = accountStatus === 'Deactivated' ? 'deactivate' : 'reactivate';
    const { data, error } = await invokeUserManagementFunction(
      { action, user_id: userId, reason: reason.trim() },
      'Account status update'
    );
    if (error) await throwInvitationError(error);
    if (!data || data.status !== accountStatus) {
      throw new Error('The account management service returned an invalid response.');
    }
    return data;
  },
  async resendUserInvitation(invitationId) {
    if (typeof invitationId !== 'string' || !invitationId.trim()) {
      throw new TypeError('An invitation is required.');
    }
    const { data, error } = await invokeUserManagementFunction(
      { action: 'resend', invitation_id: invitationId },
      'Invitation resend'
    );
    if (error) await throwInvitationError(error);
    if (
      !data
      || data.invitation_id !== invitationId
      || data.status !== 'Pending'
      || typeof data.expires_at !== 'string'
    ) {
      throw new Error('The invitation management service returned an invalid resend response.');
    }
    return data;
  },
  async cancelUserInvitation(invitationId) {
    if (typeof invitationId !== 'string' || !invitationId.trim()) {
      throw new TypeError('An invitation is required.');
    }
    const { data, error } = await invokeUserManagementFunction(
      { action: 'cancel', invitation_id: invitationId },
      'Invitation cancellation'
    );
    if (error) await throwInvitationError(error);
    if (
      !data
      || data.status !== 'Cancelled'
      || typeof data.account_removed !== 'boolean'
      || (data.account_blocked !== undefined && typeof data.account_blocked !== 'boolean')
    ) {
      throw new Error('The invitation management service returned an invalid response.');
    }
    return data;
  },
  async loadUserInvites() {
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(
        window.supabaseClient
          .from('user_invites')
          .select('id,email,full_name,role,status,invited_at,accepted_at,expires_at,invited_by')
          .order('invited_at', { ascending: false }),
        signal
      ),
      'Invitation history load',
      USER_MANAGEMENT_TIMEOUT_MS
    );
    throwIfError(error);
    if (!Array.isArray(data) || data.some(invite =>
      !invite
      || typeof invite.id !== 'string'
      || typeof invite.email !== 'string'
      || typeof invite.full_name !== 'string'
      || typeof invite.role !== 'string'
      || !['Pending', 'Accepted', 'Expired', 'Cancelled'].includes(invite.status)
      || typeof invite.invited_at !== 'string'
      || typeof invite.invited_by !== 'string'
      || typeof invite.expires_at !== 'string'
      || Number.isNaN(new Date(invite.expires_at).getTime())
      || (invite.accepted_at !== null && typeof invite.accepted_at !== 'string')
    )) {
      throw new Error('The database returned invalid invitation history.');
    }
    return data;
  },
  async loadVerificationRecords(search = '') {
    const normalizedSearch = String(search || '').trim();
    let query = window.supabaseClient
      .from('verification_records')
      .select([
        'id',
        'applicant_name',
        'id_type',
        'id_number_masked',
        'ocr_summary',
        'face_match_score',
        'face_match_result',
        'override_used',
        'override_reason',
        'verified_by',
        'verified_at',
        'role_assigned',
        'assigned_by',
        'assigned_at',
        'invitation_id',
        'profile_id',
        'id_image_path',
        'selfie_path',
        'consent_given',
        'consent_at',
        'final_status',
        'created_at',
        'retention_until',
        'supersedes_id'
      ].join(','))
      .order('verified_at', { ascending: false })
      .limit(1000);
    if (normalizedSearch) {
      query = query.ilike('applicant_name', `%${normalizedSearch}%`);
    }
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(query, signal),
      'Verification records load',
      USER_MANAGEMENT_TIMEOUT_MS
    );
    throwIfError(error);
    if (!Array.isArray(data) || data.some(record =>
      !record
      || typeof record.id !== 'string'
      || typeof record.applicant_name !== 'string'
      || typeof record.id_type !== 'string'
      || (record.id_number_masked !== null
        && (typeof record.id_number_masked !== 'string'
          || !/^\*{4}[A-Za-z0-9]{1,4}$/.test(record.id_number_masked)))
      || !record.ocr_summary
      || typeof record.ocr_summary !== 'object'
      || Object.prototype.hasOwnProperty.call(record.ocr_summary, 'id_number')
      || !['match', 'no_match', 'unable'].includes(record.face_match_result)
      || !['Approved', 'Rejected', 'Cancelled'].includes(record.final_status)
      || typeof record.verified_by !== 'string'
      || typeof record.verified_at !== 'string'
      || (record.role_assigned !== null && typeof record.role_assigned !== 'string')
    )) {
      throw new Error('The database returned invalid verification records.');
    }
    return data;
  },
  async updateUserRole(userId, role, reason = '') {
    if (typeof reason !== 'string' || reason.length > 500) {
      throw new TypeError('The role-change reason must be 500 characters or fewer.');
    }
    if (!reason.trim()) {
      throw new TypeError('A reason is required to change a user role.');
    }
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(window.supabaseClient.rpc('costtrack_update_profile_role', {
        p_user_id: userId,
        p_new_role: role,
        p_reason: reason
      }), signal),
      'Role update',
      USER_MANAGEMENT_TIMEOUT_MS
    );
    throwIfError(error);
    if (typeof data !== 'boolean') {
      throw new Error('The database returned an invalid role update result.');
    }
    return data;
  },
  async wasteServerTime() {
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(window.supabaseClient.rpc('costtrack_waste_server_time'), signal),
      'Server time request'
    );
    throwIfError(error);
    if (typeof data !== 'string' || Number.isNaN(new Date(data).getTime())) {
      throw new Error('The database returned an invalid server timestamp.');
    }
    return data;
  },
  async loadProductFormOptions() {
    const client = window.supabaseClient;
    const [categories, units, suppliers] = await Promise.all([
      client.from('product_categories').select('name').eq('is_active', true).order('name'),
      client.from('units').select('name,abbreviation').eq('is_active', true).order('name'),
      client.from('suppliers').select('name').eq('is_active', true).order('name')
    ]);
    throwIfError(categories.error);
    throwIfError(units.error);
    throwIfError(suppliers.error);
    return {
      categories: (categories.data || []).map(item => item.name),
      units: units.data || [],
      suppliers: (suppliers.data || []).map(item => item.name)
    };
  },
  async productLifecycle(action, productId, reason = '') {
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(window.supabaseClient.rpc('costtrack_product_lifecycle', {
        action_value: action,
        product_id_value: productId,
        reason_value: reason || null
      }), signal),
      'Product lifecycle action'
    );
    throwIfError(error);
    if (!data || typeof data !== 'object') {
      throw new Error('The database returned an invalid product lifecycle result.');
    }
    if (action === 'inspect') {
      const validUsage = data.usage && typeof data.usage === 'object' && !Array.isArray(data.usage);
      if ((data.action !== undefined && data.action !== action)
        || data.product_id !== productId
        || typeof data.is_active !== 'boolean'
        || typeof data.is_used !== 'boolean'
        || !validUsage
        || !Array.isArray(data.active_recipes)) {
        throw new Error('The database returned an invalid product lifecycle inspection result.');
      }
    } else if (data.action !== action) {
      throw new Error('The database returned an unexpected product lifecycle action.');
    }
    if (data.action === 'delete') recordVersions.delete(`ingredients:${productId}`);
    else if (data.updated_at) rememberVersion('ingredients', productId, data.updated_at);
    return data;
  },
  async notificationReadKeys() {
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(
        window.supabaseClient.rpc('costtrack_notification_read_keys'),
        signal
      ),
      'Notification state request'
    );
    throwIfError(error);
    if (!Array.isArray(data) || data.some(key => typeof key !== 'string')) {
      throw new Error('The database returned invalid notification read state.');
    }
    return data;
  },
  async markNotificationsRead(notificationKeys) {
    if (!Array.isArray(notificationKeys) || notificationKeys.some(key => typeof key !== 'string')) {
      throw new TypeError('Notification keys must be an array of strings.');
    }
    if (!notificationKeys.length) return 0;
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(window.supabaseClient.rpc('costtrack_mark_notifications_read', {
        p_notification_keys: notificationKeys
      }), signal),
      'Mark notifications read'
    );
    throwIfError(error);
    if (!Number.isInteger(data) || data < 0) {
      throw new Error('The database returned an invalid notification update count.');
    }
    return data;
  },
  async markTableAvailable(tableId) {
    if (typeof tableId !== 'string' || !tableId.trim()) {
      throw new TypeError('A table is required.');
    }
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(
        window.supabaseClient.rpc('costtrack_mark_table_clean', { p_table_id: tableId }),
        signal
      ),
      'Mark table available'
    );
    throwIfError(error);
    if (data !== true) {
      throw new Error('The database returned an invalid table-cleaning result.');
    }
    return data;
  },
  async load(collection) {
    const table = tableForCollection[collection];
    if (!table) throw new Error(`Unknown data collection: ${collection}`);
    const client = window.supabaseClient;
    let result;
    if (collection === 'users') {
      result = await withSaveTimeout(
        signal => abortableRequest(
          client.from('profiles')
            .select('id,email,full_name,role,account_status,updated_at')
            .in('account_status', ['Active', 'Deactivated'])
            .order('full_name'),
          signal
        ),
        'Staff list load',
        USER_MANAGEMENT_TIMEOUT_MS
      );
    } else if (collection === 'auditLogs') {
      const { data: authData, error: authError } = await client.auth.getUser();
      throwIfError(authError);
      const actorId = authData?.user?.id;
      if (!actorId) throw new Error('Your signed-in user could not be identified for the activity log.');
      result = await client.from(table)
        .select('id,actor_id,table_name,record_id,action,occurred_at')
        .eq('actor_id', actorId)
        .order('occurred_at', { ascending: false });
    } else if (collection === 'ingredients') {
      const { data, error } = await client.rpc('costtrack_load_products');
      throwIfError(error);
      return (data || []).map(row => mapDatabaseRecord(collection, row));
    } else if (collection === 'recipes') {
      const { data, error } = await client.rpc('costtrack_load_recipes');
      throwIfError(error);
      return (data || []).map(row => mapDatabaseRecord(collection, row));
    } else {
      result = await client.from(table).select('*');
    }
    throwIfError(result.error);
    return (result.data || []).map(row => mapDatabaseRecord(collection, row));
  },
  async loadRecord(collection, recordId) {
    const table = tableForCollection[collection];
    if (!table) throw new Error(`Unknown data collection: ${collection}`);
    const { data, error } = await window.supabaseClient
      .from(table)
      .select('*')
      .eq('id', recordId)
      .maybeSingle();
    throwIfError(error);
    return data ? mapDatabaseRecord(collection, data) : null;
  },
  async loadRelated(collection, relation, relatedId) {
    const table = tableForCollection[collection];
    const relationColumns = {
      billLines: { billId: 'bill_id' },
      billPayments: { billId: 'bill_id' },
      cashMovements: { shiftId: 'shift_id' },
      reservationDeposits: { reservationId: 'reservation_id' }
    };
    const column = relationColumns[collection]?.[relation];
    if (!table || !column) throw new Error(`Unsupported related-data query: ${collection}.${relation}`);
    const { data, error } = await window.supabaseClient
      .from(table)
      .select('*')
      .eq(column, relatedId);
    throwIfError(error);
    return (data || []).map(row => mapDatabaseRecord(collection, row));
  },
  mapRecord(collection, row) {
    return row ? mapDatabaseRecord(collection, row) : null;
  },
  async upsert(collection, record, expectedVersion) {
    if (collection === 'users') throw new Error('User accounts must be provisioned through Supabase Auth.');
    const table = tableForCollection[collection];
    if (!table) throw new Error(`Unknown data collection: ${collection}`);
    const row = mapApplicationRecord(collection, record);
    if (collection === 'wasteLogs') {
      const { data, error } = await withSaveTimeout(
        signal => abortableRequest(window.supabaseClient.rpc('costtrack_log_waste', { payload: row }), signal),
        'Waste save'
      );
      throwIfError(error);
      if (data?.updated_at) rememberVersion(collection, record.id, data.updated_at);
      return data?.ingredient_id
        ? mapDatabaseRecord(collection, data)
        : { ...record, updatedAt: data?.updated_at || record.updatedAt };
    }
    if (collection === 'preparedFoodWasteLogs') {
      const { data, error } = await withSaveTimeout(
        signal => abortableRequest(window.supabaseClient.rpc('costtrack_log_prepared_food_waste', { payload: row }), signal),
        'Prepared-food waste save'
      );
      throwIfError(error);
      return data?.id ? mapDatabaseRecord(collection, data) : record;
    }
    const dateColumn = {
      inventoryTransactions: 'transaction_date', productionLogs: 'production_date',
      wasteLogs: 'waste_date', preparedFoodWasteLogs: 'waste_date', physicalCounts: 'count_date',
      revenueRecords: 'business_date', reservations: 'reservation_date'
    }[collection];
    if (dateColumn && !row[dateColumn]) throw new Error('Enter a valid date before saving.');
    const versionKey = `${collection}:${record.id}`;
    const storedVersion = recordVersions.get(versionKey);
    const version = expectedVersion === undefined ? storedVersion : expectedVersion;
    let result;
    if (collection === 'ingredients') {
      if (version == null && storedVersion) throw new Error('This product changed in another session. Reload the page before saving your change.');
      const { data, error } = await withSaveTimeout(
        signal => abortableRequest(window.supabaseClient.rpc('costtrack_save_product', {
          payload: row,
          expected_updated_at: version || null
        }), signal),
        'Product save'
      );
      throwIfError(error);
      if (data?.updated_at) rememberVersion(collection, record.id, data.updated_at);
      return data ? mapDatabaseRecord(collection, data) : record;
    }
    if (collection === 'recipes') {
      if (version == null && storedVersion) throw new Error('This recipe changed in another session. Reload the page before saving your change.');
      const { data, error } = await withSaveTimeout(
        signal => abortableRequest(window.supabaseClient.rpc('save_recipe', {
          payload: {
            ...row,
            ingredients: row.ingredients.map(line => ({
              ingredient_id: line.ingredientId,
              quantity: line.quantity
            }))
          },
          expected_updated_at: version || null
        }), signal),
        'Recipe save'
      );
      throwIfError(error);
      if (data?.updated_at) rememberVersion(collection, record.id, data.updated_at);
      return data ? mapDatabaseRecord(collection, data) : record;
    }
    if (version) {
      result = await withSaveTimeout(signal => abortableRequest(
        window.supabaseClient.from(table).update(row).eq('id', record.id).eq('updated_at', version).select('updated_at').maybeSingle(),
        signal
      ), 'Record save');
      throwIfError(result.error);
      if (!result.data) throw new Error('This record changed in another session. Reload the page before saving your change.');
    } else {
      if (storedVersion) throw new Error('This record changed in another session. Reload the page before saving your change.');
      result = await withSaveTimeout(signal => abortableRequest(
        window.supabaseClient.from(table).insert(row).select('updated_at').single(),
        signal
      ), 'Record save');
      throwIfError(result.error);
    }
    rememberVersion(collection, record.id, result.data.updated_at);
    return { ...record, updatedAt: result.data.updated_at };
  },
  async remove(collection, recordId, expectedVersion) {
    if (collection === 'users') throw new Error('User accounts must be managed through Supabase Auth.');
    const table = tableForCollection[collection];
    if (!table) throw new Error(`Unknown data collection: ${collection}`);
    const storedVersion = recordVersions.get(`${collection}:${recordId}`);
    const version = expectedVersion === undefined ? storedVersion : expectedVersion;
    if (version == null && storedVersion) throw new Error('This record changed in another session. Reload the page before deleting it.');
    let request = window.supabaseClient.from(table).delete().eq('id', recordId);
    if (version) request = request.eq('updated_at', version);
    const { data, error } = await request.select('id');
    throwIfError(error);
    if (!data?.length) throw new Error('This record changed or is no longer available. Reload the page and try again.');
    recordVersions.delete(`${collection}:${recordId}`);
  },
  async submitPublicReservation(payload) {
    const { data, error } = await window.supabaseClient.rpc('public_create_reservation', {
      payload: {
        ...payload,
        reservation_date: payload.date,
        reservation_time: payload.time,
        adults: payload.adults ?? payload.guests,
        senior_pwd_count: payload.seniorPwdCount ?? payload.senior_pwd_count ?? 0,
        children: payload.children ?? 0
      }
    });
    throwIfError(error);
    return data;
  },
  async sendPublicReservationReference(reference, email) {
    const { data, error } = await window.supabaseClient.functions.invoke(
      'send-reservation-email',
      { body: { reference, email } }
    );
    throwIfError(error);
    if (!data || data.sent !== true) {
      throw new Error('The reservation email service returned an invalid response.');
    }
    return true;
  },
  async getPublicReservationStatus(reference, contact) {
    const { data, error } = await window.supabaseClient.rpc('public_get_reservation_status', {
      reference,
      contact
    });
    throwIfError(error);
    return data;
  },
  async reportAnalytics(reportKey, startDate, endDate, groupBy, includeWaste) {
    const { data, error } = await window.supabaseClient.rpc('report_analytics', {
      report_key: reportKey,
      start_date: startDate,
      end_date: endDate,
      group_by: groupBy || 'day',
      include_waste: includeWaste !== false
    });
    throwIfError(error);
    return data || {};
  },
  async posRevenueReport(reportKey, startDate, endDate, groupBy, includeWaste, page, pageSize) {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId;
    try {
      const request = window.supabaseClient.rpc('pos_revenue_report', {
        p_report_key: reportKey,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_group_by: groupBy || 'day',
        p_include_waste: includeWaste !== false,
        p_page: page || 1,
        p_page_size: pageSize || 100
      }).abortSignal(controller.signal);
      const timeout = new Promise((resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error('POS revenue report timed out after 15 seconds.'));
        }, POS_BILL_SAVE_TIMEOUT_MS);
      });
      const { data, error } = await Promise.race([request, timeout]);
      throwIfError(error);
      return data || {};
    } catch (error) {
      if (timedOut) {
        throw new Error('POS revenue report timed out after 15 seconds. Retry loading the report.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  },
  async receiveDelivery(payload) {
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(window.supabaseClient.rpc('costtrack_receive_delivery', {
        payload: {
          supplier_name: payload.supplierName,
          invoice_number: payload.invoiceNumber,
          invoice_date: dateValue(payload.invoiceDate),
          received_date: dateValue(payload.receivedDate),
          note: payload.note || '',
          lines: payload.lines.map(line => ({
            id: line.id,
            ingredient_id: line.ingredientId,
            quantity: line.quantity,
            unit_cost: line.unitCost,
            batch_code: line.batchCode || null,
            expiration_date: line.expirationDate ? dateValue(line.expirationDate) : null
          }))
        }
      }), signal),
      'Delivery save'
    );
    throwIfError(error);
    return data;
  },
  async getExpectedCovers(serviceDate, mealPeriod) {
    const { data, error } = await window.supabaseClient.rpc('get_expected_covers', {
      service_date: serviceDate,
      meal_period: mealPeriod || null
    });
    throwIfError(error);
    return Array.isArray(data) ? data[0] || {} : data || {};
  },
  async loadProductionBatches(serviceDate) {
    const { data, error } = await window.supabaseClient.rpc('costtrack_load_production_batches', {
      service_date_value: dateValue(serviceDate)
    });
    throwIfError(error);
    return (data || []).map(row => ({
      id: row.id,
      recipeId: row.recipe_id,
      serviceDate: row.service_date,
      batchNumber: Number(row.batch_number),
      batchCount: Number(row.batch_count),
      batchYield: Number(row.batch_yield),
      expectedCovers: Number(row.expected_covers),
      prepTarget: Number(row.prep_target),
      status: row.status,
      startedAt: row.started_at,
      startedBy: row.started_by,
      readyAt: row.ready_at,
      readyBy: row.ready_by,
      productionLogId: row.production_log_id,
      recipeName: row.recipe_name,
      category: row.category
    }));
  },
  async startProductionBatches(recipeId, serviceDate, batchIds) {
    const { data, error } = await window.supabaseClient.rpc('costtrack_start_production_batches', {
      recipe_id_value: recipeId,
      service_date_value: dateValue(serviceDate),
      batch_ids: batchIds
    });
    throwIfError(error);
    return data || [];
  },
  async loadProductionHistory(startDate, endDate) {
    const { data, error } = await window.supabaseClient.rpc('costtrack_load_production_history', {
      start_date_value: dateValue(startDate),
      end_date_value: dateValue(endDate)
    });
    throwIfError(error);
    return (data || []).map(row => ({
      id: row.id,
      recipeId: row.recipe_id,
      serviceDate: row.service_date,
      batchNumber: Number(row.batch_number),
      portions: Number(row.portions),
      status: row.status,
      startedAt: row.started_at,
      readyAt: row.ready_at,
      productionLogId: row.production_log_id,
      recipeName: row.recipe_name,
      category: row.category,
      legacyTimeUnknown: Boolean(row.legacy_time_unknown)
    }));
  },
  async completeProductionBatch(batchId) {
    const { data, error } = await window.supabaseClient.rpc('costtrack_complete_production_batch', {
      batch_id_value: batchId
    });
    throwIfError(error);
    return data;
  },
  async posSaveBill(payload) {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId;
    try {
      const request = window.supabaseClient.rpc('pos_save_bill_phase3', {
        p_bill_id: payload.billId || null,
        p_customer_name: payload.customerName,
        p_notes: payload.notes || '',
        p_reservation_id: payload.reservationId || null,
        p_adult_count: payload.adultCount,
        p_senior_count: payload.seniorCount,
        p_kids_count: payload.kidsCount,
        p_comped_count: payload.compedCount,
        p_discount_id: payload.discountId || null,
        p_discount_reason: payload.discountReason || '',
        p_extra_lines: payload.extraLines || [],
        p_idempotency_key: payload.idempotencyKey || null,
        p_table_id: payload.tableId || null,
        p_charge_extra_pax: Boolean(payload.chargeExtraPax)
      }).abortSignal(controller.signal);
      const timeout = new Promise((resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error('Bill save timed out after 15 seconds.'));
        }, POS_BILL_SAVE_TIMEOUT_MS);
      });
      const { data, error } = await Promise.race([request, timeout]);
      throwIfError(error);
      return data;
    } catch (error) {
      if (timedOut) {
        throw new Error('Bill save timed out after 15 seconds. The server may still finish the request. Retry from this same form to reuse its idempotency key, or reload the bill list before starting another bill.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  },
  async posSeatAndOpenWalkIn(payload) {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId;
    try {
      const request = window.supabaseClient.rpc('pos_seat_and_open_walkin', {
        p_customer_name: payload.customerName || 'Walk-in guest',
        p_phone: payload.phone || '',
        p_email: payload.email || '',
        p_reservation_date: payload.date,
        p_reservation_time: payload.time,
        p_table_id: payload.tableId,
        p_adult_count: payload.adultCount,
        p_senior_count: payload.seniorCount,
        p_kids_count: payload.kidsCount,
        p_notes: payload.notes || '',
        p_idempotency_key: payload.idempotencyKey
      }).abortSignal(controller.signal);
      const timeout = new Promise((resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error('Walk-in seat-and-bill request timed out after 15 seconds.'));
        }, POS_BILL_SAVE_TIMEOUT_MS);
      });
      const { data, error } = await Promise.race([request, timeout]);
      throwIfError(error);
      return data;
    } catch (error) {
      if (timedOut) {
        throw new Error('Walk-in seat-and-bill request timed out after 15 seconds. The server may still finish it. Retry from this same form to reuse its idempotency key, or reload the Walk-in and bill lists before starting another request.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  },
  async posCloseBill(billId, tenderedAmount, idempotencyKey) {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId;
    try {
      const request = window.supabaseClient.rpc('pos_close_bill_phase3', {
        p_bill_id: billId,
        p_tendered_amount: tenderedAmount,
        p_idempotency_key: idempotencyKey
      }).abortSignal(controller.signal);
      const timeout = new Promise((resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error('Bill close timed out after 15 seconds.'));
        }, POS_BILL_SAVE_TIMEOUT_MS);
      });
      const { data, error } = await Promise.race([request, timeout]);
      throwIfError(error);
      return data;
    } catch (error) {
      if (timedOut) {
        throw new Error('Bill close timed out after 15 seconds. The server may still finish it. Retry from this same payment form to reuse its idempotency key, or reload Cashier and check the bill status before retrying.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  },
  async posListUnresolvedStaleBookings() {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId;
    try {
      const request = window.supabaseClient
        .rpc('pos_list_unresolved_stale_bookings')
        .abortSignal(controller.signal);
      const timeout = new Promise((resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error('Unresolved bookings request timed out after 15 seconds.'));
        }, POS_BILL_SAVE_TIMEOUT_MS);
      });
      const { data, error } = await Promise.race([request, timeout]);
      throwIfError(error);
      const rows = data || [];
      if (!Array.isArray(rows)) {
        throw new Error('Unresolved bookings response is not a list.');
      }
      return rows.map((row, index) => {
        const reservationId = [row?.reservation_id, row?.reservationId, row?.id]
          .map(value => String(value ?? '').trim())
          .find(Boolean);
        if (!reservationId) {
          throw new Error(`Unresolved booking row ${index + 1} is missing a reservation ID.`);
        }
        return { ...row, reservation_id: reservationId };
      });
    } catch (error) {
      if (timedOut) {
        throw new Error('Unresolved bookings request timed out after 15 seconds. Retry loading the list.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  },
  async posResolveStaleBooking(payload) {
    const reservationId = String(payload?.reservationId || '').trim();
    if (!reservationId) throw new Error('A reservation ID is required.');
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId;
    try {
      const request = window.supabaseClient.rpc('pos_resolve_stale_booking', {
        p_reservation_id: reservationId,
        p_outcome: payload.outcome,
        p_reason: payload.reason,
        p_confirm_no_meal: payload.confirmNoMeal,
        p_deposit_action: payload.depositAction || null,
        p_deposit_reason: payload.depositReason || '',
        p_idempotency_key: payload.idempotencyKey
      }).abortSignal(controller.signal);
      const timeout = new Promise((resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error('Stale booking resolution timed out after 15 seconds.'));
        }, POS_BILL_SAVE_TIMEOUT_MS);
      });
      const { data, error } = await Promise.race([request, timeout]);
      throwIfError(error);
      return data;
    } catch (error) {
      if (timedOut) {
        throw new Error('Stale booking resolution timed out after 15 seconds. The server may still finish it. Retry from this same dialog to reuse its idempotency key, or reload the Unresolved list before starting another resolution.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  },
  async posRequestBillVoid(billId, reason) {
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(window.supabaseClient.rpc('pos_request_bill_void_phase3', {
        p_bill_id: billId,
        p_reason: reason
      }), signal),
      'Void request'
    );
    throwIfError(error);
    return data;
  },
  async posDecideBillApproval(approvalId, decision, reason) {
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(window.supabaseClient.rpc('pos_decide_bill_approval_phase3', {
        p_approval_id: approvalId,
        p_decision: decision,
        p_decision_reason: reason || ''
      }), signal),
      'Approval save'
    );
    throwIfError(error);
    return data;
  },
  async posOpenShift(openingCash, notes) {
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(window.supabaseClient.rpc('pos_open_shift', {
        p_opening_cash: openingCash, p_notes: notes || ''
      }), signal),
      'Shift save'
    );
    throwIfError(error);
    return data;
  },
  async posShiftSummary(shiftId) {
    const { data, error } = await window.supabaseClient.rpc('pos_shift_summary', {
      p_shift_id: shiftId
    });
    throwIfError(error);
    return data;
  },
  async posCloseShift(shiftId, countedCash, notes) {
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(window.supabaseClient.rpc('pos_close_shift', {
        p_shift_id: shiftId, p_counted_cash: countedCash, p_notes: notes || ''
      }), signal),
      'Shift close'
    );
    throwIfError(error);
    return data;
  },
  async posRecordCashMovement(shiftId, movementType, amount, reason, idempotencyKey) {
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(window.supabaseClient.rpc('pos_record_cash_movement', {
        p_shift_id: shiftId, p_movement_type: movementType,
        p_amount: amount, p_reason: reason, p_idempotency_key: idempotencyKey
      }), signal),
      'Cash movement save'
    );
    throwIfError(error);
    return data;
  },
  async posRecordReservationDeposit(reservationId, amount, notes, idempotencyKey) {
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(window.supabaseClient.rpc('pos_record_reservation_deposit', {
        p_reservation_id: reservationId, p_amount: amount, p_notes: notes || '',
        p_idempotency_key: idempotencyKey
      }), signal),
      'Deposit save'
    );
    throwIfError(error);
    return data;
  },
  async posReservationDepositDecision(depositId, decision, reason) {
    const { data, error } = await withSaveTimeout(
      signal => abortableRequest(window.supabaseClient.rpc('pos_reservation_deposit_decision', {
        p_deposit_id: depositId, p_decision: decision, p_reason: reason
      }), signal),
      'Deposit action'
    );
    throwIfError(error);
    return data;
  },
  async posReservationDepositHistory(reservationId) {
    const { data, error } = await window.supabaseClient.rpc('pos_reservation_deposit_history', {
      p_reservation_id: reservationId
    });
    throwIfError(error);
    return data || { deposits: [], actions: [] };
  },
  async posBillClosePreview(billId) {
    const { data, error } = await window.supabaseClient.rpc('pos_bill_close_preview', {
      p_bill_id: billId
    });
    throwIfError(error);
    return data;
  },
  async posRefreshNotifications() {
    const { data, error } = await window.supabaseClient.rpc('pos_refresh_notifications');
    throwIfError(error);
    return data;
  },
  version(collection, recordId) {
    return recordVersions.get(`${collection}:${recordId}`) || null;
  },
  clearVersions() {
    recordVersions.clear();
  }
};
