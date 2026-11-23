const assert = require('node:assert/strict');
const test = require('node:test');
const logic = require('./business-logic.js');
const ocr = require('./ivs-ocr.js');
const faceMatching = require('./face-matching.js');

const kg = { name: 'Kilogram', abbreviation: 'kg', dimension: 'weight', conversionToBase: 1000 };
const g = { name: 'Gram', abbreviation: 'g', dimension: 'weight', conversionToBase: 1 };
const liter = { name: 'Liter', abbreviation: 'L', dimension: 'volume', conversionToBase: 1000 };
const asOfDate = '2026-11-11';

test('face matching uses IVS Euclidean distance and cutoff for 128-value descriptors', () => {
  const first = Array(128).fill(0);
  const same = Array(128).fill(0);
  const withinThreshold = Array(128).fill(0);
  const outsideThreshold = Array(128).fill(0);
  withinThreshold[0] = 0.6;
  outsideThreshold[0] = 0.61;

  assert.equal(faceMatching.compareDescriptors(first, same), 0);
  assert.equal(faceMatching.compareDescriptors(first, withinThreshold), 0.6);
  assert.equal(faceMatching.compareDescriptors(first, outsideThreshold), 0.61);
  assert.equal(faceMatching.faceMatchDistance, 0.6);
  assert.equal(faceMatching.classifyDistance(0.6), 'match');
  assert.equal(faceMatching.classifyDistance(0.6001), 'no_match');
  assert.equal(faceMatching.classifyDistance(Number.NaN), 'no_match');
  assert.equal(faceMatching.similarityIndicator(0), 100);
  assert.equal(faceMatching.similarityIndicator(1), 50);
  assert.throws(() => faceMatching.compareDescriptors([0], [0]), /missing or invalid/);
});

test('ID OCR parsing extracts labeled fields and identifies a supported PhilSys ID', () => {
  const text = [
    'PHILSYS',
    'FULL NAME: Juan Dela Cruz',
    'DATE OF BIRTH: January 1, 2000',
    'ADDRESS: Balayan, Batangas',
    'ID NUMBER: 1234 5678 9012 3456'
  ].join('\n');
  const idType = ocr.detectIdType(text);
  const parsed = ocr.parseIdText(text, idType);

  assert.equal(idType, 'philid');
  assert.deepEqual(parsed.fields, {
    full_name: 'Juan Dela Cruz',
    dob: '2000-01-01',
    address: 'Balayan, Batangas',
    id_number: '1234567890123456'
  });
});

test('ID OCR leaves conflicting single-pass values undetected and accepts matching reads', () => {
  const firstText = 'FULL NAME: Juan Dela Cruz\nDOB: January 1, 2000';
  const secondText = 'FULL NAME: Jose Dela Cruz\nDOB: January 1, 2000';
  const candidates = [
    { text: firstText, confidence: 0.9, parsed: ocr.parseIdText(firstText) },
    { text: secondText, confidence: 0.9, parsed: ocr.parseIdText(secondText) }
  ];

  assert.deepEqual(ocr.mergeCandidates(candidates, null), {
    full_name: '',
    dob: '2000-01-01',
    address: '',
    id_number: ''
  });
});

test('ID OCR detects an unsupported document without inventing a supported ID type', () => {
  assert.equal(ocr.detectIdType('POSTAL ID\nFULL NAME: Juan Dela Cruz'), null);
  assert.equal(ocr.detectIdType(['PHILSYS', 'PHILSYS', 'PASSPORT']), 'philid');
});

test('ID OCR composes a name from separate given, middle, and family name fields', () => {
  const parsed = ocr.parseIdText([
    'FIRST NAME: Juan',
    'MIDDLE NAME: Alberto',
    'LAST NAME: Dela Cruz'
  ].join('\n'));

  assert.equal(parsed.fields.full_name, 'Juan Alberto Dela Cruz');
});

test('ID image validation accepts JPG, JPEG, and PNG under the 5 MB limit', () => {
  const examples = [
    { name: 'staff-id.JPG', type: 'image/jpeg', size: 128 },
    { name: 'staff-id.jpeg', type: 'image/jpeg', size: logic.ID_IMAGE_MAX_BYTES },
    { name: 'staff-id.png', type: 'image/png', size: 128 },
    { name: 'staff-id.png', type: '', size: 128 }
  ];

  examples.forEach(file => assert.deepEqual(logic.validateIdImageFile(file), { ok: true, message: '' }));
});

test('ID image validation rejects unsupported extensions and mismatched MIME types', () => {
  assert.match(logic.validateIdImageFile({ name: 'staff-id.gif', type: 'image/gif', size: 10 }).message, /Unsupported file type/);
  assert.match(logic.validateIdImageFile({ name: 'staff-id.jpg', type: 'image/png', size: 10 }).message, /Unsupported file type/);
});

