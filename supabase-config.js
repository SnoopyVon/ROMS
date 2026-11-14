const SUPABASE_URL = 'https://niiodqunoflblfcgdods.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_IVE25Rqzu-lDLFayVYmhfQ_dvPIO6E5';

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
  productionLogs: 'production_logs',
  revenueRecords: 'revenue_records',
  wasteLogs: 'waste_logs',
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
  billApprovals: 'pos_bill_approvals'
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
  const updatedAt = row.updated_at;
  if (collection === 'users') {
    rememberVersion(collection, row.id, updatedAt);
    return { id: row.id, name: row.full_name, email: row.email, role: row.role };
  }
  rememberVersion(collection, row.id, updatedAt);
  if (collection === 'recipes') {
    return {
      id: row.id, name: row.name, category: row.category,
      price: row.menu_price == null ? null : Number(row.menu_price),
      wastage: row.wastage == null ? null : Number(row.wastage),
      batchYield: Number(row.batch_yield || 30),
      prepTarget: Number(row.prep_target || 30),
      prepNotes: row.prep_notes || '',
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
  if (collection === 'productionLogs') {
    return { id: row.id, recipeId: row.recipe_id, quantity: Number(row.quantity), coversProduced: row.covers_produced == null ? null : Number(row.covers_produced), date: row.production_date, mode: row.mode };
  }
  if (collection === 'wasteLogs') {
    return {
      id: row.id, ingredientId: row.ingredient_id, quantity: Number(row.quantity),
      reason: row.reason, date: row.waste_date, productionLogId: row.production_log_id || null,
      recordedAt: row.recorded_at || null, recordedBy: row.recorded_by || null, notes: row.notes || ''
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
      adults: row.adults, children: row.children, occasion: row.occasion,
      status: row.status, preference: row.preference, request: row.request,
      table: row.table_id, type: row.type, seatedAt: row.seated_at, completedAt: row.completed_at,
      actualCovers: row.actual_covers, correctionReason: row.last_correction_reason || ''
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
      declaredCash: Number(row.declared_cash || 0), notes: row.notes || ''
    };
  }
  if (collection === 'cashMovements') {
    return {
      id: row.id, shiftId: row.shift_id, movementType: row.movement_type, amount: Number(row.amount || 0),
      reason: row.reason || '', reference: row.reference || '', createdBy: row.created_by, createdAt: row.created_at
    };
  }
  if (collection === 'posBills') {
    return {
      id: row.id, billNumber: row.bill_number, reservationId: row.reservation_id,
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
      paidBy: row.paid_by || '', paidAt: row.paid_at || null
    };
  }
  if (collection === 'reservationDeposits') {
    return {
      id: row.id, reservationId: row.reservation_id, billId: row.bill_id, amount: Number(row.amount || 0),
      paymentMethod: row.payment_method, status: row.status, createdAt: row.created_at
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
  return {
    id: row.id, name: row.name, category: row.category, unit: row.unit,
    cost: row.cost == null ? null : Number(row.cost), stock: Number(row.stock), minimum: Number(row.minimum),
    preferredSupplier: row.preferred_supplier || '', trackExpiry: Boolean(row.track_expiry), notes: row.notes || ''
  };
}

function mapApplicationRecord(collection, record) {
  if (collection === 'ingredients') return {
    id: record.id, name: record.name, category: record.category, unit: record.unit,
    cost: record.cost, stock: record.stock, minimum: record.minimum,
    preferred_supplier: record.preferredSupplier || '', track_expiry: record.trackExpiry === true,
    notes: record.notes || ''
  };
  if (collection === 'recipes') return {
    id: record.id, name: record.name, category: record.category,
    menu_price: record.price, wastage: record.wastage,
    batch_yield: record.batchYield, prep_target: record.prepTarget,
    prep_notes: record.prepNotes || '', ingredients: record.ingredients
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
  if (collection === 'productionLogs') return { id: record.id, recipe_id: record.recipeId, quantity: record.quantity, covers_produced: record.coversProduced == null ? null : record.coversProduced, production_date: dateValue(record.date), mode: record.mode };
  if (collection === 'wasteLogs') return {
    id: record.id, ingredient_id: record.ingredientId, quantity: record.quantity,
    reason: record.reason, waste_date: dateValue(record.date),
    production_log_id: record.productionLogId || null,
    recorded_at: record.recordedAt || new Date().toISOString(), notes: record.notes || ''
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
    reservation_date: dateValue(record.date), reservation_time: record.time, guests: Number(record.guests || 0),
    adults: record.adults === undefined ? Number(record.guests || 0) : Number(record.adults), children: Number(record.children || 0),
    occasion: record.occasion || '', status: record.status || 'Pending', preference: record.preference || '',
    request: record.request || record.requests || '', table_id: record.table || null,
    type: record.type || 'Reservation', seated_at: record.seatedAt || null, completed_at: record.completedAt || null,
    actual_covers: record.actualCovers == null ? null : record.actualCovers,
    last_correction_reason: record.correctionReason || ''
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

window.supabaseRecord = {
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
  async load(collection) {
    const table = tableForCollection[collection];
    if (!table) throw new Error(`Unknown data collection: ${collection}`);
    const client = window.supabaseClient;
    let result;
    if (collection === 'users') {
      result = await client.from('profiles').select('id,email,full_name,role,updated_at').order('full_name');
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
  async upsert(collection, record, expectedVersion) {
    if (collection === 'users') throw new Error('User accounts must be provisioned through Supabase Auth.');
    const table = tableForCollection[collection];
    if (!table) throw new Error(`Unknown data collection: ${collection}`);
    const row = mapApplicationRecord(collection, record);
    if (collection === 'wasteLogs') {
      const { data, error } = await window.supabaseClient.rpc('costtrack_log_waste', { payload: row });
      throwIfError(error);
      if (data?.updated_at) rememberVersion(collection, record.id, data.updated_at);
      return;
    }
    const dateColumn = {
      inventoryTransactions: 'transaction_date', productionLogs: 'production_date',
      wasteLogs: 'waste_date', physicalCounts: 'count_date',
      revenueRecords: 'business_date', reservations: 'reservation_date'
    }[collection];
    if (dateColumn && !row[dateColumn]) throw new Error('Enter a valid date before saving.');
    const versionKey = `${collection}:${record.id}`;
    const storedVersion = recordVersions.get(versionKey);
    const version = expectedVersion === undefined ? storedVersion : expectedVersion;
    let result;
    if (collection === 'ingredients') {
      if (version == null && storedVersion) throw new Error('This product changed in another session. Reload the page before saving your change.');
      const { data, error } = await window.supabaseClient.rpc('costtrack_save_product', {
        payload: row,
        expected_updated_at: version || null
      });
      throwIfError(error);
      if (data?.updated_at) rememberVersion(collection, record.id, data.updated_at);
      return;
    }
    if (collection === 'recipes') {
      if (version == null && storedVersion) throw new Error('This recipe changed in another session. Reload the page before saving your change.');
      const { data, error } = await window.supabaseClient.rpc('save_recipe', {
        payload: {
          ...row,
          ingredients: row.ingredients.map(line => ({
            ingredient_id: line.ingredientId,
            quantity: line.quantity
          }))
        },
        expected_updated_at: version || null
      });
      throwIfError(error);
      if (data?.updated_at) rememberVersion(collection, record.id, data.updated_at);
      return;
    }
    if (version) {
      result = await window.supabaseClient.from(table).update(row).eq('id', record.id).eq('updated_at', version).select('updated_at').maybeSingle();
      throwIfError(result.error);
      if (!result.data) throw new Error('This record changed in another session. Reload the page before saving your change.');
    } else {
      if (storedVersion) throw new Error('This record changed in another session. Reload the page before saving your change.');
      result = await window.supabaseClient.from(table).insert(row).select('updated_at').single();
      throwIfError(result.error);
    }
    rememberVersion(collection, record.id, result.data.updated_at);
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
        children: payload.children ?? 0
      }
    });
    throwIfError(error);
    return data;
  },
  async getPublicReservationStatus(reference, contact) {
    const { data, error } = await window.supabaseClient.rpc('public_get_reservation_status', {
      reference,
      contact
    });
    throwIfError(error);
    return data;
  },
  async createRevenueDraft(reservationId) {
    const { data, error } = await window.supabaseClient.rpc('create_revenue_draft', { reservation_id_value: reservationId });
    throwIfError(error);
    return data;
  },
  async confirmRevenue(revenueId, adjustments) {
    const { data, error } = await window.supabaseClient.rpc('confirm_revenue', {
      revenue_id_value: revenueId,
      adjustments: adjustments || {}
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
  async receiveDelivery(payload) {
    const { data, error } = await window.supabaseClient.rpc('costtrack_receive_delivery', {
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
    });
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
    const { data, error } = await window.supabaseClient.rpc('pos_save_bill', {
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
      p_initial_deposit: payload.initialDeposit || 0,
      p_idempotency_key: payload.idempotencyKey || null
    });
    throwIfError(error);
    return data;
  },
  async posCloseBill(billId, tenderedAmount, idempotencyKey) {
    const { data, error } = await window.supabaseClient.rpc('pos_close_bill', {
      p_bill_id: billId,
      p_tendered_amount: tenderedAmount,
      p_idempotency_key: idempotencyKey
    });
    throwIfError(error);
    return data;
  },
  async posRequestBillVoid(billId, reason) {
    const { data, error } = await window.supabaseClient.rpc('pos_request_bill_void', {
      p_bill_id: billId,
      p_reason: reason
    });
    throwIfError(error);
    return data;
  },
  async posDecideBillApproval(approvalId, decision, reason) {
    const { data, error } = await window.supabaseClient.rpc('pos_decide_bill_approval', {
      p_approval_id: approvalId,
      p_decision: decision,
      p_decision_reason: reason || ''
    });
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
