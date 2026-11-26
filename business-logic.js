(function exposeCostTrackLogic(root) {
  const ID_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
  const ID_IMAGE_MIME_TYPES = {
    jpg: ['image/jpeg', 'image/jpg'],
    jpeg: ['image/jpeg', 'image/jpg'],
    png: ['image/png'],
    webp: ['image/webp']
  };
  const INVENTORY_ACTION_ROLES = {
    'product.read': ['Administrator', 'Manager', 'Inventory Clerk', 'Chef / Kitchen Staff'],
    'product.manage': ['Administrator'],
    'inventory.read': ['Administrator', 'Manager', 'Inventory Clerk', 'Chef / Kitchen Staff'],
    'inventory.receive': ['Administrator', 'Manager', 'Inventory Clerk'],
    'inventory.adjust': ['Administrator', 'Manager'],
    'recipe.read': ['Administrator', 'Manager', 'Chef / Kitchen Staff'],
    'recipe.manage': ['Administrator', 'Manager'],
    'production.log': ['Administrator', 'Manager', 'Chef / Kitchen Staff'],
    'production.override': ['Administrator', 'Manager'],
    'waste.log': ['Administrator', 'Manager', 'Chef / Kitchen Staff'],
    'count.submit': ['Administrator', 'Inventory Clerk'],
    'count.approve': ['Administrator', 'Manager'],
    'revenue.read': ['Administrator', 'Manager'],
    'rates.manage': ['Administrator', 'Manager'],
    'supplier.manage': ['Administrator', 'Manager'],
    'user.manage': ['Administrator'],
    'settings.manage': ['Administrator']
  };
  const MOVEMENT_SIGNS = {
    'Opening balance': 1,
    Received: 1,
    Production: -1,
    Waste: -1,
    'Expired write-off': -1,
    'Count adjustment': 0,
    'Void reversal': 0
  };
  const RESTAURANT_TABLE_LAYOUT = [
    { id: 'FAM-12-1', seats: 12, tableType: 'Family', area: 'Unassigned' },
    { id: 'FAM-12-2', seats: 12, tableType: 'Family', area: 'Unassigned' },
    { id: 'FAM-8-1', seats: 8, tableType: 'Family', area: 'Unassigned' },
    { id: 'CAS-8-B1', seats: 8, tableType: 'Casual', area: 'Back' },
    { id: 'CAS-6-F1', seats: 6, tableType: 'Casual', area: 'Front' },
    { id: 'CAS-6-F2', seats: 6, tableType: 'Casual', area: 'Front' },
    { id: 'CAS-6-B1', seats: 6, tableType: 'Casual', area: 'Back' },
    { id: 'CAS-5-B1', seats: 5, tableType: 'Casual', area: 'Back' },
    { id: 'CAS-5-B2', seats: 5, tableType: 'Casual', area: 'Back' },
    { id: 'CAS-5-B3', seats: 5, tableType: 'Casual', area: 'Back' },
    { id: 'CAS-4-F1', seats: 4, tableType: 'Casual', area: 'Front' },
    { id: 'CAS-4-F2', seats: 4, tableType: 'Casual', area: 'Front' },
    { id: 'CAS-4-F3', seats: 4, tableType: 'Casual', area: 'Front' },
    { id: 'CAS-4-B1', seats: 4, tableType: 'Casual', area: 'Back' },
    { id: 'CAS-2-F1', seats: 2, tableType: 'Casual', area: 'Front' }
  ];
  const RESERVATION_CALENDAR_STATUS = Object.freeze({
    Pending: Object.freeze({ eventClass: 'pending', color: '#F5EAB8', contrastColor: '#4A3A00' }),
    Confirmed: Object.freeze({ eventClass: 'confirmed', color: '#EAF0F5', contrastColor: '#36516A' }),
    Seated: Object.freeze({ eventClass: 'seated', color: '#EAF0F5', contrastColor: '#36516A' }),
    'Checked-in': Object.freeze({ eventClass: 'checked-in', color: '#EAF0F5', contrastColor: '#36516A' }),
    Completed: Object.freeze({ eventClass: 'completed', color: '#E8F1EB', contrastColor: '#24563B' }),
    Cancelled: Object.freeze({ eventClass: 'cancelled', color: '#F9E9E7', contrastColor: '#8F2F2A' }),
    'No-show': Object.freeze({ eventClass: 'no-show', color: '#F9E9E7', contrastColor: '#8F2F2A' })
  });
  const PAST_UNRESOLVED_RESERVATION_STATUSES = new Set([
    'Pending', 'Confirmed', 'Seated', 'Checked-in'
  ]);

  function validateIdImageFile(file) {
    if (!file || typeof file.name !== 'string') {
      return { ok: false, message: 'Choose an ID image to continue.' };
    }

    const extension = file.name.split('.').pop().toLowerCase();
    const acceptedMimeTypes = ID_IMAGE_MIME_TYPES[extension];
    if (!acceptedMimeTypes || (file.type && !acceptedMimeTypes.includes(file.type.toLowerCase()))) {
      return { ok: false, message: 'Unsupported file type. Choose a JPG, JPEG, PNG, or WEBP image.' };
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      return { ok: false, message: 'Unable to preview image. Choose a valid JPG, JPEG, PNG, or WEBP image.' };
    }
    if (file.size > ID_IMAGE_MAX_BYTES) {
      return { ok: false, message: 'File exceeds the 5 MB maximum size.' };
    }

    return { ok: true, message: '' };
  }

  function number(value, label) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a finite number.`);
    return parsed;
  }

  function quantity4(value) {
    return Number(number(value, 'Quantity').toFixed(4));
  }

  function parseDate(value, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new TypeError(`${label} must be a date in YYYY-MM-DD format.`);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new TypeError(`${label} must be a valid calendar date.`);
    }
    return date;
  }

  function unitFactor(unit) {
    const dimension = unit?.dimension;
    const factor = number(unit?.conversionToBase ?? unit?.conversion_to_base, 'Unit conversion factor');
    if (!dimension || dimension === 'unknown' || factor <= 0) {
      throw new RangeError('This unit has no verified conversion. Ask an administrator to configure it.');
    }
    return { dimension, factor };
  }

  function convertQuantity(value, fromUnit, toUnit) {
    const quantity = number(value, 'Quantity');
    if (quantity < 0) throw new RangeError('Quantity cannot be negative.');
    const from = unitFactor(fromUnit);
    const to = unitFactor(toUnit);
    if (from.dimension !== to.dimension) {
      throw new RangeError(`Cannot convert ${fromUnit.abbreviation || fromUnit.name} to ${toUnit.abbreviation || toUnit.name}: their dimensions differ.`);
    }
    return quantity4(quantity * from.factor / to.factor);
  }

  function daysBetween(from, to) {
    return Math.round((parseDate(to, 'Comparison date') - parseDate(from, 'Expiration date')) / 86400000);
  }

  function batchStatus(batch, asOfDate, alertDays = 3) {
    const remaining = number(batch.quantityRemaining ?? batch.quantity_remaining ?? 0, 'Remaining quantity');
    const storedStatus = String(batch.status || 'Active').toLowerCase();
    if (storedStatus === 'voided') return { status: 'Voided', daysUntilExpiry: null };
    if (remaining <= 0 || storedStatus === 'depleted') return { status: 'Depleted', daysUntilExpiry: null };
    const expirationDate = batch.expirationDate ?? batch.expiration_date;
    if (!expirationDate) return { status: 'Active', daysUntilExpiry: null };
    const daysUntilExpiry = daysBetween(asOfDate, expirationDate);
    if (daysUntilExpiry < 0 || storedStatus === 'expired') return { status: 'Expired', daysUntilExpiry };
    const days = number(alertDays, 'Expiry alert days');
    return {
      status: daysUntilExpiry <= days ? 'Expiring soon' : 'Active',
      daysUntilExpiry
    };
  }

  const notificationRoleAccess = {
    stock: ['Administrator', 'Manager', 'Inventory Clerk'],
    expiry: ['Administrator', 'Manager', 'Inventory Clerk'],
    reservation: ['Administrator', 'Manager', 'Receptionist'],
    unresolved: ['Administrator', 'Manager', 'Receptionist'],
    pos: ['Administrator', 'Manager']
  };
  const notificationViewAccess = {
    ingredients: ['Administrator', 'Manager', 'Inventory Clerk'],
    receiving: ['Administrator', 'Manager', 'Inventory Clerk'],
    reservations: ['Administrator', 'Manager', 'Receptionist'],
    shifts: ['Administrator', 'Manager', 'Receptionist'],
    cashier: ['Administrator', 'Manager', 'Receptionist'],
    approvals: ['Administrator', 'Manager'],
    reports: ['Administrator', 'Manager'],
    revenue: ['Administrator', 'Manager']
  };

  function notificationVisibleToRole(item, role) {
    if (!item || !role) return false;
    const category = item.category || item.kind;
    const allowedRoles = notificationRoleAccess[category];
    if (allowedRoles && !allowedRoles.includes(role)) return false;
    if (Array.isArray(item.targetRoles) && !item.targetRoles.includes(role)) return false;
    if (item.type === 'Missing revenue entry' && !['Administrator', 'Manager'].includes(role)) return false;
    return true;
  }

  function notificationActionForRole(item, role) {
    if (!notificationVisibleToRole(item, role) || !item?.action) return null;
    const allowedRoles = notificationViewAccess[item.action.view];
    return allowedRoles?.includes(role) ? item.action : null;
  }

  function buildNotificationFeed(items, role, readKeys = []) {
    const readKeySet = new Set(readKeys);
    const deduplicated = new Map();
    for (const item of items || []) {
      if (!notificationVisibleToRole(item, role)) continue;
      const key = String(item.key || item.id || '');
      if (!key) continue;
      const dedupeKey = String(item.dedupeKey || key);
      const candidate = {
        ...item,
        key: dedupeKey,
        dedupeKey,
        isRead: Boolean(item.isRead || readKeySet.has(key) || readKeySet.has(dedupeKey))
      };
      const previous = deduplicated.get(dedupeKey);
      if (!previous) {
        deduplicated.set(dedupeKey, candidate);
        continue;
      }
      const severityRank = { critical: 3, warning: 2, info: 1 };
      const chosen = (severityRank[candidate.severity] || 0) > (severityRank[previous.severity] || 0)
        ? candidate
        : previous;
      deduplicated.set(dedupeKey, {
        ...chosen,
        isRead: previous.isRead && candidate.isRead,
        createdAt: [previous.createdAt, candidate.createdAt]
          .filter(Boolean)
          .sort()
          .pop() || null
      });
    }
    return [...deduplicated.values()].sort((left, right) => {
      if (left.isRead !== right.isRead) return left.isRead ? 1 : -1;
      const severityRank = { critical: 3, warning: 2, info: 1 };
      const severityOrder = (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0);
      if (severityOrder) return severityOrder;
      return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
    });
  }

  function notificationUnreadCount(items) {
    return (items || []).filter(item => !item.isRead).length;
  }

  function formatNotificationRelativeTime(value, now = Date.now()) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return 'Just now';
    const seconds = Math.round((timestamp - now) / 1000);
    if (Math.abs(seconds) < 60) return 'Just now';
    const units = [
      ['year', 31536000],
      ['month', 2592000],
      ['week', 604800],
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60]
    ];
    const [unit, unitSeconds] = units.find(([, size]) => Math.abs(seconds) >= size);
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
      .format(Math.round(seconds / unitSeconds), unit);
  }

  function availableStock(batches, asOfDate) {
    return quantity4(batches.reduce((total, batch) => {
      const { status } = batchStatus(batch, asOfDate, -1);
      if (status !== 'Active') return total;
      return total + number(batch.quantityRemaining ?? batch.quantity_remaining ?? 0, 'Remaining quantity');
    }, 0));
  }

  function stockHealth(quantity, threshold) {
    const stock = number(quantity, 'Stock quantity');
    const minimum = number(threshold, 'Stock threshold');
    if (stock < 0 || minimum < 0) throw new RangeError('Stock and threshold cannot be negative.');
    if (stock === 0) return 'Out of Stock';
    return stock < minimum ? 'Low Stock' : 'Healthy';
  }

  function orderBatches(batches, method) {
    if (!['FIFO', 'FEFO'].includes(method)) throw new RangeError('Consumption method must be FIFO or FEFO.');
    return batches.slice().sort((left, right) => {
      if (method === 'FEFO') {
        const leftExpiry = left.expirationDate ?? left.expiration_date ?? '9999-12-31';
        const rightExpiry = right.expirationDate ?? right.expiration_date ?? '9999-12-31';
        const byExpiry = leftExpiry.localeCompare(rightExpiry);
        if (byExpiry) return byExpiry;
      }
      const leftReceived = left.receivedDate ?? left.received_date ?? '';
      const rightReceived = right.receivedDate ?? right.received_date ?? '';
      return leftReceived.localeCompare(rightReceived) || String(left.id).localeCompare(String(right.id));
    });
  }

  function planConsumption({ batches, quantity, recipeUnit, stockUnit, method = 'FIFO', asOfDate }) {
    if (!Array.isArray(batches) || !recipeUnit || !stockUnit || !asOfDate) {
      throw new TypeError('Batches, recipeUnit, stockUnit, and asOfDate are required.');
    }
    const requested = convertQuantity(quantity, recipeUnit, stockUnit);
    const eligible = batches.filter(batch => {
      const status = batchStatus(batch, asOfDate, -1).status;
      return status === 'Active'
        && number(batch.quantityRemaining ?? batch.quantity_remaining ?? 0, 'Remaining quantity') > 0;
    });
    const ordered = orderBatches(eligible, method);
    const warnings = [];
    if (method === 'FIFO') {
      const dated = orderBatches(eligible, 'FIFO').filter(batch => batch.expirationDate || batch.expiration_date);
      for (let olderIndex = 0; olderIndex < dated.length && !warnings.length; olderIndex += 1) {
        const olderExpiry = dated[olderIndex].expirationDate ?? dated[olderIndex].expiration_date;
        for (let newerIndex = olderIndex + 1; newerIndex < dated.length; newerIndex += 1) {
          const newerExpiry = dated[newerIndex].expirationDate ?? dated[newerIndex].expiration_date;
          if (newerExpiry < olderExpiry) {
            warnings.push('A newer batch expires sooner than an older batch.');
            break;
          }
        }
      }
    }

    let remaining = requested;
    const allocations = [];
    for (const batch of ordered) {
      if (remaining <= 0) break;
      const batchQuantity = number(batch.quantityRemaining ?? batch.quantity_remaining, 'Remaining quantity');
      const quantityUsed = quantity4(Math.min(batchQuantity, remaining));
      const unitCost = number(batch.unitCost ?? batch.unit_cost ?? 0, 'Batch unit cost');
      if (unitCost < 0) throw new RangeError('Batch unit cost cannot be negative.');
      allocations.push({
        batchId: batch.id,
        quantity: quantityUsed,
        unitCost,
        cost: quantityUsed * unitCost
      });
      remaining = quantity4(remaining - quantityUsed);
    }
    const allocated = quantity4(requested - remaining);
    return {
      method,
      requestedQuantity: requested,
      allocatedQuantity: allocated,
      shortageQuantity: remaining,
      isSufficient: remaining === 0,
      allocations,
      totalCost: allocations.reduce((total, allocation) => total + allocation.cost, 0),
      warnings
    };
  }

  function weightedAverageUnitCost(batches, asOfDate) {
    const active = batches.filter(batch => batchStatus(batch, asOfDate, -1).status === 'Active');
    const quantity = active.reduce((sum, batch) => sum + number(batch.quantityRemaining ?? batch.quantity_remaining, 'Remaining quantity'), 0);
    if (!quantity) return null;
    return active.reduce((sum, batch) => (
      sum + number(batch.quantityRemaining ?? batch.quantity_remaining, 'Remaining quantity')
        * number(batch.unitCost ?? batch.unit_cost ?? 0, 'Batch unit cost')
    ), 0) / quantity;
  }

  function productionProgress(batches, prepTarget) {
    if (!Array.isArray(batches)) throw new TypeError('Production batches must be an array.');
    const target = number(prepTarget, 'Prep target');
    if (target < 0) throw new RangeError('Prep target cannot be negative.');
    const portions = batch => {
      const expected = batch.expectedCovers ?? batch.expected_covers;
      if (expected != null) return number(expected, 'Expected portions');
      const batchYield = number(batch.batchYield ?? batch.batch_yield ?? 0, 'Batch yield');
      const batchCount = number(batch.batchCount ?? batch.batch_count ?? 1, 'Batch count');
      return batchYield * batchCount;
    };
    const ready = batches.filter(batch => batch.status === 'Ready').reduce((sum, batch) => sum + portions(batch), 0);
    const cooking = batches.filter(batch => batch.status === 'Cooking').reduce((sum, batch) => sum + portions(batch), 0);
    return {
      target,
      ready,
      cooking,
      remaining: Math.max(0, target - ready - cooking),
      remainingAfterCooking: Math.max(0, target - ready)
    };
  }

  function createStockMovement(movement) {
    if (!movement || !Object.hasOwn(MOVEMENT_SIGNS, movement.type)) {
      throw new TypeError('A supported stock movement type is required.');
    }
    const quantity = number(movement.quantity, 'Movement quantity');
    if (quantity === 0) throw new RangeError('Movement quantity cannot be zero.');
    const expectedSign = MOVEMENT_SIGNS[movement.type];
    if (expectedSign && Math.sign(quantity) !== expectedSign) {
      throw new RangeError(`${movement.type} movements must have a ${expectedSign > 0 ? 'positive' : 'negative'} quantity.`);
    }
    if (!movement.productId || !movement.batchId || !movement.referenceType || !movement.referenceId) {
      throw new TypeError('Product, batch, and source reference are required for a stock movement.');
    }
    const unitCost = number(movement.unitCost, 'Unit cost');
    if (unitCost < 0) throw new RangeError('Unit cost cannot be negative.');
    return {
      ...movement,
      quantity: quantity4(quantity),
      unitCost,
      cost: Math.abs(quantity) * unitCost,
      createdAt: movement.createdAt || new Date().toISOString()
    };
  }

  function canPerformInventoryAction(role, action) {
    return Boolean(INVENTORY_ACTION_ROLES[action]?.includes(role));
  }

  function canCloseShift(shift, role, userId) {
    if (shift?.status !== 'Open') return false;
    if (role === 'Receptionist') return Boolean(userId && shift.openedBy === userId);
    return role === 'Manager' || role === 'Administrator';
  }

  function assertInventoryRole(role, action) {
    if (!canPerformInventoryAction(role, action)) {
      const error = new Error(`Not authorized to perform ${action}.`);
      error.code = 'FORBIDDEN';
      throw error;
    }
  }

  function createRevenueRecord(data) {
    const adultCustomers = Number(data.adult_customers || 0);
    const childCustomers = Number(data.child_customers || 0);
    const seniorCustomers = Number(data.senior_pwd_customers || 0);
    const adultRate = Number(data.adult_rate);
    const childRate = Number(data.child_rate);
    const seniorRate = Number(data.senior_pwd_rate);
    const counts = [adultCustomers, childCustomers, seniorCustomers];
    const rates = [adultRate, childRate, seniorRate];
    if (counts.some(value => !Number.isInteger(value) || value < 0)) throw new RangeError('Customer counts must be non-negative whole numbers.');
    if (counts.reduce((sum, value) => sum + value, 0) < 1) throw new RangeError('At least one customer is required.');
    if (rates.some(value => !Number.isFinite(value) || value < 0)) throw new RangeError('Revenue rates must be valid non-negative amounts.');
    return {
      status: data.status || 'Confirmed',
      ...data,
      adult_customers: adultCustomers,
      adult_rate: adultRate,
      child_customers: childCustomers,
      child_rate: childRate,
      senior_pwd_customers: seniorCustomers,
      senior_pwd_rate: seniorRate,
      adult_revenue: adultCustomers * adultRate,
      child_revenue: childCustomers * childRate,
      senior_pwd_revenue: seniorCustomers * seniorRate,
      total_customers: adultCustomers + childCustomers + seniorCustomers,
      total_revenue: adultCustomers * adultRate + childCustomers * childRate + seniorCustomers * seniorRate
    };
  }

  function recipeCostBreakdown(recipe, ingredients) {
    if (!recipe || !Array.isArray(recipe.ingredients)) {
      throw new TypeError('Recipe ingredients must be an array.');
    }
    const ingredientById = new Map(ingredients.map(item => [item.id, item]));
    const wastage = Number(recipe.wastage ?? 0);
    if (!Number.isFinite(wastage) || wastage < 0) throw new RangeError('Recipe wastage must be a non-negative number.');
    const batchYield = Number(recipe.batchYield ?? recipe.batch_yield ?? 30);
    if (!Number.isInteger(batchYield) || batchYield <= 0) {
      throw new RangeError('Portions per base recipe must be a positive whole number.');
    }
    const ingredientsCost = recipe.ingredients.map(line => {
      const item = ingredientById.get(line.ingredientId);
      const quantity = Number(line.quantity);
      const unitCost = Number(item?.cost);
      if (!item || !Number.isFinite(quantity) || quantity <= 0
        || !Number.isFinite(unitCost) || unitCost < 0) {
        throw new RangeError('Recipe ingredients must reference valid inventory with positive quantities and costs.');
      }
      return {
        ingredientId: item.id,
        name: item.name || 'Ingredient',
        quantity,
        unit: item.unit || '',
        unitCost,
        baseCost: quantity * unitCost
      };
    });
    const baseCost = ingredientsCost.reduce((sum, line) => sum + line.baseCost, 0);
    const wastageFactor = 1 + wastage / 100;
    const totalBatchCost = baseCost * wastageFactor;
    return {
      batchYield,
      totalBatchCost,
      costPerPortion: totalBatchCost / batchYield,
      ingredients: ingredientsCost.map(line => ({
        ...line,
        lineCost: line.baseCost * wastageFactor,
        costPercent: baseCost ? line.baseCost / baseCost * 100 : 0
      }))
    };
  }

  function computedRecipeCost(recipe, ingredients) {
    return recipeCostBreakdown(recipe, ingredients).totalBatchCost;
  }

  function productionLogCost(log, recipe, ingredients) {
    const snapshot = log?.batchCostSnapshot ?? log?.batch_cost_snapshot;
    if (snapshot != null) {
      const savedCost = Number(snapshot);
      if (!Number.isFinite(savedCost) || savedCost < 0) {
        throw new RangeError('Production cost snapshot must be a non-negative number.');
      }
      return savedCost;
    }
    const quantity = Number(log?.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new RangeError('Production quantity must be a non-negative number.');
    }
    return computedRecipeCost(recipe, ingredients) * quantity;
  }

  function recipeStockAvailability(recipe, ingredients) {
    if (!recipe || !Array.isArray(recipe.ingredients) || !recipe.ingredients.length) return null;
    const ingredientById = new Map(ingredients.map(item => [item.id, item]));
    let batches = Infinity;
    let limitingIngredientId = null;
    for (const line of recipe.ingredients) {
      const item = ingredientById.get(line.ingredientId);
      const quantity = Number(line.quantity);
      if (!item || !Number.isFinite(quantity) || quantity <= 0) return null;
      const available = Math.floor(Math.max(0, Number(item.stock || 0)) / quantity);
      if (available < batches) {
        batches = available;
        limitingIngredientId = item.id;
      }
    }
    return { batches, limitingIngredientId };
  }

  function recipeSanityWarnings(recipe, ingredients, adultRate) {
    const breakdown = recipeCostBreakdown(recipe, ingredients);
    const warnings = [];
    for (const line of breakdown.ingredients) {
      const unit = line.unit.trim().toLowerCase();
      const quantityLimit = ['kg', 'kilogram', 'kilograms', 'l', 'liter', 'liters', 'litre', 'litres'].includes(unit)
        ? 100
        : ['g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(unit)
          ? 100000
          : 10000;
      if (line.quantity > quantityLimit) {
        warnings.push(`${line.name}: ${line.quantity} ${line.unit} per base recipe seems unusually high; verify the unit.`);
      }
      if (line.unitCost > 10000 || line.lineCost > 100000) {
        warnings.push(`${line.name}: ingredient cost seems unusually high; verify the unit cost and quantity.`);
      }
    }
    const adultRateValue = Number(adultRate);
    if (Number.isFinite(adultRateValue) && adultRateValue > 0
      && breakdown.costPerPortion > adultRateValue) {
      warnings.push('Cost per portion exceeds the adult buffet rate; verify ingredient quantities and costs.');
    }
    return warnings;
  }

  function recipeFoodCostPercent(costPerPortion, adultRate) {
    const cost = Number(costPerPortion);
    const rate = Number(adultRate);
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(rate) || rate <= 0) return null;
    return cost / rate * 100;
  }

  function isRecipeActive(recipe) {
    return recipe?.isActive !== false && recipe?.is_active !== false;
  }

  function reservationRevenue(reservation, rates = {}) {
    const seniorPwdCount = Number(reservation.seniorPwdCount ?? reservation.senior_pwd_count ?? 0);
    const children = Number(reservation.children ?? 0);
    const statedCovers = reservation.actualCovers
      ?? reservation.actual_covers
      ?? reservation.guests
      ?? null;
    const adults = reservation.adults == null
      ? Math.max(0, Number(statedCovers ?? seniorPwdCount + children) - seniorPwdCount - children)
      : Number(reservation.adults);
    const covers = Number(statedCovers ?? adults + seniorPwdCount + children);
    if (!Number.isInteger(covers) || covers < 0
      || ![adults, seniorPwdCount, children].every(value => Number.isInteger(value) && value >= 0)) {
      throw new RangeError('Reservation guest counts must be non-negative whole numbers.');
    }
    if (rates == null) return null;
    const adultRate = Number(rates.adult_rate ?? rates.adultRate);
    const childRate = Number(rates.child_rate ?? rates.childRate);
    const seniorPwdRate = Number(
      rates.senior_pwd_rate
      ?? rates.seniorPwdRate
      ?? (seniorPwdCount === 0 ? 0 : NaN)
    );
    if (![adultRate, childRate, seniorPwdRate].every(value => Number.isFinite(value) && value >= 0)) {
      return null;
    }
    return adults * adultRate + seniorPwdCount * seniorPwdRate + children * childRate;
  }

  function closedBillRevenueTotals(rows) {
    if (!Array.isArray(rows)) throw new TypeError('Closed-bill report rows must be an array.');
    const sum = key => rows.reduce((total, row) => {
      const value = Number(row?.[key]);
      return total + (Number.isFinite(value) ? value : 0);
    }, 0);
    return {
      closedBillCount: sum('closed_bill_count'),
      netRevenue: sum('net_revenue'),
      discountTotal: sum('discount_total'),
      customersServed: sum('customers_served'),
      voidedBillCount: sum('voided_bill_count'),
      voidedBillAmount: sum('voided_bill_amount')
    };
  }

  function normalizeReservationGuestCounts(adults, seniorPwdCount, children) {
    const counts = [Number(adults), Number(seniorPwdCount), Number(children)];
    if (!counts.every(value => Number.isInteger(value) && value >= 0)) {
      throw new RangeError('Guest counts must be non-negative whole numbers.');
    }
    const total = counts.reduce((sum, value) => sum + value, 0);
    if (total < 1 || total > 1000) {
      throw new RangeError('A reservation must include between 1 and 1,000 guests.');
    }
    return {
      adults: counts[0],
      seniorPwdCount: counts[1],
      children: counts[2],
      total
    };
  }

  function isRecentWebsiteReservation(reservation, now = Date.now()) {
    if (!reservation || reservation.source !== 'Website' || reservation.status !== 'Pending') return false;
    const createdAt = Date.parse(reservation.createdAt || '');
    const recentWindowMs = 24 * 60 * 60 * 1000;
    return Number.isFinite(createdAt) && createdAt <= now && now - createdAt <= recentWindowMs;
  }

  function activeBuffetRate(rates, mealPeriod, date, dayType) {
    const targetMealPeriod = String(mealPeriod || 'All Day').trim().toLowerCase();
    const targetDayType = String(dayType || '').trim().toLowerCase();
    const eligible = (rates || []).filter(rate => {
      const rateDayType = String(rate.dayType ?? rate.day_type ?? '').trim().toLowerCase();
      const effectiveFrom = rate.effectiveFrom ?? rate.effective_from ?? '';
      const effectiveTo = rate.effectiveTo ?? rate.effective_to ?? null;
      return rate.isActive !== false
        && rate.is_active !== false
        && rateDayType === targetDayType
        && effectiveFrom <= date
        && (!effectiveTo || effectiveTo >= date);
    });
    const latest = matches => matches.sort((left, right) =>
      String(right.effectiveFrom ?? right.effective_from ?? '')
        .localeCompare(String(left.effectiveFrom ?? left.effective_from ?? ''))
    )[0];
    const exact = eligible.filter(rate =>
      String(rate.mealPeriod ?? rate.meal_period ?? '').trim().toLowerCase() === targetMealPeriod
    );
    const selected = latest(exact);
    if (selected) return selected;
    if (targetMealPeriod === 'all day') return undefined;
    return latest(eligible.filter(rate =>
      String(rate.mealPeriod ?? rate.meal_period ?? '').trim().toLowerCase() === 'all day'
    ));
  }

  function parseReservationTime(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    let match = normalized.match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i);
    if (match) {
      let hours = Number(match[1]) % 12;
      if (match[3].toUpperCase() === 'PM') hours += 12;
      return hours * 60 + Number(match[2]);
    }
    match = normalized.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function formatReservationTime(minutes) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
      throw new RangeError('Reservation time must be a minute of the day.');
    }
    const hours = Math.floor(minutes / 60);
    const hour12 = hours % 12 || 12;
    return `${hour12}:${String(minutes % 60).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
  }

  const MAX_TABLE_STAY_MINUTES = 120;
  const RESTAURANT_OPEN_MINUTES = 10 * 60;
  const RESTAURANT_CLOSE_MINUTES = 21 * 60;

  function reservationStartTimeIsInPast(date, time, now = new Date()) {
    const dateMatch = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const startMinutes = parseReservationTime(time);
    if (!dateMatch || startMinutes === null || !(now instanceof Date) || !Number.isFinite(now.getTime())) return false;

    const reservationDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (reservationDate < currentDate) return true;
    if (reservationDate > currentDate) return false;

    const currentMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 + now.getMilliseconds() / 60000;
    return startMinutes < currentMinutes;
  }

  function reservationTimeSlots(date, now = new Date()) {
    const slots = [];
    for (let minutes = RESTAURANT_OPEN_MINUTES; minutes + MAX_TABLE_STAY_MINUTES <= RESTAURANT_CLOSE_MINUTES; minutes += 30) {
      slots.push(formatReservationTime(minutes));
    }
    return date ? slots.filter(time => !reservationStartTimeIsInPast(date, time, now)) : slots;
  }

  function isReservationTimeWithinOpenHours(value) {
    const minutes = parseReservationTime(value);
    return minutes !== null
      && minutes >= RESTAURANT_OPEN_MINUTES
      && minutes + MAX_TABLE_STAY_MINUTES <= RESTAURANT_CLOSE_MINUTES;
  }

  function reservationEndTime(value, duration = MAX_TABLE_STAY_MINUTES) {
    const minutes = parseReservationTime(value);
    if (minutes === null || !Number.isInteger(duration) || duration <= 0 || minutes + duration >= 24 * 60) return null;
    return formatReservationTime(minutes + duration);
  }

  function reservationTimeOverlaps(firstTime, secondTime, duration = MAX_TABLE_STAY_MINUTES) {
    const firstStart = parseReservationTime(firstTime);
    const secondStart = parseReservationTime(secondTime);
    if (firstStart === null || secondStart === null || !Number.isInteger(duration) || duration <= 0) return false;
    return firstStart < secondStart + duration && secondStart < firstStart + duration;
  }

  function reservationStayLimitReached(reservation, now = new Date()) {
    if (!reservation || reservation.status !== 'Seated' || !(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
    const minutes = parseReservationTime(reservation.time);
    const dateParts = String(reservation.date || '').split('-').map(Number);
    if (minutes === null || dateParts.length !== 3 || dateParts.some(value => !Number.isInteger(value))) return false;
    const start = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], Math.floor(minutes / 60), minutes % 60);
    return now.getTime() >= start.getTime() + MAX_TABLE_STAY_MINUTES * 60 * 1000;
  }

  function tableAvailability(table, reservations, date, currentDate, currentTimeMinutes = null, now = new Date()) {
    const bookings = reservations
      .filter(item =>
        item.table === table.id
        && (item.date === date || (date === currentDate && item.date < date && item.status === 'Seated'))
        && ['Pending', 'Confirmed', 'Seated'].includes(item.status)
      )
      .sort((left, right) => (parseReservationTime(left.time) ?? Number.MAX_SAFE_INTEGER)
        - (parseReservationTime(right.time) ?? Number.MAX_SAFE_INTEGER));
    const seatedBooking = bookings.find(item => item.status === 'Seated');
    if (seatedBooking) {
      return {
        status: 'Occupied',
        bookings,
        primaryBooking: seatedBooking,
        stayLimitReached: reservationStayLimitReached(seatedBooking, now),
        bookingWindowEnded: false
      };
    }
    const nextBooking = bookings.find(item => ['Pending', 'Confirmed'].includes(item.status));
    if (nextBooking) {
      const start = parseReservationTime(nextBooking.time);
      const bookingWindowEnded = date === currentDate
        && Number.isFinite(currentTimeMinutes)
        && start !== null
        && currentTimeMinutes >= start + MAX_TABLE_STAY_MINUTES;
      const reservationIsActive = date === currentDate
        && (!Number.isFinite(currentTimeMinutes)
          || start === null
          || currentTimeMinutes + MAX_TABLE_STAY_MINUTES > start);
      return {
        status: reservationIsActive ? 'Reserved Active' : 'Reserved Later',
        bookings,
        primaryBooking: nextBooking,
        stayLimitReached: false,
        bookingWindowEnded
      };
    }
    return { status: 'Available', bookings, primaryBooking: null, stayLimitReached: false, bookingWindowEnded: false };
  }

  function tableReservationConflict(tableId, date, time, reservations, excludeReservationId = '', currentDate = '') {
    if (!tableId || !date || !time) return null;
    if (date === currentDate) {
      const priorDaySeating = reservations.find(item =>
        item.id !== excludeReservationId
        && item.table === tableId
        && item.date < date
        && item.status === 'Seated'
      );
      if (priorDaySeating) return priorDaySeating;
    }
    return reservations.find(item =>
      item.id !== excludeReservationId
      && item.table === tableId
      && item.date === date
      && ['Pending', 'Confirmed', 'Seated'].includes(item.status)
      && reservationTimeOverlaps(time, item.time)
    );
  }

  function tableHasReservationConflict(tableId, date, time, reservations, excludeReservationId = '', currentDate = '') {
    return Boolean(tableReservationConflict(tableId, date, time, reservations, excludeReservationId, currentDate));
  }

  function buildReservationRecord(existing, formData, newId) {
    return {
      ...(existing || {}),
      ...formData,
      id: existing?.id || newId,
      type: existing?.type || 'Reservation'
    };
  }

  function planRestaurantTableLayout(tables, reservations = [], asOfDate = new Date().toISOString().slice(0, 10)) {
    const sortedTables = tables.slice().sort((left, right) =>
      String(left.id).localeCompare(String(right.id), undefined, { numeric: true, sensitivity: 'base' }));
    const usedIds = new Set();
    const updates = [];
    const additions = [];
    const conflicts = [];
    const templateIds = new Set(RESTAURANT_TABLE_LAYOUT.map(table => table.id.toLowerCase()));
    const exactMatches = new Map(RESTAURANT_TABLE_LAYOUT.map(template => [
      template.id,
      sortedTables.find(table => String(table.id).toLowerCase() === template.id.toLowerCase())
    ]));

    for (const template of RESTAURANT_TABLE_LAYOUT) {
      const match = exactMatches.get(template.id) || sortedTables.find(table =>
        !usedIds.has(String(table.id))
        && !templateIds.has(String(table.id).toLowerCase()));

      if (match) {
        usedIds.add(String(match.id));
        const nextTable = {
          ...match,
          seats: template.seats,
          tableType: template.tableType,
          area: template.area
        };
        if (Number(match.seats) > template.seats) {
          const blockingReservations = reservations.filter(reservation =>
            reservation.table === match.id
            && reservation.date >= asOfDate
            && ['Pending', 'Confirmed', 'Seated'].includes(reservation.status)
            && Number(
              reservation.actualCovers
              ?? reservation.guests
              ?? Number(reservation.adults || 0)
                + Number(reservation.seniorPwdCount ?? reservation.senior_pwd_count ?? 0)
                + Number(reservation.children || 0)
            ) > template.seats
          );
          if (blockingReservations.length) {
            conflicts.push({
              tableId: match.id,
              targetSeats: template.seats,
              reservationIds: blockingReservations.map(reservation => reservation.id)
            });
          }
        }
        if (Number(match.seats) !== template.seats
            || (match.tableType || 'Unassigned') !== template.tableType
            || (match.area || 'Unassigned') !== template.area) updates.push(nextTable);
        continue;
      }

      additions.push({
        ...template,
        status: 'Available',
        x: 0,
        y: 0,
        guest: ''
      });
    }

    const unmatchedTables = sortedTables.filter(table => !usedIds.has(String(table.id)));
    for (const table of unmatchedTables) {
      if ((table.tableType || 'Unassigned') !== 'Unassigned' || (table.area || 'Unassigned') !== 'Unassigned') {
        updates.push({ ...table, tableType: 'Unassigned', area: 'Unassigned' });
      }
    }

    return {
      expectedTableCount: RESTAURANT_TABLE_LAYOUT.length,
      updates,
      additions,
      conflicts,
      unmatchedTables
    };
  }

  function modalInteraction(type, interaction) {
    if (interaction === 'backdrop') return ['read-only', 'popover', 'menu'].includes(type) ? 'close' : 'ignore';
    if (interaction !== 'escape') return 'ignore';
    if (type === 'confirmation') return 'cancel';
    if (['read-only', 'popover', 'menu'].includes(type)) return 'close';
    if (['form', 'money'].includes(type)) return 'request-close';
    return 'ignore';
  }

  function reservationCalendarStatusPresentation(status) {
    return RESERVATION_CALENDAR_STATUS[status] || RESERVATION_CALENDAR_STATUS.Pending;
  }

  function reservationCalendarStatusLegend() {
    return Object.entries(RESERVATION_CALENDAR_STATUS).map(([status, presentation]) => ({
      status,
      ...presentation
    }));
  }

  function isPastUnresolvedReservation(status, reservationDate, currentDate) {
    return reservationDate < currentDate && PAST_UNRESOLVED_RESERVATION_STATUSES.has(status);
  }

  function formatManilaTimestamp(value) {
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) throw new Error('The server returned an invalid timestamp.');
    const date = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Manila', day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(timestamp);
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true
    }).format(timestamp);
    return `${date}, ${time}`;
  }

  async function saveThenRefresh(saveOperation, refreshOperation, onRefreshError) {
    const saved = await saveOperation();
    const refresh = Promise.resolve()
      .then(refreshOperation)
      .catch(error => {
        onRefreshError(error);
      });
    return { saved, refresh };
  }

  const logic = {
    assertInventoryRole,
    ID_IMAGE_MAX_BYTES,
    availableStock,
    batchStatus,
    buildReservationRecord,
    canCloseShift,
    canPerformInventoryAction,
    closedBillRevenueTotals,
    formatManilaTimestamp,
    isPastUnresolvedReservation,
    buildNotificationFeed,
    formatNotificationRelativeTime,
    modalInteraction,
    notificationActionForRole,
    notificationUnreadCount,
    notificationVisibleToRole,
    reservationCalendarStatusLegend,
    reservationCalendarStatusPresentation,
    recipeCostBreakdown,
    activeBuffetRate,
    convertQuantity,
    createRevenueRecord,
    createStockMovement,
    computedRecipeCost,
    productionLogCost,
    isRecipeActive,
    orderBatches,
    formatReservationTime,
    isReservationTimeWithinOpenHours,
    parseReservationTime,
    reservationStartTimeIsInPast,
    planRestaurantTableLayout,
    planConsumption,
    productionProgress,
    reservationRevenue,
    normalizeReservationGuestCounts,
    isRecentWebsiteReservation,
    reservationEndTime,
    reservationStayLimitReached,
    recipeFoodCostPercent,
    recipeSanityWarnings,
    recipeStockAvailability,
    saveThenRefresh,
    reservationTimeSlots,
    reservationTimeOverlaps,
    stockHealth,
    MAX_TABLE_STAY_MINUTES,
    tableAvailability,
    tableHasReservationConflict,
    tableReservationConflict,
    validateIdImageFile,
    weightedAverageUnitCost
  };
  root.CostTrackLogic = logic;
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;
})(globalThis);