test('ID image validation rejects files larger than 5 MB', () => {
  const result = logic.validateIdImageFile({
    name: 'staff-id.jpg',
    type: 'image/jpeg',
    size: logic.ID_IMAGE_MAX_BYTES + 1
  });

  assert.deepEqual(result, { ok: false, message: 'File exceeds the 5 MB maximum size.' });
});

test('closed-bill report totals keep voids separate and ignore unrelated legacy values', () => {
  const totals = logic.closedBillRevenueTotals([
    {
      closed_bill_count: 2,
      net_revenue: 1150,
      discount_total: 100,
      customers_served: 9,
      voided_bill_count: 2,
      voided_bill_amount: 450,
      legacy_revenue: 9999
    },
    {
      closed_bill_count: 0,
      net_revenue: 0,
      discount_total: 0,
      customers_served: 0,
      voided_bill_count: 0,
      voided_bill_amount: 0
    }
  ]);

  assert.deepEqual(totals, {
    closedBillCount: 2,
    netRevenue: 1150,
    discountTotal: 100,
    customersServed: 9,
    voidedBillCount: 2,
    voidedBillAmount: 450
  });
  assert.throws(() => logic.closedBillRevenueTotals(null), /must be an array/);
});

test('Lunch reservations fall back to the active All Day rate', () => {
  const rates = [{
    mealPeriod: 'All Day',
    dayType: 'weekday',
    adultRate: 449,
    childRate: 225,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isActive: true
  }];
  const rate = logic.activeBuffetRate(rates, 'Lunch', '2026-11-11', 'WEEKDAY');

  assert.equal(rate, rates[0]);
  assert.equal(logic.reservationRevenue({ guests: 2, adults: 2, children: 0 }, rate), 898);
});

test('missing buffet rate is represented without throwing', () => {
  const rate = logic.activeBuffetRate([], 'Lunch', '2026-11-11', 'weekday');

  assert.equal(rate, undefined);
  assert.equal(logic.reservationRevenue({ guests: 2, adults: 2, children: 0 }, rate), null);
});

test('reservation estimates and validated counts include Senior/PWD guests', () => {
  assert.deepEqual(
    logic.normalizeReservationGuestCounts('2', '1', '2'),
    { adults: 2, seniorPwdCount: 1, children: 2, total: 5 }
  );
  const counts = logic.normalizeReservationGuestCounts('4', '1', '2');
  assert.deepEqual(counts, { adults: 4, seniorPwdCount: 1, children: 2, total: 7 });
  assert.equal(
    logic.reservationRevenue(
      { guests: 7, adults: 4, seniorPwdCount: 1, children: 2 },
      { adultRate: 449, seniorPwdRate: 360, childRate: 225 }
    ),
    2606
  );
  assert.throws(() => logic.normalizeReservationGuestCounts(0, 0, 0), /between 1 and 1,000/);
  assert.throws(() => logic.normalizeReservationGuestCounts(1, -1, 1), /non-negative whole numbers/);
  assert.throws(() => logic.normalizeReservationGuestCounts(1, 0.5, 1), /non-negative whole numbers/);
});

test('reservation guest totals preserve large party counts above six', () => {
  const examples = [
    { adults: 7, seniorPwdCount: 0, children: 0, total: 7 },
    { adults: 5, seniorPwdCount: 1, children: 2, total: 8 },
    { adults: 5, seniorPwdCount: 2, children: 3, total: 10 },
    { adults: 6, seniorPwdCount: 2, children: 4, total: 12 }
  ];

  examples.forEach(({ adults, seniorPwdCount, children, total }) => {
    assert.deepEqual(
      logic.normalizeReservationGuestCounts(adults, seniorPwdCount, children),
      { adults, seniorPwdCount, children, total }
    );
  });
});

test('recent website reservation awareness requires a pending booking created within 24 hours', () => {
  const now = Date.parse('2026-11-19T06:00:00.000Z');
  const reservation = {
    source: 'Website',
    status: 'Pending',
    createdAt: new Date(now - 60 * 60 * 1000).toISOString()
  };

  assert.equal(logic.isRecentWebsiteReservation(reservation, now), true);
  assert.equal(logic.isRecentWebsiteReservation({
    ...reservation,
    createdAt: new Date(now - 25 * 60 * 60 * 1000).toISOString()
  }, now), false);
  assert.equal(logic.isRecentWebsiteReservation({
    ...reservation,
    status: 'Confirmed'
  }, now), false);
  assert.equal(logic.isRecentWebsiteReservation({
    ...reservation,
    source: 'Phone'
  }, now), false);
  assert.equal(logic.isRecentWebsiteReservation({
    ...reservation,
    createdAt: new Date(now + 60 * 1000).toISOString()
  }, now), false);
});

test('buffet rate lookup matches weekday, weekend, and holiday day types case-insensitively', () => {
  const rates = ['weekday', 'weekend', 'holiday'].map(dayType => ({
    mealPeriod: 'All Day',
    dayType: dayType.toUpperCase(),
    adultRate: 449,
    childRate: 225,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isActive: true
  }));

  for (const dayType of ['weekday', 'weekend', 'holiday']) {
    assert.equal(
      logic.activeBuffetRate(rates, 'Lunch', '2026-11-11', dayType),
      rates.find(rate => rate.dayType.toLowerCase() === dayType)
    );
  }
});

