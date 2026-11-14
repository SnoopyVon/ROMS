const KEYS = ['ingredients', 'recipes', 'inventoryTransactions', 'productionLogs', 'revenueRecords', 'wasteLogs', 'physicalCounts', 'users', 'reservations', 'restaurantTables', 'buffetRates', 'chargeItems', 'chargeItemVariants', 'packageTiers', 'packageInclusions', 'discounts', 'posSettings', 'shifts', 'cashMovements', 'posBills', 'billLines', 'billPayments', 'reservationDeposits', 'billApprovals'];
const DATA_STORAGE_KEYS = [...KEYS.map(key => `costtrack_${key}`), 'costtrack_pending_sync_anonymous'];
function clearDataStorage() {
  DATA_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
  Object.keys(localStorage).filter(key => key.startsWith('costtrack_pending_sync_')).forEach(key => localStorage.removeItem(key));
}
clearDataStorage();
const state = {
  view: window.location.hash.slice(1) || 'dashboard',
  role: null,
  user: null,
  query: '',
  sidebarFlyoutGroup: null,
  paletteItems: [],
  paletteSelection: 0,
  focusPageAfterNavigation: false
};
let modalOpener = null;
let passwordRecoveryMode = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
let supabaseSyncEnabled = false;
let realtimeChannel = null;
let realtimeSubscriptionKey = '';
let realtimeRefreshTimer = null;
let realtimeConnected = false;
let realtimeConfigPromise = null;
let realtimeRequestedKey = '';
let reservationCalendar = null;
let lastSavedAt = null;
const recentLocalChanges = new Set();
const collectionState = Object.fromEntries(KEYS.map(key => [key, []]));
state.ingredientStatus = 'All';
state.ingredientCategory = 'All';
state.ingredientUnit = 'All';
state.recipeCategory = 'All';
state.recipeDraft = [];
state.productionCategory = 'All';
state.productionBoard = { date: '', rows: [], loading: false, loaded: false, error: '' };
state.productionHistoryOpen = false;
state.productionHistory = {
  from: '', to: '', timeFrom: '', timeTo: '', dish: 'All', status: 'All',
  rows: [], loading: false, loaded: false, error: ''
};
state.wasteFilters = {
  from: '', to: '', timeFrom: '', timeTo: '', ingredient: 'All', reason: 'All', staff: 'All'
};
state.receivingDraft = [];
state.receivingForm = {};
state.reservationFilter = 'All';
state.reservationTypeFilter = 'All';
state.calendarDate = '';
state.reservationCalendarDate = '';
state.reservationCalendarView = 'dayGridMonth';
state.reservationCalendarStatus = 'All';
state.reservationCalendarType = 'All';
state.reservationCalendarQuery = '';
state.tableManagementDate = '';
state.tableManagementStatus = 'All';
state.tableManagementCapacity = 'All';
state.tableManagementType = 'All';
state.tableManagementArea = 'All';
state.tableManagementQuery = '';
state.revenueRange = '30';
state.revenueStatus = 'Active';
state.ingredientView = localStorage.getItem('costtrack_ingredient_view') || 'cards';
state.ingredientSort = 'name';
state.ingredientSortDirection = 'asc';
state.reservationMealPeriodFilter = 'All';
state.reservationDateFilter = 'All';
state.dateRange = '30';
state.modalDirty = false;
state.reportTab = state.reportTab || 'food_cost';
state.reportGrouping = state.reportGrouping || 'day';
state.reportIncludeWaste = state.reportIncludeWaste !== false;
const reportServerData = {};
let reportRequestKey = '';
let reportRequestPending = false;
let reportDataVersion = 0;
let reportChartSpecs = [];
let reportCharts = [];
try {
  const savedReservationFilters = JSON.parse(sessionStorage.getItem('costtrack_reservation_filters') || 'null');
  if (savedReservationFilters) Object.assign(state, savedReservationFilters);
} catch (error) {
  console.warn('Reservation filter preferences could not be restored.', error);
}
if (!['Lunch', 'Dinner'].includes(state.reservationMealPeriodFilter)) state.reservationMealPeriodFilter = 'All';
function persistReservationFilters() {
  sessionStorage.setItem('costtrack_reservation_filters', JSON.stringify({
    reservationFilter: state.reservationFilter,
    reservationTypeFilter: state.reservationTypeFilter,
    reservationMealPeriodFilter: state.reservationMealPeriodFilter,
    reservationDateFilter: state.reservationDateFilter
  }));
}
const roleAccess = {
  'Administrator': ['dashboard', 'ingredients', 'receiving', 'recipes', 'production', 'waste', 'counts', 'reports', 'revenue', 'rates', 'users', 'roles', 'settings', 'reservations', 'calendar', 'tables', 'cashier', 'shifts', 'approvals', 'charge-catalog'],
  'Manager': ['dashboard', 'ingredients', 'receiving', 'recipes', 'production', 'waste', 'counts', 'reports', 'revenue', 'rates', 'reservations', 'calendar', 'tables', 'cashier', 'shifts', 'approvals', 'charge-catalog'],
  'Inventory Clerk': ['ingredients', 'receiving', 'counts', 'reports'],
  'Chef / Kitchen Staff': ['recipes', 'production', 'waste'],
  'Receptionist': ['dashboard', 'reservations', 'calendar', 'tables', 'cashier', 'shifts', 'approvals']
};
const canAccess = view => Boolean(roleAccess[state.role]?.includes(view));
const canAccessRevenue = () => ['Administrator', 'Manager'].includes(state.role);
const canManageRates = () => ['Administrator', 'Manager'].includes(state.role);
const canCreateDraft = () => ['Administrator', 'Manager', 'Receptionist'].includes(state.role);
const canVoidRevenue = () => state.role === 'Administrator';
const app = document.querySelector('#app');
const money = value => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };

function localDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateRangeBounds() {
  if (state.dateRange === 'custom') {
    const start = state.customDateFrom || '';
    const end = state.customDateTo || '';
    return start && end && start <= end ? [start, end] : ['', ''];
  }
  const days = [7, 30, 90, 365].includes(Number(state.dateRange)) ? Number(state.dateRange) : 30;
  const end = today();
  const startDate = new Date(`${end}T12:00:00`);
  startDate.setDate(startDate.getDate() - days + 1);
  return [localDateStr(startDate), end];
}

function dateRangeControls() {
  const custom = state.dateRange === 'custom';
  return `<label>Date range<select data-date-range aria-label="Report date range"><option value="7" ${state.dateRange === '7' ? 'selected' : ''}>Last 7 days</option><option value="30" ${state.dateRange === '30' ? 'selected' : ''}>Last 30 days</option><option value="90" ${state.dateRange === '90' ? 'selected' : ''}>Last 90 days</option><option value="365" ${state.dateRange === '365' ? 'selected' : ''}>Last year</option><option value="custom" ${custom ? 'selected' : ''}>Custom range</option></select></label>${custom ? `<label>From<input type="date" data-custom-date="from" value="${esc(state.customDateFrom || '')}" required></label><label>To<input type="date" data-custom-date="to" value="${esc(state.customDateTo || '')}" required></label>` : ''}`;
}

function parseTime12h(timeStr) {
  return window.CostTrackLogic.parseReservationTime(timeStr);
}
function liveTableAvailability(table, date = today(), reservations = all('reservations'), now = new Date()) {
  return window.CostTrackLogic.tableAvailability(
    table,
    reservations,
    date,
    today(),
    now.getHours() * 60 + now.getMinutes(),
    now
  );
}
const read = key => collectionState[key] || [];
function currentUserName() {
  return state.user?.full_name?.trim() || state.user?.email || 'Signed-in user';
}
function currentUserInitials() {
  return currentUserName().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'U';
}
function dashboardGreeting() {
  const firstName = currentUserName().split(/[\s@._-]+/).filter(Boolean)[0];
  return firstName ? `Good morning, ${esc(firstName)}.` : 'Welcome to CostTrack.';
}
async function save(key, value) {
  if (key === 'users') {
    toast('User accounts must be managed through Supabase Auth.', 'error');
    throw new Error('User accounts must be managed through Supabase Auth.');
  }
  return saveCollections({ [key]: value });
}
async function saveCollections(changes) {
  if (!state.user || !supabaseSyncEnabled) throw new Error('Cloud data is not ready. Please wait for the initial load.');
  if (!navigator.onLine) throw new Error('You are offline. Reconnect to save.');
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, read(key)]));
  const touched = Object.keys(changes);
  setSyncState('syncing');
  try {
    for (const key of touched) {
      const oldRecords = new Map(previous[key].map(record => [String(record.id), record]));
      const newRecords = new Map(changes[key].map(record => [String(record.id), record]));
      for (const recordId of [...oldRecords.keys()].filter(value => !newRecords.has(value))) {
        await window.supabaseRecord.remove(key, recordId, window.supabaseRecord.version(key, recordId));
      }
      for (const record of changes[key].filter(value => JSON.stringify(oldRecords.get(String(value.id))) !== JSON.stringify(value))) {
        await window.supabaseRecord.upsert(key, record, window.supabaseRecord.version(key, record.id));
      }
    }
    for (const key of touched) collectionState[key] = await window.supabaseRecord.load(key);
    invalidateReportData();
    setPostSaveSyncState();
    render();
  } catch (error) {
    console.error('Cloud write failed.', error);
    for (const key of touched) {
      try { collectionState[key] = await window.supabaseRecord.load(key); }
      catch (refreshError) { console.error(`Could not restore ${key} after failed write.`, refreshError); }
    }
    setSyncState(navigator.onLine ? 'error' : 'offline', error.message);
    toast(navigator.onLine ? friendlyRpcError(error) : 'You are offline. Reconnect to save.', 'error');
    render();
    throw error;
  }
}
async function saveRecord(key, record) {
  if (!state.user || !supabaseSyncEnabled) throw new Error('Cloud data is not ready. Please wait for the initial load.');
  if (!navigator.onLine) throw new Error('You are offline. Reconnect to save.');
  setSyncState('syncing');
  rememberLocalChange(key, record.id);
  try {
    await window.supabaseRecord.upsert(key, record);
    collectionState[key] = await window.supabaseRecord.load(key);
    setPostSaveSyncState();
    render();
  } catch (error) {
    console.error(`Single-record save failed for ${key}.`, error);
    try { collectionState[key] = await window.supabaseRecord.load(key); }
    catch (refreshError) { console.error(`Could not restore ${key} after a failed record save.`, refreshError); }
    setSyncState(navigator.onLine ? 'error' : 'offline', error.message);
    render();
    throw error;
  }
}
async function removeRecord(key, recordId) {
  if (!state.user || !supabaseSyncEnabled) throw new Error('Cloud data is not ready. Please wait for the initial load.');
  if (!navigator.onLine) throw new Error('You are offline. Reconnect to save.');
  setSyncState('syncing');
  rememberLocalChange(key, recordId);
  try {
    await window.supabaseRecord.remove(key, recordId, window.supabaseRecord.version(key, recordId));
    collectionState[key] = await window.supabaseRecord.load(key);
    setPostSaveSyncState();
    render();
  } catch (error) {
    console.error(`Single-record delete failed for ${key}.`, error);
    try { collectionState[key] = await window.supabaseRecord.load(key); }
    catch (refreshError) { console.error(`Could not restore ${key} after a failed record delete.`, refreshError); }
    setSyncState(navigator.onLine ? 'error' : 'offline', error.message);
    render();
    throw error;
  }
}
async function saveDelivery(payload) {
  const touched = ['inventoryTransactions', 'ingredients'];
  setSyncState('syncing');
  try {
    if (!state.user || !supabaseSyncEnabled) throw new Error('Cloud data is not ready. Please wait for the initial load.');
    if (!navigator.onLine) throw new Error('You are offline. Reconnect to save.');
    await window.supabaseRecord.receiveDelivery(payload);
    for (const key of touched) collectionState[key] = await window.supabaseRecord.load(key);
    invalidateReportData();
    setPostSaveSyncState();
  } catch (error) {
    console.error('Delivery invoice save failed.', error);
    for (const key of touched) {
      try { collectionState[key] = await window.supabaseRecord.load(key); }
      catch (refreshError) { console.error(`Could not restore ${key} after failed delivery save.`, refreshError); }
    }
    setSyncState(navigator.onLine ? 'error' : 'offline', error.message);
    toast(navigator.onLine ? friendlyRpcError(error) : 'You are offline. Reconnect to save.', 'error');
    render();
    throw error;
  }
}
const all = key => read(key);
document.addEventListener('click', async event => {
  const action = event.target.closest('[data-action="void-revenue"]');
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!canVoidRevenue()) return toast('Only Administrators can void revenue.', 'error');
  if (!confirm('Void this revenue record? This action is recorded and cannot be undone.')) return;
  const reason = prompt('Why is this revenue record being voided?');
  if (!reason?.trim()) return;
  try {
    await save('revenueRecords', all('revenueRecords').map(item => item.id === action.dataset.id ? { ...item, status: 'Voided', voided_by: state.role, void_reason: reason.trim(), voided_at: new Date().toISOString() } : item));
    toast('Revenue record voided');
    render();
  } catch (error) {
    console.error('Revenue void failed.', error);
  }
}, true);
const ingredient = id => all('ingredients').find(item => item.id === id);
const recipe = id => all('recipes').find(item => item.id === id);
const id = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
function createRevenueRecord(data) {
  return window.CostTrackLogic.createRevenueRecord(data);
}
function computedRecipeCost(item) { return window.CostTrackLogic.computedRecipeCost(item, all('ingredients')); }
function inventoryValue() { return all('ingredients').reduce((sum, item) => sum + item.stock * item.cost, 0); }
function productionCost(date) { return all('productionLogs').filter(item => !date || item.date === date).reduce((sum, item) => sum + computedRecipeCost(recipe(item.recipeId) || { ingredients: [] }) * Number(item.quantity || 0), 0); }
function wasteCost(date) { return all('wasteLogs').filter(item => !date || item.date === date).reduce((sum, item) => sum + item.quantity * (ingredient(item.ingredientId)?.cost || 0), 0); }
function revenueRecords() { return canAccessRevenue() ? all('revenueRecords') : []; }
function profitability(date, record) {
  const revenue = Number(record?.total_revenue || 0);
  const production = productionCost(date);
  const waste = wasteCost(date);
  const profit = revenue - production - waste;
  return { revenue, production, waste, profit, foodCostPercent: revenue ? production / revenue * 100 : null, wasteCostPercent: revenue ? waste / revenue * 100 : null, profitMargin: revenue ? profit / revenue * 100 : null };
}
function reservationRevenue(item) { return window.CostTrackLogic.reservationRevenue(item); }
function buffetRevenue(date = today()) { return all('reservations').filter(item => item.date === date && item.status !== 'Cancelled' && item.status !== 'No-show').reduce((sum, item) => sum + reservationRevenue(item, activeBuffetRate(item, date) || {}), 0); }
function activeBuffetRate(item, date = item?.date || today()) {
  const dayType = [0, 6].includes(new Date(`${date}T12:00:00`).getDay()) ? 'weekend' : 'weekday';
  return all('buffetRates').filter(rate => rate.isActive && rate.mealPeriod === (item?.mealPeriod || 'All Day') && rate.dayType === dayType && rate.effectiveFrom <= date && (!rate.effectiveTo || rate.effectiveTo >= date)).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}
function friendlyRpcError(error) {
  const message = String(error?.message || error || '');
  if (/reservation time must be within restaurant hours|two-hour reservation window/i.test(message)) return 'Choose a start time from 10:00 AM through 7:00 PM so the two-hour stay ends by closing at 9:00 PM.';
  if (/production would make stock negative/i.test(message)) return 'Not enough inventory is available to complete this batch. Ask an Inventory Clerk to check the stock before marking it ready.';
  if (/table_type|restaurant_tables.*area/i.test(message) && /column|schema cache|does not exist/i.test(message)) return 'Apply the Phase 15 table layout migration in Supabase, then reload the app.';
  if (/reservations_active_assigned_table_uidx|overlapping two-hour reservation/i.test(message)) return 'That table already has an overlapping two-hour reservation.';
  if (/selected table does not have enough seats/i.test(message)) return 'This table does not have enough seats for the reservation.';
  if (/table capacity cannot be reduced/i.test(message)) return 'Capacity cannot be reduced below an active party already assigned to this table.';
  if (/tables linked to reservation history/i.test(message)) return 'This table is linked to reservation history and cannot be deleted.';
  if (/foreign key|violates.*constraint|referenced/i.test(message)) {
    if (/ingredient/i.test(message)) return 'This ingredient is used by recipes or inventory history and cannot be deleted.';
    if (/recipe/i.test(message)) return 'This recipe is used by production history and cannot be deleted.';
    if (/reservation/i.test(message)) return 'This reservation is linked to other records and cannot be deleted.';
    return 'This record is used by other data and cannot be deleted.';
  }
  if (/no active buffet rate/i.test(message)) return 'No active buffet rate exists for this service date.';
  if (/not authorized|permission denied|42501/i.test(message)) return 'You do not have permission to perform this action.';
  if (/status|lifecycle|transition/i.test(message)) return 'That reservation status transition is not valid.';
  if (/rate limit|unable to process reservation request/i.test(message)) return 'Too many requests. Please wait a moment and try again.';
  return message || 'The request could not be completed.';
}
function lowStock() { return all('ingredients').filter(item => item.stock <= item.minimum); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function toast(message, type = 'success') { const root = document.querySelector('#toastRoot'); root.innerHTML = `<div class="toast ${type}">${type === 'success' ? '✓' : '!'} ${esc(message)}</div>`; setTimeout(() => root.innerHTML = '', 3200); }
const syncStates = {
  live: { label: 'Saved', color: 'live', icon: 'check' },
  syncing: { label: 'Saving…', color: 'syncing', icon: 'refresh' },
  reconnecting: { label: 'Reconnecting…', color: 'reconnecting', icon: 'refresh' },
  offline: { label: 'Offline', color: 'offline', icon: 'cloud-off' },
  error: { label: 'Error', color: 'error', icon: 'alert' }
};
function setSyncState(state, detail = '', labelOverride = '') {
  const badge = document.querySelector('#syncStatus');
  if (!badge) return;
  const definition = syncStates[state] || syncStates.error;
  badge.dataset.state = definition.color;
  const label = labelOverride || definition.label;
  badge.innerHTML = `${shellIcon(definition.icon)}<span>${esc(label)}</span><i class="sync-dot" aria-hidden="true"></i>`;
  const lastSaveLabel = lastSavedAt
    ? `Last saved to the cloud at ${lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
    : '';
  badge.title = detail || (state === 'live' && lastSaveLabel) || label;
  badge.setAttribute('aria-label', badge.title);
  const discard = document.querySelector('#discardSyncButton');
  if (discard) discard.classList.add('is-hidden');
}
function setPostSaveSyncState() {
  if (!navigator.onLine) return setSyncState('offline');
  lastSavedAt = new Date();
  const savedAt = lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (realtimeConnected) return setSyncState('live', `Saved to the cloud at ${savedAt}.`);
  setSyncState('live', `Saved to the cloud at ${savedAt}. Realtime is reconnecting.`);
}
function rememberLocalChange(collection, recordId) {
  const key = `${collection}:${recordId}`;
  recentLocalChanges.add(key);
  setTimeout(() => recentLocalChanges.delete(key), 4000);
}
function realtimeCollectionsForView() {
  const common = {
    ingredients: ['ingredients'],
    receiving: ['ingredients', 'inventory_transactions'],
    recipes: ['ingredients', 'recipes', 'recipe_ingredients'],
    production: ['ingredients', 'recipes', 'production_logs', 'production_batches', 'reservations'],
    waste: ['ingredients', 'waste_logs', 'production_logs'],
    counts: ['ingredients', 'physical_counts'],
    reservations: ['reservations', 'restaurant_tables'],
    calendar: ['reservations', 'restaurant_tables'],
    tables: ['reservations', 'restaurant_tables'],
    cashier: ['pos_bills', 'pos_bill_lines', 'pos_bill_payments', 'pos_reservation_deposits', 'pos_bill_approvals', 'reservations'],
    shifts: ['pos_shifts', 'pos_cash_movements'],
    approvals: ['pos_bills', 'pos_bill_approvals'],
    'charge-catalog': ['pos_charge_items', 'pos_package_tiers', 'pos_discounts', 'pos_settings'],
    rates: ['buffet_rates'],
    revenue: ['revenue_records', 'production_logs', 'waste_logs', 'reservations'],
    reports: ['ingredients', 'recipes', 'recipe_ingredients', 'production_logs', 'waste_logs', 'inventory_transactions', 'physical_counts', 'revenue_records', 'reservations']
  };
  if (state.view === 'dashboard') {
    if (state.role === 'Receptionist') return ['reservations', 'restaurant_tables'];
    if (state.role === 'Inventory Clerk') return ['ingredients', 'inventory_transactions', 'physical_counts'];
    if (state.role === 'Chef / Kitchen Staff') return ['ingredients', 'recipes', 'production_logs', 'waste_logs', 'reservations'];
    return ['ingredients', 'recipes', 'production_logs', 'waste_logs', 'reservations', 'restaurant_tables', 'revenue_records', 'buffet_rates'];
  }
  return common[state.view] || [];
}
function realtimeTablesForRole(tables) {
  const allowed = {
    Administrator: ['ingredients', 'recipes', 'recipe_ingredients', 'inventory_transactions', 'production_logs', 'production_batches', 'waste_logs', 'physical_counts', 'reservations', 'restaurant_tables', 'revenue_records', 'buffet_rates', 'pos_charge_items', 'pos_charge_item_variants', 'pos_package_tiers', 'pos_package_inclusions', 'pos_discounts', 'pos_settings', 'pos_shifts', 'pos_cash_movements', 'pos_bills', 'pos_bill_lines', 'pos_bill_payments', 'pos_reservation_deposits', 'pos_bill_approvals'],
    Manager: ['ingredients', 'recipes', 'recipe_ingredients', 'inventory_transactions', 'production_logs', 'production_batches', 'waste_logs', 'physical_counts', 'reservations', 'restaurant_tables', 'revenue_records', 'buffet_rates', 'pos_charge_items', 'pos_charge_item_variants', 'pos_package_tiers', 'pos_package_inclusions', 'pos_discounts', 'pos_settings', 'pos_shifts', 'pos_cash_movements', 'pos_bills', 'pos_bill_lines', 'pos_bill_payments', 'pos_reservation_deposits', 'pos_bill_approvals'],
    'Chef / Kitchen Staff': ['ingredients', 'recipes', 'recipe_ingredients', 'production_logs', 'production_batches', 'waste_logs'],
    Receptionist: ['reservations', 'restaurant_tables', 'buffet_rates', 'pos_bills', 'pos_bill_lines', 'pos_bill_payments', 'pos_reservation_deposits', 'pos_bill_approvals', 'pos_shifts', 'pos_cash_movements'],
    'Inventory Clerk': ['ingredients', 'recipes', 'recipe_ingredients', 'inventory_transactions', 'physical_counts', 'waste_logs']
  };
  const permitted = new Set(allowed[state.role] || []);
  return tables.filter(table => permitted.has(table));
}
function realtimeCollectionName(table) {
  return {
    ingredients: 'ingredients',
    recipes: 'recipes',
    recipe_ingredients: 'recipes',
    inventory_transactions: 'inventoryTransactions',
    production_logs: 'productionLogs',
    waste_logs: 'wasteLogs',
    physical_counts: 'physicalCounts',
    reservations: 'reservations',
    restaurant_tables: 'restaurantTables',
    revenue_records: 'revenueRecords',
    buffet_rates: 'buffetRates',
    pos_charge_items: 'chargeItems',
    pos_charge_item_variants: 'chargeItemVariants',
    pos_package_tiers: 'packageTiers',
    pos_package_inclusions: 'packageInclusions',
    pos_discounts: 'discounts',
    pos_settings: 'posSettings',
    pos_shifts: 'shifts',
    pos_cash_movements: 'cashMovements',
    pos_bills: 'posBills',
    pos_bill_lines: 'billLines',
    pos_bill_payments: 'billPayments',
    pos_reservation_deposits: 'reservationDeposits',
    pos_bill_approvals: 'billApprovals'
  }[table];
}
function persistCollection(collection, records) {
  collectionState[collection] = records;
}
async function refetchCollection(collection) {
  const records = await window.supabaseRecord.load(collection);
  persistCollection(collection, records);
  return records;
}
async function refreshPosCollections() {
  const collections = ['posBills', 'billLines', 'billPayments', 'billApprovals'];
  const loaded = await Promise.all(collections.map(collection => window.supabaseRecord.load(collection)));
  collections.forEach((collection, index) => persistCollection(collection, loaded[index]));
}
async function refreshRealtimeCollection(table, payload) {
  if (table === 'production_batches') {
    await loadProductionBoard(true);
    if (state.productionHistoryOpen) await loadProductionHistory(true);
    return;
  }
  if (state.focusPageAfterNavigation) {
    document.querySelector('#pageCrumb')?.focus({ preventScroll: true });
    state.focusPageAfterNavigation = false;
  }
  const collection = realtimeCollectionName(table);
  if (!collection || !state.user) return;
  const recordId = payload?.new?.id || payload?.old?.id;
  if (recordId && recentLocalChanges.has(`${collection}:${recordId}`)) return;
  if (document.querySelector('#modalRoot')?.firstElementChild && recordId && document.querySelector('#modalForm')?.dataset.id === String(recordId)) {
    if (confirm('This record changed in another session. Reload the latest data?')) closeModal();
    else toast('Remote change received. Your edit remains open.', 'error');
  }
  const records = await window.supabaseRecord.load(collection);
  persistCollection(collection, records);
  invalidateReportData();
  const changed = payload?.new || payload?.old || {};
  const actor = changed.recorded_by || changed.created_by || changed.updated_by || '';
  if (table === 'ingredients' && payload?.new && Number(payload.new.stock) <= Number(payload.new.minimum)) toast(`Low stock reached for ${payload.new.name || 'an ingredient'}${actor ? ` (${actor})` : ''}.`, 'error');
  if (table === 'reservations' && payload?.eventType === 'INSERT') toast(`New ${payload.new.type === 'Walk-in' ? 'walk-in' : 'reservation'} received${actor ? ` from ${actor}` : ''}.`);
  if (table === 'reservations' && payload?.old?.status !== payload?.new?.status && payload?.new?.status) toast(`Reservation status changed to ${payload.new.status}${actor ? ` by ${actor}` : ''}.`);
  if (table === 'restaurant_tables' && payload?.old?.status !== payload?.new?.status) toast(`Table ${payload.new.id} is now ${payload.new.status}.`);
  if (table === 'revenue_records' && payload?.new?.status === 'Draft' && canAccessRevenue()) toast(`New revenue draft${actor ? ` from ${actor}` : ''}.`);
  if (['ingredients', 'reservations', 'restaurant_tables', 'revenue_records', 'production_logs', 'waste_logs', 'inventory_transactions', 'physical_counts', 'recipes', 'buffet_rates'].includes(table)) render();
}
function scheduleRealtimeRefresh(table, payload) {
  clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = setTimeout(() => refreshRealtimeCollection(table, payload).catch(error => {
    console.error('Realtime refresh failed.', error);
    setSyncState(navigator.onLine ? 'reconnecting' : 'offline', error.message);
  }), 300);
}
async function stopRealtimeSubscriptions() {
  clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = null;
  if (realtimeChannel) await window.supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel = null;
  realtimeSubscriptionKey = '';
  realtimeConnected = false;
}
async function applyRealtimeSubscriptions(key, tables) {
  if (!supabaseSyncEnabled || !state.user || key !== realtimeRequestedKey) return;
  if (key === realtimeSubscriptionKey && realtimeChannel) return;
  await stopRealtimeSubscriptions();
  if (!supabaseSyncEnabled || !state.user || key !== realtimeRequestedKey || !tables.length) return;
  realtimeSubscriptionKey = key;
  realtimeConnected = false;
  realtimeChannel = window.supabaseClient.channel(`costtrack:${state.user.id}:${state.view}`);
  tables.forEach(table => realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => scheduleRealtimeRefresh(table, payload)));
  realtimeChannel.subscribe(async status => {
    if (status === 'SUBSCRIBED') {
      realtimeConnected = true;
      setSyncState('live');
      try {
        await syncWithSupabase();
      } catch (error) {
        console.error('Realtime reconnect refresh failed.', error);
        setSyncState('reconnecting', error.message);
      }
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      realtimeConnected = false;
      console.warn(`Realtime channel ${status.toLowerCase()}.`, { role: state.role, view: state.view, tables });
      setSyncState(navigator.onLine ? 'reconnecting' : 'offline');
    }
  });
}
function configureRealtimeSubscriptions() {
  if (!supabaseSyncEnabled || !state.user) return Promise.resolve();
  const tables = realtimeTablesForRole([...new Set(realtimeCollectionsForView())].sort());
  realtimeRequestedKey = `${state.role}:${state.view}:${tables.join(',')}`;
  if (realtimeConfigPromise) return realtimeConfigPromise;
  realtimeConfigPromise = (async () => {
    while (supabaseSyncEnabled && state.user) {
      const key = realtimeRequestedKey;
      const requestedTables = key.split(':').slice(2).join(':').split(',').filter(Boolean);
      await applyRealtimeSubscriptions(key, requestedTables);
      if (key === realtimeRequestedKey) break;
    }
  })().finally(() => {
    realtimeConfigPromise = null;
  });
  return realtimeConfigPromise;
}
const sidebarGroups = [
  { id: 'front-of-house', label: 'Front of House', icon: 'calendar', items: [['cashier', 'dashboard', 'Cashier'], ['shifts', 'calendar-days', 'Shifts'], ['approvals', 'shield', 'Approvals'], ['reservations', 'calendar-plus', 'Reservations'], ['calendar', 'calendar-days', 'Tables / Calendar'], ['tables', 'table', 'Table Management']] },
  { id: 'inventory', label: 'Inventory Management', icon: 'boxes', items: [['ingredients', 'package', 'Ingredients'], ['receiving', 'package-plus', 'Ingredients + Receiving'], ['counts', 'clipboard-check', 'Physical Count']] },
  { id: 'production', label: 'Kitchen Operations', icon: 'chef-hat', items: [['recipes', 'book', 'Recipes'], ['production', 'chef-hat', 'Production Board'], ['waste', 'trash', 'Waste Logs']] },
  { id: 'revenue-management', label: 'Revenue Management', icon: 'chart', items: [['revenue', 'chart', 'Revenue Tracking'], ['charge-catalog', 'package', 'Charge Catalog']] },
  { id: 'analytics', label: 'Analytics & Reports', icon: 'chart', items: [['reports', 'chart', 'Reports & analytics']] },
  { id: 'system', label: 'System Management', icon: 'settings', items: [['users', 'users', 'User Management'], ['roles', 'shield', 'Role Management'], ['settings', 'settings', 'System Settings']] }
];

const shellIconPaths = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="5" rx="1.5"></rect><rect x="14" y="11" width="7" height="10" rx="1.5"></rect><rect x="3" y="13" width="7" height="8" rx="1.5"></rect>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path>',
  'calendar-plus': '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18M12 13v5M9.5 15.5h5"></path>',
  'calendar-days': '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"></path>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18M9 10v10M15 10v10"></path>',
  boxes: '<path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"></path><path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5M12 12v9"></path>',
  package: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"></path><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v9"></path>',
  'package-plus': '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"></path><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v9M12 6v4M10 8h4"></path>',
  'clipboard-check': '<rect x="5" y="4" width="14" height="17" rx="2"></rect><path d="M9 4.5h6v3H9zM8.5 14l2.2 2.2 4.8-4.8"></path>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z"></path><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 7h8"></path>',
  'chef-hat': '<path d="M6 13a4 4 0 1 1 3.8-5.3A4.5 4.5 0 0 1 18 10a3.5 3.5 0 0 1-.7 7H6a4 4 0 0 1 0-8"></path><path d="M6 17v4h12v-4"></path>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3"></path>',
  chart: '<path d="M3 3v18h18"></path><path d="m7 14 4-4 3 3 6-7"></path>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"></path><path d="m9 12 2 2 4-4"></path>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"></path><path d="m19.4 15 .1.1 1.2 1-1.2 2.1-1.5-.5a7.8 7.8 0 0 1-1.4.8l-.3 1.6h-2.5l-.4-1.6a7.7 7.7 0 0 1-1.5-.8l-1.4.5-1.3-2.1 1.2-1a7 7 0 0 1 0-1.7l-1.2-1 1.3-2.1 1.4.5a7.7 7.7 0 0 1 1.5-.8l.4-1.6h2.5l.3 1.6a7.8 7.8 0 0 1 1.4.8l1.5-.5 1.2 2.1-1.2 1a7 7 0 0 1 0 1.6Z"></path>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 4.2 4.2"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path>',
  check: '<path d="m5 12 4 4L19 6"></path>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"></path><path d="M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3"></path>',
  'cloud-off': '<path d="m2 2 20 20M5.4 5.4A7 7 0 0 1 18.6 9M6 18h11a5 5 0 0 0 2.8-9.1M6 18a5 5 0 0 1-1.6-9.7"></path>',
  chevron: '<path d="m7 10 5 5 5-5"></path>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"></path>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16"></path>',
  help: '<circle cx="12" cy="12" r="9"></circle><path d="M9.6 9a2.5 2.5 0 1 1 4.5 1.5c-1.2 1-2.1 1.5-2.1 3M12 17h.01"></path>',
  more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
  alert: '<path d="M12 3 2.8 19h18.4L12 3Z"></path><path d="M12 9v4M12 16h.01"></path>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"></path>',
  close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  restaurant: '<path d="M3 3v7a4 4 0 0 0 8 0V3M7 3v18M17 3v18M17 3c3 2 4 5 4 9h-4"></path>'
};

function shellIcon(name) {
  return `<svg class="shell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shellIconPaths[name] || shellIconPaths.dashboard}</svg>`;
}

function readShellPreference(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn('A sidebar preference could not be read.', error);
    return null;
  }
}

function writeShellPreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('A sidebar preference could not be saved.', error);
  }
}

function sidebarGroupState() {
  const activeGroup = sidebarGroups.find(group => group.items.some(([view]) => view === state.view))?.id;
  let groups = [];
  const saved = readShellPreference(`costtrack_sidebar_groups_${state.role}`);
  let hasPreference = saved !== null;
  if (hasPreference) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) groups = parsed.filter(id => sidebarGroups.some(group => group.id === id)).slice(0, 1);
      else hasPreference = false;
    } catch (error) {
      console.warn('Saved sidebar groups could not be restored.', error);
      hasPreference = false;
    }
  }
  return hasPreference ? groups : (activeGroup ? [activeGroup] : []);
}

function renderNavItem(view, icon, label, options = {}) {
  const active = state.view === view;
  let badge = '';
  if (view === 'reservations') {
    const pending = all('reservations').filter(item => item.status === 'Pending').length;
    if (pending) badge = `<b class="nav-badge" title="${pending} pending reservations" aria-label="${pending} pending reservations">${pending > 9 ? '9+' : pending}</b>`;
  } else if (view === 'ingredients') {
    const count = lowStock().length;
    if (count) badge = `<b class="nav-badge" title="${count} low-stock ingredients" aria-label="${count} low-stock ingredients">${count > 9 ? '9+' : count}</b>`;
  }
  return `<a class="nav-item ${options.single ? 'nav-single' : ''} ${active ? 'active' : ''}" href="#${view}" data-view="${view}" title="${esc(label)}" aria-label="${esc(label)}" ${active ? 'aria-current="page"' : ''} ${options.menuitem ? 'role="menuitem"' : ''}><span class="nav-icon">${shellIcon(icon)}</span><span class="nav-item-label">${esc(label)}</span>${badge}</a>`;
}

function userMenuMarkup(placement) {
  const id = `user-menu-${placement}`;
  const header = placement === 'header';
  return `<div class="user-menu-wrap shell-popover-wrap">
    <button class="user-menu-trigger ${header ? 'header-user-trigger' : 'sidebar-user-trigger'}" type="button" data-popover-trigger="user-${placement}" aria-controls="${id}" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu for ${esc(currentUserName())}">
      <span class="avatar user-avatar">${esc(currentUserInitials())}</span>
      <span class="user-copy"><strong>${esc(currentUserName())}</strong><span>${esc(state.role || '')}</span></span>
    ${header ? '' : shellIcon('more')}
    </button>
    <div class="shell-popover user-popover" id="${id}" data-popover-panel="user-${placement}" role="menu" aria-label="Account menu" hidden>
      <div class="user-popover-heading"><strong>${esc(currentUserName())}</strong><span>${esc(state.role || '')}</span></div>
      <button type="button" role="menuitem" data-shell-action="show-guide">${shellIcon('help')}<span>Help / CostTrack guide</span></button>
      <div class="popover-divider"></div>
      <button type="button" role="menuitem" class="danger-menu-item" data-shell-action="sign-out">${shellIcon('logout')}<span>Sign out</span></button>
    </div>
  </div>`;
}

function createActions() {
  return [
    { id: 'reservation', label: 'New reservation', icon: 'calendar-plus', view: 'reservations' },
    { id: 'cashier', label: 'Open cashier', icon: 'dashboard', view: 'cashier' },
    { id: 'production', label: 'Log production', icon: 'chef-hat', view: 'production' },
    { id: 'waste', label: 'Log waste', icon: 'trash', view: 'waste' },
    { id: 'receiving', label: 'Receive supplies', icon: 'package-plus', view: 'receiving' },
    { id: 'revenue', label: 'Record revenue', icon: 'chart', view: 'revenue' },
    { id: 'count', label: 'Start physical count', icon: 'clipboard-check', view: 'counts' }
  ].filter(action => canAccess(action.view));
}

function renderCreateMenu() {
  const actions = createActions();
  if (!actions.length) return '';
  return `<div class="shell-popover-wrap">
    <button type="button" class="new-button" data-popover-trigger="create" aria-controls="create-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Create new">${shellIcon('plus')}<span>New</span></button>
    <div class="shell-popover create-popover" id="create-menu" data-popover-panel="create" role="menu" aria-label="Create new" hidden>
      <div class="popover-heading">Quick create</div>
      ${actions.map(action => `<button type="button" role="menuitem" data-create-action="${action.id}">${shellIcon(action.icon)}<span>${action.label}</span></button>`).join('')}
    </div>
  </div>`;
}

