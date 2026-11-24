const KEYS = ['ingredients', 'recipes', 'inventoryTransactions', 'inventoryBatches', 'productionLogs', 'revenueRecords', 'wasteLogs', 'preparedFoodWasteLogs', 'physicalCounts', 'users', 'reservations', 'restaurantTables', 'buffetRates', 'chargeItems', 'chargeItemVariants', 'packageTiers', 'packageInclusions', 'discounts', 'posSettings', 'shifts', 'cashMovements', 'posBills', 'billLines', 'billPayments', 'reservationDeposits', 'billApprovals', 'posNotifications', 'notifications', 'auditLogs'];
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
  notificationCenterFilter: 'All',
  notificationCenterQuery: '',
  notificationCenterPage: 1,
  sidebarFlyoutGroup: null,
  paletteItems: [],
  paletteSelection: 0,
  focusPageAfterNavigation: false,
  notificationReadKeys: [],
  notificationViewAll: false,
  notificationMarkingRead: false
};
let modalOpener = null;
let invitationAcceptanceMode = window.costTrackInviteLink === true;
let passwordRecoveryMode = invitationAcceptanceMode
  || new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
let supabaseSyncEnabled = false;
let realtimeChannel = null;
let realtimeSubscriptionKey = '';
const realtimeRefreshTimers = new Map();
let realtimeConnected = false;
let realtimeNeedsResync = false;
let realtimeConfigPromise = null;
let realtimeRequestedKey = '';
let reservationCalendar = null;
let lastSavedAt = null;
const recentLocalChanges = new Set();
const collectionState = Object.fromEntries(KEYS.map(key => [key, []]));
state.ingredientStatus = 'All';
state.ingredientExpiryFilter = false;
state.ingredientCategory = 'All';
state.ingredientUnit = 'All';
state.recipeCategory = 'All';
state.recipeDraft = [];
state.productionQueueTab = 'in-progress';
state.productionCategoryFilter = 'All';
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
state.reservationSourceFilter = 'All';
const reservationSourceFilterValues = ['All', 'Website', 'Phone', 'Facebook', 'Walk-in', 'Other', 'Unspecified'];
state.unresolvedBookings = { rows: [], loading: false, loaded: false, error: '' };
state.unresolvedFocusId = '';
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
state.revenueStatus = 'Active';
state.ingredientView = localStorage.getItem('costtrack_ingredient_view') || 'cards';
state.ingredientSort = 'name';
state.ingredientSortDirection = 'asc';
state.reservationMealPeriodFilter = 'All';
state.reservationDateFilter = 'All';
state.dateRange = '7';
state.modalDirty = false;
state.billWizard = {
  screen: 1,
  filter: localStorage.getItem('costtrack_bill_party_filter') || 'All',
  query: '',
  reservationId: '',
  billId: '',
  countsEditing: false,
  countsConfirmed: false,
  countBaseline: { adultCount: 0, seniorCount: 0, kidsCount: 0, compedCount: 0 },
  adultCount: 0,
  seniorCount: 0,
  kidsCount: 0,
  compedCount: 0,
  extraLines: [],
  discountId: '',
  discountReason: '',
  chargeExtraPax: false,
  notes: '',
  savedBill: null,
  savedLines: [],
  closePreview: null,
  previewError: '',
  tenderedAmount: '',
  paymentKey: ''
};
state.reportTab = state.reportTab || 'food_cost';
state.reportGrouping = state.reportGrouping || 'day';
state.reportIncludeWaste = state.reportIncludeWaste !== false;
state.reportPage = 1;
state.tablePages = {};
state.tablePageSize = 10;
state.userInviteHistory = { rows: [], loading: false, loaded: false, error: '' };
state.verificationRecordHistory = {
  rows: [], loading: false, loaded: false, error: '', search: '', loadedSearch: ''
};
state.userManagementPane = 'home';
state.userManagementTab = 'staff';
state.applicantReviewStep = 1;
state.applicantReviewRole = '';
state.applicantReviewRoleError = false;
state.applicantReviewInviteError = '';
state.userManagementStatus = 'All';
state.userManagementRole = 'All';
state.userManagementSearch = '';
state.userManagementBusyId = '';
state.userManagementBusyAction = '';
state.userManagementRefreshLoading = false;
state.userManagementRefreshError = '';
state.userManagementRefreshSaved = false;
let userInviteRequestId = 0;
let verificationRecordRequestId = 0;
let verificationRecordSearchTimer = 0;
const userInvitationVerificationDrafts = new WeakMap();
const reportServerData = {};
const reportPendingRequests = new Set();
const reportDataVersions = new Map();
const reportTabsBySource = {
  ingredients: ['food_cost', 'waste', 'inventory', 'production'],
  recipes: ['food_cost', 'production'],
  recipe_ingredients: ['food_cost', 'production'],
  production_logs: ['food_cost', 'production'],
  waste_logs: ['food_cost', 'waste'],
  pos_bills: ['daily_revenue', 'revenue_trend', 'customer_count', 'shift_revenue', 'closed_bill_summary', 'food_cost'],
  pos_bill_lines: ['daily_revenue', 'revenue_trend', 'customer_count', 'shift_revenue', 'closed_bill_summary', 'food_cost'],
  pos_bill_payments: ['daily_revenue', 'revenue_trend', 'customer_count', 'shift_revenue', 'closed_bill_summary', 'food_cost'],
  pos_shifts: ['shift_revenue'],
  pos_cash_movements: ['shift_revenue'],
  pos_reservation_deposits: ['shift_revenue']
};
const reportRevenueSources = new Set([
  'pos_bills', 'pos_bill_lines', 'pos_bill_payments', 'pos_shifts',
  'pos_cash_movements', 'pos_reservation_deposits'
]);
const reportSourceAliases = {
  productionLogs: 'production_logs',
  preparedFoodWasteLogs: 'prepared_food_waste_logs',
  wasteLogs: 'waste_logs',
  recipeIngredients: 'recipe_ingredients',
  billLines: 'pos_bill_lines',
  billPayments: 'pos_bill_payments',
  reservationDeposits: 'pos_reservation_deposits',
  cashMovements: 'pos_cash_movements',
  shifts: 'pos_shifts'
};
let revenueDashboardData = null;
let revenueDashboardLoading = false;
let revenueDashboardError = '';
let revenueDashboardRequest = 0;
let revenueDashboardRefreshAfterLoad = false;
let reportChartSpecs = [];
let reportCharts = [];
try {
  const savedReservationFilters = JSON.parse(sessionStorage.getItem('costtrack_reservation_filters') || 'null');
  if (savedReservationFilters) Object.assign(state, savedReservationFilters);
} catch (error) {
  console.warn('Reservation filter preferences could not be restored.', error);
}
if (!['Lunch', 'Dinner'].includes(state.reservationMealPeriodFilter)) state.reservationMealPeriodFilter = 'All';
if (!reservationSourceFilterValues.includes(state.reservationSourceFilter)) state.reservationSourceFilter = 'All';
if (!['status', 'type', 'meal', 'date', 'source'].includes(state.reservationFilterHighlightGroup)) state.reservationFilterHighlightGroup = 'status';
function persistReservationFilters() {
  sessionStorage.setItem('costtrack_reservation_filters', JSON.stringify({
    reservationFilter: state.reservationFilter,
    reservationTypeFilter: state.reservationTypeFilter,
    reservationSourceFilter: state.reservationSourceFilter,
    reservationMealPeriodFilter: state.reservationMealPeriodFilter,
    reservationDateFilter: state.reservationDateFilter,
    reservationFilterHighlightGroup: state.reservationFilterHighlightGroup
  }));
}
const roleAccess = {
  'Administrator': ['dashboard', 'notifications', 'activity-logs', 'ingredients', 'receiving', 'recipes', 'production', 'waste', 'counts', 'reports', 'revenue', 'rates', 'users', 'reservations', 'calendar', 'tables', 'cashier', 'shifts', 'approvals', 'charge-catalog'],
  'Manager': ['dashboard', 'notifications', 'activity-logs', 'ingredients', 'receiving', 'recipes', 'production', 'waste', 'counts', 'reports', 'revenue', 'rates', 'reservations', 'calendar', 'tables', 'cashier', 'shifts', 'approvals', 'charge-catalog'],
  'Inventory Clerk': ['dashboard', 'notifications', 'activity-logs', 'ingredients', 'receiving', 'counts', 'reports'],
  'Chef / Kitchen Staff': ['dashboard', 'notifications', 'activity-logs', 'recipes', 'production', 'waste', 'reports'],
  'Receptionist': ['dashboard', 'notifications', 'activity-logs', 'reservations', 'calendar', 'tables', 'cashier', 'shifts', 'approvals']
};
const canAccess = view => Boolean(roleAccess[state.role]?.includes(view));
const canAccessRevenue = () => ['Administrator', 'Manager'].includes(state.role);
const canManageRates = () => ['Administrator', 'Manager'].includes(state.role);
const app = document.querySelector('#app');
const money = value => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const manilaBusinessToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
function formatOperationalDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}
function shiftOpenedOnDate(shift, businessDate) {
  if (!shift?.openedAt) return false;
  const date = new Date(shift.openedAt);
  if (Number.isNaN(date.getTime())) return false;
  const openedDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
  return openedDate === businessDate;
}

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
  const end = manilaBusinessToday();
  const startDate = new Date(`${end}T12:00:00`);
  startDate.setDate(startDate.getDate() - days + 1);
  return [localDateStr(startDate), end];
}

function reportGroupingFor(tab) {
  return tab === 'daily_revenue' ? 'day' : state.reportGrouping;
}

function reportDataKey(tab, start, end, page = state.reportPage) {
  return `${tab}|${start}|${end}|${reportGroupingFor(tab)}|${state.reportIncludeWaste}|${page}`;
}

function dateRangeControls() {
  const custom = state.dateRange === 'custom';
  return `<label>Date range<select data-date-range aria-label="Report date range"><option value="7" ${state.dateRange === '7' ? 'selected' : ''}>Last 7 days</option><option value="30" ${state.dateRange === '30' ? 'selected' : ''}>Last 30 days</option><option value="90" ${state.dateRange === '90' ? 'selected' : ''}>Last 90 days</option><option value="365" ${state.dateRange === '365' ? 'selected' : ''}>Last year</option><option value="custom" ${custom ? 'selected' : ''}>Custom range</option></select></label>${custom ? `<label>From<input type="date" data-custom-date="from" value="${esc(state.customDateFrom || '')}" required></label><label>To<input type="date" data-custom-date="to" value="${esc(state.customDateTo || '')}" required></label>` : ''}`;
}

function parseTime12h(timeStr) {
  return window.CostTrackLogic.parseReservationTime(timeStr);
}
function liveTableAvailability(table, date = today(), reservations = all('reservations'), now = new Date()) {
  const availability = window.CostTrackLogic.tableAvailability(
    table,
    reservations,
    date,
    today(),
    now.getHours() * 60 + now.getMinutes(),
    now
  );
  if (availability.status === 'Available' && table.status === 'Needs cleaning') {
    return { ...availability, status: 'Needs cleaning' };
  }
  return availability;
}
const read = key => collectionState[key] || [];
function currentUserName() {
  return state.user?.full_name?.trim() || state.user?.email || 'Signed-in user';
}
function staffDisplayName(userId, fallback = 'Staff member') {
  if (!userId) return fallback;
  if (String(userId) === String(state.user?.id)) return 'You';
  const user = all('users').find(item => String(item.id) === String(userId));
  const name = user?.name || user?.full_name;
  return typeof name === 'string' && name.trim() ? name.trim() : fallback;
}
function currentUserInitials() {
  return currentUserName().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'U';
}
function dashboardGreeting() {
  const firstName = currentUserName().split(/[\s@._-]+/).filter(Boolean)[0];
  return firstName ? `Good morning, ${esc(firstName)}.` : 'Welcome to ROMS.';
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
    const refreshCollections = touched.includes('wasteLogs')
      ? [...new Set([...touched, 'ingredients'])]
      : touched;
    const outcome = await window.CostTrackLogic.saveThenRefresh(async () => {
      for (const key of touched) {
        const oldRecords = new Map(previous[key].map(record => [String(record.id), record]));
        const newRecords = new Map(changes[key].map(record => [String(record.id), record]));
        for (const recordId of [...oldRecords.keys()].filter(value => !newRecords.has(value))) {
          await window.supabaseRecord.remove(key, recordId, window.supabaseRecord.version(key, recordId));
        }
        const savedRecords = new Map();
        for (const record of changes[key].filter(value => JSON.stringify(oldRecords.get(String(value.id))) !== JSON.stringify(value))) {
          const saved = await window.supabaseRecord.upsert(key, record, window.supabaseRecord.version(key, record.id));
          if (saved) savedRecords.set(String(record.id), saved);
        }
        collectionState[key] = changes[key].map(record => savedRecords.get(String(record.id)) || record);
      }
      if (touched.some(key => ['reservations', 'restaurantTables', 'posBills', 'reservationDeposits'].includes(key))) {
        invalidateUnresolvedBookings();
      }
      invalidateReportData(touched);
      setPostSaveSyncState();
      render();
      return touched;
    }, () => refreshSavedCollections(refreshCollections), error => showSaveRefreshWarning(refreshCollections, error));
    return outcome.saved;
  } catch (error) {
    console.error('Cloud write failed.', error);
    setSyncState(navigator.onLine ? 'error' : 'offline', error.message);
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
    const outcome = await window.CostTrackLogic.saveThenRefresh(async () => {
      const saved = await window.supabaseRecord.upsert(key, record);
      upsertLocalRecord(key, saved || record);
      setPostSaveSyncState();
      render();
      return saved || record;
    }, () => refreshSavedCollections([key]), error => showSaveRefreshWarning([key], error));
    return outcome.saved;
  } catch (error) {
    console.error(`Single-record save failed for ${key}.`, error);
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
    invalidateReportData([key]);
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
    const outcome = await window.CostTrackLogic.saveThenRefresh(async () => {
      const saved = await window.supabaseRecord.receiveDelivery(payload);
      invalidateReportData(touched);
      setPostSaveSyncState();
      render();
      return saved;
    }, () => refreshSavedCollections(touched), error => showSaveRefreshWarning(touched, error));
    return outcome.saved;
  } catch (error) {
    console.error('Delivery invoice save failed.', error);
    setSyncState(navigator.onLine ? 'error' : 'offline', error.message);
    toast(navigator.onLine ? friendlyRpcError(error) : 'You are offline. Reconnect to save.', 'error');
    render();
    throw error;
  }
}
const all = key => read(key);
function upsertLocalRecord(collection, record) {
  if (!record) return;
  const records = read(collection);
  const existingIndex = records.findIndex(item => String(item.id) === String(record.id));
  collectionState[collection] = existingIndex < 0
    ? [record, ...records]
    : records.map(item => String(item.id) === String(record.id) ? record : item);
}
function replaceLocalRelatedRecords(collection, matches, records) {
  collectionState[collection] = [
    ...read(collection).filter(record => !matches(record)),
    ...records
  ];
}
const ingredient = id => all('ingredients').find(item => item.id === id);
const recipe = id => all('recipes').find(item => item.id === id);
const id = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
function computedRecipeCost(item) { return window.CostTrackLogic.computedRecipeCost(item, all('ingredients')); }
function recipeCostBreakdown(item) { return window.CostTrackLogic.recipeCostBreakdown(item, all('ingredients')); }
function recipePortionCost(item) { return recipeCostBreakdown(item).costPerPortion; }
function inventoryValue() { return all('ingredients').reduce((sum, item) => sum + item.stock * item.cost, 0); }
function productionCost(date) {
  return all('productionLogs').filter(item => !date || item.date === date).reduce((sum, item) => {
    return sum + window.CostTrackLogic.productionLogCost(
      item,
      recipe(item.recipeId) || { ingredients: [] },
      all('ingredients')
    );
  }, 0);
}
function wasteCost(date) { return all('wasteLogs').filter(item => !date || item.date === date).reduce((sum, item) => sum + item.quantity * (ingredient(item.ingredientId)?.cost || 0), 0); }
function revenueRecords() { return canAccessRevenue() ? all('revenueRecords') : []; }
function reservationRevenue(item, rates) { return window.CostTrackLogic.reservationRevenue(item, rates); }
function reservationCategoryCount(item) {
  const seniorPwdCount = Number(item.seniorPwdCount ?? item.senior_pwd_count ?? 0);
  const children = Number(item.children || 0);
  if (item.adults != null) {
    const total = Number(item.adults) + seniorPwdCount + children;
    return total || Number(item.guests || 0);
  }
  if (item.guests != null) return Number(item.guests);
  return seniorPwdCount + children;
}
function reservationGuestCount(item) {
  return Number(item.actualCovers || item.guests || reservationCategoryCount(item));
}
function buffetRevenue(date = today()) {
  return all('reservations')
    .filter(item => item.date === date && item.status !== 'Cancelled' && item.status !== 'No-show')
    .reduce((sum, item) => sum + (reservationRevenue(item, activeBuffetRate(item, date)) || 0), 0);
}
function activeBuffetRate(item, date = item?.date || today()) {
  const requestedDayType = String(item?.dayType || item?.day_type || '').trim().toLowerCase();
  const dayType = ['weekday', 'weekend', 'holiday'].includes(requestedDayType)
    ? requestedDayType
    : [0, 6].includes(new Date(`${date}T12:00:00`).getDay()) ? 'weekend' : 'weekday';
  const mealPeriod = item?.mealPeriod || (item?.time ? reservationMealPeriod(item) : 'All Day');
  return window.CostTrackLogic.activeBuffetRate(all('buffetRates'), mealPeriod, date, dayType);
}
function friendlyRpcError(error) {
  const message = String(error?.message || error || '');
  if (/users cannot change their own role/i.test(message)) return 'You cannot change your own role. Ask another Administrator.';
  if (/cannot remove or demote the last administrator/i.test(message)) return 'At least one Administrator must remain in the system.';
  if (/profile deletion is not supported/i.test(message)) return 'Active and deactivated staff profiles cannot be deleted. Cancel an unaccepted invitation to remove its pending account.';
  if (/role was not changed/i.test(message)) return 'No role change was saved. Reload the user list and try again.';
  if (/reservation start time has already passed|cannot be scheduled in the past/i.test(message)) return 'That reservation time has already passed. Choose a later time.';
  if (/reservation time must be within restaurant hours|two-hour reservation window/i.test(message)) return 'Choose a start time from 10:00 AM through 7:00 PM so the two-hour stay ends by closing at 9:00 PM.';
  if (/production would make stock negative/i.test(message)) return 'Not enough inventory is available to complete this batch. Ask an Inventory Clerk to check the stock before marking it ready.';
  if (/table_type|restaurant_tables.*area/i.test(message) && /column|schema cache|does not exist/i.test(message)) return 'Apply the Phase 15 table layout migration in Supabase, then reload the app.';
  if (/reservations_active_assigned_table_uidx|overlapping two-hour reservation/i.test(message)) return 'That table already has an overlapping two-hour reservation.';
  if (/selected table does not have enough seats/i.test(message)) return 'This table does not have enough seats for the reservation.';
  if (/table capacity cannot be reduced/i.test(message)) return 'Capacity cannot be reduced below an active party already assigned to this table.';
  if (/linked POS bill first/i.test(message)) return 'Resolve this Walk-in’s linked POS bill in Cashier; it must be Closed and fully settled before clearing the table.';
  if (/held deposit/i.test(message)) return 'Refund or forfeit this Walk-in’s held deposit before clearing the table.';
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
function lowStock() { return all('ingredients').filter(item => item.isActive !== false && item.stock <= item.minimum); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
let toastTimeoutId;
function toast(message, type = 'success', retryCollections = [], retryUserManagement = false) {
  if (type !== 'error') return;
  const root = document.querySelector('#toastRoot');
  const retryButton = retryCollections.length
    ? `<button type="button" class="toast-retry" data-retry-refresh="${esc(retryCollections.join(','))}">Retry</button>`
    : retryUserManagement
      ? '<button type="button" class="toast-retry" data-retry-user-management>Retry</button>'
      : '';
  root.innerHTML = `<div class="toast ${type}"><span>${type === 'success' ? '✓' : '!'}</span><span>${esc(message)}</span>${retryButton}</div>`;
  window.clearTimeout(toastTimeoutId);
  toastTimeoutId = window.setTimeout(() => { root.innerHTML = ''; }, 5000);
}
function setButtonBusy(button, label) {
  if (!button || button.disabled) return null;
  const originalContent = button.innerHTML;
  const originalAriaLabel = button.getAttribute('aria-label');
  button.disabled = true;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-label', label);
  button.textContent = label;
  const slowTimer = window.setTimeout(() => {
    if (button.isConnected && button.disabled) {
      button.textContent = 'Still processing…';
      button.setAttribute('aria-label', 'Still processing. Please wait.');
    }
  }, 5000);
  return () => {
    window.clearTimeout(slowTimer);
    if (!button.isConnected) return;
    button.disabled = false;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    if (originalAriaLabel === null) button.removeAttribute('aria-label');
    else button.setAttribute('aria-label', originalAriaLabel);
    button.innerHTML = originalContent;
  };
}
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
    recipes: ['ingredients', 'inventory_batches', 'recipes', 'recipe_ingredients', 'production_logs', 'production_batches'],
    production: ['ingredients', 'inventory_batches', 'recipes', 'production_logs', 'production_batches', 'reservations'],
    waste: ['ingredients', 'waste_logs', 'prepared_food_waste_logs', 'production_logs'],
    counts: ['ingredients', 'physical_counts'],
    reservations: ['reservations', 'restaurant_tables', 'pos_bills', 'pos_reservation_deposits'],
    calendar: ['reservations', 'restaurant_tables'],
    tables: ['reservations', 'restaurant_tables'],
    cashier: ['pos_bills', 'pos_bill_lines', 'pos_bill_payments', 'pos_reservation_deposits', 'pos_bill_approvals', 'reservations'],
    shifts: ['pos_shifts', 'pos_cash_movements', 'pos_bills', 'pos_bill_approvals', 'pos_notifications'],
    approvals: ['pos_bills', 'pos_bill_approvals'],
    'charge-catalog': ['pos_charge_items', 'pos_package_tiers', 'pos_discounts', 'pos_settings'],
    rates: ['buffet_rates'],
    revenue: ['revenue_records'],
    reports: ['ingredients', 'recipes', 'recipe_ingredients', 'production_logs', 'waste_logs', 'prepared_food_waste_logs', 'revenue_records', 'pos_bills', 'pos_bill_lines', 'pos_bill_payments', 'pos_shifts', 'pos_cash_movements', 'pos_reservation_deposits']
  };
  const alertTablesByRole = {
    Administrator: ['ingredients', 'inventory_batches', 'reservations', 'pos_shifts', 'pos_bills', 'pos_bill_approvals', 'pos_reservation_deposits', 'pos_notifications', 'notifications', 'notification_read_states', 'audit_logs'],
    Manager: ['ingredients', 'inventory_batches', 'reservations', 'pos_shifts', 'pos_bills', 'pos_bill_approvals', 'pos_reservation_deposits', 'pos_notifications', 'notifications', 'notification_read_states', 'audit_logs'],
    'Inventory Clerk': ['ingredients', 'inventory_batches', 'notifications', 'notification_read_states', 'audit_logs'],
    'Chef / Kitchen Staff': ['notifications', 'notification_read_states', 'audit_logs'],
    Receptionist: ['reservations', 'pos_shifts', 'pos_bills', 'pos_bill_approvals', 'pos_reservation_deposits', 'notifications', 'notification_read_states', 'audit_logs']
  };
  if (state.view === 'dashboard') {
    const dashboardTables = {
      Receptionist: ['reservations', 'restaurant_tables'],
      'Inventory Clerk': ['ingredients', 'inventory_transactions', 'physical_counts'],
      'Chef / Kitchen Staff': ['ingredients', 'inventory_batches', 'recipes', 'production_logs', 'prepared_food_waste_logs', 'waste_logs', 'reservations'],
      default: ['ingredients', 'recipes', 'production_logs', 'waste_logs', 'reservations', 'restaurant_tables', 'pos_bills', 'buffet_rates']
    };
    return [...new Set([
      ...(dashboardTables[state.role] || dashboardTables.default),
      ...(alertTablesByRole[state.role] || [])
    ])];
  }
  if (state.view === 'reports') return common.reports;
  return [...new Set([...(common[state.view] || []), ...(alertTablesByRole[state.role] || [])])];
}
function realtimeTablesForRole(tables) {
  const allowed = {
    Administrator: ['ingredients', 'recipes', 'recipe_ingredients', 'inventory_transactions', 'inventory_batches', 'production_logs', 'production_batches', 'waste_logs', 'prepared_food_waste_logs', 'physical_counts', 'reservations', 'restaurant_tables', 'revenue_records', 'buffet_rates', 'pos_charge_items', 'pos_charge_item_variants', 'pos_package_tiers', 'pos_package_inclusions', 'pos_discounts', 'pos_settings', 'pos_shifts', 'pos_cash_movements', 'pos_bills', 'pos_bill_lines', 'pos_bill_payments', 'pos_reservation_deposits', 'pos_bill_approvals', 'pos_notifications', 'notifications', 'notification_read_states'],
    Manager: ['ingredients', 'recipes', 'recipe_ingredients', 'inventory_transactions', 'inventory_batches', 'production_logs', 'production_batches', 'waste_logs', 'prepared_food_waste_logs', 'physical_counts', 'reservations', 'restaurant_tables', 'revenue_records', 'buffet_rates', 'pos_charge_items', 'pos_charge_item_variants', 'pos_package_tiers', 'pos_package_inclusions', 'pos_discounts', 'pos_settings', 'pos_shifts', 'pos_cash_movements', 'pos_bills', 'pos_bill_lines', 'pos_bill_payments', 'pos_reservation_deposits', 'pos_bill_approvals', 'pos_notifications', 'notifications', 'notification_read_states'],
    'Chef / Kitchen Staff': ['ingredients', 'inventory_batches', 'recipes', 'recipe_ingredients', 'production_logs', 'production_batches', 'waste_logs', 'prepared_food_waste_logs', 'notifications', 'notification_read_states'],
    Receptionist: ['reservations', 'restaurant_tables', 'buffet_rates', 'pos_bills', 'pos_bill_lines', 'pos_bill_payments', 'pos_reservation_deposits', 'pos_bill_approvals', 'pos_shifts', 'pos_cash_movements', 'notifications', 'notification_read_states'],
    'Inventory Clerk': ['ingredients', 'recipes', 'recipe_ingredients', 'inventory_transactions', 'inventory_batches', 'physical_counts', 'waste_logs', 'prepared_food_waste_logs', 'notifications', 'notification_read_states']
  };
  const permitted = new Set(allowed[state.role] || []);
  return [...new Set([
    'profiles',
    ...tables.filter(table => permitted.has(table) || (table === 'audit_logs' && canAccess('activity-logs')))
  ])];
}
function realtimeCollectionName(table) {
  return {
    ingredients: 'ingredients',
    recipes: 'recipes',
    recipe_ingredients: 'recipes',
    inventory_transactions: 'inventoryTransactions',
    inventory_batches: 'inventoryBatches',
    production_logs: 'productionLogs',
    waste_logs: 'wasteLogs',
    prepared_food_waste_logs: 'preparedFoodWasteLogs',
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
    pos_bill_approvals: 'billApprovals',
    pos_notifications: 'posNotifications',
    notifications: 'notifications',
    audit_logs: 'auditLogs'
  }[table];
}
const posRelatedRealtimeCollections = new Set([
  'reservations', 'restaurantTables', 'inventoryBatches', 'notifications', 'chargeItems', 'chargeItemVariants',
  'packageTiers', 'packageInclusions', 'discounts', 'posSettings', 'shifts',
  'cashMovements', 'posBills', 'billLines', 'billPayments',
  'reservationDeposits', 'billApprovals', 'posNotifications'
]);
function persistCollection(collection, records) {
  collectionState[collection] = records;
}
async function refetchCollection(collection) {
  const records = await window.supabaseRecord.load(collection);
  persistCollection(collection, records);
  return records;
}
async function refreshSavedCollections(collections) {
  let timeoutId;
  const pending = Promise.all(collections.map(collection => window.supabaseRecord.load(collection)));
  const timeout = new Promise((resolve, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error('List refresh timed out after 15 seconds.')),
      15000
    );
  });
  let loaded;
  try {
    loaded = await Promise.race([pending, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
  collections.forEach((collection, index) => persistCollection(collection, loaded[index]));
  if (collections.some(key => ['reservations', 'restaurantTables', 'posBills', 'reservationDeposits'].includes(key))) {
    invalidateUnresolvedBookings();
  }
  invalidateReportData(collections);
  setPostSaveSyncState();
  render();
}
function showSaveRefreshWarning(collections, error) {
  console.error('The save completed, but its list refresh failed.', error);
  toast('Saved, but the list could not refresh.', 'error', collections);
}
document.addEventListener('click', async event => {
  const retry = event.target.closest('[data-retry-refresh]');
  if (!retry) return;
  const collections = retry.dataset.retryRefresh.split(',').filter(key => KEYS.includes(key));
  if (!collections.length) return toast('The list refresh request is invalid.', 'error');
  retry.disabled = true;
  retry.textContent = 'Retrying…';
  try {
    await refreshSavedCollections(collections);
    toast('List refreshed.');
  } catch (error) {
    showSaveRefreshWarning(collections, error);
  }
});
document.addEventListener('click', event => {
  const retry = event.target.closest('[data-retry-user-management]');
  if (!retry) return;
  void retryUserManagementLists(retry);
});
async function loadUnresolvedBookings(force = false) {
  const viewCanRead = ['Administrator', 'Manager', 'Receptionist'].includes(state.role);
  const unresolved = state.unresolvedBookings;
  if (!viewCanRead || !state.user || unresolved.loading || (unresolved.loaded && !force)) return;
  unresolved.loading = true;
  unresolved.error = '';
  try {
    unresolved.rows = await window.supabaseRecord.posListUnresolvedStaleBookings();
    unresolved.loaded = true;
  } catch (error) {
    console.error('Unresolved bookings could not be loaded.', error);
    unresolved.rows = [];
    unresolved.error = friendlyRpcError(error);
    unresolved.loaded = true;
    toast(`Unresolved bookings could not be loaded: ${unresolved.error}`, 'error');
  } finally {
    unresolved.loading = false;
    const refreshAgain = unresolved.refreshAfterLoad === true;
    unresolved.refreshAfterLoad = false;
    if (['reservations', 'tables'].includes(state.view)) render();
    if (document.querySelector('[data-popover-panel="notifications"]:not([hidden])')) {
      rerenderNotificationPopover(true);
    }
    if (refreshAgain) {
      unresolved.loaded = false;
      loadUnresolvedBookings();
    }
  }
}
async function refreshNotificationSourcesOnOpen() {
  if (['Administrator', 'Manager'].includes(state.role)) {
    try {
      await window.supabaseRecord.posRefreshNotifications();
      await refetchCollection('posNotifications');
    } catch (error) {
      console.error('POS notifications could not be refreshed.', error);
      toast(`Notifications could not be refreshed: ${friendlyRpcError(error)}`, 'error');
    }
  }
  if (['Administrator', 'Manager', 'Receptionist'].includes(state.role)) {
    await loadUnresolvedBookings(true);
  }
  if (document.querySelector('[data-popover-panel="notifications"]:not([hidden])')) {
    rerenderNotificationPopover(true);
  }
}
function invalidateUnresolvedBookings() {
  const unresolved = state.unresolvedBookings;
  unresolved.loaded = false;
  if (unresolved.loading) unresolved.refreshAfterLoad = true;
}
async function refreshPosCollections() {
  const collections = ['posBills', 'billLines', 'billPayments', 'billApprovals', 'shifts', 'cashMovements', 'reservationDeposits', 'reservations', 'restaurantTables'];
  if (['Administrator', 'Manager'].includes(state.role)) collections.push('posNotifications');
  let timeoutId;
  const pending = Promise.all([
    ['Administrator', 'Manager'].includes(state.role) ? window.supabaseRecord.posRefreshNotifications() : Promise.resolve(),
    Promise.all(collections.map(collection => window.supabaseRecord.load(collection)))
  ]);
  const timeout = new Promise((resolve, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error('POS list refresh timed out after 15 seconds.')),
      15000
    );
  });
  let loaded;
  try {
    [, loaded] = await Promise.race([pending, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
  collections.forEach((collection, index) => persistCollection(collection, loaded[index]));
  invalidateUnresolvedBookings();
  invalidateReportData(collections);
  setPostSaveSyncState();
  render();
}
async function refreshRealtimeCollection(table, payload) {
  if (table === 'production_batches') {
    await loadProductionBoard(true);
    if (state.productionHistoryOpen) await loadProductionHistory(true);
    return;
  }
  if (table === 'notification_read_states') {
    const changed = payload?.new || payload?.old;
    if (!state.user || changed?.target_role !== state.role) return;
    state.notificationReadKeys = await window.supabaseRecord.notificationReadKeys();
    renderWithNotificationPopover();
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
    if (await confirmInApp('This record changed in another session. Reload the latest data?', {
      title: 'Record changed',
      confirmLabel: 'Reload latest',
      cancelLabel: 'Keep editing'
    })) closeModal(true);
    else toast('Remote change received. Your edit remains open.', 'error');
  }
  if (table === 'pos_shifts') {
    persistCollection(collection, await window.supabaseRecord.load(collection));
  } else if (!posRelatedRealtimeCollections.has(collection) || !recordId) {
    persistCollection(collection, await window.supabaseRecord.load(collection));
  } else if (payload?.eventType === 'DELETE') {
    collectionState[collection] = read(collection).filter(record => String(record.id) !== String(recordId));
  } else {
    const record = await window.supabaseRecord.loadRecord(collection, recordId);
    if (record) upsertLocalRecord(collection, record);
  }
  const affectedReportTabs = invalidateReportData([table]);
  if (['reservations', 'restaurant_tables', 'pos_bills', 'pos_reservation_deposits'].includes(table)) {
    invalidateUnresolvedBookings();
    if (document.querySelector('[data-popover-panel="notifications"]:not([hidden])')) {
      loadUnresolvedBookings(true);
    }
  }
  if (state.view === 'reports') {
    if (affectedReportTabs.includes(state.reportTab)) {
      void loadReportData({ preserveCharts: true });
    } else if (['prepared_food_waste_logs', 'revenue_records'].includes(table)) {
      render({ preserveReportCharts: true });
    }
    return;
  }
  if (['ingredients', 'inventory_batches', 'notifications', 'audit_logs', 'reservations', 'restaurant_tables', 'revenue_records', 'production_logs', 'waste_logs', 'prepared_food_waste_logs', 'inventory_transactions', 'physical_counts', 'recipes', 'buffet_rates', 'pos_shifts', 'pos_cash_movements', 'pos_bills', 'pos_bill_lines', 'pos_bill_payments', 'pos_reservation_deposits', 'pos_bill_approvals', 'pos_notifications'].includes(table)) {
    renderWithNotificationPopover();
  }
}
function scheduleRealtimeRefresh(table, payload) {
  const recordId = payload?.new?.id || payload?.old?.id || '';
  const refreshKey = `${table}:${recordId}`;
  clearTimeout(realtimeRefreshTimers.get(refreshKey));
  realtimeRefreshTimers.set(refreshKey, setTimeout(() => {
    realtimeRefreshTimers.delete(refreshKey);
    refreshRealtimeCollection(table, payload).catch(error => {
      console.error(`Realtime refresh failed for ${table}.`, error);
      setSyncState(navigator.onLine ? 'reconnecting' : 'offline', error.message);
      toast(`Live update for ${table} could not be refreshed.`, 'error');
    });
  }, 300));
}
async function stopRealtimeSubscriptions() {
  for (const timer of realtimeRefreshTimers.values()) clearTimeout(timer);
  realtimeRefreshTimers.clear();
  const channel = realtimeChannel;
  realtimeChannel = null;
  realtimeSubscriptionKey = '';
  realtimeConnected = false;
  if (channel) await window.supabaseClient.removeChannel(channel);
}
async function applyRealtimeSubscriptions(key, tables) {
  if (!supabaseSyncEnabled || !state.user || key !== realtimeRequestedKey) return;
  if (key === realtimeSubscriptionKey && realtimeChannel) return;
  await stopRealtimeSubscriptions();
  if (!supabaseSyncEnabled || !state.user || key !== realtimeRequestedKey || !tables.length) return;
  realtimeSubscriptionKey = key;
  realtimeConnected = false;
  const channel = window.supabaseClient.channel(`costtrack:${state.user.id}:${state.view}`);
  realtimeChannel = channel;
  tables.forEach(table => {
    if (table === 'profiles') {
      channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table, filter: `id=eq.${state.user.id}` },
        payload => {
          if (payload?.new?.account_status === 'Active') return;
          void signOutCurrentUser({ force: true }).then(() => {
            toast('Your CostTrack account is no longer active. Contact an Administrator.', 'error');
          });
        }
      );
      return;
    }
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => scheduleRealtimeRefresh(table, payload));
  });
  channel.subscribe(async status => {
    if (realtimeChannel !== channel) return;
    if (status === 'SUBSCRIBED') {
      realtimeConnected = true;
      setSyncState('live');
      if (realtimeNeedsResync) {
        try {
          await syncWithSupabase();
          realtimeNeedsResync = false;
        } catch (error) {
          realtimeNeedsResync = true;
          console.error('Realtime reconnect refresh failed.', error);
          setSyncState('reconnecting', error.message);
        }
      }
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      realtimeNeedsResync = true;
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
  { id: 'inventory', label: 'Inventory', icon: 'boxes', items: [['ingredients', 'package', 'Ingredients'], ['receiving', 'package-plus', 'Ingredients + Receiving'], ['counts', 'clipboard-check', 'Physical Count']] },
  { id: 'production', label: 'Kitchen Operations', icon: 'chef-hat', items: [['recipes', 'book', 'Recipes'], ['production', 'chef-hat', 'Production Board'], ['waste', 'trash', 'Waste Logs']] },
  { id: 'revenue-management', label: 'Revenue Management', icon: 'chart', items: [['revenue', 'chart', 'Revenue Tracking'], ['charge-catalog', 'package', 'Charge Catalog']] },
  { id: 'analytics', label: 'Analytics & Reports', icon: 'chart', items: [['reports', 'chart', 'Reports & analytics']] },
  { id: 'system', label: 'System Management', icon: 'users', items: [['activity-logs', 'clipboard-check', 'Activity Log'], ['users', 'users', 'User Management']] }
];

const shellIconPaths = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="5" rx="1.5"></rect><rect x="14" y="11" width="7" height="10" rx="1.5"></rect><rect x="3" y="13" width="7" height="8" rx="1.5"></rect>',
  peso: '<path d="M7 20V4h6.5a5 5 0 0 1 0 10H7"></path><path d="M5 8h12M5 11h12"></path>',
  'bill-list': '<rect x="4" y="3" width="16" height="18" rx="2"></rect><path d="M8 3v4h8V3M8 11h8M8 15h8M8 18h5"></path>',
  person: '<circle cx="12" cy="7" r="3"></circle><path d="M7 21v-2a5 5 0 0 1 10 0v2M5 21h14"></path>',
  'trend-up': '<path d="m3 17 6-6 4 4 8-8"></path><path d="M15 7h6v6"></path>',
  minus: '<path d="M5 12h14"></path>',
  'trend-down': '<path d="m3 7 6 6 4-4 8 8"></path><path d="M15 17h6v-6"></path>',
  clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
  home: '<path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10M9 20v-6h6v6"></path>',
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
  const defaultGroup = activeGroup || sidebarGroups.find(group =>
    group.items.some(([view]) => canAccess(view))
  )?.id;
  return hasPreference ? groups : (defaultGroup ? [defaultGroup] : []);
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
  } else if (view === 'notifications') {
    const count = activeNotifications().filter(item => !item.isRead).length;
    if (count) badge = `<b class="nav-badge" title="${count} unread notifications" aria-label="${count} unread notifications">${count > 99 ? '99+' : count}</b>`;
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
      ${header ? shellIcon('chevron') : ''}
    </button>
    <div class="shell-popover user-popover" id="${id}" data-popover-panel="user-${placement}" role="menu" aria-label="Account menu" hidden>
      <div class="user-popover-heading"><strong>${esc(currentUserName())}</strong><span>${esc(state.role || '')}</span></div>
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

function notificationDateLabel(value) {
  const date = String(value || '').slice(0, 10);
  const parts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : 'Date not set';
}

function notificationTimestampForUnresolved(row) {
  if (!row.reservation_date) return null;
  const parts = String(row.reservation_time || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!parts) return `${row.reservation_date}T12:00:00+08:00`;
  let hour = Number(parts[1]) % 12;
  if (parts[3].toUpperCase() === 'PM') hour += 12;
  return `${row.reservation_date}T${String(hour).padStart(2, '0')}:${parts[2]}:00+08:00`;
}

function notificationCenterCategory(alert) {
  const category = String(alert.category || '').toLowerCase();
  const type = String(alert.type || alert.title || '').toLowerCase();
  if (['reservation', 'unresolved'].includes(category) || type.includes('reservation') || type.includes('booking')) return 'Reservations';
  if (['stock', 'expiry', 'inventory'].includes(category) || type.includes('stock') || type.includes('inventory') || type.includes('product')) return 'Inventory';
  if (category === 'pos' || type.includes('approval') || type.includes('bill') || type.includes('shift') || type.includes('discount')) {
    if (type.includes('approval')) return 'Approvals';
    return 'Operations';
  }
  if (type.includes('user') || type.includes('invitation') || type.includes('role') || type.includes('account') || type.includes('deactivated')) return 'Users';
  if (['system', 'warning', 'error'].includes(category) || type.includes('error') || type.includes('warning')) return 'System';
  return 'System';
}

function notificationCenterItems() {
  const alerts = new Map();
  activeNotifications().forEach(alert => alerts.set(alert.key, alert));

  all('notifications').forEach(item => {
    const alert = generalNotificationAlert(item);
    if (!alerts.has(alert.key)) alerts.set(alert.key, { ...alert, isRead: item.isRead });
  });

  all('reservations').forEach(item => {
    if (!['Confirmed', 'Cancelled', 'Completed', 'No-show', 'Seated'].includes(item.status)) return;
    const key = `reservation:${item.id}:${item.status}`;
    if (alerts.has(`reservation:${item.id}`) && item.status !== 'Pending') return;
    alerts.set(key, {
      key,
      dedupeKey: key,
      category: 'reservation',
      type: `Reservation ${item.status}`,
      title: `Reservation ${item.status}`,
      detail: `${item.name || 'Guest'} · ${Number(item.guests || 0)} guests · ${notificationDateLabel(item.date)}${item.time ? ` · ${item.time}` : ''}`,
      severity: item.status === 'Cancelled' || item.status === 'No-show' ? 'warning' : 'info',
      icon: 'calendar',
      createdAt: item.completedAt || item.seatedAt || item.createdAt || null,
      isRead: state.notificationReadKeys.includes(key),
      action: { view: 'reservations', label: 'Review reservation', query: item.name || '', recordId: item.id }
    });
  });

  return window.CostTrackLogic.buildNotificationFeed(
    [...alerts.values()],
    state.role,
    state.notificationReadKeys
  );
}

function notificationCenterPage() {
  const filters = ['All', 'Unread', 'Reservations', 'Inventory', 'Approvals', 'Users', 'Operations', 'System'];
  let items = notificationCenterItems();
  if (state.notificationCenterFilter === 'Unread') {
    items = items.filter(item => !item.isRead);
  } else if (state.notificationCenterFilter !== 'All') {
    items = items.filter(item => notificationCenterCategory(item) === state.notificationCenterFilter);
  }
  const query = state.notificationCenterQuery.trim().toLowerCase();
  if (query) {
    items = items.filter(item =>
      `${item.title || ''} ${item.detail || ''} ${notificationCenterCategory(item)}`.toLowerCase().includes(query)
    );
  }
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  state.notificationCenterPage = Math.min(Math.max(1, Number(state.notificationCenterPage || 1)), pageCount);
  const start = (state.notificationCenterPage - 1) * pageSize;
  const visible = items.slice(start, start + pageSize);
  const unreadCount = notificationCenterItems().filter(item => !item.isRead).length;
  const cards = visible.map(item => {
    const category = notificationCenterCategory(item);
    const categoryClass = category.toLowerCase();
    const timestamp = item.createdAt ? formatOperationalDateTime(item.createdAt) : 'Time unavailable';
    return `<article class="notification-center-card ${item.isRead ? 'is-read' : 'is-unread'}">
      <button type="button" class="notification-center-main" data-notification-key="${esc(item.key)}" aria-label="${esc(item.isRead ? 'Open read notification' : 'Open unread notification')}: ${esc(item.title)}">
        <span class="notification-center-category category-${esc(categoryClass)}">${esc(category)}</span>
        <span class="notification-center-status ${item.isRead ? 'is-read' : 'is-unread'}">${item.isRead ? 'Read' : 'Unread'}</span>
        <strong>${esc(item.title)}</strong>
        <p>${esc(item.detail)}</p>
        <time>${esc(timestamp)}</time>
      </button>
    </article>`;
  }).join('');
  const pagination = pageCount > 1
    ? `<nav class="notification-center-pagination" aria-label="Notification pages">${Array.from({ length: pageCount }, (_, index) => {
      const page = index + 1;
      return `<button type="button" class="${page === state.notificationCenterPage ? 'active' : ''}" data-notification-center-page="${page}" ${page === state.notificationCenterPage ? 'aria-current="page"' : ''}>${page}</button>`;
    }).join('')}</nav>`
    : '';
  return `${pageHeader('System', 'Notifications', 'Review, filter, search, and manage notification history.', `<button type="button" class="ghost-btn" data-notification-center-mark-all ${!unreadCount ? 'disabled' : ''}>Mark all read</button>`)}
    <section class="notification-center-page">
      <div class="notification-center-toolbar">
        <label>Search<input type="search" value="${esc(state.notificationCenterQuery)}" data-notification-center-search placeholder="Search notification title or details" aria-label="Search notifications"></label>
        <span class="notification-center-unread">${unreadCount} unread</span>
      </div>
      <div class="notification-center-filters" role="group" aria-label="Filter notifications">${filters.map(filter =>
        `<button type="button" class="${state.notificationCenterFilter === filter ? 'active' : ''}" data-notification-center-filter="${esc(filter)}" ${state.notificationCenterFilter === filter ? 'aria-pressed="true"' : 'aria-pressed="false"'}>${esc(filter)}</button>`
      ).join('')}</div>
      <div class="notification-center-list">${cards || '<div class="empty-table"><strong>No notifications found</strong><small>Try another search or filter.</small></div>'}</div>
      ${pagination}
    </section>`;
}

function activityLogsPage() {
  const query = state.query.trim().toLowerCase();
  const rows = all('auditLogs')
    .filter(item => !query || `${item.action} ${item.tableName} ${item.recordId}`.toLowerCase().includes(query))
    .map(item => {
      const actionLabel = item.action === 'INSERT' ? 'Created'
        : item.action === 'UPDATE' ? 'Updated'
        : item.action === 'DELETE' ? 'Deleted'
        : item.action;
      const tableLabel = String(item.tableName || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, character => character.toUpperCase());
      const actionClass = item.action === 'DELETE' ? 'status-out'
        : item.action === 'INSERT' ? 'status-good'
        : 'status-low';
      return `<tr><td>${esc(formatOperationalDateTime(item.occurredAt))}</td><td><span class="status ${actionClass}">${esc(actionLabel)}</span></td><td>${esc(tableLabel)}</td><td>${esc(item.recordId || 'Unavailable')}</td></tr>`;
    });
  return tablePage({
    eyebrow: 'My account',
    title: 'Activity Log',
    subtitle: 'Review record changes made by your account. Only your own activity is shown.',
    action: '<button type="button" class="ghost-btn" data-action="refresh-activity-logs">Refresh</button>',
    search: 'activity or record',
    tableId: 'activity-logs',
    headers: ['Date and time', 'Action', 'Area', 'Record ID'],
    rows,
    emptyMessage: 'No record activity found for your account.'
  });
}

function generalNotificationAlert(item) {
  const type = String(item.type || '');
  const referenceType = String(item.referenceType || '').toLowerCase();
  const referenceId = String(item.referenceId || '');
  const product = all('ingredients').find(record => record.id === referenceId);
  const batch = all('inventoryBatches').find(record => record.id === referenceId);
  const isStock = ['Low stock', 'Out of stock'].includes(type);
  const isExpiry = ['Expiring soon', 'Expired'].includes(type);
  let action = null;
  let category = 'system';
  let detail = 'An update needs your attention.';
  let dedupeKey = `system:${item.id}`;
  if (isStock) {
    category = 'stock';
    dedupeKey = referenceId ? `stock:${referenceId}` : dedupeKey;
    detail = product
      ? `${product.name} · ${formatStockQuantity(product.stock)} ${product.unit || ''} on hand`
      : 'Stock needs replenishment.';
    action = { view: 'receiving', label: 'Receive stock' };
  } else if (isExpiry) {
    category = 'expiry';
    dedupeKey = referenceId && referenceType.includes('batch')
      ? `expiry:${referenceId}`
      : dedupeKey;
    detail = batch
      ? `${all('ingredients').find(record => record.id === batch.productId)?.name || 'Product'} · expires ${notificationDateLabel(batch.expirationDate)}`
      : type === 'Expired' ? 'A stock lot has expired.' : 'A stock lot is nearing expiration.';
    action = { view: 'ingredients', label: 'Review lot' };
  } else if (type === 'New product request') {
    detail = 'A product request is awaiting review.';
    action = { view: 'ingredients', label: 'Review request' };
  } else if (type === 'Missing revenue entry') {
    detail = item.message || 'A revenue entry needs review.';
    action = { view: 'reports', label: 'Open reports' };
  }
  return {
    key: dedupeKey,
    dedupeKey,
    category,
    type,
    title: type,
    detail,
    severity: item.severity || (type === 'Expired' || type === 'Out of stock' ? 'critical' : 'warning'),
    icon: type === 'New product request' ? 'package' : 'alert',
    createdAt: item.createdAt,
    targetRoles: item.targetRoles,
    isRead: item.isRead,
    action
  };
}

function activeNotifications() {
  const alerts = [];
  const inventoryRoles = ['Administrator', 'Manager', 'Inventory Clerk'];
  const reservationRoles = ['Administrator', 'Manager', 'Receptionist'];
  if (inventoryRoles.includes(state.role)) {
    lowStock().forEach(item => alerts.push({
      key: `stock:${item.id}`,
      dedupeKey: `stock:${item.id}`,
      category: 'stock',
      title: item.stock <= 0 ? 'Out of stock' : 'Low stock',
      detail: `${item.name} · ${formatStockQuantity(item.stock)} ${item.unit || ''} on hand · minimum ${formatStockQuantity(item.minimum)}`,
      severity: item.stock <= 0 ? 'critical' : 'warning',
      icon: 'package',
      createdAt: item.updatedAt || null,
      action: { view: 'receiving', label: 'Receive stock' }
    }));
    const asOfDate = manilaBusinessToday();
    all('inventoryBatches').forEach(batch => {
      const batchStatus = window.CostTrackLogic.batchStatus(batch, asOfDate, 3);
      if (!['Expired', 'Expiring soon'].includes(batchStatus.status)) return;
      const product = all('ingredients').find(item => item.id === batch.productId);
      alerts.push({
        key: `expiry:${batch.id}`,
        dedupeKey: `expiry:${batch.id}`,
        category: 'expiry',
        title: batchStatus.status,
        detail: `${product?.name || 'Product'} · ${formatStockQuantity(batch.quantityRemaining)} ${product?.unit || ''} · expires ${notificationDateLabel(batch.expirationDate)}`,
        severity: batchStatus.status === 'Expired' ? 'critical' : 'warning',
        icon: 'alert',
        createdAt: batch.updatedAt || batch.createdAt || null,
        action: { view: 'ingredients', label: 'Review lot', query: product?.name || '' }
      });
    });
  }
  all('notifications').filter(item => !item.isResolved).forEach(item => {
    alerts.push(generalNotificationAlert(item));
  });
  if (reservationRoles.includes(state.role)) {
    all('reservations')
      .filter(item => item.status === 'Pending' && (!item.date || item.date >= manilaBusinessToday()))
      .sort((left, right) => `${left.date || ''} ${left.time || ''}`.localeCompare(`${right.date || ''} ${right.time || ''}`))
      .forEach(item => {
        const isNewWebsiteReservation = window.CostTrackLogic.isRecentWebsiteReservation(item);
        alerts.push({
          key: `reservation:${item.id}`,
          dedupeKey: `reservation:${item.id}`,
          category: 'reservation',
          title: isNewWebsiteReservation ? 'New website reservation' : item.source === 'Website' ? 'Pending website reservation' : 'Pending reservation',
          detail: `${item.source ? `${item.source} · ` : ''}${item.name || 'Guest'} · ${Number(item.guests || 0)} guests · ${notificationDateLabel(item.date)}${item.time ? ` · ${item.time}` : ''}`,
          severity: 'info',
          icon: 'calendar',
          createdAt: item.createdAt || null,
          action: {
            view: 'reservations',
            label: 'Review reservation',
            filter: isNewWebsiteReservation ? 'New website' : 'Pending',
            query: isNewWebsiteReservation ? '' : item.name || ''
          }
        });
      });
    (state.unresolvedBookings.rows || []).forEach(item => alerts.push({
      key: `unresolved:${item.reservation_id}`,
      dedupeKey: `unresolved:${item.reservation_id}`,
      category: 'unresolved',
      title: item.resolution_label === 'Payable' ? 'Past booking has an open bill' : 'Unresolved past booking',
      detail: `${item.name || 'Guest'} · ${item.reservation_status} · ${notificationDateLabel(item.reservation_date)} · ${Number(item.age_days || 0)} days ago`,
      severity: item.resolution_label === 'Payable' ? 'warning' : 'critical',
      icon: 'calendar',
      createdAt: notificationTimestampForUnresolved(item),
      action: {
        view: 'reservations', label: 'View unresolved bookings',
        filter: 'Unresolved', recordId: item.reservation_id
      }
    }));
  }
  if (['Administrator', 'Manager'].includes(state.role)) {
    all('posNotifications').forEach(item => {
      const approval = item.type === 'pending_approval';
      const isBill = item.type === 'open_bill_shift_close';
      const bill = isBill || approval
        ? all('posBills').find(record => record.id === (approval
          ? all('billApprovals').find(record => record.id === item.sourceId)?.billId
          : item.sourceId))
        : null;
      const shift = item.type === 'long_open_shift'
        ? all('shifts').find(record => record.id === item.sourceId)
        : null;
      alerts.push({
        key: `pos:${item.id}`,
        dedupeKey: `pos:${item.id}`,
        category: 'pos',
        type: item.type,
        title: item.title,
        detail: item.type === 'pending_approval'
          ? `${item.message}${bill?.billNumber ? ` · ${bill.billNumber}` : ''}`
          : item.type === 'open_bill_shift_close'
            ? `${bill?.billNumber ? `Open bill ${bill.billNumber}` : 'An open bill'} needs review.`
            : `Cashier shift · ${item.message}`,
        severity: approval ? 'warning' : 'critical',
        icon: approval ? 'shield' : 'alert',
        createdAt: item.createdAt,
        isRead: Boolean(item.readAt),
        action: approval
          ? { view: 'approvals', label: 'Open approval', query: bill?.billNumber || '' }
          : isBill
            ? { view: 'cashier', label: 'Open bill', query: bill?.billNumber || '' }
            : { view: 'shifts', label: 'Review shift', query: shift?.code || '' }
      });
    });
  }
  return window.CostTrackLogic.buildNotificationFeed(
    alerts, state.role, state.notificationReadKeys
  );
}

function renderNotifications() {
  const alerts = activeNotifications();
  const unread = alerts.filter(item => !item.isRead);
  const count = window.CostTrackLogic.notificationUnreadCount(alerts);
  const visible = state.notificationViewAll ? alerts : unread;
  const list = visible.map(alert => `<button type="button" role="menuitem" class="notification-item ${alert.isRead ? 'is-read' : 'is-unread'} severity-${esc(alert.severity)}" data-notification-key="${esc(alert.key)}">
      <span class="notification-icon">${shellIcon(alert.severity === 'info' ? 'check' : 'alert')}</span>
      <span class="notification-copy"><strong>${esc(alert.title)}</strong><span>${esc(alert.detail)}</span><small>${esc(window.CostTrackLogic.formatNotificationRelativeTime(alert.createdAt))}</small></span>
      <span class="notification-action-label">${esc(alert.action?.label || 'Open')}</span>
      ${shellIcon('arrow')}
    </button>`).join('');
  const unresolvedError = state.unresolvedBookings.error && ['Administrator', 'Manager', 'Receptionist'].includes(state.role)
    ? `<div class="notification-load-error" role="alert">Unresolved bookings could not be loaded. <button type="button" role="menuitem" data-action="retry-unresolved-bookings">Retry</button></div>`
    : '';
  return `<div class="shell-popover-wrap">
    <button class="notification-button" id="notificationButton" type="button" data-popover-trigger="notifications" aria-controls="notifications-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Notifications, ${count} unread">
      ${shellIcon('bell')}
      ${count ? `<span class="notification-count" aria-hidden="true">${count}</span>` : ''}
    </button>
    <div class="shell-popover notification-popover" id="notifications-menu" data-popover-panel="notifications" role="menu" aria-label="Notifications" hidden>
      <div class="notification-header"><div class="popover-heading"><strong>Notifications</strong><span>${count} unread</span></div>
        <div class="notification-controls">
          <button type="button" role="menuitem" data-notification-mark-all ${!count || state.notificationMarkingRead ? 'disabled' : ''}>${state.notificationMarkingRead ? 'Marking read…' : 'Mark all read'}</button>
          <button type="button" role="menuitem" data-notification-view-all>${state.notificationViewAll ? 'Show unread' : 'View all'}</button>
        </div>
      </div>
      <div class="notification-list">${list || "<p class=\"notification-empty\">You're all caught up.</p>"}${unresolvedError}</div>
    </div>
  </div>`;
}

function rerenderNotificationPopover(keepOpen = false) {
  const activeElement = document.activeElement;
  const focusKey = activeElement?.dataset?.notificationKey || '';
  const focusControl = activeElement?.hasAttribute('data-notification-mark-all')
    ? 'mark-all'
    : activeElement?.hasAttribute('data-notification-view-all') ? 'view-all' : '';
  const wasOpen = keepOpen
    && Boolean(document.querySelector('[data-popover-panel="notifications"]:not([hidden])'));
  renderShellChrome();
  if (wasOpen) {
    const trigger = document.querySelector('[data-popover-trigger="notifications"]');
    if (trigger) {
      toggleShellPopover('notifications', trigger);
      const panel = document.querySelector('[data-popover-panel="notifications"]');
      const replacement = focusKey
        ? [...panel.querySelectorAll('[data-notification-key]')].find(item => item.dataset.notificationKey === focusKey)
        : focusControl === 'view-all'
          ? panel.querySelector('[data-notification-view-all]')
          : focusControl === 'mark-all'
            ? panel.querySelector('[data-notification-mark-all]:not([disabled])')
              || panel.querySelector('[data-notification-view-all]')
            : null;
      (replacement || panel.querySelector('[role="menuitem"]:not([disabled])'))?.focus();
    }
  }
}
function renderWithNotificationPopover() {
  const wasOpen = Boolean(document.querySelector('[data-popover-panel="notifications"]:not([hidden])'));
  if (!wasOpen) return render();
  const activeElement = document.activeElement;
  const focusKey = activeElement?.dataset?.notificationKey || '';
  const focusControl = activeElement?.hasAttribute('data-notification-mark-all')
    ? 'mark-all'
    : activeElement?.hasAttribute('data-notification-view-all') ? 'view-all' : '';
  render();
  const trigger = document.querySelector('[data-popover-trigger="notifications"]');
  if (!trigger) return;
  toggleShellPopover('notifications', trigger);
  const panel = document.querySelector('[data-popover-panel="notifications"]');
  const replacement = focusKey
    ? [...panel.querySelectorAll('[data-notification-key]')].find(item => item.dataset.notificationKey === focusKey)
    : focusControl === 'view-all'
      ? panel.querySelector('[data-notification-view-all]')
      : focusControl === 'mark-all'
        ? panel.querySelector('[data-notification-mark-all]:not([disabled])')
          || panel.querySelector('[data-notification-view-all]')
        : null;
  (replacement || panel.querySelector('[role="menuitem"]:not([disabled])'))?.focus();
}

function applyReadNotificationKeys(keys) {
  state.notificationReadKeys = [...new Set([...(state.notificationReadKeys || []), ...keys])];
  const readAt = new Date().toISOString();
  collectionState.posNotifications = all('posNotifications').map(item =>
    keys.includes(`pos:${item.id}`) ? { ...item, readAt: item.readAt || readAt } : item
  );
}

async function markAllNotificationsRead() {
  const unread = activeNotifications().filter(item => !item.isRead);
  if (!unread.length || state.notificationMarkingRead) return;
  const wasOpen = Boolean(document.querySelector('[data-popover-panel="notifications"]:not([hidden])'));
  const button = document.querySelector('[data-notification-mark-all]');
  state.notificationMarkingRead = true;
  const restoreButton = setButtonBusy(button, 'Marking read…');
  try {
    const keys = unread.map(item => item.key);
    for (let index = 0; index < keys.length; index += 500) {
      const batch = keys.slice(index, index + 500);
      await window.supabaseRecord.markNotificationsRead(batch);
      applyReadNotificationKeys(batch);
    }
    toast('Notifications marked read.');
  } catch (error) {
    console.error('Notifications could not be marked read.', error);
    toast(friendlyRpcError(error), 'error');
  } finally {
    state.notificationMarkingRead = false;
    restoreButton?.();
    if (state.view === 'notifications') render();
    else rerenderNotificationPopover(wasOpen);
  }
}

async function openNotification(key) {
  const notification = activeNotifications().find(item => item.key === key)
    || (state.view === 'notifications'
      ? notificationCenterItems().find(item => item.key === key)
      : null);
  const action = window.CostTrackLogic.notificationActionForRole(notification, state.role);
  if (!notification || !action) {
    if (notification && state.view === 'notifications') {
      try {
        await window.supabaseRecord.markNotificationsRead([notification.key]);
        applyReadNotificationKeys([notification.key]);
        toast('Notification marked read.');
        render();
      } catch (error) {
        console.error('Notification could not be marked read.', error);
        toast(friendlyRpcError(error), 'error');
      }
      return;
    }
    toast('This notification action is not available for your role.', 'error');
    return;
  }
  const button = [...document.querySelectorAll('[data-notification-key]')]
    .find(item => item.dataset.notificationKey === key);
  const restoreButton = setButtonBusy(button, 'Opening…');
  try {
    await window.supabaseRecord.markNotificationsRead([notification.key]);
    applyReadNotificationKeys([notification.key]);
  } catch (error) {
    console.error('Notification could not be marked read.', error);
    toast(friendlyRpcError(error), 'error');
  } finally {
    restoreButton?.();
  }
  closeShellPopovers(false);
  state.query = action.query || '';
  if (action.filter) {
    state.reservationFilter = action.filter;
    state.reservationDateFilter = action.filter === 'Pending' ? 'Upcoming' : 'All';
    state.reservationTypeFilter = 'All';
    state.reservationSourceFilter = 'All';
    state.reservationMealPeriodFilter = 'All';
    state.reservationFilterHighlightGroup = 'status';
  }
  if (action.recordId) state.unresolvedFocusId = action.recordId;
  state.notificationViewAll = false;
  setView(action.view);
  state.query = action.query || '';
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
  const collapseLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return `<div class="sidebar-top">
      <button class="drawer-close" type="button" data-shell-action="close-drawer" aria-label="Close navigation"><span aria-hidden="true">×</span></button>
      <div class="brand">
        <img class="brand-logo" src="images/isobel_logo.jpg" alt="Isobel Buffet Restaurant">
        <button class="sidebar-collapse" type="button" data-shell-action="toggle-sidebar" aria-label="${collapseLabel}" title="${collapseLabel}">${shellIcon('panel')}</button>
      </div>
      <div class="workspace-switcher" aria-label="Workspace">WORKSPACE</div>
    </div>
    <nav class="sidebar-nav" aria-label="Main">${overview}${groups}</nav>
    <div class="sidebar-bottom">${userMenuMarkup('sidebar')}</div>`;
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
    period.title = 'Current month. Reports use a separate date range.';
    period.setAttribute('aria-label', `Current reporting month ${month}. Display only; reports use a separate date range.`);
  }
}
function runCreateAction(actionId) {
  const action = createActions().find(item => item.id === actionId);
  if (!action) return toast('This action is not available for your role.', 'error');
  closeShellPopovers(false);
  if (actionId === 'reservation') return reservationForm();
  if (actionId === 'cashier') return setView('cashier');
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
      <h2 id="paletteTitle" class="sr-only">Search or  jump to</h2>
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
  const firstItem = panel.querySelector('[role="menuitem"]:not([disabled])');
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
function login(message = '') {
  document.querySelector('#appShell').classList.add('is-hidden');
  document.querySelector('#loginScreen').classList.remove('is-hidden');
  const recovering = passwordRecoveryMode
    || invitationAcceptanceMode
    || new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
  const emailField = `<div class="login-field"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path></svg><label class="login-sr-only" for="loginEmail">Email</label><input id="loginEmail" name="email" type="email" autocomplete="username" placeholder="Email" required></div>`;
  const passwordField = `<div class="login-field"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path><path d="M12 14v3"></path></svg><label class="login-sr-only" for="loginPassword">Password</label><input id="loginPassword" name="password" type="password" autocomplete="current-password" placeholder="Password" required><button class="login-password-toggle" type="button" data-login-password-toggle aria-label="Show password" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.2-6 9.5-6 9.5 6 9.5 6-3.2 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg></button></div>`;
  const recoveryField = `<div class="login-field"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path><path d="M12 14v3"></path></svg><label class="login-sr-only" for="recoveryPassword">New password</label><input id="recoveryPassword" name="password" type="password" minlength="8" autocomplete="new-password" placeholder="New password" required></div>`;
  const formMarkup = recovering
    ? `<form id="passwordRecoveryForm">${recoveryField}<button class="primary-btn" type="submit">Update password</button></form>`
    : `<form id="loginForm">${emailField}${passwordField}<button class="primary-btn" type="submit">Log in</button></form><button class="link-button" id="resetPasswordButton" type="button">Forgot password?</button><small class="login-note">Accounts are created by your administrator.</small>`;
  document.querySelector('#loginScreen').innerHTML = `<section class="login-card"><div class="login-card-content"><div class="eyebrow">${recovering ? 'ACCOUNT SECURITY' : 'STAFF SIGN IN'}</div><h1>${recovering ? 'Create a new password' : 'Sign in to your workspace'}</h1>${message ? `<p class="auth-message" role="alert">${esc(message)}</p>` : ''}${formMarkup}</div></section><section class="login-art" aria-label="Welcome to Isobel Buffet Restaurant"><div class="login-art-content"><img class="login-art-logo" src="images/isobel_logo.jpg" alt="Isobel Buffet Restaurant"><h2>Welcome back to isobel</h2><p>Buffet Restaurant Operations</p></div></section>`;
}
function metric(label, value, icon, tone, foot) { return `<div class="metric-card"><div class="metric-top"><span>${label}</span><i class="metric-icon ${tone}">${icon}</i></div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`; }
function pageHeader(eyebrow, title, subtitle, action = '') { return `<div class="page-header"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`; }
function tablePage(config) {
  const rows = config.rows || [];
  const emptyMessage = config.emptyMessage || 'No records found. Add your first record to get started.';
  const tableClass = config.tableClass ? ` ${esc(config.tableClass)}` : '';
  const tableId = config.tableId || String(config.title || 'records').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const pageSize = Number(config.pageSize || state.tablePageSize || 10);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(Math.max(1, Number(state.tablePages[tableId] || 1)), pageCount);
  state.tablePages[tableId] = currentPage;
  const pagedRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const mobileLabels = config.mobileLabels || config.headers;
  const mobileHidden = new Set(config.mobileHidden || []);
  const mobileRows = pagedRows.map(row => {
    let index = 0;
    return row.replace(/<td([^>]*)>/g, (cell, attributes) => {
      const label = mobileLabels[index];
      const hidden = mobileHidden.has(config.headers[index]) ? ' data-mobile-hidden="true"' : '';
      index += 1;
      return label
        ? `<td${attributes} data-label="${esc(label)}"${hidden}>`
        : cell;
    });
  });
  const headerMarkup = config.headers.map(item =>
    `<th${mobileHidden.has(item) ? ' class="mobile-hidden-cell"' : ''}>${item}</th>`
  ).join('');
  const startPage = Math.max(1, Math.min(currentPage - 2, pageCount - 4));
  const endPage = Math.min(pageCount, startPage + 4);
  const pageButtons = Array.from({ length: endPage - startPage + 1 }, (_, offset) => {
    const page = startPage + offset;
    return `<button type="button" class="${page === currentPage ? 'active' : ''}" data-table-page="${page}" data-table-id="${esc(tableId)}" ${page === currentPage ? 'aria-current="page"' : ''}>${page}</button>`;
  }).join('');
  const pagination = rows.length
    ? `<div class="table-pagination" aria-label="${esc(config.title || 'Table')} pagination"><button type="button" class="ghost-btn compact-btn" data-table-page="${currentPage - 1}" data-table-id="${esc(tableId)}" ${currentPage <= 1 ? 'disabled' : ''}>Previous</button><div class="table-page-numbers">${pageButtons}</div><button type="button" class="ghost-btn compact-btn" data-table-page="${currentPage + 1}" data-table-id="${esc(tableId)}" ${currentPage >= pageCount ? 'disabled' : ''}>Next</button></div>`
    : '';
  return `${pageHeader(config.eyebrow, config.title, config.subtitle, config.action)}${config.beforeTable || ''}<div class="toolbar"><div class="search-box">⌕<input id="tableSearch" placeholder="Search ${config.search || 'records'}..." value="${esc(state.query)}"></div>${config.filters || ''}<span class="record-count">${rows.length} records</span></div><div class="panel table-panel${tableClass}"><div class="table-scroll"><table data-table="${esc(tableId)}"><thead><tr>${headerMarkup}</tr></thead><tbody>${mobileRows.length ? mobileRows.join('') : `<tr><td colspan="${config.headers.length}" class="empty-state">${esc(emptyMessage)}</td></tr>`}</tbody></table></div>${pagination}</div>`;
}
function stockStatus(item) { return item.stock <= 0 ? 'Out of Stock' : item.stock <= item.minimum ? 'Low Stock' : 'Healthy'; }
function ingredientStockStatusClass(status) {
  return status === 'Healthy' ? 'status-good' : status === 'Out of Stock' ? 'status-out' : 'status-low';
}
function formatStockQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity)
    ? new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(quantity)
    : '—';
}
function inventoryMovementPeriods(businessDate) {
  const dateOffset = (date, offset) => {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  const currentStart = dateOffset(businessDate, -6);
  const previousStart = dateOffset(businessDate, -13);
  const previousEnd = dateOffset(businessDate, -7);
  const transactions = all('inventoryTransactions').filter(item => item.date);
  return {
    forIngredients(ingredientIds) {
      const matches = transactions.filter(item => ingredientIds.has(String(item.ingredientId)));
      const current = matches.filter(item => item.date >= currentStart && item.date <= businessDate);
      const previous = matches.filter(item => item.date >= previousStart && item.date <= previousEnd);
      return { current: current.length, previous: previous.length };
    },
    value: (() => {
      const total = items => items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitCost || 0), 0);
      const current = transactions.filter(item => item.date >= currentStart && item.date <= businessDate);
      const previous = transactions.filter(item => item.date >= previousStart && item.date <= previousEnd);
      return { current: total(current), previous: total(previous) };
    })()
  };
}
function inventoryTrendMarkup(current, previous, label) {
  const difference = current - previous;
  const direction = difference > 0 ? 'up' : difference < 0 ? 'down' : 'steady';
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  const trendValue = label === 'movements'
    ? `${current} stock movements vs ${previous} last week`
    : `${money(Math.abs(difference))} net stock-movement value vs last week`;
  return `<span class="inventory-trend inventory-trend-${direction}"><span aria-hidden="true">${arrow}</span> ${trendValue}</span>`;
}
function inventoryActivityDateLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' })
    .format(new Date(`${value}T12:00:00`));
}
function roleDashboard() {
  const ingredients = all('ingredients').filter(item => item.isActive !== false);
  const out = ingredients.filter(item => stockStatus(item) === 'Out of Stock').length;
  const low = ingredients.filter(item => stockStatus(item) === 'Low Stock').length;
  const healthy = ingredients.filter(item => stockStatus(item) === 'Healthy').length;
  const recipes = all('recipes');
  const activeRecipes = recipes.filter(window.CostTrackLogic.isRecipeActive);
  const canSeeRecipeCosts = ['Administrator', 'Manager'].includes(state.role);
  const businessDate = manilaBusinessToday();
  const todayDate = businessDate;
  const movementPeriods = inventoryMovementPeriods(businessDate);
  const inventoryMovementValueTrend = inventoryTrendMarkup(movementPeriods.value.current, movementPeriods.value.previous, 'value');
  const inventoryRoles = ['Administrator', 'Manager', 'Inventory Clerk'].includes(state.role);
  const ingredientById = new Map(ingredients.map(item => [String(item.id), item]));
  const batchesByIngredient = new Map();
  all('inventoryBatches').forEach(batch => {
    const productId = String(batch.productId);
    const productBatches = batchesByIngredient.get(productId) || [];
    productBatches.push(batch);
    batchesByIngredient.set(productId, productBatches);
  });
  const nearestExpiryByIngredient = new Map();
  ingredients.forEach(item => {
    const productBatches = batchesByIngredient.get(String(item.id)) || [];
    if (!productBatches.length) return;
    const snapshot = inventoryBatchVisibility(productBatches, businessDate);
    if (snapshot.nearestExpiry) nearestExpiryByIngredient.set(String(item.id), snapshot.nearestExpiry);
  });
  const expiringBatches = all('inventoryBatches')
    .map(batch => ({
      batch,
      product: ingredientById.get(String(batch.productId)),
      expiry: window.CostTrackLogic.batchStatus(batch, businessDate, 7)
    }))
    .filter(item => item.product && item.expiry.daysUntilExpiry != null
      && item.expiry.daysUntilExpiry >= 0
      && item.expiry.daysUntilExpiry <= 7
      && item.expiry.status !== 'Expired')
    .sort((left, right) => left.expiry.daysUntilExpiry - right.expiry.daysUntilExpiry);
  const earliestExpiryByIngredient = new Map();
  expiringBatches.forEach(item => {
    const productId = String(item.product.id);
    if (!earliestExpiryByIngredient.has(productId)) earliestExpiryByIngredient.set(productId, item);
  });
  const expiringIngredients = [...earliestExpiryByIngredient.values()];
  const expiringTodayCount = new Set(expiringIngredients
    .filter(item => item.expiry.daysUntilExpiry === 0)
    .map(item => String(item.product.id))).size;
  const expiringThreeDayCount = new Set(expiringIngredients
    .filter(item => item.expiry.daysUntilExpiry <= 3)
    .map(item => String(item.product.id))).size;
  const expiringSevenDayCount = expiringIngredients.length;
  const expiredBatchCount = all('inventoryBatches').filter(batch =>
    window.CostTrackLogic.batchStatus(batch, businessDate, 7).status === 'Expired'
  ).length;
  const productionToday = all('productionLogs').filter(item => item.date === todayDate).length;
  const wasteToday = all('wasteLogs').filter(item => item.date === todayDate).length;
  const counts = all('physicalCounts');
  const shortages = counts.filter(item => item.actual < item.expected).length;
  const roleCopy = {
    Administrator: ['Overview', 'Here’s what is happening across Isobel today.'],
    Manager: ['Operational summary', 'Monitor cost, stock health, waste, and variance.'],
    'Inventory Clerk': ['Inventory control center', 'Keep supplies accurate, available, and ready for service.'],
    'Chef / Kitchen Staff': ['Kitchen workspace', 'Focus on recipes, production, and waste during today’s shift.'],
    Receptionist: ['Front-of-house workspace', 'Keep reservations, arrivals, and table assignments moving smoothly.']
  };
  const [eyebrow, subtitle] = roleCopy[state.role];
  const reservations = all('reservations');
  const pendingReservations = reservations.filter(item =>
    item.status === 'Pending' && (!item.date || item.date >= businessDate)
  );
  const checkedInReservations = reservations.filter(item => item.status === 'Seated').length;
  const todayReservations = reservations.filter(item => item.date === todayDate);
  const todayWalkIns = todayReservations.filter(item => item.type === 'Walk-in').length;
  const seatedCovers = todayReservations.filter(item => item.status === 'Seated').reduce((sum, item) => sum + Number(item.actualCovers || item.guests || 0), 0);
  const now = new Date();
  const [currentHour, currentMinute] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(now).split(':').map(Number);
  const currentMinutes = currentHour * 60 + currentMinute;
  const isArrivingSoon = item => {
    if (item.date !== todayDate || item.status !== 'Confirmed') return false;
    const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(item.time || '');
    if (!time) return false;
    const arrivalMinutes = Number(time[1]) * 60 + Number(time[2]);
    return arrivalMinutes >= currentMinutes && arrivalMinutes <= currentMinutes + 120;
  };
  const unassignedToday = todayReservations.filter(item =>
    ['Pending', 'Confirmed'].includes(item.status) && !item.table
  ).length;
  const arrivingSoon = todayReservations.filter(isArrivingSoon).length;
  const prioritizedReservations = todayReservations.slice().sort((left, right) => {
    const priority = item => item.status === 'Pending' ? 0
      : !item.table && item.status === 'Confirmed' ? 1
      : isArrivingSoon(item) ? 2
      : 3;
    return priority(left) - priority(right) || (left.time || '').localeCompare(right.time || '');
  }).slice(0, 4);
  const businessDateLabel = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(now);
  const revenueData = revenueDashboardData || {};
  const revenueLoadingLabel = revenueDashboardError ? 'Unavailable' : revenueDashboardLoading || !revenueDashboardData ? 'Loading…' : null;
  const revenueDashboardCards = [
    metric("Today's Revenue", revenueLoadingLabel || money(revenueData.today_revenue), shellIcon('peso'), 'green-icon', revenueDashboardError ? 'Unable to load POS report' : 'Closed POS bills · Manila business date'),
    metric('Closed Bills', revenueLoadingLabel || Number(revenueData.closed_bill_count || 0).toLocaleString(), shellIcon('bill-list'), 'purple-icon', 'Counted once by closed bill'),
    metric('Customers Served', revenueLoadingLabel || Number(revenueData.customers_served || 0).toLocaleString(), shellIcon('person'), 'purple-icon', 'Actual bill head counts'),
    metric('Average Check', revenueLoadingLabel || money(revenueData.average_check), shellIcon('trend-up'), 'green-icon', 'Net revenue per closed bill'),
    metric('Discount Total', revenueLoadingLabel || money(revenueData.discount_total), shellIcon('minus'), 'orange-icon', 'Closed bills only'),
    metric('Voided Bills', revenueLoadingLabel || Number(revenueData.voided_bill_count || 0).toLocaleString(), shellIcon('alert'), 'red-icon', `${money(revenueData.voided_bill_amount)} reversed sales`),
    metric('Voided Bill Amount', revenueLoadingLabel || money(revenueData.voided_bill_amount), shellIcon('peso'), 'red-icon', 'Shown separately · excluded from revenue')
  ];
  const cards = state.role === 'Receptionist'
    ? [metric("Today's reservations", todayReservations.length, shellIcon('calendar'), 'orange-icon', `${pendingReservations.length} awaiting confirmation`), metric('Guests expected', todayReservations.reduce((sum, item) => sum + Number(item.guests), 0), shellIcon('person'), 'green-icon', 'Across today’s bookings'), metric('Checked in', checkedInReservations, shellIcon('check'), 'purple-icon', 'Guests currently seated'), metric('Open tables', all('restaurantTables').filter(table => table.status !== 'Needs cleaning' && ['Available', 'Reserved Later'].includes(liveTableAvailability(table, todayDate, reservations).status)).length, shellIcon('home'), 'orange-icon', 'Includes tables with a safe gap before reservations')]
    : state.role === 'Chef / Kitchen Staff'
    ? (() => {
      const todayRows = state.productionBoard.loaded
        ? state.productionBoard.rows.filter(item => item.serviceDate === todayDate)
        : [];
      const target = activeRecipes.reduce((sum, item) => sum + Number(item.prepTarget || 30), 0);
      const cooking = todayRows.filter(item => item.status === 'Cooking').reduce((sum, item) => sum + Number(item.expectedCovers || 0), 0);
      const ready = todayRows.filter(item => item.status === 'Ready').reduce((sum, item) => sum + Number(item.expectedCovers || 0), 0);
      const preparedWasteToday = all('preparedFoodWasteLogs').filter(item => item.date === todayDate)
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const lowStockToday = ingredients.filter(item => ['Out of Stock', 'Low Stock'].includes(stockStatus(item))).length;
      return [
        metric("Today's production target", target, shellIcon('chef-hat'), 'purple-icon', `${activeRecipes.length} active recipes`),
        metric('Cooking portions', cooking, shellIcon('clock'), 'orange-icon', 'Currently in progress'),
        metric('Ready portions', ready, shellIcon('check'), 'green-icon', 'Available for service'),
        metric('Remaining portions', Math.max(0, target - ready - cooking), shellIcon('trend-up'), 'purple-icon', 'Target less ready and cooking'),
        metric('Ingredient waste today', all('wasteLogs').filter(item => item.date === todayDate).length, shellIcon('trash'), 'red-icon', 'Raw ingredient entries'),
        metric('Prepared waste today', preparedWasteToday, shellIcon('trash'), 'red-icon', 'Discarded prepared portions'),
        metric('Low stock alerts', lowStockToday, shellIcon('alert'), 'orange-icon', 'Out of stock or below minimum')
      ];
    })()
    : state.role === 'Inventory Clerk'
      ? (() => {
        const statusMovement = status => movementPeriods.forIngredients(new Set(
          ingredients.filter(item => stockStatus(item) === status).map(item => item.id)
        ));
        const outTrend = statusMovement('Out of Stock');
        const lowTrend = statusMovement('Low Stock');
        const healthyTrend = statusMovement('Healthy');
        return [
          metric('Out of stock items', out, shellIcon('alert'), 'red-icon', `Immediate replenishment needed${inventoryTrendMarkup(outTrend.current, outTrend.previous, 'movements')}`),
          metric('Low stock items', low, shellIcon('trend-down'), 'orange-icon', `Below minimum level${inventoryTrendMarkup(lowTrend.current, lowTrend.previous, 'movements')}`),
          metric('Healthy stock items', healthy, shellIcon('check'), 'green-icon', `At safe stock level${inventoryTrendMarkup(healthyTrend.current, healthyTrend.previous, 'movements')}`),
          metric('Total ingredients', ingredients.length, shellIcon('package'), 'purple-icon', `${money(inventoryValue())} inventory value`)
        ];
      })()
      : canAccessRevenue()
        ? revenueDashboardCards
        : [metric('Low stock items', low + out, shellIcon('alert'), 'red-icon', 'Needs attention')];
  const recipeCategories = [...new Set(activeRecipes.map(item => item.category))];
  const kitchenPanel = `<div class="panel"><div class="panel-header"><div><div class="panel-title">Kitchen activity</div><div class="panel-subtitle">Active recipes and production by category</div></div><button class="text-btn" data-view="production">Open production board →</button></div><div class="dashboard-list">${activeRecipes.slice(0, 5).map(item => `<div class="dashboard-list-row"><span class="recipe-icon">◇</span><div><strong>${esc(item.name)}</strong><small>${esc(item.category)} · ${item.ingredients.length} ingredients</small></div>${canSeeRecipeCosts ? `<span class="tag">${money(recipePortionCost(item))} / portion</span>` : ''}</div>`).join('') || '<p class="panel-subtitle">No active recipes are available.</p>'}</div><div class="category-chips">${recipeCategories.map(item => `<span>${esc(item)}</span>`).join('')}</div></div>`;
  const costAnalytics = ['Administrator', 'Manager'].includes(state.role)
    ? `<div class="panel dashboard-cost-analytics"><div class="panel-header"><div><div class="panel-title">Inventory valuation &amp; cost analytics</div><div class="panel-subtitle">Current stock value and costs recorded today</div></div><button class="text-btn" data-view="reports">Open Reports</button></div><div class="inventory-valuation-hero"><span>Inventory value</span><strong>${money(inventoryValue())}</strong><small>Current stock × unit cost</small>${inventoryMovementValueTrend}</div><div class="analytics-stack"><div><span>Logged production cost <small> · ${productionToday} batches</small></span><strong>${money(productionCost(todayDate))}</strong></div><div><span>Logged waste cost <small> · ${wasteToday} entries</small></span><strong>${money(wasteCost(todayDate))}</strong></div></div></div>`
    : state.role === 'Inventory Clerk'
      ? `<div class="panel dashboard-cost-analytics"><div class="panel-header"><div><div class="panel-title">Inventory valuation</div><div class="panel-subtitle">Current stock multiplied by unit cost</div></div><button class="text-btn" data-view="reports">Open Reports</button></div><div class="inventory-valuation-hero"><span>Inventory value</span><strong>${money(inventoryValue())}</strong><small>Current stock × unit cost</small>${inventoryMovementValueTrend}</div></div>`
    : '';
  const reservationPanel = `<div class="panel reservation-summary-panel"><div class="panel-header"><div><div class="panel-title">Reservation service</div><div class="reservation-attention-summary" role="group" aria-label="Reservation attention summary"><span><strong>${todayReservations.length}</strong> today</span><span><strong>${pendingReservations.length}</strong> pending approval</span><span><strong>${unassignedToday}</strong> unassigned today</span><span><strong>${arrivingSoon}</strong> arriving in 2 hours</span></div></div><button class="text-btn" data-view="reservations">Manage reservations</button></div><div class="dashboard-list">${prioritizedReservations.map(item => `<div class="dashboard-list-row"><span class="ingredient-dot">${esc(item.name.charAt(0))}</span><div><strong>${esc(item.name)}</strong><small>${esc(item.time)} · ${item.guests} guests · ${esc(item.table || 'Unassigned')}</small></div><span class="status">${esc(item.status)}</span></div>`).join('') || '<p class="panel-subtitle">No reservations scheduled for today.</p>'}</div></div>`;
  const hasPriorityAlerts = out > 0 || low > 0 || expiringSevenDayCount > 0 || expiredBatchCount > 0;
  const priorityAlerts = inventoryRoles
    ? `<section class="inventory-priority-panel" aria-labelledby="inventory-priority-title"><div class="inventory-priority-heading"><div><div class="eyebrow">Daily inventory focus</div><h2 id="inventory-priority-title">Priority alerts</h2></div><span class="inventory-alert-count">${hasPriorityAlerts ? 'Needs attention' : 'All clear'}</span></div><div class="inventory-priority-alerts">
        <button type="button" class="inventory-priority-alert is-critical" data-dashboard-status="Out of Stock"><span class="inventory-alert-symbol" aria-hidden="true">!</span><span><strong>${out} out of stock</strong><small>Items at zero on-hand quantity</small></span><span class="inventory-alert-arrow" aria-hidden="true">→</span></button>
        <button type="button" class="inventory-priority-alert is-warning" data-dashboard-status="Low Stock"><span class="inventory-alert-symbol" aria-hidden="true">!</span><span><strong>${low} low stock</strong><small>Items at or below minimum</small></span><span class="inventory-alert-arrow" aria-hidden="true">→</span></button>
        <div class="inventory-priority-alert is-expiry"><span class="inventory-alert-symbol" aria-hidden="true">◷</span><span><strong>${expiringSevenDayCount} expiring soon</strong><small>Ingredients with dated stock in 7 days</small></span></div>
        ${expiredBatchCount ? `<div class="inventory-priority-alert is-critical"><span class="inventory-alert-symbol" aria-hidden="true">!</span><span><strong>${expiredBatchCount} expired lots</strong><small>Review expired stock batches</small></span></div>` : ''}
      </div></section>`
    : '';
  const inventoryHealthRows = ingredients
    .map(item => ({
      item,
      status: stockStatus(item),
      nearestExpiry: nearestExpiryByIngredient.get(String(item.id)) || null
    }))
    .filter(row => state.ingredientStatus === 'All' || row.status === state.ingredientStatus)
    .sort((left, right) => {
      const statusPriority = { 'Out of Stock': 0, 'Low Stock': 1, Healthy: 2 };
      const statusDifference = statusPriority[left.status] - statusPriority[right.status];
      if (statusDifference) return statusDifference;
      const leftExpiry = left.nearestExpiry?.expiry.daysUntilExpiry ?? Infinity;
      const rightExpiry = right.nearestExpiry?.expiry.daysUntilExpiry ?? Infinity;
      return leftExpiry - rightExpiry || String(left.item.name).localeCompare(String(right.item.name));
    })
    .slice(0, 8);
  const inventoryHealthPanel = `<div class="panel inventory-health-panel"><div class="panel-header"><div><div class="panel-title">Inventory health</div><div class="panel-subtitle">Current stock, nearest expiry, and status</div></div><button class="text-btn" data-view="ingredients">Manage inventory</button></div><div class="quick-filters inventory-health-filters">${['All', 'Out of Stock', 'Low Stock', 'Healthy'].map(item => `<button type="button" class="${state.ingredientStatus === item ? 'active' : ''} ${item === 'Out of Stock' ? 'filter-out' : item === 'Low Stock' ? 'filter-low' : item === 'Healthy' ? 'filter-healthy' : ''}" data-inventory-health-filter="${item}" aria-pressed="${state.ingredientStatus === item}">${item}<b>${item === 'All' ? ingredients.length : ingredients.filter(x => stockStatus(x) === item).length}</b></button>`).join('')}</div><div class="inventory-health-table-wrap"><table class="inventory-health-table"><thead><tr><th scope="col">Ingredient</th><th scope="col">Current stock</th><th scope="col">Days to expiry</th><th scope="col">Status</th></tr></thead><tbody>${inventoryHealthRows.map(({ item, status, nearestExpiry }) => {
    const expiryDays = nearestExpiry?.expiry.daysUntilExpiry;
    const expiryTone = !nearestExpiry ? 'is-neutral'
      : nearestExpiry.expiry.status === 'Expired' ? 'is-expired'
        : expiryDays <= 3 ? 'is-soon'
          : expiryDays <= 7 ? 'is-warning'
            : 'is-healthy';
    const statusTone = status === 'Healthy' ? 'status-good' : status === 'Out of Stock' ? 'status-out' : 'status-low';
    return `<tr data-view="ingredients"><td data-label="Ingredient"><strong class="inventory-health-item-name">${esc(item.name)}</strong></td><td data-label="Current stock"><span class="inventory-health-stock"><strong>${formatStockQuantity(item.stock)} ${esc(item.unit)}</strong><small>Minimum ${formatStockQuantity(item.minimum)} ${esc(item.unit)}</small></span></td><td data-label="Days to expiry"><span class="inventory-health-expiry ${expiryTone}">${esc(nearestExpiry ? inventoryExpiryLabel(expiryDays) : 'Not tracked')}</span></td><td data-label="Status"><span class="status ${statusTone}">${status}</span></td></tr>`;
  }).join('') || '<tr><td class="inventory-health-empty" colspan="4">No ingredients match this status.</td></tr>'}</tbody></table></div></div>`;
  const expiringSoonPanel = `<section class="panel inventory-expiring-panel" aria-labelledby="inventory-expiring-title"><div class="panel-header"><div><div class="panel-title" id="inventory-expiring-title">Expiring soon</div><div class="panel-subtitle">Prioritized by the earliest dated stock</div></div><span class="inventory-panel-icon inventory-expiry-icon" aria-hidden="true">◷</span></div><div class="inventory-expiry-summary"><div><strong>${expiringTodayCount}</strong><span>Expiring today</span></div><div><strong>${expiringThreeDayCount}</strong><span>In the next 3 days</span></div><div><strong>${expiringSevenDayCount}</strong><span>In the next 7 days</span></div></div><div class="inventory-expiring-list">${expiringIngredients.slice(0, 5).map(({ batch, product, expiry }) => `<div class="inventory-expiring-row ${expiry.daysUntilExpiry === 0 ? 'is-today' : ''}"><span class="inventory-expiry-mark ${expiry.daysUntilExpiry === 0 ? 'is-today' : expiry.daysUntilExpiry <= 3 ? 'is-soon' : ''}" aria-hidden="true">!</span><div><strong>${esc(product.name)}</strong><small>${formatStockQuantity(batch.quantityRemaining)} ${esc(product.unit)} · ${esc(inventoryBatchLabel(batch))}</small></div><span class="inventory-expiry-days">${expiry.daysUntilExpiry === 0 ? 'Today' : `${expiry.daysUntilExpiry} day${expiry.daysUntilExpiry === 1 ? '' : 's'}`}</span></div>`).join('') || '<p class="inventory-empty-state">No ingredients are due to expire in the next 7 days.</p>'}</div></section>`;
  const recentInventoryActivities = [
    ...all('inventoryTransactions').map(item => ({
      date: item.date || '',
      kind: Number(item.quantity) > 0 ? 'Received' : (item.type || 'Adjusted'),
      name: ingredientById.get(String(item.ingredientId))?.name || 'Inventory item',
      detail: `${Number(item.quantity) > 0 ? '+' : ''}${formatStockQuantity(item.quantity)} ${ingredientById.get(String(item.ingredientId))?.unit || ''}`.trim(),
      time: item.date || ''
    })),
    ...counts.map(item => ({
      date: item.date || '',
      kind: 'Counted',
      name: ingredientById.get(String(item.ingredientId))?.name || 'Inventory item',
      detail: `Physical count · ${formatStockQuantity(item.actual)} ${ingredientById.get(String(item.ingredientId))?.unit || ''}`,
      time: item.date || ''
    }))
  ].sort((left, right) => right.date.localeCompare(left.date));
  const recentActivityPanel = `<section class="panel inventory-activity-panel" aria-labelledby="inventory-activity-title"><div class="panel-header"><div><div class="panel-title" id="inventory-activity-title">Recent activity</div><div class="panel-subtitle">Latest inventory movements and counts</div></div><span class="inventory-panel-icon" aria-hidden="true">↻</span></div><div class="inventory-activity-list">${recentInventoryActivities.slice(0, 5).map(item => `<div class="inventory-activity-row"><span class="inventory-activity-dot ${item.kind === 'Received' ? 'is-received' : item.kind === 'Counted' ? 'is-counted' : 'is-adjusted'}" aria-hidden="true">${item.kind === 'Received' ? '+' : item.kind === 'Counted' ? '✓' : '−'}</span><div><strong>${esc(item.kind)} · ${esc(item.name)}</strong><small>${esc(item.detail)}</small></div><time${item.time ? ` datetime="${esc(item.time)}"` : ''}>${esc(inventoryActivityDateLabel(item.time))}</time></div>`).join('') || '<p class="inventory-empty-state">Inventory activity will appear here when stock is received, adjusted, or counted.</p>'}</div></section>`;
  const revenueDashboardErrorPanel = canAccessRevenue() && revenueDashboardError
    ? `<div class="panel error-state" role="alert">${esc(revenueDashboardError)} <button class="ghost-btn" data-action="retry-revenue-dashboard">Retry dashboard</button></div>`
    : '';
  const fohMetrics = canAccess('reservations') ? `<div class="panel"><div class="panel-title">Front-of-house today</div><div class="metric-grid compact-metric-grid">${metric('Reservations', todayReservations.length, shellIcon('calendar'), 'orange-icon', 'Scheduled today')}${metric('Walk-ins', todayWalkIns, shellIcon('person'), 'purple-icon', 'Recorded today')}${metric('Seated covers', seatedCovers, shellIcon('check'), 'green-icon', 'Currently seated')}</div></div>` : '';
  const inventoryDashboardPanels = `<div class="dashboard-grid inventory-control-grid">${inventoryHealthPanel}<div class="inventory-dashboard-side-rail">${expiringSoonPanel}${recentActivityPanel}</div></div>`;
  const operationalPanels = state.role === 'Inventory Clerk'
    ? inventoryDashboardPanels
    : state.role === 'Manager'
      ? `${inventoryDashboardPanels}<div class="dashboard-grid">${reservationPanel}</div>`
      : `${inventoryDashboardPanels}<div class="dashboard-grid">${reservationPanel}</div>`;
  return `<div class="welcome-row"><div><div class="eyebrow">${eyebrow}</div><h1>${dashboardGreeting()}</h1><p>${subtitle}</p><p class="dashboard-date">Business date · <time datetime="${businessDate}">${esc(businessDateLabel)}</time></p></div>${state.role === 'Receptionist' ? '<button class="primary-btn" data-action="open-reservation">+ New reservation</button>' : state.role === 'Inventory Clerk' || state.role === 'Administrator' || state.role === 'Manager' ? '<button class="primary-btn" data-action="open-receiving">+ Receive inventory</button>' : '<button class="primary-btn" data-view="production">Open production board</button>'}</div>${priorityAlerts}${revenueDashboardErrorPanel}<div class="metric-grid role-metric-grid">${cards.join('')}</div>${fohMetrics}${state.role === 'Receptionist' ? `<div class="dashboard-grid">${reservationPanel}<div class="panel"><div class="panel-title">Front-of-house checklist</div><div class="checklist"><span>✓ Confirm pending bookings</span><span>○ Check in arriving guests</span><span>○ Review table assignments</span></div></div></div>` : state.role === 'Chef / Kitchen Staff' ? `<div class="dashboard-grid">${kitchenPanel}<div class="panel"><div class="panel-title">Today’s kitchen checklist</div><div class="checklist"><span>✓ Review today’s prep targets</span><span>○ Start a batch from the production board</span><span>○ Mark each cooked batch ready</span></div></div></div>` : operationalPanels}${state.role === 'Chef / Kitchen Staff' ? '' : costAnalytics}`;
}
function inventoryBatchVisibility(productBatches, asOfDate = manilaBusinessToday()) {
  const classified = productBatches.map(batch => ({
    batch,
    expiry: window.CostTrackLogic.batchStatus(batch, asOfDate, 3)
  }));
  const eligible = classified
    .filter(({ expiry }) => ['Active', 'Expiring soon'].includes(expiry.status))
    .map(({ batch }) => batch);
  const fifoOrder = window.CostTrackLogic.orderBatches(eligible, 'FIFO');
  const fefoOrder = window.CostTrackLogic.orderBatches(eligible, 'FEFO');
  const fifoIds = new Set(fifoOrder.map(batch => String(batch.id)));
  const otherBatches = window.CostTrackLogic.orderBatches(
    classified.filter(({ batch }) => !fifoIds.has(String(batch.id))).map(({ batch }) => batch),
    'FIFO'
  );
  const expiryOrdered = classified
    .filter(({ batch, expiry }) => Number(batch.quantityRemaining || 0) > 0
      && expiry.status !== 'Voided'
      && expiry.status !== 'Depleted'
      && (batch.expirationDate || batch.expiration_date))
    .sort((left, right) => String(left.batch.expirationDate || left.batch.expiration_date)
      .localeCompare(String(right.batch.expirationDate || right.batch.expiration_date)));
  return {
    classified,
    fifoOrder,
    fefoOrder,
    orderedBatches: [...fifoOrder, ...otherBatches],
    nearestExpiry: expiryOrdered[0] || null,
    expiringSoonCount: classified.filter(({ expiry }) => expiry.status === 'Expiring soon').length,
    expiredCount: classified.filter(({ expiry }) => expiry.status === 'Expired').length
  };
}

function inventoryBatchLabel(batch) {
  return batch.batchCode || `Batch ${String(batch.id || '').slice(0, 8)}`;
}

function inventoryExpiryLabel(daysUntilExpiry) {
  if (daysUntilExpiry == null) return '—';
  if (daysUntilExpiry < 0) {
    const daysOverdue = Math.abs(daysUntilExpiry);
    return `Expired ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} ago`;
  }
  if (daysUntilExpiry === 0) return 'Expires today';
  return `Expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`;
}

function inventoryCardBatchIntelligence(snapshot) {
  const nearest = snapshot.nearestExpiry;
  const daysUntilExpiry = nearest?.expiry.daysUntilExpiry;
  const urgency = nearest?.expiry.status === 'Expired' || (daysUntilExpiry != null && daysUntilExpiry < 0)
    ? 'is-expired'
    : daysUntilExpiry != null && daysUntilExpiry <= 7
      ? 'is-warning'
      : nearest
        ? 'is-healthy'
        : 'is-neutral';
  const expiryText = nearest ? inventoryExpiryLabel(daysUntilExpiry) : 'No expiry date tracked';
  const fifoFirst = snapshot.fifoOrder[0];
  const receivedDate = fifoFirst?.receivedDate || fifoFirst?.received_date;
  const receivedDateLabel = receivedDate
    ? inventoryActivityDateLabel(String(receivedDate).slice(0, 10))
    : '';
  return `<div class="inventory-card-intelligence" aria-label="Batch priority and expiration">
    <div class="inventory-card-expiry"><small>Expiration</small><span class="inventory-expiry-indicator ${urgency}">${esc(expiryText)}</span></div>
    <div class="inventory-first-use"><small>FIFO batch</small><strong>${fifoFirst ? esc(inventoryBatchLabel(fifoFirst)) : 'No active batch'}</strong>${receivedDateLabel ? `<span>Received ${esc(receivedDateLabel)}</span>` : ''}</div>
  </div>`;
}

function ingredientCardsPage() {
  const ingredients = all('ingredients');
  const batchesByProduct = new Map();
  all('inventoryBatches').forEach(batch => {
    const productId = String(batch.productId);
    const productBatches = batchesByProduct.get(productId) || [];
    productBatches.push(batch);
    batchesByProduct.set(productId, productBatches);
  });
  const batchSnapshots = new Map(ingredients.map(item => [
    String(item.id),
    inventoryBatchVisibility(batchesByProduct.get(String(item.id)) || [])
  ]));
  const hasExpiryWithinSevenDays = item => batchSnapshots.get(String(item.id))?.classified.some(({ batch, expiry }) => (
    Number(batch.quantityRemaining || 0) > 0
    && ['Active', 'Expiring soon'].includes(expiry.status)
    && expiry.daysUntilExpiry != null
    && expiry.daysUntilExpiry >= 0
    && expiry.daysUntilExpiry <= 7
  )) || false;
  const categories = [...new Set(ingredients.map(item => item.category))];
  const units = [...new Set(ingredients.map(item => item.unit))];
  const filtered = ingredients.filter(item => {
    const queryMatch = `${item.name} ${item.category}`.toLowerCase().includes(state.query.toLowerCase());
    const stockStatusMatch = state.ingredientStatus === 'All' || stockStatus(item) === state.ingredientStatus;
    const expiryMatch = !state.ingredientExpiryFilter || hasExpiryWithinSevenDays(item);
    return queryMatch
      && (state.ingredientCategory === 'All' || item.category === state.ingredientCategory)
      && (state.ingredientUnit === 'All' || item.unit === state.ingredientUnit)
      && stockStatusMatch
      && expiryMatch;
  });
  const canSeeCost = ['Administrator', 'Manager', 'Inventory Clerk'].includes(state.role);
  const canManageProducts = window.CostTrackLogic.canPerformInventoryAction(state.role, 'product.manage');
  const sorted = filtered.slice().sort((a, b) => {
    if (state.ingredientExpiryFilter) {
      const expiryA = batchSnapshots.get(String(a.id))?.nearestExpiry?.expiry.daysUntilExpiry ?? Infinity;
      const expiryB = batchSnapshots.get(String(b.id))?.nearestExpiry?.expiry.daysUntilExpiry ?? Infinity;
      if (expiryA !== expiryB) return expiryA - expiryB;
    }
    const key = state.ingredientSort === 'stock' ? Number(a.stock) - Number(b.stock) : state.ingredientSort === 'cost' ? Number(a.cost) - Number(b.cost) : state.ingredientSort === 'status' ? stockStatus(a).localeCompare(stockStatus(b)) : a.name.localeCompare(b.name);
    return state.ingredientSortDirection === 'asc' ? key : -key;
  });
  const toggle = `<button class="ghost-btn compact-btn" data-action="toggle-ingredient-view">${state.ingredientView === 'cards' ? 'Table view' : 'Card view'}</button>`;
  const cardMarkup = sorted.length ? sorted.map(item => {
    const status = stockStatus(item);
    const statusClass = ingredientStockStatusClass(status);
    const progressClass = status === 'Healthy' ? 'is-healthy' : status === 'Out of Stock' ? 'is-out' : 'is-low';
    const stock = Number(item.stock);
    const minimum = Number(item.minimum);
    const coverage = Number.isFinite(stock) && Number.isFinite(minimum) && minimum > 0
      ? Math.max(0, Math.min(100, Math.round((stock / minimum) * 100)))
      : null;
    const coverageText = coverage == null
      ? Number.isFinite(minimum) && minimum > 0 ? 'Stock level unavailable' : 'Minimum threshold not set'
      : stock === minimum
        ? 'At minimum threshold'
        : stock > minimum
          ? 'Minimum met'
          : `${coverage}% of minimum`;
    const progress = coverage == null
      ? `<div class="product-stock-progress-note is-unavailable">${coverageText}</div>`
      : `<div class="product-stock-progress" role="progressbar" aria-label="${esc(item.name)} stock relative to minimum" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${coverage}" aria-valuetext="${esc(coverageText)}"><span class="product-stock-progress-fill ${progressClass}" style="width:${coverage}%"></span></div><div class="product-stock-progress-note">${coverageText}</div>`;
    const batchSnapshot = batchSnapshots.get(String(item.id));
    return `<article class="catalog-card ingredient-product-card"><div class="catalog-card-top"><span class="ingredient-dot large-dot">${esc(item.name[0] || '?')}</span><div class="product-status-group"><span class="status ${statusClass}">${status}</span>${item.isActive === false ? '<span class="product-active-status is-inactive">Inactive</span>' : ''}</div></div><h3>${esc(item.name)}</h3><span class="tag">${esc(item.category)}</span><div class="product-stock-section"><div class="product-stock-readouts"><div><small>Current stock</small><strong>${formatStockQuantity(item.stock)} <em>${esc(item.unit)}</em></strong></div><div><small>Minimum stock</small><strong>${formatStockQuantity(item.minimum)} <em>${esc(item.unit)}</em></strong></div></div>${progress}</div>${inventoryCardBatchIntelligence(batchSnapshot)}<div class="catalog-card-footer product-card-footer"><span class="product-cost-summary">${canSeeCost ? `<small>Cost / unit</small><strong>${money(item.cost)}</strong>` : ''}</span><div class="product-card-actions"><button type="button" class="product-view-details" data-action="view-ingredient" data-id="${esc(item.id)}" aria-label="View details for ${esc(item.name)}">View details</button>${actions('ingredient', item.id, item, { includeView: false })}</div></div></article>`;
  }).join('') : `<div class="panel empty-state">No ingredients match these filters.${canManageProducts ? '<button class="primary-btn" data-action="open-ingredient">Add product</button>' : ''}</div>`;
  const tableMarkup = `<div class="panel table-panel"><div class="table-scroll"><table data-table="inventory"><thead><tr>${[['name','Ingredient'],['stock','Stock'],...(canSeeCost ? [['cost','Cost / unit']] : []),['status','Status'],['','']].map(([key, label]) => key ? `<th${key === 'cost' ? ' class="mobile-hidden-cell"' : ''}><button class="sort-header" data-sort-ingredient="${key}">${label} ↕</button></th>` : '<th></th>').join('')}</tr></thead><tbody>${sorted.length ? sorted.map(item => {
    const status = stockStatus(item);
    return `<tr><td data-label="Ingredient"><strong>${esc(item.name)}</strong><small class="sub-cell">${esc(item.category)} · ${esc(item.unit)} · ${item.isActive === false ? 'Inactive' : 'Active'}</small></td><td data-label="Stock">${formatStockQuantity(item.stock)} ${esc(item.unit)}</td>${canSeeCost ? `<td data-label="Cost / unit" data-mobile-hidden="true">${money(item.cost)}</td>` : ''}<td data-label="Status"><span class="status ${ingredientStockStatusClass(status)}">${status}</span></td><td data-label="Actions">${actions('ingredient', item.id, item)}</td></tr>`;
  }).join('') : `<tr><td colspan="${canSeeCost ? 5 : 4}" class="empty-state">No ingredients match these filters.</td></tr>`}</tbody></table></div></div>`;
  const statusFilters = [
    { value: 'All', count: ingredients.length },
    { value: 'Out of Stock', count: ingredients.filter(item => stockStatus(item) === 'Out of Stock').length },
    { value: 'Low Stock', count: ingredients.filter(item => stockStatus(item) === 'Low Stock').length },
    { value: 'Healthy', count: ingredients.filter(item => stockStatus(item) === 'Healthy').length },
    { value: 'Expiring Soon', count: ingredients.filter(hasExpiryWithinSevenDays).length }
  ];
  const statusFilterMarkup = statusFilters.map(filter => {
    const selected = filter.value === 'Expiring Soon'
      ? state.ingredientExpiryFilter
      : !state.ingredientExpiryFilter && state.ingredientStatus === filter.value;
    const filterClass = filter.value === 'Out of Stock' ? 'filter-out'
      : filter.value === 'Low Stock' ? 'filter-low'
        : filter.value === 'Healthy' ? 'filter-healthy'
          : filter.value === 'Expiring Soon' ? 'filter-expiring'
            : '';
    return `<button type="button" class="ingredient-status-chip ${filterClass} ${selected ? 'active' : ''}" data-ingredient-status-filter="${filter.value}" aria-pressed="${selected}">${filter.value}<b>${filter.count}</b></button>`;
  }).join('');
  return `${pageHeader('Inventory', 'Products', 'Monitor ingredient stock, expiry dates, and FIFO batches.', `${toggle} ${canManageProducts ? '<button class="primary-btn" data-action="open-ingredient">+ Add product</button>' : ''}`)}<div class="catalog-toolbar"><div class="search-box">⌕<input id="tableSearch" placeholder="Search products or categories..." value="${esc(state.query)}"></div><select data-filter="ingredientCategory"><option>All categories</option>${categories.map(item => `<option ${state.ingredientCategory === item ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select><span class="record-count">${filtered.length} products</span></div><div class="ingredient-status-filters" role="group" aria-label="Filter products by stock status">${statusFilterMarkup}</div>${state.ingredientView === 'cards' ? `<div class="ingredient-card-grid">${cardMarkup}</div>` : tableMarkup}`;
}
function recipeCardsPage() {
  const recipes = all('recipes');
  const categories = [...new Set(recipes.map(item => item.category))];
  const filtered = recipes.filter(item => item.name.toLowerCase().includes(state.query.toLowerCase()) && (state.recipeCategory === 'All' || item.category === state.recipeCategory));
  const canSeeCosts = ['Administrator', 'Manager'].includes(state.role);
  const canManageRecipes = window.CostTrackLogic.canPerformInventoryAction(state.role, 'recipe.manage');
  const todayRows = state.productionBoard.rows.filter(item => item.serviceDate === today());
  return `${pageHeader('Kitchen operations', 'Recipes', canSeeCosts ? 'Review portion and base-recipe costs, ingredients, and production status.' : 'Review recipe ingredients and quantities for production.', canManageRecipes ? '<button class="primary-btn" data-action="open-recipe">+ Create recipe</button>' : '')}
    <div class="catalog-toolbar"><div class="search-box">⌕<input id="tableSearch" placeholder="Search recipes..." value="${esc(state.query)}"></div>
      <div class="category-tabs"><button class="${state.recipeCategory === 'All' ? 'active' : ''}" data-recipe-category="All">All</button>${categories.map(item => `<button class="${state.recipeCategory === item ? 'active' : ''}" data-recipe-category="${esc(item)}">${esc(item)}</button>`).join('')}</div>
      <span class="record-count">${filtered.length} recipes</span>
    </div>
    <div class="recipe-card-grid">${filtered.length ? filtered.map(item => {
      const active = window.CostTrackLogic.isRecipeActive(item);
      const breakdown = canSeeCosts ? recipeCostBreakdown(item) : null;
      const progress = window.CostTrackLogic.productionProgress(
        todayRows.filter(batch => batch.recipeId === item.id),
        Number(item.prepTarget || 30)
      );
      const readiness = active ? kitchenRecipeReadiness(item, Number(item.batchYield || 30)) : null;
      const yieldCount = Number(item.batchYield || 30);
      const fullBatches = readiness?.lines.length
        ? Math.floor(Math.min(...readiness.lines.map(line =>
            Number(line.required || 0) > 0
              ? Number(line.available || 0) / Number(line.required)
              : 0
          )))
        : 0;
      const supportedPortions = fullBatches * yieldCount;
      const readinessMarkup = !active
        ? '<div class="recipe-readiness recipe-readiness-inactive"><strong>Inactive</strong><small>Not available for new production</small></div>'
        : readiness.status === 'Stock Available'
          ? `<div class="recipe-readiness recipe-readiness-success"><strong>✓ Production Ready</strong><small>All ingredients are available</small></div>`
          : readiness.status === 'Low Stock Warning'
            ? `<div class="recipe-readiness recipe-readiness-warning"><strong>⚠ Low Stock Warning</strong><small>Ingredients are available but nearing depletion</small></div>`
            : `<div class="recipe-readiness recipe-readiness-danger"><strong>❌ Production Blocked</strong><small>Insufficient inventory to complete this batch</small></div>`;
      const supportMarkup = !active
        ? '<div class="recipe-support-copy"><small>Production support</small><strong>Unavailable</strong></div>'
        : `<div class="recipe-support-copy"><small>Production support</small><strong>${supportedPortions > 0 ? `Enough for ${fullBatches} full batch${fullBatches === 1 ? '' : 'es'} · ${supportedPortions} portions` : 'Inventory shortage detected'}</strong></div>`;
      const shortageLines = readiness?.lines.filter(line =>
        line.available < line.required || (line.product && line.available <= line.product.minimum)
      ) || [];
      const lowStockNames = [...new Set(shortageLines.map(line => line.product?.name).filter(Boolean))].slice(0, 3);
      const stockRiskMarkup = lowStockNames.length
        ? `<div class="recipe-stock-risk"><strong>Watch</strong><span>${lowStockNames.map(name => esc(name)).join(', ')}</span></div>`
        : '';
      const fefoLines = readiness?.lines
        .filter(line => line.firstBatch && line.expiry)
        .sort((left, right) => String(left.expiry).localeCompare(String(right.expiry)))
        .slice(0, 2) || [];
      const fefoMarkup = fefoLines.length
        ? `<div class="recipe-fefo"><strong>FEFO recommended</strong>${fefoLines.map(line => `<span>${esc(line.product?.name || 'Ingredient')}: use ${esc(inventoryBatchLabel(line.firstBatch))} first · ${esc(inventoryExpiryLabel(line.expiryStatus?.daysUntilExpiry))}</span>`).join('')}</div>`
        : '';
      return `<article class="catalog-card recipe-card${active ? '' : ' recipe-card-inactive'}">
        <div class="catalog-card-top"><span class="recipe-icon large-dot">◇</span><span class="tag">${esc(item.category)}</span></div>
        <h3>${esc(item.name)}</h3>
        ${readinessMarkup}
        <div class="recipe-prep-summary">
          <span><small>Portions per base recipe</small><strong>${Number(item.batchYield || 30)} portions</strong></span>
          <span><small>Daily production target</small><strong>${Number(item.prepTarget || 30)} portions</strong></span>
        </div>
        ${supportMarkup}
        ${stockRiskMarkup}
        ${fefoMarkup}
        <div class="recipe-production-status" aria-label="${esc(item.name)} today production status">
          <span><small>Target</small><strong>${progress.target}</strong></span>
          <span><small>Ready</small><strong>${progress.ready}</strong></span>
          <span><small>Cooking</small><strong>${progress.cooking}</strong></span>
          <span><small>Still needed</small><strong>${progress.remaining}</strong></span>
        </div>
        ${canSeeCosts ? `<div class="recipe-cost-card-primary"><small>Cost per portion</small><strong>${money(breakdown.costPerPortion)}</strong><span>Total batch cost ${money(breakdown.totalBatchCost)}</span></div>` : ''}
        <div class="catalog-card-footer"><span>${item.ingredients.length} ingredients</span>
          <div class="recipe-card-status"><span class="status ${active ? 'status-good' : 'status-low'}">${active ? 'Active' : 'Inactive'}</span><div class="card-actions">${actions('recipe', item.id)}</div></div>
        </div>
      </article>`;
    }).join('') : '<div class="panel empty-state">No recipes match this category.</div>'}</div>`;
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
    tableId: 'receiving',
    headers: ['Product / invoice', 'Movement', 'Quantity', 'Unit cost', 'Lot / expiry', 'Date received', ''],
    mobileLabels: ['Product / invoice', 'Movement', 'Quantity', 'Unit cost', 'Lot / expiry', 'Date received', 'Actions'],
    mobileHidden: ['Movement', 'Unit cost', 'Lot / expiry'],
    rows
  });
}
const wasteReasons = ['Expired', 'Spoiled', 'Burned', 'Over-preparation', 'Spillage', 'Dropped / contaminated', 'Prep trim', 'Other'];
const preparedFoodWasteReasons = ['Leftover after service', 'Unsold prepared food', 'Over-production', 'Expired prepared food', 'Burned', 'Contaminated', 'Other'];
function logsPage(type) {
  const isWaste = type === 'waste';
  if (isWaste) {
    const records = all('wasteLogs');
    const preparedRecords = all('preparedFoodWasteLogs');
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
    const preparedMatches = preparedRecords.filter(item => {
      const timestamp = item.recordedAt ? new Date(item.recordedAt) : null;
      if (filters.from && item.date < filters.from) return false;
      if (filters.to && item.date > filters.to) return false;
      if (filters.reason !== 'All' && item.reason !== filters.reason) return false;
      if (filters.staff === 'Mine' && item.recordedBy !== state.user?.id) return false;
      if (filters.staff === 'Others' && (!item.recordedBy || item.recordedBy === state.user?.id)) return false;
      if (filters.staff === 'Legacy' && item.recordedAt) return false;
      if ((filters.timeFrom || filters.timeTo) && (!timestamp || Number.isNaN(timestamp.getTime()))) return false;
      const clock = timestamp ? `${String(timestamp.getHours()).padStart(2, '0')}:${String(timestamp.getMinutes()).padStart(2, '0')}` : '';
      if (filters.timeFrom && clock < filters.timeFrom) return false;
      if (filters.timeTo && clock > filters.timeTo) return false;
      return `${item.dishName || ''} ${item.productionBatchLabel || ''} ${item.reason || ''} ${item.notes || ''}`.toLowerCase().includes(state.query.toLowerCase());
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
      return `<tr><td data-label="Ingredient"><strong>${esc(product?.name || 'Unknown ingredient')}</strong></td><td data-label="Quantity">${Number(item.quantity)} ${esc(product?.unit || '')}</td><td data-label="Reason"><span class="tag">${esc(item.reason || 'Unspecified')}</span></td><td data-label="Dish / batch">${esc(linkedLog ? recipe(linkedLog.recipeId)?.name || 'Unknown dish' : '—')}</td><td data-label="Date / time">${esc(item.date || '')}<small class="sub-cell">${esc(activityTime)}</small></td><td data-label="Logged by">${staffLabel}</td>${canSeeCosts ? `<td data-label="Estimated cost">${money(Number(item.quantity || 0) * Number(product?.cost || 0))}</td>` : ''}<td data-label="Notes">${esc(item.notes || '—')}</td></tr>`;
    });
    const pageSize = state.tablePageSize || 10;
    const wastePageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const wastePage = Math.min(Math.max(1, Number(state.tablePages.waste || 1)), wastePageCount);
    state.tablePages.waste = wastePage;
    const pagedWasteRows = rows.slice((wastePage - 1) * pageSize, wastePage * pageSize);
    const wasteStart = Math.max(1, Math.min(wastePage - 2, wastePageCount - 4));
    const wasteEnd = Math.min(wastePageCount, wasteStart + 4);
    const wastePageButtons = Array.from({ length: wasteEnd - wasteStart + 1 }, (_, offset) => {
      const page = wasteStart + offset;
      return `<button type="button" class="${page === wastePage ? 'active' : ''}" data-table-page="${page}" data-table-id="waste" ${page === wastePage ? 'aria-current="page"' : ''}>${page}</button>`;
    }).join('');
    const wastePagination = rows.length
      ? `<div class="table-pagination" aria-label="Waste log pagination"><button type="button" class="ghost-btn compact-btn" data-table-page="${wastePage - 1}" data-table-id="waste" ${wastePage <= 1 ? 'disabled' : ''}>Previous</button><div class="table-page-numbers">${wastePageButtons}</div><button type="button" class="ghost-btn compact-btn" data-table-page="${wastePage + 1}" data-table-id="waste" ${wastePage >= wastePageCount ? 'disabled' : ''}>Next</button></div>`
      : '';
    const preparedRows = preparedMatches.map(item => {
      const activityTime = item.recordedAt
        ? new Date(item.recordedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'Time not recorded';
      const staffLabel = !item.recordedBy ? 'Not recorded' : item.recordedBy === state.user?.id ? 'You' : 'Other staff';
      return `<tr><td data-label="Dish"><strong>${esc(item.dishName || 'Unnamed dish')}</strong></td><td data-label="Production batch">${esc(item.productionBatchLabel || '—')}</td><td data-label="Portions">${Number(item.quantity)} portions</td><td data-label="Reason"><span class="tag">${esc(item.reason || 'Unspecified')}</span></td><td data-label="Waste date / time">${esc(item.date || '')}<small class="sub-cell">${esc(activityTime)}</small></td><td data-label="Logged by">${staffLabel}</td><td data-label="Notes">${esc(item.notes || '—')}</td></tr>`;
    });
    const preparedPageCount = Math.max(1, Math.ceil(preparedRows.length / pageSize));
    const preparedPage = Math.min(Math.max(1, Number(state.tablePages.preparedWaste || 1)), preparedPageCount);
    state.tablePages.preparedWaste = preparedPage;
    const preparedPageRows = preparedRows.slice((preparedPage - 1) * pageSize, preparedPage * pageSize);
    const preparedPageStart = Math.max(1, Math.min(preparedPage - 2, preparedPageCount - 4));
    const preparedPageEnd = Math.min(preparedPageCount, preparedPageStart + 4);
    const preparedPageButtons = Array.from({ length: preparedPageEnd - preparedPageStart + 1 }, (_, offset) => {
      const page = preparedPageStart + offset;
      return `<button type="button" class="${page === preparedPage ? 'active' : ''}" data-table-page="${page}" data-table-id="preparedWaste" ${page === preparedPage ? 'aria-current="page"' : ''}>${page}</button>`;
    }).join('');
    const preparedPagination = preparedRows.length
      ? `<div class="table-pagination" aria-label="Prepared-food waste pagination"><button type="button" class="ghost-btn compact-btn" data-table-page="${preparedPage - 1}" data-table-id="preparedWaste" ${preparedPage <= 1 ? 'disabled' : ''}>Previous</button><div class="table-page-numbers">${preparedPageButtons}</div><button type="button" class="ghost-btn compact-btn" data-table-page="${preparedPage + 1}" data-table-id="preparedWaste" ${preparedPage >= preparedPageCount ? 'disabled' : ''}>Next</button></div>`
      : '';
    const ingredientInsight = new Map();
    matches.forEach(item => {
      const product = ingredient(item.ingredientId);
      if (!product) return;
      const current = ingredientInsight.get(item.ingredientId) || { name: product.name, unit: product.unit, quantity: 0 };
      current.quantity += Number(item.quantity || 0);
      ingredientInsight.set(item.ingredientId, current);
    });
    const topIngredients = [...ingredientInsight.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 3);
    const dishInsight = new Map();
    preparedMatches.forEach(item => {
      const key = String(item.dishName || '').trim().toLowerCase();
      if (!key) return;
      const current = dishInsight.get(key) || { name: String(item.dishName).trim(), quantity: 0 };
      current.quantity += Number(item.quantity || 0);
      dishInsight.set(key, current);
    });
    const topDishes = [...dishInsight.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 3);
    const wasteTrend = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(`${manilaBusinessToday()}T12:00:00`);
      date.setDate(date.getDate() - offset);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const ingredientCount = all('wasteLogs').filter(item => item.date === key).length;
      const preparedPortions = all('preparedFoodWasteLogs').filter(item => item.date === key)
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      wasteTrend.push({ key, label: date.toLocaleDateString('en-PH', { weekday: 'short' }), ingredientCount, preparedPortions });
    }
    const trendMax = Math.max(1, ...wasteTrend.flatMap(item => [item.ingredientCount, item.preparedPortions]));
    const trendMarkup = wasteTrend.map(item => {
      const ingredientHeight = Math.max(item.ingredientCount ? 8 : 3, Math.round(item.ingredientCount / trendMax * 46));
      const preparedHeight = Math.max(item.preparedPortions ? 8 : 3, Math.round(item.preparedPortions / trendMax * 46));
      return `<div class="waste-trend-bar-item" title="${esc(item.key)}: ${item.ingredientCount} ingredient entries · ${item.preparedPortions} prepared portions"><div class="waste-trend-pair"><i class="ingredient-trend" style="height:${ingredientHeight}px"></i><i class="prepared-trend" style="height:${preparedHeight}px"></i></div><small>${esc(item.label)}</small></div>`;
    }).join('');
    const reasonOptions = [...new Set([...wasteReasons, ...preparedFoodWasteReasons, ...records.map(item => item.reason), ...preparedRecords.map(item => item.reason)].filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const filterMarkup = `<div class="waste-filters">
      <label>From date<input data-waste-filter="from" type="date" value="${esc(filters.from)}"></label>
      <label>To date<input data-waste-filter="to" type="date" value="${esc(filters.to)}"></label>
      <label>Time from<input data-waste-filter="timeFrom" type="time" value="${esc(filters.timeFrom)}"></label>
      <label>Time to<input data-waste-filter="timeTo" type="time" value="${esc(filters.timeTo)}"></label>
      <label>Ingredient waste only<select data-waste-filter="ingredient"><option value="All">All ingredients</option>${all('ingredients').slice().sort((a, b) => a.name.localeCompare(b.name)).map(item => `<option value="${esc(item.id)}" ${filters.ingredient === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
      <label>Reason<select data-waste-filter="reason"><option value="All">All reasons</option>${reasonOptions.map(reason => `<option value="${esc(reason)}" ${filters.reason === reason ? 'selected' : ''}>${esc(reason)}</option>`).join('')}</select></label>
      <label>Staff<select data-waste-filter="staff"><option value="All" ${filters.staff === 'All' ? 'selected' : ''}>Everyone</option><option value="Mine" ${filters.staff === 'Mine' ? 'selected' : ''}>My entries</option><option value="Others" ${filters.staff === 'Others' ? 'selected' : ''}>Other staff</option><option value="Legacy" ${filters.staff === 'Legacy' ? 'selected' : ''}>Older entries</option></select></label>
      <span class="waste-filter-actions"><button class="primary-btn compact-btn" data-action="apply-waste-filters">Apply</button><button class="ghost-btn compact-btn" data-action="clear-waste-filters">Clear</button></span>
    </div>`;
    const summaries = `<div class="waste-summary"><div><small>Ingredient waste entries</small><strong>${matches.length}</strong></div><div><small>Prepared-food entries</small><strong>${preparedMatches.length}</strong></div><div><small>Prepared portions wasted</small><strong>${Number(preparedMatches.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toFixed(4))}</strong></div><div><small>Combined waste entries</small><strong>${matches.length + preparedMatches.length}</strong></div>${selectedIngredient ? `<div><small>Quantity shown</small><strong>${Number(totalQuantity.toFixed(4))} ${esc(ingredient(filters.ingredient)?.unit || '')}</strong></div>` : ''}${canSeeCosts ? `<div><small>Ingredient discarded cost</small><strong>${money(totalCost)}</strong></div>` : ''}</div>`;
    const insights = `<div class="waste-insight-grid">
      <section class="waste-insight-card"><h3>Top wasted ingredients</h3><p>Quantities retain each ingredient’s own stock unit.</p>${topIngredients.length ? `<ol>${topIngredients.map(item => `<li><span>${esc(item.name)}</span><strong>${Number(item.quantity.toFixed(4))} ${esc(item.unit)}</strong></li>`).join('')}</ol>` : '<p class="waste-insight-empty">No ingredient entries for these filters.</p>'}</section>
      <section class="waste-insight-card"><h3>Top wasted dishes</h3><p>Prepared-food quantities are portions, not inventory units.</p>${topDishes.length ? `<ol>${topDishes.map(item => `<li><span>${esc(item.name)}</span><strong>${Number(item.quantity.toFixed(4))} portions</strong></li>`).join('')}</ol>` : '<p class="waste-insight-empty">No prepared-food entries for these filters.</p>'}</section>
      <section class="waste-insight-card"><h3>Waste trend</h3><p>Last 7 Manila-local dates · red: ingredient entries · green: prepared portions.</p><div class="waste-trend-bars">${trendMarkup}</div></section>
    </div>`;
    return `${pageHeader('Kitchen operations', 'Waste logs', 'Choose ingredient waste to deduct raw stock, or prepared-food waste to record discarded dishes without changing ingredient inventory.', '<button class="primary-btn" data-action="open-waste">+ Log waste</button>')}<div class="panel waste-history-panel"><div class="waste-toolbar"><div class="search-box">⌕<input id="tableSearch" placeholder="Search waste, reason, dish, or notes..." value="${esc(state.query)}"></div><span class="record-count">${matches.length + preparedMatches.length} entries</span></div>${filterMarkup}${summaries}${insights}<h2 class="waste-section-title">Ingredient waste</h2><p class="waste-section-note">Only these entries deduct raw ingredient stock.</p><div class="table-scroll"><table><thead><tr><th>Ingredient</th><th>Quantity</th><th>Reason</th><th>Dish / batch</th><th>Date / time</th><th>Logged by</th>${canSeeCosts ? '<th>Estimated cost</th>' : ''}<th>Notes</th></tr></thead><tbody>${pagedWasteRows.length ? pagedWasteRows.join('') : `<tr><td colspan="${canSeeCosts ? 8 : 7}" class="empty-state">No ingredient waste entries match these filters.</td></tr>`}</tbody></table></div>${wastePagination}<h2 class="waste-section-title prepared-waste-title">Prepared food / leftovers</h2><p class="waste-section-note">These entries record discarded cooked food only. They never return or deduct ingredients.</p><div class="table-scroll"><table class="prepared-waste-table"><thead><tr><th>Dish</th><th>Production batch</th><th>Portions</th><th>Reason</th><th>Waste date / time</th><th>Logged by</th><th>Notes</th></tr></thead><tbody>${preparedPageRows.length ? preparedPageRows.join('') : '<tr><td colspan="7" class="empty-state">No prepared-food waste entries match these filters.</td></tr>'}</tbody></table></div>${preparedPagination}</div>`;
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
    tableId: 'production',
    headers: ['Recipe', 'Output', 'Mode', 'Date'],
    rows
  });
}
function productionBoardPage() {
  const rows = state.productionBoard.rows.filter(item => item.serviceDate === today());
  const cooking = rows.filter(item => item.status === 'Cooking').sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  const ready = rows.filter(item => item.status === 'Ready').sort((a, b) => Number(b.batchNumber) - Number(a.batchNumber)).slice(0, 8);
  const batchTime = value => value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Historical batch';
  const elapsedTime = value => {
    const started = Date.parse(value || '');
    if (!Number.isFinite(started)) return 'Elapsed time unavailable';
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - started) / 60000));
    const hours = Math.floor(elapsedMinutes / 60);
    const minutes = elapsedMinutes % 60;
    return `Elapsed ${hours ? `${hours}h ` : ''}${minutes}m`;
  };
  const cookingRows = cooking.length ? cooking.map(item => `<div class="production-queue-row">
    <div class="production-batch-number">#${item.batchNumber}</div>
    <div class="production-queue-copy"><strong>${esc(item.recipeName || recipe(item.recipeId)?.name || 'Recipe')}</strong><small>${Number(item.expectedCovers || 0)} portions · Started ${esc(batchTime(item.startedAt))} · ${esc(elapsedTime(item.startedAt))}</small></div>
    <button class="primary-btn compact-btn" data-ready-production="${esc(item.id)}" aria-label="Mark batch ${item.batchNumber} of ${esc(item.recipeName || recipe(item.recipeId)?.name || 'recipe')} ready" ${state.productionBoard.loading ? 'disabled' : ''}>Mark ready</button>
  </div>`).join('') : '<div class="production-queue-empty">Nothing is cooking right now. Use Start Production to begin a batch.</div>';
  const readyRows = ready.length ? ready.map(item => `<div class="production-queue-row ready-row"><div class="production-batch-number">#${item.batchNumber}</div><div class="production-queue-copy"><strong>${esc(item.recipeName || recipe(item.recipeId)?.name || 'Recipe')}</strong><small>${item.expectedCovers} portions · Ready ${esc(batchTime(item.readyAt))}</small></div><span class="status status-good">Ready</span></div>`).join('') : '<div class="production-queue-empty">Ready batches will appear here as the kitchen completes them.</div>';
  const error = state.productionBoard.error ? `<div class="production-board-error" role="alert"><strong>Production queue unavailable</strong><span>${esc(state.productionBoard.error)}</span><button class="ghost-btn compact-btn" data-action="retry-production-board">Try again</button></div>` : '';
  const loading = state.productionBoard.loading ? '<div class="production-queue-empty" role="status">Loading today’s production batches…</div>' : '';
  const readyTabActive = state.productionQueueTab === 'ready';
  const readyTab = readyTabActive
    ? `<section class="panel production-ready-panel" aria-label="Ready production batches"><div class="production-queue-list">${readyRows}</div></section>`
    : '';
  const productionLogs = all('productionLogs');
  const producedByDish = new Map();
  productionLogs.forEach(log => {
    const dish = recipe(log.recipeId);
    if (!dish) return;
    const key = dish.id;
    const current = producedByDish.get(key) || { name: dish.name, portions: 0 };
    const portions = log.coversProduced != null
      ? Number(log.coversProduced)
      : Math.round(Number(log.quantity || 0) * Number(dish.batchYield || 30));
    current.portions += portions;
    producedByDish.set(key, current);
  });
  const mostProduced = [...producedByDish.values()].sort((a, b) => b.portions - a.portions).slice(0, 3);
  const wasteByDish = new Map();
  all('preparedFoodWasteLogs').forEach(log => {
    const key = String(log.dishName || '').trim();
    if (!key) return;
    const current = wasteByDish.get(key) || { name: key, portions: 0 };
    current.portions += Number(log.quantity || 0);
    wasteByDish.set(key, current);
  });
  const mostWasted = [...wasteByDish.values()].sort((a, b) => b.portions - a.portions).slice(0, 3);
  const consumedIngredients = new Map();
  productionLogs.forEach(log => {
    const dish = recipe(log.recipeId);
    if (!dish) return;
    const producedPortions = log.coversProduced != null
      ? Number(log.coversProduced)
      : Math.round(Number(log.quantity || 0) * Number(dish.batchYield || 30));
    dish.ingredients.forEach(line => {
      const product = ingredient(line.ingredientId);
      if (!product) return;
      const scale = producedPortions / Math.max(1, Number(dish.batchYield || 30));
      const current = consumedIngredients.get(product.id) || { name: product.name, unit: product.unit, quantity: 0 };
      current.quantity += Number(line.quantity || 0) * scale;
      consumedIngredients.set(product.id, current);
    });
  });
  const topConsumed = [...consumedIngredients.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 3);
  const analyticsPanel = ['Administrator', 'Manager'].includes(state.role)
    ? `<section class="kitchen-analytics-grid" aria-label="Kitchen analytics">
      <div class="kitchen-analytics-card"><h3>Most produced dishes</h3>${mostProduced.length ? `<ol>${mostProduced.map(item => `<li><span>${esc(item.name)}</span><strong>${Number(item.portions.toFixed(2))} portions</strong></li>`).join('')}</ol>` : '<p>No completed production yet.</p>'}</div>
      <div class="kitchen-analytics-card"><h3>Most wasted dishes</h3>${mostWasted.length ? `<ol>${mostWasted.map(item => `<li><span>${esc(item.name)}</span><strong>${Number(item.portions.toFixed(2))} portions</strong></li>`).join('')}</ol>` : '<p>No prepared-food waste logged.</p>'}</div>
      <div class="kitchen-analytics-card"><h3>Ingredient consumption</h3>${topConsumed.length ? `<ol>${topConsumed.map(item => `<li><span>${esc(item.name)}</span><strong>${Number(item.quantity.toFixed(2))} ${esc(item.unit)}</strong></li>`).join('')}</ol>` : '<p>No completed consumption recorded.</p>'}</div>
    </section>`
    : '';
  return `${pageHeader('Buffet kitchen', 'Production board', 'Start, monitor, and complete today’s production batches.', `<div class="production-page-actions"><button class="primary-btn" data-action="open-start-production">+ Start Production</button><button class="ghost-btn" data-action="toggle-production-history">${state.productionHistoryOpen ? 'Hide history' : 'View history'}</button></div>`)}
    <div class="production-date-bar"><div><strong>Today’s service</strong><small>${new Date(`${today()}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</small></div><span class="tag">${cooking.length} cooking · ${rows.filter(item => item.status === 'Ready').length} ready</span></div>
    ${kitchenProductionSummary(rows)}
    ${error}${loading}
    <section class="panel production-in-progress" aria-label="In progress production batches">
      <div class="panel-header"><div><div class="panel-title">In progress <span class="nav-badge">${cooking.length}</span></div><div class="panel-subtitle">Cooking batches awaiting completion.</div></div></div>
      <div class="production-queue-list">${cookingRows}</div>
    </section>
    <div class="production-queue-tabs" role="group" aria-label="Production batch queues">
      <button type="button" class="${!readyTabActive ? 'active' : ''}" aria-pressed="${!readyTabActive}" data-production-queue-tab="in-progress">In progress <span>${cooking.length}</span></button>
      <button type="button" class="${readyTabActive ? 'active' : ''}" aria-pressed="${readyTabActive}" data-production-queue-tab="ready">Ready batches <span>${rows.filter(item => item.status === 'Ready').length}</span></button>
    </div>
    ${readyTab}
    ${analyticsPanel}
    ${state.productionHistoryOpen ? productionHistoryPanel() : ''}`;
}
async function loadProductionBoard(force = false) {
  const date = today();
  const board = state.productionBoard;
  if (!state.user || board.loading || (!force && board.loaded && board.date === date)) return false;
  board.loading = true;
  board.date = date;
  board.error = '';
  if (['production', 'recipes'].includes(state.view)) render();
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
    if (['production', 'recipes'].includes(state.view)) render();
  }
}
function kitchenProductionSummary(rows) {
  const activeRecipes = all('recipes').filter(window.CostTrackLogic.isRecipeActive);
  const target = activeRecipes.reduce((sum, item) => sum + Number(item.prepTarget || 0), 0);
  const cooking = rows.filter(item => item.status === 'Cooking').reduce((sum, item) => sum + Number(item.expectedCovers || 0), 0);
  const ready = rows.filter(item => item.status === 'Ready').reduce((sum, item) => sum + Number(item.expectedCovers || 0), 0);
  const remaining = Math.max(0, target - ready - cooking);
  const preparedWaste = all('preparedFoodWasteLogs').filter(item => item.date === today())
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const ingredientWasteEntries = all('wasteLogs').filter(item => item.date === today()).length;
  const lowStock = all('ingredients').filter(item => item.isActive !== false && ['Out of Stock', 'Low Stock'].includes(stockStatus(item))).length;
  return `
    <section class="kitchen-operations-summary" aria-label="Today's kitchen operations summary">
      <div class="kitchen-summary-card"><small>Today's target</small><strong>${target}</strong><span>portions</span></div>
      <div class="kitchen-summary-card kitchen-summary-cooking"><small>Cooking</small><strong>${cooking}</strong><span>portions</span></div>
      <div class="kitchen-summary-card kitchen-summary-ready"><small>Ready</small><strong>${ready}</strong><span>portions</span></div>
      <div class="kitchen-summary-card"><small>Remaining</small><strong>${remaining}</strong><span>portions</span></div>
      <div class="kitchen-summary-card"><small>Ingredient waste today</small><strong>${ingredientWasteEntries}</strong><span>entries</span></div>
      <div class="kitchen-summary-card"><small>Prepared waste today</small><strong>${preparedWaste}</strong><span>portions</span></div>
      <div class="kitchen-summary-card ${lowStock ? 'kitchen-summary-alert' : ''}"><small>Low / out of stock</small><strong>${lowStock}</strong><span>items</span></div>
    </section>`;
}

function kitchenRecipeReadiness(recipe, portions) {
  if (!recipe || !recipe.ingredients?.length) return { status: 'Insufficient Stock', tone: 'danger', lines: [] };
  const batchYield = Math.max(1, Number(recipe.batchYield || 30));
  const scale = Number(portions || 0) / batchYield;
  const lines = recipe.ingredients.map(line => {
    const product = ingredient(line.ingredientId);
    const productBatches = all('inventoryBatches').filter(batch => batch.productId === line.ingredientId);
    const available = window.CostTrackLogic.availableStock(productBatches, manilaBusinessToday());
    const fallbackAvailable = productBatches.length ? available : 0;
    const required = Number((Number(line.quantity || 0) * scale).toFixed(4));
    const snapshot = inventoryBatchVisibility(productBatches);
    const firstBatch = snapshot.fefoOrder[0] || null;
    const expiry = firstBatch?.expirationDate || firstBatch?.expiration_date;
    const expiryStatus = firstBatch
      ? window.CostTrackLogic.batchStatus(firstBatch, manilaBusinessToday(), 3)
      : null;
    return {
      product,
      required,
      available: fallbackAvailable,
      firstBatch,
      expiry,
      expiryStatus
    };
  });
  const insufficient = lines.some(line => line.available < line.required);
  const low = !insufficient && lines.some(line => line.product && line.available <= line.product.minimum);
  return {
    status: insufficient ? 'Insufficient Stock' : low ? 'Low Stock Warning' : 'Stock Available',
    tone: insufficient ? 'danger' : low ? 'warning' : 'success',
    lines
  };
}

function kitchenReadinessMarkup(readiness) {
  const statusLabel = readiness.tone === 'danger'
    ? 'Insufficient stock'
    : readiness.tone === 'warning' ? 'Low stock' : 'Ready';
  const numberText = value => Number(Number(value).toFixed(4)).toLocaleString();
  const lines = readiness.lines.map(line => {
    const productName = line.product?.name || 'Unknown ingredient';
    const unit = line.product?.unit || 'unit';
    const shortBy = Math.max(0, Number(line.required) - Number(line.available));
    return `<tr>
      <th scope="row">${esc(productName)}</th>
      <td>${numberText(line.required)} ${esc(unit)}</td>
      <td>${numberText(line.available)} ${esc(unit)}</td>
      <td>${shortBy > 0
        ? `<span class="start-production-shortage">${numberText(shortBy)} ${esc(unit)}</span>`
        : '<span class="start-production-stock-ok">OK</span>'}</td>
    </tr>`;
  }).join('');
  const icon = readiness.tone === 'danger'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z"></path><path d="M12 9v5m0 3h.01"></path></svg>'
    : '';
  return `<section class="start-production-readiness ${readiness.tone}" role="status" aria-live="polite">
    <div class="start-production-readiness-heading">${icon}<strong>${statusLabel}</strong></div>
    <div class="start-production-stock-table-wrap">
      <table class="start-production-stock-table">
        <thead><tr><th scope="col">Ingredient</th><th scope="col">Needed</th><th scope="col">Available</th><th scope="col">Short by</th></tr></thead>
        <tbody>${lines || '<tr><td colspan="4">No ingredient requirements are recorded for this dish.</td></tr>'}</tbody>
      </table>
    </div>
  </section>`;
}

function openStartProductionModal() {
  if (!window.CostTrackLogic.canPerformInventoryAction(state.role, 'production.log')) {
    return toast('You do not have permission to start production batches.', 'error');
  }
  const recipes = all('recipes').filter(item => window.CostTrackLogic.isRecipeActive(item));
  if (!recipes.length) return toast('No active recipes are available for production.', 'error');
  const categories = [...new Set(recipes.map(item => item.category || 'Uncategorized'))]
    .sort((a, b) => a.localeCompare(b));
  if (!categories.includes('All')) categories.unshift('All');
  if (!categories.includes('Uncategorized') && recipes.some(item => !item.category)) categories.push('Uncategorized');
  let selectedCategory = categories.includes(state.productionCategoryFilter)
    ? state.productionCategoryFilter
    : 'All';
  let selectedRecipeId = '';
  let selectedBatchType = 'full';
  let currentStep = 1;
  const dishOptions = (category, query = '') => recipes
    .filter(item => (category === 'All' || (item.category || 'Uncategorized') === category)
      && item.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  modal('Start Production', `
    <div class="start-production-wizard" data-start-production-wizard>
      <input type="hidden" name="category" value="">
      <input type="hidden" name="recipeId" value="">
      <input type="hidden" name="batchType" value="">
      <input type="hidden" name="customPortions" value="">
      <nav class="start-production-progress" aria-label="Production progress">
        <ol>
          <li data-start-progress="1" aria-current="step"><span>1</span> Dish</li>
          <li data-start-progress="2"><span>2</span> Size and review</li>
        </ol>
      </nav>
      <section class="start-production-step" data-start-step="1">
        <div class="start-production-step-heading">
          <h3 tabindex="-1">Choose a dish</h3>
          <p>Filter by category or search, then select a dish to review its stock.</p>
        </div>
        <div class="start-production-dish-controls">
          <div class="start-production-category-tabs" role="tablist" aria-label="Dish categories" data-start-categories></div>
          <label class="start-production-search">Search dishes
            <input type="search" data-start-search placeholder="Search by dish name" autocomplete="off">
          </label>
        </div>
        <div class="start-production-dish-grid" id="start-production-dishes" role="tabpanel" data-start-dishes></div>
        <p class="start-production-empty" data-start-empty hidden>No dishes match this category and search.</p>
      </section>
      <section class="start-production-step" data-start-step="2" hidden>
        <div class="start-production-step-heading">
          <h3 tabindex="-1">Size and review</h3>
          <p>Choose the batch size and confirm the ingredients needed before starting.</p>
        </div>
        <div class="start-production-batch-grid" data-start-batches role="radiogroup" aria-label="Batch size"></div>
        <div class="start-production-custom" data-start-custom hidden>
          <label for="start-production-custom-portions">Custom portions</label>
          <div class="start-production-stepper">
            <button type="button" data-start-stepper="-1" aria-label="Decrease portions">−</button>
            <input id="start-production-custom-portions" name="customPortionsInput" type="number" min="1" max="10000" step="1" placeholder="Enter portions" inputmode="numeric">
            <button type="button" data-start-stepper="1" aria-label="Increase portions">+</button>
          </div>
          <small class="start-production-custom-hint">Enter a whole number of portions.</small>
        </div>
        <div class="start-production-review" data-start-review-content></div>
      </section>
    </div>
  `, 'Start batch', 'start-production-modal');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'start-production';
  const wizard = form.querySelector('[data-start-production-wizard]');
  const footer = form.querySelector('.modal-actions');
  footer.classList.add('start-production-footer');
  footer.innerHTML = `
    <div class="start-production-footer-left">
      <button type="button" class="ghost-btn" data-start-back disabled>← Back</button>
      <span class="start-production-submit-reason" data-start-submit-reason role="status" aria-live="polite"></span>
    </div>
    <div class="start-production-footer-right">
      <button type="button" class="ghost-btn" data-action="close-modal">Cancel</button>
      <button type="submit" class="primary-btn modal-submit">Start batch</button>
    </div>`;
  const submitButton = footer.querySelector('.modal-submit');
  const backButton = footer.querySelector('[data-start-back]');
  const submitReason = footer.querySelector('[data-start-submit-reason]');
  const customInput = form.elements.customPortionsInput;
  const numberText = value => Number(Number(value).toFixed(4)).toLocaleString();

  const renderCategories = () => {
    const tabList = wizard.querySelector('[data-start-categories]');
    tabList.innerHTML = categories.map((category, index) => {
      const selected = category === selectedCategory;
      return `<button type="button" role="tab" id="start-production-category-${index}" aria-controls="start-production-dishes" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}" class="start-production-category-tab${selected ? ' is-selected' : ''}" data-start-category="${esc(category)}">
        <span>${esc(category)}</span><span class="start-production-selected-check" aria-hidden="true">✓</span>
      </button>`;
    }).join('');
    const activeIndex = categories.indexOf(selectedCategory);
    wizard.querySelector('[data-start-dishes]').setAttribute('aria-labelledby', `start-production-category-${activeIndex}`);
  };

  const renderDishes = () => {
    const dishGrid = wizard.querySelector('[data-start-dishes]');
    const query = wizard.querySelector('[data-start-search]').value;
    const filtered = dishOptions(selectedCategory, query);
    wizard.querySelector('[data-start-empty]').hidden = filtered.length > 0;
    dishGrid.innerHTML = filtered.map(item => {
      const readiness = kitchenRecipeReadiness(item, Number(item.batchYield || 30));
      const readinessClass = readiness.tone === 'danger' ? 'danger' : readiness.tone === 'warning' ? 'warning' : 'success';
      const readinessLabel = readiness.tone === 'danger' ? 'Insufficient stock' : readiness.tone === 'warning' ? 'Low stock' : 'Ready';
      const selected = item.id === selectedRecipeId;
      return `<button type="button" aria-pressed="${selected}" aria-label="${esc(item.name)}, ${Number(item.batchYield || 30)} portions per full batch, ${readinessLabel}" class="start-production-dish-choice${selected ? ' is-selected' : ''}${readiness.tone === 'danger' ? ' is-insufficient' : ''}" data-start-dish="${esc(item.id)}">
        <span class="start-production-dish-copy"><strong>${esc(item.name)}</strong><small>${Number(item.batchYield || 30)} portions per full batch</small></span>
        <span class="start-production-readiness-badge ${readinessClass}">${readinessLabel}</span>
        <span class="start-production-selected-check" aria-hidden="true">✓</span>
      </button>`;
    }).join('');
  };

  const updateBatchOptions = item => {
    const yieldCount = Number(item.batchYield || 30);
    const halfCount = Math.max(1, Math.round(yieldCount / 2));
    const choices = [
      { type: 'half', title: 'Half batch', portions: halfCount, detail: 'About half of the full recipe' },
      { type: 'full', title: 'Full batch', portions: yieldCount, detail: 'Full recipe yield' },
      { type: 'custom', title: 'Custom', portions: null, detail: 'Set a portion count' }
    ];
    wizard.querySelector('[data-start-batches]').innerHTML = choices.map(choice => {
      const selected = selectedBatchType === choice.type;
      const readiness = choice.portions ? kitchenRecipeReadiness(item, choice.portions) : null;
      const insufficient = readiness?.tone === 'danger';
      return `<button type="button" role="radio" aria-checked="${selected}" tabindex="${selected ? '0' : '-1'}" aria-label="${choice.title}${choice.portions ? `, ${choice.portions} portions` : ''}${insufficient ? ', insufficient stock' : ''}" class="start-production-batch-choice${selected ? ' is-selected' : ''}${insufficient ? ' is-insufficient' : ''}" data-start-batch="${choice.type}">
        <span class="start-production-batch-copy"><strong>${choice.title}</strong><span>${choice.portions ? `${choice.portions} portions` : 'Enter portions'}</span><small>${choice.detail}</small></span>
        ${insufficient ? '<span class="start-production-readiness-badge danger">Insufficient stock</span>' : ''}
        <span class="start-production-selected-check" aria-hidden="true">✓</span>
      </button>`;
    }).join('');
  };

  const setSubmitState = (reason, enabled) => {
    submitButton.disabled = !enabled;
    submitReason.textContent = reason;
    submitReason.hidden = !reason;
  };

  const showStep = (step, focusTarget = true) => {
    currentStep = step;
    wizard.querySelectorAll('[data-start-step]').forEach(section => {
      section.hidden = Number(section.dataset.startStep) !== currentStep;
    });
    wizard.querySelectorAll('[data-start-progress]').forEach(progress => {
      const progressStep = Number(progress.dataset.startProgress);
      if (progressStep === currentStep) progress.setAttribute('aria-current', 'step');
      else progress.removeAttribute('aria-current');
      progress.classList.toggle('is-complete', progressStep < currentStep);
    });
    backButton.disabled = currentStep === 1;
    if (currentStep === 1) {
      setSubmitState('Choose a dish to continue.', false);
      const selected = [...wizard.querySelectorAll('[data-start-dish]')].find(button => button.dataset.startDish === selectedRecipeId);
      requestAnimationFrame(() => (focusTarget && (selected || wizard.querySelector('[role="tab"][aria-selected="true"]')))?.focus());
    } else {
      const selected = wizard.querySelector('[data-start-batch][aria-checked="true"]');
      requestAnimationFrame(() => (focusTarget && (selected || wizard.querySelector('[data-start-step="2"] h3')))?.focus());
    }
  };

  const portionsFor = (item, batchType, customPortions = null) => {
    const yieldCount = Number(item.batchYield || 30);
    return batchType === 'half'
      ? Math.max(1, Math.round(yieldCount / 2))
      : batchType === 'custom'
        ? Number(customPortions)
        : yieldCount;
  };

  const renderReview = () => {
    const item = recipe(selectedRecipeId);
    if (!item) return;
    const customRaw = customInput.value.trim();
    const customValue = customRaw === '' ? NaN : Number(customRaw);
    const portions = portionsFor(item, selectedBatchType, customValue);
    const portionsValid = Number.isInteger(portions) && portions >= 1 && portions <= 10000;
    const readiness = portionsValid ? kitchenRecipeReadiness(item, portions) : null;
    form.elements.category.value = selectedCategory;
    form.elements.recipeId.value = selectedRecipeId;
    form.elements.batchType.value = selectedBatchType;
    form.elements.customPortions.value = selectedBatchType === 'custom' && portionsValid ? String(customValue) : '';
    const batchLabel = selectedBatchType === 'half' ? 'Half batch' : selectedBatchType === 'full' ? 'Full batch' : 'Custom';
    const itemCategory = item.category || 'Uncategorized';
    let stockMessage = '';
    let submitDisabledReason = '';
    let banner = '';
    let lotNote = '';
    let costSummary = '';

    if (!portionsValid) {
      stockMessage = 'Enter a whole number of portions from 1 to 10,000.';
      submitDisabledReason = stockMessage;
    } else if (readiness.tone === 'danger') {
      stockMessage = 'Not enough stock for this batch size.';
      submitDisabledReason = stockMessage;
      const halfPortions = portionsFor(item, 'half');
      const halfReadiness = kitchenRecipeReadiness(item, halfPortions);
      const tryHalf = halfReadiness.tone !== 'danger'
        ? '<button type="button" class="secondary-btn" data-start-try-half>Try a half batch</button>'
        : '';
      const canReceive = window.CostTrackLogic.canPerformInventoryAction(state.role, 'inventory.receive');
      const receiveLink = canReceive
        ? '<a href="#receiving" data-start-receive-inventory>Receive inventory</a>'
        : '';
      banner = `<div class="start-production-stock-alert" role="alert">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z"></path><path d="M12 9v5m0 3h.01"></path></svg>
        <div><strong>Not enough stock to start this batch. Receive inventory or choose a smaller batch.</strong><div class="start-production-stock-actions">${tryHalf}${receiveLink}</div></div>
      </div>`;
    } else if (readiness.tone === 'warning') {
      stockMessage = 'Low stock warning. Review ingredient availability before starting.';
    }

    if (readiness) {
      const hasDatedLots = readiness.lines.some(line => line.firstBatch && line.expiry);
      lotNote = `<p class="start-production-lot-note">${hasDatedLots ? 'Uses the earliest-expiring stock first.' : 'No dated lots on record.'}</p>`;
      if (['Administrator', 'Manager'].includes(state.role)) {
        const cost = recipeCostBreakdown(item);
        costSummary = `<div class="start-production-cost-summary"><span>Estimated batch cost <strong>${money(cost.costPerPortion * portions)}</strong></span><span>Cost per portion <strong>${money(cost.costPerPortion)}</strong></span></div>`;
      }
    }

    wizard.querySelector('[data-start-review-content]').innerHTML = `
      <div class="start-production-review-summary">
        <div><small>Dish</small><strong>${esc(item.name)}</strong></div>
        <div><small>Category</small><strong>${esc(itemCategory)}</strong></div>
        <div><small>Batch size</small><strong>${batchLabel}</strong></div>
        <div><small>Portions</small><strong>${portionsValid ? numberText(portions) : '—'}</strong></div>
        <div><small>Daily target</small><strong>${numberText(Number(item.prepTarget || 30))} portions</strong></div>
      </div>
      ${costSummary}
      ${!portionsValid ? `<p class="start-production-input-error" role="alert">${stockMessage}</p>` : ''}
      ${readiness ? kitchenReadinessMarkup(readiness) : '<p class="start-production-stock-prompt">Enter portions to calculate ingredient needs.</p>'}
      ${banner}
      ${lotNote}`;
    setSubmitState(submitDisabledReason, portionsValid && readiness?.tone !== 'danger');
  };

  const chooseCategory = (category, focus = false) => {
    if (!categories.includes(category)) return;
    if (selectedCategory !== category) {
      state.modalDirty = true;
      selectedRecipeId = '';
      selectedBatchType = 'full';
      form.elements.category.value = '';
      form.elements.recipeId.value = '';
      form.elements.batchType.value = '';
      form.elements.customPortions.value = '';
      setSubmitState('Choose a dish to continue.', false);
    }
    selectedCategory = category;
    state.productionCategoryFilter = category;
    renderCategories();
    renderDishes();
    if (focus) wizard.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  };

  const chooseBatchType = (type, focus = false) => {
    if (!['half', 'full', 'custom'].includes(type)) return;
    if (selectedBatchType !== type) state.modalDirty = true;
    selectedBatchType = type;
    const item = recipe(selectedRecipeId);
    if (!item) return;
    updateBatchOptions(item);
    wizard.querySelector('[data-start-custom]').hidden = type !== 'custom';
    renderReview();
    if (focus || type !== 'custom') wizard.querySelector(`[data-start-batch="${type}"]`)?.focus();
    else if (type === 'custom') requestAnimationFrame(() => customInput.focus());
  };

  const selectDish = itemId => {
    const item = recipe(itemId);
    if (!item || !window.CostTrackLogic.isRecipeActive(item)) return;
    state.modalDirty = true;
    selectedRecipeId = itemId;
    selectedBatchType = 'full';
    customInput.value = '';
    updateBatchOptions(item);
    wizard.querySelector('[data-start-custom]').hidden = true;
    renderDishes();
    renderReview();
    showStep(2);
  };

  wizard.addEventListener('click', event => {
    const categoryButton = event.target.closest('[data-start-category]');
    if (categoryButton) {
      chooseCategory(categoryButton.dataset.startCategory, true);
      return;
    }
    const dishButton = event.target.closest('[data-start-dish]');
    if (dishButton) {
      selectDish(dishButton.dataset.startDish);
      return;
    }
    const batchButton = event.target.closest('[data-start-batch]');
    if (batchButton) {
      chooseBatchType(batchButton.dataset.startBatch);
      return;
    }
    const stepperButton = event.target.closest('[data-start-stepper]');
    if (stepperButton) {
      const current = Number(customInput.value || 0);
      const next = Math.min(10000, Math.max(1, current + Number(stepperButton.dataset.startStepper)));
      customInput.value = String(next);
      state.modalDirty = true;
      renderReview();
      customInput.focus();
      return;
    }
    if (event.target.closest('[data-start-try-half]')) {
      chooseBatchType('half');
      return;
    }
    if (event.target.closest('[data-start-receive-inventory]')) {
      event.preventDefault();
      closeModal(true);
      setView('receiving');
    }
  });

  wizard.addEventListener('input', event => {
    if (event.target.matches('[data-start-search]')) {
      renderDishes();
      return;
    }
    if (event.target === customInput) {
      state.modalDirty = true;
      renderReview();
    }
  });

  wizard.addEventListener('keydown', event => {
    if (event.target.matches('[data-start-search]') && event.key === 'Enter') {
      event.preventDefault();
      return;
    }
    const tab = event.target.closest('[role="tab"]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const currentIndex = categories.indexOf(tab.dataset.startCategory);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? categories.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length;
      chooseCategory(categories[nextIndex], true);
      return;
    }
    const radio = event.target.closest('[role="radio"]');
    if (radio && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const choices = [...wizard.querySelectorAll('[data-start-batch]')];
      const currentIndex = choices.indexOf(radio);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? choices.length - 1
          : (currentIndex + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + choices.length) % choices.length;
      chooseBatchType(choices[nextIndex].dataset.startBatch, true);
    }
  });

  backButton.addEventListener('click', () => {
    if (currentStep === 2) showStep(1);
  });
  form.addEventListener('input', event => {
    if (event.target !== customInput) state.modalDirty = true;
  });
  customInput.addEventListener('change', renderReview);

  renderCategories();
  renderDishes();
  setSubmitState('Choose a dish to continue.', false);
  backButton.disabled = true;
  requestAnimationFrame(() => wizard.querySelector('[role="tab"][aria-selected="true"]')?.focus());
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
    const formattedDifference = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 4 }).format(difference);
    return `<tr><td><strong>${esc(stockItem?.name || 'Unknown')}</strong></td><td>${item.expected} ${esc(stockItem?.unit || '')}</td><td>${item.actual} ${esc(stockItem?.unit || '')}</td><td class="${difference < 0 ? 'negative' : 'positive'}">${difference > 0 ? '+' : ''}${formattedDifference}</td><td><span class="status ${difference < 0 ? 'status-low' : 'status-good'}">${difference < 0 ? 'Shortage' : difference > 0 ? 'Overage' : 'Matched'}</span></td><td>${esc(item.date || '')}</td><td>${actions('count', item.id)}</td></tr>`;
  });
  return tablePage({
    eyebrow: 'Reconciliation',
    title: 'Physical inventory count',
    subtitle: 'Expected stock is loaded from inventory. Review the variance before recording a count and adjusting stock.',
    action: canSubmitCount ? '<button class="primary-btn" data-action="open-count">+ Record count</button>' : '',
    search: 'counts',
    tableClass: 'physical-count-table',
    tableId: 'physical-count',
    headers: ['Ingredient', 'Expected', 'Actual count', 'Variance', 'Result', 'Count date', ''],
    rows
  });
}
function updatePhysicalCountPreview(form) {
  const preview = form.querySelector('[data-count-variance]');
  const expected = form.elements.expected.value;
  const actual = form.elements.actual.value;
  if (!preview) return;
  if (expected === '' || actual === '') {
    preview.textContent = 'Select an ingredient and enter the actual quantity to preview variance.';
    preview.dataset.state = 'empty';
    return;
  }
  const variance = Number(actual) - Number(expected);
  const unit = ingredient(form.elements.ingredientId.value)?.unit || '';
  const formattedVariance = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 4 }).format(variance);
  preview.textContent = `${variance < 0 ? 'Shortage' : variance > 0 ? 'Overage' : 'Matched'} · ${variance > 0 ? '+' : ''}${formattedVariance} ${unit}`;
  preview.dataset.state = variance < 0 ? 'shortage' : variance > 0 ? 'overage' : 'matched';
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
    tableId: 'buffet-rates',
    headers: ['Meal period', 'Day type', 'Adult', 'Child', 'Senior/PWD', 'Effective dates', 'Status', ''],
    rows
  });
}
function chargeCatalogPage() {
  const chargeItems = all('chargeItems');
  const packageTiers = all('packageTiers');
  const discounts = all('discounts');
  const settings = all('posSettings');
  const displayCode = value => {
    const code = String(value || '').trim();
    return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(code) ? '—' : code || '—';
  };
  const rows = chargeItems.length ? chargeItems.map(item => `<tr><td><strong>${esc(displayCode(item.code))}</strong></td><td>${esc(item.name)}</td><td><span class="tag">${esc(item.type)}</span></td><td>${item.isFoodRevenue ? 'Food' : 'Non-food'}</td><td>${money(item.unitPrice || 0)}</td><td><button class="ghost-btn compact-btn" data-action="edit-charge-item" data-id="${esc(item.id)}">Edit</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">No catalog entries yet. Use the migration seed data or add a charge item from the catalog editor.</td></tr>';
  const packageRows = packageTiers.length ? packageTiers.map(item => `<tr><td><strong>${esc(displayCode(item.code))}</strong></td><td>${esc(item.name)}</td><td>${esc(item.defaultMealPeriod || 'All Day')}</td><td>${money(item.basePrice || 0)}</td><td><span class="status ${item.isActive ? 'status-good' : 'status-low'}">${item.isActive ? 'Active' : 'Inactive'}</span></td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">No package tiers defined.</td></tr>';
  const discountRows = discounts.length ? discounts.map(item => `<tr><td><strong>${esc(displayCode(item.code))}</strong></td><td>${esc(item.name)}</td><td>${esc(item.discountType)}</td><td>${esc(item.appliesTo || 'bill')}</td><td>${item.discountType === 'percent' ? `${Number(item.value || 0).toFixed(2)}%` : money(item.value || 0)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">No discount presets defined.</td></tr>';
  const settingLabels = {
    pos_max_shift_hours: 'Maximum shift duration',
    pos_extra_pax_rate: 'Additional guest rate'
  };
  const settingsRows = settings.length ? settings.map(item => {
    const label = settingLabels[item.key] || 'Additional POS setting';
    const value = item.key === 'pos_max_shift_hours'
      ? `${esc(String(item.value || ''))} hours`
      : item.key === 'pos_extra_pax_rate'
        ? money(item.value)
        : esc(String(item.value || ''));
    return `<tr><td>${esc(label)}</td><td>${value}</td><td>${state.role === 'Administrator' && ['pos_max_shift_hours', 'pos_extra_pax_rate'].includes(item.key) ? `<button type="button" class="ghost-btn compact-btn" data-action="edit-pos-setting" data-id="${esc(item.id)}">Edit</button>` : ''}</td></tr>`;
  }).join('') : '<tr><td colspan="3" class="empty-state">No operating settings saved yet.</td></tr>';
  return `
    <section class="panel charge-catalog-panel">
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
          <div class="table-scroll"><table class="charge-items-table"><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Revenue</th><th>Price</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
        </div>
        <div class="panel">
          <div class="sub-panel-header"><strong>Package tiers</strong></div>
          <div class="table-scroll"><table class="package-tiers-table"><thead><tr><th>Code</th><th>Name</th><th>Meal</th><th>Base</th><th>Status</th></tr></thead><tbody>${packageRows}</tbody></table></div>
        </div>
      </div>
      <div class="two-column-grid">
        <div class="panel">
          <div class="sub-panel-header"><strong>Discount presets</strong></div>
          <div class="table-scroll"><table class="discount-presets-table"><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Applies</th><th>Value</th></tr></thead><tbody>${discountRows}</tbody></table></div>
        </div>
        <div class="panel">
          <div class="sub-panel-header"><strong>POS settings</strong></div>
          <div class="table-scroll"><table class="pos-settings-table"><thead><tr><th>Setting</th><th>Value</th><th>Actions</th></tr></thead><tbody>${settingsRows}</tbody></table></div>
        </div>
      </div>
    </section>
  `;
}
function cashierPage() {
  const bills = all('posBills')
    .filter(item => state.role !== 'Receptionist' || item.createdBy === state.user?.id)
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  const activeShift = all('shifts').find(item => item.status === 'Open');
  const shiftOpenedToday = all('shifts').some(item => shiftOpenedOnDate(item, manilaBusinessToday()));
  const rows = bills.map(item => {
    const canEdit = item.status === 'Open'
      && (state.role !== 'Receptionist' || item.createdBy === state.user?.id);
    return `<tr><td><strong>${esc(item.billNumber || 'Bill number unavailable')}</strong></td><td>${esc(item.customerName || 'Walk-in')}</td><td>${Number(item.customersServed || 0)} served</td><td><span class="status ${item.status === 'Closed' ? 'status-good' : item.status === 'Voided' ? 'status-out' : 'status-low'}">${esc(item.status)}</span></td><td>${money(item.balanceDue || 0)}</td><td>${money(item.paidTotal || 0)}</td><td><div class="row-actions"><button class="ghost-btn compact-btn" data-action="open-bill" data-id="${esc(item.id)}">${canEdit ? 'Edit' : 'View'}</button><button class="ghost-btn compact-btn" data-action="print-bill" data-id="${esc(item.id)}">Print</button></div></td></tr>`;
  });
  return tablePage({
    eyebrow: 'Front of House',
    title: 'Cashier',
    subtitle: 'Create and settle bills without changing stock. Deposits are payments, never discounts.',
    action: `${activeShift ? '<span class="pos-shift-chip">Shift open</span>' : shiftOpenedToday ? '<span class="pos-shift-chip">Shift closed today</span>' : '<button class="ghost-btn" data-action="new-shift">Open shift</button>'} <button class="primary-btn" data-action="new-bill" ${activeShift ? '' : 'aria-disabled="true" title="Open the restaurant cashier shift before creating a bill."'}>+ New bill</button>`,
    search: 'cashier',
    tableId: 'cashier',
    headers: ['Bill #', 'Customer', 'Served', 'Status', 'Balance', 'Paid', ''],
    mobileLabels: ['Bill', 'Customer', 'Served', 'Status', 'Balance', 'Paid', 'Actions'],
    mobileHidden: ['Served', 'Paid'],
    rows,
    emptyMessage: 'No bills yet. Create a bill to begin.'
  });
}
function shiftsPage() {
  const shifts = all('shifts').slice().sort((a, b) => String(b.openedAt || '').localeCompare(String(a.openedAt || '')));
  const openShift = shifts.find(item => item.status === 'Open');
  const today = manilaBusinessToday();
  const shiftOpenedToday = shifts.some(item => shiftOpenedOnDate(item, today));
  const rows = shifts.map(item => {
    const own = item.openedBy === state.user?.id;
    const canMove = item.status === 'Open';
    const canClose = window.CostTrackLogic.canCloseShift(item, state.role, state.user?.id);
    const overdue = item.status === 'Open' && !shiftOpenedOnDate(item, today);
    const variance = item.cashVariance == null ? '—' : `${item.cashVariance > 0 ? '+' : ''}${money(item.cashVariance)}`;
    const closeCell = canClose
      ? `${overdue ? '<span class="field-help">Overdue — reconcile and close</span>' : ''}<button class="primary-btn compact-btn" data-action="close-shift" data-id="${esc(item.id)}">Close</button>`
      : item.status === 'Open' && state.role === 'Receptionist'
        ? '<span class="field-help">Only the shift opener or a Manager/Admin can close</span>'
        : '';
    return `<tr><td><strong>${own ? 'Your shift' : 'Cashier shift'}</strong><small>${esc(own ? 'Opened by you' : staffDisplayName(item.openedBy, 'Cashier'))}</small></td><td><span class="status ${item.status === 'Closed' ? 'status-good' : item.status === 'Needs review' ? 'status-out' : 'status-low'}">${esc(item.status)}</span></td><td>${esc(formatOperationalDateTime(item.openedAt))}</td><td>${money(item.openingFloat || 0)}</td><td>${item.expectedCash == null ? '—' : money(item.expectedCash)}</td><td>${variance}</td><td><div class="row-actions shift-actions"><button class="ghost-btn compact-btn" data-action="open-shift" data-id="${esc(item.id)}">View</button>${canMove ? `<button class="ghost-btn compact-btn" data-action="cash-movement" data-id="${esc(item.id)}">Paid in/out</button>` : ''}${closeCell}<button class="ghost-btn compact-btn" data-action="print-shift" data-id="${esc(item.id)}">Print</button></div></td></tr>`;
  });
  return tablePage({
    eyebrow: 'Front of House',
    title: 'Shifts',
    subtitle: 'One shared restaurant shift per Manila business day. Track cashier float, cash movement, and reconciliation.',
    action: `${openShift ? '<span class="pos-shift-chip">Shift open</span>' : shiftOpenedToday ? '<span class="pos-shift-chip">Shift closed today</span>' : '<button class="primary-btn" data-action="new-shift">+ Open shift</button>'}`,
    search: 'shifts',
    tableId: 'shifts',
    headers: ['Shift / cashier', 'Status', 'Opened', 'Starting cash', 'Expected cash', 'Variance', ''],
    mobileLabels: ['Shift / cashier', 'Status', 'Opened', 'Starting cash', 'Expected cash', 'Variance', 'Actions'],
    mobileHidden: ['Starting cash', 'Expected cash'],
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
      ? `<small>Decision by ${esc(staffDisplayName(item.decidedBy))} · ${esc(formatOperationalDateTime(item.decidedAt))}${item.decisionReason ? ` · ${esc(item.decisionReason)}` : ''}</small>`
      : '';
    const actions = canReview
      ? `<button class="ghost-btn compact-btn" data-action="approve-approval" data-id="${esc(item.id)}">Approve</button><button class="ghost-btn compact-btn" data-action="reject-approval" data-id="${esc(item.id)}">Reject</button>`
      : '';
    return `<tr><td><strong>${esc(bill?.billNumber || 'Bill number unavailable')}</strong><small>${esc(label)}</small></td><td><span class="status ${item.status === 'Approved' ? 'status-good' : item.status === 'Pending' ? 'status-low' : 'status-out'}">${esc(item.status)}</span>${decision}</td><td>${esc(item.requestReason)}<small>Requested by ${esc(staffDisplayName(item.requestedBy))} · ${esc(formatOperationalDateTime(item.requestedAt))}</small></td><td>${actions}</td></tr>`;
  });
  return tablePage({
    eyebrow: 'Front of House',
    title: 'Approvals',
    subtitle: canDecide
      ? 'Review and decide full-discount and bill-void requests. You cannot decide your own request.'
      : 'Track the status and decision history of your approval requests.',
    search: 'approvals',
    tableId: 'approvals',
    headers: ['Bill / Request', 'Status / Decision', 'Reason / Requested by', 'Action'],
    rows,
    emptyMessage: 'No approval requests.'
  });
}
const USER_MANAGEMENT_ROLES = ['Administrator', 'Manager', 'Receptionist', 'Inventory Clerk', 'Chef / Kitchen Staff'];
const USER_ONBOARDING_ROLE_CARDS = [
  { label: 'Cashier / Receptionist', value: 'Receptionist', description: 'Handles reservations, payments, and guest transactions.' },
  { label: 'Inventory Clerk', value: 'Inventory Clerk', description: 'Manages inventory, receiving, and stock counts.' },
  { label: 'Chef / Kitchen Staff', value: 'Chef / Kitchen Staff', description: 'Manages food preparation and kitchen operations.' },
  { label: 'Manager', value: 'Manager', description: 'Oversees restaurant operations, staff, and reports.' },
  { label: 'Administrator', value: 'Administrator', description: 'Manages users, system settings, and access.' }
];
let applicantIdFile = null;
let applicantIdFileForOcr = null;
let applicantIdPreviewUrl = null;
let applicantIdPendingPreviewUrl = null;
let applicantIdPreviewGeneration = 0;
let applicantIdRotation = 0;
let applicantIdRotationLoading = false;
let applicantIdRotationGeneration = 0;
let applicantIdImageValid = false;
let applicantIdImageLoading = false;
let applicantIdImageError = '';
let applicantOcrFields = { full_name: '', dob: '', address: '', id_number: '' };
let applicantOcrIdType = '';
let applicantOcrWarning = '';
let applicantOcrCompleted = false;
let applicantOcrLoading = false;
let applicantOcrProgress = 0;
let applicantOcrProgressMessage = '';
let applicantOcrController = null;
let applicantOcrRunId = 0;
let applicantFaceStream = null;
let applicantFaceCaptureBlob = null;
let applicantFacePreviewUrl = null;
let applicantFaceCameraState = 'idle';
let applicantFaceCameraError = '';
let applicantFaceCameraRequestId = 0;
let applicantFaceCaptureLoading = false;
let applicantFaceMatchRunId = 0;
let applicantFaceMatchState = 'idle';
let applicantFaceMatchResult = null;
let applicantFaceMatchError = '';
let applicantReviewProceedNotice = '';
let applicantReviewOverrideReason = '';
const USER_ROLE_ACCESS_NOTES = {
  Administrator: 'Can manage users, system settings, and all operational modules.',
  Manager: 'Can oversee restaurant operations, inventory, and management reports.',
  Receptionist: 'Can manage reservations, guest seating, and cashier workflows.',
  'Inventory Clerk': 'Can manage inventory, receiving, and stock counts.',
  'Chef / Kitchen Staff': 'Can manage kitchen production and record waste.'
};

function effectiveInvitationStatus(invitation) {
  return invitation.status === 'Pending' && new Date(invitation.expires_at).getTime() <= Date.now()
    ? 'Expired'
    : invitation.status;
}

function formatUserManagementDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila'
  }).format(date);
}

function userManagementHeader(description, action = '') {
  return `<header class="user-management-header">
    <div><div class="eyebrow">Administration</div><h1 id="userManagementHeading" tabindex="-1">User Management</h1><p>${esc(description)}</p></div>
    ${action}
  </header>`;
}

function userManagementRefreshNotice() {
  if (!state.userManagementRefreshError) return '';
  return `<div class="user-refresh-error" role="alert">
    <span>${state.userManagementRefreshSaved ? 'Saved, but the list could not refresh.' : 'The list could not refresh.'} ${esc(state.userManagementRefreshError)}</span>
    <button type="button" class="ghost-btn" data-action="retry-user-management-refresh" ${state.userManagementRefreshLoading ? 'disabled' : ''}>${state.userManagementRefreshLoading ? 'Retrying…' : 'Retry'}</button>
  </div>`;
}

function userManagementStyles() {
  return `<style>
    .user-management-page { display: grid; gap: 20px; }
    .user-management-page, .user-management-form-modal { --muted: #59665f; }
    .user-management-page .status-good, .user-management-page .status-healthy { color: #176442; }
    .user-management-page .status-out { color: #9e3b37; }
    .user-management-header { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 4px; }
    .user-management-header h1 { margin: 3px 0 7px; font: 800 30px/1.18 'Plus Jakarta Sans', sans-serif; letter-spacing: -1px; }
    .user-management-header p { margin: 0; color: var(--muted); line-height: 1.55; }
    .user-management-header .eyebrow { color: var(--teal); font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; }
    .user-management-page button, .user-management-page input, .user-management-page select,
    .user-management-form-modal button, .user-management-form-modal input, .user-management-form-modal select,
    .user-management-form-modal textarea { min-height: 44px; }
    .user-management-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    .user-management-card { display: flex; min-height: 190px; flex-direction: column; align-items: flex-start; justify-content: space-between; gap: 20px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: #fff; padding: 24px; color: var(--ink); text-align: left; box-shadow: var(--shadow); cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
    .user-management-card:hover { border-color: #b7ddd0; box-shadow: 0 12px 30px rgba(35,62,53,.09); transform: translateY(-2px); }
    .user-management-card:focus-visible, .user-management-tabs button:focus-visible, .user-management-page button:focus-visible, .user-management-page summary:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }
    .user-management-card .card-topline { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; }
    .user-management-card .user-card-title { display: block; font: 800 20px 'Plus Jakarta Sans', sans-serif; }
    .user-management-card .user-card-description { display: block; margin-top: 7px; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .user-management-card .card-count { color: var(--teal-dark); font-size: 13px; font-weight: 700; }
    .user-management-card .card-icon { display: grid; width: 44px; height: 44px; place-items: center; border-radius: 14px; background: var(--mint); color: var(--teal-dark); font-size: 22px; }
    .user-management-refresh { display: flex; align-items: center; gap: 8px; }
    .user-refresh-error, .user-invite-error { display: flex; align-items: center; justify-content: space-between; gap: 14px; border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--red-bg); padding: 13px 15px; color: #873e3a; }
    .user-management-nav { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .user-back-link { display: inline-flex; min-height: 44px; align-items: center; gap: 8px; border: 1px solid var(--accent); border-radius: var(--radius-sm); background: var(--accent); padding: 0 14px; color: var(--paper); font-weight: 700; cursor: pointer; }
    .user-back-link:hover { border-color: var(--accent-hover); background: var(--accent-hover); }
    .user-management-tabs { display: flex; gap: 6px; overflow-x: auto; border-bottom: 1px solid var(--line); scrollbar-width: thin; }
    .user-management-tabs button { flex: 0 0 auto; border: 0; border-bottom: 3px solid transparent; background: transparent; padding: 10px 18px; color: var(--muted); font-size: 14px; font-weight: 700; cursor: pointer; }
    .user-management-tabs button[aria-selected="true"] { border-bottom-color: var(--teal); color: var(--teal-dark); }
    .user-management-panel { display: grid; gap: 16px; }
    .user-management-toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
    .user-management-toolbar .search-box { flex: 1 1 260px; }
    .user-management-filter { display: grid; min-width: 165px; gap: 5px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .user-management-filter select, .user-management-filter input { width: 100%; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; padding: 8px 11px; color: var(--ink); }
    .user-management-count { margin-left: auto; color: var(--muted); font-size: 12px; font-weight: 700; }
    .user-management-table { min-width: 980px; }
    .user-invitations-table { min-width: 1120px; }
    .user-management-table td, .user-invitations-table td { vertical-align: middle; }
    .verification-record-toolbar { display: flex; align-items: end; gap: 12px; margin: 18px 0 14px; }
    .verification-record-toolbar .user-management-filter { flex: 1; max-width: 420px; }
    .verification-record-table { min-width: 920px; }
    .verification-record-table td { vertical-align: middle; }
    .verification-record-open { border: 0; background: transparent; padding: 0; color: var(--teal-dark); font: inherit; font-weight: 700; text-align: left; text-decoration: underline; cursor: pointer; }
    .verification-record-detail { display: grid; gap: 18px; }
    .verification-record-detail section { border: 1px solid var(--line); border-radius: var(--radius-md); background: #fff; padding: 16px; }
    .verification-record-detail h3 { margin: 0 0 12px; color: var(--ink); font-size: 15px; }
    .verification-record-detail dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; margin: 0; }
    .verification-record-detail dl div { min-width: 0; }
    .verification-record-detail dt { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .verification-record-detail dd { margin: 4px 0 0; overflow-wrap: anywhere; color: var(--ink); font-weight: 650; }
    .verification-record-timeline { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
    .verification-record-timeline li { position: relative; border-left: 2px solid var(--line); padding: 0 0 2px 16px; }
    .verification-record-timeline li::before { position: absolute; top: 4px; left: -6px; width: 10px; height: 10px; border-radius: 50%; background: var(--teal); content: ""; }
    .verification-record-timeline strong, .verification-record-timeline small { display: block; }
    .verification-record-timeline small { margin-top: 3px; color: var(--muted); }
    .verification-record-warning { color: #854d0e; font-size: 12px; }
    .modal.verification-record-modal { width: min(820px, calc(100vw - 32px)); }
    .user-staff-cell { display: flex; min-width: 190px; align-items: center; gap: 11px; }
    .user-staff-cell > span:last-child { min-width: 0; }
    .user-staff-cell strong, .user-staff-cell small { display: block; overflow-wrap: anywhere; }
    .user-staff-cell small { margin-top: 3px; color: var(--muted); font-size: 11px; }
    .user-management-role-badge { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; background: var(--success-bg); padding: 6px 10px; color: #215e4e; font-size: 11px; font-weight: 700; }
    .user-protected { display: inline-grid; gap: 4px; }
    .user-protected strong { width: max-content; border: 1px solid #d8e0dc; border-radius: 999px; background: #f4f6f5; padding: 5px 9px; color: #495751; font-size: 11px; }
    .user-protected small { max-width: 240px; color: var(--muted); font-size: 11px; line-height: 1.4; }
    .user-action-menu { position: relative; }
    .user-action-menu summary { display: inline-flex; min-width: 112px; min-height: 44px; align-items: center; justify-content: center; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; padding: 8px 12px; color: var(--ink); font-size: 12px; font-weight: 700; cursor: pointer; list-style: none; }
    .user-action-menu summary::-webkit-details-marker { display: none; }
    .user-action-menu[open] summary { border-color: #a9d1c3; background: var(--mint); color: var(--teal-dark); }
    .user-action-list { position: absolute; z-index: 3; top: calc(100% + 5px); right: 0; display: grid; min-width: 185px; gap: 3px; border: 1px solid var(--line); border-radius: var(--radius-md); background: #fff; padding: 6px; box-shadow: 0 12px 28px rgba(35,62,53,.14); }
    .user-action-list button { width: 100%; border: 0; border-radius: 7px; background: #fff; padding: 9px 10px; color: var(--ink); text-align: left; cursor: pointer; }
    .user-action-list button:hover { background: var(--mint); color: var(--teal-dark); }
    .user-invitation-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .user-management-empty { display: grid; justify-items: center; gap: 8px; padding: 36px 16px; text-align: center; }
    .user-management-empty p { max-width: 430px; margin: 0 0 8px; color: var(--muted); }
    .user-management-skeleton { display: grid; gap: 10px; padding: 20px; }
    .user-management-skeleton span { display: block; height: 18px; border-radius: 8px; background: linear-gradient(90deg, var(--line) 25%, #f7f9f8 50%, var(--line) 75%); background-size: 200% 100%; animation: user-management-shimmer 1.3s linear infinite; }
    .user-management-skeleton span:nth-child(3n + 1) { width: 88%; }
    .user-management-skeleton span:nth-child(3n + 2) { width: 72%; }
    .user-management-skeleton span:nth-child(3n) { width: 95%; }
    .user-management-form-modal .user-form-fields { display: grid; gap: 14px; }
    .user-management-form-modal label { display: grid; gap: 6px; color: var(--ink); font-size: 12px; font-weight: 700; }
    .user-management-form-modal input, .user-management-form-modal select, .user-management-form-modal textarea { width: 100%; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; padding: 10px 12px; color: var(--ink); font: inherit; font-weight: 400; }
    .user-management-form-modal textarea { min-height: 96px; resize: vertical; }
    .user-management-form-modal .field-help, .user-management-form-modal .role-access-note { color: var(--muted); font-size: 12px; font-weight: 400; line-height: 1.5; }
    .user-management-form-modal .role-access-note { margin: -4px 0 0; }
    .user-management-form-modal .duplicate-invite-notice { display: grid; gap: 8px; border: 1px solid var(--warning); border-radius: var(--radius-sm); background: #fff8e9; padding: 12px; color: #75521d; font-size: 12px; line-height: 1.45; }
    .user-management-form-modal .duplicate-invite-notice[hidden] { display: none; }
    .user-management-form-modal .modal-actions > button { min-height: 44px; }
    .user-onboarding-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .user-onboarding-summary > div { display: grid; gap: 4px; border: 1px solid var(--line); border-radius: var(--radius-md); background: #fff; padding: 15px 17px; }
    .user-onboarding-summary span { color: var(--muted); font-size: 11px; font-weight: 700; }
    .user-onboarding-summary strong { font: 800 20px/1.2 'Plus Jakarta Sans', sans-serif; }
    .user-onboarding-summary small { color: var(--muted); font-size: 10px; }
    .applicant-review-modal { width: min(920px, calc(100vw - 32px)); }
    .applicant-review-modal #modalForm { display: grid; gap: 18px; }
    .applicant-review-progress { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; margin: 0; padding: 0; list-style: none; }
    .applicant-review-progress li { display: flex; min-height: 42px; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 9px; background: #fff; padding: 7px 9px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .applicant-review-progress li.is-active { border-color: var(--teal); background: var(--mint); color: var(--teal-dark); }
    .applicant-review-progress li.is-complete { color: #215e4e; }
    .applicant-review-step-number { display: grid; width: 25px; height: 25px; flex: 0 0 25px; place-items: center; border-radius: 50%; background: #eef2ef; }
    .applicant-review-progress li.is-active .applicant-review-step-number, .applicant-review-progress li.is-complete .applicant-review-step-number { background: var(--teal); color: #fff; }
    .applicant-review-panel { display: grid; gap: 14px; }
    .applicant-review-panel h3 { margin: 0; font: 800 17px 'Plus Jakarta Sans', sans-serif; }
    .applicant-id-upload { display: grid; gap: 12px; }
    .applicant-id-empty { display: grid; justify-items: center; gap: 10px; border: 1.5px dashed #9aada5; border-radius: var(--radius-md); background: #f8faf9; padding: 28px 18px; text-align: center; }
    .applicant-id-empty[hidden], .applicant-id-selected[hidden] { display: none; }
    .applicant-id-upload-icon { display: grid; width: 44px; height: 44px; place-items: center; border-radius: 50%; background: var(--mint); color: var(--teal-dark); font-size: 24px; font-weight: 700; }
    .applicant-id-empty strong { color: var(--ink); font-size: 15px; }
    .applicant-id-empty span, .applicant-id-help { color: var(--muted); font-size: 12px; line-height: 1.5; }
    .applicant-id-selected { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 16px; align-items: center; border: 1px solid var(--line); border-radius: var(--radius-md); background: #fff; padding: 14px; }
    .applicant-id-preview-frame { display: grid; min-height: 170px; max-height: 260px; place-items: center; overflow: hidden; border-radius: var(--radius-sm); background: #f1f4f2; }
    .applicant-id-preview-frame img { display: block; max-width: 100%; max-height: 260px; object-fit: contain; }
    .applicant-id-file-details { display: grid; min-width: 0; gap: 8px; }
    .applicant-id-file-details strong { overflow-wrap: anywhere; font-size: 14px; }
    .applicant-id-file-details span { color: var(--muted); font-size: 12px; }
    .applicant-id-file-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .applicant-id-file-actions button { min-height: 40px; }
    .applicant-id-error { border: 1px solid #c83e37; border-radius: var(--radius-sm); background: #f9e9e7; padding: 10px 12px; color: #8f2f2a; font-size: 13px; font-weight: 700; }
    .applicant-id-error[hidden] { display: none; }
    .applicant-id-help { margin: 0; }
    .applicant-verification-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .applicant-verification-item { display: grid; gap: 8px; border: 1px solid var(--line); border-radius: var(--radius-md); background: #fff; padding: 14px; }
    .applicant-verification-item strong { font-size: 13px; }
    .applicant-verification-item span { color: var(--muted); font-size: 12px; }
    .applicant-readonly-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .applicant-readonly-grid label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .applicant-readonly-grid input { width: 100%; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #f7f9f8; padding: 10px 12px; color: var(--ink); }
    .applicant-role-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
    .applicant-role-option { position: relative; }
    .applicant-role-option input { position: absolute; opacity: 0; pointer-events: none; }
    .applicant-role-option label { display: grid; min-height: 92px; align-content: center; gap: 5px; border: 1px solid var(--line); border-radius: var(--radius-md); background: #fff; padding: 12px; cursor: pointer; text-align: center; }
    .applicant-role-option label { transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease, background .15s ease; }
    .applicant-role-option label:hover { transform: translateY(-2px); border-color: var(--accent); background: #faf4ec; box-shadow: 0 5px 14px rgba(44,30,22,.1); }
    .applicant-role-option input:checked + label { border: 2px solid var(--accent-pressed); background: #d3e2d8; color: #173c2c; padding: 11px; box-shadow: inset 0 0 0 1px rgba(23,60,44,.08); }
    .applicant-role-option input:focus-visible + label { outline: 3px solid var(--teal); outline-offset: 2px; }
    .applicant-role-option strong { font-size: 13px; }
    .applicant-role-option small { color: var(--muted); font-size: 10px; line-height: 1.35; }
    .applicant-create-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .applicant-create-summary div { border: 1px solid var(--line); border-radius: var(--radius-md); background: #fff; padding: 13px; }
    .applicant-create-summary dt { color: var(--muted); font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .applicant-create-summary dd { margin: 5px 0 0; font-size: 13px; font-weight: 800; }
    .applicant-review-actions { display: flex; justify-content: space-between; gap: 8px; border-top: 1px solid var(--line); padding-top: 14px; }
    .applicant-review-actions-right { display: flex; gap: 8px; margin-left: auto; }
    .applicant-role-error { border: 1px solid #c83e37; border-radius: var(--radius-sm); background: #f9e9e7; padding: 10px 12px; color: #8f2f2a; font-size: 13px; font-weight: 700; }
    @keyframes user-management-shimmer { to { background-position: -200% 0; } }
    @media (max-width: 1000px) {
      .applicant-role-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      .user-management-header { align-items: flex-start; flex-direction: column; }
      .user-management-header h1 { font-size: 25px; }
      .user-management-cards { grid-template-columns: 1fr; gap: 12px; }
      .user-onboarding-summary { grid-template-columns: 1fr; gap: 8px; }
      .applicant-review-modal { width: calc(100vw - 16px); max-height: calc(100vh - 16px); }
      .applicant-review-progress { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .applicant-id-selected { grid-template-columns: 1fr; }
      .applicant-id-preview-frame { min-height: 140px; }
      .applicant-verification-grid, .applicant-readonly-grid, .applicant-create-summary { grid-template-columns: 1fr; }
      .applicant-role-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .applicant-review-actions { align-items: stretch; flex-direction: column-reverse; }
      .applicant-review-actions-right { width: 100%; }
      .applicant-review-actions-right button { flex: 1; }
      .applicant-role-option label { min-height: 84px; padding: 10px; }
      .applicant-role-option input:checked + label { padding: 9px; }
      .user-management-card { min-height: 160px; padding: 20px; }
      .user-management-nav { align-items: flex-start; flex-direction: column; }
      .user-management-toolbar { align-items: stretch; }
      .user-management-filter { min-width: 100%; }
      .user-management-count { margin-left: 0; }
      .user-management-table, .user-invitations-table, .verification-record-table { display: block; min-width: 0; }
      .user-management-table thead, .user-invitations-table thead, .verification-record-table thead { display: none; }
      .user-management-table tbody, .user-invitations-table tbody, .verification-record-table tbody { display: grid; gap: 11px; }
      .user-management-table tbody tr:not(.user-management-empty-row),
      .user-invitations-table tbody tr:not(.user-management-empty-row),
      .verification-record-table tbody tr:not(.user-management-empty-row) { display: block; overflow: visible; border: 1px solid var(--line); border-radius: var(--radius-md); background: #fff; }
      .user-management-table td, .user-invitations-table td, .verification-record-table td { display: flex; min-height: 44px; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 10px 12px; white-space: normal; overflow-wrap: anywhere; }
      .user-management-table td::before, .user-invitations-table td::before, .verification-record-table td::before { flex: 0 0 92px; color: var(--muted); content: attr(data-label); font-size: 10px; font-weight: 700; text-transform: uppercase; }
      .user-management-table .user-management-empty-row td, .user-invitations-table .user-management-empty-row td, .verification-record-table .user-management-empty-row td { display: block; }
      .verification-record-toolbar { align-items: stretch; flex-direction: column; }
      .verification-record-toolbar .user-management-filter { max-width: none; }
      .verification-record-detail dl { grid-template-columns: 1fr; }
      .user-management-page .table-scroll { overflow: visible; }
      .user-action-list { position: static; margin-top: 5px; }
      .user-invitation-actions { justify-content: flex-start; }
    }
    @media (prefers-reduced-motion: reduce) {
      .user-management-skeleton span { animation: none; }
      .user-management-card { transition: none; }
    }
  </style>`;
}

function formatVerificationTimestamp(value) {
  const parsed = new Date(value);
  return value && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : 'Not recorded';
}

function verificationRecordActorName(userId) {
  const user = all('users').find(item => String(item.id) === String(userId));
  return user?.name || user?.email || String(userId || 'Unknown Administrator');
}

function userManagementTabSelector(tab) {
  if (tab === 'invitations') return '#userInvitationsTab';
  if (tab === 'verification-records') return '#userVerificationRecordsTab';
  return '#userStaffTab';
}

function verificationRecordListContent() {
  const history = state.verificationRecordHistory;
  const recordRows = history.rows.map(record => {
    const statusClass = record.final_status === 'Approved'
      ? 'status-good'
      : record.final_status === 'Rejected' ? 'status-out' : 'status-low';
    const faceResult = record.face_match_result === 'match'
      ? 'Match'
      : record.face_match_result === 'no_match' ? 'No match' : 'Unable to compare';
    return `<tr>
      <td data-label="Applicant"><button type="button" class="verification-record-open" data-action="verification-record-open" data-id="${esc(record.id)}">${esc(record.applicant_name)}</button></td>
      <td data-label="Role"><span class="user-management-role-badge">${esc(record.role_assigned || 'Not assigned')}</span></td>
      <td data-label="Date">${esc(formatUserManagementDate(record.verified_at))}</td>
      <td data-label="Result"><span class="status ${statusClass}">${esc(record.final_status)} · ${esc(faceResult)}</span></td>
      <td data-label="Verified by">${esc(verificationRecordActorName(record.verified_by))}</td>
    </tr>`;
  });
  let content = '';
  if (history.error) {
    content = `<div class="user-invite-error" role="alert"><span>${esc(history.error)}</span><button type="button" class="ghost-btn" data-action="retry-verification-records">Retry</button></div>`;
  } else if (history.loading || !history.loaded) {
    content = '<div class="user-management-skeleton" role="status" aria-label="Loading verification records"><span></span><span></span><span></span><span></span></div>';
  } else if (!recordRows.length) {
    content = `<div class="user-management-empty"><strong>${history.search ? 'No records match that applicant name.' : 'No verification records yet.'}</strong><p>${history.search ? 'Try another name or clear the search.' : 'Completed verified onboarding records will appear here.'}</p></div>`;
  } else {
    content = `<div class="table-scroll"><table class="verification-record-table">
      <thead><tr><th>Applicant</th><th>Role</th><th>Date</th><th>Result</th><th>Verified by</th></tr></thead>
      <tbody>${recordRows.join('')}</tbody>
    </table></div>`;
  }
  return `<div class="verification-record-toolbar">
    <label class="user-management-filter">Search by applicant name<input id="verificationRecordSearch" type="search" value="${esc(history.search)}" placeholder="Enter a name" autocomplete="off"></label>
    <span class="user-management-count" role="status">${history.loaded ? `${history.rows.length} record${history.rows.length === 1 ? '' : 's'}` : 'Read-only audit history'}</span>
  </div>
  ${history.rows.length >= 1000 && !history.error ? '<p class="verification-record-warning">Showing up to 1,000 newest matching records. Narrow your search to find older records.</p>' : ''}
  <div class="panel table-panel">${content}</div>`;
}

function openVerificationRecordDetail(recordId) {
  if (state.role !== 'Administrator') return toast('Only Administrators can view verification records.', 'error');
  const record = state.verificationRecordHistory.rows.find(item => String(item.id) === String(recordId));
  if (!record) return toast('That verification record is not available in the current results.', 'error');
  const inviter = state.userInviteHistory.rows.find(item => String(item.id) === String(record.invitation_id));
  const timeline = [
    { title: 'Invitation created', date: inviter?.invited_at, detail: record.invitation_id || 'No invitation linked' },
    { title: 'Identity reviewed', date: record.verified_at, detail: verificationRecordActorName(record.verified_by) },
    { title: 'Role assigned', date: record.assigned_at, detail: record.role_assigned || 'No role assigned' },
    { title: 'Account profile created', date: record.created_at, detail: record.profile_id || 'No profile linked' }
  ].filter(item => item.date);
  if (record.supersedes_id) {
    timeline.push({ title: 'Corrects earlier record', date: record.created_at, detail: record.supersedes_id });
  }
  timeline.sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
  const ocr = record.ocr_summary || {};
  const faceScore = record.face_match_score !== null
    && record.face_match_score !== undefined
    && Number.isFinite(Number(record.face_match_score))
    ? `${Number(record.face_match_score).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
    : 'Unavailable';
  const statusClass = record.final_status === 'Approved'
    ? 'status-good'
    : record.final_status === 'Rejected' ? 'status-out' : 'status-low';
  const timelineMarkup = timeline.length
    ? `<ol class="verification-record-timeline">${timeline.map(item => `<li><strong>${esc(item.title)}</strong><small>${esc(formatVerificationTimestamp(item.date))} · ${esc(item.detail)}</small></li>`).join('')}</ol>`
    : '<p class="field-help">No timeline events are available.</p>';
  const content = `<div class="verification-record-detail">
    <section>
      <h3>Identity</h3>
      <dl>
        <div><dt>Applicant</dt><dd>${esc(record.applicant_name)}</dd></div>
        <div><dt>ID type</dt><dd>${esc(record.id_type)}</dd></div>
        <div><dt>ID number</dt><dd>${esc(record.id_number_masked || 'Not recorded')}</dd></div>
        <div><dt>Date of birth</dt><dd>${esc(ocr.dob || 'Not recorded')}</dd></div>
        <div><dt>Address</dt><dd>${esc(ocr.address || 'Not recorded')}</dd></div>
        <div><dt>OCR</dt><dd>${ocr.ocr_passed ? 'Completed' : 'Manual review'}</dd></div>
      </dl>
    </section>
    <section>
      <h3>Verification</h3>
      <dl>
        <div><dt>Face match result</dt><dd>${esc(record.face_match_result.replace('_', ' '))}</dd></div>
        <div><dt>Match score</dt><dd>${esc(faceScore)}<small>Heuristic similarity indicator, not a probability.</small></dd></div>
        <div><dt>Final status</dt><dd><span class="status ${statusClass}">${esc(record.final_status)}</span></dd></div>
        <div><dt>Verified by</dt><dd>${esc(verificationRecordActorName(record.verified_by))}</dd></div>
        <div><dt>ID image</dt><dd>${record.id_image_path ? 'Stored in private evidence bucket' : 'Not recorded'}</dd></div>
        <div><dt>Selfie</dt><dd>${record.selfie_path ? 'Stored in private evidence bucket' : 'Not recorded'}</dd></div>
        <div><dt>Consent</dt><dd>${record.consent_given ? `Recorded ${esc(formatVerificationTimestamp(record.consent_at))}` : 'Not recorded'}</dd></div>
        ${record.override_used ? `<div><dt>Manual override</dt><dd>${esc(record.override_reason || 'Reason not recorded')}</dd></div>` : ''}
        <div><dt>Retention until</dt><dd>${esc(formatVerificationTimestamp(record.retention_until))}</dd></div>
      </dl>
    </section>
    <section>
      <h3>Role and account references</h3>
      <dl>
        <div><dt>Role</dt><dd>${esc(record.role_assigned || 'Not assigned')}</dd></div>
        <div><dt>Assigned by</dt><dd>${esc(record.assigned_by ? verificationRecordActorName(record.assigned_by) : 'Not assigned')}</dd></div>
        <div><dt>Invitation ID</dt><dd>${esc(record.invitation_id || 'Not linked')}</dd></div>
        <div><dt>Profile ID</dt><dd>${esc(record.profile_id || 'Not linked')}</dd></div>
        <div><dt>Record ID</dt><dd>${esc(record.id)}</dd></div>
      </dl>
    </section>
    <section><h3>Timeline</h3>${timelineMarkup}</section>
  </div>`;
  modal('Verification Record', content, '', 'verification-record-modal', 'read-only');
}

function usersPage() {
  if (state.role !== 'Administrator') {
    return '<section class="user-management-page"><div class="panel error-state" role="alert">Only Administrators can access User Management.</div></section>';
  }
  const users = all('users').filter(item => ['Active', 'Deactivated'].includes(item.accountStatus));
  const invitations = state.userInviteHistory.rows;
  const activeCount = users.filter(item => item.accountStatus === 'Active').length;
  const pendingCount = invitations.filter(item => effectiveInvitationStatus(item) === 'Pending').length;
  const pendingLabel = state.userInviteHistory.loading && !state.userInviteHistory.loaded
    ? 'Loading invitations…'
    : state.userInviteHistory.error
      ? 'Invitation count unavailable'
      : `${pendingCount} pending invitation${pendingCount === 1 ? '' : 's'}`;
  const refreshNotice = userManagementRefreshNotice();
  const header = userManagementHeader('Onboard employees, send invitations, and manage existing access.');
  if (state.userManagementPane !== 'workspace') {
    return `<section class="user-management-page">
      ${header}
      ${refreshNotice}
      <div class="user-management-cards" aria-label="User management actions">
        <button type="button" class="user-management-card" data-action="user-onboarding-open">
          <span class="card-topline"><span class="card-icon" aria-hidden="true">＋</span><span class="card-count">Guided onboarding</span></span>
          <span><span class="user-card-title">Add User</span><span class="user-card-description">Verify identity, review applicant details, assign a role, and continue to invitation.</span></span>
        </button>
        <button type="button" class="user-management-card" data-action="user-management-open" data-tab="staff">
          <span class="card-topline"><span class="card-icon" aria-hidden="true">♧</span><span class="card-count">${activeCount} active staff</span></span>
          <span><span class="user-card-title">Manage Staff</span><span class="user-card-description">View staff, manage access, account statuses, and roles.</span></span>
        </button>
        <button type="button" class="user-management-card" data-action="user-management-open" data-tab="verification-records">
          <span class="card-topline"><span class="card-icon" aria-hidden="true">✓</span><span class="card-count">Administrator only</span></span>
          <span><span class="user-card-title">Verification Records</span><span class="user-card-description">Search the read-only identity audit history and review its timeline.</span></span>
        </button>
      </div>
      <div class="user-onboarding-summary" aria-label="Onboarding status">
        <div><span>Pending reviews</span><strong>1 sample</strong><small>Mock applicant only · IVS is not connected</small></div>
        <div><span>Verification queue</span><strong>1 sample applicant</strong><small>Placeholder count · not live data</small></div>
        <div><span>Pending invitations</span><strong>${state.userInviteHistory.loaded ? pendingCount : state.userInviteHistory.error ? 'Unavailable' : '…'}</strong><small>${esc(state.userInviteHistory.error ? 'Invitation count could not be loaded' : state.userInviteHistory.loaded ? 'From current invitation records' : 'Loading invitation records')}</small></div>
      </div>
      <div class="user-management-refresh">
        <span class="field-help">Staff and invitation counts update from current records. Verification counts are sample placeholders.</span>
        <button type="button" class="ghost-btn" data-action="refresh-user-management" ${state.userManagementRefreshLoading ? 'disabled' : ''}>${state.userManagementRefreshLoading ? 'Refreshing…' : 'Refresh counts'}</button>
      </div>
      ${userManagementStyles()}
    </section>`;
  }

  const activeAdminCount = users.filter(item => item.role === 'Administrator' && item.accountStatus === 'Active').length;
  const roleOptions = USER_MANAGEMENT_ROLES.map(role =>
    `<option value="${esc(role)}" ${state.userManagementRole === role ? 'selected' : ''}>${esc(role)}</option>`
  ).join('');
  const filteredUsers = users.filter(item => {
    const matchesRole = state.userManagementRole === 'All' || item.role === state.userManagementRole;
    const matchesStatus = state.userManagementStatus === 'All' || item.accountStatus === state.userManagementStatus;
    const searchText = `${item.name || ''} ${item.email || ''} ${item.role || ''}`.toLowerCase();
    return matchesRole && matchesStatus && searchText.includes(state.userManagementSearch.toLowerCase());
  });
  const staffRows = filteredUsers.map(item => {
    const active = item.accountStatus === 'Active';
    const isCurrent = String(item.id) === String(state.user?.id);
    const isLastAdmin = active && item.role === 'Administrator' && activeAdminCount <= 1;
    const protection = [
      isCurrent ? 'Your current account is protected.' : '',
      isLastAdmin ? 'The last active Administrator cannot be demoted or deactivated.' : ''
    ].filter(Boolean).join(' ');
    const initials = (item.name || item.email || '?').trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    const actions = protection
      ? `<span class="user-protected"><strong>Protected</strong><small>${esc(protection)}</small></span>`
      : `<details class="user-action-menu">
          <summary aria-label="Actions for ${esc(item.name || item.email || 'staff member')}">Actions</summary>
          <div class="user-action-list">
            <button type="button" data-action="open-user-role" data-id="${esc(item.id)}">Change role</button>
            <button type="button" data-action="open-user-status" data-id="${esc(item.id)}" data-status="${active ? 'Deactivated' : 'Active'}">${active ? 'Deactivate' : 'Reactivate'}</button>
          </div>
        </details>`;
    const searchText = `${item.name || ''} ${item.email || ''} ${item.role || ''}`.toLowerCase();
    return `<tr class="user-row" data-user-search="${esc(searchText)}">
      <td data-label="Staff member"><div class="user-staff-cell"><span class="avatar user-avatar" aria-hidden="true">${esc(initials)}</span><span><strong>${esc(item.name || 'Staff member')}</strong><small>${esc(item.email || '')}</small></span></div></td>
      <td data-label="Role"><span class="user-management-role-badge">${esc(item.role || 'Unassigned')}</span></td>
      <td data-label="Status"><span class="status ${active ? 'status-good' : 'status-out'}">${active ? 'Active' : 'Inactive'}</span></td>
      <td data-label="Last updated">${esc(formatUserManagementDate(item.updatedAt))}</td>
      <td data-label="Actions">${actions}</td>
    </tr>`;
  });
  const staffContent = state.userManagementRefreshLoading && !users.length
    ? '<div class="user-management-skeleton" role="status" aria-label="Loading staff"><span></span><span></span><span></span><span></span></div>'
    : `<div class="toolbar user-management-toolbar">
        <label class="user-management-filter">Search staff<input id="userManagementSearch" type="search" value="${esc(state.userManagementSearch)}" placeholder="Name, email, or role"></label>
        <label class="user-management-filter">Role<select id="userManagementRoleFilter"><option value="All">All roles</option>${roleOptions}</select></label>
        <label class="user-management-filter">Status<select id="userManagementStatusFilter">
          <option value="All" ${state.userManagementStatus === 'All' ? 'selected' : ''}>All statuses</option>
          <option value="Active" ${state.userManagementStatus === 'Active' ? 'selected' : ''}>Active</option>
          <option value="Deactivated" ${state.userManagementStatus === 'Deactivated' ? 'selected' : ''}>Inactive</option>
        </select></label>
        <span class="user-management-count" id="userManagementCount">${filteredUsers.length} staff member${filteredUsers.length === 1 ? '' : 's'}</span>
      </div>
      <div class="panel table-panel"><div class="table-scroll"><table class="user-management-table">
        <thead><tr><th>Staff member</th><th>Role</th><th>Status</th><th>Last updated</th><th>Actions</th></tr></thead>
        <tbody>${staffRows.join('')}<tr class="user-management-empty-row" ${staffRows.length ? 'hidden' : ''}><td colspan="5"><div class="user-management-empty"><strong>${users.length ? 'No staff match these filters.' : 'No staff accounts yet.'}</strong><p>${users.length ? 'Try another search or clear a filter.' : 'Send an invitation to add the first staff member.'}</p>${users.length ? '' : '<button type="button" class="primary-btn" data-action="user-invite-open">Add new user</button>'}</div></td></tr></tbody>
      </table></div></div>`;

  const inviterNames = new Map(users.map(item => [String(item.id), item.name || item.email || 'Staff member']));
  const inviteRows = invitations.map(invite => {
    const status = effectiveInvitationStatus(invite);
    const statusClass = status === 'Accepted' ? 'status-good' : status === 'Pending' ? 'status-low' : 'status-out';
    const canResend = ['Pending', 'Expired'].includes(status);
    const canCancel = status === 'Pending';
    const busy = state.userManagementBusyId === invite.id;
    const busyAction = busy ? state.userManagementBusyAction : '';
    const inviter = inviterNames.get(String(invite.invited_by))
      || (String(invite.invited_by) === String(state.user?.id) ? state.user.email : 'Staff account');
    return `<tr>
      <td data-label="Email">${esc(invite.email)}</td>
      <td data-label="Full name">${esc(invite.full_name)}</td>
      <td data-label="Role"><span class="user-management-role-badge">${esc(invite.role)}</span></td>
      <td data-label="Status"><span class="status ${statusClass}">${esc(status)}</span></td>
      <td data-label="Invited">${esc(formatUserManagementDate(invite.invited_at))}</td>
      <td data-label="Expires">${esc(formatUserManagementDate(invite.expires_at))}</td>
      <td data-label="Accepted">${esc(formatUserManagementDate(invite.accepted_at))}</td>
      <td data-label="Invited by">${esc(inviter)}</td>
      <td data-label="Actions"><div class="user-invitation-actions">
        ${canResend ? `<button type="button" class="ghost-btn" data-action="resend-user-invite" data-id="${esc(invite.id)}" ${busy ? 'disabled' : ''}>${busy && busyAction === 'resend' ? 'Sending…' : 'Resend'}</button>` : ''}
        ${canCancel ? `<button type="button" class="ghost-btn" data-action="cancel-user-invite" data-id="${esc(invite.id)}" ${busy ? 'disabled' : ''}>${busy && busyAction === 'cancel' ? 'Cancelling…' : 'Cancel'}</button>` : '—'}
      </div></td>
    </tr>`;
  });
  const invitationContent = state.userInviteHistory.error
    ? `<div class="user-invite-error" role="alert"><span>${esc(state.userInviteHistory.error)}</span><button type="button" class="ghost-btn" data-action="retry-user-invites">Retry</button></div>`
    : state.userInviteHistory.loading && !state.userInviteHistory.loaded
      ? '<div class="user-management-skeleton" role="status" aria-label="Loading invitations"><span></span><span></span><span></span><span></span></div>'
      : `<div class="table-scroll"><table class="user-invitations-table">
          <thead><tr><th>Email</th><th>Full name</th><th>Role</th><th>Status</th><th>Invited</th><th>Expires</th><th>Accepted</th><th>Invited by</th><th>Actions</th></tr></thead>
          <tbody>${inviteRows.length
            ? inviteRows.join('')
            : '<tr class="user-management-empty-row"><td colspan="9"><div class="user-management-empty"><strong>No pending invitations</strong><p>New staff invitations will appear here with their delivery and acceptance details.</p><button type="button" class="primary-btn" data-action="user-invite-open">Add new user</button></div></td></tr>'
          }</tbody>
        </table></div>`;
  const selectedTab = ['invitations', 'verification-records'].includes(state.userManagementTab)
    ? state.userManagementTab
    : 'staff';
  const workspaceContent = selectedTab === 'staff'
    ? staffContent
    : selectedTab === 'invitations' ? invitationContent : verificationRecordListContent();
  const workspaceDescription = selectedTab === 'verification-records'
    ? 'Search Administrator-only verification history. Records are read-only and never expose the full ID number.'
    : 'View staff accounts and manage their invitation status.';
  const workspaceHeader = userManagementHeader(workspaceDescription);
  const action = `<button type="button" class="ghost-btn user-back-link" data-action="user-management-back">← Back to User Management</button>`;
  return `<section class="user-management-page">
    ${workspaceHeader}
    ${refreshNotice}
    <div class="user-management-nav">${action}<span class="field-help">Manage access and invitation status without leaving this page.</span></div>
    <div class="user-management-tabs" role="tablist" aria-label="User management sections">
      <button type="button" id="userStaffTab" role="tab" aria-selected="${selectedTab === 'staff'}" aria-controls="userManagementPanel" tabindex="${selectedTab === 'staff' ? '0' : '-1'}" data-action="user-management-tab" data-tab="staff">Staff</button>
      <button type="button" id="userInvitationsTab" role="tab" aria-selected="${selectedTab === 'invitations'}" aria-controls="userManagementPanel" tabindex="${selectedTab === 'invitations' ? '0' : '-1'}" data-action="user-management-tab" data-tab="invitations">Invitations <span class="tab-count">${state.userInviteHistory.loaded ? pendingCount : '…'}</span></button>
      <button type="button" id="userVerificationRecordsTab" role="tab" aria-selected="${selectedTab === 'verification-records'}" aria-controls="userManagementPanel" tabindex="${selectedTab === 'verification-records' ? '0' : '-1'}" data-action="user-management-tab" data-tab="verification-records">Verification Records <span class="tab-count">${state.verificationRecordHistory.loaded ? state.verificationRecordHistory.rows.length : '…'}</span></button>
    </div>
    <div id="userManagementPanel" class="user-management-panel" role="tabpanel" tabindex="0" aria-labelledby="${selectedTab === 'staff' ? 'userStaffTab' : selectedTab === 'invitations' ? 'userInvitationsTab' : 'userVerificationRecordsTab'}">
      ${workspaceContent}
    </div>
    ${userManagementStyles()}
  </section>`;
}

function resetUserInviteHistory() {
  userInviteRequestId += 1;
  verificationRecordRequestId += 1;
  window.clearTimeout(verificationRecordSearchTimer);
  state.userInviteHistory = { rows: [], loading: false, loaded: false, error: '' };
  state.verificationRecordHistory = {
    rows: [], loading: false, loaded: false, error: '', search: '', loadedSearch: ''
  };
  state.userManagementPane = 'home';
  state.userManagementTab = 'staff';
  state.applicantReviewStep = 1;
  state.applicantReviewRole = '';
  state.applicantReviewRoleError = false;
  state.applicantReviewInviteError = '';
  state.userManagementStatus = 'All';
  state.userManagementRole = 'All';
  state.userManagementSearch = '';
  state.userManagementBusyId = '';
  state.userManagementRefreshLoading = false;
  state.userManagementRefreshError = '';
  state.userManagementRefreshSaved = false;
}

function findUserManagementTarget(userId) {
  return all('users').find(item => String(item.id) === String(userId));
}

function userManagementProtectionReason(user) {
  if (String(user.id) === String(state.user?.id)) return 'You cannot change your own account here.';
  if (user.role === 'Administrator' && user.accountStatus === 'Active'
    && all('users').filter(item => item.role === 'Administrator' && item.accountStatus === 'Active').length <= 1) {
    return 'The last active Administrator is protected.';
  }
  return '';
}

function focusUserManagementAction(action, idValue) {
  requestAnimationFrame(() => {
    const target = [...document.querySelectorAll('.user-management-page [data-action]')]
      .find(element => element.dataset.action === action
        && (idValue == null || element.dataset.id === String(idValue)));
    (target || document.querySelector('#userInvitationsTab'))?.focus();
  });
}

function openUserOnboardingWizard() {
  resetApplicantIdImage();
  resetApplicantFaceCapture();
  state.applicantReviewStep = 1;
  state.applicantReviewRole = '';
  state.applicantReviewRoleError = false;
  state.applicantReviewInviteError = '';
  applicantReviewProceedNotice = '';
  applicantReviewOverrideReason = '';
  renderApplicantReviewModal();
}

function applicantReviewProgress(step) {
  const steps = ['Upload ID', 'OCR Extraction Results', 'Applicant Information', 'Face Capture', 'Face Match', 'Verification Summary', 'Assign Role', 'Account Review'];
  return `<ol class="applicant-review-progress" aria-label="Applicant review progress">${steps.map((label, index) => {
    const number = index + 1;
    return `<li class="${number === step ? 'is-active' : number < step ? 'is-complete' : ''}" ${number === step ? 'aria-current="step"' : ''}><span class="applicant-review-step-number">${number < step ? '✓' : number}</span><span>${label}</span></li>`;
  }).join('')}</ol>`;
}

function renderApplicantOcrFields() {
  const ocrFields = [
    ['full_name', 'Full Name', 'text'],
    ['dob', 'Date of Birth', 'date'],
    ['address', 'Address', 'text'],
    ['id_number', 'ID Number', 'text']
  ];
  return `<div class="applicant-ocr-fields">${ocrFields.map(([key, label, type]) => {
    const value = applicantOcrFields[key] || '';
    return `<label class="applicant-ocr-field">${label}
      <input type="${type}" data-ocr-field="${key}" value="${esc(value)}" ${value ? '' : 'placeholder="Not Detected"'} autocomplete="off">
      <small data-ocr-field-state="${key}">${value ? 'Value available · confirm for accuracy' : 'Not Detected · enter manually if known'}</small>
    </label>`;
  }).join('')}</div>`;
}

function applicantFaceStatusLabel(face) {
  if (!face) return 'Not analyzed';
  if (face.status === 'detected') return 'Face detected';
  if (face.status === 'multiple') return `Multiple faces detected (${face.count})`;
  if (face.status === 'blurry') return 'Face detected, but the image looks blurry';
  if (face.status === 'not_detected') return 'No face detected';
  return 'Unable to analyze image';
}

function renderApplicantFaceMatchPanel() {
  if (applicantFaceMatchState === 'running') {
    return `<div class="applicant-review-panel applicant-face-match">
      <h3>Comparing face photos</h3>
      <p class="field-help">The ID image and captured photo are analyzed locally in this browser. No image or face descriptor is uploaded or saved.</p>
      <p class="applicant-face-match-progress" role="status" aria-live="polite">Loading face models and comparing the two images…</p>
    </div>`;
  }

  const result = applicantFaceMatchResult;
  const faceRow = (label, face) => {
    const detectionConfidence = Number.isFinite(face?.confidence)
      ? ` · detector confidence ${Math.round(face.confidence * 100)}%`
      : '';
    return `<div class="applicant-face-match-row"><dt>${label}</dt><dd>${esc(applicantFaceStatusLabel(face))}${detectionConfidence}</dd></div>`;
  };
  const matchLabel = result?.result === 'match'
    ? 'MATCH'
    : result?.result === 'no_match'
      ? 'NO MATCH'
      : 'UNABLE TO COMPARE';
  const matchClass = result?.result === 'match' ? 'is-match' : result?.result === 'no_match' ? 'is-no-match' : 'is-unavailable';
  const guidance = result?.idFace?.status === 'not_detected'
    ? 'No face was detected on the ID. Use a clear, well-lit image with the ID photo visible.'
    : result?.idFace?.status === 'multiple'
      ? 'Multiple faces were detected on the ID image. Use an image that shows only the ID holder’s photo.'
      : result?.idFace?.status === 'blurry'
        ? 'The face on the ID looks blurry. Upload a sharper image of the ID.'
        : result?.capturedFace?.status === 'not_detected'
          ? 'No face was detected in the capture. Go back and retake a centered, well-lit photo.'
          : result?.capturedFace?.status === 'multiple'
            ? 'Multiple faces were detected in the capture. Go back and retake with only the applicant in frame.'
            : result?.capturedFace?.status === 'blurry'
              ? 'The captured face looks blurry. Go back and retake the photo in good lighting.'
              : '';

  return `<div class="applicant-review-panel applicant-face-match">
    <h3>Face Match Result</h3>
    <p class="field-help">This is an experimental, local comparison only—not identity verification, approval, or rejection. Review the original ID and photo yourself.</p>
    ${applicantFaceMatchError ? `<p class="applicant-face-match-error" role="alert">${esc(applicantFaceMatchError)}</p>` : ''}
    ${guidance ? `<p class="applicant-face-match-error" role="alert">${esc(guidance)}</p>` : ''}
    <dl class="applicant-face-match-details">
      ${faceRow('Face detected on ID', result?.idFace)}
      ${faceRow('Face detected in capture', result?.capturedFace)}
      ${result?.distance !== null && result?.distance !== undefined
        ? `<div class="applicant-face-match-row"><dt>Face distance</dt><dd>${result.distance.toFixed(3)} (lower is closer; IVS threshold ≤ ${result.threshold.toFixed(2)})</dd></div>
           <div class="applicant-face-match-row"><dt>Similarity indicator</dt><dd>${result.similarityIndicator}% <small>heuristic, not a probability</small></dd></div>`
        : '<div class="applicant-face-match-row"><dt>Similarity indicator</dt><dd>Unavailable</dd></div>'}
      <div class="applicant-face-match-row"><dt>Match confidence</dt><dd>Not calibrated by the reused model</dd></div>
    </dl>
    <p class="applicant-face-match-result ${matchClass}" role="status" aria-live="polite">${matchLabel}</p>
    <p class="applicant-id-help">The comparison uses temporary in-memory face descriptors. Nothing is stored or sent to a server.</p>
  </div>`;
}

function renderApplicantVerificationSummary() {
  const ocrFields = [
    ['Full Name', applicantOcrFields.full_name],
    ['Date of Birth', applicantOcrFields.dob],
    ['Address', applicantOcrFields.address],
    ['ID Number', applicantOcrFields.id_number]
  ];
  const result = applicantFaceMatchResult;
  const idReady = Boolean(applicantIdImageValid && applicantIdFile);
  const ocrReady = Boolean(applicantOcrCompleted);
  const faceIdDetected = result?.idFace?.status === 'detected';
  const faceCaptureDetected = result?.capturedFace?.status === 'detected';
  const matchFound = result?.result === 'match';
  const allFieldsPresent = ocrFields.every(([, value]) => String(value || '').trim());
  const ocrNeedsReview = Boolean(applicantOcrWarning) || !allFieldsPresent;
  const reviewReady = idReady && ocrReady && !ocrNeedsReview && faceIdDetected && faceCaptureDetected && matchFound;
  const overallStatus = reviewReady ? 'Ready for administrator review' : 'Manual Review Required';
  const overallClass = reviewReady ? 'is-success' : 'is-warning';
  const matchScore = Number.isFinite(result?.similarityIndicator)
    ? `${result.similarityIndicator}%`
    : 'Unavailable';
  const detectionConfidence = face => Number.isFinite(face?.confidence)
    ? `${Math.round(face.confidence * 100)}%`
    : 'Unavailable';
  const detectionState = face => {
    const detected = face?.status === 'detected';
    const multiple = face?.status === 'multiple';
    return {
      label: applicantFaceStatusLabel(face),
      className: detected ? 'is-success' : multiple ? 'is-warning' : 'is-failure'
    };
  };
  const idState = idReady ? 'is-success' : 'is-failure';
  const ocrState = ocrReady && !ocrNeedsReview ? 'is-success' : 'is-warning';
  const ocrLabel = ocrReady && !ocrNeedsReview
    ? 'OCR Completed'
    : ocrReady
      ? 'Completed · review fields'
      : 'OCR incomplete';
  const matchState = result?.result === 'match'
    ? 'is-success'
    : result?.result === 'no_match'
      ? 'is-failure'
      : 'is-warning';
  const idFaceState = detectionState(result?.idFace);
  const capturedFaceState = detectionState(result?.capturedFace);
  const statusTag = (label, className) => `<span class="applicant-verification-tag ${className}">${label}</span>`;

  return `<section class="applicant-review-panel applicant-verification-summary" aria-labelledby="applicant-verification-heading">
    <h3 id="applicant-verification-heading">Identity Verification Summary</h3>
    <div class="applicant-verification-overall ${overallClass}" role="status" aria-live="polite">
      <span class="applicant-verification-overall-label">Overall status</span>
      <strong>${overallStatus}</strong>
      <small>This is a review checklist only. It does not approve or reject the applicant.</small>
    </div>
    <div class="applicant-verification-cards">
      <section class="applicant-verification-card" aria-labelledby="applicant-verification-id-heading">
        <div class="applicant-verification-card-heading">
          <h4 id="applicant-verification-id-heading">ID Upload</h4>
          ${statusTag(idReady ? 'Uploaded Successfully' : 'ID unavailable', idState)}
        </div>
        ${idReady
          ? `<img class="applicant-verification-thumbnail" src="${esc(applicantIdPreviewUrl || '')}" alt="Uploaded ID image preview">`
          : '<p class="applicant-verification-missing">No valid ID image is available.</p>'}
      </section>
      <section class="applicant-verification-card" aria-labelledby="applicant-verification-ocr-heading">
        <div class="applicant-verification-card-heading">
          <h4 id="applicant-verification-ocr-heading">OCR Extraction</h4>
          ${statusTag(ocrLabel, ocrState)}
        </div>
        ${applicantOcrWarning ? `<p class="applicant-verification-note">${esc(applicantOcrWarning)}</p>` : ''}
        <dl class="applicant-verification-fields">${ocrFields.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(String(value || '').trim() || 'Not Detected')}</dd></div>`).join('')}</dl>
      </section>
      <section class="applicant-verification-card" aria-labelledby="applicant-verification-face-heading">
        <div class="applicant-verification-card-heading">
          <h4 id="applicant-verification-face-heading">Face Verification</h4>
          ${statusTag(result?.result === 'match' ? 'Match' : result?.result === 'no_match' ? 'No Match' : 'Unable to Compare', matchState)}
        </div>
        ${applicantFaceMatchError ? `<p class="applicant-verification-note">${esc(applicantFaceMatchError)}</p>` : ''}
        <dl class="applicant-verification-fields applicant-verification-face-fields">
          <div><dt>Face detected on ID</dt><dd>${statusTag(esc(idFaceState.label), idFaceState.className)}<small>Detector confidence: ${detectionConfidence(result?.idFace)}</small></dd></div>
          <div><dt>Face detected in camera capture</dt><dd>${statusTag(esc(capturedFaceState.label), capturedFaceState.className)}<small>Detector confidence: ${detectionConfidence(result?.capturedFace)}</small></dd></div>
          <div><dt>Match score</dt><dd>${matchScore} <small>similarity indicator; not a probability</small></dd></div>
          <div><dt>Confidence score</dt><dd>Not calibrated</dd></div>
        </dl>
        ${applicantFacePreviewUrl
          ? `<img class="applicant-verification-thumbnail applicant-verification-face-thumbnail" src="${esc(applicantFacePreviewUrl)}" alt="Captured face photo preview">`
          : '<p class="applicant-verification-missing">No captured face photo is available.</p>'}
        <p class="applicant-verification-note">A match result is only a local comparison signal and is not an identity decision.</p>
      </section>
    </div>
  </section>`;
}

function applicantRoleVerificationContext() {
  const ocrFieldsPresent = ['full_name', 'dob', 'address', 'id_number']
    .every(field => String(applicantOcrFields[field] || '').trim());
  const ocrPassed = Boolean(
    applicantIdImageValid
    && applicantOcrCompleted
    && !applicantOcrWarning
    && ocrFieldsPresent
  );
  const faceMatchPassed = applicantFaceMatchResult?.result === 'match';
  const verificationPassed = ocrPassed && faceMatchPassed;
  const applicantName = String(applicantOcrFields.full_name || '').trim() || 'Name not detected';
  const statusTag = (label, className) => `<span class="applicant-verification-tag ${className}">${label}</span>`;

  return {
    applicantName,
    ocrPassed,
    faceMatchPassed,
    verificationPassed,
    markup: `<section class="applicant-role-verification-context" aria-label="Verification context">
      <div>
        <span class="applicant-role-context-eyebrow">${verificationPassed ? 'Verified Applicant' : 'Applicant Under Review'}</span>
        <strong>${esc(applicantName)}</strong>
      </div>
      <div class="applicant-role-context-checks">
        ${statusTag(ocrPassed ? 'OCR Passed' : 'OCR Needs Review', ocrPassed ? 'is-success' : 'is-warning')}
        ${statusTag(faceMatchPassed ? 'Face Match Passed' : 'Face Match Needs Review', faceMatchPassed ? 'is-success' : 'is-warning')}
      </div>
      <p class="applicant-role-context-status ${verificationPassed ? 'is-success' : 'is-warning'}"><strong>Verification Status:</strong> ${verificationPassed ? 'Passed' : 'Manual Review Required'}</p>
      <small>This summarizes prior check results only; role selection does not approve, create, or invite an account.</small>
    </section>`
  };
}

function renderApplicantReviewModal() {
  const step = state.applicantReviewStep || 1;
  let panel = '';
  if (step === 1) {
    panel = `<div class="applicant-review-panel">
      <h3>Upload a valid ID</h3>
      <p class="field-help">Choose an image of the employee’s ID. After upload, text extraction runs locally in this browser.</p>
      <div class="applicant-id-upload">
        <input id="applicantIdFile" name="idImage" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" hidden aria-describedby="applicantIdFileHelp applicantIdFileError">
        <div class="applicant-id-empty" ${applicantIdFile ? 'hidden' : ''}>
          <span class="applicant-id-upload-icon" aria-hidden="true">↑</span>
          <strong>Choose an ID image</strong>
          <span data-applicant-id-empty-state>${applicantIdImageLoading ? 'Checking selected image…' : 'JPG, JPEG, or PNG · up to 5 MB'}</span>
          <button type="button" class="secondary-btn" data-action="select-applicant-id-image">Upload image</button>
        </div>
        <div class="applicant-id-selected" ${applicantIdFile ? '' : 'hidden'}>
          <div class="applicant-id-preview-frame"><img src="${esc(applicantIdPreviewUrl || '')}" alt="Preview of the selected ID image"></div>
          <div class="applicant-id-file-details">
            <strong>${esc(applicantIdFile?.name || '')}</strong>
            <span data-applicant-id-ready>${applicantIdImageLoading ? 'Checking image preview…' : 'Image ready to extract details'}</span>
            <span data-applicant-id-rotation-state role="status" aria-live="polite">Original orientation</span>
            <div class="applicant-id-file-actions">
              <button type="button" class="ghost-btn" data-action="rotate-applicant-id-left" aria-label="Rotate image left 90 degrees">↶ Rotate left</button>
              <button type="button" class="ghost-btn" data-action="rotate-applicant-id-right" aria-label="Rotate image right 90 degrees">↷ Rotate right</button>
              <button type="button" class="ghost-btn" data-action="reset-applicant-id-orientation">Reset orientation</button>
              <button type="button" class="ghost-btn" data-action="change-applicant-id-image">Change image</button>
              <button type="button" class="ghost-btn" data-action="remove-applicant-id-image">Remove image</button>
            </div>
          </div>
        </div>
        <p id="applicantIdFileError" class="applicant-id-error" role="alert" aria-live="assertive" ${applicantIdImageError ? '' : 'hidden'}>${esc(applicantIdImageError)}</p>
        <div class="applicant-ocr-progress" data-applicant-ocr-progress role="status" aria-live="polite" ${applicantOcrLoading ? '' : 'hidden'}>
          <progress max="1" value="${applicantOcrProgress}"></progress>
          <span data-applicant-ocr-progress-message>${esc(applicantOcrProgressMessage || 'Preparing text extraction…')}</span>
        </div>
        <p id="applicantIdFileHelp" class="applicant-id-help">The ID image and extracted details stay in this browser. They are not uploaded or saved.</p>
      </div>
    </div>`;
  } else if (step === 2) {
    panel = `<div class="applicant-review-panel">
      <h3>OCR Extraction Results</h3>
      <p class="field-help">Review every field against the ID. Text extraction can make mistakes and does not verify identity.</p>
      ${applicantOcrWarning ? `<div class="applicant-ocr-warning" role="alert">${esc(applicantOcrWarning)}</div>` : ''}
      ${renderApplicantOcrFields()}
      <p class="applicant-id-help">No image or extracted information is saved in this phase.</p>
    </div>`;
  } else if (step === 3) {
    panel = `<div class="applicant-review-panel">
      <h3>Applicant Information</h3>
      <p class="field-help">Review and correct the information extracted from the uploaded ID. Changes stay in this browser.</p>
      ${applicantOcrWarning ? `<div class="applicant-ocr-warning" role="alert">${esc(applicantOcrWarning)}</div>` : ''}
      ${renderApplicantOcrFields()}
    </div>`;
  } else if (step === 4) {
    panel = `<div class="applicant-review-panel applicant-face-capture">
      <h3>Capture face photo</h3>
      <p class="field-help">Position the employee in the camera frame, then capture a clear photo. It will be compared locally with the ID photo in the next step and will not be uploaded or saved.</p>
      <div class="applicant-face-camera-frame">
        <video class="applicant-face-camera-preview" autoplay playsinline muted aria-label="Live camera preview" ${applicantFaceCaptureBlob ? 'hidden' : ''}></video>
        <img class="applicant-face-photo-preview" alt="Captured face photo preview" ${applicantFaceCaptureBlob ? '' : 'hidden'}>
        <p class="applicant-face-camera-placeholder" data-applicant-face-camera-placeholder>Camera preview will appear here after access is granted.</p>
      </div>
      <p class="applicant-face-camera-status" data-applicant-face-camera-status role="status" aria-live="polite"></p>
      <p class="applicant-face-camera-error" data-applicant-face-camera-error role="alert" aria-live="assertive" hidden></p>
      <div class="applicant-face-camera-controls">
        <button type="button" class="secondary-btn" data-action="applicant-face-capture" disabled>Capture photo</button>
        <button type="button" class="ghost-btn" data-action="applicant-face-retake" hidden>Retake photo</button>
        <button type="button" class="ghost-btn" data-action="applicant-face-camera-retry" hidden>Try camera again</button>
      </div>
    </div>`;
  } else if (step === 5) {
    panel = renderApplicantFaceMatchPanel();
  } else if (step === 6) {
    panel = renderApplicantVerificationSummary();
  } else if (step === 7) {
    const verificationContext = applicantRoleVerificationContext();
    panel = `<div class="applicant-review-panel">
      <h3>Assign Role</h3>
      <p class="field-help">Choose one CostTrack access level for this applicant. The selection remains in this browser and is not saved.</p>
      ${verificationContext.markup}
      ${state.applicantReviewRoleError ? '<div class="applicant-role-error" role="alert" aria-live="assertive" tabindex="-1" data-applicant-role-error>Select a role before continuing.</div>' : ''}
      <fieldset class="applicant-role-grid">
        <legend>Choose one employee role</legend>
        ${USER_ONBOARDING_ROLE_CARDS.map((role, index) => `<div class="applicant-role-option"><input id="applicantRole-${index}" type="radio" name="applicantRole" value="${esc(role.value)}" ${state.applicantReviewRole === role.value ? 'checked' : ''}><label for="applicantRole-${index}"><strong>${esc(role.label)}</strong><small>${esc(role.description)}</small></label></div>`).join('')}
      </fieldset>
    </div>`;
  } else {
    const verificationContext = applicantRoleVerificationContext();
    const role = USER_ONBOARDING_ROLE_CARDS.find(item => item.value === state.applicantReviewRole);
    const roleLabel = role?.label || 'No role selected';
    const faceMatchResult = applicantFaceMatchResult;
    const matchScore = Number.isFinite(faceMatchResult?.similarityIndicator)
      ? `${faceMatchResult.similarityIndicator}%`
      : 'Unavailable';
    const faceCaptured = Boolean(applicantFaceCaptureBlob);
    const readyForAccountCreation = verificationContext.verificationPassed && Boolean(role);
    panel = `<div class="applicant-review-panel">
      <h3>Account Review</h3>
      <p class="field-help">Review the employee, verification results, and role. Continuing opens the invitation form; the pending profile and verification record are written together.</p>
      <div class="applicant-account-review-banner ${readyForAccountCreation ? 'is-ready' : 'is-review'}" role="status" aria-live="polite">
        <strong>${readyForAccountCreation ? 'Ready for Account Creation' : 'Manual Review Required'}</strong>
        <small>${readyForAccountCreation ? 'The review details are present. No account or invitation has been created.' : 'Review the verification details before account creation. No account or invitation has been created.'}</small>
      </div>
      <div class="applicant-account-review-grid">
        <section class="applicant-account-review-card" aria-labelledby="account-review-identity-heading">
          <h4 id="account-review-identity-heading">Identity Information</h4>
          <dl class="applicant-account-review">
            <div><dt>Full Name</dt><dd>${esc(String(applicantOcrFields.full_name || '').trim() || 'Not Detected')}</dd></div>
            <div><dt>Date of Birth</dt><dd>${esc(String(applicantOcrFields.dob || '').trim() || 'Not Detected')}</dd></div>
            <div><dt>Address</dt><dd>${esc(String(applicantOcrFields.address || '').trim() || 'Not Detected')}</dd></div>
            <div><dt>ID Number</dt><dd>${esc(String(applicantOcrFields.id_number || '').trim() || 'Not Detected')}</dd></div>
            <div><dt>ID Type</dt><dd>${esc(String(applicantOcrIdType || '').trim() || 'Not Detected')}</dd></div>
          </dl>
        </section>
        <section class="applicant-account-review-card" aria-labelledby="account-review-verification-heading">
          <h4 id="account-review-verification-heading">Verification Information</h4>
          <dl class="applicant-account-review">
            <div><dt>OCR Completed</dt><dd>${verificationContext.ocrPassed ? 'Yes' : applicantOcrCompleted ? 'Completed · review required' : 'No'}</dd></div>
            <div><dt>Face Captured</dt><dd>${faceCaptured ? 'Yes' : 'No'}</dd></div>
            <div><dt>Face Match Passed</dt><dd>${verificationContext.faceMatchPassed ? 'Yes' : 'No'}</dd></div>
            <div><dt>Match Score</dt><dd>${matchScore}<small>Similarity indicator; not a probability</small></dd></div>
            <div><dt>Verification Status</dt><dd>${verificationContext.verificationPassed ? 'Passed' : 'Manual Review Required'}</dd></div>
          </dl>
          <p class="applicant-account-review-note">The face comparison is a local review signal, not an automated approval or rejection.</p>
        </section>
        <section class="applicant-account-review-card" aria-labelledby="account-review-role-heading">
          <h4 id="account-review-role-heading">Role Information</h4>
          <dl class="applicant-account-review">
            <div><dt>Selected Role</dt><dd>${esc(roleLabel)}</dd></div>
          </dl>
          ${role ? `<p class="applicant-account-review-note">${esc(role.description)}</p>` : ''}
        </section>
        <section class="applicant-account-review-card" aria-labelledby="account-review-account-heading">
          <h4 id="account-review-account-heading">Account Information</h4>
          <dl class="applicant-account-review">
            <div><dt>Email Address</dt><dd>Collected during account setup</dd></div>
            <div><dt>Account Status</dt><dd>Pending Creation</dd></div>
          </dl>
        </section>
      </div>
      ${!verificationContext.verificationPassed ? `<label class="applicant-review-override-reason">Administrator override reason<textarea data-applicant-override-reason maxlength="500" rows="3" placeholder="Explain why this applicant is approved despite the verification warning">${esc(applicantReviewOverrideReason)}</textarea><small class="field-help">Required for manual review. This reason is stored in the append-only verification record.</small></label>` : ''}
      ${applicantReviewProceedNotice ? `<p class="applicant-account-review-notice" role="alert" aria-live="assertive">${esc(applicantReviewProceedNotice)}</p>` : ''}
    </div>`;
  }
  const continueDisabled = (step === 1 && (!applicantIdImageValid || applicantIdImageLoading || applicantIdRotationLoading || applicantOcrLoading))
    || (step === 4 && !applicantFaceCaptureBlob)
    || (step === 5 && applicantFaceMatchState === 'running')
    || (step === 7 && !state.applicantReviewRole);
  const actions = `<div class="applicant-review-actions">
    ${step > 1 ? `<button type="button" class="ghost-btn" data-action="applicant-review-back">${step === 8 ? 'Back to Role Assignment' : '← Back'}</button>` : '<span></span>'}
    <div class="applicant-review-actions-right">
      <button type="button" class="ghost-btn" data-action="close-modal">Cancel</button>
      ${step < 8
        ? `<button type="button" class="primary-btn" data-action="applicant-review-next" ${continueDisabled ? 'disabled' : ''}>${step === 1 ? applicantOcrLoading ? 'Extracting…' : applicantIdRotationLoading ? 'Rotating…' : applicantOcrCompleted ? 'Run OCR again' : 'Extract information' : step === 5 && applicantFaceMatchState === 'running' ? 'Comparing faces…' : step === 6 ? 'Continue to Role Assignment' : step === 7 ? 'Continue to Account Review' : 'Continue'}</button>`
        : '<button type="button" class="primary-btn" data-action="applicant-review-proceed-create-account">Proceed to Create Account</button>'}
    </div>
  </div>`;
  modal('Employee Onboarding', `${applicantReviewProgress(step)}${panel}${actions}`, '', 'applicant-review-modal');
  const form = document.querySelector('#modalForm');
  if (form) form.dataset.type = 'applicant-review';
  if (step === 4) updateApplicantFaceCaptureUi();
  form?.addEventListener('change', event => {
    if (event.target.matches('input[name="applicantRole"]')) {
      state.applicantReviewRole = event.target.value;
      state.applicantReviewRoleError = false;
      state.applicantReviewInviteError = '';
      form.querySelector('[data-applicant-role-error]')?.remove();
      const continueButton = form.querySelector('[data-action="applicant-review-next"]');
      if (continueButton) continueButton.disabled = !state.applicantReviewRole;
    }
  });
  form?.addEventListener('input', event => {
    if (event.target.matches('[data-applicant-override-reason]')) {
      applicantReviewOverrideReason = event.target.value;
      applicantReviewProceedNotice = '';
      return;
    }
    const field = event.target.closest('[data-ocr-field]');
    if (!field) return;
    applicantOcrFields[field.dataset.ocrField] = field.value;
    const fieldState = [...form.querySelectorAll('[data-ocr-field-state]')]
      .find(element => element.dataset.ocrFieldState === field.dataset.ocrField);
    if (fieldState) fieldState.textContent = field.value ? 'Value available · confirm for accuracy' : 'Not Detected · enter manually if known';
  });
  requestAnimationFrame(() => {
    const roleError = document.querySelector('.applicant-review-modal [data-applicant-role-error]');
    const inviteError = document.querySelector('.applicant-review-modal [data-applicant-invite-error]');
    if (roleError || inviteError) (roleError || inviteError).focus();
    else document.querySelector('.applicant-review-modal [aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
  });
}

function updateApplicantFaceCaptureUi() {
  const form = document.querySelector('#modalForm[data-type="applicant-review"]');
  if (!form || state.applicantReviewStep !== 4) return;
  const video = form.querySelector('.applicant-face-camera-preview');
  const photo = form.querySelector('.applicant-face-photo-preview');
  const placeholder = form.querySelector('[data-applicant-face-camera-placeholder]');
  const status = form.querySelector('[data-applicant-face-camera-status]');
  const error = form.querySelector('[data-applicant-face-camera-error]');
  const captureButton = form.querySelector('[data-action="applicant-face-capture"]');
  const retakeButton = form.querySelector('[data-action="applicant-face-retake"]');
  const retryButton = form.querySelector('[data-action="applicant-face-camera-retry"]');
  const continueButton = form.querySelector('[data-action="applicant-review-next"]');
  const captured = Boolean(applicantFaceCaptureBlob && applicantFacePreviewUrl);

  if (video) {
    video.hidden = captured || !applicantFaceStream;
    if (applicantFaceStream && video.srcObject !== applicantFaceStream) video.srcObject = applicantFaceStream;
  }
  if (photo) {
    photo.hidden = !captured;
    if (captured && photo.src !== applicantFacePreviewUrl) photo.src = applicantFacePreviewUrl;
  }
  if (placeholder) {
    placeholder.hidden = captured || Boolean(applicantFaceStream);
    placeholder.textContent = applicantFaceCameraState === 'requesting'
      ? 'Waiting for camera permission…'
      : 'Camera preview will appear here after access is granted.';
  }
  if (status) {
    status.textContent = captured
      ? 'Photo captured. Review it or retake before continuing.'
      : applicantFaceCameraState === 'requesting'
        ? 'Requesting camera access…'
        : applicantFaceCameraState === 'starting'
          ? 'Starting camera preview…'
        : applicantFaceCameraState === 'ready'
          ? 'Camera is ready. Position the employee in the frame.'
          : applicantFaceCameraState === 'error'
            ? 'Camera is unavailable.'
            : 'Camera access has not started.';
  }
  if (error) {
    error.textContent = applicantFaceCameraError;
    error.hidden = !applicantFaceCameraError;
  }
  if (captureButton) {
    captureButton.disabled = applicantFaceCaptureLoading
      || !applicantFaceStream
      || applicantFaceCameraState !== 'ready'
      || !video?.videoWidth
      || !video?.videoHeight;
    captureButton.textContent = applicantFaceCaptureLoading ? 'Capturing…' : 'Capture photo';
    captureButton.hidden = captured;
  }
  if (retakeButton) retakeButton.hidden = !captured;
  if (retryButton) retryButton.hidden = captured || applicantFaceCameraState === 'requesting' || applicantFaceCameraState === 'ready';
  if (continueButton) continueButton.disabled = !captured || applicantFaceCaptureLoading;
}

function stopApplicantFaceCamera() {
  applicantFaceCameraRequestId += 1;
  const stream = applicantFaceStream;
  applicantFaceStream = null;
  stream?.getTracks().forEach(track => track.stop());
  const video = document.querySelector('.applicant-face-camera-preview');
  if (video) {
    video.pause();
    video.srcObject = null;
  }
}

function resetApplicantFaceCapture() {
  stopApplicantFaceCamera();
  if (applicantFacePreviewUrl) URL.revokeObjectURL(applicantFacePreviewUrl);
  applicantFaceCaptureBlob = null;
  applicantFacePreviewUrl = null;
  applicantFaceCameraState = 'idle';
  applicantFaceCameraError = '';
  applicantFaceCaptureLoading = false;
  resetApplicantFaceMatch();
}

function resetApplicantFaceMatch() {
  applicantFaceMatchRunId += 1;
  applicantFaceMatchState = 'idle';
  applicantFaceMatchResult = null;
  applicantFaceMatchError = '';
}

async function runApplicantFaceMatch() {
  stopApplicantFaceCamera();
  const runId = ++applicantFaceMatchRunId;
  applicantFaceMatchState = 'running';
  applicantFaceMatchResult = null;
  applicantFaceMatchError = '';
  state.applicantReviewStep = 5;
  renderApplicantReviewModal();

  try {
    if (!applicantIdImageValid || !(applicantIdFileForOcr || applicantIdFile) || !applicantFaceCaptureBlob) {
      throw new Error('Both a valid ID image and a captured face photo are required for comparison.');
    }
    const result = await window.CostTrackFaceMatching.compareImages(
      applicantIdFileForOcr || applicantIdFile,
      applicantFaceCaptureBlob
    );
    if (runId !== applicantFaceMatchRunId || state.applicantReviewStep !== 5) return;
    applicantFaceMatchResult = result;
  } catch (error) {
    if (runId !== applicantFaceMatchRunId || state.applicantReviewStep !== 5) return;
    console.error('Local face comparison failed.', error);
    applicantFaceMatchError = 'Face comparison could not be completed. Check the images and connection, then try again.';
  } finally {
    if (runId === applicantFaceMatchRunId && state.applicantReviewStep === 5) {
      applicantFaceMatchState = 'complete';
      renderApplicantReviewModal();
    }
  }
}

function applicantFaceCameraErrorMessage(error) {
  if (!window.isSecureContext) return 'Camera access requires HTTPS or localhost. Open CostTrack from a secure address and try again.';
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name)) {
    return 'Camera permission was denied. Allow camera access in your browser settings, then try again.';
  }
  if (['NotFoundError', 'DevicesNotFoundError'].includes(error?.name)) {
    return 'No camera was found. Connect a camera and try again.';
  }
  if (['NotReadableError', 'TrackStartError'].includes(error?.name)) {
    return 'The camera is unavailable or being used by another app. Close other apps and try again.';
  }
  if (error?.name === 'OverconstrainedError') {
    return 'The camera could not provide a supported video stream. Try another camera or browser.';
  }
  return 'Unable to open the camera. Check your browser permissions and try again.';
}

function waitForApplicantCameraFrame(video, playPromise) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const cleanup = () => {
      if (timeout) window.clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', check);
      video.removeEventListener('resize', check);
      video.removeEventListener('error', fail);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const check = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      finish(resolve);
    };
    const fail = () => {
      finish(reject, new Error('The camera preview could not be started.'));
    };
    timeout = window.setTimeout(() => {
      finish(reject, new Error('The camera did not provide a video frame in time.'));
    }, 8000);
    video.addEventListener('loadedmetadata', check);
    video.addEventListener('resize', check);
    video.addEventListener('error', fail);
    Promise.resolve(playPromise).catch(error => finish(reject, error));
    check();
  });
}

async function startApplicantFaceCamera() {
  if (state.applicantReviewStep !== 4 || applicantFaceCaptureBlob) return;
  stopApplicantFaceCamera();
  const requestId = applicantFaceCameraRequestId;
  applicantFaceCameraState = 'requesting';
  applicantFaceCameraError = '';
  updateApplicantFaceCaptureUi();

  if (!navigator.mediaDevices?.getUserMedia) {
    applicantFaceCameraState = 'error';
    applicantFaceCameraError = !window.isSecureContext
      ? applicantFaceCameraErrorMessage(new Error('Camera access is not available.'))
      : 'Camera access is unavailable in this browser. Connect a camera or try a supported browser.';
    updateApplicantFaceCaptureUi();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'user' } }
    });
    if (requestId !== applicantFaceCameraRequestId || state.applicantReviewStep !== 4) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }

    const video = document.querySelector('#modalForm[data-type="applicant-review"] .applicant-face-camera-preview');
    if (!video) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    applicantFaceStream = stream;
    applicantFaceCameraState = 'starting';
    updateApplicantFaceCaptureUi();
    video.hidden = false;
    video.srcObject = stream;
    await waitForApplicantCameraFrame(video, video.play());
    if (requestId !== applicantFaceCameraRequestId || state.applicantReviewStep !== 4) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    applicantFaceCameraState = 'ready';
    stream.getVideoTracks().forEach(track => {
      track.addEventListener('ended', () => {
        if (applicantFaceStream !== stream || applicantFaceCaptureBlob) return;
        stopApplicantFaceCamera();
        applicantFaceCameraState = 'error';
        applicantFaceCameraError = 'The camera stopped. Check the connection or permissions, then try again.';
        updateApplicantFaceCaptureUi();
      }, { once: true });
    });
  } catch (error) {
    if (requestId !== applicantFaceCameraRequestId) return;
    console.error('Applicant face camera could not be opened.', error);
    if (applicantFaceStream) stopApplicantFaceCamera();
    applicantFaceCameraState = 'error';
    applicantFaceCameraError = applicantFaceCameraErrorMessage(error);
  }
  updateApplicantFaceCaptureUi();
}

async function captureApplicantFace() {
  const video = document.querySelector('#modalForm[data-type="applicant-review"] .applicant-face-camera-preview');
  if (!applicantFaceStream || applicantFaceCameraState !== 'ready' || !video?.videoWidth || !video.videoHeight || applicantFaceCaptureLoading) return;
  applicantFaceCaptureLoading = true;
  updateApplicantFaceCaptureUi();
  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The captured image could not be prepared.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('The captured image could not be created.')), 'image/jpeg', 0.95);
    });
    applicantFacePreviewUrl = URL.createObjectURL(blob);
    applicantFaceCaptureBlob = blob;
    applicantFaceCameraState = 'captured';
    applicantFaceCameraError = '';
    resetApplicantFaceMatch();
    stopApplicantFaceCamera();
  } catch (error) {
    console.error('Applicant face photo capture failed.', error);
    applicantFaceCameraError = 'Unable to capture a photo. Make sure the camera preview is active and try again.';
  } finally {
    applicantFaceCaptureLoading = false;
    updateApplicantFaceCaptureUi();
  }
}

function retakeApplicantFacePhoto() {
  if (!applicantFaceCaptureBlob || applicantFaceCaptureLoading) return;
  if (applicantFacePreviewUrl) URL.revokeObjectURL(applicantFacePreviewUrl);
  applicantFaceCaptureBlob = null;
  applicantFacePreviewUrl = null;
  applicantFaceCameraState = 'idle';
  applicantFaceCameraError = '';
  resetApplicantFaceMatch();
  updateApplicantFaceCaptureUi();
  void startApplicantFaceCamera();
}

function updateApplicantIdUploadUi() {
  const form = document.querySelector('#modalForm[data-type="applicant-review"]');
  if (!form) return;
  const empty = form.querySelector('.applicant-id-empty');
  const selected = form.querySelector('.applicant-id-selected');
  const preview = form.querySelector('.applicant-id-preview-frame img');
  const fileName = form.querySelector('.applicant-id-file-details strong');
  const ready = form.querySelector('[data-applicant-id-ready]');
  const emptyState = form.querySelector('[data-applicant-id-empty-state]');
  const error = form.querySelector('#applicantIdFileError');
  const continueButton = form.querySelector('[data-action="applicant-review-next"]');
  const progress = form.querySelector('[data-applicant-ocr-progress]');
  const progressMessage = form.querySelector('[data-applicant-ocr-progress-message]');
  const changeButton = form.querySelector('[data-action="change-applicant-id-image"]');
  const removeButton = form.querySelector('[data-action="remove-applicant-id-image"]');
  const selectButton = form.querySelector('[data-action="select-applicant-id-image"]');
  const rotateLeftButton = form.querySelector('[data-action="rotate-applicant-id-left"]');
  const rotateRightButton = form.querySelector('[data-action="rotate-applicant-id-right"]');
  const resetOrientationButton = form.querySelector('[data-action="reset-applicant-id-orientation"]');
  const rotationState = form.querySelector('[data-applicant-id-rotation-state]');
  const imageBusy = applicantIdImageLoading || applicantIdRotationLoading || applicantOcrLoading;
  if (empty) empty.hidden = Boolean(applicantIdFile);
  if (selected) selected.hidden = !applicantIdFile;
  if (preview && applicantIdPreviewUrl) preview.src = applicantIdPreviewUrl;
  if (fileName) fileName.textContent = applicantIdFile?.name || '';
  if (ready) ready.textContent = applicantIdImageLoading
    ? 'Checking image preview…'
    : applicantIdRotationLoading ? 'Rotating preview…'
      : applicantOcrLoading ? 'Extracting text…' : 'Image ready to extract details';
  if (rotationState) {
    rotationState.textContent = applicantIdRotation === 0
      ? 'Original orientation'
      : applicantIdRotation === 180
        ? 'Rotated 180°'
        : applicantIdRotation === 90
          ? 'Rotated 90° clockwise'
          : 'Rotated 90° counterclockwise';
  }
  if (emptyState) emptyState.textContent = applicantIdImageLoading
    ? 'Checking selected image…'
    : 'JPG, JPEG, or PNG · up to 5 MB';
  if (error) {
    error.textContent = applicantIdImageError;
    error.hidden = !applicantIdImageError;
  }
  if (progress) {
    progress.hidden = !applicantOcrLoading;
    const bar = progress.querySelector('progress');
    if (bar) bar.value = applicantOcrProgress;
  }
  if (progressMessage) progressMessage.textContent = applicantOcrProgressMessage || 'Preparing text extraction…';
  if (changeButton) changeButton.disabled = imageBusy;
  if (removeButton) removeButton.disabled = imageBusy;
  if (selectButton) selectButton.disabled = imageBusy;
  if (rotateLeftButton) rotateLeftButton.disabled = imageBusy || !applicantIdImageValid;
  if (rotateRightButton) rotateRightButton.disabled = imageBusy || !applicantIdImageValid;
  if (resetOrientationButton) resetOrientationButton.disabled = imageBusy || !applicantIdImageValid || applicantIdRotation === 0;
  if (continueButton) {
    continueButton.disabled = !applicantIdImageValid || imageBusy;
    continueButton.textContent = applicantOcrLoading
      ? 'Extracting…'
      : applicantIdRotationLoading ? 'Rotating…'
        : applicantOcrCompleted ? 'Run OCR again' : 'Extract information';
  }
}

function resetApplicantOcrState() {
  applicantOcrRunId += 1;
  applicantOcrController?.abort();
  applicantOcrController = null;
  applicantOcrFields = { full_name: '', dob: '', address: '', id_number: '' };
  applicantOcrIdType = '';
  applicantOcrWarning = '';
  applicantOcrCompleted = false;
  applicantOcrLoading = false;
  applicantOcrProgress = 0;
  applicantOcrProgressMessage = '';
}

function resetApplicantIdImage() {
  resetApplicantOcrState();
  applicantIdRotationGeneration += 1;
  applicantIdPreviewGeneration += 1;
  if (applicantIdPendingPreviewUrl) URL.revokeObjectURL(applicantIdPendingPreviewUrl);
  if (applicantIdPreviewUrl) URL.revokeObjectURL(applicantIdPreviewUrl);
  applicantIdFile = null;
  applicantIdFileForOcr = null;
  applicantIdPreviewUrl = null;
  applicantIdPendingPreviewUrl = null;
  applicantIdRotation = 0;
  applicantIdRotationLoading = false;
  applicantIdImageValid = false;
  applicantIdImageLoading = false;
  applicantIdImageError = '';
}

function chooseApplicantIdImage() {
  document.querySelector('#applicantIdFile')?.click();
}

function createRotatedApplicantIdFile(file, rotation) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const sourceUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(sourceUrl);
      const { naturalWidth, naturalHeight } = image;
      const sideways = rotation % 180 !== 0;
      const canvas = document.createElement('canvas');
      canvas.width = sideways ? naturalHeight : naturalWidth;
      canvas.height = sideways ? naturalWidth : naturalHeight;
      const context = canvas.getContext('2d');
      if (!context || !naturalWidth || !naturalHeight) {
        reject(new Error('The image could not be prepared for rotation.'));
        return;
      }
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(rotation * Math.PI / 180);
      context.drawImage(image, -naturalWidth / 2, -naturalHeight / 2);
      const outputType = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)
        ? 'image/jpeg'
        : 'image/png';
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('The rotated image could not be created.'));
          return;
        }
        resolve(new File([blob], file.name, { type: outputType, lastModified: file.lastModified }));
      }, outputType, outputType === 'image/jpeg' ? 0.98 : undefined);
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error('The selected image could not be opened for rotation.'));
    };
    image.src = sourceUrl;
  });
}

async function rotateApplicantIdImage(degrees) {
  if (!applicantIdFile || !applicantIdImageValid || applicantIdRotationLoading || applicantOcrLoading) return;
  const generation = ++applicantIdRotationGeneration;
  const rotation = (applicantIdRotation + degrees + 360) % 360;
  applicantIdRotationLoading = true;
  applicantIdImageError = '';
  updateApplicantIdUploadUi();

  try {
    const rotatedFile = await createRotatedApplicantIdFile(applicantIdFile, rotation);
    if (generation !== applicantIdRotationGeneration) return;
    const previewUrl = URL.createObjectURL(rotatedFile);
    if (applicantIdPreviewUrl) URL.revokeObjectURL(applicantIdPreviewUrl);
    applicantIdPreviewUrl = previewUrl;
    applicantIdFileForOcr = rotatedFile;
    applicantIdRotation = rotation;
    resetApplicantOcrState();
  } catch (error) {
    if (generation !== applicantIdRotationGeneration) return;
    console.error('ID image rotation failed.', error);
    applicantIdImageError = 'Unable to rotate this image. You can continue with the current orientation or choose another image.';
  } finally {
    if (generation === applicantIdRotationGeneration) {
      applicantIdRotationLoading = false;
      updateApplicantIdUploadUi();
    }
  }
}

function resetApplicantIdOrientation() {
  if (!applicantIdFile || !applicantIdImageValid || applicantIdRotationLoading || applicantOcrLoading || applicantIdRotation === 0) return;
  try {
    const previewUrl = URL.createObjectURL(applicantIdFile);
    if (applicantIdPreviewUrl) URL.revokeObjectURL(applicantIdPreviewUrl);
    applicantIdPreviewUrl = previewUrl;
    applicantIdFileForOcr = applicantIdFile;
    applicantIdRotation = 0;
    applicantIdImageError = '';
    resetApplicantOcrState();
  } catch (error) {
    console.error('ID image orientation reset failed.', error);
    applicantIdImageError = 'Unable to reset the image orientation. You can continue with the current orientation or choose another image.';
  }
  updateApplicantIdUploadUi();
}

function handleApplicantIdFileChange(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  applicantIdPreviewGeneration += 1;
  if (applicantIdPendingPreviewUrl) URL.revokeObjectURL(applicantIdPendingPreviewUrl);
  applicantIdPendingPreviewUrl = null;
  applicantIdImageLoading = false;
  const validation = window.CostTrackLogic.validateIdImageFile(file);
  if (!validation.ok) {
    applicantIdImageError = applicantIdFile
      ? `${validation.message} Your previous image is unchanged.`
      : validation.message;
    updateApplicantIdUploadUi();
    return;
  }

  applicantIdImageError = '';
  applicantIdImageLoading = true;
  let previewUrl;
  try {
    previewUrl = URL.createObjectURL(file);
  } catch (error) {
    applicantIdImageLoading = false;
    applicantIdImageError = 'Unable to preview image. Choose a valid JPG, JPEG, or PNG image.'
      + (applicantIdFile ? ' Your previous image is unchanged.' : '');
    updateApplicantIdUploadUi();
    return;
  }
  const generation = applicantIdPreviewGeneration;
  applicantIdPendingPreviewUrl = previewUrl;
  updateApplicantIdUploadUi();
  const image = new Image();
  image.onload = () => {
    if (generation !== applicantIdPreviewGeneration) return;
    if (applicantIdPreviewUrl) URL.revokeObjectURL(applicantIdPreviewUrl);
    resetApplicantFaceCapture();
    applicantIdFile = file;
    applicantIdFileForOcr = file;
    applicantIdPreviewUrl = previewUrl;
    applicantIdPendingPreviewUrl = null;
    applicantIdImageValid = true;
    applicantIdImageLoading = false;
    applicantIdRotation = 0;
    resetApplicantOcrState();
    updateApplicantIdUploadUi();
  };
  image.onerror = () => {
    if (generation !== applicantIdPreviewGeneration) return;
    URL.revokeObjectURL(previewUrl);
    applicantIdPendingPreviewUrl = null;
    applicantIdImageLoading = false;
    applicantIdImageError = 'Unable to preview image. Choose a valid JPG, JPEG, or PNG image.'
      + (applicantIdFile ? ' Your previous image is unchanged.' : '');
    updateApplicantIdUploadUi();
  };
  image.src = previewUrl;
}

async function runApplicantIdOcr() {
  if (!applicantIdFile || !applicantIdImageValid || applicantOcrLoading) return;
  const runId = ++applicantOcrRunId;
  const controller = new AbortController();
  applicantOcrController = controller;
  applicantOcrLoading = true;
  applicantOcrCompleted = false;
  applicantOcrProgress = 0;
  applicantOcrProgressMessage = 'Preparing text extraction…';
  applicantOcrIdType = '';
  applicantOcrWarning = '';
  updateApplicantIdUploadUi();

  try {
    const result = await window.CostTrackOcr.extractId(applicantIdFileForOcr || applicantIdFile, {
      signal: controller.signal,
      onProgress: ({ message, progress }) => {
        if (runId !== applicantOcrRunId) return;
        applicantOcrProgressMessage = message;
        applicantOcrProgress = Math.max(0, Math.min(1, Number(progress) || 0));
        updateApplicantIdUploadUi();
      }
    });
    if (runId !== applicantOcrRunId) return;
    applicantOcrFields = { ...applicantOcrFields, ...result.fields };
    applicantOcrIdType = result.idTypeName || '';
    applicantOcrWarning = result.warning || '';
  } catch (error) {
    if (runId !== applicantOcrRunId || error.name === 'AbortError') return;
    console.error('ID OCR extraction failed.', error);
    applicantOcrFields = { full_name: '', dob: '', address: '', id_number: '' };
    applicantOcrIdType = '';
    applicantOcrWarning = 'Unable to confidently extract information. Please review the fields manually or upload a clearer image.';
  } finally {
    if (runId === applicantOcrRunId) {
      applicantOcrController = null;
      applicantOcrLoading = false;
      applicantOcrCompleted = true;
      state.applicantReviewStep = 2;
      renderApplicantReviewModal();
    }
  }
}

function openUserManagementInviteModal(preselectedRole = '', verificationDraft = null) {
  if (state.role !== 'Administrator') return toast('Only Administrators can invite staff users.', 'error');
  const inviteRoles = window.costTrackInviteRoles || [];
  const roleOptions = inviteRoles.map(role =>
    `<option value="${esc(role)}">${esc(role)}</option>`
  ).join('');
  const backdrop = modal('Add new user', `<div class="user-form-fields">
    <p class="field-help">${verificationDraft
      ? 'This reviewed applicant will be invited using the selected role. The ID image and selfie will be uploaded to a private Administrator-only bucket; the profile and verification record are written together. The full ID number is not stored.'
      : 'Send a secure invitation. The staff member will set their own password using the email link.'}</p>
    <label>Full name<input name="fullName" type="text" required maxlength="160" autocomplete="name" placeholder="Staff member’s full name" value="${esc(verificationDraft?.applicantName || '')}"></label>
    <label>Email address<input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="name@example.com" aria-describedby="userInviteEmailHelp duplicateInviteNotice"><small id="userInviteEmailHelp" class="field-help">Use the address where this person can receive the invitation.</small></label>
    <div class="duplicate-invite-notice" id="duplicateInviteNotice" role="status" aria-live="polite" hidden></div>
    <label>Role<select name="role" required ${verificationDraft ? 'disabled' : ''}><option value="">Select a staff role</option>${roleOptions}</select></label>
    <p class="role-access-note" data-role-access-note>Select a role to see what the person can access.</p>
    ${verificationDraft ? '<p class="field-help">Role is locked to the selection made in onboarding. Return to Role Assignment to change it.</p>' : ''}
  </div>`, 'Send invitation', 'user-management-form-modal');
  const form = backdrop.querySelector('#modalForm');
  form.dataset.type = 'user-invite';
  if (verificationDraft) userInvitationVerificationDrafts.set(form, verificationDraft);
  form.addEventListener('input', () => { state.modalDirty = true; });
  form.addEventListener('change', () => { state.modalDirty = true; });
  form.elements.role.addEventListener('change', () => {
    const note = form.querySelector('[data-role-access-note]');
    note.textContent = USER_ROLE_ACCESS_NOTES[form.elements.role.value] || 'Select a role to see what the person can access.';
  });
  if (inviteRoles.includes(preselectedRole)) {
    form.elements.role.value = preselectedRole;
    form.querySelector('[data-role-access-note]').textContent = USER_ROLE_ACCESS_NOTES[preselectedRole] || 'Select a role to see what the person can access.';
  }
  form.elements.email.addEventListener('input', () => updateInviteDuplicateNotice(form));
  if (!state.userInviteHistory.loaded && !state.userInviteHistory.loading) void loadUserInvitations(true);
}

function findInviteDuplicate(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;
  const existingUser = all('users').find(user => String(user.email || '').trim().toLowerCase() === normalizedEmail);
  if (existingUser) return { type: 'account', user: existingUser };
  const invitation = state.userInviteHistory.rows.find(row =>
    String(row.email || '').trim().toLowerCase() === normalizedEmail
    && ['Pending', 'Expired'].includes(effectiveInvitationStatus(row))
  );
  return invitation ? { type: 'invitation', invitation, status: effectiveInvitationStatus(invitation) } : null;
}

function updateInviteDuplicateNotice(form) {
  const notice = form.querySelector('#duplicateInviteNotice');
  const email = form.elements.email.value;
  const duplicate = findInviteDuplicate(email);
  if (!notice) return;
  if (!duplicate) {
    notice.hidden = true;
    notice.replaceChildren();
    return;
  }
  notice.hidden = false;
  if (duplicate.type === 'account') {
    notice.textContent = `An account already exists for ${duplicate.user.email}. Change the user's role in Staff instead of sending another invitation.`;
    return;
  }
  const resending = state.userManagementBusyId === duplicate.invitation.id && state.userManagementBusyAction === 'resend';
  notice.innerHTML = `<span>A ${duplicate.status.toLowerCase()} invitation already exists for ${esc(duplicate.invitation.email)}.</span><button type="button" class="ghost-btn" data-action="resend-user-invite" data-id="${esc(duplicate.invitation.id)}" ${state.userManagementBusyId === duplicate.invitation.id ? 'disabled' : ''}>${resending ? 'Sending…' : 'Resend invitation'}</button>`;
}

function openUserRoleModal(userId) {
  if (state.role !== 'Administrator') return toast('Only Administrators can change staff roles.', 'error');
  const user = findUserManagementTarget(userId);
  if (!user) return toast('This staff account is no longer available. Refresh the list and try again.', 'error');
  const protectedReason = userManagementProtectionReason(user);
  if (protectedReason) return toast(protectedReason, 'error');
  const roleOptions = USER_MANAGEMENT_ROLES.map(role =>
    `<option value="${esc(role)}" ${user.role === role ? 'selected' : ''}>${esc(role)}</option>`
  ).join('');
  const backdrop = modal('Change staff role', `<div class="user-form-fields">
    <p class="field-help">Changing this role updates the menus and data this staff member can access.</p>
    <label>Staff member<input value="${esc(user.name || user.email)}" readonly></label>
    <label>New role<select name="role" required>${roleOptions}</select></label>
    <label>Reason for role change<textarea name="reason" maxlength="500" required placeholder="Explain why this staff member's role is changing"></textarea><small class="field-help">Required for the audit record. Maximum 500 characters.</small></label>
  </div>`, 'Review change', 'user-management-form-modal');
  const form = backdrop.querySelector('#modalForm');
  form.dataset.type = 'user-role-change';
  form.dataset.userId = user.id;
  form.addEventListener('input', () => { state.modalDirty = true; });
  form.addEventListener('change', () => { state.modalDirty = true; });
}

function openUserStatusModal(userId, accountStatus) {
  if (state.role !== 'Administrator') return toast('Only Administrators can manage staff access.', 'error');
  const user = findUserManagementTarget(userId);
  if (!user || !['Active', 'Deactivated'].includes(user.accountStatus)) {
    return toast('This staff account is no longer available. Refresh the list and try again.', 'error');
  }
  const protectedReason = userManagementProtectionReason(user);
  if (protectedReason) return toast(protectedReason, 'error');
  if (!['Active', 'Deactivated'].includes(accountStatus) || accountStatus === user.accountStatus) {
    return toast('Choose a valid account status change.', 'error');
  }
  const deactivate = accountStatus === 'Deactivated';
  const effect = deactivate
    ? 'This immediately blocks sign-in and CostTrack API access. Operational history is retained.'
    : 'This restores sign-in and CostTrack access for the staff member.';
  const backdrop = modal(deactivate ? 'Deactivate staff account' : 'Reactivate staff account', `<div class="user-form-fields">
    <p class="field-help">${esc(effect)}</p>
    <label>Staff member<input value="${esc(user.name || user.email)}" readonly></label>
    <label>Reason for ${deactivate ? 'deactivation' : 'reactivation'}<textarea name="reason" maxlength="500" required placeholder="Explain this account status change"></textarea><small class="field-help">Required for the audit record. Maximum 500 characters.</small></label>
  </div>`, deactivate ? 'Review deactivation' : 'Review reactivation', 'user-management-form-modal');
  const form = backdrop.querySelector('#modalForm');
  form.dataset.type = 'user-account-status';
  form.dataset.userId = user.id;
  form.dataset.status = accountStatus;
  form.addEventListener('input', () => { state.modalDirty = true; });
}

function setUserManagementFormBusy(form, busy, label = 'Saving…') {
  if (!form) return;
  form.dataset.saving = busy ? 'true' : 'false';
  form.setAttribute('aria-busy', String(busy));
  form.querySelectorAll('input, select, textarea, button').forEach(control => {
    if (control.classList.contains('modal-submit')) return;
    control.disabled = busy;
  });
  const submit = form.querySelector('.modal-submit');
  if (submit) {
    if (!form.dataset.submitLabel) form.dataset.submitLabel = submit.textContent;
    submit.disabled = busy;
    submit.textContent = busy ? label : form.dataset.submitLabel;
    submit.classList.toggle('is-loading', busy);
    if (busy) submit.setAttribute('aria-busy', 'true');
    else submit.removeAttribute('aria-busy');
  }
}

async function refreshUserManagementLists() {
  if (state.role !== 'Administrator' || !state.user) throw new Error('Only Administrators can refresh User Management.');
  const requestId = ++userInviteRequestId;
  const userId = state.user.id;
  state.userManagementRefreshLoading = true;
  state.userManagementRefreshError = '';
  state.userInviteHistory.loading = false;
  try {
    const [users, invitations] = await Promise.all([
      window.supabaseRecord.load('users'),
      window.supabaseRecord.loadUserInvites()
    ]);
    if (requestId !== userInviteRequestId || state.user?.id !== userId || state.role !== 'Administrator') return false;
    persistCollection('users', users);
    state.userInviteHistory = { rows: invitations, loading: false, loaded: true, error: '' };
    state.userManagementRefreshError = '';
    state.userManagementRefreshSaved = false;
    return true;
  } catch (error) {
    state.userManagementRefreshError = error.message || 'The user lists could not be refreshed.';
    throw error;
  } finally {
    if (requestId === userInviteRequestId && state.user?.id === userId && state.role === 'Administrator') {
      state.userManagementRefreshLoading = false;
      render();
    }
  }
}

async function refreshUserManagementManually() {
  if (state.role !== 'Administrator') return toast('Only Administrators can refresh User Management.', 'error');
  if (state.userManagementRefreshLoading) return;
  state.userManagementRefreshSaved = false;
  state.userManagementRefreshLoading = true;
  render();
  try {
    const refreshed = await refreshUserManagementLists();
    if (refreshed) toast('User Management lists refreshed.');
  } catch (error) {
    console.error('User Management lists could not be refreshed.', error);
    toast('The list could not refresh. Try again.', 'error', [], true);
  } finally {
    state.userManagementRefreshLoading = false;
    if (state.view === 'users') render();
  }
}

async function retryUserManagementLists(button = null) {
  if (state.role !== 'Administrator') return toast('Only Administrators can refresh User Management.', 'error');
  if (state.userManagementRefreshLoading) return;
  if (button) {
    button.disabled = true;
    button.textContent = 'Retrying…';
  }
  state.userManagementRefreshLoading = true;
  try {
    const refreshed = await refreshUserManagementLists();
    if (refreshed) toast('User Management lists refreshed.');
  } catch (error) {
    console.error('User Management lists could not be refreshed.', error);
    state.userManagementRefreshError = error.message || 'The user lists could not be refreshed.';
    render();
    toast('The list could not refresh. Try again.', 'error', [], true);
  } finally {
    state.userManagementRefreshLoading = false;
    if (state.view === 'users') render();
  }
}

async function finishUserManagementSave(successMessage, focusAction, focusId, warningMessage = '') {
  toast(warningMessage || successMessage, warningMessage ? 'error' : 'success');
  try {
    const refreshed = await refreshUserManagementLists();
    if (focusAction) focusUserManagementAction(focusAction, focusId);
  } catch (error) {
    console.error('A User Management action was saved, but its lists could not be refreshed.', error);
    state.userManagementRefreshSaved = true;
    render();
    toast('Saved, but the list could not refresh.', 'error', [], true);
  }
}

async function submitUserInvitation(form) {
  if (state.role !== 'Administrator') return toast('Only Administrators can invite staff users.', 'error');
  if (form.dataset.saving === 'true') return;
  if (!form.reportValidity()) return;
  const fullName = form.elements.fullName.value.trim();
  const email = form.elements.email.value.trim().toLowerCase();
  const role = form.elements.role.value;
  const allowedRoles = window.costTrackInviteRoles || [];
  if (!fullName || fullName.length > 160) return toast('Enter a full name of no more than 160 characters.', 'error');
  if (!form.elements.email.validity.valid) return toast('Enter a valid email address.', 'error');
  if (!allowedRoles.includes(role)) return toast('Select a valid staff role.', 'error');
  const duplicate = findInviteDuplicate(email);
  if (duplicate?.type === 'account') {
    updateInviteDuplicateNotice(form);
    return toast(`An account already exists for ${email}. Change the user's role in Staff.`, 'error');
  }
  if (duplicate?.type === 'invitation') {
    updateInviteDuplicateNotice(form);
    return toast(`A ${duplicate.status.toLowerCase()} invitation already exists. Resend it instead.`, 'error');
  }

  setUserManagementFormBusy(form, true, 'Sending…');
  const verificationDraft = userInvitationVerificationDrafts.get(form) || null;
  let uploadedEvidence = null;
  try {
    let verificationRecord = null;
    if (verificationDraft) {
      uploadedEvidence = await window.supabaseRecord.uploadVerificationEvidence({
        idImage: verificationDraft.idImage,
        selfie: verificationDraft.selfie
      });
      verificationRecord = {
        applicant_name: fullName,
        id_type: verificationDraft.idType,
        id_number_masked: verificationDraft.idNumberMasked,
        ocr_summary: verificationDraft.ocrSummary,
        face_match_score: verificationDraft.faceMatchScore,
        face_match_result: verificationDraft.faceMatchResult,
        override_used: verificationDraft.overrideUsed,
        override_reason: verificationDraft.overrideReason,
        id_image_path: uploadedEvidence.id_image_path,
        selfie_path: uploadedEvidence.selfie_path
      };
    }
    await window.supabaseRecord.inviteUser({
      fullName,
      email,
      role,
      verificationRecord
    });
    state.modalDirty = false;
    userInvitationVerificationDrafts.delete(form);
    closeModal(true);
    await finishUserManagementSave(
      verificationDraft
        ? `Verification record saved and invitation sent to ${email}.`
        : `Invitation sent to ${email}.`,
      'user-invite-open'
    );
  } catch (error) {
    console.error('Staff invitation failed.', error);
    let errorMessage = error.message || 'The invitation could not be sent. Please try again.';
    if (uploadedEvidence) {
      try {
        await window.supabaseRecord.removeVerificationEvidence([
          uploadedEvidence.id_image_path,
          uploadedEvidence.selfie_path
        ]);
      } catch (cleanupError) {
        console.error('Verification evidence cleanup failed after invitation failure.', cleanupError);
        errorMessage += ' Uploaded evidence cleanup failed; an Administrator should review the private bucket.';
      }
    }
    if (error?.code === 'pending_invitation_exists') {
      state.userInviteHistory.loaded = false;
      try {
        await loadUserInvitations(true);
      } catch (loadError) {
        console.error('The duplicate invitation could not be loaded.', loadError);
      }
      updateInviteDuplicateNotice(form);
    }
    toast(errorMessage, 'error');
  } finally {
    if (form.isConnected) setUserManagementFormBusy(form, false);
  }
}

async function submitUserRoleChange(form) {
  if (state.role !== 'Administrator') return toast('Only Administrators can change staff roles.', 'error');
  if (form.dataset.saving === 'true') return;
  if (!form.reportValidity()) return;
  const userId = form.dataset.userId;
  const user = findUserManagementTarget(userId);
  if (!user) return toast('This staff account is no longer available. Refresh the list and try again.', 'error');
  const protectedReason = userManagementProtectionReason(user);
  if (protectedReason) return toast(protectedReason, 'error');
  const newRole = form.elements.role.value;
  const reason = form.elements.reason.value.trim();
  if (!USER_MANAGEMENT_ROLES.includes(newRole) || newRole === user.role) {
    return toast('Select a different valid staff role.', 'error');
  }
  if (!reason || reason.length > 500) return toast('Enter a role-change reason of no more than 500 characters.', 'error');
  const confirmed = await confirmInApp(
    `Change ${user.name || user.email} from ${user.role} to ${newRole}? Their access changes on their next load. Reason: ${reason}`,
    { title: 'Confirm role change', confirmLabel: 'Change role' }
  );
  if (!confirmed) return;
  setUserManagementFormBusy(form, true, 'Updating…');
  try {
    const changed = await window.supabaseRecord.updateUserRole(user.id, newRole, reason);
    if (!changed) throw new Error('The role was not changed. Refresh the staff list and try again.');
    state.modalDirty = false;
    closeModal(true);
    await finishUserManagementSave(`Role updated to ${newRole}.`, 'open-user-role', user.id);
  } catch (error) {
    console.error('Staff role could not be changed.', error);
    toast(error.message || 'The role could not be changed.', 'error');
  } finally {
    if (form.isConnected) setUserManagementFormBusy(form, false);
  }
}

async function submitUserAccountStatus(form) {
  if (state.role !== 'Administrator') return toast('Only Administrators can manage staff access.', 'error');
  if (form.dataset.saving === 'true') return;
  if (!form.reportValidity()) return;
  const userId = form.dataset.userId;
  const accountStatus = form.dataset.status;
  const user = findUserManagementTarget(userId);
  if (!user) return toast('This staff account is no longer available. Refresh the list and try again.', 'error');
  const protectedReason = userManagementProtectionReason(user);
  if (protectedReason) return toast(protectedReason, 'error');
  const reason = form.elements.reason.value.trim();
  if (!reason || reason.length > 500) return toast('Enter a reason of no more than 500 characters.', 'error');
  const deactivate = accountStatus === 'Deactivated';
  const effect = deactivate
    ? `${user.name || user.email} will immediately lose sign-in and CostTrack API access. Their operational history remains.`
    : `${user.name || user.email} will regain sign-in and CostTrack API access.`;
  const confirmed = await confirmInApp(`${effect}\n\nReason: ${reason}`, {
    title: deactivate ? 'Confirm deactivation' : 'Confirm reactivation',
    confirmLabel: deactivate ? 'Deactivate' : 'Reactivate'
  });
  if (!confirmed) return;
  setUserManagementFormBusy(form, true, deactivate ? 'Deactivating…' : 'Reactivating…');
  try {
    await window.supabaseRecord.setUserAccountStatus(user.id, accountStatus, reason);
    state.modalDirty = false;
    closeModal(true);
    await finishUserManagementSave(
      deactivate ? 'User deactivated.' : 'User reactivated.',
      'open-user-status',
      user.id
    );
  } catch (error) {
    console.error('Staff account status could not be changed.', error);
    toast(error.message || 'The account status could not be changed.', 'error');
  } finally {
    if (form.isConnected) setUserManagementFormBusy(form, false);
  }
}

async function runUserInvitationAction(invitationId, action) {
  if (state.role !== 'Administrator') return toast('Only Administrators can manage invitations.', 'error');
  if (state.userManagementBusyId) return;
  const invitation = state.userInviteHistory.rows.find(row => row.id === invitationId);
  if (!invitation) return toast('This invitation is no longer available. Refresh the list and try again.', 'error');
  const status = effectiveInvitationStatus(invitation);
  if (action === 'resend' && !['Pending', 'Expired'].includes(status)) {
    return toast('Only pending or expired invitations can be resent.', 'error');
  }
  if (action === 'cancel' && status !== 'Pending') {
    return toast('Only pending invitations can be cancelled.', 'error');
  }
  if (action === 'cancel') {
    const confirmed = await confirmInApp(
      `Cancel the invitation to ${invitation.email}? Its link will stop working and any unconfirmed account will be removed.`,
      { title: 'Cancel invitation', confirmLabel: 'Cancel invitation' }
    );
    if (!confirmed) return;
  }
  state.userManagementBusyId = invitationId;
  state.userManagementBusyAction = action;
  render();
  const inviteForm = document.querySelector('#modalForm[data-type="user-invite"]');
  if (inviteForm) updateInviteDuplicateNotice(inviteForm);
  try {
    if (action === 'resend') {
      await window.supabaseRecord.resendUserInvitation(invitationId);
      if (inviteForm) {
        state.modalDirty = false;
        closeModal(true);
      }
      await finishUserManagementSave('Invitation resent.');
    } else {
      const result = await window.supabaseRecord.cancelUserInvitation(invitationId);
      const cleanupWarning = result.account_removed === false
        ? result.account_blocked
          ? 'Invitation cancelled. The verified Auth account was blocked and retained for review.'
          : 'Invitation cancelled, but no linked account was removed. Verify Auth cleanup in Supabase.'
        : '';
      await finishUserManagementSave(
        'Invitation cancelled.',
        'cancel-user-invite',
        invitationId,
        cleanupWarning
      );
    }
  } catch (error) {
    console.error(`Invitation ${action} failed.`, error);
    toast(error.message || `The invitation could not be ${action === 'resend' ? 'resent' : 'cancelled'}.`, 'error');
  } finally {
    state.userManagementBusyId = '';
    state.userManagementBusyAction = '';
    if (state.view === 'users' && state.role === 'Administrator') {
      render();
      if (inviteForm?.isConnected) {
        updateInviteDuplicateNotice(inviteForm);
        inviteForm.querySelector('[data-action="resend-user-invite"]')?.focus();
      } else if (inviteForm) {
        focusUserManagementAction('user-invite-open');
      } else if (action === 'resend') {
        focusUserManagementAction('resend-user-invite', invitationId);
      } else {
        focusUserManagementAction('cancel-user-invite', invitationId);
      }
    }
  }
}

async function loadUserInvitations(force = false) {
  const history = state.userInviteHistory;
  if (state.role !== 'Administrator' || !state.user || history.loading || (history.loaded && !force)) return;
  const requestId = ++userInviteRequestId;
  const userId = state.user.id;
  history.loading = true;
  history.error = '';
  if (state.view === 'users') render();
  try {
    const rows = await window.supabaseRecord.loadUserInvites();
    if (requestId !== userInviteRequestId || state.user?.id !== userId || state.role !== 'Administrator') return;
    history.rows = rows;
    history.loaded = true;
    const inviteForm = document.querySelector('#modalForm[data-type="user-invite"]');
    if (inviteForm) updateInviteDuplicateNotice(inviteForm);
  } catch (error) {
    if (requestId !== userInviteRequestId || state.user?.id !== userId || state.role !== 'Administrator') return;
    history.error = error.message || 'Invitation history could not be loaded.';
    history.loaded = true;
    console.error('Invitation history could not be loaded.', error);
    toast(history.error, 'error');
    const inviteForm = document.querySelector('#modalForm[data-type="user-invite"]');
    if (inviteForm) updateInviteDuplicateNotice(inviteForm);
  } finally {
    if (requestId === userInviteRequestId && state.user?.id === userId && state.role === 'Administrator') {
      history.loading = false;
      if (state.view === 'users') render();
    }
  }
}

async function loadVerificationRecords(force = false, searchValue = state.verificationRecordHistory.search) {
  const history = state.verificationRecordHistory;
  if (state.role !== 'Administrator' || !state.user) {
    return toast('Only Administrators can view verification records.', 'error');
  }
  const search = String(searchValue || '').trim();
  if (!force && history.loaded && history.loadedSearch === search) return;

  const requestId = ++verificationRecordRequestId;
  const userId = state.user.id;
  const activeSearch = document.activeElement?.id === 'verificationRecordSearch';
  const selectionStart = activeSearch
    ? document.activeElement.selectionStart
    : null;
  const selectionEnd = activeSearch
    ? document.activeElement.selectionEnd
    : null;
  history.search = String(searchValue || '');
  history.loading = true;
  history.error = '';
  if (state.view === 'users') render();
  if (activeSearch) {
    const searchInput = document.querySelector('#verificationRecordSearch');
    searchInput?.focus({ preventScroll: true });
    if (selectionStart !== null && selectionEnd !== null) {
      searchInput?.setSelectionRange(selectionStart, selectionEnd);
    }
  }

  try {
    const records = await window.supabaseRecord.loadVerificationRecords(search);
    if (
      requestId !== verificationRecordRequestId
      || state.user?.id !== userId
      || state.role !== 'Administrator'
    ) return;
    history.rows = records;
    history.loaded = true;
    history.loadedSearch = search;
  } catch (error) {
    if (
      requestId !== verificationRecordRequestId
      || state.user?.id !== userId
      || state.role !== 'Administrator'
    ) return;
    history.error = error.message || 'Verification records could not be loaded.';
    history.loaded = true;
    console.error('Verification records could not be loaded.', error);
    toast(history.error, 'error');
  } finally {
    if (
      requestId === verificationRecordRequestId
      && state.user?.id === userId
      && state.role === 'Administrator'
    ) {
      history.loading = false;
      if (state.view === 'users') render();
      if (activeSearch) {
        const searchInput = document.querySelector('#verificationRecordSearch');
        searchInput?.focus({ preventScroll: true });
        if (selectionStart !== null && selectionEnd !== null) {
          searchInput?.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }
  }
}

async function retryVerificationRecordLoad() {
  if (state.role !== 'Administrator') {
    return toast('Only Administrators can view verification records.', 'error');
  }
  state.verificationRecordHistory.loaded = false;
  state.verificationRecordHistory.error = '';
  await loadVerificationRecords(true);
  if (!state.verificationRecordHistory.error) toast('Verification records refreshed.');
}

async function retryUserInvitationLoad() {
  if (state.role !== 'Administrator') return toast('Only Administrators can view invitation history.', 'error');
  state.userInviteHistory.loaded = false;
  state.userInviteHistory.error = '';
  await loadUserInvitations(true);
  if (!state.userInviteHistory.error) toast('Invitation history refreshed.');
}
function options(items, valueKey = 'id', labelKey = 'name') { return items.map(x => `<option value="${x[valueKey]}">${esc(x[labelKey])}</option>`).join(''); }
function updateWasteFormPreview(form) {
  if (form.elements.wasteType?.value !== 'ingredient') return;
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
function setWasteFormType(form) {
  const selectedType = form.elements.wasteType?.value || '';
  form.querySelectorAll('[data-waste-type-panel]').forEach(panel => {
    const active = panel.dataset.wasteTypePanel === selectedType;
    panel.hidden = !active;
    panel.querySelectorAll('input, select, textarea').forEach(control => { control.disabled = !active; });
  });
  const submit = form.querySelector('.modal-submit');
  if (submit) submit.disabled = !selectedType;
  updateWasteFormPreview(form);
}
async function refreshPreparedWasteBatches(form, serviceDate) {
  const select = form.elements.productionBatchId;
  if (!select) return;
  select.disabled = true;
  select.innerHTML = '<option value="">Loading ready batches…</option>';
  try {
    const batches = (await window.supabaseRecord.loadProductionBatches(serviceDate))
      .filter(batch => batch.status === 'Ready');
    if (!form.isConnected || form.elements.preparedDate.value !== serviceDate) return;
    select.innerHTML = `<option value="">Not linked</option>${batches.map(batch => `<option value="${esc(batch.id)}" data-dish-name="${esc(batch.recipeName)}">${esc(batch.recipeName)} · #${Number(batch.batchNumber)} · ${esc(batch.serviceDate)}</option>`).join('')}`;
    select.disabled = form.elements.wasteType.value !== 'prepared';
  } catch (error) {
    if (!form.isConnected || form.elements.preparedDate.value !== serviceDate) return;
    console.error('Ready production batches could not be refreshed for prepared-food waste.', error);
    select.innerHTML = '<option value="">Not linked</option>';
    select.disabled = form.elements.wasteType.value !== 'prepared';
    toast('Ready production batches could not be loaded for this date. You can still record prepared-food waste without linking a batch.', 'error');
  }
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
  if (type === 'pos-setting') {
    const setting = all('posSettings').find(item => item.id === editId);
    if (state.role !== 'Administrator' || !setting
      || !['pos_max_shift_hours', 'pos_extra_pax_rate'].includes(setting.key)) {
      return toast('Only an Administrator can change this POS setting.', 'error');
    }
    const value = Number(data.value);
    if (!Number.isFinite(value) || (setting.key === 'pos_max_shift_hours' && (!Number.isInteger(value) || value < 1 || value > 72))
      || (setting.key === 'pos_extra_pax_rate' && value < 0)) {
      return toast(setting.key === 'pos_max_shift_hours'
        ? 'Set the alert threshold to a whole number from 1 to 72 hours.'
        : 'Set a non-negative extra-pax rate.', 'error');
    }
    try {
      await save('posSettings', all('posSettings').map(item => item.id === setting.id ? { ...item, value: String(value) } : item));
      state.modalDirty = false;
      closeModal(true);
      toast('POS setting saved.');
    } catch (error) {
      console.error('POS setting could not be saved.', error);
      toast(friendlyRpcError(error), 'error');
    }
    return;
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
    const lifecycleControls = edit && state.role === 'Administrator'
      ? `<fieldset class="product-form-section product-lifecycle-controls">
          <legend>Product status</legend>
          <p>${item.isActive === false ? 'This product is inactive.' : 'This product is active.'}</p>
          <button type="button" class="${item.isActive === false ? 'primary-btn' : 'danger-btn'}" data-action="product-lifecycle-${item.isActive === false ? 'reactivate' : 'deactivate'}" data-id="${esc(item.id)}">${item.isActive === false ? 'Activate product' : 'Deactivate product'}</button>
        </fieldset>`
      : '';
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
        <label>Shelf life (days)<input name="shelfLifeDays" type="number" min="1" max="3650" step="1" value="${esc(value('shelfLifeDays') || '')}" placeholder="e.g. 30"><small class="field-help">When set, expiration is calculated automatically from the date received. Leave blank to enter it manually per invoice lot.</small></label>
      </fieldset>
      <fieldset class="product-form-section">
        <legend>Additional information</legend>
        <label class="product-notes-field">Product notes <span class="field-help">Optional — storage, handling, or ordering details.</span><textarea name="notes" rows="3" maxlength="1000" placeholder="Add helpful details for the inventory team">${esc(value('notes'))}</textarea></label>
      </fieldset>
      ${lifecycleControls}
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
  else if (type === 'recipe') return openRecipeForm(item);
  else if (type === 'waste') {
    let serverTimestamp;
    let recordedAtLabel;
    try {
      serverTimestamp = await window.supabaseRecord.wasteServerTime();
      recordedAtLabel = window.CostTrackLogic.formatManilaTimestamp(serverTimestamp);
    } catch (error) {
      console.error('The current server time could not be loaded for the waste form.', error);
      return toast(friendlyRpcError(error), 'error');
    }
    const recentProductionDate = new Date();
    recentProductionDate.setDate(recentProductionDate.getDate() - 3);
    const recentProduction = all('productionLogs').filter(log => log.date >= localDateStr(recentProductionDate));
    const ingredientOptions = all('ingredients').filter(item => item.isActive !== false).slice().sort((a, b) => a.name.localeCompare(b.name)).map(item => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.unit)}</option>`).join('');
    const dishSuggestions = [...new Set(all('recipes').map(recipeItem => recipeItem.name).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .map(name => `<option value="${esc(name)}"></option>`).join('');
    modal('Log kitchen waste', `<label class="full">Recorded at<input name="recordedAtDisplay" value="${esc(recordedAtLabel)}" readonly aria-readonly="true"></label>
      <fieldset class="waste-type-selector" role="radiogroup" aria-required="true">
        <legend>Waste type <span class="field-help">Choose a category before entering a record.</span></legend>
        <div class="waste-type-options">
          <label><input type="radio" name="wasteType" value="ingredient" required><span><strong>Ingredient waste</strong><small>Deducts raw inventory stock.</small></span></label>
          <label><input type="radio" name="wasteType" value="prepared" required><span><strong>Prepared food / leftovers</strong><small>Records portions only; ingredients are unchanged.</small></span></label>
        </div>
      </fieldset>
      <section data-waste-type-panel="ingredient" hidden>
        <p class="waste-form-intro">Record discarded ingredients. The stock deduction is applied once when this entry is saved.</p>
        <label>Ingredient<select name="ingredientId" required disabled><option value="">Choose an ingredient</option>${ingredientOptions}</select><small class="field-help" data-waste-stock>Select an ingredient to see available stock.</small></label>
        <label>Related dish / production batch <span class="field-help">Optional — helps identify where the waste came from.</span><select name="productionLogId" disabled><option value="">Not linked</option>${recentProduction.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(log => `<option value="${esc(log.id)}">${esc(recipe(log.recipeId)?.name || 'Unknown dish')} · ${log.quantity} batch${Number(log.quantity) === 1 ? '' : 'es'} · ${esc(log.date)}</option>`).join('')}</select></label>
        <label>Quantity discarded<input name="quantity" type="number" min=".0001" max="1000000" step=".0001" placeholder="e.g. 0.5" required disabled><small class="field-help">Enter the amount using the ingredient’s stock unit.</small></label>
        <fieldset class="waste-reason-group" data-waste-reason-group role="radiogroup" aria-required="true">
          <legend>Reason</legend>
          <div class="waste-reason-options">${wasteReasons.map((reason, index) => `<label class="waste-reason-chip"><input type="radio" name="reason" value="${esc(reason)}" ${index === 0 ? 'required' : ''} disabled><span>${esc(reason)}</span></label>`).join('')}</div>
          <small class="field-help" data-waste-reason-error role="alert" hidden>Choose one reason.</small>
        </fieldset>
        <small class="field-help waste-impact" data-waste-impact aria-live="polite"></small>
        <label>Notes <span class="field-help">Optional — required when you choose Other. Add a short detail such as storage issue or reason for over-preparation.</span><textarea name="notes" rows="2" maxlength="500" placeholder="Optional detail" disabled></textarea></label>
        <p class="waste-disposition-note">Safe leftovers that are stored or reused are not waste entries. Log them here only if they are later discarded.</p>
      </section>
      <section data-waste-type-panel="prepared" hidden>
        <p class="waste-form-intro">Use this for cooked dishes, buffet leftovers, unsold prepared food, or excess production. No ingredient stock is returned or changed.</p>
        <label>Dish name <span class="field-help">Selecting a production batch fills and locks its recipe name.</span><input name="dishName" type="text" list="preparedWasteDishSuggestions" maxlength="200" placeholder="e.g. Sisig" required disabled><datalist id="preparedWasteDishSuggestions">${dishSuggestions}</datalist></label>
        <label>Production batch <span class="field-help">Optional — ready batches for the selected waste date.</span><select name="productionBatchId" disabled><option value="">Not linked</option></select></label>
        <label>Portions wasted<input name="preparedQuantity" type="number" min=".0001" max="1000000" step=".0001" placeholder="e.g. 3" required disabled></label>
        <fieldset class="waste-reason-group prepared-waste-reason-group" data-prepared-waste-reason-group role="radiogroup" aria-required="true">
          <legend>Waste reason</legend>
          <div class="waste-reason-options">${preparedFoodWasteReasons.map((reason, index) => `<label class="waste-reason-chip"><input type="radio" name="preparedReason" value="${esc(reason)}" ${index === 0 ? 'required' : ''} disabled><span>${esc(reason)}</span></label>`).join('')}</div>
          <small class="field-help" data-prepared-waste-reason-error role="alert" hidden>Choose one reason.</small>
        </fieldset>
        <label>Waste date<input name="preparedDate" type="date" value="${manilaBusinessToday()}" max="${manilaBusinessToday()}" required disabled></label>
        <label>Notes <span class="field-help">Optional — required when you choose Other.</span><textarea name="preparedNotes" rows="2" maxlength="500" placeholder="Optional detail" disabled></textarea></label>
      </section>`, 'Record waste', 'waste-modal');
    const form = document.querySelector('#modalForm');
    form.dataset.type = type;
    form.dataset.serverTimestamp = serverTimestamp;
    const submit = form.querySelector('.modal-submit');
    if (submit) submit.disabled = true;
    form.querySelector('[name="wasteType"]').focus();
    refreshPreparedWasteBatches(form, manilaBusinessToday());
    return;
  }
  else if (type === 'production') modal('Log production batch', `<div class="form-grid"><label>Recipe<select name="recipeId" required>${options(all('recipes'))}</select></label><label>Batches<input name="quantity" type="number" min="1" step="1" required></label><label>Covers produced <small class="field-help">Optional</small><input name="coversProduced" type="number" min="0" step="1"></label><label>Mode<select name="mode"><option>Batch production</option><option>End-of-day sales summary</option></select></label><label>Date<input name="date" type="date" value="${today()}" required></label></div>`);
  else if (type === 'count') modal('Record physical count', `<div class="physical-count-form">
    <p class="physical-count-guidance">Expected quantity is loaded from current system stock and locked. Saving this count immediately adjusts stock to the recorded actual quantity.</p>
    <div class="form-grid">
      <label>Ingredient<select name="ingredientId" required><option value="" selected disabled>Choose an ingredient</option>${options(all('ingredients').filter(item => item.isActive !== false))}</select></label>
      <label>Expected quantity<input name="expected" type="number" min="0" step=".0001" placeholder="Select an ingredient" readonly required></label>
      <label>Actual count<input name="actual" type="number" min="0" step=".0001" required></label>
      <label>Count date<input name="date" type="date" value="${today()}" required></label>
    </div>
    <output class="physical-count-preview" data-count-variance data-state="empty" aria-live="polite">Select an ingredient and enter the actual quantity to preview variance.</output>
  </div>`, 'Save record', 'physical-count-modal');
  else if (type === 'user') {
    if (!item) return toast('Select a user to view their details.', 'error');
    modal('User Details', `<section class="user-details-section">
      <h3 class="panel-title">Staff information</h3>
      <div class="form-grid"><label>Full name<input type="text" value="${esc(item.name || '')}" readonly></label><label>Email<input type="email" value="${esc(item.email || '')}" readonly></label><label>Role<input type="text" value="${esc(item.role || 'Unassigned')}" readonly></label><label>Account status<input type="text" value="${esc(item.accountStatus || 'Unavailable')}" readonly></label><label>Last updated<input type="text" value="${esc(formatUserManagementDate(item.updatedAt))}" readonly></label></div>
    </section>`, '', 'user-details-modal', 'read-only');
    return;
  }
  document.querySelector('#modalForm').dataset.type = type; if (item) document.querySelector('#modalForm').dataset.id = item.id;
}
function emptyReceivingLine() {
  return { id: `RCV-${crypto.randomUUID()}`, ingredientId: '', quantity: '', unitCost: '', batchCode: '', expirationDate: '' };
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
  const products = all('ingredients').filter(item => item.isActive !== false);
  const product = products.find(item => item.id === line.ingredientId);
  const expiryRequired = Boolean(product?.trackExpiry);
  const batchCode = line.batchCode || `LOT-${manilaBusinessToday().replaceAll('-', '')}-${String(index + 1).padStart(2, '0')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const receivedDate = state.receivingForm?.receivedDate || manilaBusinessToday();
  const shelfLifeDays = Number(product?.shelfLifeDays || 0);
  const calculatedExpiration = expiryRequired && shelfLifeDays > 0
    ? (() => { const date = new Date(`${receivedDate}T12:00:00`); date.setDate(date.getDate() + shelfLifeDays); return localDateStr(date); })()
    : line.expirationDate;
  return `<fieldset class="receipt-line" data-line-index="${index}" data-id="${esc(line.id)}"><legend>Product ${index + 1}</legend>${state.receivingDraft.length > 1 ? `<button type="button" class="receipt-remove-line" data-action="remove-receiving-line" data-index="${index}" aria-label="Remove product ${index + 1}">Remove</button>` : ''}<div class="receipt-line-grid"><label>Product<select name="ingredient_${index}" data-field="ingredientId" required><option value="">Choose a product</option>${products.map(item => `<option value="${esc(item.id)}" ${line.ingredientId === item.id ? 'selected' : ''}>${esc(item.name)} · ${esc(item.unit)}</option>`).join('')}</select></label><label>Quantity received<input name="quantity_${index}" data-field="quantity" type="number" min=".0001" step=".0001" value="${esc(line.quantity)}" placeholder="0.00" required></label><label>Unit cost<input name="unitCost_${index}" data-field="unitCost" type="number" min="0" step=".01" value="${esc(line.unitCost)}" placeholder="₱ 0.00" required><span class="field-help">Per stocking unit</span></label><label>Lot / batch number<input name="batchCode_${index}" data-field="batchCode" value="${esc(batchCode)}" readonly><span class="field-help">Generated automatically</span></label><label>Expiration date<input name="expirationDate_${index}" data-field="expirationDate" type="date" value="${esc(calculatedExpiration)}" min="${esc(receivedDate)}" ${expiryRequired && shelfLifeDays > 0 ? 'readonly' : ''} ${expiryRequired ? 'required' : ''}><span class="field-help" data-expiration-help>${expiryRequired ? (shelfLifeDays > 0 ? `Set automatically from the ${shelfLifeDays}-day shelf life` : 'Enter a valid expiration date') : 'Optional — add when available'}</span></label></div><div class="receipt-line-total">Line total <strong data-receipt-line-total>${money(Number(line.quantity || 0) * Number(line.unitCost || 0))}</strong></div></fieldset>`;
}
function updateReceivingExpiryRequirements(form) {
  form.querySelectorAll('.receipt-line').forEach(line => {
    const productId = line.querySelector('[data-field="ingredientId"]').value;
    const product = all('ingredients').find(item => item.id === productId);
    const expiration = line.querySelector('[data-field="expirationDate"]');
    const help = line.querySelector('[data-expiration-help]');
    const required = Boolean(product?.trackExpiry);
    const shelfLifeDays = Number(product?.shelfLifeDays || 0);
    const receivedDate = form.elements.receivedDate.value;
    expiration.min = receivedDate || today();
    if (required && shelfLifeDays > 0 && receivedDate) {
      const date = new Date(`${receivedDate}T12:00:00`);
      date.setDate(date.getDate() + shelfLifeDays);
      expiration.value = localDateStr(date);
      expiration.readOnly = true;
    } else {
      expiration.readOnly = shelfLifeDays > 0 && required;
    }
    expiration.required = required;
    expiration.closest('label').classList.toggle('required-field', required);
    help.textContent = required
      ? shelfLifeDays > 0
        ? `Set automatically from the ${shelfLifeDays}-day shelf life`
        : 'Enter a valid expiration date'
      : 'Optional — add when available';
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
  const noProducts = !all('ingredients').some(item => item.isActive !== false);
  const supplierOptions = [...new Set([
    ...(state.supplierOptions || []),
    ...all('ingredients').map(product => product.preferredSupplier).filter(Boolean)
  ])].sort((a, b) => a.localeCompare(b)).map(supplier => `<option value="${esc(supplier)}"></option>`).join('');
  modal('Record delivery invoice', `<div class="receipt-form"><p class="receipt-intro">Enter the supplier invoice and each product lot received. The receipt number and delivery dates are generated and locked to the Manila business date.</p><fieldset class="receipt-section"><legend>Invoice and delivery</legend><div class="form-grid receipt-header-grid"><label>Supplier name<input name="supplierName" list="receiptSupplierSuggestions" maxlength="200" value="${esc(header.supplierName || '')}" placeholder="Choose or type a supplier" required><datalist id="receiptSupplierSuggestions">${supplierOptions}</datalist></label><label>Invoice / receipt number<input name="invoiceNumber" maxlength="100" value="${esc(header.invoiceNumber || '')}" readonly required></label><label>Invoice date<input name="invoiceDate" type="date" value="${esc(header.invoiceDate || manilaBusinessToday())}" max="${esc(manilaBusinessToday())}" readonly required></label><label>Date received<input name="receivedDate" type="date" value="${esc(header.receivedDate || manilaBusinessToday())}" max="${esc(manilaBusinessToday())}" readonly required></label></div></fieldset><fieldset class="receipt-section"><legend>Products received</legend><div class="receipt-items-heading"><div><strong>Invoice items</strong><small>Add a separate line for each product or lot.</small></div>${noProducts ? '' : '<button type="button" class="ghost-btn compact-btn" data-action="add-receiving-line">+ Add product</button>'}</div>${noProducts ? '<p class="receipt-empty-hint">No products are available. Ask an Administrator to add products before recording a delivery.</p>' : `<div class="receipt-lines">${lines.map(receivingLineMarkup).join('')}</div>`}<div class="receipt-total"><span>Items subtotal <small>Quantity × unit cost, before tax or other charges</small></span><strong data-receipt-total>₱0.00</strong></div></fieldset><label class="receipt-note">Delivery note <span class="field-help">Optional — e.g. delivery condition or reference</span><textarea name="note" rows="2" maxlength="500" placeholder="Add a note about this delivery">${esc(header.note || '')}</textarea></label></div>`, 'Record delivery');
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
  const date = manilaBusinessToday();
  const invoiceNumber = `INV-${date.replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  state.receivingForm = { supplierName: '', invoiceNumber, invoiceDate: date, receivedDate: date, note: '' };
  state.receivingDraft = [emptyReceivingLine()];
  renderReceivingModal();
}
function captureRecipeFormState(form) {
  const data = Object.fromEntries(new FormData(form));
  state.recipeForm = {
    ...state.recipeForm,
    ...data,
    id: form.dataset.id || state.recipeForm?.id,
    batchYield: Number(data.batchYield || 30),
    prepTarget: Number(data.prepTarget || 30),
    wastage: Number(data.wastage || 0),
    prepNotes: data.prepNotes || '',
    isActive: form.elements.isActive.checked
  };
}
function recipeAdultBuffetRate() {
  const rate = activeBuffetRate({ mealPeriod: 'All Day', date: today() }, today());
  const adultRate = Number(rate?.adultRate);
  return Number.isFinite(adultRate) && adultRate > 0 ? adultRate : null;
}
function recipePreviewLines(form) {
  const lines = state.recipeDraft.map(item => ({ ...item }));
  const ingredientId = form?.elements?.draftIngredient?.value;
  const quantity = Number(form?.elements?.draftQuantity?.value);
  if (ingredientId && quantity > 0 && !lines.some(item => item.ingredientId === ingredientId)) {
    lines.push({ ingredientId, quantity });
  }
  return lines;
}
function recipeCostPanelMarkup(form) {
  const wastageValue = form?.elements?.wastage?.value ?? state.recipeForm?.wastage ?? 2;
  const batchYieldValue = form?.elements?.batchYield?.value ?? state.recipeForm?.batchYield ?? 30;
  const recipePreview = {
    wastage: Number(wastageValue),
    batchYield: Number(batchYieldValue),
    ingredients: recipePreviewLines(form)
  };
  const adultRate = recipeAdultBuffetRate();
  try {
    const breakdown = window.CostTrackLogic.recipeCostBreakdown(recipePreview, all('ingredients'));
    const availability = window.CostTrackLogic.recipeStockAvailability(recipePreview, all('ingredients'));
    const warnings = window.CostTrackLogic.recipeSanityWarnings(recipePreview, all('ingredients'), adultRate);
    const foodCostPercent = window.CostTrackLogic.recipeFoodCostPercent(breakdown.costPerPortion, adultRate);
    const ingredientRows = breakdown.ingredients.map(line => `<div class="recipe-cost-ingredient">
      <div><strong>${esc(line.name)}</strong><small>${line.quantity} ${esc(line.unit)} × ${money(line.unitCost)} per ${esc(line.unit)}</small></div>
      <strong>${money(line.lineCost)} <small>${line.costPercent.toFixed(1)}%</small></strong>
    </div>`).join('');
    const stockHint = availability
      ? `<p class="recipe-stock-hint">Current stock is enough for <strong>${availability.batches}</strong> base recipe batch${availability.batches === 1 ? '' : 'es'}.</p>`
      : '<p class="recipe-stock-hint">Add a valid ingredient quantity to estimate available batches.</p>';
    const estimate = adultRate && foodCostPercent != null
      ? `<p class="recipe-food-cost-estimate">One recipe portion is ${money(breakdown.costPerPortion)} of the current adult buffet rate ${money(adultRate)} (${foodCostPercent.toFixed(1)}%). This is a recipe-level comparison, not a full customer food-cost estimate.</p>`
      : '<p class="recipe-food-cost-estimate">No active adult buffet rate is configured for today.</p>';
    const warningMarkup = warnings.length
      ? `<ul class="recipe-sanity-warnings" role="status">${warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul>`
      : '<p class="recipe-cost-validity" role="status">No unusual quantities or costs detected.</p>';
    return `<section class="recipe-live-cost-panel" data-recipe-cost-panel aria-live="polite">
      <div class="recipe-cost-panel-heading"><div><strong>Live recipe cost</strong><small>Uses current ingredient unit costs and the wastage allowance.</small></div></div>
      <div class="recipe-cost-highlights"><div><small>Cost per portion</small><strong>${money(breakdown.costPerPortion)}</strong></div><div><small>Total batch cost</small><strong>${money(breakdown.totalBatchCost)}</strong></div></div>
      ${ingredientRows ? `<div class="recipe-cost-ingredients">${ingredientRows}</div>` : '<p class="recipe-cost-validity">Add ingredients to calculate the recipe cost.</p>'}
      ${stockHint}${estimate}${warningMarkup}
    </section>`;
  } catch (error) {
    return `<section class="recipe-live-cost-panel" data-recipe-cost-panel aria-live="polite"><div class="recipe-cost-panel-heading"><strong>Live recipe cost</strong></div><p class="recipe-preview-error" role="alert">${esc(error.message || 'Enter valid recipe quantities to calculate cost.')}</p></section>`;
  }
}
function updateRecipeCostPanel(form) {
  const panel = form.querySelector('[data-recipe-cost-panel]');
  if (panel) panel.outerHTML = recipeCostPanelMarkup(form);
}
function updateRecipeDraftUnit(form) {
  const select = form.elements.draftIngredient;
  const unit = ingredient(select?.value)?.unit || 'unit';
  const label = form.querySelector('[data-recipe-draft-unit]');
  if (label) label.textContent = `Quantity required (${unit})`;
}
function renderRecipeModal() {
  const form = state.recipeForm || {};
  const categories = [...new Set([
    'Main Course', 'Appetizer', 'Dessert', 'Beverage', 'Side Dish', 'Sauce',
    ...all('recipes').map(item => item.category).filter(Boolean)
  ])].sort((a, b) => a.localeCompare(b));
  const names = state.recipeDraft.map(item => `${ingredient(item.ingredientId)?.name || 'Ingredient'} | ${item.quantity} ${ingredient(item.ingredientId)?.unit || ''}`);
  const ingredientOptions = all('ingredients').filter(item => item.isActive !== false).map(item => `<option value="${esc(item.id)}" ${form.draftIngredient === item.id ? 'selected' : ''}>${esc(item.name)} · ${esc(item.unit)}</option>`).join('');
  const selectedIngredients = state.recipeDraft.length
    ? state.recipeDraft.map((item, index) => {
      const product = ingredient(item.ingredientId);
      const unit = product?.unit || 'unit';
      return `<div class="selected-ingredient">
        <strong>${esc(product?.name || 'Unknown ingredient')}</strong>
        <label>Quantity (${esc(unit)})<input data-recipe-quantity="${index}" name="recipeQuantity_${index}" type="number" min=".001" step=".001" value="${Number(item.quantity)}" required></label>
        <button type="button" class="recipe-remove-ingredient" data-action="remove-recipe-ingredient" data-index="${index}" aria-label="Remove ${esc(product?.name || 'ingredient')}">Remove</button>
      </div>`;
    }).join('')
    : '<div class="empty-ingredient">No ingredients added yet.</div>';
  modal(form.id ? 'Edit recipe' : 'Create recipe', `<div class="form-grid">
    <label>Recipe name<input name="name" value="${esc(form.name || '')}" maxlength="160" required></label>
    <label>Category<input name="category" list="recipeCategoryOptions" value="${esc(form.category || '')}" maxlength="80" placeholder="Choose or type a category" required><datalist id="recipeCategoryOptions">${categories.map(category => `<option value="${esc(category)}"></option>`).join('')}</datalist><small class="field-help">Choose an existing category or type a new one.</small></label>
    <label>Portions per base recipe <small class="field-help">Yield from one full base recipe; production portions scale from this size.</small><input name="batchYield" type="number" min="1" step="1" value="${Number(form.batchYield || 30)}" required></label>
    <label>Daily production target <small class="field-help">Portions to prepare for one service day; separate from the base recipe yield.</small><input name="prepTarget" type="number" min="1" step="1" value="${Number(form.prepTarget || 30)}" required></label>
    <label>Wastage percentage<input name="wastage" type="number" min="0" max="100" step=".1" value="${form.wastage ?? 2}" required></label>
    <label class="recipe-active-switch"><span><strong>Active on production board</strong><small>Inactive recipes stay in production history.</small></span><input name="isActive" type="checkbox" ${form.isActive !== false ? 'checked' : ''}></label>
    <div class="full">${recipeCostPanelMarkup(document.createElement('form'))}</div>
    <label class="full">Preparation notes <small class="field-help">Short cooking or presentation instructions shown on the Chef’s production board.</small><textarea name="prepNotes" maxlength="1000" rows="3" placeholder="e.g. Cook in shallow batches; keep sauce separate until service.">${esc(form.prepNotes || '')}</textarea></label>
    <div class="full recipe-ingredients-field"><div class="field-label">Recipe ingredients <small class="field-hint">Set the quantity used in one base recipe. The unit comes from the ingredient’s stock unit.</small></div>
      <div class="selected-ingredients">${selectedIngredients}</div>
      <button type="button" class="ghost-btn add-ingredient-btn" data-action="toggle-recipe-picker">+ Add Ingredient</button>
      <div class="recipe-picker is-hidden"><label>Inventory ingredient<select name="draftIngredient"><option value="">Choose an ingredient</option>${ingredientOptions}</select></label><label><span data-recipe-draft-unit>Quantity required (unit)</span><input name="draftQuantity" type="number" min=".001" step=".001" placeholder="e.g. 0.25"></label><button type="button" class="primary-btn compact-btn" data-action="add-recipe-ingredient">Add to recipe</button></div>
      <input type="hidden" name="composition" value="${esc(names.join('\\n'))}">
    </div>
  </div>`, 'Save recipe');
  const recipeForm = document.querySelector('#modalForm');
  recipeForm.dataset.type = 'recipe';
  if (form.id) recipeForm.dataset.id = form.id;
  updateRecipeDraftUnit(recipeForm);
  updateRecipeCostPanel(recipeForm);
}
function openRecipeForm(item) {
  if (!window.CostTrackLogic.canPerformInventoryAction(state.role, 'recipe.manage')) {
    return toast('You do not have permission to manage recipes.', 'error');
  }
  state.recipeDraft = item ? item.ingredients.map(line => ({ ...line })) : [];
  state.recipeForm = item ? { ...item } : {};
  renderRecipeModal();
}
function productUsageLabels(usage = {}) {
  const labels = {
    recipe_ingredients: 'Recipe ingredients',
    dish_recipe_ingredients: 'Buffet recipe ingredients',
    inventory_transactions: 'Inventory transactions',
    inventory_batches: 'Receiving batches',
    stock_movements: 'Stock movements',
    waste_logs: 'Waste history',
    physical_counts: 'Physical counts',
    production_consumption: 'Production consumption',
    inventory_migration_issues: 'Inventory migration diagnostics'
  };
  return Object.entries(usage)
    .filter(([, count]) => Number(count) > 0)
    .map(([key, count]) => `<li><strong>${Number(count)}</strong> ${esc(labels[key] || key)}</li>`)
    .join('');
}
function productLifecycleDialogMarkup(product, details) {
  const usages = productUsageLabels(details.usage);
  const activeRecipes = Array.isArray(details.active_recipes) ? details.active_recipes : [];
  let actionMarkup = '';
  if (!details.is_active) {
    actionMarkup = '<button type="button" class="primary-btn" data-action="product-lifecycle-reactivate">Reactivate product</button><button type="button" class="danger-btn" data-action="product-lifecycle-delete">Delete permanently</button>';
  } else {
    actionMarkup = '<button type="button" class="primary-btn" data-action="product-lifecycle-deactivate">Deactivate product</button>';
  }
  const recipeList = activeRecipes.length
    ? `<div class="product-lifecycle-recipes"><strong>Active recipes that use this product</strong><ul>${activeRecipes.map(recipe => `<li>${esc(recipe.name)} <small>(${esc(recipe.source)})</small></li>`).join('')}</ul></div>`
    : '';
  const activeRecipeNotice = details.is_active && activeRecipes.length
    ? '<p class="product-lifecycle-blocker" role="status">This product is used by active recipes. Deactivating it will not deactivate those recipes.</p>'
    : '';
  return `<p class="product-lifecycle-summary"><strong>${esc(product.name)}</strong> is currently ${details.is_active ? 'active' : 'inactive'}.</p>
    ${usages ? `<div class="product-lifecycle-usage"><strong>Recorded uses</strong><ul>${usages}</ul><small>These records remain unless the product is permanently deleted.</small></div>` : '<p class="product-lifecycle-usage">No recorded uses were found.</p>'}
    ${recipeList}${activeRecipeNotice}<div class="product-lifecycle-actions">${actionMarkup}</div>`;
}
function showProductLifecycleDetails(product, details) {
  modal(`Manage ${esc(product.name)}`, productLifecycleDialogMarkup(product, details), null, 'product-lifecycle-modal', 'form');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'product-lifecycle-actions';
  form.dataset.id = product.id;
}
async function manageProductLifecycle(productId) {
  if (state.role !== 'Administrator') return toast('Only Administrators can manage product lifecycle.', 'error');
  const product = ingredient(productId);
  if (!product) return toast('This product is no longer available. Reload the page and try again.', 'error');
  const backdrop = modal(`Manage ${esc(product.name)}`,
    '<p class="product-lifecycle-loading" role="status">Checking product usage...</p>',
    null, 'product-lifecycle-modal', 'read-only');
  try {
    const details = await window.supabaseRecord.productLifecycle('inspect', productId);
    if (!backdrop.isConnected) return;
    showProductLifecycleDetails(product, details);
  } catch (error) {
    console.error('Product lifecycle details could not be loaded.', error);
    if (backdrop.isConnected) {
      modal(`Manage ${esc(product.name)}`,
        `<p class="error-state" role="alert">Product usage could not be checked. ${esc(error.message || 'Try again.')}</p>`,
        null, 'product-lifecycle-modal', 'read-only');
    }
    toast(error.message || 'Product lifecycle details could not be loaded.', 'error');
  }
}
async function beginProductDeactivation(product) {
  if (state.role !== 'Administrator') return toast('Only Administrators can deactivate products.', 'error');
  try {
    const details = await window.supabaseRecord.productLifecycle('inspect', product.id);
    if (!details.is_active) return toast('This product is already inactive.', 'error');
    openProductDeactivationForm(product, details.active_recipes);
  } catch (error) {
    console.error('Product could not be checked before deactivation.', error);
    toast(error.message || 'Product usage could not be checked.', 'error');
  }
}
async function deleteInactiveProduct(productId) {
  if (state.role !== 'Administrator') return toast('Only Administrators can delete products.', 'error');
  const product = ingredient(productId);
  if (!product) return toast('This product is no longer available. Reload the page and try again.', 'error');
  try {
    const details = await window.supabaseRecord.productLifecycle('inspect', productId);
    if (details.is_active) return toast('Deactivate this product before deleting it.', 'error');
    await confirmProductLifecycleAction('delete', productId);
  } catch (error) {
    console.error('Inactive product could not be checked for deletion.', error);
    toast(error.message || 'Product usage could not be checked.', 'error');
  }
}
function openProductDeactivationForm(product, activeRecipes = []) {
  if (state.role !== 'Administrator') return toast('Only Administrators can deactivate products.', 'error');
  const recipeNotice = activeRecipes.length
    ? `<div class="product-lifecycle-recipes"><strong>Active recipes that use this product</strong><ul>${activeRecipes.map(recipe => `<li>${esc(recipe.name)} <small>(${esc(recipe.source)})</small></li>`).join('')}</ul><small>These recipes will remain active.</small></div>`
    : '';
  modal(`Deactivate ${esc(product.name)}`, `<p class="confirmation-message">Historical records remain available, but this product will no longer be offered for new receiving, recipes, waste, or counts.</p>
    ${recipeNotice}
    <p class="product-lifecycle-blocker" role="alert" data-product-lifecycle-error hidden></p>
    <label class="full">Reason for deactivation<textarea name="reason" rows="3" maxlength="500" required placeholder="Explain why this product is being deactivated"></textarea></label>`, 'Deactivate product', 'product-lifecycle-modal');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'product-lifecycle';
  form.dataset.id = product.id;
  form.dataset.lifecycleAction = 'deactivate';
}
async function runProductLifecycle(action, product, reason = '', processingBackdrop = null) {
  try {
    const result = await window.supabaseRecord.productLifecycle(action, product.id, reason);
    if (action === 'delete') {
      collectionState.ingredients = all('ingredients').filter(item => item.id !== product.id);
    } else {
      upsertLocalRecord('ingredients', {
        ...product,
        isActive: action === 'reactivate',
        updatedAt: result.updated_at || product.updatedAt
      });
    }
    rememberLocalChange('ingredients', product.id);
    state.modalDirty = false;
    closeModal(true);
    if (action === 'reactivate') toast(`${product.name} reactivated.`);
    render();
    void refetchCollection('ingredients')
      .then(() => render())
      .catch(error => showSaveRefreshWarning(['ingredients'], error));
  } catch (error) {
    console.error(`Product ${action} failed.`, error);
    if (processingBackdrop?.isConnected) closeModal(true);
    const outcome = { delete: 'deleted', deactivate: 'deactivated', reactivate: 'reactivated' }[action];
    const message = error.message || `The product could not be ${outcome}.`;
    const inlineError = action === 'deactivate'
      ? document.querySelector('#modalForm[data-type="product-lifecycle"] [data-product-lifecycle-error]')
      : null;
    if (inlineError) {
      inlineError.textContent = message;
      inlineError.hidden = false;
    }
    toast(message, 'error');
  }
}
async function submitProductLifecycle(form, data) {
  const reason = String(data.reason || '').trim();
  if (!reason) return toast('Enter a reason to deactivate this product.', 'error');
  const product = ingredient(form.dataset.id);
  if (!product) return toast('This product is no longer available. Reload and try again.', 'error');
  const submit = form.querySelector('.modal-submit');
  form.dataset.saving = 'true';
  if (submit) {
    submit.disabled = true;
    submit.classList.add('is-loading');
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = 'Saving...';
  }
  try {
    await runProductLifecycle('deactivate', product, reason);
  } finally {
    delete form.dataset.saving;
    if (submit?.isConnected) {
      submit.disabled = false;
      submit.classList.remove('is-loading');
      submit.removeAttribute('aria-busy');
      submit.textContent = 'Deactivate product';
    }
  }
}
async function confirmProductLifecycleAction(action, productId) {
  if (state.role !== 'Administrator') return toast('Only Administrators can manage product lifecycle.', 'error');
  const product = ingredient(productId);
  if (!product) return toast('This product is no longer available. Reload the page and try again.', 'error');
  if (action === 'delete' && product.isActive !== false) {
    return toast('Deactivate this product before deleting it.', 'error');
  }
  closeModal(true);
  const deleting = action === 'delete';
  const confirmed = await confirmInApp(
    deleting
      ? `${product.name} and its linked recipe ingredients, inventory, receiving, waste, count, and production-consumption records will be permanently deleted. The recipes themselves will remain. This cannot be undone.`
      : `Reactivate ${product.name}? It will be available for new inventory operations.`,
    {
      title: deleting ? 'Delete product?' : 'Reactivate product?',
      confirmLabel: deleting ? 'Delete permanently' : 'Reactivate',
      modalClass: 'confirmation-modal product-lifecycle-confirmation'
    }
  );
  if (!confirmed) return;
  const actionLabel = deleting ? 'Deleting' : 'Reactivating';
  const processingBackdrop = modal(
    `${actionLabel} ${esc(product.name)}`,
    `<p role="status" data-product-lifecycle-status>${actionLabel} product…</p>`,
    null,
    'product-lifecycle-modal product-lifecycle-processing',
    'processing'
  );
  processingBackdrop.querySelectorAll('[data-action="close-modal"]').forEach(button => button.remove());
  const status = processingBackdrop.querySelector('[data-product-lifecycle-status]');
  const slowTimer = window.setTimeout(() => {
    if (status?.isConnected) status.textContent = 'Still processing. Please wait…';
  }, 5000);
  try {
    await runProductLifecycle(action, product, '', processingBackdrop);
  } finally {
    window.clearTimeout(slowTimer);
  }
}
function viewRecord(type, item) {
  if (type === 'ingredient') {
    const movements = all('inventoryTransactions').filter(row => row.ingredientId === item.id).slice().reverse();
    const canSeeCost = ['Administrator', 'Manager', 'Inventory Clerk'].includes(state.role);
    const movementRows = movements.length ? movements.map(row => `<tr><td>${esc(row.date)}</td><td>${esc(row.type)}</td><td>${row.quantity} ${esc(item.unit)}</td>${canSeeCost ? `<td>${money(row.unitCost)}</td>` : ''}<td>${esc(row.user || '—')}</td></tr>`).join('') : `<tr><td colspan="${canSeeCost ? 5 : 4}" class="empty-state">No stock movements recorded yet.</td></tr>`;
    const productBatches = all('inventoryBatches').filter(batch => batch.productId === item.id);
    const batchSnapshot = inventoryBatchVisibility(productBatches);
    const fifoRank = new Map(batchSnapshot.fifoOrder.map((batch, index) => [String(batch.id), index + 1]));
    const fefoRank = new Map(batchSnapshot.fefoOrder.map((batch, index) => [String(batch.id), index + 1]));
    const batchStatuses = new Map(batchSnapshot.classified.map(entry => [String(entry.batch.id), entry.expiry]));
    const batchRows = batchSnapshot.orderedBatches.length
      ? batchSnapshot.orderedBatches.map(batch => {
        const status = batchStatuses.get(String(batch.id));
        const statusClass = status.status === 'Expired' ? 'is-expired'
          : status.status === 'Expiring soon' ? 'is-warning'
            : ['Active', 'Depleted'].includes(status.status) ? 'is-healthy' : 'is-neutral';
        const fifoPosition = fifoRank.get(String(batch.id));
        const fefoPosition = fefoRank.get(String(batch.id));
        const priority = fifoPosition
          ? `<span class="inventory-priority-pill">FIFO #${fifoPosition}</span><span class="inventory-priority-pill is-fefo">FEFO #${fefoPosition}</span>`
          : '<span class="inventory-priority-unavailable">Not eligible</span>';
        const expirationDate = batch.expirationDate || batch.expiration_date;
        const dateLabel = expirationDate
          ? new Date(`${expirationDate}T12:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
          : '—';
        return `<tr><td><strong>${esc(inventoryBatchLabel(batch))}</strong></td><td>${formatStockQuantity(batch.quantityRemaining)} ${esc(item.unit)}</td><td>${esc(dateLabel)}</td><td>${esc(inventoryExpiryLabel(status.daysUntilExpiry))}</td><td><span class="inventory-batch-status ${statusClass}">${esc(status.status)}</span></td><td><div class="inventory-priority-list">${priority}</div></td></tr>`;
      }).join('')
      : '<tr><td colspan="6" class="empty-state">No batch or lot records are available for this product.</td></tr>';
    const fifoFirst = batchSnapshot.fifoOrder[0];
    const fefoFirst = batchSnapshot.fefoOrder[0];
    const batchGuidance = `<div class="inventory-batch-guidance">
      <div><small>FIFO usage order</small><strong>${fifoFirst ? `Use first: ${esc(inventoryBatchLabel(fifoFirst))}` : 'No active batch available'}</strong></div>
      <div><small>FEFO expiry order</small><strong>${fefoFirst ? `Earliest expiry: ${esc(inventoryBatchLabel(fefoFirst))}` : 'No active batch available'}</strong></div>
      <span>${batchSnapshot.expiringSoonCount} expiring soon · ${batchSnapshot.expiredCount} expired</span>
    </div>`;
    const batchTable = `<div class="table-scroll inventory-batch-table-scroll"><table class="inventory-batch-table"><thead><tr><th>Lot number</th><th>Quantity</th><th>Expiration date</th><th>Days remaining</th><th>Status</th><th>Recommended usage order</th></tr></thead><tbody>${batchRows}</tbody></table></div>`;
    modal(item.name, `<div class="detail-grid"><div><small>Category</small><strong>${esc(item.category)}</strong></div><div><small>Stock status</small><strong>${stockStatus(item)}</strong></div><div><small>Current stock</small><strong>${formatStockQuantity(item.stock)} ${esc(item.unit)}</strong></div>${canSeeCost ? `<div><small>Cost per unit</small><strong>${money(item.cost)}</strong></div>` : ''}<div><small>Minimum stock</small><strong>${item.minimum} ${esc(item.unit)}</strong></div><div><small>Preferred supplier</small><strong>${esc(item.preferredSupplier || 'Not set')}</strong></div><div><small>Expiry tracking</small><strong>${item.trackExpiry ? 'Required on each receipt' : 'Not required'}</strong></div>${item.notes ? `<div class="full"><small>Product notes</small><strong>${esc(item.notes)}</strong></div>` : ''}<div class="full"><small>Batch and lot priority</small>${batchGuidance}${batchTable}</div><div class="full"><small>Stock movement history</small><div class="table-scroll"><table><thead><tr><th>Date</th><th>Type</th><th>Quantity</th>${canSeeCost ? '<th>Unit cost</th>' : ''}<th>User</th></tr></thead><tbody>${movementRows}</tbody></table></div></div></div>`, null, '', 'read-only');
  }
  if (type === 'recipe') {
    const canSeeCosts = ['Administrator', 'Manager'].includes(state.role);
    const breakdown = canSeeCosts ? recipeCostBreakdown(item) : null;
    const active = window.CostTrackLogic.isRecipeActive(item);
    const costDetails = canSeeCosts
      ? `<div><small>Cost per portion</small><strong>${money(breakdown.costPerPortion)}</strong></div><div><small>Total batch cost</small><strong>${money(breakdown.totalBatchCost)}</strong></div>`
      : '';
    modal(item.name, `<div class="detail-grid"><div><small>Category</small><strong>${esc(item.category)}</strong></div><div><small>Status</small><strong>${active ? 'Active' : 'Inactive'}</strong></div><div><small>Portions per base recipe</small><strong>${Number(item.batchYield || 30)} portions</strong></div><div><small>Daily production target</small><strong>${Number(item.prepTarget || 30)} portions</strong></div>${costDetails}<div class="full"><small>Ingredients per base recipe</small><strong>${item.ingredients.map(line => `${esc(ingredient(line.ingredientId)?.name)} · ${line.quantity} ${esc(ingredient(line.ingredientId)?.unit || '')}`).join('<br>')}</strong></div>${item.prepNotes ? `<div class="full"><small>Preparation notes</small><strong>${esc(item.prepNotes)}</strong></div>` : ''}</div>`, null, '', 'read-only');
  }
}
function reservationDateLabel(value) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}
function reservationStatusClass(status) {
  return ['Confirmed', 'Checked-in', 'Seated', 'Completed'].includes(status) ? 'status-good' : ['Cancelled', 'No-show'].includes(status) ? 'status-out' : 'status-low';
}
function reservationMealPeriod(item) {
  const minutes = parseTime12h(typeof item === 'string' ? item : item.time);
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
  const isNewWebsiteReservation = window.CostTrackLogic.isRecentWebsiteReservation(item);
  const sourceLabel = item.source ? `Source: ${item.source}` : 'Source not specified';
  const sourceBadge = `<span class="reservation-source-badge${item.source === 'Website' ? ' reservation-source-badge--website' : ''}">${esc(sourceLabel)}${isNewWebsiteReservation ? '<span class="reservation-new-badge">New</span>' : ''}</span>`;
  const guestCount = reservationGuestCount(item);
  const adultCount = Number(item.adults ?? item.guests ?? 0);
  const seniorPwdCount = Number(item.seniorPwdCount || 0);
  const children = Number(item.children || 0);
  const totalGuests = Number(item.guests ?? adultCount + seniorPwdCount + children);
  const rate = activeBuffetRate(item);
  const revenueEstimate = rate ? reservationRevenue(item, rate) : null;
  const hasRevenue = all('revenueRecords').some(record => record.reservation_id === item.id);
  const historyLabel = isPastReservation ? '<span class="reservation-history-label">Past record · view only</span>' : '';
  const endTime = window.CostTrackLogic.reservationEndTime(item.time);
  const stayLimitReached = item.status === 'Seated' && window.CostTrackLogic.reservationStayLimitReached(item);
  const reservationDeposits = all('reservationDeposits')
    .filter(deposit => deposit.reservationId === item.id)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const heldDeposits = reservationDeposits.filter(deposit => deposit.status === 'Held' && !deposit.billId);
  const heldTotal = heldDeposits.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const openBill = all('posBills').find(bill => bill.reservationId === item.id && bill.status === 'Open');
  const hasOpenShift = all('shifts').some(shift => shift.status === 'Open');
  const packageItem = all('chargeItems').find(charge => charge.id === item.packageChargeItemId);
  const packageTier = all('packageTiers').find(tier => tier.id === item.packageTierId);
  const depositHistory = reservationDeposits.map(deposit => {
    const receipt = Number(deposit.receiptAmount || 0);
    const amount = Number(deposit.amount || 0);
    const amountLabel = receipt > amount
      ? `${money(receipt)} received · ${money(amount)} remaining`
      : money(amount);
    const note = deposit.notes ? ` · ${esc(deposit.notes)}` : '';
    return `<small>Deposit ${esc(deposit.status)}: ${amountLabel}${note}</small>`;
  }).join('');
  const shiftHint = item.status === 'Seated' && !hasOpenShift
    ? '<small class="field-help">Open the restaurant cashier shift before opening a bill or recording a cash deposit.</small>'
    : '';
  const rateLabel = rate && revenueEstimate !== null
    ? `${money(revenueEstimate)} estimated buffet revenue`
    : 'No rate set';
  const primaryGuestSummary = `${totalGuests} guest${totalGuests === 1 ? '' : 's'}${item.actualCovers == null ? '' : ` · ${guestCount} actual`}${item.table ? ` · ${esc(item.table)}` : ''}`;
  const details = `<small class="reservation-card-time"><strong>${esc(item.time || 'Time not set')}${endTime ? `–${esc(endTime)}` : ''}</strong> · ${esc(reservationMealPeriod(item))}</small><span class="status ${reservationStatusClass(item.status)}">${esc(item.status)}</span><span class="tag">${item.type === 'Walk-in' ? 'Walk-in' : 'Reservation'}</span>${historyLabel}<b>${esc(reservationDisplayName(item))}</b><small class="reservation-card-primary-summary">${primaryGuestSummary}</small><span class="reservation-card-secondary-details">${packageItem && packageTier ? `<small>Package: ${esc(packageItem.name)} · ${esc(packageTier.name)} × ${Number(item.packagePaxCount || 0)} pax</small>` : ''}${heldTotal ? `<small>Held deposit: ${money(heldTotal)}</small>` : ''}${depositHistory}${item.seatedAt ? `<small>Seated ${new Date(item.seatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>` : ''}${stayLimitReached ? '<small class="reservation-stay-warning" role="status">Two-hour limit reached</small>' : ''}${item.completedAt ? `<small>Completed ${new Date(item.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>` : ''}${shiftHint}${canAccessRevenue() && item.status === 'Completed' && !hasRevenue ? '<small class="report-disclaimer">No revenue entry yet</small>' : ''}${showRevenue && canAccessRevenue() ? `<em>${esc(rateLabel)}</em>` : ''}</span>`;
  const lifecycleActions = isPastReservation
    ? item.status === 'Seated'
      ? `${openBill
        ? `<button type="button" class="reservation-confirm-btn" data-action="open-bill" data-id="${esc(openBill.id)}">Open bill</button>`
        : `<button type="button" class="reservation-confirm-btn" data-action="open-reservation-bill" data-id="${esc(item.id)}" ${hasOpenShift ? '' : 'aria-disabled="true" title="Open the restaurant cashier shift before creating a bill."'}>Open bill</button>`}`
      : ''
    : item.status === 'Pending'
    ? `<button type="button" class="reservation-confirm-btn" data-action="reservation-transition" data-transition="Confirmed" data-id="${esc(item.id)}">Confirm</button><button type="button" class="reservation-confirm-btn" data-action="reservation-transition" data-transition="Cancelled" data-id="${esc(item.id)}">Cancel</button>`
    : item.status === 'Confirmed'
      ? `<button type="button" class="reservation-confirm-btn" data-action="reservation-transition" data-transition="Seated" data-id="${esc(item.id)}">Seat</button><button type="button" class="reservation-confirm-btn" data-action="reservation-transition" data-transition="No-show" data-id="${esc(item.id)}">No-show</button><button type="button" class="reservation-confirm-btn" data-action="reservation-transition" data-transition="Cancelled" data-id="${esc(item.id)}">Cancel</button>`
      : item.status === 'Seated'
        ? `${openBill ? `<button type="button" class="reservation-confirm-btn" data-action="open-bill" data-id="${esc(openBill.id)}">Open bill</button>` : `<button type="button" class="reservation-confirm-btn" data-action="open-reservation-bill" data-id="${esc(item.id)}" ${hasOpenShift ? '' : 'aria-disabled="true" title="Open the restaurant cashier shift before creating a bill."'}>Open bill</button>`}<button type="button" class="reservation-confirm-btn" data-action="record-deposit" data-id="${esc(item.id)}" ${hasOpenShift ? '' : 'aria-disabled="true" title="Open the restaurant cashier shift before recording a deposit."'}>Record deposit</button><small class="field-help" id="reservation-complete-help-${esc(item.id)}">Reservation completes automatically when its linked bill is closed and fully settled.</small>`
        : '';
  const depositActions = !isPastReservation && ['Administrator', 'Manager'].includes(state.role)
    ? heldDeposits.map(deposit => `<span class="deposit-action-group"><button type="button" class="ghost-btn compact-btn" data-action="deposit-decision" data-decision="refund" data-id="${esc(deposit.id)}">Refund ${money(deposit.amount)}</button><button type="button" class="ghost-btn compact-btn" data-action="deposit-decision" data-decision="forfeit" data-id="${esc(deposit.id)}">Forfeit</button></span>`).join('')
    : '';
  const depositHistoryAction = reservationDeposits.length
    ? `<button type="button" class="ghost-btn compact-btn" data-action="deposit-history" data-id="${esc(item.id)}">Deposit history</button>`
    : '';
  const canDelete = !isPastReservation && ['Administrator', 'Manager'].includes(state.role);
  const actions = `${lifecycleActions}${depositHistoryAction}${depositActions}${canDelete ? `<button type="button" class="danger-btn compact-btn" data-action="delete-reservation" data-id="${esc(item.id)}">Delete</button>` : ''}`;
  const actionLabel = isPastReservation
    ? (['Administrator', 'Manager'].includes(state.role) ? 'Correct past reservation' : 'View past reservation')
    : 'View reservation';
  return `<article class="reservation-card${isPastReservation ? ' reservation-card--historical' : ''}${isNewWebsiteReservation ? ' reservation-card--new-website' : ''}"><button type="button" class="reservation-card-main" data-action="edit-reservation" data-id="${esc(item.id)}" aria-label="${actionLabel} for ${esc(item.name)}">${sourceBadge}${details}</button><div class="reservation-actions">${actions}</div></article>`;
}
function unresolvedBookingCard(row) {
  const reservationId = row.reservation_id;
  const reservation = all('reservations').find(item => item.id === selectedReservationId);
  const openBill = all('posBills').find(bill =>
    bill.reservationId === reservationId && bill.status === 'Open'
  );
  const canResolve = ['Administrator', 'Manager'].includes(state.role);
  const hasOpenShift = all('shifts').some(shift => shift.status === 'Open');
  const status = row.reservation_status;
  const type = row.type || reservation?.type || 'Reservation';
  const heldTotal = Number(row.held_deposit_total || 0);
  const ageDays = Number(row.age_days || 0);
  const billStatus = row.bill_status || 'None';
  const tableId = row.table_id || reservation?.table || '';
  const openBillAction = row.resolution_label === 'Payable'
    ? `<button type="button" class="reservation-confirm-btn" data-action="open-unresolved-bill" data-id="${esc(reservationId)}">Open bill</button>`
    : status === 'Seated'
      ? `<button type="button" class="reservation-confirm-btn" data-action="open-reservation-bill" data-id="${esc(reservationId)}" ${hasOpenShift ? '' : 'aria-disabled="true" title="Open the restaurant cashier shift before creating a bill."'}>Open bill</button>`
      : '';
  const resolveAction = canResolve && row.resolution_label !== 'Payable'
    ? `<button type="button" class="primary-btn compact-btn" data-action="resolve-stale-booking" data-id="${esc(reservationId)}">Resolve</button>`
    : '';
  return `<article class="reservation-card unresolved-booking-card" data-unresolved-reservation data-id="${esc(reservationId)}">
    <div class="reservation-card-main">
      <span class="status ${reservationStatusClass(status)}">${esc(status)}</span>
      <span class="tag">${esc(type)}</span>
      ${row.resolution_label === 'Payable' ? '<span class="unresolved-payable-label">Payable</span>' : ''}
      <strong>${esc(row.name || reservationDisplayName({ type }))}</strong>
      <small>${esc(reservationDateLabel(row.reservation_date))} · ${esc(row.reservation_time || 'Time not set')} · ${esc(tableId || 'Unassigned')}</small>
      <small>${Number(row.guests || 0)} guests · unresolved for ${ageDays} day${ageDays === 1 ? '' : 's'}</small>
      <small>Bill status: ${esc(billStatus)}</small>
      ${heldTotal > 0 ? `<small>Held deposit: ${money(heldTotal)}</small>` : '<small>Held deposit: None</small>'}
    </div>
    <div class="reservation-actions">${openBillAction}${resolveAction}</div>
  </article>`;
}
function reservationTableOptions({ tableId = '', date = '', time = '', partySize = 0, reservationId = '' } = {}) {
  return all('restaurantTables').map(table => {
    const alreadyAssigned = table.id === tableId;
    const hasCapacity = Number(table.seats) >= Number(partySize || 0);
    const needsCleaning = table.status === 'Needs cleaning' && !alreadyAssigned;
    const tableDetails = [
      table.tableType && table.tableType !== 'Unassigned' ? table.tableType : '',
      table.area && table.area !== 'Unassigned' ? table.area : ''
    ].filter(Boolean).join(' · ');
    const hasConflict = window.CostTrackLogic.tableHasReservationConflict(
      table.id, date, time, all('reservations'), reservationId, today()
    );
    const disabled = hasConflict || (!alreadyAssigned && (!hasCapacity || needsCleaning));
    const reason = hasConflict ? ' · overlaps another two-hour booking' : needsCleaning ? ' · needs cleaning' : !hasCapacity ? ' · too small' : '';
    return `<option value="${esc(table.id)}" ${alreadyAssigned ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(table.id)} · ${Number(table.seats)} seats${tableDetails ? ` · ${esc(tableDetails)}` : ''}${reason}</option>`;
  }).join('');
}
function refreshReservationTables(form) {
  const select = form.elements.table;
  if (!select) return;
  const selectedTable = select.value;
  const partySize = Number(form.elements.adults.value || 0)
    + Number(form.elements.seniorPwdCount.value || 0)
    + Number(form.elements.children.value || 0);
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
function reservationTimeOptionsMarkup(date, selectedTime, existingReservation) {
  const slots = window.CostTrackLogic.reservationTimeSlots(date);
  const keepExistingTime = Boolean(
    existingReservation
    && date === existingReservation.date
    && selectedTime === existingReservation.time
  );
  const keepSelectedTime = Boolean(
    selectedTime
    && window.CostTrackLogic.isReservationTimeWithinOpenHours(selectedTime)
    && !window.CostTrackLogic.reservationStartTimeIsInPast(date, selectedTime)
  );
  const keepTime = keepExistingTime || keepSelectedTime;
  const hasSelectedSlot = slots.includes(selectedTime);
  const placeholderSelected = !hasSelectedSlot && !(keepTime && selectedTime);
  const slotOptions = slots.map(time =>
    `<option value="${time}" ${selectedTime === time ? 'selected' : ''}>${time}</option>`
  ).join('');
  const selectedOption = selectedTime && !hasSelectedSlot && keepTime
    ? `<option value="${esc(selectedTime)}" selected>${esc(selectedTime)} · ${keepExistingTime ? 'existing' : 'selected'}</option>`
    : '';
  return `<option value="" disabled ${placeholderSelected ? 'selected' : ''}>Choose a time</option>${slotOptions}${selectedOption}`;
}
function refreshReservationTimeOptions(form) {
  const select = form.elements.time;
  if (!select) return;
  const existingReservation = all('reservations').find(item => item.id === form.dataset.id);
  select.innerHTML = reservationTimeOptionsMarkup(
    form.elements.date.value,
    select.value,
    existingReservation
  );
}
function reservationForm(item = {}, defaults = {}) {
  const isPastReservation = Boolean(item.id && item.date && item.date < today());
  if (!isPastReservation) {
    const packageItems = all('chargeItems').filter(charge => charge.type === 'package' && charge.isPackage && charge.isActive !== false);
    state.reservationWizard = {
      step: 1,
      item,
      draft: {
        id: item.id || '',
        status: item.status || 'Pending',
        type: item.type || 'Reservation',
        name: item.name || '',
        email: item.email || '',
        phone: item.phone || '',
        date: item.date || defaults.date || today(),
        time: item.time || defaults.time || '',
        adults: Number(item.adults ?? item.guests ?? 2),
        seniorPwdCount: Number(item.seniorPwdCount || 0),
        children: Number(item.children || 0),
        table: item.table || '',
        occasion: item.occasion || '',
        packageChargeItemId: item.packageChargeItemId || '',
        packageTierId: item.packageTierId || '',
        packagePaxCount: item.packagePaxCount || '',
        packageOverrideReason: item.packageOverrideReason || '',
        source: item.source || '',
        preference: item.preference || 'Any available table',
        request: item.request || ''
      },
      packageItems
    };
    renderReservationWizard();
    return;
  }
  const canCorrectPast = isPastReservation && ['Administrator', 'Manager'].includes(state.role);
  const isReadOnly = isPastReservation && !canCorrectPast;
  const lockHistoricalFields = isPastReservation ? 'disabled' : '';
  const lockReadOnlyFields = isReadOnly ? 'disabled' : '';
  const adults = Number(item.adults ?? item.guests ?? 2);
  const seniorPwdCount = Number(item.seniorPwdCount || 0);
  const children = Number(item.children || 0);
  const reservationDate = item.date || defaults.date || today();
  const selectedTime = item.time || defaults.time || '';
  const tableOptions = reservationTableOptions({
    tableId: item.table,
    date: reservationDate,
    time: selectedTime,
    partySize: adults + seniorPwdCount + children,
    reservationId: item.id
  });
  const timeOptions = reservationTimeOptionsMarkup(reservationDate, selectedTime, item);
  const packageItems = all('chargeItems').filter(charge => charge.type === 'package' && charge.isPackage && charge.isActive !== false);
  const packageTiers = all('packageTiers').filter(tier => tier.isActive !== false);
  const packageOptions = packageItems.map(charge => `<option value="${esc(charge.id)}" ${item.packageChargeItemId === charge.id ? 'selected' : ''}>${esc(charge.name)}</option>`).join('');
  const tierOptions = packageTiers.map(tier => `<option value="${esc(tier.id)}" ${item.packageTierId === tier.id ? 'selected' : ''}>${esc(tier.name)} · ${money(tier.basePrice)} / pax</option>`).join('');
  const receptionistWalkIn = item.type === 'Walk-in' && state.role === 'Receptionist';
  const packageDisabled = isPastReservation || receptionistWalkIn ? 'disabled' : '';
  const packageOverrideField = item.type === 'Walk-in' && ['Manager', 'Administrator'].includes(state.role)
    ? '<label class="full">Manager override reason<textarea name="packageOverrideReason" minlength="10" maxlength="500" rows="2"></textarea><small class="field-help">Required when adding or changing a Walk-in event package; saved to the package override audit log.</small></label>'
    : '';
  const packageRuleHelp = receptionistWalkIn
    ? 'Event packages cannot be added to Walk-ins by Receptionists. A Manager or Administrator must enter an override reason.'
    : 'Package price is charged as food revenue. Additional guests are suggested on the bill.';
  const packageSection = `<fieldset class="product-form-section"><legend>Package booking (optional)</legend><div class="form-grid"><label>Package<select name="packageChargeItemId" ${packageDisabled}><option value="">No package</option>${packageOptions}</select></label><label>Package tier<select name="packageTierId" ${packageDisabled}><option value="">Choose a tier</option>${tierOptions}</select></label><label>Booked pax<input name="packagePaxCount" type="number" min="1" max="1000" step="1" value="${esc(item.packagePaxCount || '')}" ${packageDisabled}></label>${packageOverrideField}</div><small class="field-help">${packageRuleHelp}</small></fieldset>`;
  const historyNotice = isPastReservation
    ? `<div class="reservation-history-notice"><strong>${canCorrectPast ? 'Historical correction' : 'Past reservation · view only'}</strong><span>${canCorrectPast ? 'Only the guest name, contact details, occasion, seating preference, and special-request notes can be corrected. Date, time, party size, table, and status are locked. Your reason is recorded in the audit log.' : 'Past bookings are kept for reference. Eligible unresolved bookings are handled from the Unresolved list.'}</span></div>`
    : '';
  const correctionReason = canCorrectPast
    ? `<label>Correction reason<textarea name="correctionReason" minlength="10" maxlength="500" required placeholder="Explain why this historical detail needs correction"></textarea><small class="field-help">Required; enter at least 10 characters.</small></label>`
    : '';
  const sourceOptions = ['', 'Website', 'Phone', 'Facebook', 'Walk-in', 'Other']
    .map(source => `<option value="${esc(source)}" ${String(item.source || '') === source ? 'selected' : ''}>${source || 'Not specified'}</option>`)
    .join('');
  const lockReservationDetails = lockHistoricalFields || lockReadOnlyFields;
  const formContent = `${historyNotice}<input type="hidden" name="id" value="${esc(item.id || '')}"><input type="hidden" name="status" value="${esc(item.status || 'Pending')}"><label>Guest name<input name="name" value="${esc(item.name || '')}" ${item.type === 'Walk-in' ? '' : 'required'} autocomplete="name" ${lockReadOnlyFields}></label><div class="form-grid"><label>Email<input name="email" type="email" value="${esc(item.email || '')}" autocomplete="email" ${lockReadOnlyFields}></label><label>Phone<input name="phone" value="${esc(item.phone || '')}" autocomplete="tel" ${lockReadOnlyFields}></label></div><small class="field-help">${item.type === 'Walk-in' ? 'Contact details are optional for walk-ins.' : 'Enter a phone number or email address.'}</small><div class="form-grid"><label>Date<input name="date" type="date" min="${today()}" value="${esc(reservationDate)}" required ${lockHistoricalFields}></label><label>Time<select name="time" required ${lockHistoricalFields}>${timeOptions}</select><small class="field-help">Each booking has a two-hour window. Choose a start from 10:00 AM through 7:00 PM so it ends by closing at 9:00 PM. Past times today are unavailable.</small></label></div><div class="form-grid"><label>Adults<input name="adults" type="number" min="0" max="1000" step="1" value="${adults}" required ${lockReservationDetails}></label><label>Senior / PWD<input name="seniorPwdCount" type="number" min="0" max="1000" step="1" value="${seniorPwdCount}" required ${lockReservationDetails}></label><label>Kids<input name="children" type="number" min="0" max="1000" step="1" value="${children}" required ${lockReservationDetails}></label></div><div class="form-grid"><label>Table<select name="table" ${lockReservationDetails}><option value="">Unassigned</option>${tableOptions}</select><small class="field-help">Only tables with enough seats and no overlapping two-hour booking can be assigned.</small></label><label>Status<input value="${esc(item.status || 'Pending')}" readonly disabled></label><label>Source<select name="source" ${lockReservationDetails}>${sourceOptions}</select></div>${packageSection}<label>Occasion<input name="occasion" value="${esc(item.occasion || '')}" ${lockReadOnlyFields}></label><label>Seating preference<input name="preference" value="${esc(item.preference || 'Any available table')}" ${lockReadOnlyFields}></label><label>Special request<textarea name="request" ${lockReadOnlyFields}>${esc(item.request || '')}</textarea></label>${correctionReason}`;
  const title = isPastReservation ? canCorrectPast ? 'Correct past reservation' : 'Past reservation details' : item.id ? 'Update reservation' : 'New reservation';
  const submitLabel = isReadOnly ? '' : item.id ? canCorrectPast ? 'Save correction' : 'Save changes' : 'Create reservation';
  modal(title, formContent, submitLabel, '', isReadOnly ? 'read-only' : 'form');
  document.querySelector('#modalForm').dataset.type = 'reservation';
  document.querySelector('#modalForm').dataset.id = item.id || '';
  document.querySelector('#modalForm').dataset.reservationType = item.type || 'Reservation';
  if (isReadOnly) {
    const root = document.querySelector('#modalRoot');
    root.querySelector('[data-action="close-modal"]').textContent = '×';
    requestAnimationFrame(() => root.querySelector('.modal')?.focus());
  }
}
function reservationTableState(table, {
  date = '',
  time = '',
  partySize = 0,
  reservationId = '',
  selectedTableId = ''
} = {}) {
  const reservations = all('reservations');
  const alreadyAssigned = table.id === selectedTableId;
  const hasCapacity = Number(table.seats) >= Number(partySize || 0);
  const needsCleaning = table.status === 'Needs cleaning' && !alreadyAssigned;
  const occupiedBooking = reservations.find(item =>
    item.id !== reservationId && item.table === table.id && item.date <= date && item.status === 'Seated'
  );
  const conflict = window.CostTrackLogic.tableHasReservationConflict(
    table.id, date, time, reservations, reservationId, today()
  );
  const occupied = Boolean(occupiedBooking || (date === today() && table.status === 'Occupied' && !alreadyAssigned));
  const canSelect = !conflict && !occupied && (!needsCleaning || alreadyAssigned)
    && (hasCapacity || alreadyAssigned);
  const status = occupied ? 'Occupied'
    : conflict ? 'Reserved soon'
      : needsCleaning ? 'Needs cleaning'
        : hasCapacity ? 'Available' : 'Too small';
  const futureReservation = date && time
    ? reservations
      .filter(item => item.id !== reservationId
        && item.table === table.id
        && item.date === date
        && ['Pending', 'Confirmed'].includes(item.status)
        && (window.CostTrackLogic.parseReservationTime(item.time) ?? -1)
          >= (window.CostTrackLogic.parseReservationTime(time) ?? Number.MAX_SAFE_INTEGER)
            + window.CostTrackLogic.MAX_TABLE_STAY_MINUTES)
      .sort((left, right) =>
        (window.CostTrackLogic.parseReservationTime(left.time) ?? Number.MAX_SAFE_INTEGER)
        - (window.CostTrackLogic.parseReservationTime(right.time) ?? Number.MAX_SAFE_INTEGER))[0]
    : null;
  return {
    table,
    canSelect,
    hasCapacity,
    status,
    conflict,
    occupiedBooking,
    futureReservation,
    details: [
      table.tableType && table.tableType !== 'Unassigned' ? table.tableType : '',
      table.area && table.area !== 'Unassigned' ? table.area : ''
    ].filter(Boolean).join(' · ')
  };
}
function reservationTableCardsMarkup({
  date,
  time,
  partySize,
  reservationId = '',
  selectedTableId = '',
  action = 'reservation-wizard-table'
} = {}) {
  const tables = all('restaurantTables')
    .map(table => reservationTableState(table, { date, time, partySize, reservationId, selectedTableId }))
    .sort((left, right) => String(left.table.id).localeCompare(String(right.table.id), undefined, { numeric: true }));
  const statusClass = status => ({
    'Available': 'is-available',
    'Reserved soon': 'is-reserved',
    'Occupied': 'is-occupied',
    'Needs cleaning': 'is-cleaning',
    'Too small': 'is-too-small'
  }[status] || 'is-too-small');
  const cards = tables.map(({ table, canSelect, hasCapacity, status, details, futureReservation }) => {
    const selected = table.id === selectedTableId;
    const note = status === 'Reserved soon'
      ? 'Conflicts with this seating time'
      : status === 'Needs cleaning'
        ? 'Not ready for seating'
        : status === 'Too small'
          ? `Party exceeds ${Number(table.seats)} seats`
          : futureReservation
            ? `Reserved later at ${futureReservation.time}`
            : details;
    return `<button type="button" class="table-choice-card${selected ? ' is-selected' : ''}" data-action="${action}" data-table-id="${esc(table.id)}" aria-pressed="${selected}" ${canSelect && hasCapacity ? '' : 'disabled'}><span class="table-choice-heading"><strong>${esc(table.id)}</strong><span class="table-choice-status ${statusClass(status)}"><i aria-hidden="true"></i>${status}</span></span><span class="table-choice-capacity">${Number(table.seats)} seats</span>${note ? `<small>${esc(note)}</small>` : '<small>&nbsp;</small>'}</button>`;
  }).join('');
  return tables.length
    ? cards
    : '<p class="table-choice-empty">No tables are set up yet. Add tables before assigning a reservation.</p>';
}
function reservationWizardHiddenFields(excludedNames = []) {
  const draft = state.reservationWizard.draft;
  const fields = [
    'id', 'status', 'type', 'name', 'email', 'phone', 'date', 'time',
    'adults', 'seniorPwdCount', 'children', 'table', 'occasion',
    'packageChargeItemId', 'packageTierId', 'packagePaxCount',
    'packageOverrideReason', 'source', 'preference', 'request'
  ];
  return fields.filter(name => !excludedNames.includes(name))
    .map(name => `<input type="hidden" name="${name}" value="${esc(draft[name] ?? '')}">`).join('');
}
function renderReservationWizard() {
  const wizard = state.reservationWizard;
  if (!wizard) return;
  const { step, draft, item } = wizard;
  const existing = Boolean(item.id);
  const partySize = Number(draft.adults || 0) + Number(draft.seniorPwdCount || 0) + Number(draft.children || 0);
  const steps = ['Guest details', 'Table selection', 'Extras', 'Review'];
  const progress = `<ol class="reservation-wizard-progress" aria-label="Reservation progress">${steps.map((label, index) => {
    const number = index + 1;
    const current = number === step;
    const complete = number < step;
    const content = `<span class="reservation-wizard-step-number">${complete ? '✓' : number}</span><span>${label}</span>`;
    return `<li class="${current ? 'is-current' : complete ? 'is-complete' : ''}">${complete
      ? `<button type="button" data-action="reservation-wizard-goto" data-step="${number}" aria-label="Go back to step ${number}: ${label}">${content}</button>`
      : `<span ${current ? 'aria-current="step"' : ''}>${content}</span>`}</li>`;
  }).join('')}</ol>`;
  const hidden = excluded => reservationWizardHiddenFields(excluded);
  const countFields = `<div class="form-grid reservation-count-grid"><label>Adults<input name="adults" type="number" min="0" max="1000" step="1" value="${esc(draft.adults)}" required></label><label>Senior / PWD<input name="seniorPwdCount" type="number" min="0" max="1000" step="1" value="${esc(draft.seniorPwdCount)}" required></label><label>Kids<input name="children" type="number" min="0" max="1000" step="1" value="${esc(draft.children)}" required></label></div>`;
  const timeOptions = reservationTimeOptionsMarkup(draft.date, draft.time, item);
  const sourceOptions = ['', 'Website', 'Phone', 'Facebook', 'Walk-in', 'Other']
    .map(source => `<option value="${esc(source)}" ${String(draft.source || '') === source ? 'selected' : ''}>${source || 'Not specified'}</option>`).join('');
  const packageOptions = wizard.packageItems.map(charge =>
    `<option value="${esc(charge.id)}" ${draft.packageChargeItemId === charge.id ? 'selected' : ''}>${esc(charge.name)}</option>`
  ).join('');
  const tierOptions = all('packageTiers').filter(tier => tier.isActive !== false).map(tier =>
    `<option value="${esc(tier.id)}" ${draft.packageTierId === tier.id ? 'selected' : ''}>${esc(tier.name)} · ${money(tier.basePrice)} / pax</option>`
  ).join('');
  const receptionistWalkIn = draft.type === 'Walk-in' && state.role === 'Receptionist';
  const packageDisabled = receptionistWalkIn ? 'disabled' : '';
  const packageOverrideField = draft.type === 'Walk-in' && ['Manager', 'Administrator'].includes(state.role)
    ? `<label class="full">Manager override reason<textarea name="packageOverrideReason" minlength="10" maxlength="500">${esc(draft.packageOverrideReason)}</textarea><small class="field-help">Required when adding or changing a Walk-in event package; saved to the package override audit log.</small></label>`
    : '';
  const timeHelp = '<small class="field-help">Each booking has a two-hour window. Choose a start from 10:00 AM through 7:00 PM so it ends by closing at 9:00 PM. Past times today are unavailable.</small>';
  let content = progress;
  let excluded = [];
  let submitLabel = step < 4 ? 'Continue' : existing ? 'Save changes' : 'Create Reservation';
  if (step === 1) {
    excluded = ['name', 'email', 'phone', 'date', 'time', 'adults', 'seniorPwdCount', 'children'];
    content += `<section class="reservation-wizard-panel"><div class="reservation-wizard-heading"><div><p class="eyebrow">Step 1 of 4</p><h3>Guest details</h3></div><p>Capture the guest and seating details first.</p></div><div class="form-grid"><label>Guest name<input name="name" value="${esc(draft.name)}" required autocomplete="name"></label><label>Phone<input name="phone" type="tel" value="${esc(draft.phone)}" autocomplete="tel"></label><label>Email<input name="email" type="email" value="${esc(draft.email)}" autocomplete="email"></label><label>Date<input name="date" type="date" min="${today()}" value="${esc(draft.date)}" required></label><label>Time<select name="time" required>${timeOptions}</select>${timeHelp}</label></div><div class="reservation-party-summary" aria-live="polite"><strong>Total guests <span data-reservation-step-total>${partySize}</span></strong><span data-reservation-step-meal>${esc(draft.time ? reservationMealPeriod(draft.time) : 'Choose a time')}</span></div>${countFields}</section>${hidden(excluded)}`;
  } else if (step === 2) {
    excluded = ['table'];
    const selected = draft.table
      ? reservationTableState(all('restaurantTables').find(table => table.id === draft.table) || { id: draft.table, seats: 0 }, {
        date: draft.date, time: draft.time, partySize, reservationId: draft.id, selectedTableId: draft.table
      })
      : null;
    const feedback = !selected
      ? '<span class="is-neutral">Choose a suitable table or leave the reservation unassigned.</span>'
      : !selected.hasCapacity
        ? `<span class="is-warning">Table capacity exceeded: ${Number(selected.table.seats)} seats for ${partySize} guests.</span>`
        : selected.status === 'Occupied' || selected.status === 'Reserved soon' || selected.status === 'Needs cleaning'
          ? `<span class="is-warning">This table is ${esc(selected.status.toLowerCase())} for the selected time. Choose another table or clear the assignment.</span>`
          : '<span class="is-success">Table can accommodate this party.</span>';
    content += `<section class="reservation-wizard-panel"><div class="reservation-wizard-heading"><div><p class="eyebrow">Step 2 of 4</p><h3>Select a table</h3></div><p>${partySize} guests · ${esc(reservationDateLabel(draft.date))} at ${esc(draft.time || 'time not set')}</p></div><div class="reservation-capacity-feedback" aria-live="polite">${feedback}</div><div class="table-choice-grid">${reservationTableCardsMarkup({ date: draft.date, time: draft.time, partySize, reservationId: draft.id, selectedTableId: draft.table })}</div><button type="button" class="ghost-btn reservation-unassigned-button" data-action="reservation-wizard-table" data-table-id="" aria-pressed="${!draft.table}">Leave unassigned</button></section>${hidden(excluded)}`;
  } else if (step === 3) {
    excluded = ['occasion', 'packageChargeItemId', 'packageTierId', 'packagePaxCount', 'packageOverrideReason', 'source', 'preference', 'request'];
    content += `<section class="reservation-wizard-panel"><div class="reservation-wizard-heading"><div><p class="eyebrow">Step 3 of 4</p><h3>Reservation extras</h3></div><p>Optional information can be added now or left blank.</p></div><div class="form-grid"><label>Occasion<input name="occasion" value="${esc(draft.occasion)}"></label><label>Source<select name="source">${sourceOptions}</select></label><label>Seating preference<input name="preference" value="${esc(draft.preference)}"></label><label>Package<select name="packageChargeItemId" ${packageDisabled}><option value="">No package booked</option>${packageOptions}</select></label><label>Package tier<select name="packageTierId" ${packageDisabled}><option value="">Choose a tier</option>${tierOptions}</select></label><label>Booked pax<input name="packagePaxCount" type="number" min="1" max="1000" step="1" value="${esc(draft.packagePaxCount)}" ${packageDisabled}></label>${packageOverrideField}<label class="full">Special requests<textarea name="request">${esc(draft.request)}</textarea></label></div><small class="field-help">${receptionistWalkIn ? 'Event packages cannot be added to Walk-ins by Receptionists. A Manager or Administrator must enter an override reason.' : 'Package price is charged as food revenue. Additional guests are suggested on the bill.'}</small></section>${hidden(excluded)}`;
  } else {
    excluded = [];
    const table = draft.table ? all('restaurantTables').find(entry => entry.id === draft.table) : null;
    const reviewRows = [
      ['Guest', draft.name || 'Not provided'],
      ['Phone', draft.phone || 'Not provided'],
      ['Email', draft.email || 'Not provided'],
      ['Date', reservationDateLabel(draft.date)],
      ['Time', draft.time || 'Not set'],
      ['Guests', `${partySize} total (${Number(draft.adults || 0)} adults, ${Number(draft.seniorPwdCount || 0)} senior/PWD, ${Number(draft.children || 0)} kids)`],
      ['Table', table ? `${table.id} · ${Number(table.seats)} seats` : 'Unassigned'],
      ['Occasion', draft.occasion || 'Not specified'],
      ['Package', draft.packageChargeItemId ? wizard.packageItems.find(entry => entry.id === draft.packageChargeItemId)?.name || 'Selected package' : 'No package booked'],
      ['Package tier', draft.packageTierId ? all('packageTiers').find(entry => entry.id === draft.packageTierId)?.name || 'Selected tier' : 'Not specified'],
      ['Source', draft.source || 'Not specified'],
      ['Seating preference', draft.preference || 'Not specified'],
      ['Special requests', draft.request || 'None']
    ];
    content += `<section class="reservation-wizard-panel"><div class="reservation-wizard-heading"><div><p class="eyebrow">Step 4 of 4</p><h3>Review &amp; confirm</h3></div><p>Check the details before saving.</p></div><dl class="reservation-review-list">${reviewRows.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><div class="reservation-review-edit"><button type="button" class="ghost-btn" data-action="reservation-wizard-goto" data-step="1">Edit guest details</button><button type="button" class="ghost-btn" data-action="reservation-wizard-goto" data-step="2">Edit table</button><button type="button" class="ghost-btn" data-action="reservation-wizard-goto" data-step="3">Edit extras</button></div></section>${hidden(excluded)}`;
  }
  const title = existing ? 'Update reservation' : 'New reservation';
  modal(title, content, submitLabel, 'reservation-wizard-modal');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'reservation';
  form.dataset.id = draft.id || '';
  form.dataset.reservationType = draft.type || 'Reservation';
  form.dataset.reservationWizardStep = String(step);
  form.querySelector('[name="status"]').value = draft.status || 'Pending';
  form.querySelector('[name="type"]').value = draft.type || 'Reservation';
  if (step === 2 && draft.table) {
    const selected = all('restaurantTables').find(table => table.id === draft.table);
    const selectedState = selected && reservationTableState(selected, {
      date: draft.date, time: draft.time, partySize, reservationId: draft.id, selectedTableId: draft.table
    });
    const submit = form.querySelector('.modal-submit');
    if (submit && (!selectedState || !selectedState.canSelect || !selectedState.hasCapacity)) submit.disabled = true;
  }
  const backButton = document.createElement('button');
  if (step > 1) {
    backButton.type = 'button';
    backButton.className = 'ghost-btn';
    backButton.dataset.action = 'reservation-wizard-back';
    backButton.textContent = 'Back';
    form.querySelector('.modal-actions .pos-wizard-footer-left')?.append(backButton);
  }
}
function walkInTableOptions(partySize = 0, date = today(), time = null) {
  const now = new Date();
  const walkInTime = time || window.CostTrackLogic.formatReservationTime(now.getHours() * 60 + now.getMinutes());
  const walkInStart = window.CostTrackLogic.parseReservationTime(walkInTime);
  const reservations = all('reservations');
  const suitableTables = window.CostTrackLogic.isReservationTimeWithinOpenHours(walkInTime)
    ? all('restaurantTables').filter(table =>
      table.status !== 'Needs cleaning'
      &&
      Number(table.seats) >= Number(partySize || 0)
      && !reservations.some(item => item.table === table.id && item.date <= date && item.status === 'Seated')
    )
    : [];
  const tables = suitableTables.filter(table =>
    !window.CostTrackLogic.tableReservationConflict(table.id, date, walkInTime, reservations, '', today())
  );
  const optionMarkup = (table, conflict = null) => {
    const details = [table.tableType, table.area].filter(value => value && value !== 'Unassigned').join(' · ');
    const futureReservation = conflict ? null : reservations
      .filter(item =>
        item.table === table.id
        && item.date === date
        && ['Pending', 'Confirmed'].includes(item.status)
        && walkInStart !== null
        && (window.CostTrackLogic.parseReservationTime(item.time) ?? -1)
          >= walkInStart + window.CostTrackLogic.MAX_TABLE_STAY_MINUTES
      )
      .sort((left, right) =>
        (window.CostTrackLogic.parseReservationTime(left.time) ?? Number.MAX_SAFE_INTEGER)
        - (window.CostTrackLogic.parseReservationTime(right.time) ?? Number.MAX_SAFE_INTEGER))[0];
    const guest = booking => booking?.name || (booking?.type === 'Walk-in' ? 'Walk-in guest' : 'guest');
    const reservationDetail = conflict
      ? ` · Reserved for ${esc(guest(conflict))} at ${esc(conflict.time || 'the scheduled time')} — overlaps this seating`
      : futureReservation
        ? ` · Reserved at ${esc(futureReservation.time)}${futureReservation.name ? ` for ${esc(futureReservation.name)}` : ''}`
        : '';
    return `<option value="${esc(table.id)}" ${conflict ? 'disabled' : ''}>${esc(table.id)} · ${Number(table.seats)} seats${details ? ` · ${esc(details)}` : ''}${reservationDetail}</option>`;
  };
  const eligibleMarkup = tables.map(table => optionMarkup(table)).join('');
  const conflictMarkup = suitableTables
    .map(table => ({ table, conflict: window.CostTrackLogic.tableReservationConflict(table.id, date, walkInTime, reservations, '', today()) }))
    .filter(item => item.conflict)
    .map(item => optionMarkup(item.table, item.conflict))
    .join('');
  return {
    tables,
    markup: `${eligibleMarkup}${conflictMarkup}`
  };
}
function walkInReservationWarning(tableId, booking) {
  const guest = booking?.name || (booking?.type === 'Walk-in' ? 'Walk-in guest' : 'guest');
  if (booking?.status === 'Seated') {
    return `Table ${tableId} is occupied by ${guest}${booking.time ? ` at ${booking.time}` : ''}. Choose another table.`;
  }
  return `Table ${tableId} is reserved for ${guest} at ${booking?.time || 'the scheduled time'}; assigning this walk-in may cause an overlap.`;
}
function walkInTableList(partySize, date, time) {
  const reservations = all('reservations');
  const availableIds = new Set(walkInTableOptions(partySize, date, time).tables.map(table => table.id));
  const insideHours = window.CostTrackLogic.isReservationTimeWithinOpenHours(time);
  const start = window.CostTrackLogic.parseReservationTime(time);
  return all('restaurantTables').map(table => {
    const conflict = window.CostTrackLogic.tableReservationConflict(table.id, date, time, reservations, '', today());
    const occupiedBooking = reservations.find(item =>
      item.table === table.id && item.date <= date && item.status === 'Seated'
    );
    const futureReservation = !conflict && start !== null
      ? reservations.filter(item =>
        item.table === table.id
        && item.date === date
        && ['Pending', 'Confirmed'].includes(item.status)
        && (window.CostTrackLogic.parseReservationTime(item.time) ?? -1)
          >= start + window.CostTrackLogic.MAX_TABLE_STAY_MINUTES
      ).sort((left, right) =>
        (window.CostTrackLogic.parseReservationTime(left.time) ?? Number.MAX_SAFE_INTEGER)
        - (window.CostTrackLogic.parseReservationTime(right.time) ?? Number.MAX_SAFE_INTEGER))[0]
      : null;
    const hasCapacity = Number(table.seats) >= Number(partySize || 0);
    const status = occupiedBooking || table.status === 'Occupied' ? 'Occupied'
      : conflict ? 'Reserved soon'
        : table.status === 'Needs cleaning' ? 'Needs cleaning'
          : !hasCapacity ? 'Too small'
            : insideHours ? 'Available' : 'Unavailable';
    const canSelect = availableIds.has(table.id) && table.status !== 'Occupied';
    return {
      table,
      canSelect,
      hasCapacity,
      status,
      conflict,
      futureReservation,
      details: [table.tableType, table.area].filter(value => value && value !== 'Unassigned').join(' · ')
    };
  }).sort((left, right) =>
    String(left.table.id).localeCompare(String(right.table.id), undefined, { numeric: true }));
}
function walkInTableCardsMarkup(tables, selectedTableId) {
  const statusClass = status => ({
    'Available': 'is-available',
    'Reserved soon': 'is-reserved',
    'Occupied': 'is-occupied',
    'Needs cleaning': 'is-cleaning',
    'Too small': 'is-too-small',
    'Unavailable': 'is-too-small'
  }[status] || 'is-too-small');
  if (!tables.length) return '<p class="table-choice-empty">No tables are configured yet.</p>';
  return tables.map(({ table, canSelect, status, details, futureReservation, conflict }) => {
    const selected = table.id === selectedTableId;
    const note = status === 'Reserved soon'
      ? `Reserved at ${conflict?.time || 'the selected time'}`
      : status === 'Needs cleaning'
        ? 'Needs cleaning'
        : status === 'Too small'
          ? `Capacity ${Number(table.seats)}`
          : status === 'Unavailable'
            ? 'Outside seating hours'
          : status === 'Occupied'
            ? 'Currently occupied'
            : futureReservation
              ? `Reserved later at ${futureReservation.time}`
              : details;
    return `<button type="button" class="table-choice-card${selected ? ' is-selected' : ''}" data-action="select-walkin-table" data-table-id="${esc(table.id)}" aria-pressed="${selected}" ${canSelect ? '' : 'disabled'}><span class="table-choice-heading"><strong>${esc(table.id)}</strong><span class="table-choice-status ${statusClass(status)}"><i aria-hidden="true"></i>${status}</span></span><span class="table-choice-capacity">${Number(table.seats)} seats</span>${note ? `<small>${esc(note)}</small>` : '<small>&nbsp;</small>'}</button>`;
  }).join('');
}
function walkInGuestTotal(form) {
  return ['adults', 'seniorPwdCount', 'children']
    .reduce((sum, name) => sum + Number(form?.elements?.[name]?.value || 0), 0);
}
function updateWalkInSummary(form, tables) {
  const selectedTableId = form.elements.table.value;
  const selected = tables.find(entry => entry.table.id === selectedTableId);
  const setSummary = (name, value) => {
    const target = form.querySelector(`[data-walkin-summary-${name}]`);
    if (target) target.textContent = String(value);
  };
  const total = walkInGuestTotal(form);
  const seatingBadge = form.querySelector('.walk-in-seating-badge');
  if (seatingBadge) {
    const ready = Boolean(selected && selected.canSelect && selected.hasCapacity && total > 0);
    seatingBadge.classList.toggle('is-ready', ready);
    seatingBadge.lastChild.textContent = ready ? 'Ready to seat' : selected ? 'Check table' : 'Choose a table';
  }
  setSummary('adults', Number(form.elements.adults.value || 0));
  setSummary('seniors', Number(form.elements.seniorPwdCount.value || 0));
  setSummary('kids', Number(form.elements.children.value || 0));
  setSummary('total', total);
  setSummary('name', String(form.elements.name.value || '').trim() || form.dataset.generatedGuestName);
  setSummary('table', selected ? selected.table.id : 'Choose a table');
  setSummary('capacity', selected ? `${Number(selected.table.seats)} seats` : '—');
  setSummary('time', form.dataset.time);
  setSummary('meal', reservationMealPeriod(form.dataset.time));
  const feedback = form.querySelector('[data-walkin-capacity-feedback]');
  const message = form.querySelector('[data-walkin-table-message]');
  if (!selectedTableId) {
    if (feedback) {
      feedback.className = 'walk-in-capacity-feedback is-neutral';
      feedback.textContent = total ? 'Select an available table to check capacity.' : 'Enter the party size and select a table.';
    }
    if (message) message.textContent = tables.some(entry => entry.canSelect)
      ? 'Select a green Available table. Reserved or occupied tables cannot be assigned.'
      : 'No suitable table is currently available for this party and seating window.';
  } else if (!selected || !selected.canSelect || !selected.hasCapacity) {
    if (feedback) {
      feedback.className = 'walk-in-capacity-feedback is-warning';
      feedback.textContent = selected && !selected.hasCapacity
        ? `Table capacity exceeded: ${Number(selected.table.seats)} seats for ${total} guests.`
        : `Table ${selectedTableId} is no longer available. Choose another table.`;
    }
    if (message) message.textContent = 'The selected table is not suitable for this party.';
  } else {
    if (feedback) {
      feedback.className = 'walk-in-capacity-feedback is-success';
      feedback.textContent = `Table can accommodate this party of ${total}.`;
    }
    if (message) message.textContent = selected.futureReservation
      ? `Table is available now and reserved later at ${selected.futureReservation.time}.`
      : 'Table is ready for seating.';
  }
}
function walkInForm() {
  const now = new Date();
  const time = window.CostTrackLogic.formatReservationTime(now.getHours() * 60 + now.getMinutes());
  if (!window.CostTrackLogic.isReservationTimeWithinOpenHours(time)) {
    return toast('Walk-ins must start early enough to finish by closing. The latest seating time is 7:00 PM.', 'error');
  }
  const date = today();
  const available = walkInTableList(0, date, time);
  const counts = [
    ['Adults', 'adults'],
    ['Senior / PWD', 'seniorPwdCount'],
    ['Kids', 'children']
  ];
  const countFields = counts.map(([label, name]) =>
    `<label>${label}<input name="${name}" type="number" min="0" max="1000" step="1" value="0" required></label>`
  ).join('');
  const hasOpenShift = all('shifts').some(shift => shift.status === 'Open');
  const generatedName = `Walk-In Guest #${Math.floor(10000 + Math.random() * 90000)}`;
  modal('Record walk-in', `<div class="walk-in-layout"><section class="walk-in-entry"><div class="walk-in-section-heading"><div><p class="eyebrow">Quick seating</p><h3>Party details</h3></div><span class="walk-in-seating-badge"><i aria-hidden="true"></i>Ready to seat</span></div><div class="form-grid walk-in-count-grid">${countFields}</div><div class="form-grid walk-in-contact-grid"><label>Guest name <span class="field-help">(optional)</span><input name="name" maxlength="160" autocomplete="name" placeholder="Leave blank to create ${esc(generatedName)}"></label><label>Phone <span class="field-help">(optional)</span><input name="phone" type="tel" maxlength="40" autocomplete="tel"></label><label>Email <span class="field-help">(optional)</span><input name="email" type="email" maxlength="254" autocomplete="email"></label></div><div class="walk-in-table-section"><div class="walk-in-section-heading"><div><h3>Choose a table</h3><p class="field-help">Cards update as the guest count changes.</p></div><div class="walk-in-table-legend"><span class="is-available"><i></i>Available</span><span class="is-reserved"><i></i>Reserved soon</span><span class="is-occupied"><i></i>Occupied</span></div></div><div class="walk-in-table-grid" data-walkin-table-grid>${walkInTableCardsMarkup(available, '')}</div><p class="field-help walk-in-table-message" data-walkin-table-message aria-live="polite"></p></div><label class="walk-in-notes-field">Notes<textarea name="notes" rows="2"></textarea></label><div class="walk-in-billing-action"><button type="submit" class="primary-btn" data-walk-in-action="seat-and-open" disabled>Seat and open bill</button><small class="field-help">${hasOpenShift ? 'The bill opens with these same head counts and remains unpaid until you close it.' : 'An open cashier shift is required to create the bill. You can seat only, or open a shift and try again.'}</small></div></section><aside class="walk-in-summary" aria-label="Walk-in summary"><p class="eyebrow">Submission preview</p><h3>Walk-in summary</h3><dl><div><dt>Adults</dt><dd data-walkin-summary-adults>0</dd></div><div><dt>Seniors / PWD</dt><dd data-walkin-summary-seniors>0</dd></div><div><dt>Kids</dt><dd data-walkin-summary-kids>0</dd></div><div class="walk-in-summary-total"><dt>Total guests</dt><dd data-walkin-summary-total>0</dd></div><div><dt>Guest</dt><dd data-walkin-summary-name>${esc(generatedName)}</dd></div><div><dt>Selected table</dt><dd data-walkin-summary-table>Choose a table</dd></div><div><dt>Capacity</dt><dd data-walkin-summary-capacity>—</dd></div><div><dt>Meal period</dt><dd data-walkin-summary-meal>${esc(reservationMealPeriod(time))}</dd></div><div><dt>Seating time</dt><dd data-walkin-summary-time>${esc(time)}</dd></div></dl><p class="walk-in-capacity-feedback is-neutral" data-walkin-capacity-feedback aria-live="polite">Enter the party size and select a table.</p></aside></div><input type="hidden" name="table" value=""><input type="hidden" name="date" value="${esc(date)}"><input type="hidden" name="time" value="${esc(time)}">`, 'Seat only', 'walk-in-quick-modal');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'walk-in';
  form.dataset.walkInKey = id('WALKIN');
  form.dataset.date = date;
  form.dataset.time = time;
  form.dataset.generatedGuestName = generatedName;
  form.dataset.hasOpenShift = String(hasOpenShift);
  form.dataset.hasAvailableTable = String(available.some(entry => entry.canSelect));
  refreshWalkInTables(form);
  const submit = form.querySelector('.modal-submit');
  submit?.classList.replace('primary-btn', 'ghost-btn');
  const clockTimer = window.setInterval(() => {
    if (!form.isConnected) return window.clearInterval(clockTimer);
    refreshWalkInTimestamp(form);
  }, 15000);
}
function refreshWalkInTables(form) {
  if (!form?.elements?.table) return;
  const partySize = walkInGuestTotal(form);
  const tables = walkInTableList(partySize, form.dataset.date, form.dataset.time);
  const selected = form.elements.table.value;
  form.querySelector('[data-walkin-table-grid]').innerHTML = walkInTableCardsMarkup(tables, selected);
  const selectedState = tables.find(entry => entry.table.id === selected);
  const validSelection = Boolean(selected && partySize > 0 && selectedState?.canSelect && selectedState.hasCapacity);
  form.dataset.hasAvailableTable = String(tables.some(entry => entry.canSelect));
  form.dataset.hasValidSelection = String(validSelection);
  const submit = form.querySelector('.modal-submit');
  if (submit) submit.disabled = !validSelection;
  const seatAndOpen = form.querySelector('[data-walk-in-action="seat-and-open"]');
  if (seatAndOpen) seatAndOpen.disabled = !validSelection || form.dataset.hasOpenShift !== 'true';
  updateWalkInSummary(form, tables);
}
function refreshWalkInTimestamp(form) {
  const now = new Date();
  const date = today();
  const time = window.CostTrackLogic.formatReservationTime(now.getHours() * 60 + now.getMinutes());
  const changed = form.dataset.date !== date || form.dataset.time !== time;
  form.dataset.date = date;
  form.dataset.time = time;
  form.elements.date.value = date;
  form.elements.time.value = time;
  if (changed) refreshWalkInTables(form);
  else updateWalkInSummary(form, walkInTableList(walkInGuestTotal(form), date, time));
  return { now, date, time };
}
function rateForm(item = {}) {
  if (!canManageRates()) return toast('Only Administrator and Manager roles can manage buffet rates.', 'error');
  modal(item.id ? 'Edit buffet rate' : 'Add buffet rate', `<div class="form-grid"><label>Meal period<select name="mealPeriod"><option ${item.mealPeriod === 'All Day' ? 'selected' : ''}>All Day</option><option ${item.mealPeriod === 'Lunch' ? 'selected' : ''}>Lunch</option><option ${item.mealPeriod === 'Dinner' ? 'selected' : ''}>Dinner</option></select></label><label>Day type<select name="dayType"><option ${item.dayType === 'weekday' ? 'selected' : ''}>weekday</option><option ${item.dayType === 'weekend' ? 'selected' : ''}>weekend</option><option ${item.dayType === 'holiday' ? 'selected' : ''}>holiday</option></select></label><label>Adult rate<input name="adultRate" type="number" min="0" step=".01" value="${item.adultRate ?? ''}" required></label><label>Child rate<input name="childRate" type="number" min="0" step=".01" value="${item.childRate ?? ''}" required></label><label>Senior/PWD rate<input name="seniorPwdRate" type="number" min="0" step=".01" value="${item.seniorPwdRate ?? ''}" required></label><label>Effective from<input name="effectiveFrom" type="date" value="${item.effectiveFrom || today()}" required></label><label>Effective to<input name="effectiveTo" type="date" value="${item.effectiveTo || ''}"></label><label>Active<select name="isActive"><option value="true" ${item.isActive !== false ? 'selected' : ''}>Active</option><option value="false" ${item.isActive === false ? 'selected' : ''}>Inactive</option></select></label></div>`, item.id ? 'Save changes' : 'Add rate');
  document.querySelector('#modalForm').dataset.type = 'rate';
  document.querySelector('#modalForm').dataset.id = item.id || '';
}
function revenueAccessDenied() {
  return `${pageHeader('Restricted module', 'Access denied', 'Revenue and profitability data is limited to Administrator and Manager roles.', '')}<div class="panel empty-state"><span class="large-icon">!</span><h2>Revenue Tracking is restricted</h2><p>Your role does not have permission to view revenue, profit, or food cost information.</p></div>`;
}
function reportHasClosedBills(rows) {
  return rows.some(item =>
    Number(item.closed_bill_count || 0) > 0
    || Number(item.net_revenue ?? item.revenue ?? 0) > 0
  );
}
function dailyRevenueChart(rows) {
  return reportChartPanel(
    'reportRevenueChart',
    'Closed-bill revenue by day',
    'Net revenue grouped by Manila business date.',
    rows,
    'net_revenue',
    'period',
    'bar',
    'currency',
    !reportHasClosedBills(rows),
    'No closed bills in this range.'
  );
}
function revenuePage() {
  if (!canAccessRevenue()) return revenueAccessDenied();
  const data = revenueDashboardData || {};
  const loadingLabel = revenueDashboardError
    ? 'Unavailable'
    : revenueDashboardLoading || !revenueDashboardData ? 'Loading…' : null;
  const errorPanel = revenueDashboardError
    ? `<div class="panel error-state" role="alert">${esc(revenueDashboardError)} <button class="ghost-btn" data-action="retry-revenue-dashboard">Retry</button></div>`
    : '';
  return `${pageHeader('Revenue management', 'Management Revenue Dashboard', 'Today’s operating revenue snapshot from closed POS bills.', '<button class="ghost-btn" data-action="retry-revenue-dashboard">Refresh</button> <button class="primary-btn" data-view="reports">Open Reports & Analytics</button>')}
    ${errorPanel}
    <div class="metric-grid revenue-dashboard-kpis">
      ${metric("Today's Revenue", loadingLabel || money(data.today_revenue), '₱', 'green-icon', 'Closed bills · Manila business date')}
      ${metric('Closed Bills', loadingLabel || Number(data.closed_bill_count || 0).toLocaleString(), '▤', 'purple-icon', 'Today only')}
      ${metric('Average Check', loadingLabel || money(data.average_check), '↗', 'orange-icon', 'Net revenue per closed bill')}
      ${metric('Voided Amount', loadingLabel || money(data.voided_bill_amount), '!', 'red-icon', `${Number(data.voided_bill_count || 0).toLocaleString()} voided bills · excluded from revenue`)}
    </div>
    <div class="panel revenue-dashboard-guidance"><strong>Reporting workspace</strong><p>Use Reports & Analytics for date ranges, revenue trends, daily breakdowns, customer and shift analysis, and bill-level detail. This dashboard is a current-day summary, not a second reporting view.</p><button class="text-btn" data-view="reports">View detailed reports →</button></div>`;
}
function reservationsPage() {
  const reservations = all('reservations');
  const selectedDate = state.calendarDate || today();
  const unresolvedMode = state.reservationFilter === 'Unresolved';
  const newWebsiteMode = state.reservationFilter === 'New website';
  const unresolvedRows = state.unresolvedBookings.rows || [];
  const query = String(state.query || '').trim().toLowerCase();
  const filteredUnresolvedRows = unresolvedRows.filter(row =>
    (state.reservationTypeFilter === 'All' || row.type === state.reservationTypeFilter)
    && (!query || `${row.name || ''} ${row.table_id || ''} ${row.type || ''} ${row.reservation_id || ''}`.toLowerCase().includes(query))
  );
  const dateMatches = item => newWebsiteMode || (state.reservationDateFilter === 'Today' ? item.date === today() : state.reservationDateFilter === 'Upcoming' ? item.date >= today() : item.date === selectedDate);
  const sourceMatches = item => newWebsiteMode
    ? window.CostTrackLogic.isRecentWebsiteReservation(item)
    : state.reservationSourceFilter === 'All'
      || (state.reservationSourceFilter === 'Unspecified' ? !item.source : item.source === state.reservationSourceFilter);
  const baseItems = unresolvedMode ? [] : reservations.filter(dateMatches).filter(sourceMatches).filter(item => (state.reservationTypeFilter === 'All' || (item.type || 'Reservation') === state.reservationTypeFilter) && (!query || `${item.name || ''} ${item.email || ''} ${item.phone || ''}`.toLowerCase().includes(query)));
  const items = baseItems
    .filter(item => (newWebsiteMode || state.reservationFilter === 'All' || item.status === state.reservationFilter) && (state.reservationMealPeriodFilter === 'All' || reservationMealPeriod(item) === state.reservationMealPeriodFilter))
    .sort(newWebsiteMode
      ? (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      : (a, b) => a.date.localeCompare(b.date) || (parseTime12h(a.time) ?? Number.MAX_SAFE_INTEGER) - (parseTime12h(b.time) ?? Number.MAX_SAFE_INTEGER));
  const counts = status => status === 'Unresolved'
    ? unresolvedRows.length
    : status === 'All' ? baseItems.length : baseItems.filter(item => item.status === status).length;
  const statusFilters = ['All', 'Unresolved', 'Confirmed', 'Pending', 'Seated', 'Completed', 'No-show', 'Cancelled']
    .map(status => `<button type="button" class="${state.reservationFilterHighlightGroup === 'status' && state.reservationFilter === status ? 'active' : ''}" data-reservation-filter="${status}">${status} <b>${counts(status)}</b></button>`)
    .join('');
  const typeFilters = ['All', 'Reservation', 'Walk-in']
    .map(type => `<button type="button" class="${state.reservationFilterHighlightGroup === 'type' && state.reservationTypeFilter === type ? 'active' : ''}" data-reservation-type-filter="${type}">${type}</button>`)
    .join('');
  const sourceFilterOptions = [
    ['All', 'All sources'],
    ['Website', 'Website'],
    ['Phone', 'Phone'],
    ['Facebook', 'Facebook'],
    ['Walk-in', 'Walk-in'],
    ['Other', 'Other'],
    ['Unspecified', 'Not specified']
  ].map(([value, label]) => `<option value="${value}" ${state.reservationSourceFilter === value ? 'selected' : ''}>${label}</option>`).join('');
  const sourceFilter = unresolvedMode || newWebsiteMode ? '' : `<label class="reservation-source-filter ${state.reservationFilterHighlightGroup === 'source' ? 'is-filter-active' : ''}"><span>Source</span><select data-reservation-source-filter aria-label="Filter by reservation source">${sourceFilterOptions}</select></label>`;
  const hasActiveFilters = unresolvedMode
    ? state.reservationTypeFilter !== 'All' || Boolean(String(state.query || '').trim())
    : newWebsiteMode
      ? true
      : state.reservationFilter !== 'All'
        || state.reservationTypeFilter !== 'All'
        || state.reservationSourceFilter !== 'All'
        || state.reservationMealPeriodFilter !== 'All'
        || state.reservationDateFilter !== 'All'
        || Boolean(String(state.query || '').trim())
        || selectedDate !== today();
  const clearFiltersButton = hasActiveFilters
    ? '<button type="button" class="text-btn reservation-clear-filters" data-reservation-clear-filters>Clear filters</button>'
    : '';
  const dateControls = unresolvedMode || newWebsiteMode ? '' : `<label class="reservation-date-field ${state.reservationFilterHighlightGroup === 'date' && state.reservationDateFilter === 'All' ? 'is-filter-active' : ''}">Specific date<input type="date" value="${esc(selectedDate)}" data-reservation-list-date aria-label="Choose a specific reservation date"></label><div class="reservation-date-shortcuts" role="group" aria-label="Reservation date range"><button type="button" class="${state.reservationFilterHighlightGroup === 'date' && state.reservationDateFilter === 'Today' ? 'active' : ''}" data-reservation-date-filter="Today">Today</button><button type="button" class="${state.reservationFilterHighlightGroup === 'date' && state.reservationDateFilter === 'Upcoming' ? 'active' : ''}" data-reservation-date-filter="Upcoming">Upcoming</button></div>`;
  const mealPeriodFilter = unresolvedMode ? '' : `<label class="reservation-meal-filter ${state.reservationFilterHighlightGroup === 'meal' ? 'is-filter-active' : ''}">Meal period<select data-reservation-meal><option value="All" ${state.reservationMealPeriodFilter === 'All' ? 'selected' : ''}>All</option><option value="Lunch" ${state.reservationMealPeriodFilter === 'Lunch' ? 'selected' : ''}>Lunch</option><option value="Dinner" ${state.reservationMealPeriodFilter === 'Dinner' ? 'selected' : ''}>Dinner</option><option value="Other" ${state.reservationMealPeriodFilter === 'Other' ? 'selected' : ''}>Other</option></select></label>`;
  const unresolvedList = state.unresolvedBookings.loading
    ? '<div class="empty-table" role="status" aria-live="polite">Loading unresolved bookings…</div>'
    : state.unresolvedBookings.error
      ? ''
      : filteredUnresolvedRows.map(unresolvedBookingCard).join('')
        || '<div class="empty-table"><strong>No unresolved bookings</strong><small>Past bookings needing attention will appear here.</small></div>';
  const timeline = unresolvedMode ? unresolvedList : items.map(item => reservationCard(item, true)).join();
  const selectedCount = unresolvedMode ? filteredUnresolvedRows.length : items.length;
  const tableCards = all('restaurantTables')
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: 'base' }))
    .map(table => {
    const availability = liveTableAvailability(table, today(), reservations);
    const booking = availability.primaryBooking;
    const statusClass = availability.status === 'Available'
      ? 'status-good'
      : availability.status === 'Reserved Later' ? 'status-low' : 'status-out';
    const detail = booking
      ? booking.status === 'Seated'
        ? `${booking.name || (booking.type === 'Walk-in' ? 'Walk-in guest' : 'Guest')} · ${booking.date < today() ? `${reservationDateLabel(booking.date)} · ` : ''}${booking.time || 'Time not set'}`
        : `Reserved at ${booking.time || 'Time not set'}${booking.name ? ` · ${booking.name}` : ''}`
      : `${Number(table.seats)} seats`;
    const availabilityHint = availability.status === 'Reserved Later' && table.status !== 'Needs cleaning'
      ? '<small>A two-hour walk-in can finish before this reservation.</small>'
      : availability.status === 'Reserved Active'
        ? '<small>Protected: a new two-hour walk-in would overlap.</small>'
        : '';
    const unresolvedBooking = booking?.status === 'Seated'
      ? unresolvedRows.find(row => row.reservation_id === booking.id && row.table_id === table.id)
      : null;
    const pastSeatedBooking = booking?.status === 'Seated' && booking.date < today();
    const warning = availability.stayLimitReached
      ? '<small class="reservation-stay-warning">Two-hour limit reached — notify guest; table remains occupied.</small>'
      : '';
    const unresolvedLink = pastSeatedBooking
      ? `<small class="reservation-stay-warning">Past seated booking remains ${unresolvedBooking?.resolution_label === 'Payable' ? 'payable' : 'unresolved'}; a timer does not free the table.</small><button type="button" class="text-btn" data-action="show-unresolved-booking" data-id="${esc(booking.id)}">View unresolved booking</button>`
      : '';
    return `<div class="table-status-card"><strong>${esc(table.id)}</strong><span class="status ${statusClass}" data-table-availability="${availability.status}">${availability.status}</span><small>${esc(detail)}</small>${availabilityHint}${warning}${unresolvedLink}</div>`;
  }).join('');
  const listLabel = unresolvedMode ? 'Unresolved bookings' : newWebsiteMode ? 'New website reservations · last 24 hours' : state.reservationDateFilter === 'Upcoming' ? 'Upcoming reservations' : state.reservationDateFilter === 'Today' ? "Today's reservations" : reservationDateLabel(selectedDate);
  const unresolvedBadge = state.unresolvedBookings.loading
    ? '<span class="nav-badge" aria-live="polite">Unresolved · loading</span>'
    : `<span class="nav-badge" aria-live="polite">${unresolvedRows.length} unresolved</span>`;
  const newWebsiteReservations = reservations.filter(item => window.CostTrackLogic.isRecentWebsiteReservation(item));
  const newWebsiteFilter = `<button type="button" class="ghost-btn website-new-reservations-button" data-reservation-new-website-filter aria-pressed="${newWebsiteMode}" title="Pending website reservations submitted within the last 24 hours">New website <b>${newWebsiteReservations.length}</b></button>`;
  const timelineContent = unresolvedMode
    ? timeline
    : selectedCount
      ? timeline
      : newWebsiteMode
        ? '<div class="empty-table"><strong>No new website reservations</strong><small>Pending website requests submitted within the last 24 hours will appear here.</small></div>'
        : '<div class="empty-table"><strong>No reservations match these filters</strong><small>Choose another date or create a new reservation.</small></div>';
  const headerActions = `<span>${unresolvedBadge} ${newWebsiteFilter} <button type="button" class="ghost-btn" data-action="refresh-unresolved-bookings" ${state.unresolvedBookings.loading ? 'disabled' : ''}>Refresh unresolved</button> <button type="button" class="ghost-btn" data-action="open-walk-in">Record walk-in</button> <button type="button" class="primary-btn" data-action="open-reservation">+ New reservation</button></span>`;
  return `${pageHeader('Front of house', 'Reservations', 'Manage guest bookings, confirmations, arrivals, and table assignments.', headerActions)}<div class="panel table-status-panel"><div class="panel-header"><div><div class="panel-title">Live table status</div><div class="panel-subtitle">Derived from today’s reservation and walk-in records; updates after changes and every minute.</div></div></div><div class="table-status-grid">${tableCards}</div></div><section class="panel reservation-table-panel reservation-list-panel"><div class="reservation-table-heading"><div><div class="panel-title">${listLabel}</div><div class="panel-subtitle">${state.unresolvedBookings.error && unresolvedMode ? 'List unavailable until refreshed.' : `${selectedCount} ${unresolvedMode ? 'booking' : 'reservation'}${selectedCount === 1 ? '' : 's'}${unresolvedMode ? ' require attention' : ' scheduled'}`}</div></div><span class="date-selection-badge">${selectedCount}</span></div><div class="reservation-list-controls">${dateControls}<label class="reservation-search-field">Search<input id="tableSearch" type="search" value="${esc(state.query)}" placeholder="Guest, email, phone, table, or ID" aria-label="Search guests"></label>${clearFiltersButton}</div><div class="reservation-filter-bar"><div class="reservation-filter-group"><span class="reservation-filter-group-label">Status</span><div class="reservation-filters" role="group" aria-label="Filter by reservation status">${statusFilters}</div></div><div class="reservation-filter-group"><span class="reservation-filter-group-label">Type</span><div class="reservation-filters" role="group" aria-label="Filter by booking type">${typeFilters}</div></div>${sourceFilter}${mealPeriodFilter}</div><div class="reservation-timeline">${timelineContent}</div></section>`;
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
  }, { Available: 0, 'Reserved Later': 0, 'Reserved Active': 0, Occupied: 0, 'Needs cleaning': 0 });
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
    const statusMatches = statusFilter === 'All'
      || (statusFilter === 'Reserved' && availability.status.startsWith('Reserved '))
      || availability.status === statusFilter;
    return statusMatches
      && capacityMatches
      && (typeFilter === 'All' || tableType === typeFilter)
      && (areaFilter === 'All' || area === areaFilter)
      && (!query || `${table.id} ${tableType} ${area} ${bookingText}`.toLowerCase().includes(query));
  });
  const canManage = ['Administrator', 'Manager'].includes(state.role);
  const capacityOptions = ['All', 'Small', 'Medium', 'Large']
    .map(value => `<option value="${value}" ${capacityFilter === value ? 'selected' : ''}>${value === 'All' ? 'All capacities' : value === 'Small' ? '1–2 seats' : value === 'Medium' ? '3–4 seats' : '5+ seats'}</option>`).join('');
  const statusOptions = [['All', 'All statuses'], ['Available', 'Available'], ['Reserved', 'Reserved (all)'], ['Reserved Later', 'Reserved Later'], ['Reserved Active', 'Reserved Active'], ['Occupied', 'Occupied'], ['Needs cleaning', 'Needs cleaning']]
    .map(([value, label]) => `<option value="${value}" ${statusFilter === value ? 'selected' : ''}>${label}</option>`).join('');
  const typeOptions = ['All', 'Family', 'Casual', 'Unassigned']
    .map(value => `<option value="${value}" ${typeFilter === value ? 'selected' : ''}>${value === 'All' ? 'All table types' : value === 'Unassigned' ? 'Unclassified' : value}</option>`).join('');
  const areaOptions = ['All', 'Front', 'Back', 'Unassigned']
    .map(value => `<option value="${value}" ${areaFilter === value ? 'selected' : ''}>${value === 'All' ? 'All areas' : value === 'Unassigned' ? 'Area not set' : value}</option>`).join('');
  const renderCard = table => {
    const availability = availabilityByTable.get(table.id);
    const statusClass = availability.status === 'Available'
      ? 'status-good'
      : availability.status === 'Reserved Later' ? 'status-low' : 'status-out';
    const tableType = table.tableType || 'Unassigned';
    const area = table.area || 'Unassigned';
    const booking = availability.primaryBooking;
    const historyExists = reservations.some(item => item.table === table.id);
    const assignable = table.status !== 'Needs cleaning' && reservations.some(item =>
      item.date === date
      && !item.table
      && window.CostTrackLogic.isReservationTimeWithinOpenHours(item.time)
      && ['Pending', 'Confirmed'].includes(item.status)
      && Number(item.guests || 0) <= Number(table.seats)
      && !window.CostTrackLogic.tableHasReservationConflict(table.id, date, item.time, reservations, item.id, today())
    );
    const bookingEnd = booking ? window.CostTrackLogic.reservationEndTime(booking.time) : null;
    const bookingDate = booking?.date < date ? `${reservationDateLabel(booking.date)} · ` : '';
    const staleBooking = booking?.status === 'Seated' && booking.date < today();
    const staleResolution = staleBooking
      ? state.unresolvedBookings.rows.find(row => row.reservation_id === booking.id)
      : null;
    const staleBookingNotice = staleBooking
      ? `<small class="reservation-stay-warning">Past seated booking remains ${staleResolution?.resolution_label === 'Payable' ? 'payable' : 'unresolved'}; the two-hour timer does not free this table.</small>`
      : '';
    const bookingDetails = booking
      ? `<div class="table-booking-details"><strong>${esc(booking.name || (booking.type === 'Walk-in' ? 'Walk-in guest' : 'Guest'))}</strong><span>${esc(bookingDate)}${booking.status === 'Seated' ? '' : 'Reserved at '}${esc(booking.time || 'Time not set')}${bookingEnd ? `–${esc(bookingEnd)}` : ''} · ${Number(booking.guests || 0)} guest${Number(booking.guests || 0) === 1 ? '' : 's'}</span><button type="button" class="text-btn" data-action="edit-reservation" data-id="${esc(booking.id)}">Open booking</button>${staleBookingNotice}${availability.stayLimitReached ? '<small class="reservation-stay-warning" role="status">Two-hour limit reached — notify the guest. Keep this table occupied until they leave.</small>' : ''}${availability.bookingWindowEnded ? '<small class="reservation-stay-warning" role="status">The two-hour window passed. Confirm whether the guest arrived, or update the booking status.</small>' : ''}</div>`
      : '<small class="table-empty-detail">No active booking assigned for this date</small>';
    const additionalBookings = availability.bookings.length > (booking ? 1 : 0)
      ? `<small class="table-additional-bookings">+${availability.bookings.length - (booking ? 1 : 0)} more booking${availability.bookings.length - (booking ? 1 : 0) === 1 ? '' : 's'} on this date</small>`
      : '';
    const areaBadge = area !== 'Unassigned' ? `<span class="table-area-badge">${esc(area)}</span>` : '';
    const historyControl = staleBooking
      ? `<button type="button" class="ghost-btn compact-btn" data-action="show-unresolved-booking" data-id="${esc(booking.id)}">View unresolved booking</button>`
      : historyExists
        ? '<button type="button" class="ghost-btn compact-btn" disabled title="Tables linked to reservation history cannot be deleted">In use</button>'
        : `<button type="button" class="danger-btn compact-btn" data-action="delete-table" data-id="${esc(table.id)}">Delete</button>`;
    return `<article class="table-management-card"><div class="table-management-card-heading"><div><small>TABLE</small><h2>${esc(table.id)}</h2></div><span class="status ${statusClass}" data-table-availability="${availability.status}">${availability.status}</span></div><div class="table-card-tags"><span class="table-type-badge">${esc(tableType === 'Unassigned' ? 'Unclassified' : tableType)}</span>${areaBadge}</div><p class="table-capacity">${Number(table.seats)} seats</p>${bookingDetails}${additionalBookings}<div class="table-management-actions">${assignable ? `<button type="button" class="primary-btn compact-btn" data-action="assign-table" data-id="${esc(table.id)}">Assign booking</button>` : ''}${['Administrator', 'Manager', 'Receptionist'].includes(state.role) && table.status === 'Needs cleaning' && availability.status === 'Needs cleaning' ? `<button type="button" class="primary-btn compact-btn" data-action="mark-table-clean" data-id="${esc(table.id)}">Mark available</button>` : ''}${canManage ? `<button type="button" class="ghost-btn compact-btn" data-action="edit-table" data-id="${esc(table.id)}">Edit</button>` : ''}${staleBooking || canManage ? historyControl : ''}</div></article>`;
  };
  const cards = matchingTables.length
    ? `<div class="table-management-grid">${matchingTables.map(renderCard).join('')}</div>`
    : `<div class="empty-table"><strong>${tables.length ? 'No tables match these filters' : 'No tables have been added yet'}</strong><small>${tables.length ? 'Try another status, capacity, type, area, or search term.' : canManage ? 'Use “Set up restaurant layout” to create the requested 15 tables, or add tables individually.' : 'Ask a Manager or Administrator to add the restaurant tables.'}</small></div>`;
  const totalSeats = tables.reduce((sum, table) => sum + Number(table.seats || 0), 0);
  const layoutReady = layoutPlan.additions.length === 0 && layoutPlan.updates.length === 0 && layoutPlan.conflicts.length === 0;
  const headerActions = canManage
    ? `<span class="table-management-header-actions"><button type="button" class="ghost-btn" data-action="apply-table-layout" ${layoutReady ? 'disabled' : ''}>${layoutReady ? 'Layout configured' : 'Set up restaurant layout'}</button><button type="button" class="primary-btn" data-action="open-table-form">+ Add table</button></span>`
    : '';

  return `${pageHeader('Front of house', 'Table management', 'Manage the client’s seating layout and see availability derived from reservations and walk-ins.', headerActions)}<div class="table-management-summary"><div class="table-summary-card"><small>All tables</small><strong>${tables.length}</strong></div><div class="table-summary-card"><small>Total seats</small><strong>${totalSeats}</strong></div><div class="table-summary-card status-good"><small>Available</small><strong>${counts.Available}</strong></div><div class="table-summary-card status-low"><small>Reserved later</small><strong>${counts['Reserved Later']}</strong></div><div class="table-summary-card status-out"><small>Reserved active</small><strong>${counts['Reserved Active']}</strong></div><div class="table-summary-card status-out"><small>Occupied</small><strong>${counts.Occupied}</strong></div><div class="table-summary-card status-out"><small>Needs cleaning</small><strong>${counts['Needs cleaning']}</strong></div></div><section class="panel table-management-panel"><div class="table-management-toolbar"><label>Date<input type="date" min="${today()}" value="${esc(date)}" data-table-date></label><label>Status<select data-table-status>${statusOptions}</select></label><label>Capacity<select data-table-capacity>${capacityOptions}</select></label><label>Table type<select data-table-type>${typeOptions}</select></label><label>Area<select data-table-area>${areaOptions}</select></label><label class="table-management-search">Search<input id="tableManagementSearch" type="search" value="${esc(state.tableManagementQuery)}" placeholder="Table or guest" aria-label="Search tables or guests"></label></div><p class="table-management-note">Availability is derived from reservations and walk-ins. Reserved Later tables may be used only when a standard two-hour walk-in ends by the reservation time. Reserved Active tables are protected from new seating; a seated party remains Occupied until completion.</p>${cards}</section>`;
}
async function markTableAvailable(table, button) {
  if (!['Administrator', 'Manager', 'Receptionist'].includes(state.role)) {
    return toast('You do not have permission to update table cleaning status.', 'error');
  }
  if (table.status !== 'Needs cleaning') return toast('This table no longer needs cleaning.', 'error');
  if (state.role === 'Receptionist' && (!state.user || !supabaseSyncEnabled)) {
    return toast('Cloud data is not ready. Please wait for the initial load.', 'error');
  }
  if (state.role === 'Receptionist' && !navigator.onLine) {
    return toast('You are offline. Reconnect to save.', 'error');
  }
  const restoreButton = setButtonBusy(button, 'Saving…');
  if (!restoreButton) return;
  try {
    if (state.role === 'Receptionist') {
      const collections = ['restaurantTables'];
      setSyncState('syncing');
      rememberLocalChange('restaurantTables', table.id);
      const outcome = await window.CostTrackLogic.saveThenRefresh(async () => {
        await window.supabaseRecord.markTableAvailable(table.id);
        const updated = { ...table, status: 'Available' };
        upsertLocalRecord('restaurantTables', updated);
        invalidateUnresolvedBookings();
        setPostSaveSyncState();
        render();
        return updated;
      }, () => refreshSavedCollections(collections), error => showSaveRefreshWarning(collections, error));
      if (!outcome.saved) throw new Error('The table cleaning update did not complete.');
    } else {
      await save('restaurantTables', all('restaurantTables').map(item =>
        item.id === table.id ? { ...item, status: 'Available' } : item
      ));
    }
    toast(`${table.id} marked available.`);
  } catch (error) {
    console.error('Table cleaning status update failed.', error);
    if (state.role === 'Receptionist') {
      setSyncState(navigator.onLine ? 'error' : 'offline', error.message);
      render();
    }
    toast(friendlyRpcError(error), 'error');
  } finally {
    restoreButton();
  }
}
async function applyRestaurantTableLayout(button) {
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
  if (!await confirmInApp(`Apply the requested 15-table layout? This will update ${plan.updates.length} existing table${plan.updates.length === 1 ? '' : 's'}, change ${capacityChanges} existing capacity value${capacityChanges === 1 ? '' : 's'}, and add ${plan.additions.length} table${plan.additions.length === 1 ? '' : 's'}. Existing table IDs and reservation history will be preserved.${extraCount ? ` ${extraCount} extra legacy table${extraCount === 1 ? ' will' : 's will'} remain Unclassified.` : ''}`, {
    title: 'Apply table layout',
    confirmLabel: 'Apply layout'
  })) return;
  const restoreButton = setButtonBusy(button, 'Applying layout…');
  if (button && !restoreButton) return;
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
  } finally {
    restoreButton?.();
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
  return reservations.map(item => {
    const minutes = parseTime12h(item.time);
    const guests = Number(item.actualCovers || item.guests || reservationCategoryCount(item));
    const start = minutes === null
      ? item.date
      : `${item.date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
    const end = minutes === null || minutes + window.CostTrackLogic.MAX_TABLE_STAY_MINUTES >= 24 * 60
      ? undefined
      : `${item.date}T${String(Math.floor((minutes + window.CostTrackLogic.MAX_TABLE_STAY_MINUTES) / 60)).padStart(2, '0')}:${String((minutes + window.CostTrackLogic.MAX_TABLE_STAY_MINUTES) % 60).padStart(2, '0')}:00`;
    const presentation = window.CostTrackLogic.reservationCalendarStatusPresentation(item.status);
    const pastUnresolved = window.CostTrackLogic.isPastUnresolvedReservation(item.status, item.date, today());
    return {
      id: item.id,
      title: `${reservationDisplayName(item)} · ${guests} covers${item.table ? ` · ${item.table}` : ''}`,
      start,
      ...(end ? { end } : {}),
      allDay: minutes === null,
      classNames: [
        `reservation-event--${presentation.eventClass}`,
        ...(pastUnresolved ? ['reservation-event--past-unresolved'] : [])
      ],
      color: presentation.color,
      contrastColor: presentation.contrastColor,
      extendedProps: {
        reservationId: item.id,
        guestName: reservationDisplayName(item),
        coverCount: guests,
        table: item.table || '',
        statusLabel: item.status,
        pastUnresolved
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
    buttons: {
      dayGridMonth: { text: 'Month' },
      timeGridWeek: { text: 'Week' },
      timeGridDay: { text: 'Day' },
      listWeek: { text: 'Agenda' }
    },
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
      const status = document.createElement('span');
      status.className = 'reservation-event-status';
      status.textContent = info.event.extendedProps.statusLabel || 'Pending';
      content.appendChild(status);
      if (info.event.extendedProps.pastUnresolved) {
        const marker = document.createElement('span');
        marker.className = 'reservation-event-past-marker';
        marker.textContent = '!';
        marker.title = 'Past unresolved booking';
        marker.setAttribute('role', 'img');
        marker.setAttribute('aria-label', 'Past unresolved booking');
        content.appendChild(marker);
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
  const statusLegend = window.CostTrackLogic.reservationCalendarStatusLegend()
    .map(({ status, color, contrastColor }) => `<span><i class="calendar-status-dot" aria-hidden="true" style="background-color:${esc(color)};color:${esc(contrastColor)}"></i>${esc(status)}</span>`)
    .join('');
  return `${pageHeader('Front of house', 'Reservation calendar', 'Browse bookings by month, week, day, or agenda. Select a date to start a reservation, or select a booking to edit it.', '<span><button class="ghost-btn" data-action="open-walk-in">Record walk-in</button> <button class="primary-btn" data-action="open-reservation">+ New reservation</button></span>')}<div class="panel full-calendar-panel"><div class="full-calendar-filters"><label>Status<select data-reservation-calendar-filter="status">${statusOptions}</select></label><label>Type<select data-reservation-calendar-filter="type">${typeOptions}</select></label><label class="full-calendar-search">Search<input id="reservationCalendarSearch" type="search" value="${esc(state.reservationCalendarQuery)}" placeholder="Guest, email, phone, or table" aria-label="Search reservations"></label><div class="calendar-status-legend" aria-label="Reservation status legend">${statusLegend}<span class="calendar-status-legend-past"><i aria-hidden="true">!</i>Past unresolved</span></div></div><small class="full-calendar-note">Reservations have a two-hour window; the latest start is 7:00 PM so the stay ends by closing at 9:00 PM. Calendar events show the two-hour window, and timed views display 10:00 AM–9:00 PM.</small><div id="reservationFullCalendar" aria-label="Reservations calendar"></div></div>`;
}
function restoreModalSubmit(form, label) {
  if (form.dataset.type === 'walk-in') {
    restoreWalkInSubmit(form);
    return;
  }
  const submit = form.querySelector('.modal-submit');
  if (!submit) return;
  submit.disabled = false;
  submit.classList.remove('is-loading');
  submit.removeAttribute('aria-busy');
  submit.textContent = label;
}
function restoreWalkInSubmit(form) {
  const seatOnly = form.querySelector('.modal-submit');
  if (seatOnly) {
    seatOnly.disabled = form.dataset.hasValidSelection !== 'true';
    seatOnly.classList.remove('is-loading');
    seatOnly.removeAttribute('aria-busy');
    seatOnly.textContent = 'Seat only';
  }
  const seatAndOpen = form.querySelector('[data-walk-in-action="seat-and-open"]');
  if (seatAndOpen) {
    seatAndOpen.disabled = form.dataset.hasValidSelection !== 'true' || form.dataset.hasOpenShift !== 'true';
    seatAndOpen.classList.remove('is-loading');
    seatAndOpen.removeAttribute('aria-busy');
    seatAndOpen.textContent = 'Seat and open bill';
  }
}
async function seatAndOpenWalkIn(form) {
  const data = Object.fromEntries(new FormData(form));
  let counts;
  try {
    counts = window.CostTrackLogic.normalizeReservationGuestCounts(
      data.adults, data.seniorPwdCount, data.children
    );
    if (!data.table) throw new Error('Choose an available table.');
  } catch (error) {
    restoreWalkInSubmit(form);
    toast(error.message, 'error');
    return;
  }

  const now = new Date();
  const date = data.date || today();
  const time = data.time || window.CostTrackLogic.formatReservationTime(now.getHours() * 60 + now.getMinutes());
  const reservations = all('reservations');
  const occupiedBooking = reservations.find(item =>
    item.table === data.table && item.date <= date && item.status === 'Seated'
  );
  const conflictingBooking = window.CostTrackLogic.tableReservationConflict(
    data.table, date, time, reservations, '', today()
  );
  const blockingBooking = occupiedBooking || conflictingBooking;
  if (blockingBooking) {
    restoreWalkInSubmit(form);
    toast(walkInReservationWarning(data.table, blockingBooking), 'error');
    return;
  }
  try {
    const result = await window.supabaseRecord.posSeatAndOpenWalkIn({
      customerName: String(data.name || '').trim() || form.dataset.generatedGuestName,
      phone: String(data.phone || '').trim(),
      email: String(data.email || '').trim(),
      date,
      time,
      tableId: data.table,
      adultCount: counts.adults,
      seniorCount: counts.seniorPwdCount,
      kidsCount: counts.children,
      notes: String(data.notes || '').trim(),
      idempotencyKey: form.dataset.walkInKey
    });
    const reservation = window.supabaseRecord.mapRecord('reservations', result?.reservation);
    const bill = window.supabaseRecord.mapRecord('posBills', result?.bill);
    if (!reservation || !bill) {
      throw new Error('The server did not return the saved Walk-in reservation and bill. Reload the bill list before retrying.');
    }

    rememberLocalChange('reservations', reservation.id);
    upsertLocalRecord('reservations', reservation);
    rememberLocalChange('posBills', bill.id);
    upsertLocalRecord('posBills', bill);
    const lines = (result.lines || []).map(line => window.supabaseRecord.mapRecord('billLines', line));
    lines.forEach(line => rememberLocalChange('billLines', line.id));
    replaceLocalRelatedRecords('billLines', line => line.billId === bill.id, lines);
    state.modalDirty = false;
    closeModal(true);
    toast(`${bill.billNumber || 'Bill'} opened for ${reservation.name}. Payment is due after the meal.`);
    billForm(bill);
    void window.CostTrackLogic.saveThenRefresh(
      async () => true,
      () => refreshSavedCollections(['restaurantTables']),
      error => showSaveRefreshWarning(['restaurantTables'], error)
    );
  } catch (error) {
    console.error('Atomic Walk-in seat-and-bill failed.', error);
    restoreWalkInSubmit(form);
    toast(friendlyRpcError(error), 'error');
  }
}
async function handleSubmit(form, submitter = null) {
  if (form.dataset.type === 'walk-in') refreshWalkInTimestamp(form);
  const data = Object.fromEntries(new FormData(form));
  const type = form.dataset.type;
  const editId = form.dataset.id;
  if (type === 'product-lifecycle') {
    await submitProductLifecycle(form, data);
    return;
  }
  if (type === 'reservation' && form.dataset.reservationWizardStep) {
    const wizard = state.reservationWizard;
    const currentStep = Number(form.dataset.reservationWizardStep);
    if (!wizard || wizard.step !== currentStep) return toast('The reservation form changed. Review the current step and try again.', 'error');
    Object.assign(wizard.draft, data);
    if (currentStep === 1) {
      const existing = all('reservations').find(item => item.id === editId);
      const dateOrTimeChanged = !existing || data.date !== existing.date || data.time !== existing.time;
      if (dateOrTimeChanged && window.CostTrackLogic.reservationStartTimeIsInPast(data.date, data.time)) {
        return toast('That reservation time has already passed. Choose a later time.', 'error');
      }
      if (!window.CostTrackLogic.isReservationTimeWithinOpenHours(data.time)) {
        return toast('Choose a start time from 10:00 AM through 7:00 PM so the two-hour stay ends by closing at 9:00 PM.', 'error');
      }
    } else if (currentStep === 2 && wizard.draft.table) {
      const table = all('restaurantTables').find(entry => entry.id === wizard.draft.table);
      const partySize = Number(wizard.draft.adults || 0)
        + Number(wizard.draft.seniorPwdCount || 0)
        + Number(wizard.draft.children || 0);
      const selected = table && reservationTableState(table, {
        date: wizard.draft.date,
        time: wizard.draft.time,
        partySize,
        reservationId: wizard.draft.id,
        selectedTableId: wizard.draft.table
      });
      if (!selected || !selected.hasCapacity || !selected.canSelect) {
        return toast('Choose a table that is available and can accommodate this party, or leave the reservation unassigned.', 'error');
      }
    } else if (currentStep === 3) {
      const hasAnyPackageDetail = Boolean(
        wizard.draft.packageChargeItemId || wizard.draft.packageTierId || wizard.draft.packagePaxCount
      );
      if (hasAnyPackageDetail
        && (!wizard.draft.packageChargeItemId || !wizard.draft.packageTierId
          || !Number.isInteger(Number(wizard.draft.packagePaxCount))
          || Number(wizard.draft.packagePaxCount) < 1
          || Number(wizard.draft.packagePaxCount) > 1000)) {
        return toast('Choose a package and tier and enter a booked pax count between 1 and 1,000.', 'error');
      }
    }
    if (currentStep < 4) {
      wizard.step = currentStep + 1;
      renderReservationWizard();
      return;
    }
  }
  if (type === 'bill-wizard') {
    const wizard = state.billWizard;
    if (wizard.screen === 1) {
      if (!all('reservations').some(record => record.id === wizard.reservationId && record.status === 'Seated')) {
        return toast('Select a seated party to continue.', 'error');
      }
      wizard.screen = 2;
      renderBillWizard();
      return;
    }
    if (wizard.screen === 2) {
      wizard.screen = 3;
      renderBillWizard();
      return;
    }
    const reservation = all('reservations').find(record => record.id === wizard.reservationId);
    if (!reservation) return toast('The selected party is no longer available. Return to party selection and refresh.', 'error');
    if (wizard.screen === 3) {
      const countNames = ['adultCount', 'seniorCount', 'kidsCount', 'compedCount'];
      const counts = countNames.map(name => Number(wizard[name] || 0));
      if (!counts.every(count => Number.isInteger(count) && count >= 0)
        || counts.reduce((sum, count) => sum + count, 0) > 1000) {
        return toast('Enter whole-number head counts totaling no more than 1,000.', 'error');
      }
      if (counts.reduce((sum, count) => sum + count, 0) === 0) {
        return toast('Enter at least one guest or extra charge.', 'error');
      }
      const discountId = form.elements.discountId.value || null;
      const discountReason = form.elements.discountReason.value.trim();
      if (discountId && !discountReason) return toast('Enter a reason for the discount.', 'error');
      const extraLines = [...form.querySelectorAll('[data-extra-line]')].flatMap(line => {
        const chargeItemId = line.querySelector('[name="extraChargeItemId"]').value;
        if (!chargeItemId) return [];
        return [{
          line_id: line.querySelector('[name="extraLineId"]').value || null,
          charge_item_id: chargeItemId,
          quantity: Number(line.querySelector('[name="extraQuantity"]').value)
        }];
      });
      if (extraLines.some(line => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
        return toast('Each selected extra needs a quantity greater than zero.', 'error');
      }
      const mismatch = Number(wizard.adultCount) !== Number(reservation.adults || 0)
        || Number(wizard.seniorCount) !== Number(reservation.seniorPwdCount || 0)
        || Number(wizard.kidsCount) !== Number(reservation.children || 0);
      if (billWizardCountDifferences(wizard).length && !wizard.countsConfirmed) {
        return toast('Confirm the changed guest counts on Buffet and package before saving.', 'error');
      }
      wizard.discountId = discountId || '';
      wizard.discountReason = discountReason;
      wizard.chargeExtraPax = Boolean(form.elements.chargeExtraPax?.checked);
      wizard.notes = form.elements.notes.value.trim();
      const originalCounts = `Seating: ${Number(reservation.adults || 0)} adults, ${Number(reservation.seniorPwdCount || 0)} senior/PWD, ${Number(reservation.children || 0)} kids`;
      const mismatchNote = mismatch
        ? `Headcount changed from seating. ${originalCounts}. Bill: ${wizard.adultCount} adults, ${wizard.seniorCount} senior/PWD, ${wizard.kidsCount} kids, ${wizard.compedCount} comped.`
        : '';
      const baseNotes = String(wizard.notes || '').split('\n')
        .filter(line => !line.startsWith('Headcount changed from seating.')).join('\n').trim();
      const notes = [baseNotes, mismatchNote].filter(Boolean).join('\n');
      if (notes.length > 1000) {
        return toast('Shorten bill notes to leave room for the required headcount change record (1,000 characters maximum).', 'error');
      }
      try {
        const result = await window.supabaseRecord.posSaveBill({
          billId: wizard.billId || null,
          customerName: reservation.name || 'Walk-in guest',
          notes,
          reservationId: reservation.id,
          adultCount: Number(wizard.adultCount),
          seniorCount: Number(wizard.seniorCount),
          kidsCount: Number(wizard.kidsCount),
          compedCount: Number(wizard.compedCount),
          discountId,
          discountReason,
          extraLines,
          tableId: reservation.table || null,
          chargeExtraPax: wizard.chargeExtraPax,
          idempotencyKey: wizard.billId ? null : form.dataset.createKey
        });
        const savedBill = window.supabaseRecord.mapRecord('posBills', result?.bill);
        if (!savedBill) throw new Error('The bill was saved but the server did not return its updated details.');
        wizard.billId = savedBill.id;
        wizard.savedBill = savedBill;
        wizard.countBaseline = {
          adultCount: Number(savedBill.adultCount ?? wizard.adultCount),
          seniorCount: Number(savedBill.seniorCount ?? wizard.seniorCount),
          kidsCount: Number(savedBill.kidsCount ?? wizard.kidsCount),
          compedCount: Number(savedBill.compedCount ?? wizard.compedCount)
        };
        wizard.countsConfirmed = true;
        wizard.extraLines = extraLines;
        wizard.savedLines = (result.lines || []).map(line => window.supabaseRecord.mapRecord('billLines', line));
        rememberLocalChange('posBills', savedBill.id);
        upsertLocalRecord('posBills', savedBill);
        wizard.savedLines.forEach(line => rememberLocalChange('billLines', line.id));
        replaceLocalRelatedRecords('billLines', line => line.billId === savedBill.id, wizard.savedLines);
        wizard.screen = 4;
        state.modalDirty = false;
        await loadBillWizardReview();
      } catch (error) {
        console.error('Bill wizard draft save failed.', error);
        toast(friendlyRpcError(error), 'error');
      }
      return;
    }
    if (wizard.screen === 4) {
      const preview = wizard.closePreview;
      if (!preview) return toast('The server payment preview is unavailable. Retry the preview before payment.', 'error');
      if (!form.elements.tenderedAmount.value.trim()) {
        return toast('Enter the cash tendered amount.', 'error');
      }
      const tendered = Number(form.elements.tenderedAmount.value);
      const minimum = Number(preview.balance_after_deposit || 0);
      if (!Number.isFinite(tendered) || tendered < minimum) {
        return toast(`Cash tendered must be at least ${money(minimum)}.`, 'error');
      }
      if (!wizard.savedBill?.tableId && !reservation.table
        && !await confirmInApp('This bill has no table linked. Close it anyway?', {
          title: 'No table linked',
          confirmLabel: 'Confirm payment'
        })) return;
      wizard.tenderedAmount = tendered.toFixed(2);
      try {
        const result = await window.supabaseRecord.posCloseBill(
          wizard.billId, tendered, wizard.paymentKey
        );
        const closedBill = window.supabaseRecord.mapRecord('posBills', result?.bill);
        if (!closedBill) throw new Error('The bill was closed but the server did not return its updated details.');
        rememberLocalChange('posBills', closedBill.id);
        upsertLocalRecord('posBills', closedBill);
        const payment = window.supabaseRecord.mapRecord('billPayments', result?.payment);
        if (payment) {
          rememberLocalChange('billPayments', payment.id);
          upsertLocalRecord('billPayments', payment);
        }
        const relatedCollections = ['billPayments'];
        if (closedBill.reservationId) relatedCollections.push('reservations', 'reservationDeposits');
        if (closedBill.tableId) relatedCollections.push('restaurantTables');
        void window.CostTrackLogic.saveThenRefresh(
          async () => true,
          () => refreshSavedCollections(relatedCollections),
          error => showSaveRefreshWarning(relatedCollections, error)
        );
        state.modalDirty = false;
        closeModal(true);
        toast(`Bill closed. Change due: ${money(Number(result?.payment?.change_amount || 0))}.`);
        render();
        printBillingStatement(closedBill.id);
      } catch (error) {
        console.error('Bill wizard payment failed.', error);
        toast(friendlyRpcError(error), 'error');
      }
    }
    return;
  }
  if (type === 'reservation-confirmation') {
    await saveReservationConfirmation(form, data);
    return;
  }
  if (type === 'stale-booking-resolution') {
    await submitStaleBookingResolution(form, data);
    return;
  }
  if (type === 'walk-in' && submitter?.dataset.walkInAction === 'seat-and-open') {
    await seatAndOpenWalkIn(form);
    return;
  }
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
  if (type === 'count') {
    const stockItem = ingredient(data.ingredientId);
    if (!stockItem) return toast('Select an available ingredient before recording a count.', 'error');
    const expected = Number(form.elements.expected.value);
    const currentStock = Number(stockItem.stock);
    const actual = Number(data.actual);
    if (!Number.isFinite(expected) || expected !== currentStock) {
      return toast('Expected stock has changed. Select the ingredient again before recording the count.', 'error');
    }
    if (!Number.isFinite(actual) || actual < 0) {
      return toast('Enter a valid actual quantity of zero or more.', 'error');
    }
    const variance = actual - expected;
    if (variance !== 0) {
      const quantityLabel = value => `${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 4 }).format(value)} ${stockItem.unit}`;
      const direction = variance < 0 ? 'shortage' : 'overage';
      const confirmed = await confirmInApp(
        `Expected stock is ${quantityLabel(expected)} and the counted quantity is ${quantityLabel(actual)} (${direction} of ${quantityLabel(Math.abs(variance))}). Recording this count immediately adjusts system stock to the counted quantity.`,
        { title: 'Confirm count variance', confirmLabel: 'Record and adjust stock' }
      );
      if (!confirmed) return;
    }
    data.expected = expected;
  }
  if (['shift', 'shift-close', 'cash-movement', 'reservation-deposit', 'deposit-decision'].includes(type)) {
    try {
      let refreshAllData = true;
      if (type === 'shift') {
        await window.supabaseRecord.posOpenShift(Number(data.openingCash), String(data.notes || '').trim());
      } else if (type === 'shift-close') {
        const result = await window.supabaseRecord.posCloseShift(editId, Number(data.countedCash), String(data.notes || '').trim());
        if (result?.blocked) {
          const posCollections = ['posBills', 'billLines', 'billPayments', 'billApprovals', 'shifts', 'cashMovements', 'reservationDeposits', 'reservations', 'restaurantTables'];
          void window.CostTrackLogic.saveThenRefresh(
            async () => true,
            () => refreshPosCollections(),
            error => showSaveRefreshWarning(posCollections, error)
          );
          toast(result.message || 'Resolve open bills and approvals before closing the shift.', 'error');
          return;
        }
        const variance = Number(result.cash_variance || 0);
        successMessage = variance < 0
          ? `Shift closed. Shortage: ${money(Math.abs(variance))}.`
          : variance > 0 ? `Shift closed. Overage: ${money(variance)}.` : 'Shift closed with no variance.';
      } else if (type === 'cash-movement') {
        await window.supabaseRecord.posRecordCashMovement(
          editId, data.movementType, Number(data.amount), String(data.reason || '').trim(), form.dataset.movementKey
        );
        successMessage = 'Cash movement recorded.';
      } else if (type === 'reservation-deposit') {
        const result = await window.supabaseRecord.posRecordReservationDeposit(
          editId, Number(data.amount), String(data.notes || '').trim(), form.dataset.depositKey
        );
        const deposit = window.supabaseRecord.mapRecord('reservationDeposits', result?.deposit);
        if (deposit) rememberLocalChange('reservationDeposits', deposit.id);
        upsertLocalRecord('reservationDeposits', deposit);
        refreshAllData = false;
        successMessage = 'Cash deposit recorded as Held.';
      } else {
        const result = await window.supabaseRecord.posReservationDepositDecision(
          editId, form.dataset.decision, String(data.reason || '').trim()
        );
        const deposit = window.supabaseRecord.mapRecord('reservationDeposits', result?.deposit);
        if (deposit) rememberLocalChange('reservationDeposits', deposit.id);
        upsertLocalRecord('reservationDeposits', deposit);
        refreshAllData = false;
        const refundShift = form.dataset.decision === 'refund'
          ? all('shifts').find(shift => shift.status === 'Open')
          : null;
        if (refundShift) {
          void window.supabaseRecord.loadRelated('cashMovements', 'shiftId', refundShift.id)
            .then(movements => replaceLocalRelatedRecords('cashMovements', movement => movement.shiftId === refundShift.id, movements))
            .catch(refreshError => showSaveRefreshWarning(['cashMovements'], refreshError));
        }
        successMessage = form.dataset.decision === 'refund' ? 'Deposit refunded.' : 'Deposit forfeited.';
      }
      const posCollections = ['posBills', 'billLines', 'billPayments', 'billApprovals', 'shifts', 'cashMovements', 'reservationDeposits', 'reservations', 'restaurantTables'];
      if (refreshAllData) {
        void window.CostTrackLogic.saveThenRefresh(
          async () => true,
          () => refreshPosCollections(),
          error => showSaveRefreshWarning(posCollections, error)
        );
      } else {
        setPostSaveSyncState();
        void window.CostTrackLogic.saveThenRefresh(
          async () => true,
          () => refreshSavedCollections(['reservationDeposits']),
          error => showSaveRefreshWarning(['reservationDeposits'], error)
        );
      }
      state.modalDirty = false;
      closeModal(true);
      toast(successMessage);
      render();
    } catch (error) {
      console.error(`POS ${type} failed.`, error);
      const submit = form.querySelector('.modal-submit');
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        submit.removeAttribute('aria-busy');
        submit.textContent = type === 'shift' ? 'Open shift'
          : type === 'shift-close' ? 'Reconcile and close'
            : type === 'cash-movement' ? 'Record movement'
              : type === 'reservation-deposit' ? 'Record deposit'
                : form.dataset.decision === 'refund' ? 'Refund deposit' : 'Forfeit deposit';
      }
      toast(friendlyRpcError(error), 'error');
    }
    return;
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
        tableId: data.tableId || null,
        chargeExtraPax: Boolean(form.elements.chargeExtraPax?.checked),
        idempotencyKey: editId ? null : form.dataset.createKey
      });
      const savedBill = window.supabaseRecord.mapRecord('posBills', result?.bill);
      if (!savedBill) throw new Error('The bill was saved but the server did not return its updated details.');
      rememberLocalChange('posBills', savedBill.id);
      upsertLocalRecord('posBills', savedBill);
      const savedLines = (result.lines || []).map(line => window.supabaseRecord.mapRecord('billLines', line));
      savedLines.forEach(line => rememberLocalChange('billLines', line.id));
      replaceLocalRelatedRecords('billLines', line => line.billId === savedBill.id, savedLines);
      state.modalDirty = false;
      closeModal(true);
      toast(`${savedBill.billNumber || 'Bill'} saved. Subtotal ${money(savedBill.subtotal)} · Balance ${money(savedBill.balanceDue)}.`);
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
      const billBeforeClose = all('posBills').find(bill => bill.id === editId);
      rememberLocalChange('posBills', editId);
      if (billBeforeClose?.reservationId) rememberLocalChange('reservations', billBeforeClose.reservationId);
      if (billBeforeClose?.tableId) rememberLocalChange('restaurantTables', billBeforeClose.tableId);
      const result = await window.supabaseRecord.posCloseBill(
        editId,
        Number(data.tenderedAmount),
        form.dataset.paymentKey
      );
      const closedBill = window.supabaseRecord.mapRecord('posBills', result?.bill);
      if (!closedBill) throw new Error('The bill was closed but the server did not return its updated details.');
      rememberLocalChange('posBills', closedBill.id);
      upsertLocalRecord('posBills', closedBill);
      const payment = window.supabaseRecord.mapRecord('billPayments', result?.payment);
      if (payment) {
        rememberLocalChange('billPayments', payment.id);
        upsertLocalRecord('billPayments', payment);
      }
      const relatedCollections = ['billPayments'];
      if (closedBill.reservationId) relatedCollections.push('reservations', 'reservationDeposits');
      if (closedBill.tableId) relatedCollections.push('restaurantTables');
      void window.CostTrackLogic.saveThenRefresh(
        async () => true,
        () => refreshSavedCollections(relatedCollections),
        error => showSaveRefreshWarning(relatedCollections, error)
      );
      setPostSaveSyncState();
      state.modalDirty = false;
      closeModal(true);
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
      const result = await window.supabaseRecord.posRequestBillVoid(editId, data.voidReason.trim());
      const approval = window.supabaseRecord.mapRecord('billApprovals', result?.approval);
      const bill = window.supabaseRecord.mapRecord('posBills', result?.bill);
      if (approval) rememberLocalChange('billApprovals', approval.id);
      if (bill) rememberLocalChange('posBills', bill.id);
      upsertLocalRecord('billApprovals', approval);
      upsertLocalRecord('posBills', bill);
      setPostSaveSyncState();
      state.modalDirty = false;
      closeModal(true);
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
      const result = await window.supabaseRecord.posDecideBillApproval(editId, form.dataset.decision, data.decisionReason.trim());
      const approval = window.supabaseRecord.mapRecord('billApprovals', result?.approval);
      const bill = window.supabaseRecord.mapRecord('posBills', result?.bill);
      if (approval) rememberLocalChange('billApprovals', approval.id);
      if (bill) rememberLocalChange('posBills', bill.id);
      upsertLocalRecord('billApprovals', approval);
      upsertLocalRecord('posBills', bill);
      const relatedCollections = [];
      if (approval?.requestType === 'void' && approval.status === 'Approved' && bill) {
        if (bill.reservationId) relatedCollections.push('reservationDeposits');
        const refundShift = all('shifts').find(shift => shift.status === 'Open');
        if (refundShift) relatedCollections.push('cashMovements');
      }
      if (relatedCollections.length) {
        void window.CostTrackLogic.saveThenRefresh(
          async () => true,
          () => refreshSavedCollections(relatedCollections),
          error => showSaveRefreshWarning(relatedCollections, error)
        );
      }
      setPostSaveSyncState();
      state.modalDirty = false;
      closeModal(true);
      const approvalMessage = form.dataset.decision === 'approve' ? 'Approval recorded.' : 'Request rejected.';
      toast(approvalMessage);
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
    closeModal(true);
    toast(`Invoice ${payload.invoiceNumber} recorded. Stock and lot details were updated.`);
    render();
    return;
  }
  if (type === 'waste') {
    if (data.wasteType === 'prepared') {
      const record = {
        id: form.dataset.preparedWasteId || (form.dataset.preparedWasteId = id('PREP-WASTE')),
        dishName: data.dishName.trim(),
        productionBatchId: data.productionBatchId || null,
        quantity: Number(data.preparedQuantity),
        reason: data.preparedReason,
        date: data.preparedDate,
        notes: data.preparedNotes.trim()
      };
      try {
        await save('preparedFoodWasteLogs', [...all('preparedFoodWasteLogs'), record]);
        delete form.dataset.preparedWasteId;
        state.modalDirty = false;
        closeModal(true);
        toast('Prepared-food waste recorded. Ingredient inventory was not changed.');
        render();
      } catch (error) {
        console.error('Prepared-food waste entry could not be saved.', error);
        const submit = document.querySelector('#modalForm .modal-submit');
        if (submit) {
          submit.disabled = false;
          submit.classList.remove('is-loading');
          submit.removeAttribute('aria-busy');
          submit.textContent = 'Record waste';
        }
        toast(friendlyRpcError(error), 'error');
      }
      return;
    }
    const record = {
      id: form.dataset.wasteId || (form.dataset.wasteId = id('WASTE')),
      ingredientId: data.ingredientId,
      quantity: Number(data.quantity),
      reason: data.reason,
      recordedAt: form.dataset.serverTimestamp,
      notes: data.notes.trim(),
      productionLogId: data.productionLogId || null
    };
    try {
      await save('wasteLogs', [...all('wasteLogs'), record]);
      delete form.dataset.wasteId;
      state.modalDirty = false;
      closeModal(true);
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
      toast(friendlyRpcError(error), 'error');
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
  } else if (type === 'rate') {
    const record = { id: editId || id('RATE'), mealPeriod: data.mealPeriod, dayType: data.dayType, adultRate: Number(data.adultRate), childRate: Number(data.childRate), seniorPwdRate: Number(data.seniorPwdRate), effectiveFrom: data.effectiveFrom, effectiveTo: data.effectiveTo || null, isActive: data.isActive === 'true' };
    await save('buffetRates', editId ? all('buffetRates').map(item => item.id === editId ? { ...item, ...record } : item) : [record, ...all('buffetRates')]);
  } else if (type === 'walk-in') {
    let counts;
    try {
      counts = window.CostTrackLogic.normalizeReservationGuestCounts(
        data.adults,
        data.seniorPwdCount,
        data.children
      );
    } catch (error) {
      restoreModalSubmit(form, 'Record walk-in');
      return toast(error.message, 'error');
    }
    const now = new Date();
    const date = data.date || today();
    const time = data.time || window.CostTrackLogic.formatReservationTime(now.getHours() * 60 + now.getMinutes());
    const selectedTable = all('restaurantTables').find(table => table.id === data.table);
    if (!window.CostTrackLogic.isReservationTimeWithinOpenHours(time)) {
      restoreModalSubmit(form, 'Record walk-in');
      return toast('Walk-ins must start early enough to finish by closing. The latest seating time is 7:00 PM.', 'error');
    }
    if (!selectedTable || Number(selectedTable.seats) < counts.total) {
      restoreModalSubmit(form, 'Record walk-in');
      return toast('Choose an available table with enough seats for this party.', 'error');
    }
    const reservations = all('reservations');
    const occupiedBooking = reservations.find(item =>
      item.table === selectedTable.id && item.date <= date && item.status === 'Seated'
    );
    const conflictingBooking = window.CostTrackLogic.tableReservationConflict(
      selectedTable.id, date, time, reservations, '', today()
    );
    const blockingBooking = occupiedBooking || conflictingBooking;
    if (blockingBooking) {
      restoreModalSubmit(form, 'Record walk-in');
      return toast(walkInReservationWarning(selectedTable.id, blockingBooking), 'error');
    }
    const record = {
      id: id('RS'),
      name: String(data.name || '').trim() || form.dataset.generatedGuestName,
      email: String(data.email || '').trim(),
      phone: String(data.phone || '').trim(),
      date,
      time,
      mealPeriod: reservationMealPeriod({ time }),
      guests: counts.total,
      adults: counts.adults,
      seniorPwdCount: counts.seniorPwdCount,
      children: counts.children,
      type: 'Walk-in',
      source: 'Walk-in',
      status: 'Seated',
      seatedAt: now.toISOString(),
      actualCovers: counts.total,
      table: data.table,
      request: data.notes || '',
      preference: ''
    };
    try {
      await saveRecord('reservations', record);
    } catch (error) {
      restoreModalSubmit(form, 'Record walk-in');
      toast(friendlyRpcError(error), 'error');
      return;
    }
    void window.CostTrackLogic.saveThenRefresh(
      async () => true,
      () => refreshSavedCollections(['restaurantTables']),
      error => showSaveRefreshWarning(['restaurantTables'], error)
    );
  } else if (type === 'reservation') {
    const existing = editId ? all('reservations').find(item => item.id === editId) : null;
    if (editId && !existing) {
      restoreModalSubmit(form, 'Save changes');
      return toast('This reservation is no longer available. Reload the page and try again.', 'error');
    }
    const isPastReservation = Boolean(existing?.date && existing.date < today());
    const retryLabel = isPastReservation ? 'Save correction' : editId ? 'Save changes' : 'Create reservation';
    const restoreReservationSubmit = () => restoreModalSubmit(form, retryLabel);
    let record;
    if (isPastReservation) {
      if (!['Administrator', 'Manager'].includes(state.role)) {
        restoreReservationSubmit();
        return toast('Past reservations are view-only for your role.', 'error');
      }
      const correctionReason = String(data.correctionReason || '').trim();
      if (correctionReason.length < 10 || correctionReason.length > 500) {
        restoreReservationSubmit();
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
        restoreReservationSubmit();
        return toast('Change at least one guest detail or note before saving a correction.', 'error');
      }
      record = {
        ...existing,
        ...correctedFields,
        correctionReason
      };
      successMessage = 'Historical correction saved and recorded in the audit log.';
    } else {
      const reservationType = existing?.type || 'Reservation';
      const dateOrTimeChanged = !existing || data.date !== existing.date || data.time !== existing.time;
      if (reservationType !== 'Walk-in' && dateOrTimeChanged
        && window.CostTrackLogic.reservationStartTimeIsInPast(data.date, data.time)) {
        restoreReservationSubmit();
        return toast('That reservation time has already passed. Choose a later time.', 'error');
      }
      if (dateOrTimeChanged && !window.CostTrackLogic.isReservationTimeWithinOpenHours(data.time)) {
        restoreReservationSubmit();
        return toast('Choose a start time from 10:00 AM through 7:00 PM so the two-hour stay ends by closing at 9:00 PM.', 'error');
      }
      let counts;
      try {
        counts = window.CostTrackLogic.normalizeReservationGuestCounts(
          data.adults === undefined ? Number(data.guests || 0) : data.adults,
          data.seniorPwdCount || 0,
          data.children || 0
        );
      } catch (error) {
        restoreReservationSubmit();
        return toast(error.message, 'error');
      }
      const email = String(data.email || '').trim();
      const phone = String(data.phone || '').trim();
      if (reservationType !== 'Walk-in' && !email && !phone) {
        restoreReservationSubmit();
        return toast('Enter a phone number or email address for this reservation.', 'error');
      }
      const packageChargeItemId = data.packageChargeItemId === undefined
        ? String(existing?.packageChargeItemId || '')
        : String(data.packageChargeItemId || '');
      const packageTierId = data.packageTierId === undefined
        ? String(existing?.packageTierId || '')
        : String(data.packageTierId || '');
      const packagePaxValue = data.packagePaxCount === undefined
        ? existing?.packagePaxCount
        : data.packagePaxCount;
      const packagePaxCount = packagePaxValue === '' || packagePaxValue == null
        ? null
        : Number(packagePaxValue);
      if ((packageChargeItemId || packageTierId || packagePaxCount != null)
        && (!packageChargeItemId || !packageTierId || !Number.isInteger(packagePaxCount) || packagePaxCount < 1 || packagePaxCount > 1000)) {
        restoreReservationSubmit();
        return toast('Choose a package and tier and enter a booked pax count between 1 and 1,000.', 'error');
      }
      if (data.table) {
        const selectedTable = all('restaurantTables').find(table => table.id === data.table);
        if (!selectedTable) {
          restoreReservationSubmit();
          return toast('The selected table is no longer available. Reload and try again.', 'error');
        }
        if (Number(selectedTable.seats) < counts.total) {
          restoreReservationSubmit();
          return toast('Choose a table with enough seats for this party.', 'error');
        }
        if (window.CostTrackLogic.tableHasReservationConflict(data.table, data.date, data.time, all('reservations'), editId, today())) {
          restoreReservationSubmit();
          return toast('That table already has an overlapping two-hour booking.', 'error');
        }
      }
      record = {
        ...window.CostTrackLogic.buildReservationRecord(
          existing,
          data,
          editId || form.dataset.reservationId || (form.dataset.reservationId = id('RS'))
        ),
        name: String(data.name || '').trim() || (reservationType === 'Walk-in' ? 'Walk-in guest' : ''),
        email,
        phone,
        adults: counts.adults,
        seniorPwdCount: counts.seniorPwdCount,
        children: counts.children,
        guests: counts.total,
        source: data.source || '',
        packageChargeItemId,
        packageTierId,
        packagePaxCount,
        packageOverrideReason: data.packageOverrideReason === undefined
          ? String(existing?.packageOverrideReason || '')
          : String(data.packageOverrideReason || '').trim(),
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
  } else if (type === 'start-production') {
    if (!window.CostTrackLogic.canPerformInventoryAction(state.role, 'production.log')) {
      restoreModalSubmit(form, 'Start batch');
      return toast('You do not have permission to start production batches.', 'error');
    }
    const selectedRecipe = recipe(data.recipeId);
    if (!selectedRecipe || !window.CostTrackLogic.isRecipeActive(selectedRecipe)) {
      restoreModalSubmit(form, 'Start batch');
      return toast('This dish is no longer available for production.', 'error');
    }
    const yieldCount = Number(selectedRecipe.batchYield || 30);
    const portions = data.batchType === 'half'
      ? Math.max(1, Math.round(yieldCount / 2))
      : data.batchType === 'custom'
        ? Number(data.customPortions)
        : yieldCount;
    if (!Number.isInteger(portions) || portions < 1 || portions > 10000) {
      restoreModalSubmit(form, 'Start batch');
      return toast('Enter a whole number of portions between 1 and 10,000.', 'error');
    }
    if (!form.dataset.requestId) form.dataset.requestId = `BATCH-${window.crypto?.randomUUID?.() || id('QUEUE')}`;
    const submit = form.querySelector('.modal-submit');
    if (submit) setButtonBusy(submit, 'Starting batch…');
    try {
      await window.supabaseRecord.startProductionBatches(selectedRecipe.id, today(), [{
        id: form.dataset.requestId,
        portions
      }]);
      delete form.dataset.requestId;
      await loadProductionBoard(true);
      successMessage = `Batch started: ${portions} portions of ${selectedRecipe.name}.`;
    } catch (error) {
      console.error('Production batch start failed.', error);
      restoreModalSubmit(form, 'Start batch');
      toast(friendlyRpcError(error), 'error');
      return;
    }
  } else if (type === 'recipe') {
    const ingredients = state.recipeDraft.map(item => ({ ingredientId: item.ingredientId, quantity: Number(item.quantity) })).filter(item => item.ingredientId && item.quantity > 0);
    if (!ingredients.length) return toast('Add at least one inventory ingredient.', 'error');
    const record = {
      id: editId || id('rec'), name: data.name, category: data.category,
      wastage: Number(data.wastage),
      batchYield: Number(data.batchYield), prepTarget: Number(data.prepTarget),
      prepNotes: data.prepNotes.trim(), isActive: form.elements.isActive.checked, ingredients
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
      shelfLifeDays: data.shelfLifeDays ? Number(data.shelfLifeDays) : null,
      notes: data.notes.trim()
    };
    await save('ingredients', editId
      ? all('ingredients').map(item => item.id === editId ? { ...item, ...record } : item)
      : [...all('ingredients'), record]);
    successMessage = editId ? 'Product updated successfully.' : '';
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
  closeModal(true);
  if (successMessage) toast(successMessage);
  render();
}
async function transitionReservation(itemId, nextStatus, button = null) {
  const reservation = all('reservations').find(item => item.id === itemId);
  if (!reservation) return toast('Reservation not found.', 'error');
  if (nextStatus === 'Completed') {
    return toast('Reservations are completed automatically when their linked bill is closed and fully settled.', 'error');
  }
  if (reservation.date < today()) return toast('Past reservations are kept for history and cannot change status.', 'error');
  const valid = { Pending: ['Confirmed', 'Cancelled'], Confirmed: ['Seated', 'No-show', 'Cancelled'], Seated: ['Completed'] };
  if (!valid[reservation.status]?.includes(nextStatus)) return toast('That reservation status transition is not valid.', 'error');
  if (nextStatus === 'Confirmed') return openReservationConfirmation(reservation);
  if (nextStatus === 'Cancelled' && !await confirmInApp(`Cancel the reservation for ${reservation.name}?`, {
    title: 'Cancel reservation',
    confirmLabel: 'Cancel reservation'
  })) return;
  if (nextStatus === 'No-show' && !await confirmInApp(`Mark ${reservation.name} as a no-show?`, {
    title: 'Mark as no-show',
    confirmLabel: 'Mark no-show'
  })) return;
  let actualCovers = reservation.actualCovers;
  if (nextStatus === 'Seated') {
    const entered = prompt('How many actual covers were seated?', String(reservation.guests || 1));
    if (entered === null) return;
    actualCovers = Number(entered);
    if (!Number.isInteger(actualCovers) || actualCovers < 1) return toast('Actual covers must be a positive whole number.', 'error');
  }
  const updated = { ...reservation, status: nextStatus, actualCovers, seatedAt: nextStatus === 'Seated' ? new Date().toISOString() : reservation.seatedAt, completedAt: nextStatus === 'Completed' ? new Date().toISOString() : reservation.completedAt };
  const restoreButton = setButtonBusy(button, nextStatus === 'Seated' ? 'Seating guest…' : `Marking ${nextStatus.toLowerCase()}…`);
  if (button && !restoreButton) return;
  try {
    await saveRecord('reservations', updated);
    if (reservation.table) {
      void window.CostTrackLogic.saveThenRefresh(
        async () => true,
        () => refreshSavedCollections(['restaurantTables']),
        error => showSaveRefreshWarning(['restaurantTables'], error)
      );
    }
    toast(`Reservation marked ${nextStatus}.`);
    render();
  } catch (error) {
    toast(friendlyRpcError(error), 'error');
  } finally {
    restoreButton?.();
  }
}
function openReservationConfirmation(reservation) {
  const reservations = all('reservations');
  const tables = all('restaurantTables').slice().sort((left, right) =>
    left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: 'base' })
  );
  const partySize = Number(reservation.actualCovers || reservation.guests || 0);
  const eligibleTable = table => {
    const hasCapacity = Number(table.seats) >= partySize;
    const hasConflict = window.CostTrackLogic.tableHasReservationConflict(
      table.id, reservation.date, reservation.time, reservations, reservation.id, today()
    );
    return !hasConflict && hasCapacity && table.status !== 'Needs cleaning';
  };
  const defaultTable = tables.find(table => table.id === reservation.table && eligibleTable(table))
    || tables.find(eligibleTable);
  const tableId = defaultTable?.id || '';
  const tableOptions = reservationTableOptions({
    tableId,
    date: reservation.date,
    time: reservation.time,
    partySize,
    reservationId: reservation.id
  });
  const submitLabel = tableId ? 'Confirm & assign table' : 'Confirm without table';
  modal(
    'Confirm reservation',
    `<p class="form-intro">Confirm ${esc(reservationDisplayName(reservation))} for ${esc(reservation.date)} at ${esc(reservation.time)} (${partySize} guest${partySize === 1 ? '' : 's'}). Choose an available table, or leave it unassigned if needed.</p><label>Table<select name="table"><option value="" ${tableId ? '' : 'selected'}>Confirm without assigning a table</option>${tableOptions}</select><small class="field-help">Tables that are too small, need cleaning, or have an overlapping booking are unavailable.</small></label>`,
    submitLabel
  );
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'reservation-confirmation';
  form.dataset.id = reservation.id;
  form.elements.table.addEventListener('change', () => {
    const submit = form.querySelector('.modal-submit');
    if (submit) submit.textContent = form.elements.table.value ? 'Confirm & assign table' : 'Confirm without table';
  });
}
async function saveReservationConfirmation(form, data) {
  const reservation = all('reservations').find(item => item.id === form.dataset.id);
  const submitLabel = data.table ? 'Confirm & assign table' : 'Confirm without table';
  const restoreSubmit = () => restoreModalSubmit(form, submitLabel);
  if (!reservation || reservation.status !== 'Pending' || reservation.date < today()) {
    restoreSubmit();
    return toast('This reservation can no longer be confirmed. Reload and try again.', 'error');
  }

  const tableId = String(data.table || '');
  if (tableId) {
    const table = all('restaurantTables').find(item => item.id === tableId);
    const partySize = Number(reservation.actualCovers || reservation.guests || 0);
    if (!table || table.status === 'Needs cleaning') {
      restoreSubmit();
      return toast('That table is no longer available. Choose another table or confirm without one.', 'error');
    }
    if (Number(table.seats) < partySize) {
      restoreSubmit();
      return toast('That table does not have enough seats for this party.', 'error');
    }
    if (window.CostTrackLogic.tableHasReservationConflict(
      table.id, reservation.date, reservation.time, all('reservations'), reservation.id, today()
    )) {
      restoreSubmit();
      return toast('That table now has an overlapping reservation. Choose another table.', 'error');
    }
  }

  try {
    await saveRecord('reservations', {
      ...reservation,
      status: 'Confirmed',
      table: tableId
    });
  } catch (error) {
    restoreSubmit();
    toast(friendlyRpcError(error), 'error');
    return;
  }
  state.modalDirty = false;
  closeModal(true);
  toast(tableId ? `Reservation confirmed and assigned to ${tableId}.` : 'Reservation confirmed without a table.');
  render();
}
function staleBookingResolutionForm(reservationId) {
  const selectedReservationId = String(reservationId || '').trim();
  if (!selectedReservationId) {
    return toast('This booking is missing its reservation ID. Refresh the Unresolved list and try again.', 'error');
  }
  if (!['Administrator', 'Manager'].includes(state.role)) {
    return toast('Only Managers and Administrators can resolve stale bookings.', 'error');
  }
  const unresolved = state.unresolvedBookings.rows.find(row => row.reservation_id === selectedReservationId);
  if (!unresolved || unresolved.resolution_label === 'Payable') {
    return toast('This booking is payable or no longer eligible for resolution. Refresh the Unresolved list.', 'error');
  }
  if (!['Seated', 'Pending', 'Confirmed'].includes(unresolved.reservation_status)) {
    return toast('This booking is no longer eligible for resolution. Refresh the Unresolved list.', 'error');
  }
  const closeWithoutCharge = unresolved.reservation_status === 'Seated';
  const heldDepositTotal = Number(unresolved.held_deposit_total || 0);
  const hasOpenShift = all('shifts').some(shift => shift.status === 'Open');
  const outcomes = closeWithoutCharge
    ? '<option value="close_without_charge">Close without charge</option>'
    : '<option value="no_show">Mark no-show</option><option value="cancel">Mark Cancelled</option>';
  const noMealConfirmation = closeWithoutCharge
    ? '<label class="stale-no-meal-confirmation"><input type="checkbox" name="confirmNoMeal" required><span>I confirm no meal was served, or this is a test/error record.</span></label>'
    : '';
  const depositChoice = heldDepositTotal > 0
    ? `<section class="stale-deposit-resolution"><strong>Held deposit · ${money(heldDepositTotal)}</strong><label>Deposit action<select name="depositAction" required><option value="">Choose Refund or Forfeit</option><option value="refund">Refund</option><option value="forfeit">Forfeit</option></select></label><p class="field-help stale-refund-warning">Refund requires an open restaurant cashier shift. ${hasOpenShift ? 'The shared shift is ready.' : 'There is no open shift; the database will reject a refund until one is opened.'}</p><label>Deposit action reason<textarea name="depositReason" minlength="10" maxlength="500" rows="2" required placeholder="Explain why the held deposit is being refunded or forfeited."></textarea></label></section>`
    : '';
  const reservation = all('reservations').find(item => item.id === reservationId);
  modal(
    'Resolve past booking',
    `<input type="hidden" name="reservationId" value="${esc(selectedReservationId)}">
      <p class="panel-subtitle">${esc(reservation?.name || unresolved.name || 'Guest')} · ${esc(unresolved.type)} · ${esc(reservationDateLabel(unresolved.reservation_date))} · ${esc(unresolved.table_id || 'Unassigned')}</p>
      <div class="stale-resolution-warning"><strong>${closeWithoutCharge ? 'No bill, payment, or revenue will be created.' : 'This records the booking as a confirmed No-show or cancellation.'}</strong><span>${closeWithoutCharge ? 'Use Close without charge only when no meal was served or the booking is a test/error record. If a bill exists, continue through the cashier flow instead.' : 'This explicit resolution frees the table unless it already needs cleaning; a timer never frees a table.'}</span></div>
      <label>Outcome<select name="outcome" required>${outcomes}</select></label>
      ${noMealConfirmation}
      <label>Resolution reason<textarea name="reason" minlength="10" maxlength="500" rows="3" required placeholder="Record what was checked and why this booking is being resolved."></textarea><small class="field-help">Required; 10–500 characters. Saved with your identity and timestamp.</small></label>
      ${depositChoice}`,
    'Resolve booking',
    'stale-resolution-modal'
  );
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'stale-booking-resolution';
  form.dataset.reservationId = selectedReservationId;
  form.dataset.idempotencyKey = id('STALE');
  form.dataset.heldDepositTotal = String(heldDepositTotal);
}
async function submitStaleBookingResolution(form, data) {
  const restoreSubmit = () => restoreModalSubmit(form, 'Resolve booking');
  const reservationId = String(data.reservationId || form.dataset.reservationId || '').trim();
  if (!reservationId) {
    restoreSubmit();
    return toast('This dialog is missing its reservation ID. Close it, refresh the Unresolved list, and reopen the booking.', 'error');
  }
  const unresolved = state.unresolvedBookings.rows.find(row => row.reservation_id === reservationId);
  if (!['Administrator', 'Manager'].includes(state.role)) {
    restoreSubmit();
    return toast('Only Managers and Administrators can resolve stale bookings.', 'error');
  }
  if (!unresolved) {
    restoreSubmit();
    return toast('This booking is no longer on the Unresolved list. Refresh and try again.', 'error');
  }
  const reason = String(data.reason || '').trim();
  const depositReason = String(data.depositReason || '').trim();
  const heldDepositTotal = Number(form.dataset.heldDepositTotal || 0);
  const confirmNoMeal = form.elements.confirmNoMeal?.checked === true;
  if (reason.length < 10 || reason.length > 500) {
    restoreSubmit();
    return toast('Enter a resolution reason between 10 and 500 characters.', 'error');
  }
  if (unresolved.reservation_status === 'Seated' && !confirmNoMeal) {
    restoreSubmit();
    return toast('Confirm that no meal was served or this is a test/error record.', 'error');
  }
  if (heldDepositTotal > 0
    && (!['refund', 'forfeit'].includes(data.depositAction)
      || depositReason.length < 10
      || depositReason.length > 500)) {
    restoreSubmit();
    return toast('Choose Refund or Forfeit and enter a 10–500 character deposit reason.', 'error');
  }
  const expectedStatus = data.outcome === 'close_without_charge' ? 'Completed'
    : data.outcome === 'no_show' ? 'No-show'
      : data.outcome === 'cancel' ? 'Cancelled' : '';
  let result;
  try {
    result = await window.supabaseRecord.posResolveStaleBooking({
      reservationId,
      outcome: data.outcome,
      reason,
      confirmNoMeal,
      depositAction: heldDepositTotal > 0 ? data.depositAction : null,
      depositReason: heldDepositTotal > 0 ? depositReason : '',
      idempotencyKey: form.dataset.idempotencyKey
    });
    if (result?.status !== expectedStatus) {
      throw new Error('The database did not confirm the requested booking resolution.');
    }
  } catch (error) {
    restoreSubmit();
    console.error('Stale booking resolution failed.', error);
    toast(friendlyRpcError(error), 'error');
    return;
  }

  const refreshedCollections = ['reservations', 'restaurantTables', 'reservationDeposits', 'cashMovements'];
  const reservation = all('reservations').find(item => item.id === reservationId);
  if (reservation) upsertLocalRecord('reservations', { ...reservation, status: result.status });
  if (reservation?.table && result.table_status) {
    const table = all('restaurantTables').find(item => item.id === reservation.table);
    if (table) upsertLocalRecord('restaurantTables', { ...table, status: result.table_status });
  }
  state.modalDirty = false;
  closeModal(true);
  invalidateUnresolvedBookings();
  toast('Booking resolved. The table and any held deposit were updated atomically.');
  render();
  void window.CostTrackLogic.saveThenRefresh(
    async () => true,
    () => refreshSavedCollections(refreshedCollections),
    error => showSaveRefreshWarning(refreshedCollections, error)
  );
}
async function openUnresolvedBookingBill(reservationId) {
  let bill = all('posBills').find(item =>
    item.reservationId === reservationId && item.status === 'Open'
  );
  if (!bill && ['Administrator', 'Manager'].includes(state.role)) {
    try {
      await refetchCollection('posBills');
      bill = all('posBills').find(item =>
        item.reservationId === reservationId && item.status === 'Open'
      );
    } catch (error) {
      console.error('Open bill could not be refreshed from the cashier flow.', error);
      return toast(friendlyRpcError(error), 'error');
    }
  }
  if (!bill) {
    return toast('The bill is not available in your cashier access. Ask a Manager or Administrator to open it.', 'error');
  }
  billForm(bill);
}
function chargeItemForm(item = {}) {
  const value = key => item?.[key] ?? '';
  const content = `<div class="form-grid"><label>Charge code<input name="code" value="${esc(value('code'))}" required></label><label>Charge name<input name="name" value="${esc(value('name'))}" required></label><label>Type<select name="type"><option value="food" ${value('type') === 'food' ? 'selected' : ''}>Food</option><option value="non_food" ${value('type') === 'non_food' ? 'selected' : ''}>Non-food</option><option value="service_charge" ${value('type') === 'service_charge' ? 'selected' : ''}>Service charge</option><option value="package" ${value('type') === 'package' ? 'selected' : ''}>Package</option><option value="deposit" ${value('type') === 'deposit' ? 'selected' : ''}>Deposit</option><option value="discount" ${value('type') === 'discount' ? 'selected' : ''}>Discount</option><option value="other" ${value('type') === 'other' || !value('type') ? 'selected' : ''}>Other</option></select></label><label>Category<input name="category" value="${esc(value('category') || 'General')}" required></label><label>Unit price<input name="unitPrice" type="number" min="0" step="0.01" value="${Number(value('unitPrice') || 0).toFixed(2)}" required></label><label>Default qty<input name="defaultQuantity" type="number" min="0.01" step="0.01" value="${Number(value('defaultQuantity') || 1).toFixed(2)}" required></label><label>Active<input name="isActive" type="checkbox" ${value('isActive') === false ? '' : 'checked'}></label><label>Food revenue<input name="isFoodRevenue" type="checkbox" ${value('isFoodRevenue') === false ? '' : 'checked'}></label><label>Package<input name="isPackage" type="checkbox" ${value('isPackage') ? 'checked' : ''}></label><label>Approval needed<input name="requiresApproval" type="checkbox" ${value('requiresApproval') ? 'checked' : ''}></label><label class="full">Notes<textarea name="notes" rows="3">${esc(value('notes'))}</textarea></label></div>`;
  modal(item.id ? 'Edit charge item' : 'Create charge item', content, item.id ? 'Save charge' : 'Create charge');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'charge-item';
  form.querySelectorAll('.form-grid > label > input[type="checkbox"]').forEach(input => {
    input.closest('label').classList.add('checkbox-field');
  });
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
    <label>Quantity<div class="pos-extra-quantity"><button type="button" data-extra-quantity-adjust="-1" aria-label="Decrease quantity" ${disabled ? 'disabled' : ''}>−</button><input name="extraQuantity" type="number" min="0.01" max="10000" step="0.01" value="${Number(line.quantity || 1)}" aria-label="Extra quantity" ${disabled ? 'disabled' : ''}><button type="button" data-extra-quantity-adjust="1" aria-label="Increase quantity" ${disabled ? 'disabled' : ''}>+</button></div></label>
    ${line.id ? `<span class="field-help">Saved price: ${money(line.unitPrice)} each. Editing quantity keeps this price snapshot.</span>` : ''}
    ${disabled ? '' : '<button type="button" class="pos-extra-remove" data-action="remove-bill-extra" aria-label="Remove extra">× <span>Remove</span></button>'}
  </div>`;
}
function updateBillHeadcountWarning(form) {
  const notice = form?.querySelector('[data-bill-headcount-warning]');
  if (!notice) return false;
  const reservationId = form.elements.reservationId?.value || '';
  const reservation = all('reservations').find(item => item.id === reservationId);
  if (!reservation) {
    notice.classList.add('is-hidden');
    notice.textContent = '';
    return false;
  }
  const categories = [
    ['adults', 'Adults', Number(reservation.adults ?? reservation.guests ?? 0)],
    ['seniorCount', 'Senior / PWD', Number(reservation.seniorPwdCount || 0)],
    ['kidsCount', 'Kids', Number(reservation.children || 0)]
  ];
  const details = categories.map(([field, label, reservationCount]) => ({
    label,
    reservationCount,
    billCount: Number(form.elements[field]?.value || 0)
  }));
  const mismatch = details.some(item => item.reservationCount !== item.billCount);
  notice.classList.remove('is-hidden');
  notice.classList.toggle('is-warning', mismatch);
  notice.textContent = `Reservation: ${details.map(item => `${item.label} ${item.reservationCount}`).join(', ')} · Bill: ${details.map(item => `${item.label} ${item.billCount}`).join(', ')}${mismatch ? ' — counts differ; confirm before saving.' : ' — counts match.'}`;
  return mismatch;
}
function billForm(item = {}) {
  const editing = Boolean(item.id);
  if (editing && state.role === 'Receptionist' && item.createdBy !== state.user?.id) {
    return toast('Receptionists can only view bills they created.', 'error');
  }
  if (!editing && !all('shifts').some(shift => shift.status === 'Open')) {
    return toast('Open the restaurant cashier shift before creating a bill.', 'error');
  }
  const reservation = item.reservationId
    ? all('reservations').find(record => record.id === item.reservationId)
    : null;
  state.billWizard.screen = item.reservationId || reservation ? 2 : 1;
  state.billWizard.reservationId = item.reservationId || reservation?.id || '';
  state.billWizard.billId = item.id || '';
  state.billWizard.adultCount = Number(item.adultCount ?? reservation?.adults ?? 0);
  state.billWizard.seniorCount = Number(item.seniorCount ?? reservation?.seniorPwdCount ?? 0);
  state.billWizard.kidsCount = Number(item.kidsCount ?? reservation?.children ?? 0);
  state.billWizard.compedCount = Number(item.compedCount ?? reservation?.compedCount ?? 0);
  state.billWizard.countBaseline = billWizardCountValues(item.id ? item : reservation || {});
  state.billWizard.extraLines = item.id
    ? all('billLines').filter(line => line.billId === item.id && line.lineType === 'charge_item' && !line.isVoided)
    : [];
  state.billWizard.discountId = item.discountId || '';
  state.billWizard.discountReason = item.discountReason || '';
  state.billWizard.chargeExtraPax = item.id
    ? all('billLines').some(line => line.billId === item.id && line.lineType === 'package' && /^Extra pax/.test(line.description || ''))
    : false;
  state.billWizard.notes = item.notes || '';
  state.billWizard.savedBill = item.id ? item : null;
  state.billWizard.savedLines = item.id ? all('billLines').filter(line => line.billId === item.id) : [];
  state.billWizard.closePreview = null;
  state.billWizard.previewError = '';
  state.billWizard.tenderedAmount = '';
  state.billWizard.paymentKey = id('POSPAY');
  state.billWizard.createKey = item.id ? '' : id('POSCREATE');
  state.billWizard.pendingApproval = false;
  state.billWizard.countsEditing = false;
  state.billWizard.countsConfirmed = Boolean(item.id);
  renderBillWizard();
}
function renderBillWizard() {
  const wizard = state.billWizard;
  if (!wizard.reservationId) wizard.screen = 1;
  const steps = ['Party', 'Buffet and package', 'Extras and discounts', 'Review and pay'];
  const progress = `<ol class="pos-wizard-progress" aria-label="Create bill progress">${steps.map((label, index) => {
    const number = index + 1;
    const status = number === wizard.screen ? 'is-active' : number < wizard.screen ? 'is-complete' : '';
    const marker = number < wizard.screen
      ? `<button type="button" class="pos-wizard-step-button" data-action="bill-wizard-step" data-step="${number}" aria-label="Return to step ${number}: ${esc(label)}"><span aria-hidden="true">✓</span><span>${esc(label)}</span></button>`
      : `<span class="pos-wizard-step-marker">${number}</span><span class="pos-wizard-step-label">${esc(label)}</span>`;
    return `<li class="${status}" ${number === wizard.screen ? 'aria-current="step"' : ''}>${marker}</li>`;
  }).join('')}</ol>`;
  const content = wizard.screen === 1 ? renderBillPartyScreen()
    : wizard.screen === 2 ? renderBillBuffetScreen()
      : wizard.screen === 3 ? renderBillExtrasScreen()
        : renderBillReviewScreen();
  const submitLabel = wizard.screen <= 2 ? 'Continue'
      : wizard.screen === 3 ? 'Review and pay' : 'Confirm payment';
  modal('Create bill', `${progress}${content}`, submitLabel, 'pos-wizard-modal', 'form');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'bill-wizard';
  form.dataset.screen = String(wizard.screen);
  form.dataset.createKey = wizard.createKey || (wizard.createKey = id('POSCREATE'));
  if (wizard.billId) form.dataset.billId = wizard.billId;
  if (wizard.reservationId) form.dataset.reservationId = wizard.reservationId;
  const submit = form.querySelector('.modal-submit');
  if (wizard.screen === 1 && submit) submit.disabled = !wizard.reservationId;
  if (wizard.screen === 4) {
    const due = Number(wizard.closePreview?.balance_after_deposit || 0);
    updateBillCashChangePreview(
      form.querySelector('[data-cash-change-preview]'),
      wizard.tenderedAmount || due.toFixed(2),
      due
    );
    const rightActions = form.querySelector('.pos-wizard-footer-right');
    rightActions?.insertAdjacentHTML('afterbegin', '<button type="button" class="ghost-btn" data-action="bill-wizard-save-open">Save and leave open</button>');
  }
  if (wizard.screen === 1) {
    const focusTarget = wizard.focusAfterRender === 'continue'
      ? submit : form.querySelector('[data-party-search]');
    requestAnimationFrame(() => {
      if (focusTarget?.isConnected) focusTarget.focus();
      wizard.focusAfterRender = '';
    });
  }
}
function captureBillWizardForm(form) {
  if (!form || form.dataset.screen !== '3') return;
  state.billWizard.extraLines = [...form.querySelectorAll('[data-extra-line]')].flatMap(line => {
    const chargeItemId = line.querySelector('[name="extraChargeItemId"]').value;
    if (!chargeItemId) return [];
    return [{
      id: line.querySelector('[name="extraLineId"]').value || '',
      chargeItemId,
      quantity: Number(line.querySelector('[name="extraQuantity"]').value || 1)
    }];
  });
  state.billWizard.discountId = form.elements.discountId.value || '';
  state.billWizard.discountReason = form.elements.discountReason.value;
  state.billWizard.chargeExtraPax = Boolean(form.elements.chargeExtraPax?.checked);
  state.billWizard.notes = form.elements.notes.value;
}
function billWizardCountChips(counts) {
  const groups = [
    [counts.adultCount, 'adult', 'adults'],
    [counts.seniorCount, 'senior/PWD', 'senior/PWD'],
    [counts.kidsCount, 'kid', 'kids'],
    [counts.compedCount, 'comped', 'comped']
  ];
  return groups.filter(([count]) => Number(count || 0) > 0)
    .map(([count, singular, plural]) => `<span class="pos-guest-chip">${Number(count)} ${Number(count) === 1 ? singular : plural}</span>`)
    .join('');
}
function billWizardCountValues(source = {}) {
  return {
    adultCount: Number(source?.adultCount ?? source?.adults ?? 0),
    seniorCount: Number(source?.seniorCount ?? source?.seniorPwdCount ?? 0),
    kidsCount: Number(source?.kidsCount ?? source?.children ?? 0),
    compedCount: Number(source?.compedCount ?? 0)
  };
}
function billWizardCountDifferences(wizard) {
  const baseline = wizard.countBaseline || {};
  return [
    ['adultCount', 'adults'],
    ['seniorCount', 'senior/PWD'],
    ['kidsCount', 'kids'],
    ['compedCount', 'comped']
  ].flatMap(([field, label]) => {
    const from = Number(baseline[field] || 0);
    const to = Number(wizard[field] || 0);
    return from === to ? [] : [{ field, label, from, to }];
  });
}
function billWizardGuestSummary(reservation, { showEditCounts = true, heldDeposit = 0 } = {}) {
  const wizard = state.billWizard;
  return `<aside class="pos-guest-summary" aria-label="Selected party guest summary">
    <div class="pos-guest-summary-main"><strong>${esc(reservation.name || 'Walk-in guest')}</strong><div class="pos-guest-chips" data-wizard-guest-total role="status" aria-live="polite">${billWizardCountChips(wizard)}</div></div>
    <div class="pos-guest-summary-chips"><span class="pos-table-chip">Table ${esc(reservation.table || 'None linked')}</span>${heldDeposit > 0 ? `<span class="pos-deposit-chip">Deposit held: ${money(heldDeposit)}</span>` : ''}</div>
    ${showEditCounts ? '<button type="button" class="ghost-btn compact-btn" data-action="edit-wizard-counts">Edit counts</button>' : ''}
  </aside>`;
}
function billWizardExtraLinesMarkup() {
  const wizard = state.billWizard;
  const savedExtras = wizard.extraLines;
  return `<div class="pos-extra-lines">${(savedExtras.length ? savedExtras : [{}]).map(line => billExtraLineMarkup(line)).join('')}</div>`;
}
function renderBillExtrasScreen() {
  const reservation = all('reservations').find(record => record.id === state.billWizard.reservationId);
  if (!reservation) return '<div class="pos-wizard-empty"><strong>Party unavailable.</strong><p>Return to party selection.</p></div>';
  const wizard = state.billWizard;
  const leftover = all('chargeItems').find(item => item.code === 'LEFTOVER' && item.isActive !== false
    && ['food', 'non_food', 'other'].includes(item.type) && !item.isPackage);
  const discounts = all('discounts').filter(discount =>
    (discount.isActive !== false && (discount.appliesTo || 'bill') === 'bill')
      || discount.id === wizard.discountId
  );
  const discountOptions = [
    ['percent', 'Percentage discounts'],
    ['fixed', 'Fixed amount discounts'],
    ['waive', 'Full-bill waivers']
  ].map(([type, label]) => {
    const options = discounts.filter(discount => discount.discountType === type);
    if (!options.length) return '';
    return `<optgroup label="${label}">${options.map(discount => {
      const value = type === 'percent' ? `${Number(discount.value || 0)}%`
        : type === 'fixed' ? money(discount.value || 0) : 'Full bill';
      return `<option value="${esc(discount.id)}" ${wizard.discountId === discount.id ? 'selected' : ''}>${esc(discount.name)} · ${value}</option>`;
    }).join('')}</optgroup>`;
  }).join('');
  const extraPaxRate = Number(all('posSettings').find(setting => setting.key === 'pos_extra_pax_rate')?.value || 0);
  const seatedCovers = Number(reservation.actualCovers || reservation.guests || 0);
  const extraPax = Math.max(0, seatedCovers - Number(reservation.packagePaxCount || 0));
  const packageExtra = reservation.packageChargeItemId && extraPax > 0
    ? `<label class="pos-extra-pax-choice"><input type="checkbox" name="chargeExtraPax" ${wizard.chargeExtraPax ? 'checked' : ''}> Add ${extraPax} extra pax${extraPaxRate > 0 ? ` at ${money(extraPaxRate)} each` : ''}<small class="field-help">${extraPaxRate > 0 ? 'Optional charge; the server calculates the amount.' : 'No extra-pax rate is configured. Continue without a charge or ask an Administrator to set one.'}</small></label>`
    : '';
  return `<div class="pos-wizard-screen pos-wizard-screen-three" data-pos-wizard-screen="3">
    ${billWizardGuestSummary(reservation)}
    <fieldset class="product-form-section"><legend>Extras</legend><p class="field-help">Choose catalog items. Prices and totals are calculated by the server; inventory is unchanged.</p>
      ${billWizardExtraLinesMarkup()}
      <div class="pos-extra-actions"><button type="button" class="ghost-btn compact-btn" data-action="add-bill-extra">+ Add extra</button>${leftover ? `<button type="button" class="ghost-btn compact-btn" data-action="add-leftover-charge" data-charge-id="${esc(leftover.id)}">Add Leftover charge</button>` : '<span class="field-help">No active Leftover charge is configured.</span>'}</div>
      ${packageExtra}
    </fieldset>
    <fieldset class="product-form-section"><legend>Discount</legend>
      <div class="pos-discount-grid">
        <label>Discount<select name="discountId" aria-describedby="bill-discount-help"><option value="">No discount</option>${discountOptions}</select></label>
        <label>Reason (required when a discount is selected)<textarea name="discountReason" rows="3" maxlength="500">${esc(wizard.discountReason)}</textarea></label>
        <small id="bill-discount-help" class="field-help">100% discounts and voids require Manager or Administrator approval exactly as before.</small>
      </div>
    </fieldset>
    <label class="pos-wizard-notes-field">Bill notes<textarea name="notes" rows="3" maxlength="1000">${esc(wizard.notes)}</textarea></label>
  </div>`;
}
function renderBillReviewScreen() {
  const wizard = state.billWizard;
  const bill = wizard.savedBill;
  const reservation = all('reservations').find(record => record.id === wizard.reservationId);
  if (!bill || !reservation) {
    return `<div class="pos-wizard-screen pos-wizard-review" data-pos-wizard-screen="4"><div class="pos-wizard-empty"><strong>${wizard.previewError ? 'Payment preview unavailable' : 'Save the draft to review server totals.'}</strong><p>${esc(wizard.previewError || 'Go back to Extras and discounts and save the draft.')}</p>${wizard.previewError ? '<button type="button" class="ghost-btn" data-action="retry-wizard-preview">Retry preview</button>' : ''}</div></div>`;
  }
  const preview = wizard.closePreview;
  const pending = all('billApprovals').find(item => item.billId === bill.id
    && item.requestType === 'full_discount' && item.status === 'Pending');
  const discount = all('discounts').find(item => item.id === bill.discountId);
  const fullDiscount = Boolean(discount && (
    discount.discountType === 'waive'
    || (discount.discountType === 'percent' && Number(discount.value) >= 100)
    || (Number(bill.subtotal) > 0 && Number(bill.discountTotal) >= Number(bill.subtotal))
  ));
  wizard.pendingApproval = Boolean(pending);
  if (!wizard.closePreview) {
    return `<div class="pos-wizard-screen pos-wizard-review" data-pos-wizard-screen="4"><div class="pos-wizard-empty" role="alert"><strong>Payment preview unavailable</strong><p>${esc(wizard.previewError || 'The server has not returned the deposit and balance preview.')}</p><button type="button" class="ghost-btn" data-action="retry-wizard-preview">Retry preview</button></div></div>`;
  }
  const packageLines = wizard.savedLines.filter(line => line.lineType === 'package' && !line.isVoided);
  const lineRows = wizard.savedLines.filter(line => line.lineType === 'charge_item' && !line.isVoided).map(line =>
    `<li><span>${esc(line.description)} · ${Number(line.quantity)} × ${money(line.unitPrice)}</span><strong>${money(Number(line.foodRevenueAmount || 0) + Number(line.nonFoodRevenueAmount || 0))}</strong></li>`
  ).join('');
  const buffetRows = [
    ['Adults', bill.adultCount, bill.adultRate],
    ['Senior / PWD', bill.seniorCount, bill.seniorRate],
    ['Kids', bill.kidsCount, bill.kidsRate],
    ['Comped', bill.compedCount, 0]
  ].filter(([, count]) => Number(count || 0) > 0)
    .map(([label, count, rate]) => `<li><span>${esc(label)} · ${Number(count)} guest${Number(count) === 1 ? '' : 's'} at ${money(rate)} each${packageLines.length ? ' · included in package' : ''}</span><strong>${packageLines.length ? 'Included' : money(Number(count) * Number(rate))}</strong></li>`)
    .join('');
  const packageRows = packageLines.map(line =>
    `<li><span>${esc(line.description)} · ${Number(line.quantity)} × ${money(line.unitPrice)}</span><strong>${money(Number(line.foodRevenueAmount || 0) + Number(line.nonFoodRevenueAmount || 0))}</strong></li>`
  ).join('');
  const settings = all('posSettings');
  const serviceEnabled = (settings.find(setting => setting.key === 'pos_service_charge_mode')?.value || 'none') !== 'none';
  const changed = Number(bill.adultCount) !== Number(reservation.adults || 0)
    || Number(bill.seniorCount) !== Number(reservation.seniorPwdCount || 0)
    || Number(bill.kidsCount) !== Number(reservation.children || 0);
  const noTable = !bill.tableId && !reservation.table;
  const warnings = [
    changed ? '<p class="pos-wizard-warning" role="status">Headcount differs from seating. The difference is recorded in bill notes.</p>' : '',
    noTable ? '<p class="pos-wizard-warning" role="status">No table is linked to this bill.</p>' : '',
    Number(preview?.deposit_remainder || 0) > 0 ? `<p class="pos-wizard-warning" role="status">Deposit exceeds the bill by ${money(preview.deposit_remainder)}; the remainder stays held.</p>` : '',
    pending ? '<p class="pos-wizard-warning" role="status">Full discount approval is pending. A Manager or Administrator must approve before payment.</p>'
      : fullDiscount ? '<p class="pos-wizard-warning" role="status">Full-bill discounts require Manager or Administrator approval before closing.</p>' : ''
  ].join('');
  const due = Number(preview?.balance_after_deposit || 0);
  return `<div class="pos-wizard-screen pos-wizard-review" data-pos-wizard-screen="4">
    <div class="pos-wizard-review-scroll">
      ${warnings}
      <section class="pos-wizard-bill-summary" aria-label="Server-calculated bill lines">
        <h3>Bill lines · ${esc(bill.billNumber || '')}<span class="pos-wizard-party-context">${esc(reservation.name || 'Walk-in guest')} · Table ${esc(reservation.table || 'None linked')}</span></h3>
        <ul class="pos-wizard-line-list">${buffetRows}${packageRows}${lineRows}</ul>
      </section>
    </div>
    <section class="pos-wizard-checkout" aria-label="Bill totals and cash payment">
      <dl class="pos-wizard-totals">
        <div><dt>Subtotal</dt><dd>${money(bill.subtotal)}</dd></div>
        ${serviceEnabled ? `<div><dt>Service charge</dt><dd>${money(bill.serviceCharge)}</dd></div>` : ''}
        <div><dt>Discount</dt><dd>−${money(bill.discountTotal)}</dd></div>
        <div class="is-total"><dt>Total</dt><dd>${money(preview.balance_due)}</dd></div>
        <div><dt>Less: Deposit</dt><dd>−${money(preview.deposit_to_apply)}</dd></div>
        <div class="is-balance"><dt>Balance due</dt><dd>${money(due)}</dd></div>
      </dl>
      <fieldset class="pos-wizard-payment"><legend>Cash payment</legend>
        <label>Cash tendered<input type="number" name="tenderedAmount" min="${due.toFixed(2)}" step="0.01" value="${esc(wizard.tenderedAmount || due.toFixed(2))}" required aria-describedby="wizard-change-preview"></label>
        <div class="pos-cash-shortcuts" aria-label="Cash tender shortcuts"><button type="button" class="ghost-btn compact-btn" data-cash-tender="${due.toFixed(2)}">Exact · ${money(due)}</button><button type="button" class="ghost-btn compact-btn" data-cash-tender="500" ${due <= 0 || due > 500 ? 'disabled' : ''}>₱500</button><button type="button" class="ghost-btn compact-btn" data-cash-tender="1000" ${due <= 0 || due > 1000 ? 'disabled' : ''}>₱1,000</button></div>
        <p class="pos-cash-change" id="wizard-change-preview" data-cash-change-preview data-status="exact" aria-live="polite"><span data-cash-change-label>Change due</span><strong data-cash-change-value>${money(0)}</strong><small data-cash-change-note>Final change is confirmed when payment closes.</small></p>
      </fieldset>
    </section>
  </div>`;
}
async function loadBillWizardReview() {
  const wizard = state.billWizard;
  if (!wizard.billId) {
    wizard.previewError = 'Save the bill draft before requesting its payment preview.';
    renderBillWizard();
    return;
  }
  try {
    wizard.closePreview = await window.supabaseRecord.posBillClosePreview(wizard.billId);
    wizard.previewError = '';
    const due = Number(wizard.closePreview.balance_after_deposit || 0);
    wizard.tenderedAmount = due.toFixed(2);
  } catch (error) {
    console.error('Bill wizard payment preview failed.', error);
    wizard.closePreview = null;
    wizard.previewError = friendlyRpcError(error);
    toast(wizard.previewError, 'error');
  }
  renderBillWizard();
}
function elapsedSeatingLabel(seatedAt) {
  if (!seatedAt) return 'Seated time unavailable';
  const elapsed = Math.max(0, Date.now() - new Date(seatedAt).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return `${minutes} min elapsed`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min elapsed`;
}
function renderBillPartyScreen() {
  if (!all('shifts').some(shift => shift.status === 'Open')) {
    return `<div class="pos-wizard-empty" role="status"><span class="large-icon">!</span><h3>No open cashier shift</h3><p>Open a shift before selecting or creating a bill.</p><button type="button" class="primary-btn" data-action="open-shift-from-wizard">Open shift</button></div>`;
  }
  const wizard = state.billWizard;
  const todayDate = today();
  const reservations = all('reservations').filter(res =>
    res.status === 'Seated'
    && (!res.date || res.date === todayDate)
  ).slice().sort((a, b) => String(b.seatedAt || '').localeCompare(String(a.seatedAt || '')));
  const bills = all('posBills');
  const parties = reservations.filter(res => {
    const linked = bills.filter(bill => bill.reservationId === res.id);
    return linked.some(bill => bill.status === 'Open') || !linked.some(bill => bill.status === 'Closed');
  }).filter(res => {
    if (wizard.filter === 'Walk-ins') return res.type === 'Walk-in';
    if (wizard.filter === 'Seated reservations') return res.type !== 'Walk-in';
    return true;
  }).filter(res => {
    const query = wizard.query.trim().toLowerCase();
    if (!query) return true;
    return `${res.name || ''} ${res.table || ''}`.toLowerCase().includes(query);
  });
  const tabs = [['All', 'All'], ['Seated reservations', 'Seated reservations'], ['Walk-ins', 'Walk-ins']]
    .map(([value, label]) => `<button type="button" role="tab" tabindex="${wizard.filter === value ? '0' : '-1'}" aria-selected="${wizard.filter === value}" class="pos-wizard-filter${wizard.filter === value ? ' is-active' : ''}" data-bill-party-filter="${esc(value)}">${esc(label)}</button>`).join('');
  const cards = parties.map(res => {
    const openBill = bills.find(bill => bill.reservationId === res.id && bill.status === 'Open');
    const adults = Number(res.adults || 0);
    const senior = Number(res.seniorPwdCount || 0);
    const kids = Number(res.children || 0);
    const held = all('reservationDeposits').filter(deposit =>
      deposit.reservationId === res.id && deposit.status === 'Held' && !deposit.billId
    ).reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
    const packageName = all('chargeItems').find(item => item.id === res.packageChargeItemId)?.name;
    const selected = wizard.reservationId === res.id;
    const partyType = res.type === 'Walk-in' ? 'Walk-in' : 'Reservation';
    return `<button type="button" class="pos-party-card${selected ? ' is-selected' : ''}" data-bill-party-id="${esc(res.id)}" aria-label="${esc(partyType)}: ${esc(res.name || 'Walk-in guest')}, ${openBill ? 'open bill' : 'no open bill'}" aria-pressed="${selected}">
      <span class="pos-party-card-head"><strong>${esc(res.name || 'Walk-in guest')}</strong><span class="pos-party-type">${partyType}</span></span>
      <span class="pos-party-card-details"><span class="pos-party-table-chip">${esc(res.table || 'No table')}</span>${openBill ? '<span class="pos-party-open-label">Open bill</span>' : ''}${selected ? '<span class="pos-party-selected" aria-hidden="true">✓ Selected</span>' : ''}</span>
      <span class="pos-party-guests" aria-label="Guest counts">${billWizardCountChips({ adultCount: adults, seniorCount: senior, kidsCount: kids, compedCount: Number(res.compedCount || 0) })}</span>
      <span class="pos-party-meta">${esc(formatOperationalDateTime(res.seatedAt))} · ${esc(elapsedSeatingLabel(res.seatedAt))}</span>
      ${packageName ? `<span class="pos-party-meta">Package: ${esc(packageName)} · ${Number(res.packagePaxCount || 0)} pax</span>` : ''}
      ${held > 0 ? `<span class="pos-party-meta">Deposit held: ${money(held)}</span>` : ''}
      <span class="pos-party-action">${selected ? 'Selected' : 'Select party'}</span>
    </button>`;
  }).join('');
  const unresolvedCards = all('reservations').filter(res =>
    res.status === 'Seated' && res.date && res.date < todayDate
  ).slice(0, 6).map(res => `<div class="pos-party-card pos-party-card-unresolved" aria-label="Past unresolved seated party"><span class="pos-party-card-head"><strong>${esc(res.name || 'Walk-in guest')}</strong><span>Unresolved</span></span><span class="pos-party-guests">${Number(res.guests || res.actualCovers || 0)} guests · Table ${esc(res.table || 'None linked')}</span><span class="pos-party-meta">${esc(reservationDateLabel(res.date))}</span><button type="button" class="text-btn" data-action="open-wizard-unresolved">Open Unresolved view</button></div>`).join('');
  const partyCards = [cards, unresolvedCards].filter(Boolean).join('');
  return `<div class="pos-wizard-screen" data-pos-wizard-screen="1">
    <div class="pos-wizard-toolbar"><label>Search parties<input type="search" data-party-search value="${esc(wizard.query)}" placeholder="Name or table" aria-label="Search by name or table"></label><button type="button" class="primary-btn" data-action="open-walk-in">+ New walk-in</button></div>
    <div class="pos-wizard-tabs" role="tablist" aria-label="Party type">${tabs}</div>
    ${partyCards ? `<div class="pos-party-grid">${partyCards}</div>` : `<div class="pos-wizard-empty"><strong>No seated parties to bill.</strong><p>Seat a reservation or record a walk-in first.</p><div><button type="button" class="ghost-btn" data-action="open-reservation">Seat reservation</button><button type="button" class="primary-btn" data-action="open-walk-in">Record walk-in</button></div></div>`}
  </div>`;
}
function renderBillBuffetScreen() {
  const reservation = all('reservations').find(record => record.id === state.billWizard.reservationId);
  if (!reservation) return '<div class="pos-wizard-empty"><strong>Party unavailable.</strong><p>Return to party selection.</p></div>';
  const wizard = state.billWizard;
  const adults = Number(wizard.adultCount || 0);
  const senior = Number(wizard.seniorCount || 0);
  const kids = Number(wizard.kidsCount || 0);
  const comped = Number(wizard.compedCount || 0);
  const packageItem = all('chargeItems').find(item => item.id === reservation.packageChargeItemId);
  const packageTier = all('packageTiers').find(tier => tier.id === reservation.packageTierId);
  const seatedCovers = Number(reservation.actualCovers || reservation.guests || 0);
  const extraPax = packageItem ? Math.max(0, seatedCovers - Number(reservation.packagePaxCount || 0)) : 0;
  const seatedAdults = Number(reservation.adults || 0);
  const seatedSenior = Number(reservation.seniorPwdCount || 0);
  const seatedKids = Number(reservation.children || 0);
  const mismatch = adults !== seatedAdults || senior !== seatedSenior || kids !== seatedKids;
  const countChanges = billWizardCountDifferences(wizard);
  const seniorCountChanged = senior !== Number(wizard.countBaseline?.seniorCount || 0);
  const countChangeSource = wizard.billId ? 'saved bill' : 'seating';
  const countChangeText = countChanges.map(change =>
    `${change.from} ${change.label} to ${change.to} ${change.label}`
  ).join('; ');
  const held = all('reservationDeposits').filter(deposit =>
    deposit.reservationId === reservation.id && deposit.status === 'Held' && !deposit.billId
  ).reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const rates = all('buffetRates').filter(rate => rate.isActive !== false);
  const adultRate = rates.find(rate => Number(rate.adultRate) >= 0)?.adultRate ?? 449;
  const seniorRate = rates.find(rate => Number(rate.seniorPwdRate) >= 0)?.seniorPwdRate ?? 360;
  const kidsRate = rates.find(rate => Number(rate.childRate) >= 0)?.childRate ?? 225;
  const countEditor = wizard.countsEditing
    ? `<div class="pos-count-stepper" id="bill-count-editor" role="group" aria-label="Edit bill guest counts">
        ${[['adultCount','Adults',adults],['seniorCount','Senior / PWD',senior],['kidsCount','Kids',kids],['compedCount','Comped',comped]].map(([name,label,value]) =>
          `<label>${label}<input type="number" min="0" max="1000" step="1" name="${name}" value="${value}" data-wizard-count></label>`
        ).join('')}
        <p class="field-help" data-senior-id-reminder ${seniorCountChanged ? '' : 'hidden'}>Senior/PWD changes: check the guest ID before confirming.</p>
        <p class="pos-count-change" data-wizard-count-change role="status" ${countChanges.length ? '' : 'hidden'}>${countChanges.length ? `Changed from ${countChangeSource}: ${countChangeText}` : ''}</p>
        <label class="pos-count-confirm" data-count-confirmation ${countChanges.length ? '' : 'hidden'}><input type="checkbox" data-confirm-count-change ${wizard.countsConfirmed ? 'checked' : ''}> I confirm these updated counts for the bill</label>
        <p class="field-help" data-count-baseline-note ${countChanges.length ? 'hidden' : ''}>${wizard.billId ? 'Saved bill counts are already confirmed. Changing a count requires confirmation.' : 'Confirmation is only needed if you change the selected party counts.'}</p>
      </div>`
    : '';
  return `<div class="pos-wizard-screen pos-wizard-screen-two" data-pos-wizard-screen="2">
    ${billWizardGuestSummary(reservation, { showEditCounts: false, heldDeposit: held })}
    <button type="button" class="ghost-btn compact-btn pos-edit-counts" data-action="toggle-wizard-count-edit" aria-expanded="${wizard.countsEditing}" ${wizard.countsEditing ? 'aria-controls="bill-count-editor"' : ''}>${wizard.countsEditing ? 'Done editing' : 'Edit counts'}</button>
    ${countEditor}
    <p class="pos-wizard-warning" data-wizard-count-warning role="status" ${mismatch ? '' : 'hidden'}>Headcount differs from seating. The difference will be noted on the bill.</p>
    ${wizard.billId ? '<button type="button" class="ghost-btn compact-btn pos-skip-review" data-action="wizard-skip-to-review">Skip to review</button>' : ''}
    <section class="pos-buffet-rates"><div class="panel-title">Buffet and rates</div><div class="pos-rate-grid"><span>Adult<strong>${money(adultRate)} each</strong></span><span>Senior/PWD<strong>${money(seniorRate)} each</strong></span><span>Kids<strong>${money(kidsRate)} each</strong></span><span>Comped<strong>₱0.00 each</strong></span></div></section>
    ${packageItem && packageTier ? `<section class="pos-package-card"><strong>${esc(packageItem.name)}</strong><span>${esc(packageTier.name)} · ${Number(reservation.packagePaxCount || 0)} pax</span>${extraPax > 0 ? `<p class="pos-wizard-warning">Actual guests exceed package pax by ${extraPax}. Extra-pax charging may be available on save.</p>` : ''}</section>` : '<section class="pos-package-card is-unbooked"><strong>No package booked</strong><span>Buffet rates apply.</span></section>'}
  </div>`;
}
function legacyBillForm(item = {}) {
  const editing = Boolean(item.id);
  if (editing && state.role === 'Receptionist' && item.createdBy !== state.user?.id) {
    return toast('Receptionists can only view bills they created.', 'error');
  }
  if (!editing && !all('shifts').some(shift => shift.status === 'Open' && shift.openedBy === state.user?.id)) {
    return toast('Open your cashier shift before creating a bill.', 'error');
  }
  const editable = !editing || (item.status === 'Open'
    && (state.role !== 'Receptionist' || item.createdBy === state.user?.id));
  const disabled = editable ? '' : 'disabled';
  const billLines = editing
    ? all('billLines').filter(line => line.billId === item.id && line.lineType === 'charge_item' && !line.isVoided)
    : [];
  const packageLines = editing
    ? all('billLines').filter(line => line.billId === item.id && line.lineType === 'package' && !line.isVoided)
    : [];
  const extraLines = billLines.length ? billLines : (editable ? [{}] : []);
  const selectedReservation = all('reservations').find(res => res.id === item.reservationId);
  const leftoverCharge = all('chargeItems').find(charge => charge.code === 'LEFTOVER' && charge.isActive !== false
    && ['food', 'non_food', 'other'].includes(charge.type) && !charge.isPackage);
  const reservations = all('reservations').filter(res => res.status === 'Seated' || res.id === item.reservationId)
    .map(res => `<option value="${esc(res.id)}" ${item.reservationId === res.id ? 'selected' : ''}>${esc(res.name || 'Guest')} · ${esc(res.date)} ${esc(res.time)}${res.status === 'Seated' ? ' · Seated' : ''}</option>`).join('');
  const tableOptions = all('restaurantTables').map(table => `<option value="${esc(table.id)}" ${item.tableId === table.id || (!item.tableId && selectedReservation?.table === table.id) ? 'selected' : ''}>${esc(table.id)} · ${Number(table.seats)} seats</option>`).join('');
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
      <div>Discount <strong>${money(item.discountTotal)}</strong></div><div>Less: Deposit <strong>${money(item.depositTotal)}</strong></div>
      <div>Cash paid <strong>${money(item.paidTotal)}</strong></div><div>Balance due <strong>${money(item.balanceDue)}</strong></div>
      ${packageLines.map(line => `<div class="full">Package <strong>${esc(line.description)} · ${Number(line.quantity)} × ${money(line.unitPrice)}</strong></div>`).join('')}
      ${revenueTotals}
      <div>Customers served <strong>${Number(item.customersServed || 0)}</strong></div>
    </div>${pendingApproval ? `<p class="field-help">Full discount approval pending (${esc(pendingApproval.requestedAt)}).</p>` : ''}</section>` : '<p class="field-help">All totals and prices are calculated by Supabase when you save.</p>';
  const canRequestVoid = editing && ['Open', 'Closed'].includes(item.status)
    && (state.role !== 'Receptionist' || item.createdBy === state.user?.id);
  const actionButtons = editing
    ? `<div class="pos-bill-actions">${editable ? `<button type="button" class="ghost-btn" data-action="close-bill" data-id="${esc(item.id)}">Take cash &amp; close</button>` : ''}${canRequestVoid ? `<button type="button" class="ghost-btn" data-action="request-bill-void" data-id="${esc(item.id)}">Request void</button>` : ''}<button type="button" class="ghost-btn" data-action="print-bill" data-id="${esc(item.id)}">Print billing statement</button></div>`
    : '';
  const extraPaxRate = Number(all('posSettings').find(setting => setting.key === 'pos_extra_pax_rate')?.value || 0);
  const extraPaxCount = selectedReservation?.packagePaxCount
    ? Math.max(0, Number(selectedReservation.actualCovers || selectedReservation.guests || 0) - Number(selectedReservation.packagePaxCount))
    : 0;
  const extraPaxSection = selectedReservation?.packageChargeItemId && extraPaxCount > 0
    ? `<label class="full pos-extra-pax-choice"><input type="checkbox" name="chargeExtraPax" ${disabled}> Add ${extraPaxCount} extra pax${extraPaxRate > 0 ? ` at ${money(extraPaxRate)} each` : ''}<small class="field-help">${extraPaxRate > 0 ? 'Optional charge; the server calculates the amount.' : 'No extra-pax rate is configured. Continue without a charge or ask an Administrator to set one.'}</small></label>`
    : '';
  const heldReservationDeposits = selectedReservation
    ? all('reservationDeposits').filter(deposit => deposit.reservationId === selectedReservation.id
      && deposit.status === 'Held' && !deposit.billId)
    : [];
  const heldReservationDepositTotal = heldReservationDeposits.reduce(
    (total, deposit) => total + Number(deposit.amount || 0), 0
  );
  const selectedPackageItem = selectedReservation?.packageChargeItemId
    ? all('chargeItems').find(charge => charge.id === selectedReservation.packageChargeItemId)
    : null;
  const selectedPackageTier = selectedReservation?.packageTierId
    ? all('packageTiers').find(tier => tier.id === selectedReservation.packageTierId)
    : null;
  const reservationPrefill = !editing && selectedReservation
    ? `<section class="panel pos-reservation-prefill"><strong>Reservation prefill</strong><div>${selectedPackageItem && selectedPackageTier
      ? `Package line: ${esc(selectedPackageItem.name)} · ${esc(selectedPackageTier.name)} × ${Number(selectedReservation.packagePaxCount || 0)} pax · ${money(Number(selectedPackageTier.basePrice || 0) * Number(selectedReservation.packagePaxCount || 0))} (server adds this on save).`
      : 'No package is booked.'}</div><div>Held deposit: ${money(heldReservationDepositTotal)}${heldReservationDepositTotal ? ' (a payment, applied at close; not a discount)' : ''}</div><div>Table: ${esc(selectedReservation.table || 'None assigned')}</div></section>`
    : '';
  const content = `<p class="field-help">${editing ? `Bill ${esc(item.billNumber)} · ${esc(item.status)}${item.createdAt ? ` · Created ${esc(formatOperationalDateTime(item.createdAt))}` : ''}` : 'Cash-only billing. Sales do not deduct inventory. Comped guests count as served at zero.'}</p>
    ${reservationPrefill}
    <div class="pos-headcount-warning is-hidden" data-bill-headcount-warning role="status" aria-live="polite"></div>
    <div class="form-grid pos-bill-customer-grid">
      <label>Customer name<input name="customerName" value="${esc(item.customerName || selectedReservation?.name || 'Walk-in')}" maxlength="160" ${disabled} required></label>
      <label>Seated reservation<select name="reservationId" ${disabled || editing ? 'disabled' : ''}><option value="">Walk-in / no reservation</option>${reservations}</select>${editing ? `<input type="hidden" name="reservationId" value="${esc(item.reservationId || '')}">` : ''}</label>
      <label>Table (optional)<select name="tableId" ${disabled}><option value="">No table</option>${tableOptions}</select></label>
    </div>
    <fieldset class="product-form-section"><legend>Head counts</legend><div class="form-grid">
      <label>Adult × ${money(item.adultRate || 449)}<input name="adultCount" type="number" min="0" max="1000" step="1" value="${Number(item.adultCount || 0)}" ${disabled} required></label>
      <label>Senior / PWD × ${money(item.seniorRate || 360)}<input name="seniorCount" type="number" min="0" max="1000" step="1" value="${Number(item.seniorCount || 0)}" ${disabled} required></label>
      <label>Kids × ${money(item.kidsRate || 225)}<input name="kidsCount" type="number" min="0" max="1000" step="1" value="${Number(item.kidsCount || 0)}" ${disabled} required></label>
      <label>Comped × ₱0.00<input name="compedCount" type="number" min="0" max="1000" step="1" value="${Number(item.compedCount || 0)}" ${disabled} required></label>
    </div></fieldset>
    ${extraPaxSection}
    <fieldset class="product-form-section"><legend>Extras</legend><div class="field-help">Extra item prices are snapshotted from the charge catalog. Stock is never changed.</div><div class="pos-extra-lines">${extraLines.map(line => billExtraLineMarkup(line, !editable)).join('')}</div>${editable ? `<div class="pos-extra-actions"><button type="button" class="ghost-btn compact-btn" data-action="add-bill-extra">+ Add extra</button>${leftoverCharge ? `<button type="button" class="ghost-btn compact-btn" data-action="add-leftover-charge" data-charge-id="${esc(leftoverCharge.id)}">Add Leftover charge · ${money(leftoverCharge.unitPrice || 0)}</button>` : '<span class="field-help">No active Leftover charge is configured.</span>'}</div>` : ''}</fieldset>
    <fieldset class="product-form-section"><legend>Discount</legend><div class="form-grid">
      <label>Discount<select name="discountId" ${disabled}><option value="">No discount</option>${discounts}</select></label>
      <label class="full">Reason (required when a discount is selected)<textarea name="discountReason" rows="2" maxlength="500" ${disabled}>${esc(item.discountReason || '')}</textarea></label>
    </div><small class="field-help">Full-bill discounts require Manager/Administrator approval before close.</small></fieldset>
    <label>Notes<textarea name="notes" rows="2" maxlength="1000" ${disabled}>${esc(item.notes || '')}</textarea></label>
    ${totals}${actionButtons}`;
  modal(editing ? `${editable ? 'Edit' : 'View'} bill ${item.billNumber || ''}` : 'Create bill',
    content, editable ? (editing ? 'Save bill' : 'Create bill') : '', 'pos-bill-modal', editable ? 'money' : 'read-only');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'bill';
  if (editing) form.dataset.id = item.id;
  else form.dataset.createKey = id('POSCREATE');
  updateBillHeadcountWarning(form);
}
function updateBillCashChangePreview(preview, tenderedValue, dueValue) {
  if (!preview) return;
  const label = preview.querySelector('[data-cash-change-label]');
  const amount = preview.querySelector('[data-cash-change-value]');
  const note = preview.querySelector('[data-cash-change-note]');
  const rawTendered = String(tenderedValue ?? '').trim();
  const tendered = Number(rawTendered);
  const due = Number(dueValue);
  if (!rawTendered || !Number.isFinite(tendered) || !Number.isFinite(due)) {
    preview.dataset.status = 'empty';
    label.textContent = 'Enter cash tendered to calculate change';
    amount.textContent = '';
    note.textContent = '';
    return;
  }
  if (tendered < due) {
    const shortfall = Math.round((due - tendered) * 100) / 100;
    preview.dataset.status = 'short';
    label.textContent = 'Short by';
    amount.textContent = money(shortfall);
    note.textContent = `Enter at least ${money(due)} to continue.`;
    return;
  }
  const change = Math.round((tendered - due) * 100) / 100;
  preview.dataset.status = change > 0 ? 'change' : 'exact';
  label.textContent = 'Change due';
  amount.textContent = money(change);
  note.textContent = 'Final change is confirmed when payment closes.';
}
async function billCloseForm(bill) {
  let preview;
  try {
    preview = await window.supabaseRecord.posBillClosePreview(bill.id);
  } catch (error) {
    console.error('Bill close preview failed.', error);
    return toast(friendlyRpcError(error), 'error');
  }
  const minimum = Number(preview.balance_after_deposit || 0);
  modal(`Take cash · ${esc(bill.billNumber)}`,
    `<div class="pos-payment-summary"><div>Balance before deposit <strong>${money(preview.balance_due)}</strong></div><div>Less: Deposit <strong>${money(preview.deposit_to_apply)}</strong></div><div>Balance due <strong>${money(minimum)}</strong></div>${Number(preview.deposit_remainder || 0) > 0 ? `<p class="field-help">Deposit remainder held for follow-up: ${money(preview.deposit_remainder)}.</p>` : ''}</div><label>Cash tendered<input name="tenderedAmount" type="number" min="${minimum.toFixed(2)}" step="0.01" value="${minimum.toFixed(2)}" required aria-describedby="bill-close-change-preview"><small class="field-help">The server applies eligible deposits and records the payment.</small></label><div class="pos-cash-shortcuts" aria-label="Cash tender shortcuts"><button type="button" class="ghost-btn compact-btn" data-cash-tender="${minimum.toFixed(2)}">Exact · ${money(minimum)}</button><button type="button" class="ghost-btn compact-btn" data-cash-tender="500" ${minimum <= 0 || minimum > 500 ? 'disabled' : ''}>₱500</button><button type="button" class="ghost-btn compact-btn" data-cash-tender="1000" ${minimum <= 0 || minimum > 1000 ? 'disabled' : ''}>₱1,000</button></div><p class="pos-cash-change" id="bill-close-change-preview" data-cash-change-preview data-status="exact" aria-live="polite"><span data-cash-change-label>Change due</span><strong data-cash-change-value>${money(0)}</strong><small data-cash-change-note>Final change is confirmed when payment closes.</small></p>`,
    'Confirm cash and close', 'pos-payment-modal', 'money');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'bill-close';
  form.dataset.id = bill.id;
  form.dataset.paymentKey = id('POSPAY');
  form.dataset.balanceDue = minimum.toFixed(2);
  updateBillCashChangePreview(form.querySelector('[data-cash-change-preview]'), minimum.toFixed(2), minimum);
}
function billVoidRequestForm(bill) {
  modal(`Request void · ${esc(bill.billNumber)}`,
    `<p>A Manager or Administrator must approve this request. ${bill.status === 'Closed' ? 'Any cash paid will be refunded from a Manager’s open shift, and applied deposits return to Held.' : ''}</p><label>Reason<textarea name="voidReason" maxlength="500" rows="3" required></textarea></label>`,
    'Request void', 'pos-approval-modal', 'money');
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
    approving ? 'Approve request' : 'Reject request', 'pos-approval-modal', 'money');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'bill-approval-decision';
  form.dataset.id = approval.id;
  form.dataset.decision = decision;
}
function printBillingStatement(billId) {
  const bill = all('posBills').find(item => item.id === billId);
  if (!bill) return toast('This bill is no longer available.', 'error');
  if (state.role === 'Receptionist' && bill.createdBy !== state.user?.id) {
    return toast('Receptionists can only print bills they created.', 'error');
  }
  const lines = all('billLines').filter(line => line.billId === bill.id && !line.isVoided);
  const payments = all('billPayments').filter(payment => payment.billId === bill.id);
  const mealLines = lines.some(line => line.lineType === 'package') ? [] : [
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
    <div><strong>Customer:</strong> ${esc(bill.customerName)}</div><div><strong>Date:</strong> ${esc(formatOperationalDateTime(bill.closedAt || bill.createdAt))}</div>
    <div><strong>Customers served:</strong> ${Number(bill.customersServed || 0)}</div><div><strong>Reservation:</strong> ${esc(bill.reservationId || 'Walk-in')}</div></div>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${mealLines.concat(extraLines).join('') || '<tr><td colspan="4">No bill lines</td></tr>'}</tbody></table>
    <div class="totals"><div><span>Subtotal</span><strong>${money(bill.subtotal)}</strong></div>
    <div><span>Service charge</span><strong>${money(bill.serviceCharge)}</strong></div>
    <div><span>Discount</span><strong>−${money(bill.discountTotal)}</strong></div>
    ${bill.discountReason ? `<div><span>Discount reason</span><span>${esc(bill.discountReason)}</span></div>` : ''}
    <div><span>Less: Deposit</span><strong>−${money(bill.depositTotal)}</strong></div>
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
function shiftForm() {
  if (all('shifts').some(item => item.status === 'Open')) {
    return toast('The restaurant already has an open cashier shift.', 'error');
  }
  const today = manilaBusinessToday();
  if (all('shifts').some(item =>
    shiftOpenedOnDate(item, today)
  )) {
    return toast('The restaurant can open only one cashier shift per business day.', 'error');
  }
  modal('Open cashier shift',
    '<label>Starting cash<input name="openingCash" type="number" min="0" step="0.01" value="0.00" required></label><label>Notes<textarea name="notes" rows="2" maxlength="500"></textarea></label>',
    'Open shift', '', 'money');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'shift';
}
function cashMovementForm(shift) {
  modal(`Cash movement · ${esc(shift.code)}`,
    '<div class="form-grid"><label>Movement<select name="movementType" required><option value="paid_in">Paid in</option><option value="paid_out">Paid out</option></select></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required></label></div><label>Reason<textarea name="reason" minlength="1" maxlength="500" required></textarea></label>',
    'Record movement', '', 'money');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'cash-movement';
  form.dataset.id = shift.id;
  form.dataset.movementKey = id('POSMOV');
}
function reservationDepositForm(reservation) {
  modal(`Cash deposit · ${esc(reservation.name || 'Reservation')}`,
    `<p>Cash received for reservation ${esc(reservation.date)} ${esc(reservation.time)}. It will be held as a payment, never a discount.</p><label>Cash amount<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Notes<textarea name="notes" maxlength="500"></textarea></label>`,
    'Record deposit', '', 'money');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'reservation-deposit';
  form.dataset.id = reservation.id;
  form.dataset.depositKey = id('POSDEP');
}
function depositDecisionForm(deposit, decision) {
  const label = decision === 'refund' ? 'Refund deposit' : 'Forfeit deposit';
  modal(label, `<p>${money(deposit.amount)} · ${esc(deposit.status)}</p><label>Reason<textarea name="reason" minlength="1" maxlength="500" required></textarea></label>`, label, '', 'money');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'deposit-decision';
  form.dataset.id = deposit.id;
  form.dataset.decision = decision;
}
async function showReservationDepositHistory(reservationId) {
  try {
    const history = await window.supabaseRecord.posReservationDepositHistory(reservationId);
    const deposits = (history.deposits || []).map(deposit =>
      `<tr><td>${esc(deposit.created_at || '')}</td><td>${money(deposit.receipt_amount || deposit.amount)}</td><td>${money(deposit.amount)}</td><td>${esc(deposit.status)}</td><td>${esc(deposit.notes || '—')}</td></tr>`
    ).join('');
    const actions = (history.actions || []).map(action =>
      `<tr><td>${esc(action.acted_at || '')}</td><td>${esc(action.action_type)}</td><td>${money(action.amount)}</td><td>${esc(action.reason || '—')}</td></tr>`
    ).join('');
    const content = `<h3>Deposits</h3><div class="table-scroll"><table><thead><tr><th>Received</th><th>Original amount</th><th>Current amount</th><th>Status</th><th>Notes</th></tr></thead><tbody>${deposits || '<tr><td colspan="5" class="empty-state">No deposits recorded.</td></tr>'}</tbody></table></div><h3>Deposit activity</h3><div class="table-scroll"><table><thead><tr><th>Time</th><th>Action</th><th>Amount</th><th>Reason</th></tr></thead><tbody>${actions || '<tr><td colspan="4" class="empty-state">No deposit activity recorded.</td></tr>'}</tbody></table></div>`;
    modal('Reservation deposit history', content, null, '', 'read-only');
  } catch (error) {
    console.error('Reservation deposit history could not be loaded.', error);
    toast(friendlyRpcError(error), 'error');
  }
}
function posSettingForm(setting) {
  if (state.role !== 'Administrator'
    || !['pos_max_shift_hours', 'pos_extra_pax_rate'].includes(setting.key)) {
    return toast('Only an Administrator can change this POS setting.', 'error');
  }
  const isHours = setting.key === 'pos_max_shift_hours';
  modal(`Configure ${isHours ? 'maximum shift hours' : 'extra-pax rate'}`,
    `<label>${isHours ? 'Hours before a long-shift alert' : 'Cash price per extra pax'}<input name="value" type="number" min="${isHours ? '1' : '0'}" ${isHours ? 'max="72"' : ''} step="${isHours ? '1' : '0.01'}" value="${esc(setting.value)}" required></label>`,
    'Save setting');
  const form = document.querySelector('#modalForm');
  form.dataset.type = 'pos-setting';
  form.dataset.id = setting.id;
}
async function shiftSummaryForm(shiftId) {
  try {
    const summary = await window.supabaseRecord.posShiftSummary(shiftId);
    const shift = summary.shift;
    modal(`Shift · ${esc(shift.shift_code)}`,
      `<div class="detail-grid"><div><small>Status</small><strong>${esc(shift.status)}</strong></div><div><small>Starting cash</small><strong>${money(shift.opening_float)}</strong></div><div><small>Cash bill payments</small><strong>${money(summary.cash_payments)}</strong></div><div><small>Cash deposits received</small><strong>${money(summary.deposit_receipts)}</strong></div><div><small>Paid in</small><strong>${money(summary.paid_in)}</strong></div><div><small>Paid out</small><strong>${money(summary.paid_out)}</strong></div><div><small>Cash refunds</small><strong>${money(summary.cash_refunds)}</strong></div><div><small>Expected cash</small><strong>${money(summary.expected_cash)}</strong></div><div><small>Open bills</small><strong>${Number(summary.open_bill_count || 0)}</strong></div><div><small>Pending approvals</small><strong>${Number(summary.pending_approval_count || 0)}</strong></div>${shift.declared_cash == null ? '' : `<div><small>Counted cash</small><strong>${money(shift.declared_cash)}</strong></div><div><small>Variance</small><strong class="${Number(shift.cash_variance) < 0 ? 'cash-variance-short' : 'cash-variance-over'}">${Number(shift.cash_variance) > 0 ? '+' : ''}${money(shift.cash_variance)}</strong></div>`}</div>`,
      null, '', 'read-only');
  } catch (error) {
    console.error('Shift summary could not be loaded.', error);
    toast(friendlyRpcError(error), 'error');
  }
}
async function shiftCloseForm(shift) {
  try {
    if (!window.CostTrackLogic.canCloseShift(shift, state.role, state.user?.id)) {
      return toast('Only the shift opener or a Manager/Admin can close this shift.', 'error');
    }
    const summary = await window.supabaseRecord.posShiftSummary(shift.id);
    const expected = Number(summary.expected_cash || 0);
    const overdueNotice = shiftOpenedOnDate(shift, manilaBusinessToday())
      ? ''
      : '<p class="field-help">This shift remained open overnight. Reconcile it before opening another shift.</p>';
    const delegatedClose = shift.openedBy !== state.user?.id;
    const closingNotesLabel = delegatedClose
      ? '<label>Reason for closing on another cashier\'s behalf (required)<textarea name="notes" rows="2" maxlength="500" required></textarea></label>'
      : '<label>Closing notes<textarea name="notes" rows="2" maxlength="500"></textarea></label>';
    modal(`Close shift · ${esc(shift.code)}`,
      `${overdueNotice}<div class="pos-payment-summary"><div>Expected cash <strong>${money(expected)}</strong></div><div>Open bills <strong>${Number(summary.open_bill_count || 0)}</strong></div><div>Pending approvals <strong>${Number(summary.pending_approval_count || 0)}</strong></div><p class="field-help">Variance = counted cash − expected cash. Open bills block shift close.</p></div><label>Counted cash<input name="countedCash" type="number" min="0" step="0.01" value="${expected.toFixed(2)}" required></label><div class="pos-variance-preview">Variance <strong data-shift-variance>${money(0)}</strong></div>${closingNotesLabel}`,
      'Reconcile and close', 'pos-payment-modal', 'money');
    const form = document.querySelector('#modalForm');
    form.dataset.type = 'shift-close';
    form.dataset.id = shift.id;
  } catch (error) {
    console.error('Shift close preview failed.', error);
    toast(friendlyRpcError(error), 'error');
  }
}
async function printShiftReport(shiftId) {
  try {
    const summary = await window.supabaseRecord.posShiftSummary(shiftId);
    const shift = summary.shift;
    const movements = all('cashMovements').filter(item => item.shiftId === shiftId);
    const variance = shift.declared_cash == null ? null : Number(shift.declared_cash) - Number(summary.expected_cash);
    const amounts = [['Starting cash',shift.opening_float],['Cash bill payments',summary.cash_payments],['Cash deposits received',summary.deposit_receipts],['Paid in',summary.paid_in],['Paid out',summary.paid_out],['Cash refunds',summary.cash_refunds],['Expected cash',summary.expected_cash],['Counted cash',shift.declared_cash]];
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>Shift report ${esc(shift.shift_code)}</title><style>body{font:14px Arial,sans-serif;max-width:760px;margin:32px auto;padding:0 20px}h1{font-size:20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:8px 0}@media print{body{margin:0 auto}}</style></head><body><h1>Cashier shift report · ${esc(shift.shift_code)}</h1><p>${esc(shift.status)} · Opened ${esc(formatOperationalDateTime(shift.opened_at))} · Closed ${esc(shift.closed_at ? formatOperationalDateTime(shift.closed_at) : 'Open')}</p><section class="grid">${amounts.filter(([,value])=>value!=null).map(([label,value])=>`<div class="row"><span>${label}</span><strong>${money(value)}</strong></div>`).join('')}</section>${variance == null ? '' : `<p>Variance: <strong>${variance > 0 ? '+' : ''}${money(variance)}</strong></p>`}<h2>Cash movements</h2><ul>${movements.map(item=>`<li>${esc(item.movementType)} · ${money(item.amount)} · ${esc(item.reason)}</li>`).join('') || '<li>None</li>'}</ul><script>window.onload=()=>window.print();</script></body></html>`;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return toast('Allow pop-ups to print the shift report.', 'error');
    printWindow.document.open();
    printWindow.document.write(doc);
    printWindow.document.close();
  } catch (error) {
    console.error('Shift report could not be loaded.', error);
    toast(friendlyRpcError(error), 'error');
  }
}

document.addEventListener('click', event => {
  const actionElement = event.target.closest('[data-action]');
  const action = actionElement?.dataset.action;
  if (!['open-table-form', 'edit-table', 'assign-table', 'delete-table', 'apply-table-layout', 'mark-table-clean', 'manage-product'].includes(action)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (action === 'manage-product') {
    void manageProductLifecycle(actionElement.dataset.id);
    return;
  }
  if (action === 'open-table-form') return tableForm();
  if (action === 'apply-table-layout') return applyRestaurantTableLayout(actionElement);
  const table = all('restaurantTables').find(item => item.id === actionElement.dataset.id);
  if (!table) return toast('This table is no longer available. Reload and try again.', 'error');
  if (action === 'mark-table-clean') {
    if (!['Administrator', 'Manager', 'Receptionist'].includes(state.role)) return toast('You do not have permission to update table cleaning status.', 'error');
    if (table.status !== 'Needs cleaning') return toast('This table no longer needs cleaning.', 'error');
    void markTableAvailable(table, actionElement);
    return;
  }
  if (action === 'edit-table') return tableForm(table);
  if (action === 'assign-table') return tableAssignmentForm(table);
  return deleteRecord('table', table.id, actionElement);
});
document.addEventListener('click', event => {
  const actionElement = event.target.closest('[data-action]');
  const action = actionElement?.dataset.action;
  if (!action) return;
  if (action === 'select-walkin-table') {
    const form = actionElement.closest('#modalForm[data-type="walk-in"]');
    if (!form || actionElement.disabled) return;
    form.elements.table.value = actionElement.dataset.tableId || '';
    state.modalDirty = true;
    refreshWalkInTables(form);
    [...form.querySelectorAll('[data-action="select-walkin-table"]')]
      .find(button => button.dataset.tableId === form.elements.table.value)?.focus();
    return;
  }
  if (action === 'reservation-wizard-back') {
    if (!state.reservationWizard || state.reservationWizard.step <= 1) return;
    const form = document.querySelector('#modalForm[data-type="reservation"]');
    if (form) Object.assign(state.reservationWizard.draft, Object.fromEntries(new FormData(form)));
    state.reservationWizard.step -= 1;
    state.modalDirty = true;
    renderReservationWizard();
    return;
  }
  if (action === 'reservation-wizard-goto') {
    const targetStep = Number(actionElement.dataset.step);
    if (!state.reservationWizard || !Number.isInteger(targetStep)
      || targetStep < 1 || targetStep >= state.reservationWizard.step) return;
    const form = document.querySelector('#modalForm[data-type="reservation"]');
    if (form) Object.assign(state.reservationWizard.draft, Object.fromEntries(new FormData(form)));
    state.reservationWizard.step = targetStep;
    state.modalDirty = true;
    renderReservationWizard();
    return;
  }
  if (action === 'reservation-wizard-table') {
    const wizard = state.reservationWizard;
    if (!wizard || wizard.step !== 2 || actionElement.disabled) return;
    const tableId = actionElement.dataset.tableId || '';
    if (tableId) {
      const table = all('restaurantTables').find(entry => entry.id === tableId);
      const partySize = Number(wizard.draft.adults || 0)
        + Number(wizard.draft.seniorPwdCount || 0)
        + Number(wizard.draft.children || 0);
      const tableState = table && reservationTableState(table, {
        date: wizard.draft.date,
        time: wizard.draft.time,
        partySize,
        reservationId: wizard.draft.id,
        selectedTableId: wizard.draft.table
      });
      if (!tableState?.canSelect || !tableState.hasCapacity) return;
    }
    wizard.draft.table = tableId;
    state.modalDirty = true;
    renderReservationWizard();
    if (tableId) {
      requestAnimationFrame(() => [...document.querySelectorAll('#modalForm [data-action="reservation-wizard-table"]')]
        .find(button => button.dataset.tableId === tableId)?.focus());
    }
  }
});
document.addEventListener('click', async event => {
  const cashTender = event.target.closest('[data-cash-tender]');
  if (cashTender) {
    const form = cashTender.closest('#modalForm[data-type="bill-close"]');
    const wizardForm = cashTender.closest('#modalForm[data-type="bill-wizard"]');
    const paymentForm = form || wizardForm;
    if (!paymentForm) return;
    paymentForm.elements.tenderedAmount.value = cashTender.dataset.cashTender;
    if (wizardForm) state.billWizard.tenderedAmount = cashTender.dataset.cashTender;
    const due = wizardForm
      ? Number(state.billWizard.closePreview?.balance_after_deposit || 0)
      : Number(form.dataset.balanceDue || 0);
    updateBillCashChangePreview(
      paymentForm.querySelector('[data-cash-change-preview]'),
      cashTender.dataset.cashTender,
      due
    );
    state.modalDirty = true;
    return;
  }
  const partyCard = event.target.closest('[data-bill-party-id]');
  if (partyCard) {
    const reservation = all('reservations').find(record => record.id === partyCard.dataset.billPartyId);
    if (!reservation) return toast('This party is no longer available. Refresh the bill list.', 'error');
    const openBill = all('posBills').find(bill => bill.reservationId === reservation.id && bill.status === 'Open');
    state.billWizard.screen = 1;
    state.billWizard.reservationId = reservation.id;
    state.billWizard.billId = openBill?.id || '';
    state.billWizard.adultCount = Number(openBill?.adultCount ?? reservation.adults ?? 0);
    state.billWizard.seniorCount = Number(openBill?.seniorCount ?? reservation.seniorPwdCount ?? 0);
    state.billWizard.kidsCount = Number(openBill?.kidsCount ?? reservation.children ?? 0);
    state.billWizard.compedCount = Number(openBill?.compedCount ?? reservation.compedCount ?? 0);
    state.billWizard.countBaseline = billWizardCountValues(openBill || reservation);
    state.billWizard.extraLines = openBill
      ? all('billLines').filter(line => line.billId === openBill.id && line.lineType === 'charge_item' && !line.isVoided)
      : [];
    state.billWizard.discountId = openBill?.discountId || '';
    state.billWizard.discountReason = openBill?.discountReason || '';
    state.billWizard.chargeExtraPax = openBill
      ? all('billLines').some(line => line.billId === openBill.id && line.lineType === 'package' && /^Extra pax/.test(line.description || ''))
      : false;
    state.billWizard.notes = openBill?.notes || '';
    state.billWizard.savedBill = openBill || null;
    state.billWizard.savedLines = openBill ? all('billLines').filter(line => line.billId === openBill.id) : [];
    state.billWizard.closePreview = null;
    state.billWizard.previewError = '';
    state.billWizard.tenderedAmount = '';
    state.billWizard.paymentKey = id('POSPAY');
    state.billWizard.createKey = openBill ? '' : id('POSCREATE');
    state.billWizard.pendingApproval = false;
    state.billWizard.countsEditing = false;
    state.billWizard.countsConfirmed = Boolean(openBill);
    state.billWizard.focusAfterRender = 'continue';
    state.modalDirty = true;
    renderBillWizard();
    return;
  }
  const partyFilter = event.target.closest('[data-bill-party-filter]');
  if (partyFilter) {
    state.billWizard.filter = partyFilter.dataset.billPartyFilter;
    localStorage.setItem('costtrack_bill_party_filter', state.billWizard.filter);
    renderBillWizard();
    return;
  }
  const quantityAdjust = event.target.closest('[data-extra-quantity-adjust]');
  if (quantityAdjust) {
    const input = quantityAdjust.closest('[data-extra-line]')?.querySelector('[name="extraQuantity"]');
    if (!input || input.disabled) return;
    const minimum = Number(input.min || 0.01);
    const maximum = Number(input.max || 10000);
    const current = Number(input.value || 1);
    const direction = Number(quantityAdjust.dataset.extraQuantityAdjust);
    input.value = String(Math.max(minimum, Math.min(maximum, Number((current + direction).toFixed(2)))));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    return;
  }
  const actionElement = event.target.closest('[data-action]');
  const action = actionElement?.dataset.action;
  if (!action) return;
  if (action === 'bill-wizard-step') {
    const targetStep = Number(actionElement.dataset.step);
    if (targetStep >= 1 && targetStep < state.billWizard.screen) {
      captureBillWizardForm(actionElement.closest('#modalForm'));
      state.billWizard.screen = targetStep;
      if (targetStep === 1) {
        state.billWizard.reservationId = '';
        state.billWizard.billId = '';
      }
      renderBillWizard();
    }
    return;
  }
  if (action === 'bill-wizard-back') {
    if (state.billWizard.screen > 1) {
      captureBillWizardForm(actionElement.closest('#modalForm'));
      state.billWizard.screen -= 1;
      if (state.billWizard.screen === 1) {
        state.billWizard.reservationId = '';
        state.billWizard.billId = '';
      }
      renderBillWizard();
    }
    return;
  }
  if (action === 'bill-wizard-save-open') {
    state.modalDirty = false;
    closeModal(true);
    toast(`${state.billWizard.savedBill?.billNumber || 'Bill'} remains open. Payment can be taken later.`);
    render();
    return;
  }
  if (action === 'retry-wizard-preview') {
    void loadBillWizardReview();
    return;
  }
  if (action === 'wizard-skip-to-review') {
    state.billWizard.screen = 3;
    renderBillWizard();
    requestAnimationFrame(() => document.querySelector('#modalForm')?.requestSubmit());
    return;
  }
  if (action === 'edit-wizard-counts') {
    captureBillWizardForm(actionElement.closest('#modalForm'));
    state.billWizard.screen = 2;
    state.billWizard.countsEditing = true;
    state.modalDirty = true;
    renderBillWizard();
    return;
  }
  if (action === 'toggle-wizard-count-edit') {
    state.billWizard.countsEditing = !state.billWizard.countsEditing;
    state.modalDirty = true;
    renderBillWizard();
    return;
  }
  if (action === 'open-wizard-unresolved') {
    closeModal(true);
    state.reservationFilter = 'Unresolved';
    setView('reservations');
    return;
  }
  if (action === 'open-shift-from-wizard') return shiftForm();
  if (action === 'add-leftover-charge') {
    const form = document.querySelector('#modalRoot #modalForm[data-type="bill"],#modalRoot #modalForm[data-type="bill-wizard"]');
    const lines = form?.querySelector('.pos-extra-lines');
    const charge = all('chargeItems').find(item => item.id === actionElement.dataset.chargeId
      && item.code === 'LEFTOVER' && item.isActive !== false);
    if (!lines || !charge) return toast('The active Leftover charge is unavailable. Reload the catalog and try again.', 'error');
    const existingLine = [...lines.querySelectorAll('[data-extra-line]')].find(line =>
      line.querySelector('[name="extraChargeItemId"]')?.value === charge.id
    );
    if (existingLine) {
      const quantity = existingLine.querySelector('[name="extraQuantity"]');
      quantity.value = String(Number(quantity.value || 0) + 1);
    } else {
      if (lines.querySelectorAll('[data-extra-line]').length >= 30) return toast('A bill can have no more than 30 extra lines.', 'error');
      lines.insertAdjacentHTML('beforeend', billExtraLineMarkup());
      lines.lastElementChild.querySelector('[name="extraChargeItemId"]').value = charge.id;
    }
    state.modalDirty = true;
    return;
  }
  if (action === 'add-bill-extra') {
    const form = document.querySelector('#modalRoot #modalForm[data-type="bill"],#modalRoot #modalForm[data-type="bill-wizard"]');
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
    if (bill && ['Open', 'Closed'].includes(bill.status)) return billVoidRequestForm(bill);
    return toast('Only open or closed bills can be submitted for void approval.', 'error');
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
  if (action === 'open-shift') return shiftSummaryForm(actionElement.dataset.id);
  if (action === 'close-shift') {
    const shift = all('shifts').find(item => item.id === actionElement.dataset.id);
    if (shift?.status === 'Open') return shiftCloseForm(shift);
    return toast('Only open shifts can be closed.', 'error');
  }
  if (action === 'cash-movement') {
    const shift = all('shifts').find(item => item.id === actionElement.dataset.id);
    if (shift?.status === 'Open') return cashMovementForm(shift);
    return toast('Cash movements can be recorded only on the open restaurant shift.', 'error');
  }
  if (action === 'print-shift') return printShiftReport(actionElement.dataset.id);
  if (action === 'refresh-activity-logs') {
    const restoreButton = setButtonBusy(actionElement, 'Refreshing…');
    try {
      await refetchCollection('auditLogs');
      render();
    } catch (error) {
      console.error('Activity log could not be refreshed.', error);
      toast(friendlyRpcError(error), 'error');
    } finally {
      restoreButton?.();
    }
    return;
  }
  if (action === 'record-deposit') {
    const reservation = all('reservations').find(item => item.id === actionElement.dataset.id);
    if (!all('shifts').some(shift => shift.status === 'Open')) {
      return toast('Open the restaurant cashier shift before recording a deposit.', 'error');
    }
    if (reservation) return reservationDepositForm(reservation);
    return toast('This reservation is no longer available.', 'error');
  }
  if (action === 'deposit-decision') {
    const deposit = all('reservationDeposits').find(item => item.id === actionElement.dataset.id);
    if (!['Administrator', 'Manager'].includes(state.role)) return toast('Only Managers and Administrators can refund or forfeit deposits.', 'error');
    if (deposit?.status === 'Held') return depositDecisionForm(deposit, actionElement.dataset.decision);
    return toast('Only Held deposits can be refunded or forfeited.', 'error');
  }
  if (action === 'deposit-history') return showReservationDepositHistory(actionElement.dataset.id);
  if (action === 'refresh-unresolved-bookings' || action === 'retry-unresolved-bookings') {
    if (action === 'refresh-unresolved-bookings') invalidateUnresolvedBookings();
    const restoreButton = setButtonBusy(actionElement, action === 'retry-unresolved-bookings' ? 'Retrying…' : 'Refreshing…');
    if (!restoreButton) return;
    try {
      await loadUnresolvedBookings(true);
    } finally {
      restoreButton();
    }
    return;
  }
  if (action === 'show-unresolved-booking') {
    state.reservationFilter = 'Unresolved';
    state.reservationTypeFilter = 'All';
    state.reservationDateFilter = 'All';
    state.reservationMealPeriodFilter = 'All';
    state.calendarDate = today();
    state.query = '';
    state.unresolvedFocusId = actionElement.dataset.id;
    persistReservationFilters();
    setView('reservations');
    return;
  }
  if (action === 'open-unresolved-bill') return openUnresolvedBookingBill(actionElement.dataset.id);
  if (action === 'open-reservation-bill') {
    const reservation = all('reservations').find(item => item.id === actionElement.dataset.id);
    if (!reservation || reservation.status !== 'Seated') return toast('Only seated reservations can open a bill.', 'error');
    if (!all('shifts').some(shift => shift.status === 'Open')) {
      return toast('Open the restaurant cashier shift before creating a bill.', 'error');
    }
    if (all('posBills').some(bill => bill.reservationId === reservation.id && bill.status === 'Open')) {
      return toast('This reservation already has an open bill.', 'error');
    }
    return billForm({
      customerName: reservation.name,
      reservationId: reservation.id,
      tableId: reservation.table || '',
      adultCount: Number(reservation.adults || 0),
      seniorCount: Number(reservation.seniorPwdCount || 0),
      kidsCount: Number(reservation.children || 0),
      compedCount: 0
    });
  }
  if (action === 'new-charge-item') return chargeItemForm();
  if (action === 'edit-pos-setting') {
    const setting = all('posSettings').find(item => item.id === actionElement.dataset.id);
    if (setting) return posSettingForm(setting);
    return toast('This POS setting is no longer available.', 'error');
  }
  if (action === 'edit-charge-item') return chargeItemForm(all('chargeItems').find(item => item.id === event.target.closest('[data-action]').dataset.id));
  if (action === 'open-rate') return rateForm();
  if (action === 'edit-rate') return rateForm(all('buffetRates').find(item => item.id === event.target.closest('[data-action]').dataset.id));
  if (action === 'deactivate-rate') {
    if (!canManageRates()) return toast('You do not have permission to change buffet rates.', 'error');
    const rate = all('buffetRates').find(item => item.id === event.target.closest('[data-action]').dataset.id);
    if (!rate || !await confirmInApp('Deactivate this buffet rate?', {
      title: 'Deactivate buffet rate',
      confirmLabel: 'Deactivate'
    })) return;
    const button = event.target.closest('[data-action]');
    const restoreButton = setButtonBusy(button, 'Deactivating…');
    if (!restoreButton) return;
    try {
      await save('buffetRates', all('buffetRates').map(item =>
        item.id === rate.id ? { ...item, isActive: false } : item
      ));
      toast('Buffet rate deactivated.');
      render();
    } catch (error) {
      console.error('Buffet rate could not be deactivated.', error);
      toast(friendlyRpcError(error), 'error');
    } finally {
      restoreButton();
    }
  }
  if (action === 'reservation-transition') {
    const button = event.target.closest('[data-action]');
    return transitionReservation(button.dataset.id, button.dataset.transition, button);
  }
  if (action === 'delete-reservation') {
    const button = event.target.closest('[data-action]');
    return deleteRecord('reservation', button.dataset.id, button);
  }
});
document.addEventListener('click', event => {
  const category = event.target.closest('[data-recipe-category]')?.dataset.recipeCategory;
  if (category) {
    state.recipeCategory = category;
    render();
    return;
  }
  const ingredientStatusFilter = event.target.closest('[data-ingredient-status-filter]')?.dataset.ingredientStatusFilter;
  if (ingredientStatusFilter) {
    state.ingredientExpiryFilter = ingredientStatusFilter === 'Expiring Soon';
    state.ingredientStatus = state.ingredientExpiryFilter ? 'All' : ingredientStatusFilter;
    render();
    return;
  }
  const inventoryHealthFilter = event.target.closest('[data-inventory-health-filter]')?.dataset.inventoryHealthFilter;
  if (inventoryHealthFilter) {
    state.ingredientStatus = inventoryHealthFilter;
    state.ingredientExpiryFilter = false;
    render();
    return;
  }
  const dashboardStatus = event.target.closest('[data-dashboard-status]')?.dataset.dashboardStatus;
  if (dashboardStatus) {
    state.ingredientStatus = dashboardStatus;
    state.ingredientExpiryFilter = false;
    setView('ingredients');
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const name = action.dataset.action;
  if (name === 'user-onboarding-open') openUserOnboardingWizard();
  else if (name === 'select-applicant-id-image' || name === 'change-applicant-id-image') chooseApplicantIdImage();
  else if (name === 'rotate-applicant-id-left') void rotateApplicantIdImage(-90);
  else if (name === 'rotate-applicant-id-right') void rotateApplicantIdImage(90);
  else if (name === 'reset-applicant-id-orientation') resetApplicantIdOrientation();
  else if (name === 'applicant-face-capture') void captureApplicantFace();
  else if (name === 'applicant-face-retake') retakeApplicantFacePhoto();
  else if (name === 'applicant-face-camera-retry') void startApplicantFaceCamera();
  else if (name === 'remove-applicant-id-image') {
    resetApplicantIdImage();
    updateApplicantIdUploadUi();
  }
  else if (name === 'applicant-review-next') {
    if (state.applicantReviewStep === 1) {
      if (!applicantIdImageValid || applicantIdImageLoading || applicantIdRotationLoading || applicantOcrLoading) return;
      void runApplicantIdOcr();
      return;
    }
    if (state.applicantReviewStep === 4) {
      if (!applicantFaceCaptureBlob) return;
      void runApplicantFaceMatch();
      return;
    }
    if (state.applicantReviewStep === 5 && applicantFaceMatchState === 'running') return;
    if (state.applicantReviewStep === 7 && !state.applicantReviewRole) {
      state.applicantReviewRoleError = true;
      renderApplicantReviewModal();
      return;
    }
    state.applicantReviewStep = Math.min(8, (state.applicantReviewStep || 1) + 1);
    renderApplicantReviewModal();
    if (state.applicantReviewStep === 4 && !applicantFaceCaptureBlob) void startApplicantFaceCamera();
  } else if (name === 'applicant-review-back') {
    if (state.applicantReviewStep === 4) stopApplicantFaceCamera();
    if (state.applicantReviewStep === 5) resetApplicantFaceMatch();
    state.applicantReviewStep = Math.max(1, (state.applicantReviewStep || 1) - 1);
    renderApplicantReviewModal();
    if (state.applicantReviewStep === 4 && !applicantFaceCaptureBlob) void startApplicantFaceCamera();
  } else if (name === 'applicant-review-proceed-create-account') {
    const role = state.applicantReviewRole;
    const roleCard = USER_ONBOARDING_ROLE_CARDS.find(item => item.value === role);
    if (!role) {
      state.applicantReviewStep = 7;
      state.applicantReviewRoleError = true;
      renderApplicantReviewModal();
      return;
    }
    if (!(window.costTrackInviteRoles || []).includes(role)) {
      applicantReviewProceedNotice = `${roleCard?.label || role} cannot be invited by the current account workflow. No account or verification record was created.`;
      renderApplicantReviewModal();
      return;
    }
    const verification = applicantRoleVerificationContext();
    const overrideReason = applicantReviewOverrideReason.trim();
    if (!verification.verificationPassed && !overrideReason) {
      applicantReviewProceedNotice = 'Manual review is required. Enter an Administrator override reason before proceeding.';
      renderApplicantReviewModal();
      return;
    }
    const idImage = applicantIdFileForOcr || applicantIdFile;
    if (!idImage || !applicantFaceCaptureBlob) {
      applicantReviewProceedNotice = 'The ID image or selfie is missing. Return to the verification steps and capture both images again.';
      renderApplicantReviewModal();
      return;
    }
    const faceResult = applicantFaceMatchResult;
    const idNumber = String(applicantOcrFields.id_number || '')
      .replace(/[^a-z0-9]/gi, '')
      .slice(-4);
    const verificationDraft = {
      applicantName: String(applicantOcrFields.full_name || '').trim(),
      idType: String(applicantOcrIdType || '').trim() || 'Unknown',
      idNumberMasked: idNumber ? `****${idNumber}` : null,
      ocrSummary: {
        full_name: String(applicantOcrFields.full_name || '').trim(),
        dob: String(applicantOcrFields.dob || '').trim(),
        address: String(applicantOcrFields.address || '').trim(),
        ocr_passed: verification.ocrPassed
      },
      faceMatchScore: Number.isFinite(faceResult?.similarityIndicator)
        ? faceResult.similarityIndicator
        : null,
      faceMatchResult: ['match', 'no_match'].includes(faceResult?.result)
        ? faceResult.result
        : 'unable',
      overrideUsed: !verification.verificationPassed,
      overrideReason: verification.verificationPassed ? null : overrideReason,
      idImage,
      selfie: applicantFaceCaptureBlob
    };
    closeModal(true);
    openUserManagementInviteModal(role, verificationDraft);
  } else if (name === 'applicant-review-invite') {
    const role = state.applicantReviewRole;
    const roleCard = USER_ONBOARDING_ROLE_CARDS.find(item => item.value === role);
    if (!role) {
      state.applicantReviewStep = 7;
      state.applicantReviewRoleError = true;
      renderApplicantReviewModal();
      return;
    }
    if (!(window.costTrackInviteRoles || []).includes(role)) {
      state.applicantReviewInviteError = `${roleCard?.label || role} is shown for onboarding preview, but the current invitation workflow does not support inviting this role. No invitation was sent.`;
      renderApplicantReviewModal();
      return;
    }
    const verification = applicantRoleVerificationContext();
    if (!verification.verificationPassed && !applicantReviewOverrideReason.trim()) {
      state.applicantReviewInviteError = 'Manual review requires an Administrator override reason.';
      renderApplicantReviewModal();
      return;
    }
    const idImage = applicantIdFileForOcr || applicantIdFile;
    if (!idImage || !applicantFaceCaptureBlob) {
      state.applicantReviewInviteError = 'The ID image or selfie is missing. Return to the verification steps and capture both images again.';
      renderApplicantReviewModal();
      return;
    }
    const faceResult = applicantFaceMatchResult;
    const idNumber = String(applicantOcrFields.id_number || '')
      .replace(/[^a-z0-9]/gi, '')
      .slice(-4);
    const verificationDraft = {
      applicantName: String(applicantOcrFields.full_name || '').trim(),
      idType: String(applicantOcrIdType || '').trim() || 'Unknown',
      idNumberMasked: idNumber ? `****${idNumber}` : null,
      ocrSummary: {
        full_name: String(applicantOcrFields.full_name || '').trim(),
        dob: String(applicantOcrFields.dob || '').trim(),
        address: String(applicantOcrFields.address || '').trim(),
        ocr_passed: verification.ocrPassed
      },
      faceMatchScore: Number.isFinite(faceResult?.similarityIndicator)
        ? faceResult.similarityIndicator
        : null,
      faceMatchResult: ['match', 'no_match'].includes(faceResult?.result)
        ? faceResult.result
        : 'unable',
      overrideUsed: !verification.verificationPassed,
      overrideReason: verification.verificationPassed ? null : applicantReviewOverrideReason.trim(),
      idImage,
      selfie: applicantFaceCaptureBlob
    };
    closeModal(true);
    openUserManagementInviteModal(role, verificationDraft);
  } else if (name === 'user-invite-open') openUserManagementInviteModal();
  else if (name === 'user-management-open') {
    if (state.role !== 'Administrator') return toast('Only Administrators can access User Management.', 'error');
    state.userManagementPane = 'workspace';
    state.userManagementTab = ['invitations', 'verification-records'].includes(action.dataset.tab)
      ? action.dataset.tab
      : 'staff';
    render();
    requestAnimationFrame(() => document.querySelector(userManagementTabSelector(state.userManagementTab))?.focus());
    if (state.userManagementTab === 'verification-records') void loadVerificationRecords();
  } else if (name === 'user-management-back') {
    state.userManagementPane = 'home';
    render();
    requestAnimationFrame(() => document.querySelector('[data-action="user-management-open"]')?.focus());
  } else if (name === 'user-management-tab') {
    state.userManagementTab = ['invitations', 'verification-records'].includes(action.dataset.tab)
      ? action.dataset.tab
      : 'staff';
    render();
    requestAnimationFrame(() => document.querySelector(userManagementTabSelector(state.userManagementTab))?.focus());
    if (state.userManagementTab === 'verification-records') void loadVerificationRecords();
  } else if (name === 'verification-record-open') openVerificationRecordDetail(action.dataset.id);
  else if (name === 'retry-verification-records') void retryVerificationRecordLoad();
  else if (name === 'open-user-role') {
    action.closest('details')?.removeAttribute('open');
    openUserRoleModal(action.dataset.id);
  } else if (name === 'open-user-status') {
    action.closest('details')?.removeAttribute('open');
    openUserStatusModal(action.dataset.id, action.dataset.status);
  } else if (name === 'resend-user-invite') void runUserInvitationAction(action.dataset.id, 'resend');
  else if (name === 'cancel-user-invite') void runUserInvitationAction(action.dataset.id, 'cancel');
  else if (name === 'retry-user-invites') void retryUserInvitationLoad();
  else if (name === 'refresh-user-management') void refreshUserManagementManually();
  else if (name === 'retry-user-management-refresh') void retryUserManagementLists();
  else if (name === 'close-modal') closeModal();
  else if (name === 'confirm-modal') finishConfirmation(document.querySelector('#modalRoot').lastElementChild, true);
  else if (name === 'open-recipe') openRecipeForm();
  else if (name === 'open-reservation') reservationForm();
  else if (name === 'edit-reservation') {
    const record = all('reservations').find(item => item.id === action.dataset.id);
    if (record) reservationForm(record);
  } else if (name === 'toggle-recipe-picker') document.querySelector('.recipe-picker').classList.toggle('is-hidden');
  else if (name === 'add-recipe-ingredient') {
    const form = document.querySelector('#modalForm');
    const ingredientId = form.elements.draftIngredient.value;
    const quantity = Number(form.elements.draftQuantity.value);
    if (!ingredientId) return toast('Choose an inventory ingredient.', 'error');
    if (!Number.isFinite(quantity) || quantity <= 0) return toast('Enter a quantity greater than zero.', 'error');
    if (state.recipeDraft.some(item => item.ingredientId === ingredientId)) {
      return toast('This ingredient is already listed. Edit its quantity instead.', 'error');
    }
    captureRecipeFormState(form);
    state.recipeDraft.push({ ingredientId, quantity });
    state.recipeForm.draftIngredient = '';
    state.recipeForm.draftQuantity = '';
    renderRecipeModal();
    state.modalDirty = true;
  } else if (name === 'remove-recipe-ingredient') {
    const form = document.querySelector('#modalForm');
    captureRecipeFormState(form);
    state.recipeDraft.splice(Number(action.dataset.index), 1);
    renderRecipeModal();
    state.modalDirty = true;
  } else if (name === 'product-lifecycle-delete-inactive') {
    void deleteInactiveProduct(action.dataset.id);
  } else if (name === 'product-lifecycle-delete' || name === 'product-lifecycle-reactivate') {
    const form = document.querySelector('#modalForm[data-type="product-lifecycle-actions"]');
    const lifecycleAction = name === 'product-lifecycle-delete' ? 'delete' : 'reactivate';
    void confirmProductLifecycleAction(lifecycleAction, form?.dataset.id || action.dataset.id);
  } else if (name === 'product-lifecycle-deactivate') {
    const form = document.querySelector('#modalForm[data-type="product-lifecycle-actions"]');
    const product = ingredient(form?.dataset.id || action.dataset.id);
    if (!product) return toast('This product is no longer available. Reload the page and try again.', 'error');
    void beginProductDeactivation(product);
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
  } else if (name.startsWith('delete-')) deleteRecord(name.replace('delete-', ''), action.dataset.id, action);
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

      let successMessage = 'Password updated. You are signed in.';
      if (invitationAcceptanceMode) {
        const { error: invitationError } = await window.supabaseClient.functions.invoke('invite-user', {
          body: { action: 'accept' }
        });
        if (invitationError) {
          console.error('Invitation acceptance could not be recorded.', invitationError);
          successMessage = 'Password updated, but invitation status could not be recorded. Contact an Administrator.';
        } else {
          successMessage = 'Password updated. Your invitation is accepted.';
        }
      }

      passwordRecoveryMode = false;
      invitationAcceptanceMode = false;
      window.costTrackInviteLink = false;
      window.location.hash = '';
      toast(successMessage);
      const { data, error: sessionError } = await window.supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      await openAuthenticatedSession(data.session);
    } catch (error) {
      console.error('Password update failed.', error);
      login(error.message || 'Password update failed. Request a new reset link.');
    }
  }
  if (formId === 'modalForm') {
    event.preventDefault();
    if (event.target.dataset.type === 'product-lifecycle') {
      await submitProductLifecycle(event.target, Object.fromEntries(new FormData(event.target)));
      return;
    }
    if (event.target.dataset.type === 'user-invite') {
      await submitUserInvitation(event.target);
      return;
    }
    if (event.target.dataset.type === 'user-role-change') {
      await submitUserRoleChange(event.target);
      return;
    }
    if (event.target.dataset.type === 'user-account-status') {
      await submitUserAccountStatus(event.target);
      return;
    }
    handleSubmit(event.target);
  }
});
document.addEventListener('input', event => {
  const searchInput = event.target;
  if (searchInput.matches('[data-party-search]')) {
    state.billWizard.query = searchInput.value;
    const position = searchInput.selectionStart;
    renderBillWizard();
    const replacement = document.querySelector('[data-party-search]');
    replacement?.focus();
    replacement?.setSelectionRange(position, position);
    return;
  }
  if (searchInput.matches('[data-wizard-count]')) {
    const field = searchInput.name;
    if (['adultCount', 'seniorCount', 'kidsCount', 'compedCount'].includes(field)) {
      state.billWizard[field] = Math.max(0, Number(searchInput.value || 0));
      state.modalDirty = true;
    }
    return;
  }
  if (searchInput.id === 'userManagementSearch') {
    state.userManagementSearch = searchInput.value;
    const query = state.userManagementSearch.toLowerCase();
    const rows = document.querySelectorAll('.user-management-page .user-row');
    let visibleRows = 0;
    rows.forEach(row => {
      row.hidden = !row.dataset.userSearch.includes(query);
      if (!row.hidden) visibleRows++;
    });
    const count = document.querySelector('#userManagementCount');
    const emptyState = document.querySelector('.user-management-page .user-management-empty-row');
    if (count) count.textContent = `${visibleRows} staff member${visibleRows === 1 ? '' : 's'}`;
    if (emptyState) emptyState.hidden = visibleRows > 0;
    return;
  }
  if (searchInput.id === 'verificationRecordSearch') {
    state.verificationRecordHistory.search = searchInput.value;
    window.clearTimeout(verificationRecordSearchTimer);
    verificationRecordSearchTimer = window.setTimeout(
      () => void loadVerificationRecords(true, state.verificationRecordHistory.search),
      300
    );
    return;
  }
  if (searchInput.id !== 'tableSearch') return;
  state.query = searchInput.value;
  Object.keys(state.tablePages).forEach(key => { state.tablePages[key] = 1; });
  const selectionStart = searchInput.selectionStart ?? searchInput.value.length;
  const selectionEnd = searchInput.selectionEnd ?? selectionStart;
  render();
  const replacement = document.querySelector('#tableSearch');
  replacement?.focus();
  replacement?.setSelectionRange(selectionStart, selectionEnd);
});
document.addEventListener('keydown', event => {
  const tab = event.target.closest('.user-management-tabs [role="tab"]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = ['staff', 'invitations', 'verification-records'];
  const currentIndex = tabs.indexOf(state.userManagementTab);
  let nextIndex = currentIndex;
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabs.length - 1;
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
  state.userManagementTab = tabs[nextIndex];
  render();
  requestAnimationFrame(() => document.querySelector(userManagementTabSelector(state.userManagementTab))?.focus());
  if (state.userManagementTab === 'verification-records') void loadVerificationRecords();
});
document.addEventListener('input', event => {
  if (event.target.id !== 'tableManagementSearch') return;
  state.tableManagementQuery = event.target.value;
  const position = event.target.selectionStart;
  render();
  const search = document.querySelector('#tableManagementSearch');
  search?.focus();
  search?.setSelectionRange(position, position);
});
document.addEventListener('input', event => {
  const form = event.target.closest('#modalForm[data-type="shift-close"]');
  if (!form || event.target.name !== 'countedCash') return;
  const variance = Number(event.target.value || 0) - Number(form.elements.countedCash.defaultValue || 0);
  const output = form.querySelector('[data-shift-variance]');
  if (!output) return;
  output.textContent = `${variance > 0 ? '+' : ''}${money(variance)}`;
  output.classList.toggle('cash-variance-over', variance > 0);
  output.classList.toggle('cash-variance-short', variance < 0);
});
document.addEventListener('input', event => {
  const form = event.target.closest('#modalForm[data-type="recipe"]');
  if (!form) return;
  const quantityInput = event.target.closest('[data-recipe-quantity]');
  if (quantityInput) {
    const index = Number(quantityInput.dataset.recipeQuantity);
    if (state.recipeDraft[index]) state.recipeDraft[index].quantity = Number(quantityInput.value);
  }
  captureRecipeFormState(form);
  updateRecipeDraftUnit(form);
  updateRecipeCostPanel(form);
});
document.addEventListener('change', event => {
  const form = event.target.closest('#modalForm[data-type="recipe"]');
  if (!form) return;
  if (event.target.name === 'draftIngredient') {
    updateRecipeDraftUnit(form);
    updateRecipeCostPanel(form);
  }
});
document.addEventListener('change', event => {
  const wasteForm = event.target.closest('#modalForm[data-type="waste"]');
  if (wasteForm) {
    if (event.target.matches('input[type="radio"][name="wasteType"]')) {
      setWasteFormType(wasteForm);
      state.modalDirty = true;
    }
    updateWasteFormPreview(wasteForm);
    if (event.target.matches('input[type="radio"][name="reason"]')) {
      state.modalDirty = true;
      wasteForm.elements.notes.required = event.target.value === 'Other';
      wasteForm.querySelector('[data-waste-reason-group]')?.classList.remove('has-error');
      wasteForm.querySelector('[data-waste-reason-error]').hidden = true;
      wasteForm.querySelectorAll('input[type="radio"][name="reason"]').forEach(radio => radio.removeAttribute('aria-invalid'));
    }
    if (event.target.matches('input[type="radio"][name="preparedReason"]')) {
      state.modalDirty = true;
      wasteForm.elements.preparedNotes.required = event.target.value === 'Other';
      wasteForm.querySelector('[data-prepared-waste-reason-group]')?.classList.remove('has-error');
      wasteForm.querySelector('[data-prepared-waste-reason-error]').hidden = true;
      wasteForm.querySelectorAll('input[type="radio"][name="preparedReason"]').forEach(radio => radio.removeAttribute('aria-invalid'));
    }
    if (event.target.matches('[name="productionBatchId"]')) {
      const selectedOption = event.target.selectedOptions[0];
      if (selectedOption?.dataset.dishName) {
        wasteForm.elements.dishName.value = selectedOption.dataset.dishName;
      }
      wasteForm.elements.dishName.readOnly = Boolean(selectedOption?.dataset.dishName);
    }
    if (event.target.matches('[name="preparedDate"]')) {
      wasteForm.elements.productionBatchId.value = '';
      wasteForm.elements.dishName.readOnly = false;
      refreshPreparedWasteBatches(wasteForm, event.target.value);
    }
  }
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
  if (event.target.matches('[data-low-stock-filter]')) { state.ingredientStatus = event.target.checked ? 'Low Stock' : 'All'; state.ingredientExpiryFilter = false; render(); }
  if (event.target.matches('[data-date-range]')) {
    state.dateRange = event.target.value;
    state.reportPage = 1;
    if (state.dateRange === 'custom') {
      state.customDateTo ||= manilaBusinessToday();
      if (!state.customDateFrom) {
        const startDate = new Date(`${state.customDateTo}T12:00:00`);
        startDate.setDate(startDate.getDate() - 29);
        state.customDateFrom = localDateStr(startDate);
      }
    }
    render();
  }
  if (event.target.matches('[data-report-group]')) { state.reportGrouping = event.target.value; state.reportPage = 1; render(); }
  if (event.target.matches('[data-report-waste]')) { state.reportIncludeWaste = event.target.checked; state.reportPage = 1; render(); }
  if (event.target.matches('[data-custom-date]')) { state[`customDate${event.target.dataset.customDate === 'from' ? 'From' : 'To'}`] = event.target.value; state.reportPage = 1; render(); }
  if (event.target.matches('[data-reservation-meal]')) { state.reservationMealPeriodFilter = event.target.value === 'All' ? 'All' : event.target.value; state.reservationFilterHighlightGroup = 'meal'; persistReservationFilters(); render(); }
  if (event.target.matches('[data-reservation-source-filter]')) {
    state.reservationSourceFilter = event.target.value;
    state.reservationFilterHighlightGroup = 'source';
    persistReservationFilters();
    render();
  }
  if (event.target.matches('[data-reservation-list-date]')) {
    state.calendarDate = event.target.value || today();
    state.reservationFilter = 'All';
    state.reservationDateFilter = 'All';
    state.reservationFilterHighlightGroup = 'date';
    state.reservationMealPeriodFilter = 'All';
    state.query = '';
    persistReservationFilters();
    render();
  }
});
document.addEventListener('change', event => {
  if (event.target.matches('[data-confirm-count-change]')) {
    state.billWizard.countsConfirmed = event.target.checked;
    state.modalDirty = true;
    return;
  }
  const form = event.target.closest('#modalForm[data-type="count"]');
  if (!form || !event.target.matches('[name="ingredientId"]')) return;
  const selectedProduct = ingredient(event.target.value);
  const expectedStock = Number(selectedProduct?.stock);
  form.elements.expected.value = Number.isFinite(expectedStock) ? String(expectedStock) : '';
  form.elements.actual.value = '';
  updatePhysicalCountPreview(form);
});
document.addEventListener('input', event => {
  const form = event.target.closest('#modalForm[data-type="count"]');
  if (form && event.target.matches('[name="actual"]')) updatePhysicalCountPreview(form);
});
document.addEventListener('change', event => {
  const form = event.target.closest('#modalForm[data-type="reservation"]');
  if (form && event.target.matches('[name="date"],[name="time"],[name="adults"],[name="seniorPwdCount"],[name="children"]')) {
    if (event.target.matches('[name="date"]')) refreshReservationTimeOptions(form);
    if (form.dataset.reservationWizardStep) {
      if (form.dataset.reservationWizardStep === '1') {
        const total = Number(form.elements.adults.value || 0)
          + Number(form.elements.seniorPwdCount.value || 0)
          + Number(form.elements.children.value || 0);
        const totalTarget = form.querySelector('[data-reservation-step-total]');
        if (totalTarget) totalTarget.textContent = String(total);
        const mealTarget = form.querySelector('[data-reservation-step-meal]');
        if (mealTarget) mealTarget.textContent = form.elements.time.value
          ? reservationMealPeriod(form.elements.time.value)
          : 'Choose a time';
      }
      return;
    }
    refreshReservationTables(form);
    return;
  }
  const billFormElement = event.target.closest('#modalForm[data-type="bill"]');
  if (billFormElement && event.target.matches('[name="reservationId"],[name="adultCount"],[name="seniorCount"],[name="kidsCount"]')) {
    updateBillHeadcountWarning(billFormElement);
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
    'Inventory Clerk': ['ingredients', 'inventoryTransactions', 'inventoryBatches', 'physicalCounts', 'wasteLogs', 'preparedFoodWasteLogs', 'notifications', 'auditLogs'],
    'Chef / Kitchen Staff': ['ingredients', 'inventoryBatches', 'recipes', 'productionLogs', 'wasteLogs', 'preparedFoodWasteLogs', 'notifications', 'auditLogs'],
    Receptionist: ['reservations', 'restaurantTables', 'buffetRates', 'chargeItems', 'packageTiers', 'discounts', 'posSettings', 'shifts', 'cashMovements', 'posBills', 'billLines', 'billPayments', 'reservationDeposits', 'billApprovals', 'notifications', 'auditLogs']
  };
  const collections = collectionsByRole[state.role] || [];
  setSyncState('syncing', 'Loading the latest restaurant data.', 'Syncing…');
  supabaseSyncEnabled = false;
  state.productionBoard = { date: '', rows: [], loading: false, loaded: false, error: '' };
  state.productionHistoryOpen = false;
  state.productionHistory = {
    from: '', to: '', timeFrom: '', timeTo: '', dish: 'All', status: 'All',
    rows: [], loading: false, loaded: false, error: ''
  };
  const pendingCollections = Object.fromEntries(KEYS.map(key => [key, []]));
  if (['Administrator', 'Manager'].includes(state.role)) {
    try {
      await window.supabaseRecord.posRefreshNotifications();
    } catch (error) {
      throw new Error(`Manager notifications failed to refresh: ${error.message}`);
    }
  }
  for (const key of collections) {
    try {
      pendingCollections[key] = await window.supabaseRecord.load(key);
    } catch (error) {
      throw new Error(`Could not load the "${key}" collection for ${state.role}: ${error.message}`);
    }
  }
  try {
    state.notificationReadKeys = await window.supabaseRecord.notificationReadKeys();
  } catch (error) {
    throw new Error(`Notification state could not be loaded: ${error.message}`);
  }
  KEYS.forEach(key => { collectionState[key] = pendingCollections[key]; });
  supabaseSyncEnabled = true;
  realtimeNeedsResync = false;
  invalidateReportData();
  revenueDashboardData = null;
  revenueDashboardError = '';
  if (revenueDashboardLoading) revenueDashboardRefreshAfterLoad = true;
  setPostSaveSyncState();
  render();
}
async function openAuthenticatedSession(session) {
  if (!session?.user) throw new Error('No authenticated Supabase session was returned.');
  const { data: profile, error } = await window.supabaseClient
    .from('profiles')
    .select('id,email,full_name,role,account_status')
    .eq('id', session.user.id)
    .single();
  if (!error && profile && profile.account_status !== 'Active') {
    await window.supabaseClient.auth.signOut();
    throw new Error(
      profile.account_status === 'Pending'
        ? 'Your invitation has not been accepted yet.'
        : 'Your CostTrack account is not active. Contact an Administrator.'
    );
  }
  if (error || !profile || !roleAccess[profile.role]) {
    await window.supabaseClient.auth.signOut();
    throw new Error('Your account has no valid ROMS role profile. Ask an administrator to provision your profile.');
  }
  state.user = profile;
  state.role = profile.role;
  resetUserInviteHistory();
  state.unresolvedBookings = { rows: [], loading: false, loaded: false, error: '' };
  window.supabaseRecord.clearVersions();
  const requestedView = window.location.hash.slice(1) || 'dashboard';
  state.view = 'dashboard';
  state.focusPageAfterNavigation = false;
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
    toast(`Cloud data could not be loaded: ${syncError.message}`, 'error');
  }
  render();
}
async function signOutCurrentUser({ force = false } = {}) {
  await stopRealtimeSubscriptions();
  const { error } = await window.supabaseClient.auth.signOut();
  if (error && !force) {
    toast('Sign out failed. Please try again.', 'error');
    console.error('Sign out failed.', error);
    return;
  }
  if (error) console.error('Inactive account session could not be revoked.', error);
  closeMobileDrawer(false);
  closeShellPopovers(false);
  state.user = null;
  state.role = null;
  realtimeNeedsResync = false;
  resetUserInviteHistory();
  state.unresolvedBookings = { rows: [], loading: false, loaded: false, error: '' };
  state.notificationReadKeys = [];
  state.notificationViewAll = false;
  state.notificationMarkingRead = false;
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
    toast(`Cloud sync retry failed: ${error.message}`, 'error');
  }
}
document.querySelector('#syncStatus').addEventListener('click', () => {
  if (document.querySelector('#syncStatus').dataset.state === 'error') retryCloudSync();
});
document.querySelector('#discardSyncButton').classList.add('is-hidden');
document.addEventListener('click', event => {
  const target = event.target;
  const popoverTrigger = target.closest('[data-popover-trigger]');
  const viewLink = target.closest('[data-view]');
  const groupToggle = target.closest('#sidebar [data-action="toggle-nav-group"]');
  const shellAction = target.closest('[data-shell-action]');
  const createAction = target.closest('[data-create-action]');
  const notificationItem = target.closest('[data-notification-key]');
  const notificationMarkAll = target.closest('[data-notification-mark-all]');
  const notificationViewAll = target.closest('[data-notification-view-all]');
  const notificationCenterFilter = target.closest('[data-notification-center-filter]');
  const notificationCenterPageButton = target.closest('[data-notification-center-page]');
  const notificationCenterMarkAll = target.closest('[data-notification-center-mark-all]');
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
  if (notificationCenterFilter) {
    event.preventDefault();
    state.notificationCenterFilter = notificationCenterFilter.dataset.notificationCenterFilter;
    state.notificationCenterPage = 1;
    render();
    return;
  }
  if (notificationCenterPageButton) {
    event.preventDefault();
    state.notificationCenterPage = Number(notificationCenterPageButton.dataset.notificationCenterPage);
    render();
    return;
  }
  if (notificationCenterMarkAll) {
    event.preventDefault();
    markAllNotificationsRead();
    return;
  }
  if (notificationMarkAll) {
    event.preventDefault();
    markAllNotificationsRead();
    return;
  }
  if (notificationViewAll) {
    event.preventDefault();
    state.notificationViewAll = !state.notificationViewAll;
    rerenderNotificationPopover(true);
    return;
  }
  if (notificationItem) {
    event.preventDefault();
    openNotification(notificationItem.dataset.notificationKey);
    return;
  }
  if (popoverTrigger) {
    event.preventDefault();
    toggleShellPopover(popoverTrigger.dataset.popoverTrigger, popoverTrigger);
    if (popoverTrigger.dataset.popoverTrigger === 'notifications'
      && !document.querySelector('[data-popover-panel="notifications"]')?.hidden) {
      refreshNotificationSourcesOnOpen();
    }
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
document.addEventListener('input', event => {
  if (!event.target.matches('[data-notification-center-search]')) return;
  state.notificationCenterQuery = event.target.value;
  state.notificationCenterPage = 1;
  render();
  requestAnimationFrame(() => {
    const search = document.querySelector('[data-notification-center-search]');
    if (search) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  });
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
  const passwordToggle = event.target.closest('[data-login-password-toggle]');
  if (passwordToggle) {
    const input = passwordToggle.closest('.login-field').querySelector('input');
    const showPassword = input.type === 'password';
    input.type = showPassword ? 'text' : 'password';
    passwordToggle.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
    passwordToggle.setAttribute('aria-pressed', String(showPassword));
    return;
  }
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
    resetUserInviteHistory();
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
  if (data.session && passwordRecoveryMode) {
    document.querySelector('#loadingState').classList.add('is-hidden');
    login();
    return;
  }
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
const modalContexts = new WeakMap();
let modalSequence = 0;
function modal(title, content, submit = 'Save record', modalClass = '', modalType = 'form') {
  const root = document.querySelector('#modalRoot');
  const isConfirmation = modalType === 'confirmation';
  const hasExistingModal = Boolean(root.firstElementChild);
  const opener = isConfirmation ? document.activeElement : hasExistingModal ? modalOpener : document.activeElement;
  if (!hasExistingModal) {
    modalOpener = opener;
    state.modalDirty = false;
  }
  const sequence = ++modalSequence;
  const titleId = `modalTitle-${sequence}`;
  const formId = isConfirmation ? `modalConfirmationForm-${sequence}` : 'modalForm';
  const closeLabel = ['read-only', 'popover', 'menu'].includes(modalType) ? '×' : 'Cancel';
  const closeAriaLabel = closeLabel === '×' ? 'Close dialog' : closeLabel;
  const actions = isConfirmation
    ? `<div class="modal-actions"><button type="button" class="ghost-btn" data-action="close-modal" aria-label="${closeAriaLabel}">${closeLabel}</button><button type="button" class="primary-btn" data-action="confirm-modal">${submit || 'Continue'}</button></div>`
    : modalClass === 'applicant-review-modal'
      ? ''
      : `<div class="modal-actions${modalClass === 'pos-wizard-modal' ? ' pos-wizard-footer' : ''}"><div class="pos-wizard-footer-left">${modalClass === 'pos-wizard-modal' && submit && state.billWizard.screen > 1 ? '<button type="button" class="ghost-btn" data-action="bill-wizard-back">← Back</button>' : ''}</div><div class="pos-wizard-footer-right"><button type="button" class="ghost-btn" data-action="close-modal" aria-label="${closeAriaLabel}">${closeLabel}</button>${submit ? `<button class="primary-btn modal-submit" type="submit">${submit}</button>` : ''}</div></div>`;
  const markup = `<div class="modal-backdrop" role="presentation"><div class="modal${modalClass ? ` ${esc(modalClass)}` : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1" data-modal-type="${esc(modalType)}"><div class="modal-header"><div><div class="eyebrow">ROMS workspace</div><h2 id="${titleId}">${title}</h2></div><button type="button" class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button></div><form id="${formId}" novalidate data-modal-type="${esc(modalType)}">${content}${actions}</form></div></div>`;
  if (isConfirmation) root.insertAdjacentHTML('beforeend', markup);
  else root.innerHTML = markup;
  const backdrop = root.lastElementChild;
  modalContexts.set(backdrop, { type: modalType, opener, resolve: null });
  const form = backdrop.querySelector(`#${formId}`);
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
  return backdrop;
}

function restoreModalFocus(opener = modalOpener) {
  if (!opener) return;
  const action = opener.dataset?.action;
  const recordId = opener.dataset?.id;
  const replacement = [...document.querySelectorAll('[data-action]')].find(element =>
    element.dataset.action === action && element.dataset.id === recordId
  );
  const focusTarget = replacement || (opener.isConnected ? opener : null);
  requestAnimationFrame(() => focusTarget?.focus());
  if (!document.querySelector('#modalRoot').firstElementChild) modalOpener = null;
}

function finishConfirmation(backdrop, result) {
  const context = modalContexts.get(backdrop);
  if (!context || context.type !== 'confirmation') return;
  backdrop.remove();
  context.resolve?.(result);
  if (context.opener?.isConnected) requestAnimationFrame(() => context.opener.focus());
}

function confirmInApp(message, {
  title = 'Please confirm',
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  modalClass = 'confirmation-modal'
} = {}) {
  return new Promise(resolve => {
    const backdrop = modal(title, `<p class="confirmation-message">${esc(message).replace(/\n/g, '<br>')}</p>`, confirmLabel, modalClass, 'confirmation');
    const context = modalContexts.get(backdrop);
    context.resolve = resolve;
    backdrop.querySelector('.modal-actions [data-action="close-modal"]').textContent = cancelLabel;
  });
}

function closeModal(force = false) {
  const root = document.querySelector('#modalRoot');
  const backdrop = root.lastElementChild;
  if (!backdrop) return false;
  const context = modalContexts.get(backdrop);
  if (context?.type === 'confirmation') {
    finishConfirmation(backdrop, false);
    return true;
  }
  const form = backdrop.querySelector('#modalForm');
  if (!force && form?.dataset.saving === 'true') {
    toast('Please wait for the save to finish before closing this dialog.', 'error');
    return false;
  }
  if (state.modalDirty && !force) {
    confirmInApp('Discard unsaved changes?', {
      title: 'Discard changes?',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      modalClass: 'discard-confirmation-modal'
    }).then(discard => {
      if (!discard) return;
      state.modalDirty = false;
      closeModal(true);
    });
    return false;
  }
  if (backdrop.querySelector('.applicant-review-modal')) {
    resetApplicantFaceCapture();
    resetApplicantIdImage();
  }
  backdrop.remove();
  if (!root.firstElementChild) {
    state.modalDirty = false;
    restoreModalFocus(context?.opener);
  } else if (context?.opener?.isConnected) {
    requestAnimationFrame(() => context.opener.focus());
  }
  return true;
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
  form.querySelectorAll('[data-waste-reason-error],[data-prepared-waste-reason-error]').forEach(error => { error.hidden = true; });
}

function normaliseRenderedStatuses() {
  document.querySelectorAll('.status, .stock-state').forEach(element => {
    const value = element.textContent.trim().toLowerCase();
    const tableAvailability = element.dataset.tableAvailability;
    const kind = tableAvailability === 'Available' ? 'good'
      : ['Reserved', 'Reserved Later'].includes(tableAvailability) ? 'low'
        : ['Reserved Active', 'Occupied', 'Needs cleaning'].includes(tableAvailability) ? 'out'
            : value.includes('cancel') || value.includes('expired') || value.includes('deactivated') || value.includes('inactive')
              ? 'out' : value.includes('pending') ? 'low' : value.includes('out') ? 'out' : value.includes('low') || value.includes('short') ? 'low' : value.includes('over') ? 'over' : 'healthy';
    element.classList.remove('status-good', 'status-low', 'status-out', 'status-over', 'healthy', 'low', 'out', 'over');
    element.classList.add(`status-${kind}`);
    element.insertAdjacentHTML('afterbegin', `<span class="status-dot" aria-hidden="true"></span>`);
  });
}

function render({ preserveReportCharts = false } = {}) {
  destroyReservationCalendar();
  let reportChartsReused = false;
  const previousReportChartGrid = preserveReportCharts && state.view === 'reports'
    ? app.querySelector('.report-chart-grid')
    : null;
  if (!previousReportChartGrid) {
    reportCharts.forEach(chart => chart.destroy());
    reportCharts = [];
  }
  reportChartSpecs = [];
  if (!state.user || !state.role) return;
  if (state.view === 'notifications' && !['Administrator', 'Manager'].includes(state.role)) {
    document.querySelector('#sidebar').innerHTML = nav();
    renderShellChrome();
    document.querySelector('#pageCrumb').textContent = 'Access denied';
    app.innerHTML = '<section class="notification-center-page"><div class="panel error-state" role="alert"><strong>Access denied.</strong><p>The Notification Center is available to Administrators and Managers only.</p></div></section>';
    return;
  }
  if (state.view === 'users' && state.role !== 'Administrator') {
    document.querySelector('#sidebar').innerHTML = nav();
    renderShellChrome();
    document.querySelector('#pageCrumb').textContent = 'Access denied';
    app.innerHTML = '<section class="user-management-page"><div class="panel error-state" role="alert"><strong>Access denied.</strong><p>User Management is available to Administrators only.</p></div></section>';
    return;
  }
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
  if (['reservations', 'tables'].includes(state.view)
    && !state.unresolvedBookings.loaded
    && !state.unresolvedBookings.loading) {
    loadUnresolvedBookings();
  }
  document.querySelector('#sidebar').innerHTML = nav();
  renderShellChrome();
  const moduleNames = { dashboard: 'Overview', notifications: 'System Management', 'activity-logs': 'System Management', ingredients: 'Inventory Management', receiving: 'Inventory Management', counts: 'Inventory Management', recipes: 'Kitchen Operations', production: 'Kitchen Operations', waste: 'Kitchen Operations', reservations: 'Front of House', calendar: 'Front of House', tables: 'Front of House', cashier: 'Front of House', shifts: 'Front of House', approvals: 'Front of House', revenue: 'Revenue Management', rates: 'Revenue Management', 'charge-catalog': 'Revenue Management', reports: 'Analytics & Reports', users: 'System Management' };
  const pageNames = { dashboard: 'Dashboard', notifications: 'Notifications', 'activity-logs': 'Activity Log', ingredients: 'Ingredients', receiving: 'Receiving', recipes: 'Recipes', production: 'Buffet production', waste: 'Waste logs', counts: 'Physical count', reports: 'Reports & analytics', revenue: 'Revenue Tracking', rates: 'Buffet rates', 'charge-catalog': 'Charge catalog', users: 'User Management', reservations: 'Reservations', calendar: 'Tables / Calendar', tables: 'Table management', cashier: 'Cashier', shifts: 'Shifts', approvals: 'Approvals' };
  const activeGroup = sidebarGroups.find(group => group.items.some(([view]) => view === state.view));
  const crumbLabel = state.view === 'dashboard' ? 'Overview' : (moduleNames[state.view] || 'Workspace');
  const crumbTarget = activeGroup?.items.find(([view]) => canAccess(view))?.[0] || 'dashboard';
  document.querySelector('.breadcrumb').innerHTML = `<a class="crumb-parent" href="#${crumbTarget}" data-view="${crumbTarget}">${esc(crumbLabel)}</a><span aria-hidden="true">›</span><strong id="pageCrumb" tabindex="-1">${esc(pageNames[state.view] || state.view)}</strong>`;
  const pages = { dashboard: roleDashboard, notifications: notificationCenterPage, 'activity-logs': activityLogsPage, ingredients: ingredientCardsPage, receiving: () => receivingPage(), recipes: recipeCardsPage, production: productionBoardPage, waste: () => logsPage('waste'), counts: () => countsPage(), reports: reportsPage, revenue: revenuePage, rates: () => ratesPage(), 'charge-catalog': chargeCatalogPage, cashier: cashierPage, shifts: shiftsPage, approvals: approvalsPage, users: () => usersPage(), reservations: reservationsPage, calendar: calendarPage, tables: tableManagementPage };
  const renderPage = pages[state.view];
  if (!renderPage) {
    console.error(`No page renderer is registered for "${state.view}".`);
    app.innerHTML = '<div class="panel error-state" role="alert">This module is unavailable. Please return to the dashboard or contact your administrator.</div>';
    return;
  }
  const approvalsScrollLeft = state.view === 'approvals'
    ? document.querySelector('.table-panel .table-scroll')?.scrollLeft || 0
    : null;
  try {
    const pageMarkup = renderPage();
    if (previousReportChartGrid) {
      const stagedPage = document.createElement('div');
      stagedPage.innerHTML = pageMarkup;
      const nextChartGrid = stagedPage.querySelector('.report-chart-grid');
      const canReuseCharts = nextChartGrid
        && reportCharts.length === reportChartSpecs.length
        && reportChartSpecs.every((spec, index) => (
          reportCharts[index].canvas?.id === spec.id
          && reportCharts[index].config.type === spec.type
        ));
      if (canReuseCharts) {
        nextChartGrid.replaceWith(previousReportChartGrid);
        app.replaceChildren(...stagedPage.childNodes);
        updateReportChartsFromSpecs();
        reportChartsReused = true;
      } else {
        reportCharts.forEach(chart => chart.destroy());
        reportCharts = [];
        app.innerHTML = pageMarkup;
      }
    } else {
      app.innerHTML = pageMarkup;
    }
    app.querySelectorAll('[data-action="resolve-stale-booking"]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        staleBookingResolutionForm(button.dataset.id);
      });
    });
    if (approvalsScrollLeft !== null) {
      const tableScroll = app.querySelector('.table-panel .table-scroll');
      if (tableScroll) tableScroll.scrollLeft = approvalsScrollLeft;
    }
  } catch (error) {
    reportCharts.forEach(chart => chart.destroy());
    reportCharts = [];
    console.error(`Could not render the ${state.view} module.`, error);
    app.innerHTML = `<div class="panel error-state" role="alert">Could not load ${esc(pageNames[state.view] || state.view)}. Please refresh the page. Check the browser console for details.</div>`;
    return;
  }
  if (['dashboard', 'revenue'].includes(state.view) && canAccessRevenue()) loadRevenueDashboard();
  if (state.view === 'reservations' && state.unresolvedFocusId) {
    const target = [...app.querySelectorAll('[data-unresolved-reservation]')]
      .find(element => element.dataset.id === state.unresolvedFocusId);
    if (target) {
      state.unresolvedFocusId = '';
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  if (state.view === 'calendar') initializeReservationCalendar();
  if (state.view === 'reports' && !reportChartsReused) initializeReportCharts();
  if (state.view === 'reports') loadReportData();
  configureRealtimeSubscriptions().catch(error => {
    console.error('Realtime subscription setup failed.', error);
    setSyncState(navigator.onLine ? 'reconnecting' : 'offline', error.message);
  });
  if (['production', 'recipes'].includes(state.view)) {
    loadProductionBoard();
  }
  if (state.view === 'users' && state.role === 'Administrator') loadUserInvitations();
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
  if (!isLiveTableView && state.view !== 'production') return;
  const scrollY = window.scrollY;
  const focusedId = document.activeElement?.id;
  render();
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
  window.scrollTo(0, scrollY);
}, 60 * 1000);
window.setInterval(async () => {
  if (!state.user || document.hidden || !['Administrator', 'Manager'].includes(state.role)) return;
  try {
    await window.supabaseRecord.posRefreshNotifications();
    persistCollection('posNotifications', await window.supabaseRecord.load('posNotifications'));
    if (state.view === 'shifts' && !document.querySelector('#modalForm')) render();
  } catch (error) {
    console.error('POS notifications could not be refreshed.', error);
    setSyncState('reconnecting', error.message);
  }
}, 5 * 60 * 1000);

function actions(type, itemId, item = null, { includeView = true } = {}) {
  const labels = { view: 'View', edit: 'Edit', delete: 'Delete' };
  const icon = name => name === 'view' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>' : name === 'edit' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5Z"/><path d="m14 6.5 3.5 3.5"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>';
  const viewable = ['ingredient', 'recipe'].includes(type);
  const editable = (type === 'ingredient' && window.CostTrackLogic.canPerformInventoryAction(state.role, 'product.manage'))
    || (type === 'recipe' && window.CostTrackLogic.canPerformInventoryAction(state.role, 'recipe.manage'));
  const lifecycleAction = type === 'ingredient' && state.role === 'Administrator' && item?.isActive === false
    ? `<button type="button" class="product-lifecycle-action" data-action="product-lifecycle-delete-inactive" data-id="${esc(itemId)}" aria-label="Delete inactive ${esc(item?.name || 'product')}"><span class="tooltip">Delete inactive product</span>${icon('delete')}</button>`
    : '';
  return `<div class="row-actions">${viewable && includeView ? `<button type="button" data-action="view-${type}" data-id="${itemId}" aria-label="${labels.view}"><span class="tooltip">${labels.view}</span>${icon('view')}</button>` : ''}${editable ? `<button type="button" data-action="edit-${type}" data-id="${itemId}" aria-label="${labels.edit}"><span class="tooltip">${labels.edit}</span>${icon('edit')}</button>` : ''}${lifecycleAction}</div>`;
}

async function deleteRecord(type, itemId, button = null) {
  if (type === 'ingredient') return manageProductLifecycle(itemId);
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
  if (!await confirmInApp(`Delete ${name}? This can't be undone.`, {
    title: 'Delete record',
    confirmLabel: 'Delete'
  })) return;
  const restoreButton = setButtonBusy(button, 'Deleting…');
  if (button && !restoreButton) return;
  try {
    if (type === 'reservation') await removeRecord(key, itemId);
    else await save(key, all(key).filter(item => item.id !== itemId));
  } catch (error) {
    console.error(`Could not delete ${type}.`, error);
    toast(friendlyRpcError(error), 'error');
    return;
  } finally {
    restoreButton?.();
  }
  toast(`${name} deleted`);
  render();
}

function exportRecipeReport(format) {
  const rows = [
    ['Recipe', 'Cost per portion', 'Total batch cost', 'Portions per base recipe', 'Ingredient count', 'Status'],
    ...all('recipes').map(item => {
      const breakdown = recipeCostBreakdown(item);
      return [
        item.name,
        breakdown.costPerPortion,
        breakdown.totalBatchCost,
        breakdown.batchYield,
        item.ingredients.length,
        window.CostTrackLogic.isRecipeActive(item) ? 'Active' : 'Inactive'
      ];
    })
  ];
  if (format === 'Excel') {
    if (!window.XLSX) throw new Error('Excel export is unavailable. Check your connection and try again.');
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, window.XLSX.utils.aoa_to_sheet(rows), 'Recipe Costs');
    window.XLSX.writeFile(workbook, 'costtrack-recipe-cost-report.xlsx');
    return;
  }
  const output = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([output], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = 'costtrack-recipe-cost-report.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function reportChartPanel(id, title, description, rows, valueKey, labelKey, type, unit = '', forceEmpty = false, emptyMessage = 'No data in this range.') {
  const chartRows = forceEmpty ? [] : rows.filter(item => item[valueKey] !== null && item[valueKey] !== undefined && item[valueKey] !== '' && Number.isFinite(Number(item[valueKey])));
  if (chartRows.length) reportChartSpecs.push({ id, title, rows: chartRows, valueKey, labelKey, type, unit });
  return `<section class="panel report-chart-panel"><h2 class="panel-title">${esc(title)}</h2><p class="panel-subtitle">${esc(description)}</p>${chartRows.length ? `<div class="report-chart-wrap"><canvas id="${id}" role="img" aria-label="${esc(title)}"></canvas></div>` : `<div class="empty-state" role="status">${esc(emptyMessage)}</div>`}</section>`;
}
function reportTabsForSources(sources = null) {
  if (sources == null) {
    return [...new Set(Object.values(reportTabsBySource).flat())];
  }
  const affected = new Set();
  sources.forEach(source => {
    const normalized = reportSourceAliases[source] || source;
    (reportTabsBySource[normalized] || []).forEach(tab => affected.add(tab));
  });
  return [...affected];
}
function invalidateReportData(sources = null) {
  const affectedTabs = reportTabsForSources(sources);
  affectedTabs.forEach(tab => {
    reportDataVersions.set(tab, (reportDataVersions.get(tab) || 0) + 1);
    Object.keys(reportServerData).forEach(key => {
      if (key.startsWith(`${tab}|`)) delete reportServerData[key];
    });
  });
  const normalizedSources = sources?.map(source => reportSourceAliases[source] || source);
  const invalidatesRevenueDashboard = sources == null
    || normalizedSources.some(source => reportRevenueSources.has(source));
  if (invalidatesRevenueDashboard) {
    revenueDashboardData = null;
    revenueDashboardError = '';
    if (revenueDashboardLoading) revenueDashboardRefreshAfterLoad = true;
  }
  return affectedTabs;
}
function updateReportChartsFromSpecs() {
  reportChartSpecs.forEach((spec, index) => {
    const chart = reportCharts[index];
    const dataset = chart.data.datasets[0];
    chart.data.labels = spec.rows.map(item => String(item[spec.labelKey] ?? ''));
    dataset.label = spec.title;
    dataset.data = spec.rows.map(item => Number(item[spec.valueKey]));
    if (spec.type === 'doughnut') {
      const palette = Array.isArray(dataset.backgroundColor) ? dataset.backgroundColor : [];
      dataset.backgroundColor = spec.rows.map((_, colorIndex) => palette[colorIndex % palette.length]);
    }
    chart.update('none');
  });
}
async function loadRevenueDashboard(force = false) {
  if (!canAccessRevenue() || !state.user || revenueDashboardLoading) return;
  if (revenueDashboardData && !force) return;
  const requestId = ++revenueDashboardRequest;
  revenueDashboardLoading = true;
  revenueDashboardError = '';
  if (force && ['dashboard', 'revenue'].includes(state.view)) render();
  try {
    const data = await window.supabaseRecord.posRevenueReport('dashboard');
    if (requestId === revenueDashboardRequest) revenueDashboardData = data;
  } catch (error) {
    console.error('Closed-bill dashboard metrics could not be loaded.', error);
    if (requestId === revenueDashboardRequest) {
      revenueDashboardData = null;
      revenueDashboardError = friendlyRpcError(error);
    }
  } finally {
    if (requestId === revenueDashboardRequest) {
      revenueDashboardLoading = false;
      if (revenueDashboardRefreshAfterLoad) {
        revenueDashboardRefreshAfterLoad = false;
        revenueDashboardData = null;
        loadRevenueDashboard(true);
        return;
      }
      if (['dashboard', 'revenue'].includes(state.view)) render();
    }
  }
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
  const rootStyles = getComputedStyle(document.documentElement);
  const cssColor = (name) => rootStyles.getPropertyValue(name).trim();
  const accent = cssColor('--accent') || '#B55C12';
  const espresso = cssColor('--espresso') || '#2C1E16';
  const sage = cssColor('--success') || '#3B7A57';
  const danger = cssColor('--danger') || '#C83E37';
  const info = cssColor('--info') || '#4F6D8A';
  const sand = cssColor('--line') || '#E8E0D4';
  const chartText = cssColor('--muted') || '#6B5B4E';
  const palette = [accent, espresso, sage, danger, info, cssColor('--warning') || '#C9A227'];
  reportChartSpecs.forEach(spec => {
    const canvas = document.getElementById(spec.id);
    if (!canvas) return;
    const color = spec.title && /loss|cost|void|negative/i.test(spec.title) ? danger : accent;
    const circular = spec.type === 'doughnut';
    try {
      const chart = new window.Chart(canvas, {
        type: spec.type,
        data: {
          labels: spec.rows.map(item => String(item[spec.labelKey] ?? '')),
          datasets: [{
            label: spec.title,
            data: spec.rows.map(item => Number(item[spec.valueKey])),
            borderColor: circular ? '#FFFFFF' : color,
            backgroundColor: circular ? spec.rows.map((_, index) => palette[index % palette.length]) : spec.type === 'line' ? `${accent}2E` : color,
            borderWidth: circular ? 2 : 2,
            fill: spec.type === 'line',
            tension: 0.25,
            borderRadius: spec.type === 'bar' ? 4 : 0,
            hoverOffset: circular ? 6 : 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: circular ? {
              display: true,
              position: 'bottom',
              labels: { color: chartText, usePointStyle: true, padding: 14 }
            } : { display: false },
            tooltip: {
              backgroundColor: '#2C1E16',
              titleColor: '#FFFFFF',
              bodyColor: '#FFFFFF',
              borderColor: sand,
              borderWidth: 1,
              callbacks: {
                label: context => {
                  const value = typeof context.parsed === 'number' ? context.parsed : context.parsed.y;
                  return `${context.label ? `${context.label}: ` : ''}${spec.unit === 'currency' ? money(value) : `${Number(value).toLocaleString()}${spec.unit ? ` ${spec.unit}` : ''}`}`;
                }
              }
            }
          },
          ...(circular ? {} : { scales: {
            x: { grid: { color: sand }, ticks: { color: chartText, maxRotation: 45, autoSkip: true } },
            y: {
              beginAtZero: true,
              grid: { color: sand },
              ticks: { color: chartText, callback: value => spec.unit === 'currency' ? money(value) : `${Number(value).toLocaleString()}${spec.unit ? ` ${spec.unit}` : ''}` }
            }
          } })
        }
      });
      reportCharts.push(chart);
    } catch (error) {
      console.error(`Could not render the ${spec.title} chart.`, error);
      canvas.outerHTML = '<div class="error-state" role="alert">This chart could not be displayed. The report table is still available.</div>';
    }
  });
}
function reportTable(headers, rows, empty = 'No data in this range.', footer = []) {
  const isNumericHeader = header => /^(Bill #|Closed bills|Net revenue|Discounts?|Customers|Voided bills|Voided amount|Revenue|Food cost|Food cost %|Adults|Senior\/PWD|Kids|Comped|Customers served|Deposits applied|Deposit receipts|Cash payments|Cash refunds|Expected cash|Subtotal|Service charge|Served|Deposit applied|Quantity|Waste cost|Ingredients|Valuation|Batches|Production cost|Covers produced)$/i.test(header);
  const alignCells = row => {
    let index = 0;
    return row.replace(/<td([^>]*)>/g, (cell, attributes) => {
      const numeric = isNumericHeader(headers[index++]);
      const label = headers[index - 1];
      const baseAttributes = `${attributes} data-label="${esc(label)}"`;
      if (!numeric) return `<td${baseAttributes}>`;
      const existingClass = attributes.match(/\bclass="([^"]*)"/);
      const nextAttributes = existingClass
        ? attributes.replace(existingClass[0], `class="${existingClass[1]} numeric"`)
        : `${attributes} class="numeric"`;
      return `<td${nextAttributes} data-label="${esc(label)}">`;
    });
  };
  const footerHtml = footer.length
    ? `<tfoot><tr>${footer.map((item, index) => `<td${isNumericHeader(headers[index]) ? ' class="numeric"' : ''}>${esc(item)}</td>`).join('')}</tr></tfoot>`
    : '';
  return `<div class="table-scroll report-table-scroll"><table data-table="report"><thead><tr>${headers.map(item => `<th${isNumericHeader(item) ? ' class="numeric"' : ''} data-column="${esc(item)}">${esc(item)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(alignCells).join('') : `<tr><td colspan="${headers.length}" class="empty-state">${esc(empty)}</td></tr>`}</tbody>${footerHtml}</table></div>`;
}
function reportExport(rows, name) { const output = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'); const blob = new Blob([output], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `costtrack-${name}.csv`; link.click(); URL.revokeObjectURL(link.href); }
async function loadReportData({ preserveCharts = false } = {}) {
  const reportTab = state.reportTab;
  const [start, end] = dateRangeBounds(); const key = reportDataKey(reportTab, start, end);
  if (!start || !end || reportPendingRequests.has(key) || reportServerData[key]) return;
  reportPendingRequests.add(key);
  const requestVersion = reportDataVersions.get(reportTab) || 0;
  try {
    const closedBillReport = ['daily_revenue', 'revenue_trend', 'customer_count', 'shift_revenue', 'closed_bill_summary', 'food_cost'].includes(reportTab);
    const data = closedBillReport
      ? await window.supabaseRecord.posRevenueReport(reportTab, start, end, reportGroupingFor(reportTab), state.reportIncludeWaste, state.reportPage, 100)
      : await window.supabaseRecord.reportAnalytics(reportTab, start, end, state.reportGrouping, state.reportIncludeWaste);
    if (requestVersion === (reportDataVersions.get(reportTab) || 0)) reportServerData[key] = data;
  }
  catch (error) {
    if (requestVersion === (reportDataVersions.get(reportTab) || 0)) reportServerData[key] = { error: friendlyRpcError(error) };
  }
  finally {
    reportPendingRequests.delete(key);
    if (state.view === 'reports') {
      const [currentStart, currentEnd] = dateRangeBounds();
      if (reportDataKey(state.reportTab, currentStart, currentEnd) === key) {
        if (requestVersion !== (reportDataVersions.get(reportTab) || 0)) {
          void loadReportData({ preserveCharts });
          return;
        }
        render({ preserveReportCharts: preserveCharts });
      }
    }
  }
}
function reportsPage() {
  const [start, end] = dateRangeBounds();
  const revenueTabs = [
    ['daily_revenue', 'Daily revenue'],
    ['revenue_trend', 'Revenue trend'],
    ['customer_count', 'Customers'],
    ['shift_revenue', 'Shift revenue'],
    ['closed_bill_summary', 'Closed bills']
  ];
  const tabs = [
    ...revenueTabs.filter(() => canAccessRevenue()),
    ...[['food_cost', 'Food cost'], ['waste', 'Waste'], ['inventory', 'Inventory'], ['production', 'Production']]
      .filter(([tab]) => tab === 'food_cost' ? canAccessRevenue() : tab === 'inventory' ? ['Administrator', 'Manager', 'Inventory Clerk'].includes(state.role) : tab === 'waste' ? ['Administrator', 'Manager', 'Chef / Kitchen Staff', 'Inventory Clerk'].includes(state.role) : ['Administrator', 'Manager', 'Chef / Kitchen Staff'].includes(state.role))
  ];
  if (!tabs.some(([tab]) => tab === state.reportTab)) {
    state.reportTab = tabs[0]?.[0] || 'waste';
  }
  const key = reportDataKey(state.reportTab, start, end); const server = reportServerData[key]; const data = server && !server.error ? server : {};
  const rows = data.rows || data.by_ingredient || data.valuation_by_category || []; const invalidDateRange = state.dateRange === 'custom' && (!start || !end || start > end); const loading = !server && !invalidDateRange; const error = server?.error; let headers = []; let tableRows = []; let tableFooter = []; let tableEmptyMessage = 'No data in this range.'; let charts = ''; let kpis = ''; let additionalWasteReport = '';
  if (state.reportTab === 'food_cost') { headers = ['Period', 'Revenue', 'Food cost', 'Food cost %']; tableRows = rows.map(item => `<tr><td>${esc(item.period)}</td><td>${money(item.revenue)}</td><td>${money(item.food_cost)}</td><td class="${item.food_cost_pct > 32 ? 'negative' : 'positive'}">${item.food_cost_pct == null ? '—' : `${Number(item.food_cost_pct).toFixed(1)}%`}</td></tr>`); charts = reportChartPanel('reportFoodCostChart', 'Food cost over time', 'Food cost percentage by reporting period.', rows, 'food_cost_pct', 'period', 'line', '%', !reportHasClosedBills(rows), 'No closed bills in this range.'); kpis = `${metric('Food cost %', rows.some(item => item.revenue) ? `${(rows.reduce((sum, item) => sum + Number(item.food_cost || 0), 0) / Math.max(rows.reduce((sum, item) => sum + Number(item.revenue || 0), 0), 1) * 100).toFixed(1)}%` : '—', '♨', 'orange-icon', 'Target 32%')}${metric('Closed-bill revenue', money(rows.reduce((sum, item) => sum + Number(item.revenue || 0), 0)), '₱', 'green-icon', rows.some(item => item.revenue) ? 'Closed bills only' : 'No closed-bill revenue in this range')}`; }
  else if (['daily_revenue', 'revenue_trend'].includes(state.reportTab)) {
    headers = [state.reportTab === 'daily_revenue' ? 'Business date' : 'Period', 'Closed bills', 'Net revenue', 'Discounts', 'Customers', 'Voided bills', 'Voided amount'];
    const totals = window.CostTrackLogic.closedBillRevenueTotals(rows);
    tableRows = rows.map(item => `<tr class="${Number(item.net_revenue || 0) === 0 ? 'zero-revenue' : ''}"><td>${esc(item.period)}</td><td>${Number(item.closed_bill_count || 0)}</td><td>${money(item.net_revenue)}</td><td>${money(item.discount_total)}</td><td>${Number(item.customers_served || 0)}</td><td>${Number(item.voided_bill_count || 0)}</td><td>${money(item.voided_bill_amount)}</td></tr>`);
    tableFooter = ['Total', totals.closedBillCount, money(totals.netRevenue), money(totals.discountTotal), totals.customersServed, totals.voidedBillCount, money(totals.voidedBillAmount)];
    charts = state.reportTab === 'daily_revenue'
      ? dailyRevenueChart(rows)
      : reportChartPanel('reportRevenueTrendChart', 'Closed-bill revenue trend', 'Net revenue grouped by reporting period.', rows, 'net_revenue', 'period', 'line', 'currency', !reportHasClosedBills(rows), 'No closed bills in this range.');
    tableEmptyMessage = 'No closed bills in this range.';
    kpis = `${metric('Net revenue', money(totals.netRevenue), '₱', 'green-icon', 'Closed bills only')}${metric('Closed bills', totals.closedBillCount, '▤', 'purple-icon', 'Counted once')}${metric('Voided amount', money(totals.voidedBillAmount), '₱', 'red-icon', 'Separate from revenue')}`;
  }
  else if (state.reportTab === 'customer_count') {
    headers = ['Period', 'Closed bills', 'Adults', 'Senior/PWD', 'Kids', 'Comped', 'Customers served'];
    tableRows = rows.map(item => `<tr><td>${esc(item.period)}</td><td>${Number(item.closed_bill_count || 0)}</td><td>${Number(item.adult_count || 0)}</td><td>${Number(item.senior_count || 0)}</td><td>${Number(item.kids_count || 0)}</td><td>${Number(item.comped_count || 0)}</td><td>${Number(item.customers_served || 0)}</td></tr>`);
    charts = reportChartPanel('reportCustomerChart', 'Customers served', 'Actual bill counts; no estimate is used.', rows, 'customers_served', 'period', 'bar', 'customers', !reportHasClosedBills(rows), 'No closed bills in this range.');
    kpis = `${metric('Customers served', rows.reduce((sum, item) => sum + Number(item.customers_served || 0), 0), '♙', 'purple-icon', 'Actual bill counts')}${metric('Closed bills', rows.reduce((sum, item) => sum + Number(item.closed_bill_count || 0), 0), '▤', 'green-icon', 'Source: closed POS bills')}`;
  }
  else if (state.reportTab === 'shift_revenue') {
    headers = ['Shift', 'Status', 'Closed bills', 'Net revenue', 'Discounts', 'Customers', 'Deposits applied', 'Deposit receipts', 'Cash payments', 'Cash refunds', 'Expected cash'];
    tableRows = rows.map(item => `<tr><td>${esc(item.shift_code || 'Unassigned / legacy')}</td><td>${esc(item.shift_status || '—')}</td><td>${Number(item.closed_bill_count || 0)}</td><td>${money(item.net_revenue)}</td><td>${money(item.discount_total)}</td><td>${Number(item.customers_served || 0)}</td><td>${money(item.deposit_applied)}</td><td>${money(item.deposit_receipts)}</td><td>${money(item.cash_payments)}</td><td>${money(item.cash_refunds)}</td><td>${money(item.expected_cash)}</td></tr>`);
    charts = reportChartPanel('reportShiftRevenueChart', 'Revenue by shift', 'Sales totals derive from closed bills; cash movements and deposits are separate operational values.', rows, 'net_revenue', 'shift_code', 'bar', 'currency', !reportHasClosedBills(rows), 'No closed bills in this range.');
    kpis = `${metric('Net revenue', money(rows.reduce((sum, item) => sum + Number(item.net_revenue || 0), 0)), '₱', 'green-icon', 'Closed bills only')}${metric('Deposit receipts', money(rows.reduce((sum, item) => sum + Number(item.deposit_receipts || 0), 0)), '₱', 'orange-icon', 'Operational cash · not sales')}`;
  }
  else if (state.reportTab === 'closed_bill_summary') {
    headers = ['Bill #', 'Business date', 'Closed at', 'Shift', 'Subtotal', 'Service charge', 'Discount', 'Net revenue', 'Adults', 'Senior/PWD', 'Kids', 'Comped', 'Served', 'Deposit applied'];
    tableRows = rows.map(item => `<tr><td>${esc(item.bill_number)}</td><td>${esc(item.business_date)}</td><td>${esc(formatOperationalDateTime(item.closed_at))}</td><td>${esc(item.shift_code || '—')}</td><td>${money(item.subtotal)}</td><td>${money(item.service_charge)}</td><td>${money(item.discount_total)}</td><td>${money(item.net_revenue)}</td><td>${Number(item.adult_count || 0)}</td><td>${Number(item.senior_count || 0)}</td><td>${Number(item.kids_count || 0)}</td><td>${Number(item.comped_count || 0)}</td><td>${Number(item.customers_served || 0)}</td><td>${money(item.deposit_applied)}</td></tr>`);
    kpis = `${metric('Bills in range', Number(data.total_rows || 0), '▤', 'purple-icon', 'Closed status only')}${metric('Page revenue', money(rows.reduce((sum, item) => sum + Number(item.net_revenue || 0), 0)), '₱', 'green-icon', `Page ${data.page || state.reportPage}`)}`;
  }
  else if (state.reportTab === 'waste') {
    const monetaryChartsAllowed = canAccessRevenue();
    headers = ['Ingredient', 'Quantity', ...(monetaryChartsAllowed ? ['Waste cost'] : [])];
    tableRows = (data.by_ingredient || []).map(item => `<tr><td>${esc(item.name)}</td><td>${item.quantity}</td>${monetaryChartsAllowed ? `<td>${money(item.waste_cost)}</td>` : ''}</tr>`);
    const preparedWasteRecords = start && end && start <= end
      ? all('preparedFoodWasteLogs').filter(item => item.date >= start && item.date <= end)
      : [];
    const preparedDishTotals = new Map();
    const preparedWasteByDay = new Map();
    preparedWasteRecords.forEach(item => {
      const dishKey = String(item.dishName || '').trim().toLowerCase();
      if (dishKey) {
        const dish = preparedDishTotals.get(dishKey) || { name: String(item.dishName).trim(), portions: 0, entries: 0 };
        dish.portions += Number(item.quantity || 0);
        dish.entries += 1;
        preparedDishTotals.set(dishKey, dish);
      }
      if (item.date) {
        const day = preparedWasteByDay.get(item.date) || { period: item.date, portions: 0 };
        day.portions += Number(item.quantity || 0);
        preparedWasteByDay.set(item.date, day);
      }
    });
    const preparedDishRows = [...preparedDishTotals.values()]
      .sort((a, b) => b.portions - a.portions || a.name.localeCompare(b.name))
      .map(item => `<tr><td>${esc(item.name)}</td><td>${Number(item.portions.toFixed(4))} portions</td><td>${item.entries}</td></tr>`);
    const preparedTrendRows = [...preparedWasteByDay.values()].sort((a, b) => a.period.localeCompare(b.period));
    const combinedWasteByDay = new Map();
    all('wasteLogs').filter(item => start && end && item.date >= start && item.date <= end)
      .forEach(item => combinedWasteByDay.set(item.date, (combinedWasteByDay.get(item.date) || 0) + 1));
    preparedWasteRecords.forEach(item => combinedWasteByDay.set(item.date, (combinedWasteByDay.get(item.date) || 0) + 1));
    const combinedTrendRows = [...combinedWasteByDay.entries()]
      .filter(([period]) => Boolean(period))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([period, entries]) => ({ period, entries }));
    const ingredientEntryCount = Number(data.linked_count || 0) + Number(data.unlinked_count || 0);
    const preparedPortionTotal = preparedWasteRecords.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const combinedWasteEntries = ingredientEntryCount + preparedWasteRecords.length;
    charts = monetaryChartsAllowed
      ? `${reportChartPanel('reportWasteItemChart', 'Waste cost by ingredient', 'Cost comparison for the selected date range.', data.by_ingredient || [], 'waste_cost', 'name', 'bar', 'currency')}${reportChartPanel('reportWasteTrendChart', 'Ingredient waste cost over time', 'Daily ingredient waste cost for the selected date range.', data.by_day || [], 'waste_cost', 'period', 'line', 'currency')}${reportChartPanel('reportWasteReasonChart', 'Ingredient waste cost by reason', 'Share of ingredient waste cost grouped by recorded reason.', data.by_reason || [], 'waste_cost', 'reason', 'doughnut', 'currency')}`
      : `${reportChartPanel('reportWasteQuantityChart', 'Waste quantity by ingredient', 'Quantities are labelled with each ingredient unit.', data.by_ingredient || [], 'quantity', 'name', 'bar', '')}${reportChartPanel('reportWasteReasonChart', 'Ingredient waste quantity by reason', 'Share of recorded ingredient waste quantity by reason.', data.by_reason || [], 'quantity', 'reason', 'doughnut', '')}`;
    if (!monetaryChartsAllowed) {
      const quantitySpec = reportChartSpecs.find(spec => spec.id === 'reportWasteQuantityChart');
      if (quantitySpec) quantitySpec.rows = quantitySpec.rows.map(item => ({ ...item, name: `${item.name} (${item.unit})` }));
    }
    charts += `${reportChartPanel('reportPreparedWasteTrendChart', 'Prepared food portions wasted', 'Daily portions recorded as prepared-food waste. Portion counts are not added to ingredient stock units.', preparedTrendRows, 'portions', 'period', 'line', 'portions', !preparedTrendRows.length, 'No prepared-food waste in this range.')}${reportChartPanel('reportCombinedWasteTrendChart', 'Combined waste entries', 'Daily count of waste incidents across both categories; quantities remain separate by unit.', combinedTrendRows, 'entries', 'period', 'bar', 'entries', !combinedTrendRows.length, 'No waste entries in this range.')}`;
    kpis = `${monetaryChartsAllowed ? metric('Ingredient waste cost', money((data.by_ingredient || []).reduce((sum, item) => sum + Number(item.waste_cost || 0), 0)), '◌', 'red-icon', `${ingredientEntryCount} ingredient entries`) : ''}${metric('Prepared portions', Number(preparedPortionTotal.toFixed(4)), '♨', 'orange-icon', `${preparedWasteRecords.length} prepared-food entries`)}${metric('Combined waste entries', combinedWasteEntries, '▤', 'purple-icon', 'Incident count; quantities stay separate')}${metric('Linked to production', data.linked_count || 0, '♨', 'orange-icon', 'Ingredient waste context')}`;
    additionalWasteReport = `<section class="panel report-prepared-waste-panel"><h2>Prepared food / leftovers</h2><p class="panel-subtitle">Dish totals are portions recorded in the selected date range. They are reported separately from ingredient quantities and do not change inventory.</p>${reportTable(['Dish', 'Portions wasted', 'Waste entries'], preparedDishRows, 'No prepared-food waste in this range.')}</section>`;
  }
  else if (state.reportTab === 'inventory') {
    const valuationAllowed = canAccessRevenue();
    headers = ['Category', 'Ingredients', ...(valuationAllowed ? ['Valuation'] : [])];
    tableRows = (data.valuation_by_category || []).map(item => `<tr><td>${esc(item.category)}</td><td>${item.ingredients}</td>${valuationAllowed ? `<td>${money(item.valuation)}</td>` : ''}</tr>`);
    charts = valuationAllowed
      ? reportChartPanel('reportInventoryChart', 'Inventory valuation by category', 'Current stock valuation using latest ingredient costs.', data.valuation_by_category || [], 'valuation', 'category', 'bar', 'currency')
      : reportChartPanel('reportInventoryChart', 'Ingredients by category', 'Ingredient counts by category.', data.valuation_by_category || [], 'ingredients', 'category', 'bar', 'ingredients');
    kpis = `${valuationAllowed ? metric('Inventory valuation', money((data.valuation_by_category || []).reduce((sum, item) => sum + Number(item.valuation || 0), 0)), '◈', 'green-icon', 'Stock × latest cost') : ''}${metric('Low-stock items', (data.low_stock || []).length, '!', 'red-icon', 'Needs replenishment')}`;
  }
  else {
    headers = ['Recipe', 'Batches', 'Production cost', 'Covers produced'];
    tableRows = (data.rows || []).map(item => `<tr><td>${esc(item.recipe)}</td><td>${item.batches}</td><td>${money(item.production_cost)}</td><td>${item.covers_produced || '—'}</td></tr>`);
    charts = reportChartPanel('reportProductionChart', 'Portions produced by dish', 'Recorded portions produced, grouped by dish.', data.rows || [], 'covers_produced', 'recipe', 'bar', 'portions');
    kpis = metric('Batches', (data.rows || []).reduce((sum, item) => sum + Number(item.batches || 0), 0), '♨', 'orange-icon', 'Production logs');
  }
  const legacyRecords = start && end && start <= end
    ? revenueRecords().filter(item => item.business_date >= start && item.business_date <= end)
    : [];
  const legacyRows = legacyRecords
    .slice()
    .sort((left, right) => String(right.business_date || '').localeCompare(String(left.business_date || '')))
    .slice(0, 30)
    .map(item => `<tr class="${item.status === 'Voided' ? 'is-voided' : ''}"><td><strong>${esc(item.business_date)}</strong></td><td>${esc(item.meal_period)}</td><td>${Number(item.adult_customers || 0)}</td><td>${Number(item.child_customers || 0)}</td><td>${Number(item.senior_pwd_customers || 0)}</td><td>${Number(item.total_customers || 0)}</td><td class="numeric">${money(item.total_revenue)}</td><td><span class="status">${esc(item.status || 'Archived')}</span></td></tr>`)
    .join('') || '<tr><td colspan="8" class="empty-table">No archived legacy revenue records in this range.</td></tr>';
  const legacyArchive = canAccessRevenue()
    ? `<details class="panel legacy-revenue-archive"><summary>Legacy revenue archive · excluded from closed-bill totals</summary><p class="panel-subtitle">Historical revenue_records are preserved for reference only. Use this archive only for legacy history; current sales reporting is based on closed POS bills.</p><div class="table-scroll"><table><thead><tr><th>Date</th><th>Meal period</th><th>Adults</th><th>Children</th><th>Senior/PWD</th><th>Customers</th><th>Archived amount</th><th>Legacy status</th></tr></thead><tbody>${legacyRows}</tbody></table></div></details>`
    : '';
  const pageCount = Math.max(1, Math.ceil(Number(data.total_rows || 0) / Number(data.page_size || 100)));
  const pagination = state.reportTab === 'closed_bill_summary'
    ? `<div class="toolbar-inline report-pagination"><button class="ghost-btn compact-btn" data-action="report-page" data-page="${Math.max(1, state.reportPage - 1)}" ${state.reportPage <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${state.reportPage} of ${pageCount} · ${Number(data.total_rows || 0)} bills</span><button class="ghost-btn compact-btn" data-action="report-page" data-page="${Math.min(pageCount, state.reportPage + 1)}" ${state.reportPage >= pageCount ? 'disabled' : ''}>Next</button></div>`
    : '';
  const reportTableClass = state.reportTab === 'waste' ? 'report-table-panel report-waste-table' : 'report-table-panel';
  const disclaimer = state.reportTab === 'waste'
    ? 'Ingredient waste remains valued at current ingredient cost. Prepared-food waste is tracked in portions, separately from raw-stock units; combined waste totals count entries rather than adding unlike quantities.'
    : state.reportTab === 'food_cost'
      ? 'New production logs use cost snapshots. Older logs are estimated from current ingredient costs; waste is valued at current cost.'
      : 'Net sales exclude voided bills, deposits, and all legacy revenue records.';
  return `${pageHeader('Management insight', 'Reports & analytics', 'Revenue and customer counts derive from closed POS bills. Deposits and cash movements are shown separately in operational reports.', `<button class="ghost-btn" data-action="print-report">Print / PDF</button> <button class="secondary-btn" data-action="export-report">Export CSV</button>`)}<div class="report-toolbar"><div class="report-tabs" role="tablist" aria-label="Report categories">${tabs.map(([tab, label]) => `<button type="button" role="tab" aria-selected="${state.reportTab === tab}" class="${state.reportTab === tab ? 'active' : ''}" data-report-tab="${tab}">${label}</button>`).join('')}</div>${dateRangeControls()}<label>Group by<select data-report-group ${state.reportTab === 'daily_revenue' ? 'disabled' : ''}><option value="day" ${state.reportGrouping === 'day' ? 'selected' : ''}>Day</option><option value="week" ${state.reportGrouping === 'week' ? 'selected' : ''}>Week</option><option value="month" ${state.reportGrouping === 'month' ? 'selected' : ''}>Month</option></select></label>${state.reportTab === 'food_cost' ? `<label class="filter-check"><input type="checkbox" data-report-waste ${state.reportIncludeWaste ? 'checked' : ''}> Include logged waste</label>` : ''}</div>${invalidDateRange ? '<div class="panel error-state" role="alert">Choose a valid custom date range to view this report.</div>' : loading ? '<div class="panel loading-state" role="status">Loading report…</div>' : error ? `<div class="panel error-state" role="alert">${esc(error)} <button class="ghost-btn" data-action="retry-report">Retry</button></div>` : `<div class="report-disclaimer">${disclaimer}</div><div class="metric-grid">${kpis}</div><div class="report-chart-grid">${charts}</div><div class="panel ${reportTableClass}">${state.reportTab === 'waste' ? '<h2>Top wasted ingredients</h2>' : ''}${reportTable(headers, tableRows, tableEmptyMessage, tableFooter)}${pagination}</div>${additionalWasteReport}`}${legacyArchive}`;
}

let backdropMouseDown = null;
document.addEventListener('mousedown', event => {
  const top = document.querySelector('#modalRoot').lastElementChild;
  backdropMouseDown = top && event.target === top ? top : null;
}, true);
document.addEventListener('mouseup', event => {
  const pressedBackdrop = backdropMouseDown;
  backdropMouseDown = null;
  if (!pressedBackdrop || event.target !== pressedBackdrop
    || pressedBackdrop !== document.querySelector('#modalRoot').lastElementChild) return;
  const type = modalContexts.get(pressedBackdrop)?.type || 'form';
  const action = window.CostTrackLogic.modalInteraction(type, 'backdrop');
  if (action === 'close') closeModal();
  else if (action === 'ignore' && ['form', 'money'].includes(type)) {
    const dialog = pressedBackdrop.querySelector('.modal');
    dialog.classList.remove('outside-click-cue');
    void dialog.offsetWidth;
    dialog.classList.add('outside-click-cue');
    window.setTimeout(() => dialog.classList.remove('outside-click-cue'), 450);
  }
}, true);
document.addEventListener('keydown', event => {
  const root = document.querySelector('#modalRoot');
  const backdrop = root.lastElementChild;
  const dialog = backdrop?.querySelector('.modal[role="dialog"]');
  if (!dialog) return;
  const partyTab = event.target.closest('.pos-wizard-tabs [role="tab"]');
  if (partyTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const tabs = [...dialog.querySelectorAll('.pos-wizard-tabs [role="tab"]')];
    const current = tabs.indexOf(partyTab);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.click();
    requestAnimationFrame(() => document.querySelectorAll('#modalForm .pos-wizard-tabs [role="tab"]')[next]?.focus());
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    const type = modalContexts.get(backdrop)?.type || 'form';
    const action = window.CostTrackLogic.modalInteraction(type, 'escape');
    if (action === 'close' || action === 'request-close' || action === 'cancel') closeModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(item => !item.disabled && !item.closest('[hidden]') && item.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}, true);
document.addEventListener('click', async event => {
  const confirmButton = event.target.closest('[data-action="confirm-reservation"]');
  if (confirmButton) {
    if (!canAccess('reservations')) return toast('Your role cannot confirm reservations.', 'error');
    const reservation = all('reservations').find(item => item.id === confirmButton.dataset.id);
    if (!reservation || reservation.status !== 'Pending') {
      toast('This reservation is no longer pending.', 'error');
      render();
      return;
    }
    const restoreButton = setButtonBusy(confirmButton, 'Confirming…');
    if (!restoreButton) return;
    try {
      await saveRecord('reservations', { ...reservation, status: 'Confirmed' });
      toast(`Reservation for ${reservation.name} confirmed.`);
      render();
    } catch (error) {
      toast(friendlyRpcError(error), 'error');
    } finally {
      restoreButton();
    }
    return;
  }
  const clearReservationFilters = event.target.closest('[data-reservation-clear-filters]');
  if (clearReservationFilters) {
    const unresolvedMode = state.reservationFilter === 'Unresolved';
    state.reservationFilter = unresolvedMode ? 'Unresolved' : 'All';
    state.reservationTypeFilter = 'All';
    state.reservationSourceFilter = 'All';
    state.reservationFilterHighlightGroup = 'status';
    state.reservationMealPeriodFilter = 'All';
    state.reservationDateFilter = 'All';
    state.calendarDate = today();
    state.query = '';
    persistReservationFilters();
    render();
    return;
  }
  const filter = event.target.closest('[data-reservation-filter]');
  if (filter) {
    state.reservationFilter = filter.dataset.reservationFilter;
    state.reservationFilterHighlightGroup = 'status';
    state.query = '';
    if (state.reservationFilter === 'Unresolved') {
      state.reservationSourceFilter = 'All';
      state.reservationDateFilter = 'All';
      state.reservationMealPeriodFilter = 'All';
      state.calendarDate = today();
    }
    persistReservationFilters();
    render();
    return;
  }
  const newWebsiteFilter = event.target.closest('[data-reservation-new-website-filter]');
  if (newWebsiteFilter) {
    state.reservationFilter = state.reservationFilter === 'New website' ? 'All' : 'New website';
    state.reservationTypeFilter = 'All';
    state.reservationSourceFilter = 'All';
    state.reservationDateFilter = 'All';
    state.reservationMealPeriodFilter = 'All';
    state.reservationFilterHighlightGroup = 'status';
    state.calendarDate = today();
    state.query = '';
    persistReservationFilters();
    render();
    return;
  }
  const typeFilter = event.target.closest('[data-reservation-type-filter]');
  if (typeFilter) { state.reservationTypeFilter = typeFilter.dataset.reservationTypeFilter; state.reservationFilterHighlightGroup = 'type'; state.query = ''; persistReservationFilters(); render(); return; }
  const dateFilter = event.target.closest('[data-reservation-date-filter]');
  if (dateFilter) { state.reservationFilter = 'All'; state.reservationDateFilter = dateFilter.dataset.reservationDateFilter; state.reservationFilterHighlightGroup = 'date'; state.calendarDate = today(); persistReservationFilters(); render(); return; }
});
document.addEventListener('change', event => {
  if (event.target.matches('#applicantIdFile')) {
    handleApplicantIdFileChange(event.target);
    return;
  }
  if (event.target.closest('#modalForm[data-type="receiving"]')) {
    const receivingForm = event.target.closest('#modalForm');
    updateReceivingTotals(receivingForm);
    updateReceivingExpiryRequirements(receivingForm);
  }
  if (event.target.matches('[data-reservation-calendar-filter]')) {
    if (event.target.dataset.reservationCalendarFilter === 'status') state.reservationCalendarStatus = event.target.value;
    if (event.target.dataset.reservationCalendarFilter === 'type') state.reservationCalendarType = event.target.value;
    if (reservationCalendar) reservationCalendar.refetchEvents();
    return;
  }
  if (event.target.id === 'tableSearch') {
    state.query = event.target.value;
    Object.keys(state.tablePages).forEach(key => { state.tablePages[key] = 1; });
    if (state.view !== 'users') render();
  }
  if (event.target.id === 'userManagementRoleFilter') {
    state.userManagementRole = event.target.value;
    render();
    requestAnimationFrame(() => document.querySelector('#userManagementRoleFilter')?.focus());
    return;
  }
  if (event.target.id === 'userManagementStatusFilter') {
    state.userManagementStatus = event.target.value;
    render();
    requestAnimationFrame(() => document.querySelector('#userManagementStatusFilter')?.focus());
    return;
  }
});
document.addEventListener('input', event => {
  if (event.target.closest('#modalForm')) state.modalDirty = true;
  if (event.target.id === 'reservationCalendarSearch') {
    state.reservationCalendarQuery = event.target.value;
    if (reservationCalendar) reservationCalendar.refetchEvents();
  }
  if (event.target.closest('#modalForm[data-type="waste"]')) updateWasteFormPreview(event.target.closest('#modalForm'));
  if (event.target.closest('#modalForm[data-type="receiving"]')) {
    const receivingForm = event.target.closest('#modalForm');
    updateReceivingTotals(receivingForm);
    if (event.target.matches('[data-field="ingredientId"],[name="receivedDate"]')) {
      updateReceivingExpiryRequirements(receivingForm);
    }
  }
  const billFormElement = event.target.closest('#modalForm[data-type="bill"]');
  if (billFormElement && event.target.matches('[name="adultCount"],[name="seniorCount"],[name="kidsCount"]')) {
    updateBillHeadcountWarning(billFormElement);
  }
  const wizardForm = event.target.closest('#modalForm[data-type="bill-wizard"]');
  if (wizardForm && event.target.matches('[data-wizard-count]')) {
    const wizard = state.billWizard;
    wizard[event.target.name] = Math.max(0, Number(event.target.value || 0));
    wizard.countsConfirmed = false;
    const confirmation = wizardForm.querySelector('[data-confirm-count-change]');
    if (confirmation) confirmation.checked = false;
    const summary = wizardForm.querySelector('[data-wizard-guest-total]');
    if (summary) summary.innerHTML = billWizardCountChips(wizard);
    const reservation = all('reservations').find(item => item.id === wizard.reservationId);
    const mismatch = Number(wizard.adultCount) !== Number(reservation?.adults || 0)
      || Number(wizard.seniorCount) !== Number(reservation?.seniorPwdCount || 0)
      || Number(wizard.kidsCount) !== Number(reservation?.children || 0);
    const countChanges = billWizardCountDifferences(wizard);
    const countChangeText = countChanges.map(change =>
      `${change.from} ${change.label} to ${change.to} ${change.label}`
    ).join('; ');
    const changeNotice = wizardForm.querySelector('[data-wizard-count-change]');
    if (changeNotice) {
      changeNotice.hidden = countChanges.length === 0;
      changeNotice.textContent = countChanges.length
        ? `Changed from ${wizard.billId ? 'saved bill' : 'seating'}: ${countChangeText}` : '';
    }
    const countConfirmation = wizardForm.querySelector('[data-count-confirmation]');
    if (countConfirmation) countConfirmation.hidden = countChanges.length === 0;
    const baselineNote = wizardForm.querySelector('[data-count-baseline-note]');
    if (baselineNote) baselineNote.hidden = countChanges.length > 0;
    const warning = wizardForm.querySelector('[data-wizard-count-warning]');
    if (warning) warning.hidden = !mismatch;
    const idReminder = wizardForm.querySelector('[data-senior-id-reminder]');
    if (idReminder) idReminder.hidden = Number(wizard.seniorCount) === Number(wizard.countBaseline?.seniorCount || 0);
  }
  if (wizardForm && event.target.matches('[name="tenderedAmount"]')) {
    state.billWizard.tenderedAmount = event.target.value;
    const due = Number(state.billWizard.closePreview?.balance_after_deposit || 0);
    updateBillCashChangePreview(
      wizardForm.querySelector('[data-cash-change-preview]'),
      event.target.value,
      due
    );
  }
  const billCloseFormElement = event.target.closest('#modalForm[data-type="bill-close"]');
  if (billCloseFormElement && event.target.matches('[name="tenderedAmount"]')) {
    updateBillCashChangePreview(
      billCloseFormElement.querySelector('[data-cash-change-preview]'),
      event.target.value,
      Number(billCloseFormElement.dataset.balanceDue || 0)
    );
  }
  if (['adults', 'seniorPwdCount', 'children'].includes(event.target.name)
    && event.target.closest('#modalForm[data-type="walk-in"]')) {
    refreshWalkInTables(event.target.closest('#modalForm'));
    return;
  }
  const walkInFormElement = event.target.closest('#modalForm[data-type="walk-in"]');
  if (walkInFormElement && event.target.name === 'name') {
    updateWalkInSummary(walkInFormElement, walkInTableList(
      walkInGuestTotal(walkInFormElement),
      walkInFormElement.dataset.date,
      walkInFormElement.dataset.time
    ));
    return;
  }
  const reservationWizardForm = event.target.closest('#modalForm[data-type="reservation"][data-reservation-wizard-step="1"]');
  if (reservationWizardForm && ['adults', 'seniorPwdCount', 'children'].includes(event.target.name)) {
    const total = Number(reservationWizardForm.elements.adults.value || 0)
      + Number(reservationWizardForm.elements.seniorPwdCount.value || 0)
      + Number(reservationWizardForm.elements.children.value || 0);
    const totalTarget = reservationWizardForm.querySelector('[data-reservation-step-total]');
    if (totalTarget) totalTarget.textContent = String(total);
  }
});
window.addEventListener('beforeunload', event => {
  if (!state.modalDirty) return;
  event.preventDefault();
  event.returnValue = '';
});
window.addEventListener('hashchange', () => {
  const view = window.location.hash.slice(1);
  if (!view) return;
  state.view = view === 'users'
    ? 'users'
    : canAccess(view) ? view : (roleAccess[state.role]?.[0] || 'dashboard');
  state.focusPageAfterNavigation = true;
  if (state.view === 'reservations') state.reservationMealPeriodFilter = 'All';
  if (state.view !== view) window.history.replaceState(null, '', `#${state.view}`);
  syncActiveSidebarGroup(state.view);
  closeShellPopovers(false);
  closeMobileDrawer(false);
  render();
});

document.addEventListener('click', event => {
  const tablePageButton = event.target.closest('[data-table-page]');
  if (tablePageButton && !tablePageButton.disabled) {
    const page = Number(tablePageButton.dataset.tablePage);
    const tableId = tablePageButton.dataset.tableId;
    if (page >= 1 && tableId) {
      state.tablePages[tableId] = page;
      render();
      return;
    }
  }
  const reportTab = event.target.closest('[data-report-tab]');
  if (reportTab) { state.reportTab = reportTab.dataset.reportTab; state.reportPage = 1; render(); return; }
  if (event.target.closest('[data-action="retry-revenue-dashboard"]')) { loadRevenueDashboard(true); return; }
  const reportPageButton = event.target.closest('[data-action="report-page"]');
  if (reportPageButton && !reportPageButton.disabled) { state.reportPage = Number(reportPageButton.dataset.page); render(); return; }
  if (event.target.closest('[data-action="retry-report"]')) { const [start, end] = dateRangeBounds(); delete reportServerData[reportDataKey(state.reportTab, start, end)]; render(); return; }
  if (event.target.closest('[data-action="print-report"]')) { window.print(); return; }
  if (event.target.closest('[data-action="export-report"]')) {
    const table = document.querySelector('.report-table-panel table');
    if (!table) { toast('This report is not available until the report data loads successfully.', 'error'); return; }
    const rows = [...table.rows].map(row => [...row.cells].map(cell => cell.innerText.trim()));
    if (state.reportTab === 'waste') {
      const preparedTable = document.querySelector('.report-prepared-waste-panel table');
      const preparedRows = preparedTable
        ? [...preparedTable.rows].filter(row => !row.querySelector('.empty-state')).map(row => [...row.cells].map(cell => cell.innerText.trim()))
        : [];
      rows[0] = ['Waste category', ...rows[0]];
      for (let index = 1; index < rows.length; index += 1) rows[index] = ['Ingredient waste', ...rows[index]];
      if (preparedRows.length) rows.push([], ['Waste category', ...preparedRows[0]], ...preparedRows.slice(1).map(row => ['Prepared food / leftovers', ...row]));
    }
    reportExport(rows, state.reportTab);
    return;
  }
  const clear = event.target.closest('[data-action="clear-filters"]');
  if (clear) { state.query = ''; state.ingredientStatus = 'All'; state.ingredientExpiryFilter = false; state.ingredientCategory = 'All'; state.ingredientUnit = 'All'; render(); }
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
  const queueTab = event.target.closest('[data-production-queue-tab]')?.dataset.productionQueueTab;
  if (queueTab) {
    state.productionQueueTab = queueTab;
    render();
    if (queueTab === 'in-progress') {
      document.querySelector('.production-in-progress')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      document.querySelector('.production-ready-panel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
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
  if (action === 'open-start-production') {
    openStartProductionModal();
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
  const ready = event.target.closest('[data-ready-production]');
  if (ready) {
    if (!window.CostTrackLogic.canPerformInventoryAction(state.role, 'production.log')) {
      return toast('You do not have permission to complete production batches.', 'error');
    }
    const restoreButton = setButtonBusy(ready, 'Marking ready…');
    if (!restoreButton) return;
    try {
      const completed = await window.supabaseRecord.completeProductionBatch(ready.dataset.readyProduction);
      invalidateReportData(['productionLogs', 'ingredients']);
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
      restoreButton();
    }
  }
});

document.addEventListener('submit', async event => {
  if (event.target.getAttribute('id') !== 'modalForm') return;
  event.preventDefault();
  const form = event.target; clearFieldErrors(form);
  let valid = true;
  const validatedRadioGroups = new Set();
  form.querySelectorAll('[required]').forEach(control => {
    if (control.disabled) return;
    if (control.type === 'radio') {
      if (validatedRadioGroups.has(control.name)) return;
      validatedRadioGroups.add(control.name);
      const groupControls = [...form.querySelectorAll('input[type="radio"]')]
        .filter(radio => radio.name === control.name);
      if (groupControls.some(radio => radio.checked)) return;
      const group = control.closest('[data-waste-reason-group],[data-prepared-waste-reason-group]');
      if (group) {
        group.classList.add('has-error');
        const errorMessage = group.querySelector('[data-waste-reason-error],[data-prepared-waste-reason-error]');
        if (errorMessage) errorMessage.hidden = false;
        groupControls.forEach(radio => radio.setAttribute('aria-invalid', 'true'));
        toast('Choose a reason for the waste entry.', 'error');
      } else {
        showFieldError(control, 'Choose an option.');
      }
      valid = false;
      return;
    }
    if (!String(control.value).trim()) { showFieldError(control, 'This field is required.'); valid = false; }
  });
  if (form.dataset.type === 'stale-booking-resolution') {
    const reason = String(form.elements.reason?.value || '').trim();
    const depositReason = String(form.elements.depositReason?.value || '').trim();
    const confirmNoMeal = form.elements.confirmNoMeal;
    if (reason.length < 10 || reason.length > 500) {
      showFieldError(form.elements.reason, 'Enter a resolution reason between 10 and 500 characters.');
      valid = false;
    }
    if (confirmNoMeal && !confirmNoMeal.checked) {
      showFieldError(confirmNoMeal, 'Confirm that no meal was served or this is a test/error record.');
      valid = false;
    }
    if (Number(form.dataset.heldDepositTotal || 0) > 0) {
      if (depositReason.length < 10 || depositReason.length > 500) {
        showFieldError(form.elements.depositReason, 'Enter a deposit action reason between 10 and 500 characters.');
        valid = false;
      }
    }
  }
  form.querySelectorAll('input[type="number"]').forEach(control => {
    if (control.disabled) return;
    if (control.value !== '' && (!Number.isFinite(Number(control.value)) || Number(control.value) < Number(control.min || 0))) { showFieldError(control, `Enter a number of ${control.min && Number(control.min) > 0 ? 'at least ' + control.min : 'zero or more'}.`); valid = false; }
    if (['batchYield', 'prepTarget'].includes(control.name) && control.value !== '' && !Number.isInteger(Number(control.value))) { showFieldError(control, 'Enter a whole number.'); valid = false; }
  });
  if (['reservation', 'walk-in'].includes(form.dataset.type)) {
    const countNames = ['adults', 'seniorPwdCount', 'children'];
    const counts = countNames.map(name => form.elements[name]);
    const invalidCounts = counts.filter(control =>
      !Number.isInteger(Number(control?.value)) || Number(control?.value) < 0
    );
    if (invalidCounts.length) {
      invalidCounts.forEach(control => showFieldError(control, 'Guest counts must be non-negative whole numbers.'));
      valid = false;
    } else {
      try {
        window.CostTrackLogic.normalizeReservationGuestCounts(
          ...counts.map(control => control?.value || 0)
        );
      } catch (error) {
        showFieldError(counts[0], error.message);
        valid = false;
      }
    }
    if (form.dataset.type === 'reservation' && form.dataset.reservationType !== 'Walk-in') {
      const email = String(form.elements.email?.value || '').trim();
      const phone = String(form.elements.phone?.value || '').trim();
      if (!email && !phone) {
        showFieldError(form.elements.phone, 'Enter a phone number or email address.');
        valid = false;
      }
    }
  }
  if (form.dataset.type === 'reservation' && form.dataset.reservationType === 'Walk-in'
    && form.elements.packageChargeItemId && !form.elements.packageChargeItemId.disabled) {
    const packageChargeItemId = form.elements.packageChargeItemId?.value || '';
    const packageTierId = form.elements.packageTierId?.value || '';
    const packagePaxCount = form.elements.packagePaxCount?.value || '';
    const existing = all('reservations').find(item => item.id === form.dataset.id);
    const packageChanged = packageChargeItemId !== String(existing?.packageChargeItemId || '')
      || packageTierId !== String(existing?.packageTierId || '')
      || packagePaxCount !== String(existing?.packagePaxCount || '');
    if (packageChargeItemId && packageChanged) {
      if (!['Manager', 'Administrator'].includes(state.role)) {
        showFieldError(form.elements.packageChargeItemId, 'Only a Manager or Administrator can override the Walk-in package rule.');
        valid = false;
      } else if (String(form.elements.packageOverrideReason?.value || '').trim().length < 10) {
        showFieldError(form.elements.packageOverrideReason, 'Enter an override reason of at least 10 characters.');
        valid = false;
      }
    }
  }
  if (form.dataset.type === 'ingredient' && form.elements.shelfLifeDays?.value) {
    const shelfLifeDays = Number(form.elements.shelfLifeDays.value);
    if (!Number.isInteger(shelfLifeDays) || shelfLifeDays < 1 || shelfLifeDays > 3650) {
      showFieldError(form.elements.shelfLifeDays, 'Enter a whole number from 1 to 3,650 days.');
      valid = false;
    }
  }
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
    if (form.elements.invoiceDate.value > today() || receivedDate > today()) {
      showFieldError(form.elements.receivedDate, 'Invoice and received dates cannot be in the future.');
      valid = false;
    }
    if (form.elements.invoiceDate.value > receivedDate) {
      showFieldError(form.elements.invoiceDate, 'Invoice date cannot be after the received date.');
      valid = false;
    }
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
  if (form.dataset.type === 'waste') {
    if (form.elements.wasteType.value === 'ingredient') {
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
        toast('Add a short explanation for the Other reason.', 'error');
        valid = false;
      }
    } else if (form.elements.wasteType.value === 'prepared') {
      const quantity = Number(form.elements.preparedQuantity.value);
      if (form.elements.preparedQuantity.value && quantity !== Number(quantity.toFixed(4))) {
        showFieldError(form.elements.preparedQuantity, 'Use up to 4 decimal places for portions.');
        valid = false;
      }
      if (quantity > 1000000) {
        showFieldError(form.elements.preparedQuantity, 'Portions cannot exceed 1,000,000.');
        valid = false;
      }
      if (form.elements.preparedDate.value > manilaBusinessToday()) {
        showFieldError(form.elements.preparedDate, 'Waste date cannot be in the future.');
        valid = false;
      }
      if (form.elements.preparedReason.value === 'Other' && !form.elements.preparedNotes.value.trim()) {
        showFieldError(form.elements.preparedNotes, 'Add a short explanation for the Other reason.');
        toast('Add a short explanation for the Other reason.', 'error');
        valid = false;
      }
    }
  }
  if (!valid) { event.stopImmediatePropagation(); form.querySelector('.has-error input, .has-error select, .has-error textarea')?.focus(); return; }
  if (form.dataset.type === 'bill') {
    const mismatch = updateBillHeadcountWarning(form);
    if (mismatch && !await confirmInApp('The reservation and bill head counts differ. Save the bill with these counts anyway?', {
      title: 'Head counts differ',
      confirmLabel: 'Save bill'
    })) return;
  }
  if (form.dataset.type === 'bill-close') {
    const bill = all('posBills').find(item => item.id === form.dataset.id);
    if (bill && !bill.tableId
      && !await confirmInApp('This bill has no table linked. Close it anyway?', {
        title: 'No table linked',
        confirmLabel: 'Close bill'
      })) return;
  }
  if (form.dataset.type === 'waste') {
    if (form.elements.wasteType.value === 'ingredient') {
      const product = ingredient(form.elements.ingredientId.value);
      const quantity = Number(form.elements.quantity.value);
      const costText = ['Administrator', 'Manager'].includes(state.role)
        ? `\nEstimated cost: ${money(quantity * Number(product?.cost || 0))}`
        : '';
      const linkedLog = all('productionLogs').find(log => log.id === form.elements.productionLogId.value);
      const linkedRecipe = linkedLog ? recipe(linkedLog.recipeId)?.name : '';
      if (!await confirmInApp(`Record ${quantity} ${product?.unit || ''} of ${product?.name || 'this ingredient'} as ${form.elements.reason.value}?${linkedRecipe ? `\nRelated dish: ${linkedRecipe}` : ''}\nStock will decrease once from ${Number(product?.stock || 0)} to ${Number((Number(product?.stock || 0) - quantity).toFixed(4))} ${product?.unit || ''}.${costText}`, {
        title: 'Confirm waste entry',
        confirmLabel: 'Record waste'
      })) return;
    } else if (form.elements.wasteType.value === 'prepared') {
      const quantity = Number(form.elements.preparedQuantity.value);
      const dishName = form.elements.dishName.value.trim();
      if (!await confirmInApp(`Record ${quantity} portion${quantity === 1 ? '' : 's'} of ${dishName} as prepared-food waste for ${form.elements.preparedReason.value}?\nIngredient inventory will not be changed.`, {
        title: 'Confirm prepared-food waste',
        confirmLabel: 'Record waste'
      })) return;
    }
  }
  event.stopImmediatePropagation();
  const submit = event.submitter || form.querySelector('.modal-submit');
  const originalSubmitText = submit?.textContent || '';
  const originalSubmitDisabled = submit?.disabled || false;
  const loadingLabels = {
    shift: 'Opening shift…',
    'shift-close': 'Closing shift…',
    'cash-movement': 'Recording movement…',
    'reservation-deposit': 'Recording deposit…',
    'deposit-decision': 'Updating deposit…',
    receiving: 'Recording delivery…',
    ingredient: 'Saving product…',
    bill: 'Saving bill…',
    'bill-close': 'Closing bill…',
    'bill-wizard': form.dataset.screen === '4' ? 'Confirming payment…'
      : form.dataset.screen === '3' ? 'Saving draft…' : 'Continuing…'
  };
  form.dataset.saving = 'true';
  let slowSubmitTimer;
  if (submit) {
    submit.disabled = true;
    submit.classList.add('is-loading');
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = form.dataset.type === 'walk-in' && submit.dataset.walkInAction === 'seat-and-open'
      ? 'Seating and opening bill…'
      : loadingLabels[form.dataset.type] || 'Saving…';
    slowSubmitTimer = window.setTimeout(() => {
      if (form.isConnected && submit.disabled) submit.textContent = 'Still processing…';
    }, 5000);
  }
  try {
    await handleSubmit(form, event.submitter);
  } catch (error) {
    console.error('Form save failed.', error);
    toast(friendlyRpcError(error), 'error');
  } finally {
    if (slowSubmitTimer) window.clearTimeout(slowSubmitTimer);
    delete form.dataset.saving;
    if (form.isConnected && submit) {
      submit.disabled = originalSubmitDisabled;
      submit.classList.remove('is-loading');
      submit.removeAttribute('aria-busy');
      submit.textContent = originalSubmitText;
    }
  }
}, true);