test('converts compatible units and rejects incompatible dimensions', () => {
  assert.equal(logic.convertQuantity(4000, g, kg), 4);
  assert.throws(() => logic.convertQuantity(1, kg, liter), /dimensions differ/);
});

test('recipe cost breakdown separates total batch cost from cost per portion', () => {
  const recipe = {
    batchYield: 4,
    wastage: 10,
    ingredients: [
      { ingredientId: 'rice', quantity: 2 },
      { ingredientId: 'chicken', quantity: 4 }
    ]
  };
  const ingredients = [
    { id: 'rice', name: 'Rice', unit: 'kg', cost: 10, stock: 7 },
    { id: 'chicken', name: 'Chicken', unit: 'kg', cost: 5, stock: 10 }
  ];
  const breakdown = logic.recipeCostBreakdown(recipe, ingredients);

  assert.equal(breakdown.totalBatchCost, 44);
  assert.equal(breakdown.costPerPortion, 11);
  assert.deepEqual(breakdown.ingredients.map(line => [line.name, line.lineCost, line.costPercent]), [
    ['Rice', 22, 50],
    ['Chicken', 22, 50]
  ]);
  assert.equal(logic.computedRecipeCost(recipe, ingredients), 44);
  assert.deepEqual(logic.recipeStockAvailability(recipe, ingredients), {
    batches: 2,
    limitingIngredientId: 'chicken'
  });
  assert.equal(logic.recipeFoodCostPercent(breakdown.costPerPortion, 449), 11 / 449 * 100);
});

test('production cost stays fixed to its snapshot after recipe cost changes', () => {
  const originalRecipe = {
    batchYield: 4,
    wastage: 10,
    ingredients: [{ ingredientId: 'rice', quantity: 2 }]
  };
  const originalIngredients = [{ id: 'rice', name: 'Rice', unit: 'kg', cost: 10, stock: 7 }];
  const log = { quantity: 1, batchCostSnapshot: 22 };
  const editedRecipe = { ...originalRecipe, ingredients: [{ ingredientId: 'rice', quantity: 8 }] };
  const editedIngredients = [{ ...originalIngredients[0], cost: 20 }];

  assert.equal(logic.productionLogCost(log, editedRecipe, editedIngredients), 22);
  assert.equal(logic.productionLogCost({ quantity: 2 }, editedRecipe, editedIngredients), 352);
});

test('recipe sanity warning flags an implausible unit quantity without blocking cost', () => {
  const recipe = {
    batchYield: 30,
    wastage: 0,
    ingredients: [{ ingredientId: 'oil', quantity: 101 }]
  };
  const ingredients = [{ id: 'oil', name: 'Cooking oil', unit: 'kg', cost: 20, stock: 500 }];
  const warnings = logic.recipeSanityWarnings(recipe, ingredients, 449);

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /101 kg.*verify the unit/);
  assert.equal(logic.recipeCostBreakdown(recipe, ingredients).totalBatchCost, 2020);
});

test('inactive recipe state is preserved and recognized', () => {
  assert.equal(logic.isRecipeActive({ isActive: true }), true);
  assert.equal(logic.isRecipeActive({ is_active: false }), false);
  assert.equal(logic.isRecipeActive({}), true);
});

test('plans FIFO consumption across batches using each batch cost', () => {
  const result = logic.planConsumption({
    batches: [
      { id: 'A', quantityRemaining: 50, unitCost: 120, receivedDate: '2026-11-01' },
      { id: 'B', quantityRemaining: 30, unitCost: 130, receivedDate: '2026-11-05' }
    ],
    quantity: 60,
    recipeUnit: kg,
    stockUnit: kg,
    asOfDate
  });

  assert.equal(result.isSufficient, true);
  assert.deepEqual(result.allocations.map(item => [item.batchId, item.quantity]), [['A', 50], ['B', 10]]);
  assert.equal(result.totalCost, 7300);
  assert.equal(result.shortageQuantity, 0);
});

test('does not consume expired batches and reports an exact shortage', () => {
  const result = logic.planConsumption({
    batches: [
      { id: 'expired', quantityRemaining: 20, unitCost: 5, receivedDate: '2026-10-01', expirationDate: '2026-11-10' },
      { id: 'active', quantityRemaining: 3, unitCost: 8, receivedDate: '2026-11-01' }
    ],
    quantity: 5,
    recipeUnit: kg,
    stockUnit: kg,
    asOfDate
  });

  assert.equal(result.isSufficient, false);
  assert.equal(result.allocatedQuantity, 3);
  assert.equal(result.shortageQuantity, 2);
  assert.deepEqual(result.allocations.map(item => item.batchId), ['active']);
});