function reservationDateLabel(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Date not set';
  const days = Math.round((new Date(`${date}T12:00:00`) - new Date(`${today()}T12:00:00`)) / 86400000);
  if (!Number.isFinite(days)) return 'Date not set';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} past`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

function activeNotifications() {
  const alerts = [];
  if (canAccess('ingredients')) {
    lowStock().forEach(item => alerts.push({
      id: `stock-${item.id}`,
      title: item.stock <= 0 ? `Out of stock: ${item.name}` : `Low stock: ${item.name}`,
      message: `${Number(item.stock)} ${item.unit || ''} on hand · minimum ${Number(item.minimum)}`,
      timing: 'Current',
      view: 'ingredients',
      icon: item.stock <= 0 ? 'alert' : 'package'
    }));
  }
  if (canAccess('reservations')) {
    all('reservations')
      .filter(item => item.status === 'Pending')
      .sort((left, right) => `${left.date || ''} ${left.time || ''}`.localeCompare(`${right.date || ''} ${right.time || ''}`))
      .forEach(item => alerts.push({
        id: `reservation-${item.id}`,
        title: `Pending reservation: ${item.name || 'Guest'}`,
        message: `${Number(item.guests || 0)} guests · ${item.date || 'Date not set'}${item.time ? ` at ${item.time}` : ''}`,
        timing: reservationDateLabel(item.date),
        view: 'reservations',
        icon: 'calendar'
      }));
  }
  return alerts;
}

function renderNotifications() {
  const alerts = activeNotifications();
  const count = alerts.length;
  return `<div class="shell-popover-wrap">
    <button class="notification-button" id="notificationButton" type="button" data-popover-trigger="notifications" aria-controls="notifications-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Notifications, ${count} active alerts">
      ${shellIcon('bell')}
      ${count ? `<span class="notification-count" aria-hidden="true">${count > 9 ? '9+' : count}</span>` : ''}
    </button>
    <div class="shell-popover notification-popover" id="notifications-menu" data-popover-panel="notifications" role="menu" aria-label="Active alerts" hidden>
      <div class="popover-heading"><strong>Active alerts</strong><span>${count}</span></div>
      ${count ? alerts.slice(0, 12).map(alert => `<button type="button" role="menuitem" class="notification-item" data-alert-view="${alert.view}">
        <span class="notification-icon">${shellIcon(alert.icon)}</span>
        <span class="notification-copy"><strong>${esc(alert.title)}</strong><span>${esc(alert.message)}</span><small>${esc(alert.timing)}</small></span>
        ${shellIcon('arrow')}
      </button>`).join('') : '<p class="notification-empty">You’re all caught up.</p>'}
    </div>
  </div>`;
}

function nav() {
  const appShell = document.querySelector('#appShell');
  const collapsed = appShell.classList.contains('sidebar-collapsed');
  const savedOpenGroup = sidebarGroupState()[0];
  const openGroup = collapsed ? state.sidebarFlyoutGroup : savedOpenGroup;
  const groups = sidebarGroups.map(group => {
    const visible = group.items.filter(([view]) => canAccess(view));
    if (!visible.length) return '';
    if (visible.length === 1) {
      const [view, icon, label] = visible[0];
      return `<div class="nav-single-wrap">${renderNavItem(view, icon, label, { single: true })}</div>`;
    }
    const expanded = openGroup === group.id;
    const containsActive = visible.some(([view]) => state.view === view);
    return `<section class="nav-group ${expanded ? 'is-expanded' : ''} ${containsActive ? 'has-active' : ''}" data-sidebar-group="${group.id}">
      <button class="nav-group-toggle" type="button" data-action="toggle-nav-group" data-group="${group.id}" aria-controls="nav-group-${group.id}" aria-expanded="${expanded}" aria-label="${esc(group.label)}" title="${esc(group.label)}" ${collapsed ? 'aria-haspopup="menu"' : ''}>
        <span class="nav-group-icon">${shellIcon(group.icon)}</span><span class="nav-group-label">${esc(group.label)}</span>${shellIcon('chevron')}
      </button>
      <div class="nav-group-items" id="nav-group-${group.id}" role="${collapsed ? 'menu' : 'group'}" aria-label="${esc(group.label)}" ${expanded ? '' : 'hidden'}>
        ${visible.map(([view, icon, label]) => renderNavItem(view, icon, label, { menuitem: collapsed })).join('')}
      </div>
    </section>`;
  }).join('');
  const overview = canAccess('dashboard') ? `<div class="nav-single-wrap">${renderNavItem('dashboard', 'dashboard', 'Dashboard', { single: true })}</div>` : '';
  const guideDismissed = readShellPreference(`costtrack_sidebar_guide_dismissed_${state.role}`) === 'true';
  const shortScreen = window.matchMedia('(max-height: 700px)').matches;
  const guideCollapsed = readShellPreference(`costtrack_sidebar_guide_collapsed_${state.role}`) === 'true'
    || collapsed
    || shortScreen;
  const guide = guideDismissed ? '' : `<section class="help-card ${guideCollapsed ? 'is-collapsed' : ''}" aria-label="CostTrack guide">
    <button class="help-toggle" type="button" data-shell-action="toggle-guide" aria-label="CostTrack guide" aria-expanded="${!guideCollapsed}">
      <span class="help-icon">${shellIcon('help')}</span><span class="help-copy"><strong>CostTrack guide</strong><span>Learn the workflow</span></span>
    </button>
    <button class="help-dismiss" type="button" data-shell-action="dismiss-guide" aria-label="Dismiss CostTrack guide" title="Dismiss guide">${shellIcon('close')}</button>
    <p class="help-details" ${guideCollapsed ? 'hidden' : ''}>Use the sidebar to move between restaurant workflows. The New menu shows actions available to your role.</p>
  </section>`;
  const collapseLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return `<div class="sidebar-top">
      <button class="drawer-close" type="button" data-shell-action="close-drawer" aria-label="Close navigation">${shellIcon('close')}<span>Close</span></button>
      <div class="brand">
        <span class="brand-mark">CT</span><span class="brand-copy"><strong>COST<span>TRACK</span></strong><small>BOH cost management</small></span>
        <button class="sidebar-collapse" type="button" data-shell-action="toggle-sidebar" aria-label="${collapseLabel}" title="${collapseLabel}">${shellIcon('panel')}</button>
      </div>
      <div class="workspace-switcher" aria-label="Restaurant workspace">
        <span class="avatar restaurant-avatar">${shellIcon('restaurant')}</span><span class="workspace-copy"><span>Workspace</span><strong>Restaurant</strong></span>
      </div>
    </div>
    <nav class="sidebar-nav" aria-label="Main">${overview}${groups}</nav>
    <div class="sidebar-bottom">${guide}${userMenuMarkup('sidebar')}</div>`;
}
function saveSidebarGroups(groups) {
  const next = Array.isArray(groups) ? groups.filter(id => sidebarGroups.some(group => group.id === id)).slice(0, 1) : [];
  writeShellPreference(`costtrack_sidebar_groups_${state.role}`, JSON.stringify(next));
}
function setView(view) {
  if (!canAccess(view)) {
    toast('This module is not assigned to your role.', 'error');
    return;
  }
  if (view === 'production' && state.view !== 'production') state.productionBoard.loaded = false;
  state.focusPageAfterNavigation = state.view !== view;
  state.view = view;
  state.query = '';
  state.sidebarFlyoutGroup = null;
  if (view === 'reservations') state.reservationMealPeriodFilter = 'All';
  syncActiveSidebarGroup(view);
  closeShellPopovers(false);
  closeMobileDrawer(false);
  window.location.hash = view;
}
function syncActiveSidebarGroup(view) {
  const activeGroup = sidebarGroups.find(group => group.items.some(([itemView]) => itemView === view))?.id;
  if (activeGroup) saveSidebarGroups([activeGroup]);
}
function toggleSidebarGroup(groupId) {
  const sidebar = document.querySelector('#sidebar');
  const wasCollapsed = document.querySelector('#appShell').classList.contains('sidebar-collapsed');
  if (wasCollapsed) {
    state.sidebarFlyoutGroup = state.sidebarFlyoutGroup === groupId ? null : groupId;
  } else {
    const open = sidebarGroupState()[0];
    saveSidebarGroups(open === groupId ? [] : [groupId]);
  }
  sidebar.innerHTML = nav();
  const toggle = sidebar.querySelector(`[data-group="${groupId}"]`);
  if (wasCollapsed && state.sidebarFlyoutGroup === groupId && toggle) {
    const rect = toggle.getBoundingClientRect();
    const flyout = sidebar.querySelector(`#nav-group-${groupId}`);
    const maxTop = Math.max(12, window.innerHeight - Math.min(flyout?.scrollHeight || 240, window.innerHeight - 24) - 12);
    if (flyout) {
      flyout.style.setProperty('--flyout-left', `${rect.right}px`);
      flyout.style.setProperty('--flyout-top', `${Math.min(Math.max(12, rect.top), maxTop)}px`);
    }
  }
  sidebar.querySelector(`[data-group="${groupId}"]`)?.focus();
}
function restoreShellPreferences() {
  const shell = document.querySelector('#appShell');
  const collapsed = readShellPreference(`costtrack_sidebar_collapsed_${state.role}`) === 'true';
  shell.classList.toggle('sidebar-collapsed', collapsed && !window.matchMedia('(max-width: 1024px)').matches);
}
function renderShellChrome() {
  const createRoot = document.querySelector('#createActionRoot');
  const notificationRoot = document.querySelector('#notificationRoot');
  const userRoot = document.querySelector('#headerUserMenuSlot');
  const period = document.querySelector('#reportingPeriod');
  if (createRoot) createRoot.innerHTML = renderCreateMenu();
  if (notificationRoot) notificationRoot.innerHTML = renderNotifications();
  if (userRoot) userRoot.innerHTML = userMenuMarkup('header');
  if (period) {
    const month = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    period.innerHTML = `${shellIcon('calendar')}<span>${esc(month)}</span>`;
    period.title = 'Current month display. Report filters use a separate date range.';
    period.setAttribute('aria-label', `Current reporting month ${month}. Display only; reports use a separate date range.`);
  }
}
function runCreateAction(actionId) {
  const action = createActions().find(item => item.id === actionId);
  if (!action) return toast('This action is not available for your role.', 'error');
  closeShellPopovers(false);
  if (actionId === 'reservation') return reservationForm();
  if (actionId === 'cashier') return setView('cashier');
  if (actionId === 'revenue') return revenueForm();
  if (actionId === 'production') return openForm('production');
  if (actionId === 'waste') return openForm('waste');
  if (actionId === 'receiving') return openForm('receiving');
  if (actionId === 'count') return openForm('count');
  return undefined;
}
function paletteItems() {
  const pages = [];
  if (canAccess('dashboard')) pages.push({ kind: 'page', label: 'Dashboard', detail: 'Overview', icon: 'dashboard', view: 'dashboard' });
  sidebarGroups.forEach(group => {
    group.items.filter(([view]) => canAccess(view)).forEach(([view, icon, label]) => {
      pages.push({ kind: 'page', label, detail: group.label, icon, view });
    });
  });
  const uniquePages = pages.filter((item, index) => pages.findIndex(candidate => candidate.view === item.view && candidate.label === item.label) === index);
  const actions = createActions().map(action => ({
    kind: 'action',
    label: action.label,
    detail: 'Quick create',
    icon: action.icon,
    action: action.id
  }));
  return [...uniquePages, ...actions];
}
function updatePaletteResults(query = '') {
  const root = document.querySelector('#commandPaletteRoot');
  const results = root?.querySelector('#paletteResults');
  if (!results) return;
  const normalized = query.trim().toLocaleLowerCase();
  state.paletteItems = paletteItems().filter(item => (
    !normalized || `${item.label} ${item.detail}`.toLocaleLowerCase().includes(normalized)
  ));
  state.paletteSelection = Math.min(state.paletteSelection, Math.max(0, state.paletteItems.length - 1));
  results.innerHTML = state.paletteItems.length
    ? state.paletteItems.map((item, index) => `<button type="button" class="palette-option" role="option" aria-selected="${index === state.paletteSelection}" id="palette-option-${index}" data-palette-index="${index}">
        ${shellIcon(item.icon)}<span><strong>${esc(item.label)}</strong><small>${esc(item.detail)}</small></span><kbd>${item.kind === 'page' ? 'Open' : 'Create'}</kbd>
      </button>`).join('')
    : '<p class="palette-empty">No results</p>';
  root.querySelector('#paletteSearch')?.setAttribute('aria-activedescendant', state.paletteItems.length ? `palette-option-${state.paletteSelection}` : '');
}
function openCommandPalette(trigger = document.querySelector('#searchLauncher')) {
  if (!state.user || !state.role) return;
  const root = document.querySelector('#commandPaletteRoot');
  if (!root) return;
  closeShellPopovers(false);
  state.paletteTrigger = trigger;
  state.paletteSelection = 0;
  root.innerHTML = `<div class="palette-backdrop" data-palette-backdrop>
    <section class="command-palette" role="dialog" aria-modal="true" aria-labelledby="paletteTitle">
      <h2 id="paletteTitle" class="sr-only">Search or jump to</h2>
      <div class="palette-search">${shellIcon('search')}<input id="paletteSearch" type="search" role="combobox" aria-expanded="true" aria-controls="paletteResults" aria-autocomplete="list" aria-activedescendant="" placeholder="Search pages and actions…" autocomplete="off"><kbd>Esc</kbd></div>
      <div class="palette-results" id="paletteResults" role="listbox" aria-label="Pages and actions"></div>
      <div class="palette-hint"><span>↑↓ to navigate</span><span>Enter to select</span><span>Esc to close</span></div>
    </section>
  </div>`;
  updatePaletteResults();
  root.querySelector('#paletteSearch')?.focus();
}
function closeCommandPalette(returnFocus = true) {
  const root = document.querySelector('#commandPaletteRoot');
  if (!root?.firstElementChild) return;
  root.innerHTML = '';
  if (returnFocus) state.paletteTrigger?.focus();
  state.paletteTrigger = null;
}
function choosePaletteItem(index) {
  const item = state.paletteItems[index];
  if (!item) return;
  closeCommandPalette(false);
  if (item.kind === 'page') setView(item.view);
  else runCreateAction(item.action);
}
function closeShellPopovers(returnFocus = false) {
  document.querySelectorAll('[data-popover-panel]').forEach(panel => {
    panel.hidden = true;
    const trigger = document.querySelector(`[data-popover-trigger="${panel.dataset.popoverPanel}"]`);
    trigger?.setAttribute('aria-expanded', 'false');
  });
  if (returnFocus) document.querySelector('[data-popover-trigger][data-was-open="true"]')?.focus();
  document.querySelectorAll('[data-popover-trigger][data-was-open="true"]').forEach(trigger => trigger.removeAttribute('data-was-open'));
}
function toggleShellPopover(name, trigger) {
  const panel = document.querySelector(`[data-popover-panel="${name}"]`);
  if (!panel) return;
  const wasOpen = !panel.hidden;
  closeShellPopovers(false);
  if (wasOpen) return;
  panel.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  trigger.dataset.wasOpen = 'true';
  const firstItem = panel.querySelector('[role="menuitem"]');
  firstItem?.focus();
}
function closeMobileDrawer(returnFocus = true) {
  const shell = document.querySelector('#appShell');
  const sidebar = document.querySelector('#sidebar');
  const overlay = document.querySelector('#drawerOverlay');
  if (!shell || !sidebar) return;
  if (!window.matchMedia('(max-width: 1024px)').matches && !state.forceCloseDrawer) return;
  sidebar.classList.remove('open');
  overlay.hidden = true;
  document.body.classList.remove('drawer-open');
  document.querySelector('.main-content')?.removeAttribute('aria-hidden');
  document.querySelector('#mobileMenu')?.setAttribute('aria-expanded', 'false');
  state.forceCloseDrawer = false;
  if (returnFocus) document.querySelector('#mobileMenu')?.focus();
}
function openMobileDrawer() {
  const sidebar = document.querySelector('#sidebar');
  const overlay = document.querySelector('#drawerOverlay');
  if (!sidebar || !overlay) return;
  sidebar.classList.add('open');
  overlay.hidden = false;
  document.body.classList.add('drawer-open');
  document.querySelector('.main-content')?.setAttribute('aria-hidden', 'true');
  document.querySelector('#mobileMenu')?.setAttribute('aria-expanded', 'true');
  sidebar.querySelector('.drawer-close')?.focus();
}
function showGuide() {
  if (window.matchMedia('(max-height: 700px)').matches) {
    toast('Use the sidebar for navigation. The New menu only shows actions allowed for your role.');
    return;
  }
  writeShellPreference(`costtrack_sidebar_guide_dismissed_${state.role}`, 'false');
  writeShellPreference(`costtrack_sidebar_guide_collapsed_${state.role}`, 'false');
  if (window.matchMedia('(max-width: 1024px)').matches) openMobileDrawer();
  else {
    document.querySelector('#appShell').classList.remove('sidebar-collapsed');
    writeShellPreference(`costtrack_sidebar_collapsed_${state.role}`, 'false');
  }
  const sidebar = document.querySelector('#sidebar');
  sidebar.innerHTML = nav();
  sidebar.querySelector('[data-shell-action="toggle-guide"]')?.focus();
}
function login(message = '') {
  document.querySelector('#appShell').classList.add('is-hidden');
  document.querySelector('#loginScreen').classList.remove('is-hidden');
  const recovering = passwordRecoveryMode || new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
  document.querySelector('#loginScreen').innerHTML = `<div class="login-card"><div class="login-brand"><div class="brand-mark">CT</div><strong>COST<span>TRACK</span></strong></div><span class="eyebrow">Back-of-house cost management</span><h1>Know your food cost.<br><em>Run a smarter kitchen.</em></h1><p>Track ingredients, recipes, production, waste, and variance in one focused workspace.</p>${message ? `<p class="auth-message" role="alert">${esc(message)}</p>` : ''}${recovering ? `<form id="passwordRecoveryForm"><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><button class="primary-btn" type="submit">Update password</button></form>` : `<form id="loginForm"><label>Work email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary-btn" type="submit">Sign in to CostTrack <span>→</span></button></form><button class="link-button" id="resetPasswordButton" type="button">Send password reset link</button><small>Accounts are provisioned by your CostTrack administrator.</small>`}</div><div class="login-art"><div><span>Today’s focus</span><strong>Reduce waste.<br>Protect margin.</strong><p>Make every ingredient movement visible from delivery to plate.</p></div><div class="art-stat"><b>${lowStock().length}</b><span>items need attention</span></div></div>`;
}
function metric(label, value, icon, tone, foot) { return `<div class="metric-card"><div class="metric-top"><span>${label}</span><i class="metric-icon ${tone}">${icon}</i></div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`; }
function pageHeader(eyebrow, title, subtitle, action = '') { return `<div class="page-header"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`; }
function tablePage(config) {
  const rows = config.rows || [];
  const emptyMessage = config.emptyMessage || 'No records found. Add your first record to get started.';
  return `${pageHeader(config.eyebrow, config.title, config.subtitle, config.action)}<div class="toolbar"><div class="search-box">⌕<input id="tableSearch" placeholder="Search ${config.search || 'records'}..." value="${esc(state.query)}"></div>${config.filters || ''}<span class="record-count">${rows.length} records</span></div><div class="panel table-panel"><div class="table-scroll"><table><thead><tr>${config.headers.map(item => `<th>${item}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${config.headers.length}" class="empty-state">${esc(emptyMessage)}</td></tr>`}</tbody></table></div></div>`;
}
function stockStatus(item) { return item.stock <= 0 ? 'Out of Stock' : item.stock <= item.minimum ? 'Low Stock' : 'Healthy'; }
function roleDashboard() {
  const ingredients = all('ingredients');
  const out = ingredients.filter(item => stockStatus(item) === 'Out of Stock').length;
  const low = ingredients.filter(item => stockStatus(item) === 'Low Stock').length;
  const healthy = ingredients.filter(item => stockStatus(item) === 'Healthy').length;
  const recipes = all('recipes');
  const todayDate = today();
  const productionToday = all('productionLogs').filter(item => item.date === todayDate).length;
  const wasteToday = all('wasteLogs').filter(item => item.date === todayDate).length;
  const counts = all('physicalCounts');
  const shortages = counts.filter(item => item.actual < item.expected).length;
  const roleCopy = {
    Administrator: ['System overview', 'Your complete CostTrack workspace at a glance.'],
    Manager: ['Operational summary', 'Monitor cost, stock health, waste, and variance.'],
    'Inventory Clerk': ['Inventory control center', 'Keep supplies accurate, available, and ready for service.'],
    'Chef / Kitchen Staff': ['Kitchen workspace', 'Focus on recipes, production, and waste during today’s shift.'],
    Receptionist: ['Front-of-house workspace', 'Keep reservations, arrivals, and table assignments moving smoothly.']
  };
  const [eyebrow, subtitle] = roleCopy[state.role];
  const reservations = all('reservations');
  const pendingReservations = reservations.filter(item => item.status === 'Pending').length;
  const checkedInReservations = reservations.filter(item => item.status === 'Seated').length;
  const todayReservations = reservations.filter(item => item.date === todayDate);
  const todayWalkIns = todayReservations.filter(item => item.type === 'Walk-in').length;
  const seatedCovers = todayReservations.filter(item => item.status === 'Seated').reduce((sum, item) => sum + Number(item.actualCovers || item.guests || 0), 0);
  const revenueToday = canAccessRevenue() ? revenueRecords().filter(item => item.status === 'Confirmed' && item.business_date === todayDate).reduce((sum, item) => sum + item.total_revenue, 0) : 0;
  const draftsToConfirm = canAccessRevenue() ? revenueRecords().filter(item => item.status === 'Draft').length : 0;
  const monthStart = `${todayDate.slice(0, 7)}-01`;
  const revenueMonth = canAccessRevenue() ? revenueRecords().filter(item => item.status === 'Confirmed' && item.business_date >= monthStart && item.business_date <= todayDate).reduce((sum, item) => sum + Number(item.total_revenue || 0), 0) : 0;
  const productionMonth = all('productionLogs').filter(item => item.date >= monthStart && item.date <= todayDate).reduce((sum, item) => sum + computedRecipeCost(recipe(item.recipeId) || { ingredients: [] }) * Number(item.quantity || 0), 0);
  const wasteMonth = all('wasteLogs').filter(item => item.date >= monthStart && item.date <= todayDate).reduce((sum, item) => sum + Number(item.quantity || 0) * Number(ingredient(item.ingredientId)?.cost || 0), 0);
  const offsetDate = days => { const date = new Date(`${todayDate}T12:00:00`); date.setDate(date.getDate() + days); return localDateStr(date); };
  const revenueOn = date => canAccessRevenue() ? revenueRecords().filter(item => item.status === 'Confirmed' && item.business_date === date).reduce((sum, item) => sum + Number(item.total_revenue || 0), 0) : 0;
  const coversOn = date => canAccessRevenue() ? revenueRecords().filter(item => item.status === 'Confirmed' && item.business_date === date).reduce((sum, item) => sum + Number(item.total_customers || 0), 0) : 0;
  const trend = (current, previous, label) => previous ? `${current >= previous ? '↑' : '↓'} ${Math.abs((current - previous) / previous * 100).toFixed(1)}% vs ${label}` : `— vs ${label}`;
  const revenueTrend = trend(revenueToday, revenueOn(offsetDate(-1)), 'yesterday');
  const revenueWeekTrend = trend(revenueToday, revenueOn(offsetDate(-7)), 'last week');
  const coversToday = coversOn(todayDate);
  const profitToday = canAccessRevenue() ? profitability(todayDate, { total_revenue: revenueToday }).profit : 0;
  const foodCostToday = revenueMonth ? (productionMonth + wasteMonth) / revenueMonth * 100 : null;
  const cards = state.role === 'Receptionist'
    ? [metric("Today's reservations", reservations.filter(item => item.date === today()).length, '▤', 'orange-icon', `${pendingReservations} awaiting confirmation`), metric('Guests expected', reservations.filter(item => item.date === today()).reduce((sum, item) => sum + Number(item.guests), 0), '♙', 'green-icon', 'Across today’s bookings'), metric('Checked in', checkedInReservations, '✓', 'purple-icon', 'Guests currently seated'), metric('Open tables', all('restaurantTables').filter(table => liveTableAvailability(table, today(), reservations).status === 'Available').length, '⌂', 'orange-icon', 'Ready for assignment')]
    : state.role === 'Chef / Kitchen Staff'
    ? [metric('Recipes created', recipes.length, '◇', 'purple-icon', `${new Set(recipes.map(item => item.category)).size} categories`), metric('Production logs today', productionToday, '♨', 'green-icon', 'Batches recorded today'), metric('Waste logs today', wasteToday, '◌', 'red-icon', money(wasteCost()) + ' total waste cost'), metric('Active recipes', recipes.length, '↗', 'orange-icon', 'Available to produce')]
    : state.role === 'Inventory Clerk'
      ? [metric('Out of stock items', out, '!', 'red-icon', 'Immediate replenishment needed'), metric('Low stock items', low, '↓', 'orange-icon', 'Below minimum level'), metric('Healthy stock items', healthy, '✓', 'green-icon', 'At safe stock level'), metric('Total ingredients', ingredients.length, '◈', 'purple-icon', money(inventoryValue()) + ' inventory value')]
      : state.role === 'Manager'
        ? [metric("Today's Revenue", money(revenueToday), '₱', 'green-icon', `${revenueTrend}; ${revenueWeekTrend}`), metric('Covers today', coversToday, '♙', 'purple-icon', 'Confirmed revenue covers'), metric('Estimated Profit', money(profitToday), '↗', profitToday >= 0 ? 'green-icon' : 'red-icon', 'Revenue − production − waste'), `<div class="metric-card"><div class="metric-top"><span>Food Cost %</span><i class="metric-icon orange-icon">♨</i></div><div class="metric-value">${foodCostToday === null ? '—' : `${foodCostToday.toFixed(1)}%`}</div><div class="metric-foot"><button class="text-btn" data-view="reports">Current month report →</button></div></div>`]
        : [metric("Today's Revenue", money(revenueToday), '₱', 'green-icon', `${revenueTrend}; ${revenueWeekTrend}`), metric('Covers today', coversToday, '♙', 'purple-icon', 'Confirmed revenue covers'), metric('Estimated Profit', money(profitToday), '↗', profitToday >= 0 ? 'green-icon' : 'red-icon', 'Revenue − production − waste'), metric('Low stock items', low + out, '!', 'red-icon', 'Needs attention')];
  const recipeCategories = [...new Set(recipes.map(item => item.category))];
  const kitchenPanel = `<div class="panel"><div class="panel-header"><div><div class="panel-title">Kitchen activity</div><div class="panel-subtitle">Recipes and production by category</div></div><button class="text-btn" data-view="production">Open production board →</button></div><div class="dashboard-list">${recipes.slice(0, 5).map(item => `<div class="dashboard-list-row"><span class="recipe-icon">◇</span><div><strong>${esc(item.name)}</strong><small>${esc(item.category)} · ${item.ingredients.length} ingredients</small></div><span class="tag">${money(computedRecipeCost(item))} / serving</span></div>`).join('')}</div><div class="category-chips">${recipeCategories.map(item => `<span>${esc(item)}</span>`).join('')}</div></div>`;
  const inventoryPanel = `<div class="panel inventory-health-panel"><div class="panel-header"><div><div class="panel-title">Inventory health</div><div class="panel-subtitle">Filter stock levels for quick action</div></div><button class="text-btn" data-view="ingredients">Manage inventory →</button></div><div class="quick-filters">${['All', 'Out of Stock', 'Low Stock', 'Healthy'].map(item => `<button class="${state.ingredientStatus === item ? 'active' : ''}" data-dashboard-status="${item}">${item}<b>${item === 'All' ? ingredients.length : ingredients.filter(x => stockStatus(x) === item).length}</b></button>`).join('')}</div><div class="dashboard-list">${ingredients.filter(item => state.ingredientStatus === 'All' || stockStatus(item) === state.ingredientStatus).slice(0, 6).map(item => `<div class="dashboard-list-row" data-view="ingredients"><span class="ingredient-dot">${item.name[0]}</span><div><strong>${esc(item.name)}</strong><small>${item.stock} ${item.unit} · minimum ${item.minimum}</small></div><span class="status ${stockStatus(item) === 'Healthy' ? 'status-good' : 'status-low'}">${stockStatus(item)}</span></div>`).join('')}</div></div>`;
  const charts = `<div class="panel empty-state"><div class="panel-title">Cost analytics</div><p>Authoritative trend charts are available in Reports.</p><button class="text-btn" data-view="reports">Open Reports →</button></div>`;
  const reservationPanel = `<div class="panel reservation-summary-panel"><div class="panel-header"><div><div class="panel-title">Reservation service</div><div class="panel-subtitle">${pendingReservations} bookings need attention · ${todayReservations.length} today</div></div><button class="text-btn" data-view="reservations">Manage reservations →</button></div><div class="dashboard-list">${todayReservations.slice(0, 4).map(item => `<div class="dashboard-list-row"><span class="ingredient-dot">${esc(item.name.charAt(0))}</span><div><strong>${esc(item.name)}</strong><small>${esc(item.time)} · ${item.guests} guests · ${esc(item.table || 'Unassigned')}</small></div><span class="status">${esc(item.status)}</span></div>`).join('') || '<p class="panel-subtitle">No reservations scheduled for today.</p>'}</div></div>`;
  const draftPanel = canAccessRevenue() ? `<div class="panel"><div class="panel-header"><div><div class="panel-title">Drafts to confirm <span class="nav-badge">${draftsToConfirm}</span></div><div class="panel-subtitle">Completed service awaiting revenue confirmation.</div></div><button class="text-btn" data-view="revenue">Open revenue →</button></div>${draftsToConfirm ? '<p class="panel-subtitle">Review and confirm drafted covers before closing the day.</p>' : '<p class="panel-subtitle">No revenue drafts need confirmation.</p>'}</div>` : '';
  const fohMetrics = canAccess('reservations') ? `<div class="panel"><div class="panel-title">Front-of-house today</div><div class="metric-grid compact-metric-grid">${metric('Reservations', todayReservations.length, '▤', 'orange-icon', 'Scheduled today')}${metric('Walk-ins', todayWalkIns, '⌂', 'purple-icon', 'Recorded today')}${metric('Seated covers', seatedCovers, '✓', 'green-icon', 'Currently seated')}</div></div>` : '';
  return `<div class="welcome-row"><div><div class="eyebrow">${eyebrow}</div><h1>${dashboardGreeting()}</h1><p>${subtitle}</p></div>${state.role === 'Receptionist' ? '<button class="primary-btn" data-action="open-reservation">+ New reservation</button>' : state.role === 'Inventory Clerk' || state.role === 'Administrator' || state.role === 'Manager' ? '<button class="primary-btn" data-action="open-receiving">+ Receive inventory</button>' : '<button class="primary-btn" data-view="production">Open production board</button>'}</div><div class="metric-grid role-metric-grid">${cards.join('')}</div>${fohMetrics}${state.role === 'Receptionist' ? `<div class="dashboard-grid">${reservationPanel}<div class="panel"><div class="panel-title">Front-of-house checklist</div><div class="checklist"><span>✓ Confirm pending bookings</span><span>○ Check in arriving guests</span><span>○ Review table assignments</span></div></div></div>` : state.role === 'Chef / Kitchen Staff' ? `<div class="dashboard-grid">${kitchenPanel}<div class="panel"><div class="panel-title">Today’s kitchen checklist</div><div class="checklist"><span>✓ Review today’s prep targets</span><span>○ Start a batch from the production board</span><span>○ Mark each cooked batch ready</span></div></div></div>` : state.role === 'Inventory Clerk' ? inventoryPanel : state.role === 'Manager' ? `<div class="dashboard-grid">${inventoryPanel}${reservationPanel}</div>${draftPanel}` : `<div class="dashboard-grid">${reservationPanel}${inventoryPanel}</div>${draftPanel}`}${state.role === 'Chef / Kitchen Staff' ? '' : charts}`;
}
function ingredientCardsPage() {
  const ingredients = all('ingredients');
  const categories = [...new Set(ingredients.map(item => item.category))];
  const units = [...new Set(ingredients.map(item => item.unit))];
  const filtered = ingredients.filter(item => {
    const queryMatch = `${item.name} ${item.category}`.toLowerCase().includes(state.query.toLowerCase());
    return queryMatch && (state.ingredientCategory === 'All' || item.category === state.ingredientCategory) && (state.ingredientUnit === 'All' || item.unit === state.ingredientUnit) && (state.ingredientStatus === 'All' || stockStatus(item) === state.ingredientStatus);
  });
  const canSeeCost = ['Administrator', 'Manager', 'Inventory Clerk'].includes(state.role);
  const canManageProducts = window.CostTrackLogic.canPerformInventoryAction(state.role, 'product.manage');
  const sorted = filtered.slice().sort((a, b) => { const key = state.ingredientSort === 'stock' ? Number(a.stock) - Number(b.stock) : state.ingredientSort === 'cost' ? Number(a.cost) - Number(b.cost) : state.ingredientSort === 'status' ? stockStatus(a).localeCompare(stockStatus(b)) : a.name.localeCompare(b.name); return state.ingredientSortDirection === 'asc' ? key : -key; });
  const toggle = `<button class="ghost-btn compact-btn" data-action="toggle-ingredient-view">${state.ingredientView === 'cards' ? 'Table view' : 'Card view'}</button>`;
  const cardMarkup = sorted.length ? sorted.map(item => `<article class="catalog-card"><div class="catalog-card-top"><span class="ingredient-dot large-dot">${item.name[0]}</span><span class="status ${stockStatus(item) === 'Healthy' ? 'status-good' : 'status-low'}">${stockStatus(item)}</span></div><h3>${esc(item.name)}</h3><span class="tag">${esc(item.category)}</span><div class="catalog-stat"><div><small>Current stock</small><strong>${item.stock} <em>${item.unit}</em></strong></div>${canSeeCost ? `<div><small>Cost / unit</small><strong>${money(item.cost)}</strong></div>` : ''}</div><div class="catalog-card-footer"><span>Minimum ${item.minimum} ${item.unit}</span><div class="card-actions">${actions('ingredient', item.id)}</div></div></article>`).join('') : `<div class="panel empty-state">No ingredients match these filters.${canManageProducts ? '<button class="primary-btn" data-action="open-ingredient">Add product</button>' : ''}</div>`;
  const tableMarkup = `<div class="panel table-panel"><div class="table-scroll"><table><thead><tr>${[['name','Ingredient'],['stock','Stock'],...(canSeeCost ? [['cost','Cost / unit']] : []),['status','Status'],['','']].map(([key, label]) => key ? `<th><button class="sort-header" data-sort-ingredient="${key}">${label} ↕</button></th>` : '<th></th>').join('')}</tr></thead><tbody>${sorted.length ? sorted.map(item => `<tr><td><strong>${esc(item.name)}</strong><small class="sub-cell">${esc(item.category)} · ${esc(item.unit)}</small></td><td>${item.stock} ${esc(item.unit)}</td>${canSeeCost ? `<td>${money(item.cost)}</td>` : ''}<td><span class="status ${stockStatus(item) === 'Healthy' ? 'status-good' : 'status-low'}">${stockStatus(item)}</span></td><td>${actions('ingredient', item.id)}</td></tr>`).join('') : `<tr><td colspan="${canSeeCost ? 5 : 4}" class="empty-state">No ingredients match these filters.</td></tr>`}</tbody></table></div></div>`;
  return `${pageHeader('Inventory', 'Products', 'Review product stock and reorder thresholds.', `${toggle} ${canManageProducts ? '<button class="primary-btn" data-action="open-ingredient">+ Add product</button>' : ''}`)}<div class="catalog-toolbar"><div class="search-box">⌕<input id="tableSearch" placeholder="Search products or categories..." value="${esc(state.query)}"></div><select data-filter="ingredientCategory"><option>All categories</option>${categories.map(item => `<option ${state.ingredientCategory === item ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select><label class="filter-check"><input type="checkbox" data-low-stock-filter ${state.ingredientStatus === 'Low Stock' ? 'checked' : ''}> Low stock only</label><span class="record-count">${filtered.length} products</span></div>${state.ingredientView === 'cards' ? `<div class="ingredient-card-grid">${cardMarkup}</div>` : tableMarkup}`;
}
function recipeCardsPage() {
  const recipes = all('recipes');
  const categories = [...new Set(recipes.map(item => item.category))];
  const filtered = recipes.filter(item => item.name.toLowerCase().includes(state.query.toLowerCase()) && (state.recipeCategory === 'All' || item.category === state.recipeCategory));
  const canSeeCosts = ['Administrator', 'Manager'].includes(state.role);
  const canManageRecipes = window.CostTrackLogic.canPerformInventoryAction(state.role, 'recipe.manage');
  return `${pageHeader('Kitchen operations', 'Recipes', canSeeCosts ? 'Manage recipe cards and review serving cost and wastage.' : 'Review recipe ingredients and quantities for production.', canManageRecipes ? '<button class="primary-btn" data-action="open-recipe">+ Create recipe</button>' : '')}<div class="catalog-toolbar"><div class="search-box">⌕<input id="tableSearch" placeholder="Search recipes..." value="${esc(state.query)}"></div><div class="category-tabs"><button class="${state.recipeCategory === 'All' ? 'active' : ''}" data-recipe-category="All">All</button>${categories.map(item => `<button class="${state.recipeCategory === item ? 'active' : ''}" data-recipe-category="${esc(item)}">${esc(item)}</button>`).join('')}</div><span class="record-count">${filtered.length} recipes</span></div><div class="recipe-card-grid">${filtered.length ? filtered.map(item => { const cost = canSeeCosts ? computedRecipeCost(item) : null; return `<article class="catalog-card recipe-card"><div class="catalog-card-top"><span class="recipe-icon large-dot">◇</span><span class="tag">${esc(item.category)}</span></div><h3>${esc(item.name)}</h3><div class="recipe-prep-summary"><span><small>Batch yield</small><strong>${Number(item.batchYield || 30)} portions</strong></span><span><small>Service target</small><strong>${Number(item.prepTarget || 30)} portions</strong></span></div>${canSeeCosts ? `<div class="recipe-metrics"><div><small>Cost / serving</small><strong>${money(cost)}</strong></div><div><small>Menu price</small><strong>${money(item.price)}</strong></div><div><small>Margin</small><strong class="positive">${Number(item.price) ? ((item.price - cost) / item.price * 100).toFixed(1) : '—'}%</strong></div></div>` : ''}<div class="catalog-card-footer"><span>${item.ingredients.length} ingredients</span><div class="card-actions">${actions('recipe', item.id)}</div></div></article>`; }).join('') : '<div class="panel empty-state">No recipes match this category.</div>'}</div>`;
}
function receivingPage() {
  const canReceive = window.CostTrackLogic.canPerformInventoryAction(state.role, 'inventory.receive');
  const rows = all('inventoryTransactions').slice().reverse()
    .filter(item => `${ingredient(item.ingredientId)?.name || ''} ${item.supplierName || ''} ${item.invoiceNumber || ''} ${item.note || ''}`.toLowerCase().includes(state.query.toLowerCase()))
    .map(item => {
      const received = item.quantity > 0;
      const invoiceDetails = [item.supplierName, item.invoiceNumber && `Invoice ${item.invoiceNumber}`, item.invoiceDate && `dated ${item.invoiceDate}`, item.note].filter(Boolean).join(' · ');
      const batchDetails = [item.batchCode && `Lot ${item.batchCode}`, item.expirationDate && `Exp ${item.expirationDate}`].filter(Boolean).join(' · ');
      return `<tr><td><strong>${esc(ingredient(item.ingredientId)?.name || 'Unknown')}</strong><small class="sub-cell">${esc(invoiceDetails || 'Inventory movement')}</small></td><td><span class="status ${received ? 'status-good' : 'status-low'}">${received ? 'Received' : 'Issued'}</span></td><td class="${received ? 'positive' : 'negative'}">${received ? '+' : ''}${item.quantity} ${esc(ingredient(item.ingredientId)?.unit || '')}</td><td>${money(item.unitCost)}</td><td>${esc(batchDetails || '—')}</td><td>${esc(item.date || '')}</td><td>${actions('transaction', item.id)}</td></tr>`;
    });
  return tablePage({
    eyebrow: 'Inventory movement',
    title: 'Receiving & invoices',
    subtitle: 'Record supplier invoices, received quantities, lot numbers, and expiry dates.',
    action: canReceive ? '<button class="primary-btn" data-action="open-receiving">+ Record delivery</button>' : '',
    search: 'supplier, invoice, or product',
    headers: ['Product / invoice', 'Movement', 'Quantity', 'Unit cost', 'Lot / expiry', 'Date received', ''],
    rows
  });
}
const wasteReasons = ['Expired', 'Spoiled', 'Burned', 'Over-preparation', 'Spillage', 'Dropped / contaminated', 'Prep trim', 'Other'];
function logsPage(type) {
  const isWaste = type === 'waste';
  if (isWaste) {
    const records = all('wasteLogs');
    const filters = state.wasteFilters;
    const recipesByLogId = new Map(all('productionLogs').map(log => [log.id, log]));
    const matches = records.filter(item => {
      const product = ingredient(item.ingredientId);
      const linkedLog = recipesByLogId.get(item.productionLogId);
      const timestamp = item.recordedAt ? new Date(item.recordedAt) : null;
      if (filters.from && item.date < filters.from) return false;
      if (filters.to && item.date > filters.to) return false;
      if (filters.ingredient !== 'All' && item.ingredientId !== filters.ingredient) return false;
      if (filters.reason !== 'All' && item.reason !== filters.reason) return false;
      if (filters.staff === 'Mine' && item.recordedBy !== state.user?.id) return false;
      if (filters.staff === 'Others' && (!item.recordedBy || item.recordedBy === state.user?.id)) return false;
      if (filters.staff === 'Legacy' && item.recordedAt) return false;
      if ((filters.timeFrom || filters.timeTo) && (!timestamp || Number.isNaN(timestamp.getTime()))) return false;
      const clock = timestamp ? `${String(timestamp.getHours()).padStart(2, '0')}:${String(timestamp.getMinutes()).padStart(2, '0')}` : '';
      if (filters.timeFrom && clock < filters.timeFrom) return false;
      if (filters.timeTo && clock > filters.timeTo) return false;
      const linkedName = linkedLog ? recipe(linkedLog.recipeId)?.name || '' : '';
      return `${product?.name || ''} ${item.reason || ''} ${item.notes || ''} ${linkedName}`.toLowerCase().includes(state.query.toLowerCase());
    }).sort((a, b) => String(b.recordedAt || b.date || '').localeCompare(String(a.recordedAt || a.date || '')));
    const canSeeCosts = ['Administrator', 'Manager'].includes(state.role);
    const selectedIngredient = filters.ingredient !== 'All';
    const totalQuantity = selectedIngredient ? matches.reduce((sum, item) => sum + Number(item.quantity || 0), 0) : null;
    const totalCost = canSeeCosts ? matches.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(ingredient(item.ingredientId)?.cost || 0), 0) : null;
    const rows = matches.map(item => {
      const product = ingredient(item.ingredientId);
      const linkedLog = recipesByLogId.get(item.productionLogId);
      const activityTime = item.recordedAt
        ? new Date(item.recordedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'Time not recorded';
      const staffLabel = !item.recordedBy ? 'Not recorded' : item.recordedBy === state.user?.id ? 'You' : 'Other staff';
      return `<tr><td><strong>${esc(product?.name || 'Unknown ingredient')}</strong></td><td>${Number(item.quantity)} ${esc(product?.unit || '')}</td><td><span class="tag">${esc(item.reason || 'Unspecified')}</span></td><td>${esc(linkedLog ? recipe(linkedLog.recipeId)?.name || 'Unknown dish' : '—')}</td><td>${esc(item.date || '')}<small class="sub-cell">${esc(activityTime)}</small></td><td>${staffLabel}</td>${canSeeCosts ? `<td>${money(Number(item.quantity || 0) * Number(product?.cost || 0))}</td>` : ''}<td>${esc(item.notes || '—')}</td></tr>`;
    });
    const reasonOptions = [...new Set([...wasteReasons, ...records.map(item => item.reason).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
    const filterMarkup = `<div class="waste-filters">
      <label>From date<input data-waste-filter="from" type="date" value="${esc(filters.from)}"></label>
      <label>To date<input data-waste-filter="to" type="date" value="${esc(filters.to)}"></label>
      <label>Time from<input data-waste-filter="timeFrom" type="time" value="${esc(filters.timeFrom)}"></label>
      <label>Time to<input data-waste-filter="timeTo" type="time" value="${esc(filters.timeTo)}"></label>
      <label>Ingredient<select data-waste-filter="ingredient"><option value="All">All ingredients</option>${all('ingredients').slice().sort((a, b) => a.name.localeCompare(b.name)).map(item => `<option value="${esc(item.id)}" ${filters.ingredient === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
      <label>Reason<select data-waste-filter="reason"><option value="All">All reasons</option>${reasonOptions.map(reason => `<option value="${esc(reason)}" ${filters.reason === reason ? 'selected' : ''}>${esc(reason)}</option>`).join('')}</select></label>
      <label>Staff<select data-waste-filter="staff"><option value="All" ${filters.staff === 'All' ? 'selected' : ''}>Everyone</option><option value="Mine" ${filters.staff === 'Mine' ? 'selected' : ''}>My entries</option><option value="Others" ${filters.staff === 'Others' ? 'selected' : ''}>Other staff</option><option value="Legacy" ${filters.staff === 'Legacy' ? 'selected' : ''}>Older entries</option></select></label>
      <span class="waste-filter-actions"><button class="primary-btn compact-btn" data-action="apply-waste-filters">Apply</button><button class="ghost-btn compact-btn" data-action="clear-waste-filters">Clear</button></span>
    </div>`;
    const summaries = `<div class="waste-summary"><div><small>Entries shown</small><strong>${matches.length}</strong></div>${selectedIngredient ? `<div><small>Quantity shown</small><strong>${Number(totalQuantity.toFixed(4))} ${esc(ingredient(filters.ingredient)?.unit || '')}</strong></div>` : ''}${canSeeCosts ? `<div><small>Estimated discarded cost</small><strong>${money(totalCost)}</strong></div>` : ''}</div>`;
    return `${pageHeader('Kitchen operations', 'Waste logs', 'Quickly record discarded ingredients, see the stock impact before saving, and trace waste to a service batch. Only discarded items reduce inventory.', '<button class="primary-btn" data-action="open-waste">+ Log waste</button>')}<div class="panel waste-history-panel"><div class="waste-toolbar"><div class="search-box">⌕<input id="tableSearch" placeholder="Search waste, reason, dish, or notes..." value="${esc(state.query)}"></div><span class="record-count">${matches.length} entries</span></div>${filterMarkup}${summaries}<div class="table-scroll"><table><thead><tr><th>Ingredient</th><th>Quantity</th><th>Reason</th><th>Dish / batch</th><th>Date / time</th><th>Logged by</th>${canSeeCosts ? '<th>Estimated cost</th>' : ''}<th>Notes</th></tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${canSeeCosts ? 8 : 7}" class="empty-state">No waste entries match these filters.</td></tr>`}</tbody></table></div></div>`;
  }
  const records = all('productionLogs');
  const rows = records.slice().reverse()
    .filter(item => `${recipe(item.recipeId)?.name || ''} ${item.mode || ''}`.toLowerCase().includes(state.query.toLowerCase()))
    .map(item => `<tr><td><strong>${esc(recipe(item.recipeId)?.name || 'Unknown')}</strong></td><td>${item.coversProduced ?? item.quantity} portions</td><td><span class="tag">${esc(item.mode || '')}</span></td><td>${esc(item.date || '')}</td></tr>`);
  return tablePage({
    eyebrow: 'Kitchen operations',
    title: 'Production logs',
    subtitle: 'Track batch production and recipe usage in the kitchen.',
    action: '',
    search: 'logs',
    headers: ['Recipe', 'Output', 'Mode', 'Date'],
    rows
  });
}
function productionBoardPage() {
  const recipes = all('recipes');
  const categories = [...new Set(recipes.map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (state.productionCategory !== 'All' && !categories.includes(state.productionCategory)) state.productionCategory = 'All';
  const rows = state.productionBoard.rows.filter(item => item.serviceDate === today());
  const activeRecipes = recipes.filter(item => state.productionCategory === 'All' || item.category === state.productionCategory);
  const progressFor = item => window.CostTrackLogic.productionProgress(
    rows.filter(batch => batch.recipeId === item.id),
    Number(item.prepTarget || 30)
  );
  const recipeCards = activeRecipes.map(item => {
    const progress = progressFor(item);
    const completePercent = progress.target ? Math.min(100, Math.round(progress.ready / progress.target * 100)) : 0;
    const yieldCount = Number(item.batchYield || 30);
    const halfBatch = Math.max(1, Math.round(yieldCount / 2));
    const quickAmounts = [...new Set([halfBatch, yieldCount])];
    const targetLabel = progress.ready >= progress.target ? 'Target met — replenish as needed' : `${progress.remaining} portions still needed`;
    return `<article class="production-dish-card">
      <div class="production-dish-heading"><div><span class="tag">${esc(item.category || 'Uncategorized')}</span><h3>${esc(item.name)}</h3></div><span class="production-yield">${yieldCount}<small>portions / full batch</small></span></div>
      ${item.prepNotes ? `<p class="production-prep-notes">${esc(item.prepNotes)}</p>` : ''}
      <div class="production-progress-grid"><div><small>Service target</small><strong>${progress.target}</strong></div><div><small>Ready</small><strong>${progress.ready}</strong></div><div><small>Cooking</small><strong>${progress.cooking}</strong></div></div>
      <div class="production-progress-track" role="progressbar" aria-label="${esc(item.name)} portions ready" aria-valuemin="0" aria-valuemax="${progress.target}" aria-valuenow="${Math.min(progress.ready, progress.target)}"><span style="width:${completePercent}%"></span></div>
      <div class="production-card-footer"><small>${esc(targetLabel)} · choose portions for the next cooking batch.</small>
        <div class="production-start-actions">${quickAmounts.map((portions, index) => `<button class="${index === quickAmounts.length - 1 ? 'primary-btn' : 'ghost-btn'} compact-btn" data-start-production="${esc(item.id)}" data-portions="${portions}" aria-label="Start ${portions} portions of ${item.name}" ${state.productionBoard.loading ? 'disabled' : ''}>${index === quickAmounts.length - 1 ? `Full batch · ${portions}` : `Half batch · ${portions}`}</button>`).join('')}</div>
        <div class="production-custom-portions"><label>Custom portions<input data-custom-portions type="number" min="1" max="10000" step="1" value="${yieldCount}" aria-label="Custom portions for ${esc(item.name)}"></label><button class="ghost-btn compact-btn" data-start-production="${esc(item.id)}" data-use-custom-portions="true" ${state.productionBoard.loading ? 'disabled' : ''}>Start custom batch</button></div><small class="production-scaling-note">Ingredient quantities are scaled to the portions you choose.</small>
      </div>
    </article>`;
  }).join('');
  const cooking = rows.filter(item => item.status === 'Cooking').sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  const ready = rows.filter(item => item.status === 'Ready').sort((a, b) => Number(b.batchNumber) - Number(a.batchNumber)).slice(0, 8);
  const batchTime = value => value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Historical batch';
  const cookingRows = cooking.length ? cooking.map(item => `<div class="production-queue-row"><div class="production-batch-number">#${item.batchNumber}</div><div class="production-queue-copy"><strong>${esc(item.recipeName || recipe(item.recipeId)?.name || 'Recipe')}</strong><small>${esc(item.category || '')} · ${item.expectedCovers} portions · Started ${esc(batchTime(item.startedAt))}</small></div><button class="primary-btn compact-btn" data-ready-production="${esc(item.id)}" ${state.productionBoard.loading ? 'disabled' : ''}>Mark ready</button></div>`).join('') : '<div class="production-queue-empty">No batches cooking. Choose a dish above to start the next batch.</div>';
  const readyRows = ready.length ? ready.map(item => `<div class="production-queue-row ready-row"><div class="production-batch-number">#${item.batchNumber}</div><div class="production-queue-copy"><strong>${esc(item.recipeName || recipe(item.recipeId)?.name || 'Recipe')}</strong><small>${item.expectedCovers} portions · Ready ${esc(batchTime(item.readyAt))}</small></div><span class="status status-good">Ready</span></div>`).join('') : '<div class="production-queue-empty">Ready batches will appear here as the kitchen completes them.</div>';
  const categoryTabs = `<button class="${state.productionCategory === 'All' ? 'active' : ''}" data-production-category="All">All dishes</button>${categories.map(item => `<button class="${state.productionCategory === item ? 'active' : ''}" data-production-category="${esc(item)}">${esc(item)}</button>`).join('')}`;
  const error = state.productionBoard.error ? `<div class="production-board-error" role="alert"><strong>Production queue unavailable</strong><span>${esc(state.productionBoard.error)}</span><button class="ghost-btn compact-btn" data-action="retry-production-board">Try again</button></div>` : '';
  const loading = state.productionBoard.loading ? '<div class="production-queue-empty" role="status">Loading today’s production batches…</div>' : '';
  return `${pageHeader('Buffet kitchen', 'Production board', 'Choose a dish and portions for each numbered cooking batch. Quick buttons start half or full recipe yield; use custom portions for a smaller top-up.', `<button class="ghost-btn" data-action="toggle-production-history">${state.productionHistoryOpen ? 'Hide production history' : 'View production history'}</button>`)}<div class="production-date-bar"><div><strong>Today’s service</strong><small>${new Date(`${today()}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</small></div><span class="tag">${cooking.length} cooking · ${rows.filter(item => item.status === 'Ready').length} ready</span></div>${error}${loading}<div class="category-tabs production-category-tabs">${categoryTabs}</div><section class="production-dish-grid">${recipeCards || '<div class="panel empty-state">No recipes are set up yet. Ask an Administrator or Manager to create recipe cards first.</div>'}</section><div class="production-queue-grid"><section class="panel production-queue-panel"><div class="panel-header"><div><div class="panel-title">Cooking now <span class="nav-badge">${cooking.length}</span></div><div class="panel-subtitle">Each numbered batch is tracked separately.</div></div></div><div class="production-queue-list">${cookingRows}</div></section><section class="panel production-queue-panel"><div class="panel-header"><div><div class="panel-title">Ready batches</div><div class="panel-subtitle">Completed batches for today’s service.</div></div></div><div class="production-queue-list">${readyRows}</div></section></div>${state.productionHistoryOpen ? productionHistoryPanel() : ''}`;
}
async function loadProductionBoard(force = false) {
  const date = today();
  const board = state.productionBoard;
  if (!state.user || board.loading || (!force && board.loaded && board.date === date)) return false;
  board.loading = true;
  board.date = date;
  board.error = '';
  if (state.view === 'production') render();
  try {
    board.rows = await window.supabaseRecord.loadProductionBatches(date);
    board.loaded = true;
    return true;
  } catch (error) {
    console.error('Production batches could not be loaded.', error);
    board.error = friendlyRpcError(error);
    board.loaded = true;
    return false;
  } finally {
    board.loading = false;
    if (state.view === 'production') render();
  }
}
function productionHistoryPanel() {
  const history = state.productionHistory;
  const recipes = all('recipes');
  const timeFor = item => {
    const timestamp = item.status === 'Ready' ? item.readyAt : item.startedAt;
    return timestamp ? new Date(timestamp) : null;
  };
  const matches = history.rows.filter(item => {
    if (history.dish !== 'All' && item.recipeId !== history.dish) return false;
    if (history.status !== 'All' && item.status !== history.status) return false;
    const eventTime = timeFor(item);
    if ((history.timeFrom || history.timeTo) && !eventTime) return false;
    const clock = eventTime ? `${String(eventTime.getHours()).padStart(2, '0')}:${String(eventTime.getMinutes()).padStart(2, '0')}` : '';
    if (history.timeFrom && clock < history.timeFrom) return false;
    if (history.timeTo && clock > history.timeTo) return false;
    return true;
  }).sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || String(b.readyAt || b.startedAt || '').localeCompare(String(a.readyAt || a.startedAt || '')) || Number(b.batchNumber) - Number(a.batchNumber));
  const rows = matches.map(item => {
    const eventTime = timeFor(item);
    const timeLabel = item.legacyTimeUnknown || !eventTime
      ? 'Not recorded (legacy)'
      : `${item.status === 'Ready' ? 'Ready' : 'Started'} ${eventTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    return `<tr><td>${esc(item.serviceDate)}</td><td>${esc(timeLabel)}</td><td>#${item.batchNumber}</td><td><strong>${esc(item.recipeName || recipe(item.recipeId)?.name || 'Unknown dish')}</strong><small class="sub-cell">${esc(item.category || '')}</small></td><td>${Number(item.portions || 0)} portions</td><td><span class="status ${item.status === 'Ready' ? 'status-good' : 'status-low'}">${esc(item.status)}</span></td></tr>`;
  });
  const note = history.timeFrom || history.timeTo
    ? '<small class="production-history-note">Legacy records without timestamps are omitted when filtering by time.</small>'
    : '<small class="production-history-note">Older production records are retained; their exact times were not recorded.</small>';
  const error = history.error ? `<div class="production-board-error" role="alert"><strong>History unavailable</strong><span>${esc(history.error)}</span><button class="ghost-btn compact-btn" data-action="retry-production-history">Try again</button></div>` : '';
  const loading = history.loading ? '<div class="production-queue-empty" role="status">Loading production history…</div>' : '';
  return `<section class="panel production-history-panel">
    <div class="panel-header"><div><div class="panel-title">Production history</div><div class="panel-subtitle">Filter by service date, batch activity time, dish, or status. ${matches.length} record${matches.length === 1 ? '' : 's'} shown.</div></div></div>
    <div class="production-history-filters">
      <label>From date<input data-history-filter="from" type="date" value="${esc(history.from || today())}"></label>
      <label>To date<input data-history-filter="to" type="date" value="${esc(history.to || today())}"></label>
      <label>Activity from<input data-history-filter="timeFrom" type="time" value="${esc(history.timeFrom)}"></label>
      <label>Activity to<input data-history-filter="timeTo" type="time" value="${esc(history.timeTo)}"></label>
      <label>Dish<select data-history-filter="dish"><option value="All">All dishes</option>${recipes.map(item => `<option value="${esc(item.id)}" ${history.dish === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
      <label>Status<select data-history-filter="status"><option value="All" ${history.status === 'All' ? 'selected' : ''}>All statuses</option><option value="Cooking" ${history.status === 'Cooking' ? 'selected' : ''}>Cooking</option><option value="Ready" ${history.status === 'Ready' ? 'selected' : ''}>Ready</option></select></label>
      <button class="primary-btn compact-btn" data-action="apply-production-history">Apply filters</button>
    </div>
    ${note}${error}${loading}
    <div class="table-scroll"><table><thead><tr><th>Service date</th><th>Activity time</th><th>Batch</th><th>Dish</th><th>Portions</th><th>Status</th></tr></thead><tbody>${!history.loading && !rows.length ? '<tr><td colspan="6" class="empty-state">No production batches match these filters.</td></tr>' : rows.join('')}</tbody></table></div>
  </section>`;
}
async function loadProductionHistory(force = false) {
  const history = state.productionHistory;
  const from = history.from || today();
  const to = history.to || today();
  if (!state.user || history.loading || (!force && history.loaded && history.from === from && history.to === to)) return false;
  history.loading = true;
  history.from = from;
  history.to = to;
  history.error = '';
  if (state.view === 'production') render();
  try {
    history.rows = await window.supabaseRecord.loadProductionHistory(from, to);
    history.loaded = true;
    return true;
  } catch (error) {
    console.error('Production history could not be loaded.', error);
    history.error = friendlyRpcError(error);
    history.loaded = true;
    return false;
  } finally {
    history.loading = false;
    if (state.view === 'production') render();
  }
}
function countsPage() {
  const canSubmitCount = window.CostTrackLogic.canPerformInventoryAction(state.role, 'count.submit');
  const rows = all('physicalCounts').slice().reverse().map(item => {
    const stockItem = ingredient(item.ingredientId);
    const difference = item.actual - item.expected;
    return `<tr><td><strong>${esc(stockItem?.name || 'Unknown')}</strong></td><td>${item.expected} ${esc(stockItem?.unit || '')}</td><td>${item.actual} ${esc(stockItem?.unit || '')}</td><td class="${difference < 0 ? 'negative' : 'positive'}">${difference > 0 ? '+' : ''}${difference.toFixed(2)}</td><td><span class="status ${difference < 0 ? 'status-low' : 'status-good'}">${difference < 0 ? 'Shortage' : difference > 0 ? 'Overage' : 'Matched'}</span></td><td>${esc(item.date || '')}</td><td>${actions('count', item.id)}</td></tr>`;
  });
  return tablePage({
    eyebrow: 'Reconciliation',
    title: 'Physical inventory count',
    subtitle: 'Compare expected system stock with what is physically on hand.',
    action: canSubmitCount ? '<button class="primary-btn" data-action="open-count">+ Record count</button>' : '',
    search: 'counts',
    headers: ['Ingredient', 'Expected', 'Actual count', 'Variance', 'Result', 'Count date', ''],
    rows
  });
}
function ratesPage() {
  const rows = all('buffetRates').slice().sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)).map(item =>
    `<tr><td><strong>${esc(item.mealPeriod)}</strong></td><td>${esc(item.dayType)}</td><td>${money(item.adultRate)}</td><td>${money(item.childRate)}</td><td>${money(item.seniorPwdRate)}</td><td>${esc(item.effectiveFrom)}${item.effectiveTo ? ` – ${esc(item.effectiveTo)}` : ' onward'}</td><td><span class="status ${item.isActive ? 'status-good' : 'status-low'}">${item.isActive ? 'Active' : 'Inactive'}</span></td><td><button class="ghost-btn compact-btn" data-action="edit-rate" data-id="${esc(item.id)}">Edit</button>${item.isActive ? ` <button class="ghost-btn compact-btn" data-action="deactivate-rate" data-id="${esc(item.id)}">Deactivate</button>` : ''}</td></tr>`
  );
  return tablePage({
    eyebrow: 'Revenue management',
    title: 'Buffet rates',
    subtitle: 'Manage effective adult, child, and senior/PWD rates by meal period and day type.',
    action: '<button class="primary-btn" data-action="open-rate">+ Add rate</button>',
    search: 'rates',
    headers: ['Meal period', 'Day type', 'Adult', 'Child', 'Senior/PWD', 'Effective dates', 'Status', ''],
    rows
  });
}
function chargeCatalogPage() {
  const chargeItems = all('chargeItems');
  const packageTiers = all('packageTiers');
  const discounts = all('discounts');
  const settings = all('posSettings');
  const rows = chargeItems.length ? chargeItems.map(item => `<tr><td><strong>${esc(item.code || item.id)}</strong></td><td>${esc(item.name)}</td><td><span class="tag">${esc(item.type)}</span></td><td>${item.isFoodRevenue ? 'Food' : 'Non-food'}</td><td>${money(item.unitPrice || 0)}</td><td><button class="ghost-btn compact-btn" data-action="edit-charge-item" data-id="${esc(item.id)}">Edit</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">No catalog entries yet. Use the migration seed data or add a charge item from the catalog editor.</td></tr>';
  const packageRows = packageTiers.length ? packageTiers.map(item => `<tr><td><strong>${esc(item.code || item.id)}</strong></td><td>${esc(item.name)}</td><td>${esc(item.defaultMealPeriod || 'All Day')}</td><td>${money(item.basePrice || 0)}</td><td><span class="status ${item.isActive ? 'status-good' : 'status-low'}">${item.isActive ? 'Active' : 'Inactive'}</span></td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">No package tiers defined.</td></tr>';
  const discountRows = discounts.length ? discounts.map(item => `<tr><td><strong>${esc(item.code || item.id)}</strong></td><td>${esc(item.name)}</td><td>${esc(item.discountType)}</td><td>${esc(item.appliesTo || 'bill')}</td><td>${item.discountType === 'percent' ? `${Number(item.value || 0).toFixed(2)}%` : money(item.value || 0)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">No discount presets defined.</td></tr>';
  const settingsRows = settings.length ? settings.map(item => `<tr><td>${esc(item.key)}</td><td>${esc(item.type)}</td><td>${esc(String(item.value || ''))}</td></tr>`).join('') : '<tr><td colspan="3" class="empty-state">No operating settings saved yet.</td></tr>';
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">Charge catalog</div>
          <div class="panel-subtitle">Service charges, package tiers, discounts, and POS settings for the cashier workflow.</div>
        </div>
        <button class="primary-btn" data-action="new-charge-item">+ New charge</button>
      </div>
      <div class="two-column-grid">
        <div class="panel">
          <div class="sub-panel-header"><strong>Charge items</strong></div>
          <div class="table-scroll"><table><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Revenue</th><th>Price</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        </div>
        <div class="panel">
          <div class="sub-panel-header"><strong>Package tiers</strong></div>
          <div class="table-scroll"><table><thead><tr><th>Code</th><th>Name</th><th>Meal</th><th>Base</th><th>Status</th></tr></thead><tbody>${packageRows}</tbody></table></div>
        </div>
      </div>
      <div class="two-column-grid">
        <div class="panel">
          <div class="sub-panel-header"><strong>Discount presets</strong></div>
          <div class="table-scroll"><table><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Applies</th><th>Value</th></tr></thead><tbody>${discountRows}</tbody></table></div>
        </div>
        <div class="panel">
          <div class="sub-panel-header"><strong>POS settings</strong></div>
          <div class="table-scroll"><table><thead><tr><th>Key</th><th>Type</th><th>Value</th></tr></thead><tbody>${settingsRows}</tbody></table></div>
        </div>
      </div>
    </section>
  `;
}
function cashierPage() {
  const bills = all('posBills').slice().sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  const rows = bills.map(item => {
    const canEdit = item.status === 'Open'
      && (state.role !== 'Receptionist' || item.createdBy === state.user?.id);
    return `<tr><td><strong>${esc(item.billNumber || item.id)}</strong></td><td>${esc(item.customerName || 'Walk-in')}</td><td>${Number(item.customersServed || 0)} served</td><td><span class="status ${item.status === 'Closed' ? 'status-good' : item.status === 'Voided' ? 'status-out' : 'status-low'}">${esc(item.status)}</span></td><td>${money(item.balanceDue || 0)}</td><td>${money(item.paidTotal || 0)}</td><td><div class="row-actions"><button class="ghost-btn compact-btn" data-action="open-bill" data-id="${esc(item.id)}">${canEdit ? 'Edit' : 'View'}</button><button class="ghost-btn compact-btn" data-action="print-bill" data-id="${esc(item.id)}">Print</button></div></td></tr>`;
  });
  return tablePage({
    eyebrow: 'Front of House',
    title: 'Cashier',
    subtitle: 'Create and settle bills without changing stock. Deposits are payments, never discounts.',
    action: '<button class="primary-btn" data-action="new-bill">+ New bill</button>',
    search: 'cashier',
    headers: ['Bill #', 'Customer', 'Served', 'Status', 'Balance', 'Paid', ''],
    rows,
    emptyMessage: 'No bills yet. Create a bill to begin.'
  });
}
function shiftsPage() {
  const rows = all('shifts').slice().reverse().map(item => `<tr><td>${esc(item.code || item.id)}</td><td>${esc(item.status)}</td><td>${esc(item.openedAt || '')}</td><td>${money(item.openingFloat || 0)}</td><td>${money(item.cashSales || 0)}</td><td><button class="ghost-btn compact-btn" data-action="open-shift" data-id="${esc(item.id)}">View</button></td></tr>`);
  return tablePage({
    eyebrow: 'Front of House',
    title: 'Shifts',
    subtitle: 'Track cashier float, cash movement, and end-of-shift reconciliation.',
    action: '<button class="primary-btn" data-action="new-shift">+ Open shift</button>',
    search: 'shifts',
    headers: ['Shift', 'Status', 'Opened', 'Float', 'Cash sales', ''],
    rows,
    emptyMessage: 'No shifts recorded yet.'
  });
}
function approvalsPage() {
  const approvals = all('billApprovals').slice().sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')));
  const canDecide = ['Administrator', 'Manager'].includes(state.role);
  const rows = approvals.map(item => {
    const bill = all('posBills').find(record => record.id === item.billId);
    const label = item.requestType === 'void' ? 'Void bill' : '100% discount';
    const canReview = canDecide && item.status === 'Pending' && item.requestedBy !== state.user?.id;
    const decision = item.decidedBy
      ? `<small>Decision by ${esc(item.decidedBy)} · ${esc(item.decidedAt || '')}${item.decisionReason ? ` · ${esc(item.decisionReason)}` : ''}</small>`
      : '';
    const actions = canReview
      ? `<button class="ghost-btn compact-btn" data-action="approve-approval" data-id="${esc(item.id)}">Approve</button><button class="ghost-btn compact-btn" data-action="reject-approval" data-id="${esc(item.id)}">Reject</button>`
      : '';
    return `<tr><td><strong>${esc(bill?.billNumber || item.billId)}</strong><small>${esc(label)}</small></td><td><span class="status ${item.status === 'Approved' ? 'status-good' : item.status === 'Pending' ? 'status-low' : 'status-out'}">${esc(item.status)}</span>${decision}</td><td>${esc(item.requestReason)}<small>Requested by ${esc(item.requestedBy)} · ${esc(item.requestedAt || '')}</small></td><td>${actions}</td></tr>`;
  });
  return tablePage({
    eyebrow: 'Front of House',
    title: 'Approvals',
    subtitle: canDecide
      ? 'Review and decide full-discount and bill-void requests. You cannot decide your own request.'
      : 'Track the status and decision history of your approval requests.',
    search: 'approvals',
    headers: ['Bill / Request', 'Status / Decision', 'Reason / Requested by', 'Action'],
    rows,
    emptyMessage: 'No approval requests.'
  });
}
function usersPage() {
  const rows = all('users').filter(item => `${item.name} ${item.email} ${item.role}`.toLowerCase().includes(state.query.toLowerCase()))
    .map(item => `<tr><td><div class="cell-title"><span class="avatar user-avatar">${esc((item.name || item.email || '?').split(' ').map(part => part[0]).join('').slice(0, 2))}</span><strong>${esc(item.name || 'Team member')}</strong></div></td><td>${esc(item.email)}</td><td><span class="tag">${esc(item.role)}</span></td><td><span class="status status-good">Active</span></td><td></td></tr>`);
  return tablePage({
    eyebrow: 'Administration',
    title: state.view === 'roles' ? 'Role management' : state.view === 'settings' ? 'System settings' : 'User management',
    subtitle: 'User accounts and roles are managed through Supabase Auth and protected profiles.',
    search: 'users',
    headers: ['User', 'Email', 'Role', 'Status', ''],
    rows
  });
}
function options(items, valueKey = 'id', labelKey = 'name') { return items.map(x => `<option value="${x[valueKey]}">${esc(x[labelKey])}</option>`).join(''); }
function updateWasteFormPreview(form) {
  const product = ingredient(form.elements.ingredientId.value);
  const quantity = Number(form.elements.quantity.value || 0);
  const stockLabel = form.querySelector('[data-waste-stock]');
  const impactLabel = form.querySelector('[data-waste-impact]');
  if (stockLabel) stockLabel.textContent = product ? `${Number(product.stock)} ${product.unit} currently on hand` : 'Select an ingredient to see available stock.';
  if (!impactLabel) return;
  if (!product || !Number.isFinite(quantity) || quantity <= 0) {
    impactLabel.textContent = '';
    impactLabel.classList.remove('is-warning');
    return;
  }
  const remaining = Number(product.stock) - quantity;
  impactLabel.textContent = remaining < 0
    ? `Not enough stock. Current balance: ${Number(product.stock)} ${product.unit}.`
    : `After logging, about ${Number(remaining.toFixed(4))} ${product.unit} will remain.`;
  impactLabel.classList.toggle('is-warning', remaining < 0);
}
async function openForm(type, item) {
  const requiredAction = {
    ingredient: 'product.manage',
    receiving: 'inventory.receive',
    recipe: 'recipe.manage',
    production: 'production.log',
    waste: 'waste.log',
    count: 'count.submit',
    user: 'user.manage'
  }[type];
  if (requiredAction && !window.CostTrackLogic.canPerformInventoryAction(state.role, requiredAction)) {
    return toast('You do not have permission to perform this action.', 'error');
  }
  const edit = item ? true : false; const value = key => item?.[key] ?? '';
  if (type === 'ingredient') {
    let catalogs;
    try {
      catalogs = await window.supabaseRecord.loadProductFormOptions();
    } catch (error) {
      console.error('Product form catalogs could not be loaded.', error);
      return toast(friendlyRpcError(error), 'error');
    }
    const categories = catalogs.categories.map(category => `<option value="${esc(category)}" ${value('category') === category ? 'selected' : ''}>${esc(category)}</option>`).join('');
    const units = catalogs.units.map(unit => `<option value="${esc(unit.abbreviation)}" ${value('unit') === unit.abbreviation ? 'selected' : ''}>${esc(unit.name)} (${esc(unit.abbreviation)})</option>`).join('');
    state.supplierOptions = catalogs.suppliers;
    const suppliers = [...new Set([
      ...catalogs.suppliers,
      ...all('ingredients').map(product => product.preferredSupplier).filter(Boolean)
    ])].sort((a, b) => a.localeCompare(b)).map(supplier => `<option value="${esc(supplier)}"></option>`).join('');
    const noCategories = catalogs.categories.length === 0;
    const noUnits = catalogs.units.length === 0;
    const content = `<div class="product-form">
      <p class="product-form-intro">Set up the product details used for inventory, receiving, and stock alerts.</p>
      <fieldset class="product-form-section">
        <legend>Product details</legend>
        <div class="form-grid product-details-grid">
          <label class="full">Product name<input name="name" value="${esc(value('name'))}" maxlength="200" placeholder="e.g. Fresh milk" autocomplete="off" required></label>
          <label>Category<select name="category" required><option value="">Choose a category</option>${categories}</select><small class="field-help">${noCategories ? 'No active categories are available. Configure categories before adding a product.' : 'Choose the best fit for reports and inventory filters.'}</small></label>
          <label>Stocking unit<select name="unit" required><option value="">Choose a unit</option>${units}</select><small class="field-help">${noUnits ? 'No active units are available. Configure units before adding a product.' : 'Use the unit in which this product is counted and received.'}</small></label>
        </div>
      </fieldset>
      <fieldset class="product-form-section">
        <legend>Stock planning</legend>
        <div class="form-grid product-planning-grid">
          <label>Minimum stock level<input name="minimum" type="number" min="0" step=".0001" value="${esc(value('minimum'))}" placeholder="e.g. 5" required><small class="field-help">Get a low-stock warning when on-hand stock reaches this amount.</small></label>
          <label>Preferred supplier<input name="preferredSupplier" list="preferredSupplierSuggestions" value="${esc(value('preferredSupplier'))}" maxlength="200" placeholder="Choose or type a supplier" autocomplete="off"><datalist id="preferredSupplierSuggestions">${suppliers}</datalist><small class="field-help">Optional. Select a saved supplier or enter a name.</small></label>
        </div>
        <label class="product-expiry-toggle"><input name="trackExpiry" type="checkbox" ${value('trackExpiry') ? 'checked' : ''}><span><strong>Track expiration dates</strong><small>Require an expiration date for every delivery of this product. Dates are recorded per received lot.</small></span></label>
      </fieldset>
      <fieldset class="product-form-section">
        <legend>Additional information</legend>
        <label class="product-notes-field">Product notes <span class="field-help">Optional — storage, handling, or ordering details.</span><textarea name="notes" rows="3" maxlength="1000" placeholder="Add helpful details for the inventory team">${esc(value('notes'))}</textarea></label>
      </fieldset>
      <p class="product-stock-note">Starting stock and purchase cost are recorded through inventory receiving, not in this form.</p>
    </div>`;
    modal(edit ? 'Edit product' : 'Add product', content, 'Save product', 'product-modal');
    const form = document.querySelector('#modalForm');
    form.dataset.type = type;
    if (item) form.dataset.id = item.id;
    const submit = form.querySelector('.modal-submit');
    if (submit && (noCategories || noUnits)) submit.disabled = true;
    return;
  }
  else if (type === 'receiving') return openReceivingForm();
  else if (type === 'recipe') modal(edit ? 'Edit recipe' : 'Create recipe', `<div class="form-grid"><label>Recipe name<input name="name" value="${esc(value('name'))}" required></label><label>Category<input name="category" value="${esc(value('category') || 'Main Course')}" required></label><label>Menu price<input name="price" type="number" min=".01" step=".01" value="${value('price')}" required></label><label>Wastage percentage<input name="wastage" type="number" min="0" max="100" step=".1" value="${value('wastage') || 2}" required></label><label class="full">Ingredients <small class="field-hint">Enter one ingredient quantity per line: ingredient name | quantity</small><textarea name="composition" required>${(item?.ingredients || []).map(x => `${ingredient(x.ingredientId)?.name || ''} | ${x.quantity}`).join('\n')}</textarea></label></div>`, 'Save recipe');
  else if (type === 'waste') {
    const recentProductionDate = new Date();
    recentProductionDate.setDate(recentProductionDate.getDate() - 3);
    const recentProduction = all('productionLogs').filter(log => log.date >= localDateStr(recentProductionDate));
    const now = new Date();
    const ingredientOptions = all('ingredients').slice().sort((a, b) => a.name.localeCompare(b.name)).map(item => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.unit)}</option>`).join('');
    modal('Log kitchen waste', `<p class="waste-form-intro">Record discarded food or ingredients only. The stock deduction is applied once when this entry is saved.</p>
      <label>Ingredient<select name="ingredientId" required><option value="">Choose an ingredient</option>${ingredientOptions}</select><small class="field-help" data-waste-stock>Select an ingredient to see available stock.</small></label>
      <div class="form-grid"><label>Quantity discarded<input name="quantity" type="number" min=".0001" max="1000000" step=".0001" placeholder="e.g. 0.5" required><small class="field-help">Enter the amount using the ingredient’s stock unit.</small></label><label>Reason<select name="reason" required><option value="">Choose a reason</option>${wasteReasons.map(reason => `<option>${esc(reason)}</option>`).join('')}</select></label></div>
      <div class="waste-reason-shortcuts" aria-label="Common waste reasons">${wasteReasons.filter(reason => reason !== 'Other').map(reason => `<button type="button" class="ghost-btn compact-btn" data-waste-reason="${esc(reason)}">${esc(reason)}</button>`).join('')}</div>
      <small class="field-help waste-impact" data-waste-impact aria-live="polite"></small>
      <div class="form-grid"><label>Date<input name="date" type="date" value="${localDateStr(now)}" required></label><label>Time<input name="time" type="time" value="${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}" required></label></div>
      <label>Related dish / production batch <span class="field-help">Optional — helps identify where the waste came from.</span><select name="productionLogId"><option value="">Not linked</option>${recentProduction.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(log => `<option value="${esc(log.id)}">${esc(recipe(log.recipeId)?.name || 'Unknown dish')} · ${log.quantity} batch${Number(log.quantity) === 1 ? '' : 'es'} · ${esc(log.date)}</option>`).join('')}</select></label>
      <label>Notes <span class="field-help">Optional — required when you choose Other. Add a short detail such as storage issue or reason for over-preparation.</span><textarea name="notes" rows="2" maxlength="500" placeholder="Optional detail"></textarea></label>
      <p class="waste-disposition-note">Safe leftovers that are stored or reused are not waste entries. Log them here only if they are later discarded.</p>`, 'Record waste', 'waste-modal');
    document.querySelector('#modalForm').dataset.type = type;
    document.querySelector('#modalForm').querySelector('[name="ingredientId"]').focus();
    return;
  }
  else if (type === 'production') modal('Log production batch', `<div class="form-grid"><label>Recipe<select name="recipeId" required>${options(all('recipes'))}</select></label><label>Batches<input name="quantity" type="number" min="1" step="1" required></label><label>Covers produced <small class="field-help">Optional</small><input name="coversProduced" type="number" min="0" step="1"></label><label>Mode<select name="mode"><option>Batch production</option><option>End-of-day sales summary</option></select></label><label>Date<input name="date" type="date" value="${today()}" required></label></div>`);
  else if (type === 'count') modal('Record physical count', `<div class="form-grid"><label>Ingredient<select name="ingredientId" required>${options(all('ingredients'))}</select></label><label>Expected quantity<input name="expected" type="number" min="0" step=".01" required></label><label>Actual count<input name="actual" type="number" min="0" step=".01" required></label><label>Count date<input name="date" type="date" value="${today()}" required></label></div>`);
  else if (type === 'user') modal('Add workspace user', `<div class="form-grid"><label>Full name<input name="name" required></label><label>Work email<input name="email" type="email" required></label><label class="full">Role<select name="role"><option>Administrator</option><option>Manager</option><option>Inventory Clerk</option><option>Chef / Kitchen Staff</option><option>Receptionist</option></select></label></div>`, 'Add user');
  document.querySelector('#modalForm').dataset.type = type; if (item) document.querySelector('#modalForm').dataset.id = item.id;
}
function emptyReceivingLine() {
  return { id: id('RCV'), ingredientId: '', quantity: '', unitCost: '', batchCode: '', expirationDate: '' };
}
function readReceivingDraft(form) {
  state.receivingForm = {
    supplierName: form.elements.supplierName.value,
    invoiceNumber: form.elements.invoiceNumber.value,
    invoiceDate: form.elements.invoiceDate.value,
    receivedDate: form.elements.receivedDate.value,
    note: form.elements.note.value
  };
  state.receivingDraft = [...form.querySelectorAll('.receipt-line')].map(line => ({
    id: line.dataset.id,
    ingredientId: line.querySelector('[data-field="ingredientId"]').value,
    quantity: line.querySelector('[data-field="quantity"]').value,
    unitCost: line.querySelector('[data-field="unitCost"]').value,
    batchCode: line.querySelector('[data-field="batchCode"]').value,
    expirationDate: line.querySelector('[data-field="expirationDate"]').value
  }));
}
function receivingLineMarkup(line, index) {
  const products = all('ingredients');
  const product = products.find(item => item.id === line.ingredientId);
  const expiryRequired = Boolean(product?.trackExpiry);
  return `<fieldset class="receipt-line" data-line-index="${index}" data-id="${esc(line.id)}"><legend>Product ${index + 1}</legend>${state.receivingDraft.length > 1 ? `<button type="button" class="receipt-remove-line" data-action="remove-receiving-line" data-index="${index}" aria-label="Remove product ${index + 1}">Remove</button>` : ''}<div class="receipt-line-grid"><label>Product<select name="ingredient_${index}" data-field="ingredientId" required><option value="">Choose a product</option>${products.map(item => `<option value="${esc(item.id)}" ${line.ingredientId === item.id ? 'selected' : ''}>${esc(item.name)} · ${esc(item.unit)}</option>`).join('')}</select></label><label>Quantity received<input name="quantity_${index}" data-field="quantity" type="number" min=".0001" step=".0001" value="${esc(line.quantity)}" placeholder="0.00" required></label><label>Unit cost <span class="field-help">Per stocking unit</span><input name="unitCost_${index}" data-field="unitCost" type="number" min="0" step=".01" value="${esc(line.unitCost)}" placeholder="₱ 0.00" required></label><label>Lot / batch number <span class="field-help">Optional</span><input name="batchCode_${index}" data-field="batchCode" value="${esc(line.batchCode)}" maxlength="100" placeholder="Printed on package"></label><label>Expiration date <span class="field-help" data-expiration-help>${expiryRequired ? 'Required for this product' : 'Optional — add when available'}</span><input name="expirationDate_${index}" data-field="expirationDate" type="date" value="${esc(line.expirationDate)}" ${expiryRequired ? 'required' : ''}></label></div><div class="receipt-line-total">Line total <strong data-receipt-line-total>${money(Number(line.quantity || 0) * Number(line.unitCost || 0))}</strong></div></fieldset>`;
}
function updateReceivingExpiryRequirements(form) {
  form.querySelectorAll('.receipt-line').forEach(line => {
    const productId = line.querySelector('[data-field="ingredientId"]').value;
    const product = all('ingredients').find(item => item.id === productId);
    const expiration = line.querySelector('[data-field="expirationDate"]');
    const help = line.querySelector('[data-expiration-help]');
    const required = Boolean(product?.trackExpiry);
    expiration.required = required;
    expiration.closest('label').classList.toggle('required-field', required);
    help.textContent = required ? 'Required for this product' : 'Optional — add when available';
  });
}
function updateReceivingTotals(form) {
  let total = 0;
  form.querySelectorAll('.receipt-line').forEach(line => {
    const quantity = Number(line.querySelector('[data-field="quantity"]').value || 0);
    const unitCost = Number(line.querySelector('[data-field="unitCost"]').value || 0);
    const lineTotal = quantity * unitCost;
    total += lineTotal;
    line.querySelector('[data-receipt-line-total]').textContent = money(lineTotal);
  });
  const totalElement = form.querySelector('[data-receipt-total]');
  if (totalElement) totalElement.textContent = money(total);
}
function renderReceivingModal() {
  const header = state.receivingForm || {};
  const lines = state.receivingDraft.length ? state.receivingDraft : [emptyReceivingLine()];
  state.receivingDraft = lines;
  const noProducts = all('ingredients').length === 0;
  const supplierOptions = [...new Set([
    ...(state.supplierOptions || []),
    ...all('ingredients').map(product => product.preferredSupplier).filter(Boolean)
  ])].sort((a, b) => a.localeCompare(b)).map(supplier => `<option value="${esc(supplier)}"></option>`).join('');
  modal('Record delivery invoice', `<div class="receipt-form"><p class="receipt-intro">Enter the supplier invoice and each product lot received. This saves the invoice lines and updates stock together.</p><fieldset class="receipt-section"><legend>Invoice and delivery</legend><div class="form-grid receipt-header-grid"><label>Supplier name<input name="supplierName" list="receiptSupplierSuggestions" maxlength="200" value="${esc(header.supplierName || '')}" placeholder="Choose or type a supplier" required><datalist id="receiptSupplierSuggestions">${supplierOptions}</datalist></label><label>Invoice / receipt number<input name="invoiceNumber" maxlength="100" value="${esc(header.invoiceNumber || '')}" placeholder="e.g. INV-2026-001" required></label><label>Invoice date<input name="invoiceDate" type="date" value="${esc(header.invoiceDate || today())}" required></label><label>Date received<input name="receivedDate" type="date" value="${esc(header.receivedDate || today())}" required></label></div></fieldset><fieldset class="receipt-section"><legend>Products received</legend><div class="receipt-items-heading"><div><strong>Invoice items</strong><small>Add a separate line for each product or lot.</small></div>${noProducts ? '' : '<button type="button" class="ghost-btn compact-btn" data-action="add-receiving-line">+ Add product</button>'}</div>${noProducts ? '<p class="receipt-empty-hint">No products are available. Ask an Administrator to add products before recording a delivery.</p>' : `<div class="receipt-lines">${lines.map(receivingLineMarkup).join('')}</div>`}<div class="receipt-total"><span>Items subtotal <small>Quantity × unit cost, before tax or other charges</small></span><strong data-receipt-total>₱0.00</strong></div></fieldset><label class="receipt-note">Delivery note <span class="field-help">Optional — e.g. delivery condition or reference</span><textarea name="note" rows="2" maxlength="500" placeholder="Add a note about this delivery">${esc(header.note || '')}</textarea></label></div>`, 'Record delivery');
  const form = document.querySelector('#modalForm');
  document.querySelector('.modal').classList.add('receiving-modal');
  form.dataset.type = 'receiving';
  if (noProducts) form.querySelector('.modal-submit').disabled = true;
  updateReceivingTotals(form);
  updateReceivingExpiryRequirements(form);
}
async function openReceivingForm() {
  try {
    const catalogs = await window.supabaseRecord.loadProductFormOptions();
    state.supplierOptions = catalogs.suppliers;
  } catch (error) {
    console.error('Supplier suggestions could not be loaded.', error);
    return toast(friendlyRpcError(error), 'error');
  }
  state.receivingForm = { supplierName: '', invoiceNumber: '', invoiceDate: today(), receivedDate: today(), note: '' };
  state.receivingDraft = [emptyReceivingLine()];
  renderReceivingModal();
}
function renderRecipeModal() {
  const form = state.recipeForm || {};
  const categories = [...new Set([
    'Main Course', 'Appetizer', 'Dessert', 'Beverage', 'Side Dish', 'Sauce',
    ...all('recipes').map(item => item.category).filter(Boolean)
  ])].sort((a, b) => a.localeCompare(b));
  const names = state.recipeDraft.map(item => `${ingredient(item.ingredientId)?.name || 'Ingredient'} | ${item.quantity} ${ingredient(item.ingredientId)?.unit || ''}`);
  modal(form.id ? 'Edit recipe' : 'Create recipe', `<div class="form-grid">
    <label>Recipe name<input name="name" value="${esc(form.name || '')}" maxlength="160" required></label>
    <label>Category<input name="category" list="recipeCategoryOptions" value="${esc(form.category || '')}" maxlength="80" placeholder="Choose or type a category" required><datalist id="recipeCategoryOptions">${categories.map(category => `<option value="${esc(category)}"></option>`).join('')}</datalist><small class="field-help">Choose an existing category or type a new one.</small></label>
    <label>Batch yield <small class="field-help">Portions produced by one batch.</small><input name="batchYield" type="number" min="1" step="1" value="${Number(form.batchYield || 30)}" required></label>
    <label>Prep target per service <small class="field-help">Starting target; the Chef can replenish as needed.</small><input name="prepTarget" type="number" min="1" step="1" value="${Number(form.prepTarget || 30)}" required></label>
    <label>Menu price<input name="price" type="number" min=".01" step=".01" value="${form.price ?? ''}" required></label>
    <label>Wastage percentage<input name="wastage" type="number" min="0" max="100" step=".1" value="${form.wastage ?? 2}" required></label>
    <label class="full">Preparation notes <small class="field-help">Short cooking or presentation instructions shown on the Chef’s production board.</small><textarea name="prepNotes" maxlength="1000" rows="3" placeholder="e.g. Cook in shallow batches; keep sauce separate until service.">${esc(form.prepNotes || '')}</textarea></label>
    <div class="full recipe-ingredients-field"><div class="field-label">Recipe ingredients <small class="field-hint">Select ingredients from current inventory and set the quantity used in one batch.</small></div><div class="selected-ingredients">${state.recipeDraft.length ? state.recipeDraft.map((item, index) => `<div class="selected-ingredient"><span>✓</span><strong>${esc(ingredient(item.ingredientId)?.name)}</strong><small>${item.quantity} ${esc(ingredient(item.ingredientId)?.unit || '')}</small><button type="button" data-action="remove-recipe-ingredient" data-index="${index}">×</button></div>`).join('') : '<div class="empty-ingredient">No ingredients added yet.</div>'}</div><button type="button" class="ghost-btn add-ingredient-btn" data-action="toggle-recipe-picker">+ Add Ingredient</button><div class="recipe-picker is-hidden"><label>Inventory ingredient<select name="draftIngredient">${options(all('ingredients'))}</select></label><label>Quantity required<input name="draftQuantity" type="number" min=".001" step=".001" placeholder="e.g. 0.25"></label><button type="button" class="primary-btn compact-btn" data-action="add-recipe-ingredient">Add to recipe</button></div><input type="hidden" name="composition" value="${esc(names.join('\\n'))}"></div>
  </div>`, 'Save recipe');
  document.querySelector('#modalForm').dataset.type = 'recipe';
  if (form.id) document.querySelector('#modalForm').dataset.id = form.id;
}
function openRecipeForm(item) {
  if (!window.CostTrackLogic.canPerformInventoryAction(state.role, 'recipe.manage')) {
    return toast('You do not have permission to manage recipes.', 'error');
  }
  state.recipeDraft = item ? item.ingredients.map(line => ({ ...line })) : [];
  state.recipeForm = item ? { ...item } : {};
  renderRecipeModal();
}
function viewRecord(type, item) {
  if (type === 'ingredient') {
    const movements = all('inventoryTransactions').filter(row => row.ingredientId === item.id).slice().reverse();
    const canSeeCost = ['Administrator', 'Manager', 'Inventory Clerk'].includes(state.role);
    const movementRows = movements.length ? movements.map(row => `<tr><td>${esc(row.date)}</td><td>${esc(row.type)}</td><td>${row.quantity} ${esc(item.unit)}</td>${canSeeCost ? `<td>${money(row.unitCost)}</td>` : ''}<td>${esc(row.user || '—')}</td></tr>`).join('') : `<tr><td colspan="${canSeeCost ? 5 : 4}" class="empty-state">No stock movements recorded yet.</td></tr>`;
    modal(item.name, `<div class="detail-grid"><div><small>Category</small><strong>${esc(item.category)}</strong></div><div><small>Stock status</small><strong>${stockStatus(item)}</strong></div><div><small>Current stock</small><strong>${item.stock} ${esc(item.unit)}</strong></div>${canSeeCost ? `<div><small>Cost per unit</small><strong>${money(item.cost)}</strong></div>` : ''}<div><small>Minimum stock</small><strong>${item.minimum} ${esc(item.unit)}</strong></div><div><small>Preferred supplier</small><strong>${esc(item.preferredSupplier || 'Not set')}</strong></div><div><small>Expiry tracking</small><strong>${item.trackExpiry ? 'Required on each receipt' : 'Not required'}</strong></div>${item.notes ? `<div class="full"><small>Product notes</small><strong>${esc(item.notes)}</strong></div>` : ''}<div class="full"><small>Stock movement history</small><div class="table-scroll"><table><thead><tr><th>Date</th><th>Type</th><th>Quantity</th>${canSeeCost ? '<th>Unit cost</th>' : ''}<th>User</th></tr></thead><tbody>${movementRows}</tbody></table></div></div></div>`, null);
  }
  if (type === 'recipe') {
    const canSeeCosts = ['Administrator', 'Manager'].includes(state.role);
    const cost = canSeeCosts ? computedRecipeCost(item) : null;
    const costDetails = canSeeCosts
      ? `<div><small>Cost per serving</small><strong>${money(cost)}</strong></div><div><small>Menu price</small><strong>${money(item.price)}</strong></div><div><small>Profit margin</small><strong>${Number(item.price) ? ((item.price - cost) / item.price * 100).toFixed(1) : '—'}%</strong></div>`
      : '';
    modal(item.name, `<div class="detail-grid"><div><small>Category</small><strong>${esc(item.category)}</strong></div><div><small>Batch yield</small><strong>${Number(item.batchYield || 30)} portions</strong></div><div><small>Prep target per service</small><strong>${Number(item.prepTarget || 30)} portions</strong></div>${costDetails}<div class="full"><small>Ingredients per batch</small><strong>${item.ingredients.map(line => `${esc(ingredient(line.ingredientId)?.name)} · ${line.quantity} ${esc(ingredient(line.ingredientId)?.unit || '')}`).join('<br>')}</strong></div>${item.prepNotes ? `<div class="full"><small>Preparation notes</small><strong>${esc(item.prepNotes)}</strong></div>` : ''}</div>`, null);
  }
}
function reservationDateLabel(value) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}
function reservationStatusClass(status) {
  return ['Confirmed', 'Checked-in', 'Seated', 'Completed'].includes(status) ? 'status-good' : ['Cancelled', 'No-show'].includes(status) ? 'status-out' : 'status-low';
}
function reservationMealPeriod(item) {
  const minutes = parseTime12h(item.time);
  if (minutes === null) return 'Other';
  if (minutes >= 11 * 60 && minutes < 16 * 60) return 'Lunch';
  if (minutes >= 16 * 60 && minutes <= 22 * 60) return 'Dinner';
  return 'Other';
}
function reservationDisplayName(item) {
  return item.type === 'Walk-in' ? 'Walk-in guest' : (item.name || 'Guest');
}
function reservationCard(item, showRevenue = false) {
  const isPastReservation = item.date < today();
  const guestCount = item.actualCovers || item.guests || (Number(item.adults || 0) + Number(item.children || 0));
  const rate = activeBuffetRate(item);
  const hasRevenue = all('revenueRecords').some(record => record.reservation_id === item.id);
  const historyLabel = isPastReservation ? '<span class="reservation-history-label">Past record · view only</span>' : '';
  const endTime = window.CostTrackLogic.reservationEndTime(item.time);
  const stayLimitReached = item.status === 'Seated' && window.CostTrackLogic.reservationStayLimitReached(item);
  const details = `<small><strong>${esc(item.time || 'Time not set')}${endTime ? `–${esc(endTime)}` : ''}</strong> · ${esc(reservationMealPeriod(item))}</small><span class="status ${reservationStatusClass(item.status)}">${esc(item.status)}</span><span class="tag">${item.type === 'Walk-in' ? 'Walk-in' : 'Reservation'}</span>${historyLabel}<b>${esc(reservationDisplayName(item))}</b><small>${guestCount} covers · ${esc(item.table || 'Unassigned')}</small>${item.seatedAt ? `<small>Seated ${new Date(item.seatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>` : ''}${stayLimitReached ? '<small class="reservation-stay-warning" role="status">Two-hour limit reached — notify the guest; keep the table occupied until they leave.</small>' : ''}${item.completedAt ? `<small>Completed ${new Date(item.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>` : ''}${canAccessRevenue() && item.status === 'Completed' && !hasRevenue ? '<small class="report-disclaimer">No revenue entry yet</small>' : ''}${showRevenue && canAccessRevenue() && rate ? `<em>${money(reservationRevenue(item, rate))} estimated buffet revenue</em>` : ''}`;
  const lifecycleActions = isPastReservation ? '' : item.status === 'Pending' ? `<button type="button" class="reservation-confirm-btn" data-action="reservation-transition" data-transition="Confirmed" data-id="${esc(item.id)}">Confirm</button><button type="button" class="reservation-confirm-btn" data-action="reservation-transition" data-transition="Cancelled" data-id="${esc(item.id)}">Cancel</button>` : item.status === 'Confirmed' ? `<button type="button" class="reservation-confirm-btn" data-action="reservation-transition" data-transition="Seated" data-id="${esc(item.id)}">Seat</button><button type="button" class="reservation-confirm-btn" data-action="reservation-transition" data-transition="No-show" data-id="${esc(item.id)}">No-show</button><button type="button" class="reservation-confirm-btn" data-action="reservation-transition" data-transition="Cancelled" data-id="${esc(item.id)}">Cancel</button>` : item.status === 'Seated' ? `<button type="button" class="reservation-confirm-btn" data-action="reservation-transition" data-transition="Completed" data-id="${esc(item.id)}">Complete</button>${canCreateDraft() ? `<button type="button" class="reservation-confirm-btn" data-action="create-revenue-draft" data-id="${esc(item.id)}">Create revenue draft</button>` : ''}` : '';
  const canDelete = !isPastReservation && ['Administrator', 'Manager'].includes(state.role);
  const actions = `${lifecycleActions}${canDelete ? `<button type="button" class="danger-btn compact-btn" data-action="delete-reservation" data-id="${esc(item.id)}">Delete</button>` : ''}`;
  const actionLabel = isPastReservation
    ? (['Administrator', 'Manager'].includes(state.role) ? 'Correct past reservation' : 'View past reservation')
    : 'View reservation';
  return `<article class="reservation-card${isPastReservation ? ' reservation-card--historical' : ''}"><button type="button" class="reservation-card-main" data-action="edit-reservation" data-id="${esc(item.id)}" aria-label="${actionLabel} for ${esc(item.name)}">${details}</button><div class="reservation-actions">${actions}</div></article>`;
}
function reservationTableOptions({ tableId = '', date = '', time = '', partySize = 0, reservationId = '' } = {}) {
  return all('restaurantTables').map(table => {
    const alreadyAssigned = table.id === tableId;
    const hasCapacity = Number(table.seats) >= Number(partySize || 0);
    const tableDetails = [
      table.tableType && table.tableType !== 'Unassigned' ? table.tableType : '',
      table.area && table.area !== 'Unassigned' ? table.area : ''
    ].filter(Boolean).join(' · ');
    const hasConflict = window.CostTrackLogic.tableHasReservationConflict(
      table.id, date, time, all('reservations'), reservationId, today()
    );
    const disabled = hasConflict || (!alreadyAssigned && !hasCapacity);
    const reason = hasConflict ? ' · overlaps another two-hour booking' : !hasCapacity ? ' · too small' : '';
    return `<option value="${esc(table.id)}" ${alreadyAssigned ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(table.id)} · ${Number(table.seats)} seats${tableDetails ? ` · ${esc(tableDetails)}` : ''}${reason}</option>`;
  }).join('');
}
function refreshReservationTables(form) {
  const select = form.elements.table;
  if (!select) return;
  const selectedTable = select.value;
  const partySize = Number(form.elements.adults.value || 0) + Number(form.elements.children.value || 0);
  select.innerHTML = `<option value="">Unassigned</option>${reservationTableOptions({
    tableId: selectedTable,
    date: form.elements.date.value,
    time: form.elements.time.value,
    partySize,
    reservationId: form.dataset.id
  })}`;
  if (selectedTable && [...select.options].some(option => option.value === selectedTable && !option.disabled)) {
    select.value = selectedTable;
  } else if (selectedTable) {
    toast('That table is not available for the selected date, time, or party size.', 'error');
  }
}
function reservationForm(item = {}, defaults = {}) {
  const isPastReservation = Boolean(item.id && item.date && item.date < today());
  const canCorrectPast = isPastReservation && ['Administrator', 'Manager'].includes(state.role);
  const isReadOnly = isPastReservation && !canCorrectPast;
  const lockHistoricalFields = isPastReservation ? 'disabled' : '';
  const lockReadOnlyFields = isReadOnly ? 'disabled' : '';
  const adults = Number(item.adults || item.guests || 2);
  const children = Number(item.children || 0);
  const tableOptions = reservationTableOptions({
    tableId: item.table,
    date: item.date || defaults.date || today(),
    time: item.time || defaults.time || '',
    partySize: adults + children,
    reservationId: item.id
  });
  const selectedTime = item.time || defaults.time || '';
  const reservationTimeSlots = window.CostTrackLogic.reservationTimeSlots();
  const timeOptions = `<option value="" disabled ${selectedTime ? '' : 'selected'}>Choose a time</option>${reservationTimeSlots.map(time => `<option value="${time}" ${selectedTime === time ? 'selected' : ''}>${time}</option>`).join('')}${selectedTime && !reservationTimeSlots.includes(selectedTime) ? `<option value="${esc(selectedTime)}" selected>${esc(selectedTime)} · existing</option>` : ''}`;
  const historyNotice = isPastReservation
    ? `<div class="reservation-history-notice"><strong>${canCorrectPast ? 'Historical correction' : 'Past reservation · view only'}</strong><span>${canCorrectPast ? 'Only the guest name, contact details, occasion, seating preference, and special-request notes can be corrected. Date, time, party size, table, and status are locked. Your reason is recorded in the audit log.' : 'Past bookings are kept for reference and cannot be changed from this account.'}</span></div>`
    : '';
  const correctionReason = canCorrectPast
    ? `<label>Correction reason<textarea name="correctionReason" minlength="10" maxlength="500" required placeholder="Explain why this historical detail needs correction"></textarea><small class="field-help">Required; enter at least 10 characters.</small></label>`
    : '';
  const formContent = `${historyNotice}<input type="hidden" name="id" value="${esc(item.id || '')}"><input type="hidden" name="status" value="${esc(item.status || 'Pending')}"><label>Guest name<input name="name" value="${esc(item.name || '')}" required autocomplete="name" ${lockReadOnlyFields}></label><div class="form-grid"><label>Email<input name="email" type="email" value="${esc(item.email || '')}" ${item.type === 'Walk-in' ? '' : 'required'} autocomplete="email" ${lockReadOnlyFields}></label><label>Phone<input name="phone" value="${esc(item.phone || '')}" autocomplete="tel" ${lockReadOnlyFields}></label></div><div class="form-grid"><label>Date<input name="date" type="date" min="${today()}" value="${esc(item.date || defaults.date || today())}" required ${lockHistoricalFields}></label><label>Time<select name="time" required ${lockHistoricalFields}>${timeOptions}</select><small class="field-help">Each booking has a two-hour window. Choose a start from 10:00 AM through 7:00 PM so it ends by closing at 9:00 PM.</small></label></div><div class="form-grid"><label>Adults<input name="adults" type="number" min="0" max="20" value="${adults}" required ${lockHistoricalFields || lockReadOnlyFields}></label><label>Children<input name="children" type="number" min="0" max="20" value="${children}" required ${lockHistoricalFields || lockReadOnlyFields}></label></div><div class="form-grid"><label>Table<select name="table" ${lockHistoricalFields || lockReadOnlyFields}><option value="">Unassigned</option>${tableOptions}</select><small class="field-help">Only tables with enough seats and no overlapping two-hour booking can be assigned.</small></label><label>Status<input value="${esc(item.status || 'Pending')}" readonly disabled></label></div><label>Occasion<input name="occasion" value="${esc(item.occasion || '')}" ${lockReadOnlyFields}></label><label>Seating preference<input name="preference" value="${esc(item.preference || 'Any available table')}" ${lockReadOnlyFields}></label><label>Special request<textarea name="request" ${lockReadOnlyFields}>${esc(item.request || '')}</textarea></label>${correctionReason}`;
  const title = isPastReservation ? canCorrectPast ? 'Correct past reservation' : 'Past reservation details' : item.id ? 'Update reservation' : 'New reservation';
  const submitLabel = isReadOnly ? '' : item.id ? canCorrectPast ? 'Save correction' : 'Save changes' : 'Create reservation';
  modal(title, formContent, submitLabel);
  document.querySelector('#modalForm').dataset.type = 'reservation';
  document.querySelector('#modalForm').dataset.id = item.id || '';
  if (isReadOnly) {
    const root = document.querySelector('#modalRoot');
    root.querySelector('[data-action="close-modal"]').textContent = 'Close';
    requestAnimationFrame(() => root.querySelector('.modal')?.focus());
  }
}
function walkInTableOptions(partySize = 0, date = today(), time = null) {
  const now = new Date();
  const walkInTime = time || window.CostTrackLogic.formatReservationTime(now.getHours() * 60 + now.getMinutes());
  const reservations = all('reservations');
  const tables = window.CostTrackLogic.isReservationTimeWithinOpenHours(walkInTime)
    ? all('restaurantTables').filter(table =>
      Number(table.seats) >= Number(partySize || 0)
      && !reservations.some(item => item.table === table.id && item.date <= date && item.status === 'Seated')
      && !window.CostTrackLogic.tableHasReservationConflict(table.id, date, walkInTime, reservations, '', today())
    )
    : [];
  return {
    tables,
    markup: tables.map(table => {
      const details = [table.tableType, table.area].filter(value => value && value !== 'Unassigned').join(' · ');
      return `<option value="${esc(table.id)}">${esc(table.id)} · ${table.seats} seats${details ? ` · ${esc(details)}` : ''}</option>`;
    }).join('')
  };
}
function walkInForm() {
  const now = new Date();
  const time = window.CostTrackLogic.formatReservationTime(now.getHours() * 60 + now.getMinutes());
  if (!window.CostTrackLogic.isReservationTimeWithinOpenHours(time)) {
    return toast('Walk-ins must start early enough to finish by closing. The latest seating time is 7:00 PM.', 'error');
  }
  const available = walkInTableOptions();
  const tableMessage = `<small class="field-help walk-in-table-message ${available.tables.length ? 'is-hidden' : ''}">No available tables are currently suitable for this party.</small>`;
  modal('Record walk-in', `<div class="form-grid"><label>Party size<input name="partySize" type="number" min="1" max="1000" required></label><label>Meal period<select name="mealPeriod"><option>All Day</option><option>Lunch</option><option>Dinner</option></select></label><label>Table<select name="table" required ${available.tables.length ? '' : 'disabled'}><option value="">Select table</option>${available.markup}</select>${tableMessage}</label><label>Contact phone<input name="phone" type="tel" required></label></div><label>Notes<textarea name="notes"></textarea><small class="field-help">Tables are listed only when no party is seated and no reservation overlaps the next two hours. Walk-ins are recorded as seated reservations. A phone number is required.</small></label>`, 'Record walk-in');
  document.querySelector('#modalForm').dataset.type = 'walk-in';
}
function refreshWalkInTables(form) {
  const select = form?.elements?.table;
  const partySize = Number(form?.elements?.partySize?.value || 0);
  if (!select) return;
  const available = walkInTableOptions(partySize);
  const selected = select.value;
  select.innerHTML = `<option value="">${available.tables.length ? 'Select table' : 'No available table'}</option>${available.markup}`;
  select.disabled = !available.tables.length;
  if (available.tables.some(table => table.id === selected)) select.value = selected;
  const message = select.parentElement.querySelector('.walk-in-table-message');
  if (message) {
    message.textContent = 'No available tables are currently suitable for this party and seating window.';
    message.classList.toggle('is-hidden', Boolean(available.tables.length));
  }
  const submit = form.querySelector('.modal-submit');
  if (submit) submit.disabled = !available.tables.length;
}
document.addEventListener('click', event => {
  const shortcut = event.target.closest('[data-waste-reason]');
  if (!shortcut) return;
  const form = shortcut.closest('#modalForm');
  if (!form) return;
  form.elements.reason.value = shortcut.dataset.wasteReason;
  form.querySelectorAll('[data-waste-reason]').forEach(button => button.classList.toggle('active', button === shortcut));
  state.modalDirty = true;
});
function rateForm(item = {}) {
  if (!canManageRates()) return toast('Only Administrator and Manager roles can manage buffet rates.', 'error');
  modal(item.id ? 'Edit buffet rate' : 'Add buffet rate', `<div class="form-grid"><label>Meal period<select name="mealPeriod"><option ${item.mealPeriod === 'All Day' ? 'selected' : ''}>All Day</option><option ${item.mealPeriod === 'Lunch' ? 'selected' : ''}>Lunch</option><option ${item.mealPeriod === 'Dinner' ? 'selected' : ''}>Dinner</option></select></label><label>Day type<select name="dayType"><option ${item.dayType === 'weekday' ? 'selected' : ''}>weekday</option><option ${item.dayType === 'weekend' ? 'selected' : ''}>weekend</option><option ${item.dayType === 'holiday' ? 'selected' : ''}>holiday</option></select></label><label>Adult rate<input name="adultRate" type="number" min="0" step=".01" value="${item.adultRate ?? ''}" required></label><label>Child rate<input name="childRate" type="number" min="0" step=".01" value="${item.childRate ?? ''}" required></label><label>Senior/PWD rate<input name="seniorPwdRate" type="number" min="0" step=".01" value="${item.seniorPwdRate ?? ''}" required></label><label>Effective from<input name="effectiveFrom" type="date" value="${item.effectiveFrom || today()}" required></label><label>Effective to<input name="effectiveTo" type="date" value="${item.effectiveTo || ''}"></label><label>Active<select name="isActive"><option value="true" ${item.isActive !== false ? 'selected' : ''}>Active</option><option value="false" ${item.isActive === false ? 'selected' : ''}>Inactive</option></select></label></div>`, item.id ? 'Save changes' : 'Add rate');
  document.querySelector('#modalForm').dataset.type = 'rate';
  document.querySelector('#modalForm').dataset.id = item.id || '';
}
function revenueAccessDenied() {
  return `${pageHeader('Restricted module', 'Access denied', 'Revenue and profitability data is limited to Administrator and Manager roles.', '')}<div class="panel empty-state"><span class="large-icon">!</span><h2>Revenue Tracking is restricted</h2><p>Your role does not have permission to view revenue, profit, or food cost information.</p></div>`;
}
function revenueForm(item = {}) {
  if (!canAccessRevenue()) return toast('Revenue Tracking is restricted to Administrator and Manager roles.', 'error');
  const rate = activeBuffetRate({ mealPeriod: item.meal_period || 'All Day' }, item.business_date || today());
  const defaults = { adult_customers: 0, adult_rate: rate?.adultRate || 0, child_customers: 0, child_rate: rate?.childRate || 0, senior_pwd_customers: 0, senior_pwd_rate: rate?.seniorPwdRate || 0 };
  const values = { ...defaults, ...item };
  const production = productionCost(values.business_date || today());
  const waste = wasteCost(values.business_date || today());
  modal(item.id ? 'Edit revenue record' : 'Record revenue', `<input type="hidden" name="id" value="${esc(item.id || '')}"><div class="form-grid"><label>Business date<input name="business_date" type="date" max="${today()}" value="${esc(values.business_date || today())}" required></label><label>Meal period<select name="meal_period"><option ${values.meal_period === 'Lunch' ? 'selected' : ''}>Lunch</option><option ${values.meal_period === 'Dinner' ? 'selected' : ''}>Dinner</option><option ${values.meal_period === 'All Day' || !values.meal_period ? 'selected' : ''}>All Day</option></select></label></div><div class="revenue-entry-grid"><label>Adult customers<input name="adult_customers" type="number" min="0" step="1" value="${values.adult_customers}" required></label><label>Adult rate<input name="adult_rate" type="number" min="0.01" step="0.01" value="${values.adult_rate}" required></label><label>Child customers<input name="child_customers" type="number" min="0" step="1" value="${values.child_customers}" required></label><label>Child rate<input name="child_rate" type="number" min="0.01" step="0.01" value="${values.child_rate}" required></label><label>Senior/PWD customers<input name="senior_pwd_customers" type="number" min="0" step="1" value="${values.senior_pwd_customers}" required></label><label>Senior/PWD rate<input name="senior_pwd_rate" type="number" min="0.01" step="0.01" value="${values.senior_pwd_rate}" required></label></div><label>Remarks<textarea name="remarks" rows="2">${esc(values.remarks || '')}</textarea></label>${item.id ? '<label>Edit reason<input name="edit_reason" required placeholder="Why is this record changing?"></label>' : ''}<div class="revenue-preview" data-revenue-preview data-production="${production}" data-waste="${waste}"><strong>Live calculation</strong><span>Adult revenue <b data-preview="adult">₱0.00</b></span><span>Child revenue <b data-preview="child">₱0.00</b></span><span>Senior/PWD revenue <b data-preview="senior">₱0.00</b></span><span>Total customers <b data-preview="customers">0</b></span><span>Total revenue <b data-preview="total">₱0.00</b></span><span>Estimated profit <b data-preview="profit">₱${(-production - waste).toFixed(2)}</b></span></div>`, item.id ? 'Save changes' : 'Save revenue');
  document.querySelector('#modalForm').dataset.type = 'revenue';
  document.querySelector('#modalForm').dataset.id = item.id || '';
  updateRevenuePreview(document.querySelector('#modalForm'));
}
function updateRevenuePreview(form) {
  const value = name => Number(form.elements[name]?.value || 0);
  const adult = value('adult_customers') * value('adult_rate');
  const child = value('child_customers') * value('child_rate');
  const senior = value('senior_pwd_customers') * value('senior_pwd_rate');
  const total = adult + child + senior;
  const customers = value('adult_customers') + value('child_customers') + value('senior_pwd_customers');
  const profit = total - Number(form.querySelector('[data-revenue-preview]')?.dataset.production || 0) - Number(form.querySelector('[data-revenue-preview]')?.dataset.waste || 0);
  const set = (key, text) => { const target = form.querySelector(`[data-preview="${key}"]`); if (target) target.textContent = text; };
  set('adult', money(adult)); set('child', money(child)); set('senior', money(senior)); set('customers', customers); set('total', money(total)); set('profit', money(profit));
}
function revenuePage() {
  if (!canAccessRevenue()) return revenueAccessDenied();
  const [rangeStart, rangeEnd] = dateRangeBounds();
  const records = rangeStart && rangeEnd ? revenueRecords().filter(item => item.business_date >= rangeStart && item.business_date <= rangeEnd) : [];
  const active = records.filter(item => item.status === 'Confirmed');
  const date = today();
  const todayRecords = active.filter(item => item.business_date === date);
  const todayTotals = todayRecords.reduce((sum, item) => sum + item.total_revenue, 0);
  const todayCustomers = todayRecords.reduce((sum, item) => sum + item.total_customers, 0);
  const todayProfit = profitability(date, { total_revenue: todayTotals }).profit;
  const rows = records.slice().sort((a, b) => String(b.business_date || '').localeCompare(String(a.business_date || ''))).slice(0, 30).map(item => {
    const result = profitability(item.business_date, item.status === 'Confirmed' ? item : null);
    return `<tr class="${item.status === 'Voided' ? 'is-voided' : ''}"><td><strong>${esc(item.business_date)}</strong></td><td>${esc(item.meal_period)}</td><td>${item.adult_customers}</td><td>${item.child_customers}</td><td>${item.senior_pwd_customers}</td><td>${item.total_customers}</td><td class="numeric">${item.status === 'Confirmed' ? money(item.total_revenue) : '—'}</td><td class="numeric">${money(result.production)}</td><td class="numeric">${money(result.waste)}</td><td class="numeric">${item.status === 'Confirmed' ? money(result.profit) : '—'}</td><td><span class="status ${item.status === 'Confirmed' ? 'status-good' : item.status === 'Draft' ? 'status-low' : 'status-out'}">${esc(item.status)}</span></td><td>${item.status === 'Draft' && canAccessRevenue() ? `<button class="ghost-btn compact-btn" data-action="confirm-revenue" data-id="${item.id}">Confirm</button>` : ''}${canVoidRevenue() && item.status !== 'Voided' ? `<button class="danger-btn compact-btn" data-action="void-revenue" data-id="${item.id}">Void</button>` : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="12" class="empty-table">No revenue records yet. Record the first day of buffet revenue.</td></tr>';
  const rateSummary = all('buffetRates').filter(item => item.isActive).slice(0, 3).map(item => `<div><span>${esc(item.mealPeriod)} / ${esc(item.dayType)}</span><strong>${money(item.adultRate)} adult</strong></div>`).join('') || '<small class="panel-subtitle">No active rates loaded.</small>';
  const drafts = records.filter(item => item.status === 'Draft');
  return `${pageHeader('Management insight', 'Revenue Tracking', 'Review drafted and confirmed buffet revenue. Revenue and cost figures are restricted to Administrator and Manager roles.', `<span class="nav-badge">${drafts.length} drafts to confirm</span>`)}<div class="metric-grid revenue-metrics">${metric("Today's Revenue", money(todayTotals), '₱', 'green-icon', `${todayRecords.length} confirmed entries`)}${metric('Drafts to confirm', drafts.length, '✎', 'orange-icon', 'Completed service awaiting review')}${metric('Total Customers', todayCustomers, '♙', 'purple-icon', 'Adults, children, and Senior/PWD')}${metric('Estimated Profit', money(todayProfit), '↗', 'green-icon', 'Revenue − production − waste')}${metric('Production Cost', money(productionCost(date)), '♨', 'orange-icon', 'Matched by business date')}${metric('Waste Cost', money(wasteCost(date)), '◌', 'red-icon', 'Matched by business date')}</div><div class="dashboard-grid"><div class="panel"><div class="panel-title">Profit breakdown</div><div class="panel-subtitle">${money(todayTotals)} Revenue − ${money(productionCost(date))} Production Cost − ${money(wasteCost(date))} Waste Cost = ${money(todayProfit)} Estimated Profit</div><div class="profit-breakdown"><i style="width:${todayTotals ? Math.max(4, todayTotals / Math.max(todayTotals, productionCost(date) + wasteCost(date) + 1) * 100) : 4}%"></i><i style="width:${todayTotals ? productionCost(date) / todayTotals * 100 : 0}%"></i><i style="width:${todayTotals ? wasteCost(date) / todayTotals * 100 : 0}%"></i></div><div class="legend"><span class="sales">Revenue</span><span class="cost">Production cost</span><span class="profit">Waste cost</span></div></div><div class="panel"><div class="panel-title">Active buffet rates</div><div class="analytics-stack">${rateSummary}</div><button class="ghost-btn compact-btn" data-view="rates">Manage rates</button></div></div><div class="panel revenue-records-panel"><div class="panel-header"><div><div class="panel-title">Revenue records</div><div class="panel-subtitle">Drafts require confirmation; voided records remain visible for audit history.</div></div><div class="toolbar-inline">${dateRangeControls()}</div></div><div class="table-scroll"><table><thead><tr><th>Date</th><th>Meal period</th><th>Adults</th><th>Children</th><th>Senior/PWD</th><th>Total customers</th><th>Revenue</th><th>Production cost</th><th>Waste cost</th><th>Estimated profit</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function reservationsPage() {
  const reservations = all('reservations');
  const selectedDate = state.calendarDate || today();
  const selected = new Date(`${selectedDate}T12:00:00`);
  const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const calendarStart = new Date(monthStart);
  calendarStart.setDate(1 - monthStart.getDay());
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    return date;
  });
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const reservationsForDate = date => reservations.filter(item => item.date === date);
  const dateMatches = item => state.reservationDateFilter === 'Today' ? item.date === today() : state.reservationDateFilter === 'Upcoming' ? item.date >= today() : item.date === selectedDate;
  const baseItems = reservations.filter(dateMatches).filter(item => (state.reservationTypeFilter === 'All' || (item.type || 'Reservation') === state.reservationTypeFilter) && (!state.query || `${item.name} ${item.email} ${item.phone}`.toLowerCase().includes(state.query.toLowerCase())));
  const items = baseItems.filter(item => (state.reservationFilter === 'All' || item.status === state.reservationFilter) && (state.reservationMealPeriodFilter === 'All' || reservationMealPeriod(item) === state.reservationMealPeriodFilter)).sort((a, b) => (parseTime12h(a.time) ?? Number.MAX_SAFE_INTEGER) - (parseTime12h(b.time) ?? Number.MAX_SAFE_INTEGER));
  const counts = status => status === 'All' ? baseItems.length : baseItems.filter(item => item.status === status).length;
  const filters = ['All', 'Confirmed', 'Pending', 'Seated', 'Completed', 'No-show', 'Cancelled'].map(status => `<button class="${state.reservationFilter === status ? 'active' : ''}" data-reservation-filter="${status}">${status} <b>${counts(status)}</b></button>`).join('') + ['All', 'Reservation', 'Walk-in'].map(type => `<button class="${state.reservationTypeFilter === type ? 'active' : ''}" data-reservation-type-filter="${type}">${type}</button>`).join('') + `<select data-reservation-meal><option value="All" ${state.reservationMealPeriodFilter === 'All' ? 'selected' : ''}>All meal periods</option><option value="Lunch" ${state.reservationMealPeriodFilter === 'Lunch' ? 'selected' : ''}>Lunch</option><option value="Dinner" ${state.reservationMealPeriodFilter === 'Dinner' ? 'selected' : ''}>Dinner</option><option value="Other" ${state.reservationMealPeriodFilter === 'Other' ? 'selected' : ''}>Other</option></select><button class="${state.reservationDateFilter === 'Today' ? 'active' : ''}" data-reservation-date-filter="Today">Today</button><button class="${state.reservationDateFilter === 'Upcoming' ? 'active' : ''}" data-reservation-date-filter="Upcoming">Upcoming</button>`;
  const timeline = items.map(item => reservationCard(item, true)).join('');
  const calendarCells = calendarDays.map(date => {
    const key = dateKey(date);
    const dayReservations = reservationsForDate(key).filter(item => (state.reservationTypeFilter === 'All' || (item.type || 'Reservation') === state.reservationTypeFilter));
    const isCurrentMonth = date.getMonth() === monthStart.getMonth();
    const isSelected = key === selectedDate;
    const isToday = key === today();
    const displayedDayReservations = isSelected ? items : dayReservations;
    const statusDots = [...new Set(displayedDayReservations.map(item => reservationStatusClass(item.status)))].map(status => `<i class="calendar-status-dot ${status}" aria-hidden="true"></i>`).join('');
    const badgeCount = isSelected ? items.length : dayReservations.length;
    return `<button type="button" class="calendar-day${isCurrentMonth ? '' : ' is-outside'}${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}" data-calendar-date="${key}" aria-label="${reservationDateLabel(key)}${badgeCount ? `, ${badgeCount} reservations` : ''}" aria-pressed="${isSelected}"><span>${date.getDate()}</span>${badgeCount ? `<div class="calendar-day-meta">${statusDots}<b>${badgeCount}</b></div>` : ''}</button>`;
  }).join('');
  const selectedCount = items.length;
  const tableCards = all('restaurantTables').map(table => {
    const availability = liveTableAvailability(table, today(), reservations);
    const booking = availability.primaryBooking;
    const statusClass = availability.status === 'Available' ? 'status-good' : availability.status === 'Reserved' ? 'status-low' : 'status-out';
    const detail = booking
      ? `${booking.name || (booking.type === 'Walk-in' ? 'Walk-in guest' : 'Guest')} · ${booking.date < today() ? `${reservationDateLabel(booking.date)} · ` : ''}${booking.time || 'Time not set'}`
      : `${Number(table.seats)} seats`;
    const warning = availability.stayLimitReached
      ? '<small class="reservation-stay-warning">Two-hour limit reached — notify guest; table remains occupied.</small>'
      : '';
    return `<div class="table-status-card"><strong>${esc(table.id)}</strong><span class="status ${statusClass}" data-table-availability="${availability.status}">${availability.status}</span><small>${esc(detail)}</small>${warning}</div>`;
  }).join('');
  const listLabel = state.reservationDateFilter === 'Upcoming' ? 'Upcoming reservations' : state.reservationDateFilter === 'Today' ? "Today's reservations" : reservationDateLabel(selectedDate);
  return `${pageHeader('Front of house', 'Reservations', 'Manage guest bookings, confirmations, arrivals, and table assignments.', '<span><button class="ghost-btn" data-action="open-walk-in">Record walk-in</button> <button class="primary-btn" data-action="open-reservation">+ New reservation</button></span>')}<div class="panel table-status-panel"><div class="panel-header"><div><div class="panel-title">Live table status</div><div class="panel-subtitle">Derived from today’s reservation and walk-in records; updates after changes and every minute.</div></div></div><div class="table-status-grid">${tableCards}</div></div><div class="reservation-workspace"><section class="panel reservation-calendar-panel"><div class="panel-header"><div><div class="panel-title">Reservation calendar</div><div class="panel-subtitle">Select a date to view its bookings</div></div><button class="text-btn" data-calendar-today>Today</button></div><div class="calendar-month-toolbar"><button type="button" class="calendar-nav" data-calendar-month="-1" aria-label="Previous month">‹</button><strong>${selected.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong><button type="button" class="calendar-nav" data-calendar-month="1" aria-label="Next month">›</button></div><div class="calendar-weekdays">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<span>${day}</span>`).join('')}</div><div class="monthly-calendar">${calendarCells}</div><div class="calendar-legend"><span><i class="calendar-status-dot status-good"></i> Confirmed / completed</span><span><i class="calendar-status-dot status-low"></i> Pending</span><span><i class="calendar-status-dot status-out"></i> Cancelled</span></div></section><section class="panel reservation-table-panel"><div class="reservation-table-heading"><div><div class="panel-title">${listLabel}</div><div class="panel-subtitle">${selectedCount} reservation${selectedCount === 1 ? '' : 's'} scheduled</div></div><span class="date-selection-badge">${selectedCount}</span></div><div class="reservation-toolbar"><div class="reservation-filters">${filters}</div><input id="tableSearch" type="search" value="${esc(state.query)}" placeholder="Search guests..." aria-label="Search guests"></div><div class="reservation-timeline">${selectedCount ? timeline : `<div class="empty-table"><strong>No reservations match these filters</strong><small>Choose another date or create a new reservation.</small></div>`}</div></section></div>`;
}
function tableManagementPage() {
  const date = state.tableManagementDate || today();
  const statusFilter = state.tableManagementStatus || 'All';
  const capacityFilter = state.tableManagementCapacity || 'All';
  const typeFilter = state.tableManagementType || 'All';
  const areaFilter = state.tableManagementArea || 'All';
  const query = String(state.tableManagementQuery || '').trim().toLowerCase();
  const reservations = all('reservations');
  const tables = all('restaurantTables').slice().sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: 'base' }));
  const layoutPlan = window.CostTrackLogic.planRestaurantTableLayout(tables, reservations, today());
  const getAvailability = table => liveTableAvailability(table, date, reservations);
  const availabilityByTable = new Map(tables.map(table => [table.id, getAvailability(table)]));
  const counts = tables.reduce((result, table) => {
    result[availabilityByTable.get(table.id).status] += 1;
    return result;
  }, { Available: 0, Reserved: 0, Occupied: 0 });
  const matchingTables = tables.filter(table => {
    const availability = availabilityByTable.get(table.id);
    const capacity = Number(table.seats);
    const tableType = table.tableType || 'Unassigned';
    const area = table.area || 'Unassigned';
    const capacityMatches = capacityFilter === 'All'
      || (capacityFilter === 'Small' && capacity <= 2)
      || (capacityFilter === 'Medium' && capacity >= 3 && capacity <= 4)
      || (capacityFilter === 'Large' && capacity >= 5);
    const bookingText = availability.bookings.map(item => `${item.name || ''} ${item.email || ''} ${item.phone || ''}`).join(' ');
    return (statusFilter === 'All' || availability.status === statusFilter)
      && capacityMatches
      && (typeFilter === 'All' || tableType === typeFilter)
      && (areaFilter === 'All' || area === areaFilter)
      && (!query || `${table.id} ${tableType} ${area} ${bookingText}`.toLowerCase().includes(query));
  });
  const canManage = ['Administrator', 'Manager'].includes(state.role);
  const capacityOptions = ['All', 'Small', 'Medium', 'Large']
    .map(value => `<option value="${value}" ${capacityFilter === value ? 'selected' : ''}>${value === 'All' ? 'All capacities' : value === 'Small' ? '1–2 seats' : value === 'Medium' ? '3–4 seats' : '5+ seats'}</option>`).join('');
  const statusOptions = ['All', 'Available', 'Reserved', 'Occupied']
    .map(value => `<option value="${value}" ${statusFilter === value ? 'selected' : ''}>${value === 'All' ? 'All statuses' : value}</option>`).join('');
  const typeOptions = ['All', 'Family', 'Casual', 'Unassigned']
    .map(value => `<option value="${value}" ${typeFilter === value ? 'selected' : ''}>${value === 'All' ? 'All table types' : value === 'Unassigned' ? 'Unclassified' : value}</option>`).join('');
  const areaOptions = ['All', 'Front', 'Back', 'Unassigned']
    .map(value => `<option value="${value}" ${areaFilter === value ? 'selected' : ''}>${value === 'All' ? 'All areas' : value === 'Unassigned' ? 'Area not set' : value}</option>`).join('');
  const renderCard = table => {
    const availability = availabilityByTable.get(table.id);
    const statusClass = availability.status === 'Available' ? 'status-good' : availability.status === 'Reserved' ? 'status-low' : 'status-out';
    const tableType = table.tableType || 'Unassigned';
    const area = table.area || 'Unassigned';
    const booking = availability.primaryBooking;
    const historyExists = reservations.some(item => item.table === table.id);
    const assignable = reservations.some(item =>
      item.date === date
      && !item.table
      && window.CostTrackLogic.isReservationTimeWithinOpenHours(item.time)
      && ['Pending', 'Confirmed'].includes(item.status)
      && Number(item.guests || 0) <= Number(table.seats)
      && !window.CostTrackLogic.tableHasReservationConflict(table.id, date, item.time, reservations, item.id, today())
    );
    const bookingEnd = booking ? window.CostTrackLogic.reservationEndTime(booking.time) : null;
    const bookingDate = booking?.date < date ? `${reservationDateLabel(booking.date)} · ` : '';
    const bookingDetails = booking
      ? `<div class="table-booking-details"><strong>${esc(booking.name || (booking.type === 'Walk-in' ? 'Walk-in guest' : 'Guest'))}</strong><span>${esc(bookingDate)}${esc(booking.time || 'Time not set')}${bookingEnd ? `–${esc(bookingEnd)}` : ''} · ${Number(booking.guests || 0)} guest${Number(booking.guests || 0) === 1 ? '' : 's'}</span><button type="button" class="text-btn" data-action="edit-reservation" data-id="${esc(booking.id)}">Open booking</button>${availability.stayLimitReached ? '<small class="reservation-stay-warning" role="status">Two-hour limit reached — notify the guest. Keep this table occupied until they leave.</small>' : ''}${availability.bookingWindowEnded ? '<small class="reservation-stay-warning" role="status">The two-hour window passed. Confirm whether the guest arrived, or update the booking status.</small>' : ''}</div>`
      : '<small class="table-empty-detail">No active booking assigned for this date</small>';
    const additionalBookings = availability.bookings.length > (booking ? 1 : 0)
      ? `<small class="table-additional-bookings">+${availability.bookings.length - (booking ? 1 : 0)} more booking${availability.bookings.length - (booking ? 1 : 0) === 1 ? '' : 's'} on this date</small>`
      : '';
    const areaBadge = area !== 'Unassigned' ? `<span class="table-area-badge">${esc(area)}</span>` : '';
    return `<article class="table-management-card"><div class="table-management-card-heading"><div><small>TABLE</small><h2>${esc(table.id)}</h2></div><span class="status ${statusClass}" data-table-availability="${availability.status}">${availability.status}</span></div><div class="table-card-tags"><span class="table-type-badge">${esc(tableType === 'Unassigned' ? 'Unclassified' : tableType)}</span>${areaBadge}</div><p class="table-capacity">${Number(table.seats)} seats</p>${bookingDetails}${additionalBookings}<div class="table-management-actions">${assignable ? `<button type="button" class="primary-btn compact-btn" data-action="assign-table" data-id="${esc(table.id)}">Assign booking</button>` : ''}${canManage ? `<button type="button" class="ghost-btn compact-btn" data-action="edit-table" data-id="${esc(table.id)}">Edit</button>${historyExists ? '<button type="button" class="ghost-btn compact-btn" disabled title="Tables linked to reservation history cannot be deleted">In use</button>' : `<button type="button" class="danger-btn compact-btn" data-action="delete-table" data-id="${esc(table.id)}">Delete</button>`}` : ''}</div></article>`;
  };
  const groups = [
    { type: 'Family', area: 'Unassigned', label: 'Family tables' },
    { type: 'Family', area: 'Front', label: 'Family tables · Front' },
    { type: 'Family', area: 'Back', label: 'Family tables · Back' },
    { type: 'Casual', area: 'Front', label: 'Casual tables · Front' },
    { type: 'Casual', area: 'Back', label: 'Casual tables · Back' },
    { type: 'Casual', area: 'Unassigned', label: 'Casual tables · Area not set' },
    { type: 'Unassigned', area: 'Front', label: 'Unclassified · Front' },
    { type: 'Unassigned', area: 'Back', label: 'Unclassified · Back' },
    { type: 'Unassigned', area: 'Unassigned', label: 'Unclassified tables' }
  ];
  const cards = groups.map(group => {
    const groupTables = matchingTables.filter(table =>
      (table.tableType || 'Unassigned') === group.type
      && (table.area || 'Unassigned') === group.area);
    if (!groupTables.length) return '';
    const groupSeats = groupTables.reduce((sum, table) => sum + Number(table.seats || 0), 0);
    return `<section class="table-layout-group"><div class="table-layout-group-heading"><h2>${group.label}</h2><span>${groupTables.length} table${groupTables.length === 1 ? '' : 's'} · ${groupSeats} seats</span></div><div class="table-management-grid">${groupTables.map(renderCard).join('')}</div></section>`;
  }).join('') || `<div class="empty-table"><strong>${tables.length ? 'No tables match these filters' : 'No tables have been added yet'}</strong><small>${tables.length ? 'Try another status, capacity, type, area, or search term.' : canManage ? 'Use “Set up restaurant layout” to create the requested 15 tables, or add tables individually.' : 'Ask a Manager or Administrator to add the restaurant tables.'}</small></div>`;
  const totalSeats = tables.reduce((sum, table) => sum + Number(table.seats || 0), 0);
  const layoutReady = layoutPlan.additions.length === 0 && layoutPlan.updates.length === 0 && layoutPlan.conflicts.length === 0;
  const headerActions = canManage
    ? `<span class="table-management-header-actions"><button type="button" class="ghost-btn" data-action="apply-table-layout" ${layoutReady ? 'disabled' : ''}>${layoutReady ? 'Layout configured' : 'Set up restaurant layout'}</button><button type="button" class="primary-btn" data-action="open-table-form">+ Add table</button></span>`
    : '';

  return `${pageHeader('Front of house', 'Table management', 'Manage the client’s seating layout and see availability derived from reservations and walk-ins.', headerActions)}<div class="table-management-summary"><div class="table-summary-card"><small>All tables</small><strong>${tables.length}</strong></div><div class="table-summary-card"><small>Total seats</small><strong>${totalSeats}</strong></div><div class="table-summary-card status-good"><small>Available</small><strong>${counts.Available}</strong></div><div class="table-summary-card status-low"><small>Reserved</small><strong>${counts.Reserved}</strong></div><div class="table-summary-card status-out"><small>Occupied</small><strong>${counts.Occupied}</strong></div></div><section class="panel table-management-panel"><div class="table-management-toolbar"><label>Date<input type="date" min="${today()}" value="${esc(date)}" data-table-date></label><label>Status<select data-table-status>${statusOptions}</select></label><label>Capacity<select data-table-capacity>${capacityOptions}</select></label><label>Table type<select data-table-type>${typeOptions}</select></label><label>Area<select data-table-area>${areaOptions}</select></label><label class="table-management-search">Search<input id="tableManagementSearch" type="search" value="${esc(state.tableManagementQuery)}" placeholder="Table or guest" aria-label="Search tables or guests"></label></div><p class="table-management-note">Availability is derived from active reservation and walk-in records, not the table’s cached status. Reservations occupy two-hour windows, with back-to-back bookings allowed; the latest start is 7:00 PM. A seated party remains Occupied after the two-hour limit until staff marks them Completed. The page refreshes status after live updates and every minute.</p>${cards}</section>`;
}
async function applyRestaurantTableLayout() {
  if (!['Administrator', 'Manager'].includes(state.role)) {
    return toast('Only Managers and Administrators can set up the restaurant layout.', 'error');
  }
  const tables = all('restaurantTables');
  const plan = window.CostTrackLogic.planRestaurantTableLayout(tables, all('reservations'), today());
  if (plan.conflicts.length) {
    const details = plan.conflicts.map(conflict =>
      `${conflict.tableId} → ${conflict.targetSeats} seats (reservation${conflict.reservationIds.length === 1 ? '' : 's'} ${conflict.reservationIds.join(', ')})`
    ).join('; ');
    return toast(`Layout not applied. Resolve these upcoming reservations first: ${details}.`, 'error');
  }
  if (!plan.additions.length && !plan.updates.length) {
    return toast('The requested 15-table layout is already configured.');
  }
  const existingById = new Map(tables.map(table => [String(table.id), table]));
  const capacityChanges = plan.updates.filter(table =>
    existingById.has(String(table.id))
    && Number(existingById.get(String(table.id)).seats) !== Number(table.seats)
  ).length;
  const extraCount = plan.unmatchedTables.length;
  if (!confirm(`Apply the requested 15-table layout? This will update ${plan.updates.length} existing table${plan.updates.length === 1 ? '' : 's'}, change ${capacityChanges} existing capacity value${capacityChanges === 1 ? '' : 's'}, and add ${plan.additions.length} table${plan.additions.length === 1 ? '' : 's'}. Existing table IDs and reservation history will be preserved.${extraCount ? ` ${extraCount} extra legacy table${extraCount === 1 ? ' will' : 's will'} remain Unclassified.` : ''}`)) return;
  const updates = new Map(plan.updates.map(table => [String(table.id), table]));
  const nextTables = [
    ...tables.map(table => updates.get(String(table.id)) || table),
    ...plan.additions
  ];
  try {
    await save('restaurantTables', nextTables);
  } catch (error) {
    console.error('Restaurant table layout setup failed.', error);
    toast(friendlyRpcError(error), 'error');
    return;
  }
  toast(`Layout ready: ${plan.updates.length} existing table${plan.updates.length === 1 ? '' : 's'} updated, ${capacityChanges} capacities changed, and ${plan.additions.length} added.${extraCount ? ` ${extraCount} extra table${extraCount === 1 ? ' remains' : 's remain'} Unclassified.` : ''}`, 'success');
}
function tableForm(item = {}) {
  if (!['Administrator', 'Manager'].includes(state.role)) return toast('Only Managers and Administrators can manage restaurant tables.', 'error');
  const title = item.id ? `Edit ${item.id}` : 'Add table';
  const tableType = item.tableType || 'Unassigned';
  const area = item.area || 'Unassigned';
  const contents = `<label>Table name or number<input name="tableId" value="${esc(item.id || '')}" maxlength="40" required ${item.id ? 'readonly' : ''} placeholder="For example, Table 1"></label><label>Seat capacity<input name="seats" type="number" min="1" max="1000" step="1" value="${esc(item.seats || '')}" required></label><label>Table type<select name="tableType"><option value="Family" ${tableType === 'Family' ? 'selected' : ''}>Family</option><option value="Casual" ${tableType === 'Casual' ? 'selected' : ''}>Casual</option><option value="Unassigned" ${tableType === 'Unassigned' ? 'selected' : ''}>Unclassified</option></select></label><label>Area<select name="area"><option value="Front" ${area === 'Front' ? 'selected' : ''}>Front</option><option value="Back" ${area === 'Back' ? 'selected' : ''}>Back</option><option value="Unassigned" ${area === 'Unassigned' ? 'selected' : ''}>Not set</option></select></label><small class="field-help">Table status is managed automatically from reservation actions. Existing table IDs cannot be changed because reservations may refer to them.</small>`;
  modal(title, contents, item.id ? 'Save table' : 'Add table');
  document.querySelector('#modalForm').dataset.type = 'restaurant-table';
  document.querySelector('#modalForm').dataset.id = item.id || '';
}
function tableAssignmentForm(table) {
  const date = state.tableManagementDate || today();
  const candidates = all('reservations').filter(item =>
    item.date === date
    && !item.table
    && window.CostTrackLogic.isReservationTimeWithinOpenHours(item.time)
    && ['Pending', 'Confirmed'].includes(item.status)
    && Number(item.guests || 0) <= Number(table.seats)
    && !window.CostTrackLogic.tableHasReservationConflict(table.id, date, item.time, all('reservations'), item.id, today())
  ).sort((left, right) => (parseTime12h(left.time) ?? Number.MAX_SAFE_INTEGER) - (parseTime12h(right.time) ?? Number.MAX_SAFE_INTEGER));
  if (!candidates.length) return toast('There are no unassigned bookings for this date that fit this table.', 'error');
  const options = candidates.map(item => `<option value="${esc(item.id)}">${esc(item.time)} · ${esc(item.name || 'Guest')} · ${Number(item.guests || 0)} guests</option>`).join('');
  modal(`Assign ${table.id}`, `<p class="panel-subtitle">Only unassigned bookings that fit this table and date are listed.</p><label>Reservation<select name="reservationId" required>${options}</select></label>`, 'Assign table');
  document.querySelector('#modalForm').dataset.type = 'assign-table';
  document.querySelector('#modalForm').dataset.id = table.id;
}
function reservationCalendarEvents() {
  const reservations = all('reservations').filter(item =>
    (state.reservationCalendarStatus === 'All' || item.status === state.reservationCalendarStatus)
    && (state.reservationCalendarType === 'All' || (item.type || 'Reservation') === state.reservationCalendarType)
    && (!state.reservationCalendarQuery || `${item.name || ''} ${item.email || ''} ${item.phone || ''} ${item.table || ''}`.toLowerCase().includes(state.reservationCalendarQuery.toLowerCase()))
  );
  const statusClass = {
    Pending: 'pending',
    Confirmed: 'confirmed',
    Seated: 'seated',
    'Checked-in': 'seated',
    Completed: 'completed',
    Cancelled: 'cancelled',
    'No-show': 'cancelled'
  };
  const statusColors = {
    pending: { backgroundColor: '#fff3df', borderColor: '#e8c98c', textColor: '#895a21' },
    confirmed: { backgroundColor: '#e3f4ef', borderColor: '#b8ded3', textColor: '#176d62' },
    seated: { backgroundColor: '#e7effb', borderColor: '#c4d2ec', textColor: '#385d95' },
    completed: { backgroundColor: '#e8f2e8', borderColor: '#c6ddc8', textColor: '#42734c' },
    cancelled: { backgroundColor: '#fae9e7', borderColor: '#e8c4c0', textColor: '#9a4843' }
  };
  return reservations.map(item => {
    const minutes = parseTime12h(item.time);
    const guests = Number(item.actualCovers || item.guests || Number(item.adults || 0) + Number(item.children || 0));
    const start = minutes === null
      ? item.date
      : `${item.date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
    const end = minutes === null || minutes + window.CostTrackLogic.MAX_TABLE_STAY_MINUTES >= 24 * 60
      ? undefined
      : `${item.date}T${String(Math.floor((minutes + window.CostTrackLogic.MAX_TABLE_STAY_MINUTES) / 60)).padStart(2, '0')}:${String((minutes + window.CostTrackLogic.MAX_TABLE_STAY_MINUTES) % 60).padStart(2, '0')}:00`;
    const color = statusColors[statusClass[item.status] || 'pending'];
    return {
      id: item.id,
      title: `${reservationDisplayName(item)} · ${guests} covers${item.table ? ` · ${item.table}` : ''}`,
      start,
      ...(end ? { end } : {}),
      allDay: minutes === null,
      classNames: [`reservation-event--${statusClass[item.status] || 'pending'}`],
      ...color,
      extendedProps: {
        reservationId: item.id,
        guestName: reservationDisplayName(item),
        coverCount: guests,
        table: item.table || ''
      }
    };
  }).filter(event => event.start);
}
function destroyReservationCalendar() {
  if (!reservationCalendar) return;
  reservationCalendar.destroy();
  reservationCalendar = null;
}
function initializeReservationCalendar() {
  const element = document.querySelector('#reservationFullCalendar');
  if (!element) return;
  if (!window.FullCalendar?.Calendar) {
    element.innerHTML = '<div class="panel error-state" role="alert">The calendar could not load. Check your internet connection and refresh the page, or use Reservations to view bookings.</div>';
    return;
  }
  reservationCalendar = new window.FullCalendar.Calendar(element, {
    themeSystem: 'classic',
    initialView: state.reservationCalendarView || 'dayGridMonth',
    initialDate: state.reservationCalendarDate || state.calendarDate || today(),
    timeZone: 'local',
    slotMinTime: '10:00:00',
    slotMaxTime: '21:00:00',
    slotDuration: '00:30:00',
    scrollTime: '10:00:00',
    defaultTimedEventDuration: '02:00',
    forceEventDuration: true,
    height: 'auto',
    eventDisplay: 'block',
    dayMaxEvents: true,
    nowIndicator: true,
    editable: false,
    selectable: false,
    eventTimeFormat: { hour: 'numeric', minute: '2-digit' },
    headerToolbar: {
      start: 'prev,next today',
      center: 'title',
      end: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
    },
    buttonText: { today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'Agenda' },
    noEventsContent: 'No reservations match these filters.',
    eventContent(info) {
      const content = document.createElement('span');
      content.className = 'reservation-event-content';
      if (!info.view.type.startsWith('list') && info.timeText) {
        const time = document.createElement('span');
        time.className = 'reservation-event-time';
        time.textContent = info.timeText;
        content.appendChild(time);
      }
      const name = document.createElement('span');
      name.className = 'reservation-event-name';
      name.textContent = info.event.extendedProps.guestName || 'Guest';
      content.appendChild(name);
      const details = [info.event.extendedProps.coverCount ? `${info.event.extendedProps.coverCount} covers` : '', info.event.extendedProps.table]
        .filter(Boolean)
        .join(' · ');
      if (details) {
        const meta = document.createElement('span');
        meta.className = 'reservation-event-meta';
        meta.textContent = details;
        content.appendChild(meta);
      }
      return { domNodes: [content] };
    },
    events(fetchInfo, successCallback) {
      successCallback(reservationCalendarEvents());
    },
    datesSet(info) {
      state.reservationCalendarDate = localDateStr(reservationCalendar.getDate());
      state.reservationCalendarView = info.view.type;
    },
    dateClick(info) {
      const selectedDate = info.dateStr.slice(0, 10);
      if (selectedDate < today()) return toast('New reservations cannot be created for a past date.', 'error');
      state.reservationCalendarDate = selectedDate;
      const selectedTime = info.allDay
        ? ''
        : window.CostTrackLogic.formatReservationTime(info.date.getHours() * 60 + info.date.getMinutes());
      if (selectedTime && !window.CostTrackLogic.isReservationTimeWithinOpenHours(selectedTime)) {
        return toast('Bookings need a two-hour window before closing. The latest start time is 7:00 PM.', 'error');
      }
      reservationForm({}, { date: selectedDate, time: selectedTime });
    },
    eventClick(info) {
      const reservation = all('reservations').find(item => item.id === info.event.extendedProps.reservationId);
      if (reservation) reservationForm(reservation);
    }
  });
  reservationCalendar.render();
}
function calendarPage() {
  const statusOptions = ['All', 'Pending', 'Confirmed', 'Checked-in', 'Seated', 'Completed', 'Cancelled', 'No-show']
    .map(status => `<option value="${status}" ${state.reservationCalendarStatus === status ? 'selected' : ''}>${status === 'All' ? 'All statuses' : status}</option>`).join('');
  const typeOptions = ['All', 'Reservation', 'Walk-in']
    .map(type => `<option value="${type}" ${state.reservationCalendarType === type ? 'selected' : ''}>${type === 'All' ? 'All booking types' : type}</option>`).join('');
  return `${pageHeader('Front of house', 'Reservation calendar', 'Browse bookings by month, week, day, or agenda. Select a date to start a reservation, or select a booking to edit it.', '<span><button class="ghost-btn" data-action="open-walk-in">Record walk-in</button> <button class="primary-btn" data-action="open-reservation">+ New reservation</button></span>')}<div class="panel full-calendar-panel"><div class="full-calendar-filters"><label>Status<select data-reservation-calendar-filter="status">${statusOptions}</select></label><label>Type<select data-reservation-calendar-filter="type">${typeOptions}</select></label><label class="full-calendar-search">Search<input id="reservationCalendarSearch" type="search" value="${esc(state.reservationCalendarQuery)}" placeholder="Guest, email, phone, or table" aria-label="Search reservations"></label><div class="calendar-status-legend" aria-label="Reservation status colors"><span><i class="calendar-status-dot status-low"></i> Pending</span><span><i class="calendar-status-dot status-good"></i> Confirmed / seated / completed</span><span><i class="calendar-status-dot status-out"></i> Cancelled / no-show</span></div></div><small class="full-calendar-note">Reservations have a two-hour window; the latest start is 7:00 PM so the stay ends by closing at 9:00 PM. Calendar events show the two-hour window, and timed views display 10:00 AM–9:00 PM.</small><div id="reservationFullCalendar" aria-label="Reservations calendar"></div></div>`;
}
async function handleSubmit(form) {
  const data = Object.fromEntries(new FormData(form));
  const type = form.dataset.type;
  const editId = form.dataset.id;
  let successMessage = 'Saved to cloud.';
  const requiredAction = {
    ingredient: 'product.manage',
    receiving: 'inventory.receive',
    recipe: 'recipe.manage',
    production: 'production.log',
    waste: 'waste.log',
    count: 'count.submit',
    rate: 'rates.manage',
    user: 'user.manage'
  }[type];
  if (requiredAction && !window.CostTrackLogic.canPerformInventoryAction(state.role, requiredAction)) {
    return toast('You do not have permission to perform this action.', 'error');
  }
  if (type === 'bill') {
    const extraLines = [...form.querySelectorAll('[data-extra-line]')].flatMap(line => {
      const chargeItemId = line.querySelector('[name="extraChargeItemId"]').value;
      if (!chargeItemId) return [];
      return [{
        line_id: line.querySelector('[name="extraLineId"]').value || null,
        charge_item_id: chargeItemId,
        quantity: Number(line.querySelector('[name="extraQuantity"]').value)
      }];
    });
    const discountId = form.elements.discountId.value || null;
    const discountReason = form.elements.discountReason.value.trim();
    if (discountId && !discountReason) return toast('Enter a reason for the discount.', 'error');
    const adultCount = Number(form.elements.adultCount.value || 0);
    const seniorCount = Number(form.elements.seniorCount.value || 0);
    const kidsCount = Number(form.elements.kidsCount.value || 0);
    const compedCount = Number(form.elements.compedCount.value || 0);
    if (![adultCount, seniorCount, kidsCount, compedCount].every(Number.isInteger)
      || adultCount + seniorCount + kidsCount + compedCount > 1000) {
      return toast('Enter whole-number head counts totaling no more than 1,000.', 'error');
    }
    if (adultCount + seniorCount + kidsCount + compedCount === 0 && !extraLines.length) {
      return toast('Enter at least one guest or extra charge.', 'error');
    }
    if (extraLines.some(line => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      return toast('Each selected extra needs a quantity greater than zero.', 'error');
    }
    try {
      const result = await window.supabaseRecord.posSaveBill({
        billId: editId || null,
        customerName: String(data.customerName || '').trim() || 'Walk-in',
        notes: String(data.notes || '').trim(),
        reservationId: data.reservationId || null,
        adultCount,
        seniorCount,
        kidsCount,
        compedCount,
        discountId,
        discountReason,
        extraLines,
        initialDeposit: editId ? 0 : Number(data.initialDeposit || 0),
        idempotencyKey: editId ? null : form.dataset.createKey
      });
      await refreshPosCollections();
      state.modalDirty = false;
      closeModal();
      const savedBill = result?.bill || {};
      toast(`${savedBill.bill_number || 'Bill'} saved. Subtotal ${money(savedBill.subtotal)} · Balance ${money(savedBill.balance_due)}.`);
      render();
    } catch (error) {
      console.error('POS bill save failed.', error);
      const submit = form.querySelector('.modal-submit');
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        submit.removeAttribute('aria-busy');
        submit.textContent = editId ? 'Save bill' : 'Create bill';
      }
      toast(friendlyRpcError(error), 'error');
    }
    return;
  }
  if (type === 'bill-close') {
    try {
      const result = await window.supabaseRecord.posCloseBill(
        editId,
        Number(data.tenderedAmount),
        form.dataset.paymentKey
      );
      await refreshPosCollections();
      state.modalDirty = false;
      closeModal();
      const changeAmount = Number(result?.payment?.change_amount || 0);
      toast(`Bill closed. Change due: ${money(changeAmount)}.`);
      render();
    } catch (error) {
      console.error('POS bill close failed.', error);
      const submit = form.querySelector('.modal-submit');
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        submit.removeAttribute('aria-busy');
        submit.textContent = 'Confirm cash and close';
      }
      toast(friendlyRpcError(error), 'error');
    }
    return;
  }
  if (type === 'bill-void-request') {
    try {
      await window.supabaseRecord.posRequestBillVoid(editId, data.voidReason.trim());
      await refreshPosCollections();
      state.modalDirty = false;
      closeModal();
      toast('Void request sent to a Manager or Administrator.');
      render();
    } catch (error) {
      console.error('POS bill void request failed.', error);
      const submit = form.querySelector('.modal-submit');
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        submit.removeAttribute('aria-busy');
        submit.textContent = 'Request void';
      }
      toast(friendlyRpcError(error), 'error');
    }
    return;
  }
  if (type === 'bill-approval-decision') {
    try {
      await window.supabaseRecord.posDecideBillApproval(editId, form.dataset.decision, data.decisionReason.trim());
      await refreshPosCollections();
      state.modalDirty = false;
      closeModal();
      toast(form.dataset.decision === 'approve' ? 'Approval recorded.' : 'Request rejected.');
      render();
    } catch (error) {
      console.error('POS approval decision failed.', error);
      const submit = form.querySelector('.modal-submit');
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        submit.removeAttribute('aria-busy');
        submit.textContent = form.dataset.decision === 'approve' ? 'Approve request' : 'Reject request';
      }
      toast(friendlyRpcError(error), 'error');
    }
    return;
  }
  if (type === 'receiving') {
    readReceivingDraft(form);
    const lines = state.receivingDraft;
    if (!lines.length) return toast('Add at least one product to this delivery.', 'error');
    const payload = {
      supplierName: state.receivingForm.supplierName.trim(),
      invoiceNumber: state.receivingForm.invoiceNumber.trim(),
      invoiceDate: state.receivingForm.invoiceDate,
      receivedDate: state.receivingForm.receivedDate,
      note: state.receivingForm.note.trim(),
      lines: lines.map(line => ({
        id: line.id,
        ingredientId: line.ingredientId,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
        batchCode: line.batchCode.trim(),
        expirationDate: line.expirationDate || null
      }))
    };
    try {
      await saveDelivery(payload);
    } catch (error) {
      const submit = form.querySelector('.modal-submit');
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        submit.removeAttribute('aria-busy');
        submit.textContent = 'Record delivery';
      }
      return;
    }
    state.modalDirty = false;
    document.querySelector('#modalRoot').innerHTML = '';
    toast(`Invoice ${payload.invoiceNumber} recorded. Stock and lot details were updated.`);
    render();
    return;
  }
  if (type === 'waste') {
    const recordedAt = new Date(`${data.date}T${data.time}:00`);
    if (Number.isNaN(recordedAt.getTime())) {
      toast('Enter a valid waste date and time.', 'error');
      return;
    }
    const record = {
      id: form.dataset.wasteId || (form.dataset.wasteId = id('WASTE')),
      ingredientId: data.ingredientId,
      quantity: Number(data.quantity),
      reason: data.reason,
      date: data.date,
      recordedAt: recordedAt.toISOString(),
      notes: data.notes.trim(),
      productionLogId: data.productionLogId || null
    };
    try {
      await save('wasteLogs', [...all('wasteLogs'), record]);
      delete form.dataset.wasteId;
      state.modalDirty = false;
      document.querySelector('#modalRoot').innerHTML = '';
      toast('Waste recorded and stock updated.');
      render();
    } catch (error) {
      console.error('Waste entry could not be saved.', error);
      const submit = document.querySelector('#modalForm .modal-submit');
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        submit.removeAttribute('aria-busy');
        submit.textContent = 'Record waste';
      }
    }
    return;
  }
  const collections = {
    ingredient: 'ingredients', receiving: 'inventoryTransactions',
    production: 'productionLogs', count: 'physicalCounts'
  };
  if (type === 'charge-item') {
    const record = {
      id: editId || id('POSC'),
      code: String(data.code || '').trim(),
      name: String(data.name || '').trim(),
      type: data.type || 'other',
      category: String(data.category || '').trim() || 'General',
      unitPrice: Number(data.unitPrice || 0),
      defaultQuantity: Number(data.defaultQuantity || 1),
      isActive: data.isActive === 'true' || data.isActive === 'on',
      isFoodRevenue: data.isFoodRevenue !== 'false' && data.isFoodRevenue !== '0',
      isPackage: data.isPackage === 'true' || data.isPackage === 'on',
      requiresApproval: data.requiresApproval === 'true' || data.requiresApproval === 'on',
      notes: String(data.notes || '').trim()
    };
    if (!record.code || !record.name) return toast('Charge code and name are required.', 'error');
    await save('chargeItems', editId ? all('chargeItems').map(item => item.id === editId ? { ...item, ...record } : item) : [record, ...all('chargeItems')]);
    successMessage = editId ? 'Charge item updated.' : 'Charge item created.';
  } else if (type === 'shift') {
    const record = {
      id: editId || id('POSS'),
      code: String(data.shiftCode || '').trim() || `SHIFT-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`,
      openedBy: state.user?.id || null,
      openedAt: data.openedAt || new Date().toISOString(),
      closedAt: data.closedAt || null,
      status: data.status || 'Open',
      openingFloat: Number(data.openingFloat || 0),
      cashSales: Number(data.cashSales || 0),
      cardSales: Number(data.cardSales || 0),
      declaredCash: Number(data.declaredCash || 0),
      notes: String(data.notes || '').trim()
    };
    await save('shifts', editId ? all('shifts').map(item => item.id === editId ? { ...item, ...record } : item) : [record, ...all('shifts')]);
    successMessage = editId ? 'Shift updated.' : 'Shift opened.';
  } else if (type === 'rate') {
    const record = { id: editId || id('RATE'), mealPeriod: data.mealPeriod, dayType: data.dayType, adultRate: Number(data.adultRate), childRate: Number(data.childRate), seniorPwdRate: Number(data.seniorPwdRate), effectiveFrom: data.effectiveFrom, effectiveTo: data.effectiveTo || null, isActive: data.isActive === 'true' };
    await save('buffetRates', editId ? all('buffetRates').map(item => item.id === editId ? { ...item, ...record } : item) : [record, ...all('buffetRates')]);
  } else if (type === 'walk-in') {
    const partySize = Number(data.partySize);
    const now = new Date();
    const date = today();
    const time = window.CostTrackLogic.formatReservationTime(now.getHours() * 60 + now.getMinutes());
    const selectedTable = all('restaurantTables').find(table => table.id === data.table);
    if (!window.CostTrackLogic.isReservationTimeWithinOpenHours(time)) {
      return toast('Walk-ins must start early enough to finish by closing. The latest seating time is 7:00 PM.', 'error');
    }
    if (!selectedTable || Number(selectedTable.seats) < partySize) return toast('Choose an available table with enough seats for this party.', 'error');
    const reservations = all('reservations');
    const hasUnresolvedSeating = reservations.some(item =>
      item.table === selectedTable.id && item.date <= date && item.status === 'Seated'
    );
    if (hasUnresolvedSeating
      || window.CostTrackLogic.tableHasReservationConflict(selectedTable.id, date, time, reservations, '', today())) {
      return toast('That table is no longer available for a two-hour walk-in. Choose another table.', 'error');
    }
    const record = { id: id('RS'), name: 'Walk-in guest', email: '', phone: data.phone, date, time, guests: partySize, adults: partySize, children: 0, type: 'Walk-in', mealPeriod: data.mealPeriod, status: 'Seated', seatedAt: now.toISOString(), actualCovers: partySize, table: data.table, request: data.notes || '', preference: '' };
    try {
      await saveRecord('reservations', record);
      await refetchCollection('restaurantTables');
    } catch (error) {
      toast(friendlyRpcError(error), 'error');
      return;
    }
  } else if (type === 'revenue') {
    if (!canAccessRevenue()) return toast('Revenue Tracking is restricted.', 'error');
    const duplicate = all('revenueRecords').find(item => item.id !== editId && item.status === 'Confirmed' && item.business_date === data.business_date && item.meal_period === data.meal_period);
    if (duplicate) return toast(`An active ${data.meal_period} record already exists for ${data.business_date}.`, 'error');
    const existing = all('revenueRecords').find(item => item.id === editId);
    const record = createRevenueRecord({
      ...data,
      id: editId || id('REV'),
      recorded_by: existing?.recorded_by || state.role,
      recorded_at: existing?.recorded_at || new Date().toISOString(),
      last_edited_by: editId ? state.role : '',
      last_edited_at: editId ? new Date().toISOString() : null,
      edit_reason: editId ? data.edit_reason : ''
    });
    await save('revenueRecords', editId ? all('revenueRecords').map(item => item.id === editId ? record : item) : [record, ...all('revenueRecords')]);
  } else if (type === 'reservation') {
    const existing = editId ? all('reservations').find(item => item.id === editId) : null;
    if (editId && !existing) return toast('This reservation is no longer available. Reload the page and try again.', 'error');
    const isPastReservation = Boolean(existing?.date && existing.date < today());
    let record;
    if (isPastReservation) {
      if (!['Administrator', 'Manager'].includes(state.role)) return toast('Past reservations are view-only for your role.', 'error');
      const correctionReason = String(data.correctionReason || '').trim();
      if (correctionReason.length < 10 || correctionReason.length > 500) {
        return toast('Enter a correction reason between 10 and 500 characters.', 'error');
      }
      const correctedFields = {
        name: String(data.name || '').trim(),
        email: String(data.email || '').trim(),
        phone: String(data.phone || '').trim(),
        occasion: String(data.occasion || '').trim(),
        preference: String(data.preference || '').trim(),
        request: String(data.request || '').trim()
      };
      if (!Object.entries(correctedFields).some(([key, value]) => value !== String(existing[key] || '').trim())) {
        return toast('Change at least one guest detail or note before saving a correction.', 'error');
      }
      record = {
        ...existing,
        ...correctedFields,
        correctionReason
      };
      successMessage = 'Historical correction saved and recorded in the audit log.';
    } else {
      const dateOrTimeChanged = !existing || data.date !== existing.date || data.time !== existing.time;
      if (dateOrTimeChanged && !window.CostTrackLogic.isReservationTimeWithinOpenHours(data.time)) {
        return toast('Choose a start time from 10:00 AM through 7:00 PM so the two-hour stay ends by closing at 9:00 PM.', 'error');
      }
      const adults = data.adults === undefined ? Number(data.guests || 0) : Number(data.adults);
      const children = Number(data.children || 0);
      if (data.table) {
        const selectedTable = all('restaurantTables').find(table => table.id === data.table);
        if (!selectedTable) return toast('The selected table is no longer available. Reload and try again.', 'error');
        if (Number(selectedTable.seats) < adults + children) return toast('Choose a table with enough seats for this party.', 'error');
        if (window.CostTrackLogic.tableHasReservationConflict(data.table, data.date, data.time, all('reservations'), editId, today())) {
          return toast('That table already has an overlapping two-hour booking.', 'error');
        }
      }
      record = {
        ...window.CostTrackLogic.buildReservationRecord(
          existing,
          data,
          editId || form.dataset.reservationId || (form.dataset.reservationId = id('RS'))
        ),
        adults,
        children,
        guests: adults + children,
        table: data.table || '',
        correctionReason: existing?.correctionReason || ''
      };
    }
    try {
      await saveRecord('reservations', record);
    } catch (error) {
      console.error('Reservation save failed.', error);
      const submit = form.querySelector('.modal-submit');
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        submit.removeAttribute('aria-busy');
        submit.textContent = isPastReservation ? 'Save correction' : editId ? 'Save changes' : 'Create reservation';
      }
      toast(friendlyRpcError(error), 'error');
      return;
    }
    state.modalDirty = false;
  } else if (type === 'restaurant-table') {
    if (!['Administrator', 'Manager'].includes(state.role)) return toast('Only Managers and Administrators can manage restaurant tables.', 'error');
    const tableId = String(data.tableId || '').trim();
    const seats = Number(data.seats);
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/.test(tableId)) return toast('Enter a table name or number using letters, numbers, spaces, hyphens, or underscores.', 'error');
    if (!Number.isInteger(seats) || seats < 1 || seats > 1000) return toast('Table capacity must be a whole number between 1 and 1,000.', 'error');
    if (!['Family', 'Casual', 'Unassigned'].includes(data.tableType)) return toast('Choose a valid table type.', 'error');
    if (!['Front', 'Back', 'Unassigned'].includes(data.area)) return toast('Choose a valid table area.', 'error');
    const existing = editId ? all('restaurantTables').find(table => table.id === editId) : null;
    if (editId && !existing) return toast('This table is no longer available. Reload and try again.', 'error');
    if (editId && tableId !== editId) return toast('Table names cannot be changed after creation.', 'error');
    if (!editId && all('restaurantTables').some(table => table.id.toLowerCase() === tableId.toLowerCase())) {
      return toast('A table with that name or number already exists.', 'error');
    }
    const largestActiveParty = editId
      ? all('reservations')
        .filter(item => item.table === editId && item.date >= today() && ['Pending', 'Confirmed', 'Seated'].includes(item.status))
        .reduce((largest, item) => Math.max(largest, Number(item.actualCovers || item.guests || 0)), 0)
      : 0;
    if (seats < largestActiveParty) return toast(`Capacity cannot be reduced below the ${largestActiveParty}-guest party already assigned to this table.`, 'error');
    const record = existing
      ? { ...existing, seats, tableType: data.tableType, area: data.area }
      : { id: tableId, seats, tableType: data.tableType, area: data.area, status: 'Available', x: 0, y: 0, guest: '' };
    try {
      await save('restaurantTables', editId
        ? all('restaurantTables').map(table => table.id === editId ? record : table)
        : [record, ...all('restaurantTables')]);
    } catch (error) {
      console.error('Table save failed.', error);
      toast(friendlyRpcError(error), 'error');
      return;
    }
    successMessage = editId ? 'Table capacity updated.' : 'Table added.';
  } else if (type === 'assign-table') {
    const table = all('restaurantTables').find(item => item.id === editId);
    const reservation = all('reservations').find(item => item.id === data.reservationId);
    if (!table || !reservation) return toast('The table or reservation is no longer available. Reload and try again.', 'error');
    if (reservation.date < today() || !['Pending', 'Confirmed'].includes(reservation.status) || reservation.table) {
      return toast('Only unassigned upcoming reservations can be assigned from this page.', 'error');
    }
    if (Number(reservation.guests || 0) > Number(table.seats)) return toast('This table does not have enough seats for the reservation.', 'error');
    if (!window.CostTrackLogic.isReservationTimeWithinOpenHours(reservation.time)) {
      return toast('This booking cannot be assigned because its two-hour window would run past closing.', 'error');
    }
    if (window.CostTrackLogic.tableHasReservationConflict(table.id, reservation.date, reservation.time, all('reservations'), reservation.id, today())) {
      return toast('This table already has an overlapping two-hour booking.', 'error');
    }
    try {
      await saveRecord('reservations', { ...reservation, table: table.id });
    } catch (error) {
      console.error('Table assignment failed.', error);
      toast(friendlyRpcError(error), 'error');
      return;
    }
    successMessage = `${table.id} assigned to ${reservation.name || 'the reservation'}.`;
  } else if (type === 'recipe') {
    const ingredients = state.recipeDraft.map(item => ({ ingredientId: item.ingredientId, quantity: Number(item.quantity) })).filter(item => item.ingredientId && item.quantity > 0);
    if (!ingredients.length) return toast('Add at least one inventory ingredient.', 'error');
    const record = {
      id: editId || id('rec'), name: data.name, category: data.category,
      price: Number(data.price), wastage: Number(data.wastage),
      batchYield: Number(data.batchYield), prepTarget: Number(data.prepTarget),
      prepNotes: data.prepNotes.trim(), ingredients
    };
    await save('recipes', editId ? all('recipes').map(item => item.id === editId ? record : item) : [...all('recipes'), record]);
    state.recipeDraft = [];
    state.recipeForm = {};
  } else if (type === 'ingredient') {
    const record = {
      id: editId || id('ING'),
      name: data.name.trim(),
      category: data.category,
      unit: data.unit,
      minimum: Number(data.minimum),
      preferredSupplier: data.preferredSupplier.trim(),
      trackExpiry: form.elements.trackExpiry.checked,
      notes: data.notes.trim()
    };
    await save('ingredients', editId
      ? all('ingredients').map(item => item.id === editId ? { ...item, ...record } : item)
      : [...all('ingredients'), record]);
  } else {
    const collection = collections[type];
    if (!collection) return toast('This record type cannot be saved from the browser.', 'error');
    const numeric = ['quantity', 'coversProduced', 'cost', 'stock', 'minimum', 'expected', 'actual'].reduce((result, key) => data[key] !== undefined && data[key] !== '' ? { ...result, [key]: Number(data[key]) } : result, {});
    const record = { id: editId || id(type.slice(0, 4)), ...data, ...numeric };
    const updatedCollection = editId ? all(collection).map(item => item.id === editId ? { ...item, ...record } : item) : [...all(collection), record];
    if (type === 'receiving') {
      await save(collection, updatedCollection);
      toast('Receipt recorded; inventory cost is maintained by the database.');
    } else {
      await save(collection, updatedCollection);
    }
  }
  document.querySelector('#modalRoot').innerHTML = '';
  toast(successMessage);
  render();
}
async function transitionReservation(itemId, nextStatus) {
  const reservation = all('reservations').find(item => item.id === itemId);
  if (!reservation) return toast('Reservation not found.', 'error');
  if (reservation.date < today()) return toast('Past reservations are kept for history and cannot change status.', 'error');
  const valid = { Pending: ['Confirmed', 'Cancelled'], Confirmed: ['Seated', 'No-show', 'Cancelled'], Seated: ['Completed'] };
  if (!valid[reservation.status]?.includes(nextStatus)) return toast('That reservation status transition is not valid.', 'error');
  if (nextStatus === 'No-show' && !confirm(`Mark ${reservation.name} as a no-show?`)) return;
  let actualCovers = reservation.actualCovers;
  if (nextStatus === 'Seated') {
    const entered = prompt('How many actual covers were seated?', String(reservation.guests || 1));
    if (entered === null) return;
    actualCovers = Number(entered);
    if (!Number.isInteger(actualCovers) || actualCovers < 1) return toast('Actual covers must be a positive whole number.', 'error');
  }
  const updated = { ...reservation, status: nextStatus, actualCovers, seatedAt: nextStatus === 'Seated' ? new Date().toISOString() : reservation.seatedAt, completedAt: nextStatus === 'Completed' ? new Date().toISOString() : reservation.completedAt };
  try {
    await saveRecord('reservations', updated);
    if (reservation.table) await refetchCollection('restaurantTables');
    toast(`Reservation marked ${nextStatus}.`);
    if (nextStatus === 'Completed' && canCreateDraft() && confirm('Create revenue draft?')) {
      await createRevenueDraft(itemId);
    }
    render();
  } catch (error) {
    toast(friendlyRpcError(error), 'error');
  }
}
async function createRevenueDraft(reservationId) {
  if (!canCreateDraft() || !window.supabaseRecord?.createRevenueDraft) return toast('Revenue draft creation is unavailable.', 'error');
  const button = document.querySelector(`[data-action="create-revenue-draft"][data-id="${CSS.escape(reservationId)}"]`);
  if (button) { button.disabled = true; button.textContent = 'Creating…'; }
  try {
    await window.supabaseRecord.createRevenueDraft(reservationId);
    toast(state.role === 'Receptionist' ? 'Revenue draft created successfully.' : 'Revenue draft created. A manager or administrator must confirm it.');
    await syncWithSupabase();
  } catch (error) {
    console.error('Revenue draft creation failed.', error);
    toast(friendlyRpcError(error), 'error');
    if (button) { button.disabled = false; button.textContent = 'Create revenue draft'; }
  }
}
function confirmRevenueForm(record) {
  modal('Confirm revenue draft', `<p class="panel-subtitle">Review the drafted counts and adjust them before confirmation.</p><div class="form-grid"><label>Adult customers<input name="adult_customers" type="number" min="0" step="1" value="${record.adult_customers}" required></label><label>Child customers<input name="child_customers" type="number" min="0" step="1" value="${record.child_customers}" required></label><label>Senior/PWD customers<input name="senior_pwd_customers" type="number" min="0" step="1" value="${record.senior_pwd_customers}" required></label></div>`, 'Confirm revenue');
  document.querySelector('#modalForm').dataset.type = 'confirm-revenue';
  document.querySelector('#modalForm').dataset.id = record.id;
}
function chargeItemForm(item = {}) {
  const value = key => item?.[key] ?? '';
  const content = `<div class="form-grid"><label>Charge code<input name="code" value="${esc(value('code'))}" required></label><label>Charge name<input name="name" value="${esc(value('name'))}" required></label><label>Type<select name="type"><option value="food" ${value('type') === 'food' ? 'selected' : ''}>Food</option><option value="non_food" ${value('type') === 'non_food' ? 'selected' : ''}>Non-food</option><option value="service_charge" ${value('type') === 'service_charge' ? 'selected' : ''}>Service charge</option><option value="package" ${value('type') === 'package' ? 'selected' : ''}>Package</option><option value="deposit" ${value('type') === 'deposit' ? 'selected' : ''}>Deposit</option><option value="discount" ${value('type') === 'discount' ? 'selected' : ''}>Discount</option><option value="other" ${value('type') === 'other' || !value('type') ? 'selected' : ''}>Other</option></select></label><label>Category<input name="category" value="${esc(value('category') || 'General')}" required></label><label>Unit price<input name="unitPrice" type="number" min="0" step="0.01" value="${Number(value('unitPrice') || 0).toFixed(2)}" required></label><label>Default qty<input name="defaultQuantity" type="number" min="0.01" step="0.01" value="${Number(value('defaultQuantity') || 1).toFixed(2)}" required></label><label>Active<input name="isActive" type="checkbox" ${value('isActive') === false ? '' : 'checked'}></label><label>Food revenue<input name="isFoodRevenue" type="checkbox" ${value('isFoodRevenue') === false ? '' : 'checked'}></label><label>Package<input name="isPackage" type="checkbox" ${value('isPackage') ? 'checked' : ''}></label><label>Approval needed<input name="requiresApproval" type="checkbox" ${value('requiresApproval') ? 'checked' : ''}></label><label class="full">Notes<textarea name="notes" rows="3">${esc(value('notes'))}</textarea></label></div>`;
  modal(item.id ? 'Edit charge item' : 'Create charge item', content, item.id ? 'Save charge' : 'Create charge');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'charge-item';
  if (item.id) form.dataset.id = item.id;
}
function billExtraLineMarkup(line = {}, disabled = false) {
  const allowedTypes = new Set(['food', 'non_food', 'other']);
  const items = all('chargeItems').filter(item => item.isActive !== false
    && allowedTypes.has(item.type) && !item.isPackage);
  const selectedChargeId = line.chargeItemId || '';
  const options = [
    '<option value="">Choose an extra charge</option>',
    ...items.map(item => `<option value="${esc(item.id)}" ${selectedChargeId === item.id ? 'selected' : ''}>${esc(item.name)} · ${money(item.unitPrice || 0)}${item.isFoodRevenue ? ' · Food' : ' · Non-food'}</option>`)
  ].join('');
  return `<div class="form-grid pos-extra-line" data-extra-line>
    <input type="hidden" name="extraLineId" value="${esc(line.id || '')}">
    <label class="full">Extra charge<select name="extraChargeItemId" ${disabled ? 'disabled' : ''}>${options}</select></label>
    <label>Quantity<input name="extraQuantity" type="number" min="0.01" max="10000" step="0.01" value="${Number(line.quantity || 1)}" ${disabled ? 'disabled' : ''}></label>
    ${line.id ? `<span class="field-help">Saved price: ${money(line.unitPrice)} each. Editing quantity keeps this price snapshot.</span>` : ''}
    ${disabled ? '' : '<button type="button" class="ghost-btn compact-btn" data-action="remove-bill-extra">Remove extra</button>'}
  </div>`;
}
function billForm(item = {}) {
  const editing = Boolean(item.id);
  const editable = !editing || (item.status === 'Open'
    && (state.role !== 'Receptionist' || item.createdBy === state.user?.id));
  const disabled = editable ? '' : 'disabled';
  const billLines = editing
    ? all('billLines').filter(line => line.billId === item.id && line.lineType === 'charge_item' && !line.isVoided)
    : [];
  const extraLines = billLines.length ? billLines : (editable ? [{}] : []);
  const reservations = all('reservations').map(res => `<option value="${esc(res.id)}" ${item.reservationId === res.id ? 'selected' : ''}>${esc(res.name || 'Guest')} · ${esc(res.date)} ${esc(res.time)}</option>`).join('');
  const discounts = all('discounts').filter(discount =>
    (discount.isActive !== false && (discount.appliesTo || 'bill') === 'bill') || discount.id === item.discountId
  ).map(discount => `<option value="${esc(discount.id)}" ${item.discountId === discount.id ? 'selected' : ''}>${esc(discount.name)} · ${esc(discount.discountType)} ${Number(discount.value || 0)}${discount.discountType === 'percent' ? '%' : ''}</option>`).join('');
  const pendingApproval = all('billApprovals').find(approval => approval.billId === item.id
    && approval.requestType === 'full_discount' && approval.status === 'Pending');
  const revenueTotals = ['Administrator', 'Manager'].includes(state.role)
    ? `<div>Food revenue <strong>${money(item.foodRevenueTotal)}</strong></div><div>Non-food revenue <strong>${money(item.nonFoodRevenueTotal)}</strong></div>`
    : '';
  const totals = editing ? `<section class="panel"><div class="panel-title">Server-calculated totals</div><div class="form-grid">
      <div>Subtotal <strong>${money(item.subtotal)}</strong></div><div>Service charge <strong>${money(item.serviceCharge)}</strong></div>
      <div>Discount <strong>${money(item.discountTotal)}</strong></div><div>Deposits (payments) <strong>${money(item.depositTotal)}</strong></div>
      <div>Cash paid <strong>${money(item.paidTotal)}</strong></div><div>Balance due <strong>${money(item.balanceDue)}</strong></div>
      ${revenueTotals}
      <div>Customers served <strong>${Number(item.customersServed || 0)}</strong></div>
    </div>${pendingApproval ? `<p class="field-help">Full discount approval pending (${esc(pendingApproval.requestedAt)}).</p>` : ''}</section>` : '<p class="field-help">All totals and prices are calculated by Supabase when you save.</p>';
  const actionButtons = editing
    ? `<div class="pos-bill-actions">${editable ? `<button type="button" class="ghost-btn" data-action="close-bill" data-id="${esc(item.id)}">Take cash &amp; close</button><button type="button" class="ghost-btn" data-action="request-bill-void" data-id="${esc(item.id)}">Request void</button>` : ''}<button type="button" class="ghost-btn" data-action="print-bill" data-id="${esc(item.id)}">Print billing statement</button></div>`
    : '';
  const content = `<p class="field-help">${editing ? `Bill ${esc(item.billNumber)} · ${esc(item.status)}${item.createdAt ? ` · Created ${esc(item.createdAt)}` : ''}` : 'Cash-only billing. Sales do not deduct inventory. Comped guests count as served at zero.'}</p>
    <div class="form-grid">
      <label>Customer name<input name="customerName" value="${esc(item.customerName || 'Walk-in')}" maxlength="160" ${disabled} required></label>
      <label>Reservation (optional)<select name="reservationId" ${disabled}><option value="">Walk-in / no reservation</option>${reservations}</select></label>
    </div>
    <fieldset class="product-form-section"><legend>Head counts</legend><div class="form-grid">
      <label>Adult × ${money(item.adultRate || 449)}<input name="adultCount" type="number" min="0" max="1000" step="1" value="${Number(item.adultCount || 0)}" ${disabled} required></label>
      <label>Senior / PWD × ${money(item.seniorRate || 360)}<input name="seniorCount" type="number" min="0" max="1000" step="1" value="${Number(item.seniorCount || 0)}" ${disabled} required></label>
      <label>Kids × ${money(item.kidsRate || 225)}<input name="kidsCount" type="number" min="0" max="1000" step="1" value="${Number(item.kidsCount || 0)}" ${disabled} required></label>
      <label>Comped × ₱0.00<input name="compedCount" type="number" min="0" max="1000" step="1" value="${Number(item.compedCount || 0)}" ${disabled} required></label>
    </div></fieldset>
    <fieldset class="product-form-section"><legend>Extras</legend><div class="field-help">Extra item prices are snapshotted from the charge catalog. Stock is never changed.</div><div class="pos-extra-lines">${extraLines.map(line => billExtraLineMarkup(line, !editable)).join('')}</div>${editable ? '<button type="button" class="ghost-btn compact-btn" data-action="add-bill-extra">+ Add extra</button>' : ''}</fieldset>
    <fieldset class="product-form-section"><legend>Discount</legend><div class="form-grid">
      <label>Discount<select name="discountId" ${disabled}><option value="">No discount</option>${discounts}</select></label>
      <label class="full">Reason (required when a discount is selected)<textarea name="discountReason" rows="2" maxlength="500" ${disabled}>${esc(item.discountReason || '')}</textarea></label>
    </div><small class="field-help">Full-bill discounts require Manager/Administrator approval before close.</small></fieldset>
    ${editing ? '' : '<label>Deposit already paid (optional)<input name="initialDeposit" type="number" min="0" max="10000000" step="0.01" value="0" required><small class="field-help">Recorded as a deposit payment, not a discount.</small></label>'}
    <label>Notes<textarea name="notes" rows="2" maxlength="1000" ${disabled}>${esc(item.notes || '')}</textarea></label>
    ${totals}${actionButtons}`;
  modal(editing ? `${editable ? 'Edit' : 'View'} bill ${item.billNumber || ''}` : 'Create bill',
    content, editable ? (editing ? 'Save bill' : 'Create bill') : '', 'pos-bill-modal');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'bill';
  if (editing) form.dataset.id = item.id;
  else form.dataset.createKey = id('POSCREATE');
}
function billCloseForm(bill) {
  modal(`Take cash · ${esc(bill.billNumber)}`,
    `<p>Balance due: <strong>${money(bill.balanceDue)}</strong></p><label>Cash tendered<input name="tenderedAmount" type="number" min="${Number(bill.balanceDue || 0).toFixed(2)}" step="0.01" value="${Number(bill.balanceDue || 0).toFixed(2)}" required><small class="field-help">The server records the applied payment and calculates change.</small></label>`,
    'Confirm cash and close', 'pos-payment-modal');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'bill-close';
  form.dataset.id = bill.id;
  form.dataset.paymentKey = id('POSPAY');
}
function billVoidRequestForm(bill) {
  modal(`Request void · ${esc(bill.billNumber)}`,
    '<p>A Manager or Administrator must approve this request. Closed bills cannot be voided here.</p><label>Reason<textarea name="voidReason" maxlength="500" rows="3" required></textarea></label>',
    'Request void', 'pos-approval-modal');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'bill-void-request';
  form.dataset.id = bill.id;
}
function billApprovalDecisionForm(approval, decision) {
  const approving = decision === 'approve';
  modal(`${approving ? 'Approve' : 'Reject'} request`,
    `<p>${esc(approval.requestType === 'void' ? 'Void bill' : '100% discount')} · ${esc(approval.requestReason)}</p>
      <label>${approving ? 'Decision note (optional)' : 'Reason for rejection'}
      <textarea name="decisionReason" maxlength="500" rows="3" ${approving ? '' : 'required'}></textarea></label>`,
    approving ? 'Approve request' : 'Reject request', 'pos-approval-modal');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'bill-approval-decision';
  form.dataset.id = approval.id;
  form.dataset.decision = decision;
}
function printBillingStatement(billId) {
  const bill = all('posBills').find(item => item.id === billId);
  if (!bill) return toast('This bill is no longer available.', 'error');
  const lines = all('billLines').filter(line => line.billId === bill.id && !line.isVoided);
  const payments = all('billPayments').filter(payment => payment.billId === bill.id);
  const mealLines = [
    ['Adult', bill.adultCount, bill.adultRate],
    ['Senior / PWD', bill.seniorCount, bill.seniorRate],
    ['Kids', bill.kidsCount, bill.kidsRate],
    ['Comped', bill.compedCount, 0]
  ].filter(([, quantity]) => Number(quantity || 0) > 0)
    .map(([label, quantity, unitPrice]) => `<tr><td>${esc(label)}</td><td>${quantity}</td><td>${money(unitPrice)}</td><td>${money(Number(quantity) * Number(unitPrice))}</td></tr>`);
  const extraLines = lines.map(line => `<tr><td>${esc(line.description)}</td><td>${Number(line.quantity)}</td><td>${money(line.unitPrice)}</td><td>${money(Number(line.quantity) * Number(line.unitPrice))}</td></tr>`);
  const cashPayment = payments.filter(payment => payment.paymentMethod === 'cash')
    .slice().sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)))[0];
  const title = 'BILLING STATEMENT (not an official receipt)';
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    body{font:14px Arial,sans-serif;color:#111;max-width:760px;margin:32px auto;padding:0 20px}
    h1{text-align:center;font-size:20px;margin:0 0 6px}.subtitle{text-align:center;margin:0 0 24px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;margin:12px 0 20px}th,td{border-bottom:1px solid #bbb;padding:8px;text-align:left}
    th:last-child,td:last-child{text-align:right}.totals{margin-left:auto;width:320px}.totals div{display:flex;justify-content:space-between;padding:5px 0}
    .balance{font-size:18px;font-weight:bold;border-top:2px solid #111;margin-top:8px;padding-top:10px!important}
    .notice{text-align:center;margin-top:30px;font-size:12px;color:#444}@media print{body{margin:0 auto;padding:0 10mm}}
  </style></head><body><h1>${title}</h1><p class="subtitle">This statement is not an official receipt.</p>
    <div class="meta"><div><strong>Bill:</strong> ${esc(bill.billNumber)}</div><div><strong>Status:</strong> ${esc(bill.status)}</div>
    <div><strong>Customer:</strong> ${esc(bill.customerName)}</div><div><strong>Date:</strong> ${esc(bill.closedAt || bill.createdAt || '')}</div>
    <div><strong>Customers served:</strong> ${Number(bill.customersServed || 0)}</div><div><strong>Reservation:</strong> ${esc(bill.reservationId || 'Walk-in')}</div></div>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${mealLines.concat(extraLines).join('') || '<tr><td colspan="4">No bill lines</td></tr>'}</tbody></table>
    <div class="totals"><div><span>Subtotal</span><strong>${money(bill.subtotal)}</strong></div>
    <div><span>Service charge</span><strong>${money(bill.serviceCharge)}</strong></div>
    <div><span>Discount</span><strong>−${money(bill.discountTotal)}</strong></div>
    ${bill.discountReason ? `<div><span>Discount reason</span><span>${esc(bill.discountReason)}</span></div>` : ''}
    <div><span>Deposit payments</span><strong>−${money(bill.depositTotal)}</strong></div>
    <div><span>Cash payment applied</span><strong>−${money(bill.paidTotal)}</strong></div>
    ${cashPayment ? `<div><span>Cash tendered</span><strong>${money(cashPayment.tenderedAmount)}</strong></div><div><span>Change</span><strong>${money(cashPayment.changeAmount)}</strong></div>` : ''}
    <div class="balance"><span>Balance due</span><span>${money(bill.balanceDue)}</span></div></div>
    <p class="notice">BILLING STATEMENT (not an official receipt)</p><script>window.onload=()=>window.print();</script></body></html>`;
  const printWindow = window.open('', '_blank');
  if (!printWindow) return toast('Allow pop-ups to print the billing statement.', 'error');
  printWindow.document.open();
  printWindow.document.write(doc);
  printWindow.document.close();
}
function shiftForm(item = {}) {
  const value = key => item?.[key] ?? '';
  const content = `<div class="form-grid"><label>Shift code<input name="shiftCode" value="${esc(value('code') || `SHIFT-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`)}" required></label><label>Status<select name="status"><option value="Open" ${value('status') === 'Open' ? 'selected' : ''}>Open</option><option value="Closed" ${value('status') === 'Closed' ? 'selected' : ''}>Closed</option><option value="Needs review" ${value('status') === 'Needs review' ? 'selected' : ''}>Needs review</option></select></label><label>Opened at<input name="openedAt" type="datetime-local" value="${esc(value('openedAt') ? value('openedAt').slice(0,16) : new Date().toISOString().slice(0,16))}"></label><label>Closed at<input name="closedAt" type="datetime-local" value="${esc(value('closedAt') ? value('closedAt').slice(0,16) : '')}"></label><label>Opening float<input name="openingFloat" type="number" min="0" step="0.01" value="${Number(value('openingFloat') || 0).toFixed(2)}"></label><label>Cash sales<input name="cashSales" type="number" min="0" step="0.01" value="${Number(value('cashSales') || 0).toFixed(2)}"></label><label>Card sales<input name="cardSales" type="number" min="0" step="0.01" value="${Number(value('cardSales') || 0).toFixed(2)}"></label><label>Declared cash<input name="declaredCash" type="number" min="0" step="0.01" value="${Number(value('declaredCash') || 0).toFixed(2)}"></label><label class="full">Notes<textarea name="notes" rows="3">${esc(value('notes'))}</textarea></label></div>`;
  modal(item.id ? 'Edit shift' : 'Open shift', content, item.id ? 'Save shift' : 'Open shift');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'shift';
  if (item.id) form.dataset.id = item.id;
}

document.addEventListener('click', event => {
  const actionElement = event.target.closest('[data-action]');
  const action = actionElement?.dataset.action;
  if (!['open-table-form', 'edit-table', 'assign-table', 'delete-table', 'apply-table-layout'].includes(action)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (action === 'open-table-form') return tableForm();
  if (action === 'apply-table-layout') return applyRestaurantTableLayout();
  const table = all('restaurantTables').find(item => item.id === actionElement.dataset.id);
  if (!table) return toast('This table is no longer available. Reload and try again.', 'error');
  if (action === 'edit-table') return tableForm(table);
  if (action === 'assign-table') return tableAssignmentForm(table);
  return deleteRecord('table', table.id);
});
document.addEventListener('click', async event => {
  const actionElement = event.target.closest('[data-action]');
  const action = actionElement?.dataset.action;
  if (!action) return;
  if (action === 'add-bill-extra') {
    const form = document.querySelector('#modalForm[data-type="bill"]');
    const lines = form?.querySelector('.pos-extra-lines');
    if (!lines) return;
    if (lines.querySelectorAll('[data-extra-line]').length >= 30) return toast('A bill can have no more than 30 extra lines.', 'error');
    lines.insertAdjacentHTML('beforeend', billExtraLineMarkup());
    state.modalDirty = true;
    return;
  }
  if (action === 'remove-bill-extra') {
    actionElement.closest('[data-extra-line]')?.remove();
    state.modalDirty = true;
    return;
  }
  if (action === 'open-walk-in') return walkInForm();
  if (action === 'new-bill') return billForm();
  if (action === 'open-bill') {
    const bill = all('posBills').find(item => item.id === actionElement.dataset.id);
    if (bill) return billForm(bill);
    return toast('This bill is no longer available. Reload the page and try again.', 'error');
  }
  if (action === 'close-bill') {
    if (state.modalDirty) return toast('Save or discard your bill edits before taking payment.', 'error');
    const bill = all('posBills').find(item => item.id === actionElement.dataset.id);
    if (bill?.status === 'Open') return billCloseForm(bill);
    return toast('Only open bills can be closed.', 'error');
  }
  if (action === 'request-bill-void') {
    if (state.modalDirty) return toast('Save or discard your bill edits before requesting a void.', 'error');
    const bill = all('posBills').find(item => item.id === actionElement.dataset.id);
    if (bill?.status === 'Open') return billVoidRequestForm(bill);
    return toast('Only open bills can be submitted for void approval.', 'error');
  }
  if (action === 'print-bill') {
    if (state.modalDirty) return toast('Save or discard your bill edits before printing.', 'error');
    return printBillingStatement(actionElement.dataset.id);
  }
  if (action === 'approve-approval' || action === 'reject-approval') {
    const approval = all('billApprovals').find(item => item.id === actionElement.dataset.id);
    if (approval) return billApprovalDecisionForm(approval, action === 'approve-approval' ? 'approve' : 'reject');
    return toast('This approval request is no longer available.', 'error');
  }
  if (action === 'new-shift') return shiftForm();
  if (action === 'open-shift') return shiftForm(all('shifts').find(item => item.id === event.target.closest('[data-action]').dataset.id));
  if (action === 'new-charge-item') return chargeItemForm();
  if (action === 'edit-charge-item') return chargeItemForm(all('chargeItems').find(item => item.id === event.target.closest('[data-action]').dataset.id));
  if (action === 'open-rate') return rateForm();
  if (action === 'edit-rate') return rateForm(all('buffetRates').find(item => item.id === event.target.closest('[data-action]').dataset.id));
  if (action === 'deactivate-rate') {
    if (!canManageRates()) return toast('You do not have permission to change buffet rates.', 'error');
    const rate = all('buffetRates').find(item => item.id === event.target.closest('[data-action]').dataset.id);
    if (!rate || !confirm('Deactivate this buffet rate?')) return;
    save('buffetRates', all('buffetRates').map(item => item.id === rate.id ? { ...item, isActive: false } : item))
      .then(() => { toast('Buffet rate deactivated.'); render(); })
      .catch(() => {});
  }
  if (action === 'reservation-transition') return transitionReservation(event.target.closest('[data-action]').dataset.id, event.target.closest('[data-action]').dataset.transition);
  if (action === 'create-revenue-draft') return createRevenueDraft(event.target.closest('[data-action]').dataset.id);
  if (action === 'delete-reservation') return deleteRecord('reservation', event.target.closest('[data-action]').dataset.id);
  if (action === 'confirm-revenue') {
    const record = all('revenueRecords').find(item => item.id === event.target.closest('[data-action]').dataset.id);
    if (record) confirmRevenueForm(record);
  }
});
document.addEventListener('click', event => {
  const category = event.target.closest('[data-recipe-category]')?.dataset.recipeCategory;
  if (category) {
    state.recipeCategory = category;
    render();
    return;
  }
  const dashboardStatus = event.target.closest('[data-dashboard-status]')?.dataset.dashboardStatus;
  if (dashboardStatus) {
    state.ingredientStatus = dashboardStatus;
    setView('ingredients');
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const name = action.dataset.action;
  if (name === 'close-modal') closeModal();
  else if (name === 'open-recipe') openRecipeForm();
  else if (name === 'open-revenue') revenueForm();
  else if (name === 'edit-revenue') {
    if (!canAccessRevenue()) return toast('Revenue Tracking is restricted.', 'error');
    const record = all('revenueRecords').find(item => item.id === action.dataset.id);
    if (record) revenueForm(record);
  } else if (name === 'void-revenue') {
    if (!canVoidRevenue()) return toast('Only Administrators can void revenue.', 'error');
    if (!confirm('Void this revenue record? This action is recorded and cannot be undone.')) return;
    const reason = prompt('Why is this revenue record being voided?');
    if (!reason?.trim()) return;
    save('revenueRecords', all('revenueRecords').map(item => item.id === action.dataset.id ? { ...item, status: 'Voided', voided_by: state.role, void_reason: reason.trim(), voided_at: new Date().toISOString() } : item));
    toast('Revenue record voided');
    render();
  } else if (name === 'open-reservation') reservationForm();
  else if (name === 'edit-reservation') {
    const record = all('reservations').find(item => item.id === action.dataset.id);
    if (record) reservationForm(record);
  } else if (name === 'toggle-recipe-picker') document.querySelector('.recipe-picker').classList.toggle('is-hidden');
  else if (name === 'add-recipe-ingredient') {
    const form = document.querySelector('#modalForm');
    const ingredientId = form.elements.draftIngredient.value;
    const quantity = Number(form.elements.draftQuantity.value);
    if (!quantity) return toast('Enter a quantity for the ingredient.', 'error');
    state.recipeForm = { ...state.recipeForm, ...Object.fromEntries(new FormData(form)), id: form.dataset.id || state.recipeForm?.id };
    state.recipeDraft.push({ ingredientId, quantity });
    renderRecipeModal();
  } else if (name === 'remove-recipe-ingredient') {
    const form = document.querySelector('#modalForm');
    state.recipeForm = { ...state.recipeForm, ...Object.fromEntries(new FormData(form)), id: form.dataset.id || state.recipeForm?.id };
    state.recipeDraft.splice(Number(action.dataset.index), 1);
    renderRecipeModal();
  } else if (name.startsWith('view-')) {
    const type = name.replace('view-', '');
    const map = { ingredient: 'ingredients', recipe: 'recipes' };
    const record = all(map[type]).find(item => item.id === action.dataset.id);
    if (record) viewRecord(type, record);
  } else if (name.startsWith('open-')) openForm(name.replace('open-', ''));
  else if (name.startsWith('edit-')) {
    const type = name.replace('edit-', '');
    const map = { ingredient: 'ingredients', recipe: 'recipes', user: 'users' };
    const record = all(map[type]).find(item => item.id === action.dataset.id);
    if (record) type === 'recipe' ? openRecipeForm(record) : openForm(type, record);
  } else if (name.startsWith('delete-')) deleteRecord(name.replace('delete-', ''), action.dataset.id);
});
document.addEventListener('submit', async event => {
  const formId = event.target.getAttribute('id');
  if (formId === 'loginForm') {
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const { data, error } = await window.supabaseClient.auth.signInWithPassword({
        email: form.elements.email.value.trim(),
        password: form.elements.password.value
      });
      if (error) throw error;
      await openAuthenticatedSession(data.session);
    } catch (error) {
      console.error('Authentication failed.', error);
      login(`Sign-in failed: ${error instanceof Error ? error.message : 'Unexpected authentication error.'}`);
    } finally {
      submit.disabled = false;
    }
  }
  if (formId === 'passwordRecoveryForm') {
    event.preventDefault();
    try {
      const { error } = await window.supabaseClient.auth.updateUser({ password: event.target.elements.password.value });
      if (error) throw error;
      passwordRecoveryMode = false;
      window.location.hash = '';
      toast('Password updated. You are signed in.');
      const { data, error: sessionError } = await window.supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      await openAuthenticatedSession(data.session);
    } catch (error) {
      console.error('Password update failed.', error);
      login(error.message || 'Password update failed. Request a new reset link.');
    }
  }
  if (formId === 'modalForm') { event.preventDefault(); handleSubmit(event.target); }
});
document.addEventListener('input', event => { if (event.target.id === 'tableSearch') { state.query = event.target.value; render(); const search = document.querySelector('#tableSearch'); search.focus(); search.setSelectionRange(state.query.length, state.query.length); } });
document.addEventListener('input', event => {
  if (event.target.id !== 'tableManagementSearch') return;
  state.tableManagementQuery = event.target.value;
  const position = event.target.selectionStart;
  render();
  const search = document.querySelector('#tableManagementSearch');
  search?.focus();
  search?.setSelectionRange(position, position);
});
document.addEventListener('change', event => {
  if (event.target.closest('#modalForm[data-type="waste"]')) updateWasteFormPreview(event.target.closest('#modalForm'));
  if (event.target.closest('#modalForm[data-type="receiving"]')) {
    const form = event.target.closest('#modalForm');
    if (event.target.matches('[data-field="ingredientId"]') && !form.elements.supplierName.value.trim()) {
      const selectedProduct = ingredient(event.target.value);
      if (selectedProduct?.preferredSupplier) form.elements.supplierName.value = selectedProduct.preferredSupplier;
    }
    updateReceivingTotals(form);
    updateReceivingExpiryRequirements(form);
  }
  const filter = event.target.dataset.filter;
  if (filter) { state[filter] = event.target.value.startsWith('All ') ? 'All' : event.target.value; render(); return; }
  if (event.target.matches('[data-low-stock-filter]')) { state.ingredientStatus = event.target.checked ? 'Low Stock' : 'All'; render(); }
  if (event.target.matches('[data-date-range]')) {
    state.dateRange = event.target.value;
    if (state.dateRange === 'custom') {
      state.customDateTo ||= today();
      if (!state.customDateFrom) {
        const startDate = new Date(`${state.customDateTo}T12:00:00`);
        startDate.setDate(startDate.getDate() - 29);
        state.customDateFrom = localDateStr(startDate);
      }
    }
    render();
  }
  if (event.target.matches('[data-report-group]')) { state.reportGrouping = event.target.value; reportRequestKey = ''; render(); }
  if (event.target.matches('[data-report-waste]')) { state.reportIncludeWaste = event.target.checked; reportRequestKey = ''; render(); }
  if (event.target.matches('[data-custom-date]')) { state[`customDate${event.target.dataset.customDate === 'from' ? 'From' : 'To'}`] = event.target.value; render(); }
  if (event.target.matches('[data-reservation-meal]')) { state.reservationMealPeriodFilter = event.target.value === 'All' ? 'All' : event.target.value; persistReservationFilters(); render(); }
});
document.addEventListener('change', event => {
  if (event.target.matches('[data-revenue-range]')) {
    state.revenueRange = event.target.value;
    render();
  }
});
document.addEventListener('change', event => {
  const form = event.target.closest('#modalForm[data-type="reservation"]');
  if (form && event.target.matches('[name="date"],[name="time"],[name="adults"],[name="children"]')) {
    refreshReservationTables(form);
    return;
  }
  if (event.target.matches('[data-table-date]')) {
    if (event.target.value && event.target.value < today()) {
      event.target.value = today();
      return toast('Table management is available for today and future dates.', 'error');
    }
    state.tableManagementDate = event.target.value || today();
    render();
  } else if (event.target.matches('[data-table-status]')) {
    state.tableManagementStatus = event.target.value;
    render();
  } else if (event.target.matches('[data-table-capacity]')) {
    state.tableManagementCapacity = event.target.value;
    render();
  } else if (event.target.matches('[data-table-type]')) {
    state.tableManagementType = event.target.value;
    render();
  } else if (event.target.matches('[data-table-area]')) {
    state.tableManagementArea = event.target.value;
    render();
  }
});
async function syncWithSupabase() {
  const collectionsByRole = {
    Administrator: KEYS,
    Manager: KEYS.filter(key => key !== 'users'),
    'Inventory Clerk': ['ingredients', 'inventoryTransactions', 'physicalCounts'],
    'Chef / Kitchen Staff': ['ingredients', 'recipes', 'productionLogs', 'wasteLogs'],
    Receptionist: ['reservations', 'restaurantTables', 'buffetRates', 'chargeItems', 'packageTiers', 'discounts', 'posSettings', 'shifts', 'cashMovements', 'posBills', 'billLines', 'billPayments', 'reservationDeposits', 'billApprovals']
  };
  const collections = collectionsByRole[state.role] || [];
  setSyncState('syncing', 'Loading the latest restaurant data.', 'Syncing…');
  state.productionBoard = { date: '', rows: [], loading: false, loaded: false, error: '' };
  state.productionHistoryOpen = false;
  state.productionHistory = {
    from: '', to: '', timeFrom: '', timeTo: '', dish: 'All', status: 'All',
    rows: [], loading: false, loaded: false, error: ''
  };
  KEYS.forEach(key => { collectionState[key] = []; });
  for (const key of collections) {
    const remoteRecords = await window.supabaseRecord.load(key);
    collectionState[key] = remoteRecords;
  }
  supabaseSyncEnabled = true;
  invalidateReportData();
  setPostSaveSyncState();
  render();
}
async function openAuthenticatedSession(session) {
  if (!session?.user) throw new Error('No authenticated Supabase session was returned.');
  const { data: profile, error } = await window.supabaseClient
    .from('profiles')
    .select('id,email,full_name,role')
    .eq('id', session.user.id)
    .single();
  if (error || !profile || !roleAccess[profile.role]) {
    await window.supabaseClient.auth.signOut();
    throw new Error('Your account has no valid CostTrack role profile. Ask an administrator to provision your profile.');
  }
  state.user = profile;
  state.role = profile.role;
  window.supabaseRecord.clearVersions();
  const requestedView = window.location.hash.slice(1) || 'dashboard';
  state.view = canAccess(requestedView) ? requestedView : (roleAccess[state.role][0] || 'dashboard');
  if (state.view === 'reservations') state.reservationMealPeriodFilter = 'All';
  if (state.view !== requestedView) window.history.replaceState(null, '', `#${state.view}`);
  document.querySelector('#loginScreen').classList.add('is-hidden');
  document.querySelector('#appShell').classList.remove('is-hidden');
  restoreShellPreferences();
  syncActiveSidebarGroup(state.view);
  document.querySelector('#loadingState').classList.remove('is-hidden');
  try {
    await syncWithSupabase();
    document.querySelector('#loadingState').classList.add('is-hidden');
  } catch (syncError) {
    console.error('Initial cloud load failed.', syncError);
    setSyncState('error', syncError.message);
    document.querySelector('#loadingState').classList.add('is-hidden');
    toast('Cloud data could not be loaded. Check access or connection, then retry.', 'error');
  }
  render();
}
async function signOutCurrentUser() {
  await stopRealtimeSubscriptions();
  const { error } = await window.supabaseClient.auth.signOut();
  if (error) {
    toast('Sign out failed. Please try again.', 'error');
    console.error('Sign out failed.', error);
    return;
  }
  closeMobileDrawer(false);
  closeShellPopovers(false);
  state.user = null;
  state.role = null;
  lastSavedAt = null;
  supabaseSyncEnabled = false;
  KEYS.forEach(key => { collectionState[key] = []; });
  clearDataStorage();
  document.querySelector('#appShell').classList.add('is-hidden');
  document.querySelector('#loginScreen').classList.remove('is-hidden');
  login();
}
async function retryCloudSync(failureState = 'error') {
  if (!state.user) return;
  try {
    await syncWithSupabase();
    if (failureState === 'reconnecting' && !realtimeConnected) setSyncState('reconnecting');
  } catch (error) {
    console.error('Cloud sync retry failed.', error);
    setSyncState(failureState, error.message);
    toast('Cloud sync retry failed. Please try again.', 'error');
  }
}
document.querySelector('#syncStatus').addEventListener('click', () => {
  if (document.querySelector('#syncStatus').dataset.state === 'error') retryCloudSync();
});
document.querySelector('#discardSyncButton').classList.add('is-hidden');
document.addEventListener('click', event => {
  const target = event.target;
  const popoverTrigger = target.closest('[data-popover-trigger]');
  const viewLink = target.closest('#sidebar [data-view], .breadcrumb [data-view]');
  const groupToggle = target.closest('#sidebar [data-action="toggle-nav-group"]');
  const shellAction = target.closest('[data-shell-action]');
  const createAction = target.closest('[data-create-action]');
  const alertItem = target.closest('[data-alert-view]');
  const paletteOption = target.closest('[data-palette-index]');

  if (!target.closest('.shell-popover-wrap')) closeShellPopovers(false);

  if (target.closest('#searchLauncher')) {
    event.preventDefault();
    openCommandPalette(target.closest('#searchLauncher'));
    return;
  }
  if (target.closest('#mobileMenu')) {
    event.preventDefault();
    if (document.querySelector('#sidebar').classList.contains('open')) closeMobileDrawer();
    else openMobileDrawer();
    return;
  }
  if (target.closest('#drawerOverlay')) {
    closeMobileDrawer();
    return;
  }
  if (target.closest('[data-palette-backdrop]')) {
    closeCommandPalette();
    return;
  }
  if (paletteOption) {
    event.preventDefault();
    choosePaletteItem(Number(paletteOption.dataset.paletteIndex));
    return;
  }
  if (createAction) {
    event.preventDefault();
    runCreateAction(createAction.dataset.createAction);
    return;
  }
  if (alertItem) {
    event.preventDefault();
    setView(alertItem.dataset.alertView);
    return;
  }
  if (popoverTrigger) {
    event.preventDefault();
    toggleShellPopover(popoverTrigger.dataset.popoverTrigger, popoverTrigger);
    return;
  }
  if (viewLink) {
    event.preventDefault();
    setView(viewLink.dataset.view);
    return;
  }
  if (groupToggle) {
    event.preventDefault();
    toggleSidebarGroup(groupToggle.dataset.group);
    return;
  }
  if (shellAction) {
    event.preventDefault();
    const action = shellAction.dataset.shellAction;
    if (action === 'toggle-sidebar') {
      const shell = document.querySelector('#appShell');
      const collapsed = !shell.classList.contains('sidebar-collapsed');
      shell.classList.toggle('sidebar-collapsed', collapsed);
      state.sidebarFlyoutGroup = null;
      writeShellPreference(`costtrack_sidebar_collapsed_${state.role}`, String(collapsed));
      document.querySelector('#sidebar').innerHTML = nav();
      document.querySelector('[data-shell-action="toggle-sidebar"]')?.focus();
    } else if (action === 'toggle-guide') {
      if (window.matchMedia('(max-height: 700px)').matches) {
        toast('Use the sidebar for navigation. The New menu only shows actions allowed for your role.');
        return;
      }
      if (document.querySelector('#appShell').classList.contains('sidebar-collapsed')) {
        showGuide();
        return;
      }
      const collapsed = !readShellPreference(`costtrack_sidebar_guide_collapsed_${state.role}`);
      writeShellPreference(`costtrack_sidebar_guide_collapsed_${state.role}`, String(collapsed));
      document.querySelector('#sidebar').innerHTML = nav();
      document.querySelector('[data-shell-action="toggle-guide"]')?.focus();
    } else if (action === 'dismiss-guide') {
      writeShellPreference(`costtrack_sidebar_guide_dismissed_${state.role}`, 'true');
      document.querySelector('#sidebar').innerHTML = nav();
      document.querySelector('.sidebar-user-trigger')?.focus();
    } else if (action === 'show-guide') {
      closeShellPopovers(false);
      showGuide();
    } else if (action === 'close-drawer') {
      closeMobileDrawer();
    } else if (action === 'sign-out') {
      closeShellPopovers(false);
      signOutCurrentUser();
    }
    return;
  }
}, true);
document.addEventListener('input', event => {
  if (event.target.id !== 'paletteSearch') return;
  state.paletteSelection = 0;
  updatePaletteResults(event.target.value);
});
document.addEventListener('keydown', event => {
  const palette = document.querySelector('#commandPaletteRoot .command-palette');
  if (palette) {
    const total = state.paletteItems.length;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCommandPalette();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (total) {
        state.paletteSelection = (state.paletteSelection + (event.key === 'ArrowDown' ? 1 : total - 1)) % total;
        updatePaletteResults(document.querySelector('#paletteSearch')?.value || '');
      }
      return;
    }
    if (event.key === 'Enter' && event.target.id === 'paletteSearch') {
      event.preventDefault();
      choosePaletteItem(state.paletteSelection);
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...palette.querySelectorAll('input,button:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    return;
  }

  const openPanel = document.querySelector('[data-popover-panel]:not([hidden])');
  if (openPanel) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeShellPopovers(true);
      return;
    }
    const wrapper = openPanel.closest('.shell-popover-wrap');
    const menuItems = [...openPanel.querySelectorAll('[role="menuitem"]:not([disabled])')];
    if (menuItems.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const current = menuItems.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? menuItems.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : menuItems.length - 1)) % menuItems.length;
      menuItems[next].focus();
      return;
    }
    if (event.key === 'Tab' && wrapper) {
      const focusable = [...wrapper.querySelectorAll('button:not([disabled]),a[href],input')]
        .filter(element => !element.closest('[hidden]'));
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    return;
  }

  const sidebar = document.querySelector('#sidebar');
  const drawerOpen = sidebar?.classList.contains('open') && window.matchMedia('(max-width: 1024px)').matches;
  if (drawerOpen) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMobileDrawer();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...sidebar.querySelectorAll('a[href],button:not([disabled])')]
        .filter(element => !element.closest('[hidden]'));
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    return;
  }

  const collapsedFlyout = document.querySelector('#appShell.sidebar-collapsed #sidebar .nav-group.is-expanded [role="menu"]');
  if (collapsedFlyout && ['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) {
    const items = [...collapsedFlyout.querySelectorAll('[role="menuitem"]')];
    if (event.key === 'Escape') {
      event.preventDefault();
      const group = collapsedFlyout.closest('.nav-group');
      state.sidebarFlyoutGroup = null;
      document.querySelector('#sidebar').innerHTML = nav();
      document.querySelector(`[data-group="${group?.dataset.sidebarGroup}"]`)?.focus();
    } else if (items.length) {
      event.preventDefault();
      const current = items.indexOf(document.activeElement);
      const delta = event.key === 'ArrowDown' ? 1 : items.length - 1;
      items[(current + delta) % items.length].focus();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openCommandPalette(document.querySelector('#searchLauncher'));
  }
});
document.addEventListener('click', event => {
  if (!event.target.closest('.shell-popover-wrap')) closeShellPopovers(false);
});
let previousShellMobileMode = window.matchMedia('(max-width: 1024px)').matches;
window.addEventListener('resize', () => {
  const mobileMode = window.matchMedia('(max-width: 1024px)').matches;
  if (mobileMode === previousShellMobileMode) return;
  previousShellMobileMode = mobileMode;
  if (mobileMode) {
    document.querySelector('#appShell').classList.remove('sidebar-collapsed');
    state.sidebarFlyoutGroup = null;
  } else {
    if (document.querySelector('#sidebar')?.classList.contains('open')) {
      state.forceCloseDrawer = true;
      closeMobileDrawer(false);
    }
    restoreShellPreferences();
  }
  document.querySelector('#sidebar').innerHTML = nav();
});
document.querySelector('#loginScreen').addEventListener('click', async event => {
  if (event.target.id !== 'resetPasswordButton') return;
  const email = document.querySelector('#loginForm [name="email"]').value.trim();
  if (!email) return login('Enter your work email first, then request a reset link.');
  const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${window.location.pathname}#recovery` });
  if (error) {
    console.error('Password reset request failed.', error);
    return login('Could not send the reset email. Check the address and try again.');
  }
  login('If an account exists for this address, a password reset email has been sent.');
});
window.addEventListener('online', () => {
  setSyncState('reconnecting');
  retryCloudSync('reconnecting');
});
window.addEventListener('offline', () => {
  realtimeConnected = false;
  setSyncState('offline');
});
window.supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    passwordRecoveryMode = true;
    login();
    return;
  }
  if (event === 'SIGNED_OUT' && state.user) {
    stopRealtimeSubscriptions();
    state.user = null;
    state.role = null;
    supabaseSyncEnabled = false;
    KEYS.forEach(key => { collectionState[key] = []; });
    clearDataStorage();
    document.querySelector('#appShell').classList.add('is-hidden');
    document.querySelector('#loginScreen').classList.remove('is-hidden');
    login('Your session ended. Sign in again to continue.');
  }
  if (event === 'TOKEN_REFRESHED' && !session) setSyncState('error', 'Your session expired. Sign in again.');
});
document.querySelector('#loadingState').classList.remove('is-hidden');
window.supabaseClient.auth.getSession().then(({ data, error }) => {
  if (error) throw error;
  if (data.session) return openAuthenticatedSession(data.session);
  document.querySelector('#loadingState').classList.add('is-hidden');
  login();
  setSyncState('offline');
}).catch(error => {
  console.error('Could not restore the Supabase session.', error);
  document.querySelector('#loadingState').classList.add('is-hidden');
  setSyncState('offline', error.message);
  login('Secure sign-in is currently unavailable. Check your connection and try again.');
});