test('FIFO uses the older batch first and warns when a newer batch expires sooner', () => {
  const result = logic.planConsumption({
    batches: [
      { id: 'older', quantityRemaining: 100, unitCost: 2, receivedDate: '2026-11-01', expirationDate: '2026-11-20' },
      { id: 'newer', quantityRemaining: 100, unitCost: 3, receivedDate: '2026-11-05', expirationDate: '2026-11-15' }
    ],
    quantity: 20,
    recipeUnit: kg,
    stockUnit: kg,
    asOfDate
  });
  assert.deepEqual(result.allocations.map(item => [item.batchId, item.quantity]), [['older', 20]]);
  assert.equal(result.warnings.length, 1);
});

test('FEFO sorts dated batches before undated batches', () => {
  const ordered = logic.orderBatches([
    { id: 'undated', receivedDate: '2026-11-01' },
    { id: 'later-expiry', receivedDate: '2026-11-01', expirationDate: '2026-12-01' },
    { id: 'sooner-expiry', receivedDate: '2026-11-05', expirationDate: '2026-11-15' }
  ], 'FEFO');
  assert.deepEqual(ordered.map(item => item.id), ['sooner-expiry', 'later-expiry', 'undated']);
});

test('classifies expiring, expired, and depleted stock and totals only available batches', () => {
  assert.equal(logic.batchStatus({ quantityRemaining: 2, expirationDate: '2026-11-13' }, asOfDate, 3).status, 'Expiring soon');
  assert.equal(logic.batchStatus({ quantityRemaining: 2, expirationDate: '2026-11-10' }, asOfDate, 3).status, 'Expired');
  assert.equal(logic.batchStatus({ quantityRemaining: 0 }, asOfDate).status, 'Depleted');
  assert.equal(logic.availableStock([
    { quantityRemaining: 4 },
    { quantityRemaining: 7, expirationDate: '2026-11-10' },
    { quantityRemaining: 3, status: 'Depleted' }
  ], asOfDate), 4);
});

test('computes stock health and batch-weighted average cost', () => {
  assert.equal(logic.stockHealth(0, 10), 'Out of Stock');
  assert.equal(logic.stockHealth(5, 10), 'Low Stock');
  assert.equal(logic.stockHealth(10, 10), 'Healthy');
  assert.equal(logic.weightedAverageUnitCost([
    { quantityRemaining: 50, unitCost: 120 },
    { quantityRemaining: 30, unitCost: 130 }
  ], asOfDate), 123.75);
});

test('modal type rules restrict backdrop and Escape behavior', () => {
  for (const type of ['form', 'money']) {
    assert.equal(logic.modalInteraction(type, 'backdrop'), 'ignore');
    assert.equal(logic.modalInteraction(type, 'escape'), 'request-close');
  }
  assert.equal(logic.modalInteraction('read-only', 'backdrop'), 'close');
  assert.equal(logic.modalInteraction('read-only', 'escape'), 'close');
  assert.equal(logic.modalInteraction('confirmation', 'backdrop'), 'ignore');
  assert.equal(logic.modalInteraction('confirmation', 'escape'), 'cancel');
  for (const type of ['popover', 'menu']) {
    assert.equal(logic.modalInteraction(type, 'backdrop'), 'close');
    assert.equal(logic.modalInteraction(type, 'escape'), 'close');
  }
});

test('notification feed deduplicates items and badge count equals unread rows', () => {
  const feed = logic.buildNotificationFeed([
    {
      key: 'stock:flour',
      dedupeKey: 'stock:flour',
      category: 'stock',
      title: 'Low stock',
      severity: 'warning',
      action: { view: 'receiving', label: 'Receive stock' }
    },
    {
      key: 'system:legacy-low-flour',
      dedupeKey: 'stock:flour',
      category: 'stock',
      title: 'Low stock',
      severity: 'warning',
      action: { view: 'receiving', label: 'Receive stock' }
    },
    {
      key: 'reservation:r1',
      category: 'reservation',
      title: 'Pending reservation',
      severity: 'info',
      action: { view: 'reservations', label: 'Review reservation' }
    }
  ], 'Manager', ['reservation:r1']);

  assert.equal(feed.length, 2);
  assert.equal(logic.notificationUnreadCount(feed), feed.filter(item => !item.isRead).length);
  assert.equal(logic.notificationUnreadCount(feed), 1);
});

test('notification role visibility excludes unauthorized operational and revenue alerts', () => {
  const stock = { category: 'stock' };
  const reservation = { category: 'reservation' };
  const pos = { category: 'pos' };
  const revenue = { category: 'system', type: 'Missing revenue entry' };

  assert.equal(logic.notificationVisibleToRole(stock, 'Inventory Clerk'), true);
  assert.equal(logic.notificationVisibleToRole(stock, 'Receptionist'), false);
  assert.equal(logic.notificationVisibleToRole(reservation, 'Receptionist'), true);
  assert.equal(logic.notificationVisibleToRole(reservation, 'Inventory Clerk'), false);
  assert.equal(logic.notificationVisibleToRole(pos, 'Manager'), true);
  assert.equal(logic.notificationVisibleToRole(pos, 'Receptionist'), false);
  assert.equal(logic.notificationVisibleToRole(revenue, 'Chef / Kitchen Staff'), false);
  assert.equal(logic.notificationVisibleToRole(revenue, 'Receptionist'), false);
});

test('notification actions are role-safe and point to the intended workflow', () => {
  const approval = {
    category: 'pos',
    action: { view: 'approvals', label: 'Open approval' }
  };
  const unresolved = {
    category: 'unresolved',
    action: { view: 'reservations', label: 'View unresolved bookings' }
  };

  assert.equal(logic.notificationActionForRole(approval, 'Manager').view, 'approvals');
  assert.equal(logic.notificationActionForRole(approval, 'Receptionist'), null);
  assert.equal(logic.notificationActionForRole(unresolved, 'Receptionist').view, 'reservations');
});

test('calendar legend and event presentation share accessible colors for every status', () => {
  const legend = logic.reservationCalendarStatusLegend();
  assert.deepEqual(legend.map(entry => entry.status), [
    'Pending', 'Confirmed', 'Seated', 'Checked-in', 'Completed', 'Cancelled', 'No-show'
  ]);

  const relativeLuminance = hex => {
    const channels = hex.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const { status, ...presentation } of legend) {
    assert.deepEqual(logic.reservationCalendarStatusPresentation(status), presentation);
    const contrast = relativeLuminance(presentation.color) > relativeLuminance(presentation.contrastColor)
      ? (relativeLuminance(presentation.color) + 0.05) / (relativeLuminance(presentation.contrastColor) + 0.05)
      : (relativeLuminance(presentation.contrastColor) + 0.05) / (relativeLuminance(presentation.color) + 0.05);
    assert.ok(contrast >= 4.5, `${status} event text contrast is below WCAG AA`);
  }
});

test('past unresolved marker applies only to earlier unresolved reservation statuses', () => {
  for (const status of ['Pending', 'Confirmed', 'Seated', 'Checked-in']) {
    assert.equal(logic.isPastUnresolvedReservation(status, '2026-11-17', '2026-11-18'), true);
    assert.equal(logic.isPastUnresolvedReservation(status, '2026-11-18', '2026-11-18'), false);
  }
  for (const status of ['Completed', 'Cancelled', 'No-show']) {
    assert.equal(logic.isPastUnresolvedReservation(status, '2026-11-17', '2026-11-18'), false);
  }
});

test('formats server timestamps as 12-hour Asia/Manila date and time', () => {
  assert.equal(
    logic.formatManilaTimestamp('2026-11-17T22:18:00.000Z'),
    '18/11/2026, 6:18 AM'
  );
  assert.throws(() => logic.formatManilaTimestamp('not-a-timestamp'), /invalid timestamp/i);
});

test('save completion does not wait for a separate list refresh', async () => {
  let releaseRefresh;
  let refreshFailure;
  const pendingRefresh = new Promise((resolve, reject) => {
    releaseRefresh = resolve;
  });
  const outcome = await logic.saveThenRefresh(
    async () => ({ id: 'saved-record' }),
    () => pendingRefresh,
    error => { refreshFailure = error; }
  );

  assert.deepEqual(outcome.saved, { id: 'saved-record' });
  releaseRefresh();
  await outcome.refresh;
  assert.equal(refreshFailure, undefined);

  const failedRefresh = new Error('refresh failed');
  const failedOutcome = await logic.saveThenRefresh(
    async () => 'committed',
    async () => { throw failedRefresh; },
    error => { refreshFailure = error; }
  );
  assert.equal(failedOutcome.saved, 'committed');
  await failedOutcome.refresh;
  assert.equal(refreshFailure, failedRefresh);

  let refreshStarted = false;
  await assert.rejects(logic.saveThenRefresh(
    async () => { throw new Error('save failed'); },
    async () => { refreshStarted = true; },
    () => {}
  ), /save failed/);
  assert.equal(refreshStarted, false);
});

test('tracks buffet prep targets across ready and cooking batches', () => {
  const progress = logic.productionProgress([
    { status: 'Ready', expectedCovers: 30 },
    { status: 'Ready', expectedCovers: 10 },
    { status: 'Cooking', expectedCovers: 30 },
    { status: 'Cooking', batchYield: 20, batchCount: 1 },
    { status: 'Cancelled', expectedCovers: 50 }
  ], 100);
  assert.deepEqual(progress, {
    target: 100,
    ready: 40,
    cooking: 50,
    remaining: 10,
    remainingAfterCooking: 60
  });
  assert.equal(logic.productionProgress([
    { status: 'Ready', expectedCovers: 65 },
    { status: 'Cooking', expectedCovers: 45 },
    { status: 'Cooking', expectedCovers: 20 }
  ], 100).remaining, 0);
  assert.throws(() => logic.productionProgress([], -1), /cannot be negative/);
});