/* Accessible UI refinements kept in this layer so the existing local data model remains unchanged. */
function modal(title, content, submit = 'Save record', modalClass = '') {
  modalOpener = document.activeElement;
  state.modalDirty = false;
  const submitButton = submit ? `<button class="primary-btn modal-submit" type="submit">${submit}</button>` : '';
  document.querySelector('#modalRoot').innerHTML = `<div class="modal-backdrop" role="presentation"><div class="modal${modalClass ? ` ${esc(modalClass)}` : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle" tabindex="-1"><div class="modal-header"><div><div class="eyebrow">CostTrack workspace</div><h2 id="modalTitle">${title}</h2></div></div><form id="modalForm" novalidate>${content}<div class="modal-actions"><button type="button" class="ghost-btn" data-action="close-modal">Cancel</button>${submitButton}</div></form></div></div>`;
  const form = document.querySelector('#modalForm');
  form.querySelectorAll('label').forEach((label, index) => {
    const control = label.querySelector('input, select, textarea');
    if (!control) return;
    if (!control.id) control.id = `modal-${control.name || 'field'}-${index}`;
    label.htmlFor = control.id;
    if (control.required) label.classList.add('required-field');
    const unit = { cost: '₱', unitCost: '₱', price: '₱', quantity: 'qty', stock: 'qty', minimum: 'qty', expected: 'qty', actual: 'qty', wastage: '%' }[control.name];
    if (unit) { label.dataset.unit = unit; control.classList.add('has-unit'); }
  });
  const first = form.querySelector('input:not([type="hidden"]), select, textarea, button');
  requestAnimationFrame(() => first?.focus());
}