test('enforces role actions and validates signed ledger movements', () => {
  assert.equal(logic.canPerformInventoryAction('Inventory Clerk', 'inventory.receive'), true);
  assert.equal(logic.canPerformInventoryAction('Inventory Clerk', 'product.manage'), false);
  assert.equal(logic.canPerformInventoryAction('Manager', 'product.manage'), false);
  assert.equal(logic.canPerformInventoryAction('Manager', 'inventory.receive'), true);
  assert.equal(logic.canPerformInventoryAction('Chef / Kitchen Staff', 'rates.manage'), false);
  assert.equal(logic.canPerformInventoryAction('Chef / Kitchen Staff', 'revenue.read'), false);
  assert.throws(() => logic.assertInventoryRole('Chef / Kitchen Staff', 'revenue.read'), { code: 'FORBIDDEN' });
  assert.throws(() => logic.createStockMovement({
    type: 'Production', quantity: 2, unitCost: 10, productId: 'p', batchId: 'b', referenceType: 'production', referenceId: '1'
  }), /negative quantity/);
  assert.equal(logic.createStockMovement({
    type: 'Production', quantity: -2, unitCost: 10, productId: 'p', batchId: 'b', referenceType: 'production', referenceId: '1'
  }).cost, 20);
});

test('limits two-hour reservation windows to restaurant hours and generates half-hour slots', () => {
  assert.equal(logic.isReservationTimeWithinOpenHours('10:00 AM'), true);
  assert.equal(logic.isReservationTimeWithinOpenHours('7:00 PM'), true);
  assert.equal(logic.isReservationTimeWithinOpenHours('07:00 PM'), true);
  assert.equal(logic.isReservationTimeWithinOpenHours('7:30 PM'), false);
  assert.equal(logic.isReservationTimeWithinOpenHours('8:30PM'), false);
  assert.equal(logic.isReservationTimeWithinOpenHours('9:00 PM'), false);
  assert.equal(logic.isReservationTimeWithinOpenHours('9:30 AM'), false);
  assert.equal(logic.isReservationTimeWithinOpenHours('invalid'), false);
  assert.equal(logic.reservationTimeSlots()[0], '10:00 AM');
  const slots = logic.reservationTimeSlots();
  assert.equal(slots[slots.length - 1], '7:00 PM');
  assert.equal(slots.length, 19);
  assert.equal(logic.reservationEndTime('7:00 PM'), '9:00 PM');
});

test('filters same-day reservation slots without blocking future dates', () => {
  const now = new Date(2026, 10, 16, 12, 1, 0);
  assert.equal(logic.reservationStartTimeIsInPast('2026-11-16', '12:00 PM', now), true);
  assert.equal(logic.reservationStartTimeIsInPast('2026-11-16', '12:30 PM', now), false);
  assert.equal(logic.reservationStartTimeIsInPast('2026-11-16', '12:30 PM', new Date(2026, 10, 16, 12, 30, 0)), false);
  assert.equal(logic.reservationStartTimeIsInPast('2026-11-16', '12:30 PM', new Date(2026, 10, 16, 12, 30, 1)), true);
  assert.equal(logic.reservationStartTimeIsInPast('2026-11-17', '10:00 AM', now), false);

  const todaySlots = logic.reservationTimeSlots('2026-11-16', now);
  assert.equal(todaySlots.includes('12:00 PM'), false);
  assert.equal(todaySlots.includes('12:30 PM'), true);
  assert.equal(logic.reservationTimeSlots('2026-11-17', now).length, 19);
});

test('preserves generated reservation IDs despite the form hidden ID and retains existing booking type', () => {
  const first = logic.buildReservationRecord(
    null,
    { id: '', name: 'Customer One', type: '' },
    'RS-FIRST'
  );
  const second = logic.buildReservationRecord(
    null,
    { id: '', name: 'Customer Two', type: '' },
    'RS-SECOND'
  );
  const edited = logic.buildReservationRecord(
    { id: 'RS-FIRST', type: 'Walk-in', name: 'Original' },
    { id: 'RS-FIRST', type: 'Reservation', name: 'Updated' },
    'RS-UNUSED'
  );

  assert.equal(first.id, 'RS-FIRST');
  assert.equal(second.id, 'RS-SECOND');
  assert.notEqual(first.id, second.id);
  assert.equal(edited.id, 'RS-FIRST');
  assert.equal(edited.type, 'Walk-in');
});

test('derives live table availability from bookings and checks overlapping two-hour windows', () => {
  const table = { id: 'T1', status: 'Available' };
  const bookings = [
    { id: 'r2', table: 'T1', date: '2026-11-12', time: '6:00 PM', status: 'Confirmed' },
    { id: 'r1', table: 'T1', date: '2026-11-12', time: '11:00 AM', status: 'Pending' },
    { id: 'no-show', table: 'T1', date: '2026-11-12', time: '3:00 PM', status: 'No-show' },
    { id: 'old', table: 'T1', date: '2026-11-12', time: '1:00 PM', status: 'Cancelled' }
  ];

  const availability = logic.tableAvailability(table, bookings, '2026-11-12', '2026-11-12');
  assert.equal(availability.status, 'Reserved Active');
  assert.equal(availability.primaryBooking.id, 'r1');
  assert.equal(logic.tableHasReservationConflict('T1', '2026-11-12', '6:00 PM', bookings), true);
  assert.equal(logic.tableHasReservationConflict('T1', '2026-11-12', '6:00 PM', bookings, 'r2'), false);
  assert.equal(logic.tableHasReservationConflict('T1', '2026-11-12', '12:30 PM', bookings), true);
  assert.equal(logic.tableHasReservationConflict('T1', '2026-11-12', '1:00 PM', bookings), false);
  assert.equal(logic.tableHasReservationConflict('T1', '2026-11-12', '3:00 PM', bookings), false);
  assert.equal(logic.reservationTimeOverlaps('1:00 PM', '2:30 PM'), true);
  assert.equal(logic.reservationTimeOverlaps('1:00 PM', '3:00 PM'), false);
  const sameDayBookings = [
    { id: 'first', table: 'T07', date: '2026-11-13', time: '1:00 PM', status: 'Pending' },
    { id: 'second', table: 'T15', date: '2026-11-13', time: '3:00 PM', status: 'Pending' }
  ];
  assert.equal(logic.tableHasReservationConflict('T07', '2026-11-13', '3:00 PM', sameDayBookings), false);
  assert.equal(logic.tableHasReservationConflict('T15', '2026-11-13', '1:00 PM', sameDayBookings), false);
  assert.equal(logic.tableHasReservationConflict('T07', '2026-11-13', '1:00 PM', sameDayBookings), true);

  const occupied = logic.tableAvailability(
    table,
    [...bookings, { id: 'r3', table: 'T1', date: '2026-11-12', time: '2:00 PM', status: 'Seated' }],
    '2026-11-12',
    '2026-11-12'
  );
  assert.equal(occupied.status, 'Occupied');
  assert.equal(occupied.primaryBooking.id, 'r3');

  const staleOccupied = logic.tableAvailability(
    { id: 'T2', status: 'Occupied', guest: 'Old cached guest' },
    [],
    '2026-11-12',
    '2026-11-12'
  );
  assert.equal(staleOccupied.status, 'Available');
  assert.equal(staleOccupied.primaryBooking, null);
});

test('distinguishes a reservation with safe walk-in time from one that must be protected now', () => {
  const booking = {
    id: 'reservation-noon',
    table: 'T1',
    date: '2026-11-13',
    time: '12:00 PM',
    status: 'Confirmed'
  };
  const bookings = [booking];
  const table = { id: 'T1', status: 'Available' };

  assert.equal(
    logic.tableAvailability(table, bookings, '2026-11-13', '2026-11-13', 9 * 60).status,
    'Reserved Later'
  );
  assert.equal(
    logic.tableAvailability(table, bookings, '2026-11-13', '2026-11-13', 10 * 60).status,
    'Reserved Later'
  );
  assert.equal(
    logic.tableAvailability(table, bookings, '2026-11-13', '2026-11-13', 10 * 60 + 1).status,
    'Reserved Active'
  );
  assert.equal(
    logic.tableAvailability(table, bookings, '2026-11-13', '2026-11-13', 12 * 60).status,
    'Reserved Active'
  );
  assert.equal(
    logic.tableAvailability(table, [{ ...booking, date: '2026-11-14' }], '2026-11-14', '2026-11-13', 9 * 60).status,
    'Reserved Later'
  );

  assert.equal(
    logic.tableHasReservationConflict('T1', '2026-11-13', '9:30 AM', bookings),
    false
  );
  assert.equal(
    logic.tableHasReservationConflict('T1', '2026-11-13', '10:00 AM', bookings),
    false
  );
  assert.equal(
    logic.tableHasReservationConflict('T1', '2026-11-13', '11:00 AM', bookings),
    true
  );
  assert.equal(
    logic.tableReservationConflict('T1', '2026-11-13', '11:00 AM', bookings).id,
    'reservation-noon'
  );
});

test('keeps an overdue seated table occupied and marks it for staff attention', () => {
  const now = new Date(2026, 10, 13, 15, 0);
  const seated = {
    id: 'walk-in-1',
    table: 'T1',
    date: '2026-11-13',
    time: '1:00 PM',
    seatedAt: '2026-11-13T13:15:00Z',
    status: 'Seated'
  };
  const availability = logic.tableAvailability(
    { id: 'T1', status: 'Available' },
    [seated],
    '2026-11-13',
    '2026-11-13',
    15 * 60,
    now
  );
  assert.equal(availability.status, 'Occupied');
  assert.equal(availability.stayLimitReached, true);
  assert.equal(logic.reservationStayLimitReached(seated, new Date(2026, 10, 13, 14, 59)), false);
});