function restoreModalFocus() {
  if (!modalOpener) return;
  const action = modalOpener.dataset?.action;
  const recordId = modalOpener.dataset?.id;
  const replacement = [...document.querySelectorAll('[data-action]')].find(element =>
    element.dataset.action === action && element.dataset.id === recordId
  );
  const focusTarget = replacement || (modalOpener.isConnected ? modalOpener : null);
  requestAnimationFrame(() => focusTarget?.focus());
  modalOpener = null;
}

function closeModal() {
  if (state.modalDirty && !confirm('Discard unsaved changes?')) return;
  document.querySelector('#modalRoot').innerHTML = '';
  state.modalDirty = false;
  restoreModalFocus();
}
new MutationObserver(() => {
  if (!document.querySelector('#modalRoot').firstElementChild && modalOpener) restoreModalFocus();
}).observe(document.querySelector('#modalRoot'), { childList: true });

function showFieldError(control, message) {
  const label = control.closest('label');
  label?.classList.add('has-error');
  let error = label?.querySelector('.field-error');
  if (!error) {
    error = document.createElement('span');
    error.className = 'field-error';
    label?.append(error);
  }
  error.textContent = message;
  control.setAttribute('aria-invalid', 'true');
}

function clearFieldErrors(form) {
  form.querySelectorAll('.has-error').forEach(label => label.classList.remove('has-error'));
  form.querySelectorAll('.field-error').forEach(error => error.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach(control => control.removeAttribute('aria-invalid'));
}

function normaliseRenderedStatuses() {
  document.querySelectorAll('.status, .stock-state').forEach(element => {
    const value = element.textContent.trim().toLowerCase();
    const tableAvailability = element.dataset.tableAvailability;
    const kind = tableAvailability === 'Available' ? 'good'
      : tableAvailability === 'Reserved' ? 'low'
        : tableAvailability === 'Occupied' ? 'out'
          : value.includes('cancel') ? 'out' : value.includes('pending') ? 'low' : value.includes('out') ? 'out' : value.includes('low') || value.includes('short') ? 'low' : value.includes('over') ? 'over' : 'healthy';
    element.classList.remove('status-good', 'status-low', 'status-out', 'status-over', 'healthy', 'low', 'out', 'over');
    element.classList.add(`status-${kind}`);
    element.insertAdjacentHTML('afterbegin', `<span class="status-dot" aria-hidden="true"></span>`);
  });
}

function render() {
  destroyReservationCalendar();
  reportCharts.forEach(chart => chart.destroy());
  reportCharts = [];
  reportChartSpecs = [];
  if (!state.user || !state.role) return;
  if (state.view === 'revenue' && !canAccessRevenue()) {
    document.querySelector('#sidebar').innerHTML = nav();
    renderShellChrome();
    document.querySelector('#pageCrumb').textContent = 'Access denied';
    app.innerHTML = revenueAccessDenied();
    return;
  }
  if (!canAccess(state.view)) {
    state.view = roleAccess[state.role][0];
    syncActiveSidebarGroup(state.view);
  }
  document.querySelector('#sidebar').innerHTML = nav();
  renderShellChrome();
  const moduleNames = { dashboard: 'Overview', ingredients: 'Inventory Management', receiving: 'Inventory Management', counts: 'Inventory Management', recipes: 'Kitchen Operations', production: 'Kitchen Operations', waste: 'Kitchen Operations', reservations: 'Front of House', calendar: 'Front of House', tables: 'Front of House', cashier: 'Front of House', shifts: 'Front of House', approvals: 'Front of House', revenue: 'Revenue Management', rates: 'Revenue Management', 'charge-catalog': 'Revenue Management', reports: 'Analytics & Reports', users: 'System Management', roles: 'System Management', settings: 'System Management' };
  const pageNames = { dashboard: 'Dashboard', ingredients: 'Ingredients', receiving: 'Receiving', recipes: 'Recipes', production: 'Buffet production', waste: 'Waste logs', counts: 'Physical count', reports: 'Reports & analytics', revenue: 'Revenue Tracking', rates: 'Buffet rates', 'charge-catalog': 'Charge catalog', users: 'User management', roles: 'Role management', settings: 'System settings', reservations: 'Reservations', calendar: 'Tables / Calendar', tables: 'Table management', cashier: 'Cashier', shifts: 'Shifts', approvals: 'Approvals' };
  const activeGroup = sidebarGroups.find(group => group.items.some(([view]) => view === state.view));
  const crumbLabel = state.view === 'dashboard' ? 'Overview' : (moduleNames[state.view] || 'Workspace');
  const crumbTarget = activeGroup?.items.find(([view]) => canAccess(view))?.[0] || 'dashboard';
  document.querySelector('.breadcrumb').innerHTML = `<a class="crumb-parent" href="#${crumbTarget}" data-view="${crumbTarget}">${esc(crumbLabel)}</a><span aria-hidden="true">›</span><strong id="pageCrumb" tabindex="-1">${esc(pageNames[state.view] || state.view)}</strong>`;
  const pages = { dashboard: roleDashboard, ingredients: ingredientCardsPage, receiving: () => receivingPage(), recipes: recipeCardsPage, production: productionBoardPage, waste: () => logsPage('waste'), counts: () => countsPage(), reports: reportsPage, revenue: revenuePage, rates: () => ratesPage(), 'charge-catalog': chargeCatalogPage, cashier: cashierPage, shifts: shiftsPage, approvals: approvalsPage, users: () => usersPage(), roles: () => usersPage(), settings: () => usersPage(), reservations: reservationsPage, calendar: calendarPage, tables: tableManagementPage };
  const renderPage = pages[state.view];
  if (!renderPage) {
    console.error(`No page renderer is registered for "${state.view}".`);
    app.innerHTML = '<div class="panel error-state" role="alert">This module is unavailable. Please return to the dashboard or contact your administrator.</div>';
    return;
  }
  try {
    app.innerHTML = renderPage();
  } catch (error) {
    console.error(`Could not render the ${state.view} module.`, error);
    app.innerHTML = `<div class="panel error-state" role="alert">Could not load ${esc(pageNames[state.view] || state.view)}. Please refresh the page. Check the browser console for details.</div>`;
    return;
  }
  if (state.view === 'calendar') initializeReservationCalendar();
  if (state.view === 'reports') initializeReportCharts();
  if (state.view === 'reports') loadReportData();
  configureRealtimeSubscriptions().catch(error => {
    console.error('Realtime subscription setup failed.', error);
    setSyncState(navigator.onLine ? 'reconnecting' : 'offline', error.message);
  });
  if (state.view === 'production') {
    loadProductionBoard();
  }
  const revenueRange = document.querySelector('[data-revenue-range]');
  if (revenueRange) revenueRange.value = state.revenueRange;
  normaliseRenderedStatuses();
  if (state.view === 'ingredients') {
    const toolbar = document.querySelector('.catalog-toolbar');
    if (toolbar && !toolbar.querySelector('[data-action="clear-filters"]')) toolbar.insertAdjacentHTML('beforeend', '<button class="ghost-btn clear-filters" data-action="clear-filters">Clear filters</button>');
  }
}
window.setInterval(() => {
  if (!state.user || document.hidden || state.modalDirty || document.querySelector('#modalForm')) return;
  const isLiveTableView = ['reservations', 'tables'].includes(state.view)
    || (state.view === 'dashboard' && state.role === 'Receptionist');
  if (!isLiveTableView) return;
  const scrollY = window.scrollY;
  const focusedId = document.activeElement?.id;
  render();
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
  window.scrollTo(0, scrollY);
}, 60 * 1000);

function actions(type, itemId) {
  const labels = { view: 'View', edit: 'Edit', delete: 'Delete' };
  const icon = name => name === 'view' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>' : name === 'edit' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5Z"/><path d="m14 6.5 3.5 3.5"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>';
  const viewable = ['ingredient', 'recipe'].includes(type);
  const editable = (type === 'ingredient' && window.CostTrackLogic.canPerformInventoryAction(state.role, 'product.manage'))
    || (type === 'recipe' && window.CostTrackLogic.canPerformInventoryAction(state.role, 'recipe.manage'))
    || (type === 'user' && state.role === 'Administrator');
  return `<div class="row-actions">${viewable ? `<button type="button" data-action="view-${type}" data-id="${itemId}" aria-label="${labels.view}"><span class="tooltip">${labels.view}</span>${icon('view')}</button>` : ''}${editable ? `<button type="button" data-action="edit-${type}" data-id="${itemId}" aria-label="${labels.edit}"><span class="tooltip">${labels.edit}</span>${icon('edit')}</button>` : ''}</div>`;
}

async function deleteRecord(type, itemId) {
  const mapping = { ingredient: 'ingredients', recipe: 'recipes', reservation: 'reservations', table: 'restaurantTables', transaction: 'inventoryTransactions', production: 'productionLogs', waste: 'wasteLogs', count: 'physicalCounts', user: 'users' };
  const key = mapping[type]; if (!key) return;
  if (!['Administrator', 'Manager'].includes(state.role)) return toast('Only Administrators and Managers can delete records.', 'error');
  const record = all(key).find(item => item.id === itemId);
  if (type === 'reservation' && record?.date < today()) return toast('Past reservations cannot be deleted.', 'error');
  if (type === 'table' && all('reservations').some(item => item.table === itemId)) return toast('Tables linked to reservation history cannot be deleted.', 'error');
  if (type === 'ingredient' && (all('recipes').some(item => item.ingredients.some(line => line.ingredientId === itemId)) || all('inventoryTransactions').some(item => item.ingredientId === itemId) || all('wasteLogs').some(item => item.ingredientId === itemId) || all('physicalCounts').some(item => item.ingredientId === itemId))) {
    return toast('This ingredient is referenced by recipe or inventory history and cannot be deleted.', 'error');
  }
  if (type === 'recipe' && all('productionLogs').some(item => item.recipeId === itemId)) {
    return toast('This recipe is referenced by production history and cannot be deleted.', 'error');
  }
  const name = record?.name || (type === 'table' ? record?.id : '') || ingredient(record?.ingredientId)?.name || recipe(record?.recipeId)?.name || 'this record';
  if (!confirm(`Delete ${name}? This can't be undone.`)) return;
  try {
    if (type === 'reservation') await removeRecord(key, itemId);
    else await save(key, all(key).filter(item => item.id !== itemId));
  } catch (error) {
    if (type === 'reservation') toast(friendlyRpcError(error), 'error');
    return;
  }
  toast(`${name} deleted`);
  render();
}

function exportRecipeReport(format) {
  const rows = [
    ['Recipe', 'Cost', 'Price', 'Food cost %', 'Margin'],
    ...all('recipes').map(item => {
      const cost = computedRecipeCost(item);
      return [item.name, cost, Number(item.price), `${(cost / item.price * 100).toFixed(1)}%`, item.price - cost];
    })
  ];
  if (format === 'Excel') {
    if (!window.XLSX) throw new Error('Excel export is unavailable. Check your connection and try again.');
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, window.XLSX.utils.aoa_to_sheet(rows), 'Recipe Costs');
    window.XLSX.writeFile(workbook, 'costtrack-recipe-report.xlsx');
    return;
  }
  const output = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([output], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = 'costtrack-recipe-report.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function reportChartPanel(id, title, description, rows, valueKey, labelKey, type, unit = '') {
  const chartRows = rows.filter(item => item[valueKey] !== null && item[valueKey] !== undefined && item[valueKey] !== '' && Number.isFinite(Number(item[valueKey])));
  if (chartRows.length) reportChartSpecs.push({ id, title, rows: chartRows, valueKey, labelKey, type, unit });
  return `<section class="panel report-chart-panel"><h2 class="panel-title">${esc(title)}</h2><p class="panel-subtitle">${esc(description)}</p>${chartRows.length ? `<div class="report-chart-wrap"><canvas id="${id}" role="img" aria-label="${esc(title)}"></canvas></div>` : '<div class="empty-state">No data in this range.</div>'}</section>`;
}
function invalidateReportData() {
  reportDataVersion++;
  Object.keys(reportServerData).forEach(key => delete reportServerData[key]);
  reportRequestKey = '';
}
function initializeReportCharts() {
  const panel = document.querySelector('.report-chart-grid');
  if (!panel) return;
  if (!window.Chart) {
    panel.querySelectorAll('canvas').forEach(canvas => {
      canvas.outerHTML = '<div class="error-state" role="alert">Charts could not load. The report table is still available.</div>';
    });
    console.error('Chart.js is unavailable; report charts could not be rendered.');
    return;
  }
  const teal = getComputedStyle(document.documentElement).getPropertyValue('--teal').trim() || '#168277';
  const orange = getComputedStyle(document.documentElement).getPropertyValue('--orange').trim() || '#e99751';
  reportChartSpecs.forEach(spec => {
    const canvas = document.getElementById(spec.id);
    if (!canvas) return;
    const color = spec.type === 'line' ? teal : orange;
    try {
      const chart = new window.Chart(canvas, {
        type: spec.type,
        data: {
          labels: spec.rows.map(item => String(item[spec.labelKey] ?? '')),
          datasets: [{
            label: spec.title,
            data: spec.rows.map(item => Number(item[spec.valueKey])),
            borderColor: color,
            backgroundColor: spec.type === 'line' ? `${color}33` : `${color}bb`,
            borderWidth: 2,
            fill: spec.type === 'line',
            tension: 0.25,
            borderRadius: spec.type === 'bar' ? 4 : 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: context => `${context.dataset.label}: ${spec.unit === 'currency' ? money(context.parsed.y) : `${context.parsed.y.toLocaleString()}${spec.unit ? ` ${spec.unit}` : ''}`}`
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true } },
            y: {
              beginAtZero: true,
              ticks: { callback: value => spec.unit === 'currency' ? money(value) : `${Number(value).toLocaleString()}${spec.unit ? ` ${spec.unit}` : ''}` }
            }
          }
        }
      });
      reportCharts.push(chart);
    } catch (error) {
      console.error(`Could not render the ${spec.title} chart.`, error);
      canvas.outerHTML = '<div class="error-state" role="alert">This chart could not be displayed. The report table is still available.</div>';
    }
  });
}
function reportTable(headers, rows, empty = 'No data in this range.') { return `<div class="table-scroll"><table><thead><tr>${headers.map(item => `<th>${item}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="empty-state">${empty}</td></tr>`}</tbody></table></div>`; }
function reportExport(rows, name) { const output = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'); const blob = new Blob([output], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `costtrack-${name}.csv`; link.click(); URL.revokeObjectURL(link.href); }
async function loadReportData() {
  const [start, end] = dateRangeBounds(); const key = `${state.reportTab}|${start}|${end}|${state.reportGrouping}|${state.reportIncludeWaste}`;
  if (!start || !end || reportRequestPending || reportRequestKey === key || reportServerData[key]) return;
  reportRequestPending = true; reportRequestKey = key;
  const requestVersion = reportDataVersion;
  try {
    const data = await window.supabaseRecord.reportAnalytics(state.reportTab, start, end, state.reportGrouping, state.reportIncludeWaste);
    if (requestVersion === reportDataVersion) reportServerData[key] = data;
  }
  catch (error) {
    if (requestVersion === reportDataVersion) reportServerData[key] = { error: friendlyRpcError(error) };
  }
  finally { reportRequestPending = false; if (state.view === 'reports') render(); }
}
function reportsPage() {
  const [start, end] = dateRangeBounds(); const tabs = [['food_cost', 'Food cost'], ['waste', 'Waste'], ['revenue', 'Revenue & covers'], ['inventory', 'Inventory'], ['production', 'Production']].filter(([tab]) => tab === 'revenue' || tab === 'food_cost' ? canAccessRevenue() : tab === 'inventory' ? ['Administrator', 'Manager', 'Inventory Clerk'].includes(state.role) : tab === 'waste' ? ['Administrator', 'Manager', 'Chef / Kitchen Staff', 'Inventory Clerk'].includes(state.role) : ['Administrator', 'Manager', 'Chef / Kitchen Staff'].includes(state.role));
  if (!tabs.some(([tab]) => tab === state.reportTab)) {
    state.reportTab = tabs[0]?.[0] || 'waste';
    reportRequestKey = '';
  }
  const key = `${state.reportTab}|${start}|${end}|${state.reportGrouping}|${state.reportIncludeWaste}`; const server = reportServerData[key]; const data = server && !server.error ? server : {};
  const rows = data.rows || data.by_ingredient || data.valuation_by_category || []; const invalidDateRange = state.dateRange === 'custom' && (!start || !end || start > end); const loading = reportRequestPending && !server && !invalidDateRange; const error = server?.error; let headers = []; let tableRows = []; let charts = ''; let kpis = '';
  if (state.reportTab === 'food_cost') { headers = ['Period', 'Revenue', 'Food cost', 'Food cost %']; tableRows = rows.map(item => `<tr><td>${item.period}</td><td>${money(item.revenue)}</td><td>${money(item.food_cost)}</td><td class="${item.food_cost_pct > 32 ? 'negative' : 'positive'}">${item.food_cost_pct == null ? '—' : `${Number(item.food_cost_pct).toFixed(1)}%`}</td></tr>`); charts = reportChartPanel('reportFoodCostChart', 'Food cost over time', 'Food cost percentage by reporting period.', rows, 'food_cost_pct', 'period', 'line', '%'); kpis = `${metric('Food cost %', rows.some(item => item.revenue) ? `${(rows.reduce((sum, item) => sum + Number(item.food_cost || 0), 0) / Math.max(rows.reduce((sum, item) => sum + Number(item.revenue || 0), 0), 1) * 100).toFixed(1)}%` : '—', '♨', 'orange-icon', 'Target 32%')}${metric('Confirmed revenue', money(rows.reduce((sum, item) => sum + Number(item.revenue || 0), 0)), '₱', 'green-icon', rows.some(item => item.revenue) ? 'Confirmed rows only' : 'No confirmed revenue in this range')}`; }
  else if (state.reportTab === 'revenue') { headers = ['Period', 'Meal period', 'Adults', 'Children', 'Senior/PWD', 'Covers', 'Revenue', 'Revenue / cover', 'Estimated profit']; tableRows = rows.map(item => `<tr><td>${item.period}</td><td>${esc(item.meal_period)}</td><td>${item.adults}</td><td>${item.children}</td><td>${item.senior_pwd}</td><td>${item.covers}</td><td>${money(item.revenue)}</td><td>${item.covers ? money(item.revenue / item.covers) : '—'}</td><td>${money(Number(item.revenue || 0) - Number(item.production_cost || 0) - Number(item.waste_cost || 0))}</td></tr>`); charts = reportChartPanel('reportRevenueChart', 'Revenue over time', 'Confirmed revenue by reporting period.', rows, 'revenue', 'period', 'line', 'currency'); kpis = `${metric('Revenue', money(rows.reduce((sum, item) => sum + Number(item.revenue || 0), 0)), '₱', 'green-icon', rows.length ? 'Confirmed rows only' : 'No confirmed revenue in this range')}${metric('Covers', rows.reduce((sum, item) => sum + Number(item.covers || 0), 0), '♙', 'purple-icon', `No-shows: ${data.no_show_count || 0}`)}`; }
  else if (state.reportTab === 'waste') {
    headers = ['Ingredient', 'Quantity', 'Waste cost'];
    tableRows = (data.by_ingredient || []).map(item => `<tr><td>${esc(item.name)}</td><td>${item.quantity}</td><td>${money(item.waste_cost)}</td></tr>`);
    const monetaryChartsAllowed = canAccessRevenue();
    charts = monetaryChartsAllowed
      ? `${reportChartPanel('reportWasteTrendChart', 'Waste cost over time', 'Daily waste cost for the selected date range.', data.by_day || [], 'waste_cost', 'period', 'line', 'currency')}${reportChartPanel('reportWasteReasonChart', 'Waste cost by reason', 'Waste cost grouped by recorded reason.', data.by_reason || [], 'waste_cost', 'reason', 'bar', 'currency')}`
      : reportChartPanel('reportWasteQuantityChart', 'Waste quantity by ingredient', 'Quantities are labelled with each ingredient unit.', data.by_ingredient || [], 'quantity', 'name', 'bar', '');
    if (!monetaryChartsAllowed) {
      const quantitySpec = reportChartSpecs[reportChartSpecs.length - 1];
      if (quantitySpec) quantitySpec.rows = quantitySpec.rows.map(item => ({ ...item, name: `${item.name} (${item.unit})` }));
    }
    kpis = `${metric('Waste cost', money((data.by_ingredient || []).reduce((sum, item) => sum + Number(item.waste_cost || 0), 0)), '◌', 'red-icon', `${data.unlinked_count || 0} unlinked entries`)}${metric('Linked to production', data.linked_count || 0, '♨', 'orange-icon', 'Production batches')}`;
  }
  else if (state.reportTab === 'inventory') {
    headers = ['Category', 'Ingredients', 'Valuation'];
    tableRows = (data.valuation_by_category || []).map(item => `<tr><td>${esc(item.category)}</td><td>${item.ingredients}</td><td>${money(item.valuation)}</td></tr>`);
    charts = canAccessRevenue()
      ? reportChartPanel('reportInventoryChart', 'Inventory valuation by category', 'Current stock valuation using latest ingredient costs.', data.valuation_by_category || [], 'valuation', 'category', 'bar', 'currency')
      : reportChartPanel('reportInventoryChart', 'Ingredients by category', 'Ingredient counts by category.', data.valuation_by_category || [], 'ingredients', 'category', 'bar', 'ingredients');
    kpis = `${metric('Inventory valuation', money((data.valuation_by_category || []).reduce((sum, item) => sum + Number(item.valuation || 0), 0)), '◈', 'green-icon', 'Stock × latest cost')}${metric('Low-stock items', (data.low_stock || []).length, '!', 'red-icon', 'Needs replenishment')}`;
  }
  else {
    headers = ['Recipe', 'Batches', 'Production cost', 'Covers produced'];
    tableRows = (data.rows || []).map(item => `<tr><td>${esc(item.recipe)}</td><td>${item.batches}</td><td>${money(item.production_cost)}</td><td>${item.covers_produced || '—'}</td></tr>`);
    charts = reportChartPanel('reportProductionChart', 'Portions produced by dish', 'Recorded portions produced, grouped by dish.', data.rows || [], 'covers_produced', 'recipe', 'bar', 'portions');
    kpis = metric('Batches', (data.rows || []).reduce((sum, item) => sum + Number(item.batches || 0), 0), '♨', 'orange-icon', 'Production logs');
  }
  const exportRows = [headers, ...tableRows.map(row => [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(match => match[1].replace(/<[^>]+>/g, '')))];
  return `${pageHeader('Management insight', 'Reports & analytics', 'Aggregated reports use confirmed revenue only and latest ingredient purchase prices.', `<button class="ghost-btn" data-action="print-report">Print / PDF</button> <button class="secondary-btn" data-action="export-report">Export CSV</button>`)}<div class="report-toolbar"><div class="report-tabs">${tabs.map(([tab, label]) => `<button class="${state.reportTab === tab ? 'active' : ''}" data-report-tab="${tab}">${label}</button>`).join('')}</div>${dateRangeControls()}<label>Group by<select data-report-group><option value="day" ${state.reportGrouping === 'day' ? 'selected' : ''}>Day</option><option value="week" ${state.reportGrouping === 'week' ? 'selected' : ''}>Week</option><option value="month" ${state.reportGrouping === 'month' ? 'selected' : ''}>Month</option></select></label>${state.reportTab === 'food_cost' ? `<label class="filter-check"><input type="checkbox" data-report-waste ${state.reportIncludeWaste ? 'checked' : ''}> Include logged waste</label>` : ''}</div>${invalidDateRange ? '<div class="panel error-state" role="alert">Choose a valid custom date range to view this report.</div>' : loading ? '<div class="panel loading-state">Loading report…</div>' : error ? `<div class="panel error-state">${esc(error)} <button class="ghost-btn" data-action="retry-report">Retry</button></div>` : `<div class="report-disclaimer">Food cost uses latest ingredient costs at report time; production history has no cost snapshot.</div><div class="metric-grid">${kpis}</div><div class="report-chart-grid">${charts}</div><div class="panel report-table-panel">${reportTable(headers, tableRows, state.reportTab === 'revenue' ? 'No confirmed revenue in this range.' : 'No data in this range.')}</div>`}`;
}

document.addEventListener('keydown', event => {
  const dialog = document.querySelector('.modal[role="dialog"]');
  if (!dialog) return;
  if (event.key === 'Escape') { event.preventDefault(); document.querySelector('#modalRoot').innerHTML = ''; return; }
  if (event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(item => !item.disabled);
  if (!focusable.length) return;
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
document.addEventListener('click', event => {
  const confirmButton = event.target.closest('[data-action="confirm-reservation"]');
  if (confirmButton) {
    if (!canAccess('reservations')) return toast('Your role cannot confirm reservations.', 'error');
    const reservation = all('reservations').find(item => item.id === confirmButton.dataset.id);
    if (!reservation || reservation.status !== 'Pending') {
      toast('This reservation is no longer pending.', 'error');
      render();
      return;
    }
    saveRecord('reservations', { ...reservation, status: 'Confirmed' })
      .then(() => { toast(`Reservation for ${reservation.name} confirmed.`); render(); })
      .catch(error => toast(friendlyRpcError(error), 'error'));
    return;
  }
  const calendarDate = event.target.closest('[data-calendar-date]');
  if (calendarDate) { state.calendarDate = calendarDate.dataset.calendarDate; state.reservationDateFilter = 'All'; state.reservationMealPeriodFilter = 'All'; state.query = ''; persistReservationFilters(); render(); return; }
  const calendarMonth = event.target.closest('[data-calendar-month]');
  if (calendarMonth) {
    const date = new Date(`${state.calendarDate || today()}T12:00:00`);
    date.setDate(1);
    date.setMonth(date.getMonth() + Number(calendarMonth.dataset.calendarMonth));
    state.calendarDate = localDateStr(date);
    state.query = '';
    render();
    return;
  }
  if (event.target.closest('[data-calendar-today]')) { state.calendarDate = today(); state.reservationDateFilter = 'All'; state.reservationMealPeriodFilter = 'All'; state.query = ''; persistReservationFilters(); render(); return; }
  const filter = event.target.closest('[data-reservation-filter]');
  if (filter) { state.reservationFilter = filter.dataset.reservationFilter; state.query = ''; persistReservationFilters(); render(); return; }
  const typeFilter = event.target.closest('[data-reservation-type-filter]');
  if (typeFilter) { state.reservationTypeFilter = typeFilter.dataset.reservationTypeFilter; state.query = ''; persistReservationFilters(); render(); return; }
  const dateFilter = event.target.closest('[data-reservation-date-filter]');
  if (dateFilter) { state.reservationDateFilter = dateFilter.dataset.reservationDateFilter; if (state.reservationDateFilter === 'Today') state.calendarDate = today(); persistReservationFilters(); render(); return; }
  const step = event.target.closest('[data-calendar-step]');
  if (step) { const date = new Date(`${state.calendarDate || today()}T12:00:00`); date.setDate(date.getDate() + Number(step.dataset.calendarStep)); state.calendarDate = localDateStr(date); render(); return; }
});
document.addEventListener('change', event => {
  if (event.target.id === 'calendarDate') { state.calendarDate = event.target.value; render(); }
  if (event.target.matches('[data-reservation-calendar-filter]')) {
    if (event.target.dataset.reservationCalendarFilter === 'status') state.reservationCalendarStatus = event.target.value;
    if (event.target.dataset.reservationCalendarFilter === 'type') state.reservationCalendarType = event.target.value;
    if (reservationCalendar) reservationCalendar.refetchEvents();
    return;
  }
  if (event.target.id === 'tableSearch') { state.query = event.target.value; render(); }
  if (event.target.matches('[data-user-role]')) {
    const control = event.target;
    const userId = control.dataset.userRole;
    const previous = all('users').find(item => item.id === userId)?.role;
    if (!confirm(`Change this user's role to ${control.value}?`)) {
      control.value = previous || control.value;
      return;
    }
    window.supabaseClient.from('profiles').update({ role: control.value }).eq('id', userId).then(({ error }) => {
      if (error) {
        control.value = previous || control.value;
        toast(friendlyRpcError(error), 'error');
        return;
      }
      toast('User role updated.');
      return syncWithSupabase();
    }).catch(error => {
      control.value = previous || control.value;
      toast(friendlyRpcError(error), 'error');
    });
  }
});
document.addEventListener('input', event => {
  if (event.target.closest('#modalForm')) state.modalDirty = true;
  if (event.target.id === 'reservationCalendarSearch') {
    state.reservationCalendarQuery = event.target.value;
    if (reservationCalendar) reservationCalendar.refetchEvents();
  }
  if (event.target.closest('#modalForm[data-type="waste"]')) updateWasteFormPreview(event.target.closest('#modalForm'));
  if (event.target.closest('#modalForm[data-type="receiving"]')) updateReceivingTotals(event.target.closest('#modalForm'));
  if (event.target.name === 'partySize' && event.target.closest('#modalForm[data-type="walk-in"]')) refreshWalkInTables(event.target.closest('#modalForm'));
  if (event.target.closest('#modalForm[data-type="revenue"]')) updateRevenuePreview(event.target.closest('#modalForm'));
  if (event.target.matches('[data-custom-portions]')) {
    event.target.closest('.production-dish-card')?.querySelector('[data-use-custom-portions="true"]')?.removeAttribute('data-request-id');
  }
  if (event.target.id === 'tableSearch') { state.query = event.target.value; render(); document.querySelector('#tableSearch')?.focus(); }
});
window.addEventListener('beforeunload', event => {
  if (!state.modalDirty) return;
  event.preventDefault();
  event.returnValue = '';
});
window.addEventListener('hashchange', () => {
  const view = window.location.hash.slice(1);
  if (!view) return;
  state.view = canAccess(view) ? view : (roleAccess[state.role]?.[0] || 'dashboard');
  state.focusPageAfterNavigation = true;
  if (state.view === 'reservations') state.reservationMealPeriodFilter = 'All';
  if (state.view !== view) window.history.replaceState(null, '', `#${state.view}`);
  syncActiveSidebarGroup(state.view);
  closeShellPopovers(false);
  closeMobileDrawer(false);
  render();
});

document.addEventListener('click', event => {
  const reportTab = event.target.closest('[data-report-tab]');
  if (reportTab) { state.reportTab = reportTab.dataset.reportTab; reportRequestKey = ''; render(); return; }
  if (event.target.closest('[data-action="retry-report"]')) { const [start, end] = dateRangeBounds(); delete reportServerData[`${state.reportTab}|${start}|${end}|${state.reportGrouping}|${state.reportIncludeWaste}`]; reportRequestKey = ''; render(); return; }
  if (event.target.closest('[data-action="print-report"]')) { window.print(); return; }
  if (event.target.closest('[data-action="export-report"]')) {
    const [start, end] = dateRangeBounds(); const key = `${state.reportTab}|${start}|${end}|${state.reportGrouping}|${state.reportIncludeWaste}`; const data = reportServerData[key]; if (!data || data.error) { toast('This report is not available until the server data loads successfully.', 'error'); return; } const rows = data.rows || data.by_ingredient || data.valuation_by_category || []; reportExport([Object.keys(rows[0] || {}), ...rows.map(item => Object.values(item))], state.reportTab); return;
  }
  const backdrop = event.target.classList.contains('modal-backdrop');
  if (backdrop) document.querySelector('#modalRoot').innerHTML = '';
  const clear = event.target.closest('[data-action="clear-filters"]');
  if (clear) { state.query = ''; state.ingredientStatus = 'All'; state.ingredientCategory = 'All'; state.ingredientUnit = 'All'; render(); }
  const exportToggle = event.target.closest('[data-action="toggle-export"]');
  if (exportToggle) document.querySelector('.export-options')?.classList.toggle('is-hidden');
  const exportButton = event.target.closest('[data-export]');
  if (exportButton) {
    const format = exportButton.dataset.export;
    document.querySelector('.export-options')?.classList.add('is-hidden');
    if (format === 'PDF') { window.print(); toast('Print dialog opened for PDF export'); }
    else {
      try {
        exportRecipeReport(format);
        toast(`${format} export downloaded`);
      } catch (error) {
        console.error('Report export failed.', error);
        toast(error.message || 'Report export failed.', 'error');
      }
    }
  }
  const toggleIngredients = event.target.closest('[data-action="toggle-ingredient-view"]');
  if (toggleIngredients) { state.ingredientView = state.ingredientView === 'cards' ? 'table' : 'cards'; localStorage.setItem('costtrack_ingredient_view', state.ingredientView); render(); return; }
  const sortIngredient = event.target.closest('[data-sort-ingredient]');
  if (sortIngredient) { const key = sortIngredient.dataset.sortIngredient; state.ingredientSortDirection = state.ingredientSort === key && state.ingredientSortDirection === 'asc' ? 'desc' : 'asc'; state.ingredientSort = key; render(); return; }
});

document.addEventListener('click', event => {
  const addLine = event.target.closest('[data-action="add-receiving-line"]');
  const removeLine = event.target.closest('[data-action="remove-receiving-line"]');
  if (!addLine && !removeLine) return;
  event.preventDefault();
  const form = document.querySelector('#modalForm[data-type="receiving"]');
  if (!form) return;
  readReceivingDraft(form);
  if (addLine) {
    if (state.receivingDraft.length >= 50) return toast('A delivery can have no more than 50 product lines.', 'error');
    state.receivingDraft.push(emptyReceivingLine());
  } else {
    const index = Number(removeLine.dataset.index);
    if (state.receivingDraft.length <= 1 || !Number.isInteger(index)) return;
    state.receivingDraft.splice(index, 1);
  }
  renderReceivingModal();
  state.modalDirty = true;
  if (addLine) {
    const lastLine = document.querySelector('.receipt-line:last-child [data-field="ingredientId"]');
    requestAnimationFrame(() => lastLine?.focus());
  }
});

document.addEventListener('click', async event => {
  const category = event.target.closest('[data-production-category]')?.dataset.productionCategory;
  if (category) {
    state.productionCategory = category;
    render();
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'apply-waste-filters') {
    const filterValues = Object.fromEntries([...document.querySelectorAll('[data-waste-filter]')].map(control => [control.dataset.wasteFilter, control.value]));
    if (filterValues.from && filterValues.to && filterValues.from > filterValues.to) return toast('The start date must be before or the same as the end date.', 'error');
    if (filterValues.timeFrom && filterValues.timeTo && filterValues.timeFrom > filterValues.timeTo) return toast('The start time must be before or the same as the end time.', 'error');
    Object.assign(state.wasteFilters, filterValues);
    render();
    return;
  }
  if (action === 'clear-waste-filters') {
    state.wasteFilters = { from: '', to: '', timeFrom: '', timeTo: '', ingredient: 'All', reason: 'All', staff: 'All' };
    state.query = '';
    render();
    return;
  }
  if (action === 'toggle-production-history') {
    state.productionHistoryOpen = !state.productionHistoryOpen;
    if (state.productionHistoryOpen) {
      state.productionHistory.from ||= today();
      state.productionHistory.to ||= today();
    }
    render();
    if (state.productionHistoryOpen) await loadProductionHistory();
    return;
  }
  if (action === 'apply-production-history') {
    const filterValues = Object.fromEntries([...document.querySelectorAll('[data-history-filter]')].map(control => [control.dataset.historyFilter, control.value]));
    if (!filterValues.from || !filterValues.to || filterValues.from > filterValues.to) return toast('Choose a valid production history date range.', 'error');
    const startDate = new Date(`${filterValues.from}T12:00:00`);
    const endDate = new Date(`${filterValues.to}T12:00:00`);
    if ((endDate - startDate) / 86400000 > 90) return toast('Choose a date range of no more than 91 days.', 'error');
    if (filterValues.timeFrom && filterValues.timeTo && filterValues.timeFrom > filterValues.timeTo) return toast('The activity start time must be before the end time.', 'error');
    Object.assign(state.productionHistory, filterValues, { loaded: state.productionHistory.from === filterValues.from && state.productionHistory.to === filterValues.to ? state.productionHistory.loaded : false });
    render();
    await loadProductionHistory();
    return;
  }
  if (action === 'retry-production-history') {
    state.productionHistory.loaded = false;
    await loadProductionHistory(true);
    return;
  }
  if (action === 'retry-production-board') {
    state.productionBoard.loaded = false;
    await loadProductionBoard(true);
    return;
  }
  const start = event.target.closest('[data-start-production]');
  if (start) {
    if (!window.CostTrackLogic.canPerformInventoryAction(state.role, 'production.log')) {
      return toast('You do not have permission to start production batches.', 'error');
    }
    const card = start.closest('.production-dish-card');
    const recipeId = start.dataset.startProduction;
    const portions = start.dataset.useCustomPortions === 'true'
      ? Number(card?.querySelector('[data-custom-portions]')?.value)
      : Number(start.dataset.portions);
    if (!Number.isInteger(portions) || portions < 1 || portions > 10000) return toast('Enter a whole number of portions between 1 and 10,000.', 'error');
    if (!recipe(recipeId)) return toast('This recipe is no longer available.', 'error');
    start.disabled = true;
    if (!start.dataset.requestId) start.dataset.requestId = `BATCH-${window.crypto?.randomUUID?.() || id('QUEUE')}`;
    const batchRequests = [{ id: start.dataset.requestId, portions }];
    try {
      await window.supabaseRecord.startProductionBatches(recipeId, today(), batchRequests);
      invalidateReportData();
      delete start.dataset.requestId;
      const refreshed = await loadProductionBoard(true);
      toast(refreshed ? `Batch started: ${portions} portions of ${recipe(recipeId)?.name || 'this dish'}.` : 'The batch was started, but the queue could not refresh. Use Try again to reload it.', refreshed ? 'success' : 'error');
    } catch (error) {
      console.error('Production batch start failed.', error);
      toast(friendlyRpcError(error), 'error');
    } finally {
      if (start.isConnected) start.disabled = false;
    }
    return;
  }
  const ready = event.target.closest('[data-ready-production]');
  if (ready) {
    if (!window.CostTrackLogic.canPerformInventoryAction(state.role, 'production.log')) {
      return toast('You do not have permission to complete production batches.', 'error');
    }
    ready.disabled = true;
    try {
      const completed = await window.supabaseRecord.completeProductionBatch(ready.dataset.readyProduction);
      invalidateReportData();
      try {
        await Promise.all([
          loadProductionBoard(true),
          refetchCollection('productionLogs'),
          ...(state.productionHistoryOpen ? [loadProductionHistory(true)] : [])
        ]);
      } catch (refreshError) {
        console.error('A completed batch could not refresh all production data.', refreshError);
      }
      toast(`Batch #${completed.batch_number} marked ready. Inventory was updated.`, 'success');
    } catch (error) {
      console.error('Production batch completion failed.', error);
      toast(friendlyRpcError(error), 'error');
    } finally {
      if (ready.isConnected) ready.disabled = false;
    }
  }
});

document.addEventListener('submit', async event => {
  if (event.target.getAttribute('id') !== 'modalForm') return;
  event.preventDefault();
  const form = event.target; clearFieldErrors(form);
  let valid = true;
  form.querySelectorAll('[required]').forEach(control => {
    if (!String(control.value).trim()) { showFieldError(control, 'This field is required.'); valid = false; }
  });
  form.querySelectorAll('input[type="number"]').forEach(control => {
    if (control.value !== '' && (!Number.isFinite(Number(control.value)) || Number(control.value) < Number(control.min || 0))) { showFieldError(control, `Enter a number of ${control.min && Number(control.min) > 0 ? 'at least ' + control.min : 'zero or more'}.`); valid = false; }
    if (['batchYield', 'prepTarget'].includes(control.name) && control.value !== '' && !Number.isInteger(Number(control.value))) { showFieldError(control, 'Enter a whole number.'); valid = false; }
    if (form.dataset.type === 'revenue' && ['adult_customers', 'child_customers', 'senior_pwd_customers'].includes(control.name) && !Number.isInteger(Number(control.value))) { showFieldError(control, 'Enter a whole number of customers.'); valid = false; }
  });
  if (form.dataset.type === 'bill') {
    const countNames = ['adultCount', 'seniorCount', 'kidsCount', 'compedCount'];
    const counts = countNames.map(name => Number(form.elements[name]?.value || 0));
    if (counts.some(count => !Number.isInteger(count) || count < 0) || counts.reduce((sum, count) => sum + count, 0) > 1000) {
      showFieldError(form.elements.adultCount, 'Head counts must be whole numbers totaling no more than 1,000.');
      valid = false;
    }
    if (form.elements.discountId.value && !form.elements.discountReason.value.trim()) {
      showFieldError(form.elements.discountReason, 'A reason is required for every discount.');
      valid = false;
    }
    form.querySelectorAll('[data-extra-line]').forEach(line => {
      const charge = line.querySelector('[name="extraChargeItemId"]');
      const quantity = line.querySelector('[name="extraQuantity"]');
      if (charge.value && (!quantity.value || Number(quantity.value) <= 0)) {
        showFieldError(quantity, 'Enter a quantity greater than zero for this extra.');
        valid = false;
      }
    });
    const hasExtra = [...form.querySelectorAll('[data-extra-line]')]
      .some(line => Boolean(line.querySelector('[name="extraChargeItemId"]').value));
    if (counts.reduce((sum, count) => sum + count, 0) === 0 && !hasExtra) {
      toast('Enter at least one guest or extra charge.', 'error');
      valid = false;
    }
  }
  if (form.dataset.type === 'receiving') {
    const receivedDate = form.elements.receivedDate.value;
    form.querySelectorAll('.receipt-line').forEach(line => {
      const quantity = line.querySelector('[data-field="quantity"]');
      const unitCost = line.querySelector('[data-field="unitCost"]');
      const expiration = line.querySelector('[data-field="expirationDate"]');
      const product = ingredient(line.querySelector('[data-field="ingredientId"]').value);
      if (quantity.value && Number(quantity.value) !== Number(Number(quantity.value).toFixed(4))) {
        showFieldError(quantity, 'Use up to 4 decimal places to match the inventory unit.');
        valid = false;
      }
      if (unitCost.value && Number(unitCost.value) !== Number(Number(unitCost.value).toFixed(6))) {
        showFieldError(unitCost, 'Use up to 6 decimal places for unit cost.');
        valid = false;
      }
      if (product?.trackExpiry && !expiration.value) {
        showFieldError(expiration, 'An expiration date is required for this product.');
        valid = false;
      }
      if (expiration.value && receivedDate && expiration.value < receivedDate) {
        showFieldError(expiration, 'Expiration cannot be before the received date.');
        valid = false;
      }
    });
  }
  if (form.dataset.type === 'revenue' && ['adult_customers', 'child_customers', 'senior_pwd_customers'].reduce((sum, name) => sum + Number(form.elements[name]?.value || 0), 0) < 1) { showFieldError(form.elements.adult_customers, 'At least one customer is required.'); valid = false; }
  if (form.dataset.type === 'waste') {
    const quantity = Number(form.elements.quantity.value);
    const product = ingredient(form.elements.ingredientId.value);
    if (form.elements.quantity.value && quantity !== Number(quantity.toFixed(4))) {
      showFieldError(form.elements.quantity, 'Use up to 4 decimal places to match the inventory unit.');
      valid = false;
    }
    if (quantity > 1000000) {
      showFieldError(form.elements.quantity, 'Quantity cannot exceed 1,000,000.');
      valid = false;
    }
    if (product && quantity > Number(product.stock)) {
      showFieldError(form.elements.quantity, `Only ${Number(product.stock)} ${product.unit} is currently in stock.`);
      valid = false;
    }
    if (form.elements.reason.value === 'Other' && !form.elements.notes.value.trim()) {
      showFieldError(form.elements.notes, 'Add a short explanation for the Other reason.');
      valid = false;
    }
  }
  if (!valid) { event.stopImmediatePropagation(); form.querySelector('.has-error input, .has-error select, .has-error textarea')?.focus(); return; }
  if (form.dataset.type === 'waste') {
    const product = ingredient(form.elements.ingredientId.value);
    const quantity = Number(form.elements.quantity.value);
    const costText = ['Administrator', 'Manager'].includes(state.role)
      ? `\nEstimated cost: ${money(quantity * Number(product?.cost || 0))}`
      : '';
    const linkedLog = all('productionLogs').find(log => log.id === form.elements.productionLogId.value);
    const linkedRecipe = linkedLog ? recipe(linkedLog.recipeId)?.name : '';
    if (!confirm(`Record ${quantity} ${product?.unit || ''} of ${product?.name || 'this ingredient'} as ${form.elements.reason.value}?${linkedRecipe ? `\nRelated dish: ${linkedRecipe}` : ''}\nStock will decrease once from ${Number(product?.stock || 0)} to ${Number((Number(product?.stock || 0) - quantity).toFixed(4))} ${product?.unit || ''}.${costText}`)) return;
  }
  event.stopImmediatePropagation();
  const submit = form.querySelector('.modal-submit'); submit.disabled = true; submit.classList.add('is-loading'); submit.setAttribute('aria-busy', 'true'); submit.textContent = 'Saving…';
  if (form.dataset.type === 'confirm-revenue') {
    const data = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Confirming…';
    try {
      await window.supabaseRecord.confirmRevenue(form.dataset.id, {
        adult_customers: Number(data.adult_customers),
        child_customers: Number(data.child_customers),
        senior_pwd_customers: Number(data.senior_pwd_customers)
      });
      invalidateReportData();
      state.modalDirty = false;
      closeModal();
      toast('Revenue draft confirmed.');
      await syncWithSupabase();
    } catch (error) {
      console.error('Revenue confirmation failed.', error);
      submit.disabled = false;
      submit.textContent = 'Confirm revenue';
      toast(friendlyRpcError(error), 'error');
    }
    return;
  }
  handleSubmit(form);
}, true);