test('keeps an unresolved prior-day seating occupied and blocks a new assignment today', () => {
  const priorDaySeating = {
    id: 'walk-in-previous-day',
    table: 'T1',
    date: '2026-11-12',
    time: '8:00 PM',
    status: 'Seated'
  };
  const availability = logic.tableAvailability(
    { id: 'T1', status: 'Available' },
    [priorDaySeating],
    '2026-11-13',
    '2026-11-13',
    10 * 60,
    new Date(2026, 10, 13, 10, 0)
  );
  assert.equal(availability.status, 'Occupied');
  assert.equal(availability.primaryBooking.id, 'walk-in-previous-day');
  assert.equal(
    logic.tableHasReservationConflict('T1', '2026-11-13', '10:00 AM', [priorDaySeating], '', '2026-11-13'),
    true
  );
});

test('flags unclosed bookings whose two-hour window has passed', () => {
  const booking = {
    id: 'reservation-1',
    table: 'T1',
    date: '2026-11-13',
    time: '10:00 AM',
    status: 'Confirmed'
  };
  const availability = logic.tableAvailability(
    { id: 'T1' },
    [booking],
    '2026-11-13',
    '2026-11-13',
    12 * 60
  );
  assert.equal(availability.status, 'Reserved Active');
  assert.equal(availability.bookingWindowEnded, true);
});

test('reconciles existing tables to the requested layout while preserving IDs and reservation details', () => {
  const emptyPlan = logic.planRestaurantTableLayout([]);
  assert.equal(emptyPlan.expectedTableCount, 15);
  assert.equal(emptyPlan.additions.length, 15);
  assert.equal(emptyPlan.additions.filter(table => table.tableType === 'Family').length, 3);
  assert.equal(emptyPlan.additions.filter(table => table.tableType === 'Casual' && table.area === 'Front').length, 6);
  assert.equal(emptyPlan.additions.filter(table => table.tableType === 'Casual' && table.area === 'Back').length, 6);
  assert.deepEqual(
    emptyPlan.additions.reduce((counts, table) => {
      counts[table.seats] = (counts[table.seats] || 0) + 1;
      return counts;
    }, {}),
    { 2: 1, 4: 4, 5: 3, 6: 3, 8: 2, 12: 2 }
  );

  const existing = [
    { id: 'T08', seats: 4, status: 'Reserved', tableType: 'Unassigned', area: 'Unassigned', guest: 'Guest A' },
    { id: 'T09', seats: 8, status: 'Available', tableType: 'Unassigned', area: 'Unassigned', guest: '' },
    { id: 'T10', seats: 12, status: 'Occupied', tableType: 'Unassigned', area: 'Unassigned', guest: 'Guest B' }
  ];
  const plan = logic.planRestaurantTableLayout(existing, [], '2026-11-12');
  assert.equal(plan.updates.length, 3);
  assert.equal(plan.additions.length, 12);
  assert.deepEqual(plan.updates.map(table => [table.id, table.seats]), [['T08', 12], ['T09', 12], ['T10', 8]]);
  for (const original of existing) {
    const updated = plan.updates.find(table => table.id === original.id);
    assert.ok(updated);
    assert.equal(updated.status, original.status);
    assert.equal(updated.guest, original.guest);
  }

  const finalTables = [...plan.updates, ...plan.additions];
  assert.equal(finalTables.length, 15);
  assert.equal(finalTables.reduce((sum, table) => sum + table.seats, 0), 91);
  assert.deepEqual(
    finalTables.reduce((counts, table) => {
      counts[table.seats] = (counts[table.seats] || 0) + 1;
      return counts;
    }, {}),
    { 2: 1, 4: 4, 5: 3, 6: 3, 8: 2, 12: 2 }
  );
});

test('blocks a capacity reduction that would make an upcoming active reservation too large', () => {
  const plan = logic.planRestaurantTableLayout(
    [
      { id: 'T01', seats: 12 },
      { id: 'T02', seats: 12 },
      { id: 'T03', seats: 12, status: 'Reserved' }
    ],
    [
      { id: 'active', table: 'T03', date: '2026-11-13', status: 'Confirmed', guests: 10 },
      { id: 'past', table: 'T03', date: '2026-11-10', status: 'Completed', guests: 12 },
      { id: 'cancelled', table: 'T03', date: '2026-11-14', status: 'Cancelled', guests: 12 }
    ],
    '2026-11-12'
  );
  assert.deepEqual(plan.conflicts, [{ tableId: 'T03', targetSeats: 8, reservationIds: ['active'] }]);
});

test('preserves extra legacy tables and marks them unclassified', () => {
  const plan = logic.planRestaurantTableLayout([
    ...Array.from({ length: 15 }, (_, index) => ({ id: `T${String(index + 1).padStart(2, '0')}`, seats: 2 })),
    { id: 'T16', seats: 6, tableType: 'Casual', area: 'Front', status: 'Available' }
  ], [], '2026-11-12');
  assert.equal(plan.additions.length, 0);
  assert.equal(plan.unmatchedTables.length, 1);
  assert.deepEqual(plan.updates.find(table => table.id === 'T16'), {
    id: 'T16', seats: 6, tableType: 'Unassigned', area: 'Unassigned', status: 'Available'
  });
});
