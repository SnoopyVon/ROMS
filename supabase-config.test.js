const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const configSource = fs.readFileSync(path.join(__dirname, 'supabase-config.js'), 'utf8');

function loadSupabaseRecord(rpc, clientOverrides = {}, hash = '') {
  const timers = new Map();
  let nextTimerId = 0;
  const mockWindow = {
    location: { hash },
    setTimeout(callback, delay) {
      assert.equal(delay, 15000);
      const id = ++nextTimerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    supabase: {
      createClient() {
        return { rpc, ...clientOverrides };
      }
    }
  };
  vm.runInNewContext(configSource, { window: mockWindow, AbortController, URLSearchParams });
  return {
    record: mockWindow.supabaseRecord,
    timers,
    inviteLink: mockWindow.costTrackInviteLink,
    inviteRoles: mockWindow.costTrackInviteRoles
  };
}

test('captures an Auth invitation link before the Supabase client consumes its URL fragment', () => {
  const { inviteLink } = loadSupabaseRecord(
    () => ({}),
    {},
    '#access_token=invite-token&type=invite'
  );
  assert.equal(inviteLink, true);
  assert.equal(loadSupabaseRecord(() => ({}), {}, '#type=recovery').inviteLink, false);
});

test('active user loading excludes pending and cancelled profiles while retaining deactivated accounts', async () => {
  const query = {};
  const { record } = loadSupabaseRecord(() => ({}), {
    from(table) {
      query.table = table;
      return {
        select(columns) {
          query.columns = columns;
          return this;
        },
        in(column, values) {
          query.filter = { column, values };
          return this;
        },
        order(column) {
          query.order = column;
          return Promise.resolve({
            data: [{
              id: 'user-1',
              full_name: 'Staff User',
              email: 'staff@example.com',
              role: 'Manager',
              account_status: 'Deactivated',
              updated_at: '2026-11-18T12:00:00Z'
            }],
            error: null
          });
        }
      };
    }
  });

  assert.deepEqual(JSON.parse(JSON.stringify(await record.load('users'))), [{
    id: 'user-1',
    name: 'Staff User',
    email: 'staff@example.com',
    role: 'Manager',
    accountStatus: 'Deactivated',
    updatedAt: '2026-11-18T12:00:00Z'
  }]);
  assert.equal(query.table, 'profiles');
  assert.equal(query.columns, 'id,email,full_name,role,account_status,updated_at');
  assert.deepEqual(JSON.parse(JSON.stringify(query.filter)), {
    column: 'account_status',
    values: ['Active', 'Deactivated']
  });
  assert.equal(query.order, 'full_name');
});

test('activity log loading selects only the signed-in user and omits record snapshots', async () => {
  const query = {};
  const { record } = loadSupabaseRecord(() => ({}), {
    auth: {
      async getUser() {
        return { data: { user: { id: 'actor-1' } }, error: null };
      }
    },
    from(table) {
      query.table = table;
      return {
        select(columns) {
          query.columns = columns;
          return this;
        },
        eq(column, value) {
          query.filter = { column, value };
          return this;
        },
        order(column, options) {
          query.order = { column, options };
          return Promise.resolve({
            data: [{
              id: 'log-1',
              actor_id: 'actor-1',
              table_name: 'ingredients',
              record_id: 'ingredient-1',
              action: 'UPDATE',
              occurred_at: '2026-11-18T12:00:00Z'
            }],
            error: null
          });
        }
      };
    }
  });

  assert.deepEqual(JSON.parse(JSON.stringify(await record.load('auditLogs'))), [{
    id: 'log-1',
    actorId: 'actor-1',
    tableName: 'ingredients',
    recordId: 'ingredient-1',
    action: 'UPDATE',
    occurredAt: '2026-11-18T12:00:00Z'
  }]);
  assert.equal(query.table, 'audit_logs');
  assert.equal(query.columns, 'id,actor_id,table_name,record_id,action,occurred_at');
  assert.deepEqual(JSON.parse(JSON.stringify(query.filter)), {
    column: 'actor_id',
    value: 'actor-1'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(query.order)), {
    column: 'occurred_at',
    options: { ascending: false }
  });
});

test('account lifecycle adapters invoke the protected Edge Function actions', async () => {
  const calls = [];
  const { record } = loadSupabaseRecord(() => ({}), {
    functions: {
      async invoke(name, options) {
        calls.push({ name, body: options.body });
        if (options.body.action === 'cancel') {
          return {
            data: { invitation_id: 'invite-1', status: 'Cancelled', account_removed: true },
            error: null
          };
        }
        return { data: { user_id: 'user-1', status: 'Deactivated' }, error: null };
      }
    }
  });

  assert.equal((await record.setUserAccountStatus('user-1', 'Deactivated', 'Staff left')).status, 'Deactivated');
  assert.equal((await record.cancelUserInvitation('invite-1')).account_removed, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      name: 'invite-user',
      body: { action: 'deactivate', user_id: 'user-1', reason: 'Staff left' }
    },
    {
      name: 'invite-user',
      body: { action: 'cancel', invitation_id: 'invite-1' }
    }
  ]);
  await assert.rejects(record.setUserAccountStatus('user-1', 'Pending'), /valid user account status/);
  await assert.rejects(
    record.setUserAccountStatus('user-1', 'Deactivated'),
    /reason is required/
  );
});

test('cancellation adapter rejects incomplete account-cleanup responses', async () => {
  const { record } = loadSupabaseRecord(() => ({}), {
    functions: {
      async invoke() {
        return { data: { invitation_id: 'invite-1', status: 'Cancelled' }, error: null };
      }
    }
  });

  await assert.rejects(
    record.cancelUserInvitation('invite-1'),
    /invitation management service returned an invalid response/
  );
});

test('wasteServerTime uses the guarded server-time RPC and clears its timeout', async () => {
  let call;
  const expected = '2026-11-17T22:18:00.000Z';
  const { record, timers } = loadSupabaseRecord((name) => {
    call = name;
    return {
      abortSignal() {
        return Promise.resolve({ data: expected, error: null });
      }
    };
  });

  assert.equal(await record.wasteServerTime(), expected);
  assert.equal(call, 'costtrack_waste_server_time');
  assert.equal(timers.size, 0);
});

test('markTableAvailable uses the narrowly scoped table-cleaning RPC', async () => {
  let call;
  const { record } = loadSupabaseRecord((name, args) => {
    call = { name, args };
    return {
      abortSignal() {
        return Promise.resolve({ data: true, error: null });
      }
    };
  });

  assert.equal(await record.markTableAvailable('T-12'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(call)), {
    name: 'costtrack_mark_table_clean',
    args: { p_table_id: 'T-12' }
  });
  await assert.rejects(record.markTableAvailable('  '), /A table is required/);

  const invalidResult = loadSupabaseRecord(() => ({
    abortSignal() {
      return Promise.resolve({ data: false, error: null });
    }
  }));
  await assert.rejects(
    invalidResult.record.markTableAvailable('T-12'),
    /invalid table-cleaning result/
  );
});

test('updateUserRole calls the protected RPC and returns its changed result', async () => {
  let call;
  const { record } = loadSupabaseRecord((name, args) => {
    call = { name, args };
    return Promise.resolve({ data: true, error: null });
  });

  assert.equal(await record.updateUserRole('user-1', 'Manager', 'Role review'), true);
  assert.equal(call.name, 'costtrack_update_profile_role');
  assert.equal(call.args.p_user_id, 'user-1');
  assert.equal(call.args.p_new_role, 'Manager');
  assert.equal(call.args.p_reason, 'Role review');
});

test('updateUserRole preserves RPC errors and rejects invalid or unchanged results', async () => {
  const failed = loadSupabaseRecord(() => Promise.resolve({
    data: null,
    error: { message: 'Only Administrators may change user roles' }
  }));
  await assert.rejects(
    failed.record.updateUserRole('user-1', 'Manager', 'Role review'),
    /Only Administrators may change user roles/
  );

  const unchanged = loadSupabaseRecord(() => Promise.resolve({ data: false, error: null }));
  assert.equal(await unchanged.record.updateUserRole('user-1', 'Manager', 'Role review'), false);

  const invalid = loadSupabaseRecord(() => Promise.resolve({ data: null, error: null }));
  await assert.rejects(
    invalid.record.updateUserRole('user-1', 'Manager', 'Role review'),
    /invalid role update result/
  );

  await assert.rejects(
    invalid.record.updateUserRole('user-1', 'Manager'),
    /reason is required/
  );
});

test('waste save uses the RPC result including the database timestamp', async () => {
  let rpcName;
  let rpcArgs;
  const savedAt = '2026-11-17T22:18:00.123Z';
  const { record } = loadSupabaseRecord((name, args) => {
    rpcName = name;
    rpcArgs = args;
    return {
      abortSignal() {
        return Promise.resolve({
          data: {
            id: 'WASTE-1',
            ingredient_id: 'ING-1',
            quantity: 0.5,
            reason: 'Expired',
            waste_date: '2026-11-18',
            recorded_at: savedAt,
            production_log_id: null,
            notes: ''
          },
          error: null
        });
      }
    };
  });

  const saved = await record.upsert('wasteLogs', {
    id: 'WASTE-1',
    ingredientId: 'ING-1',
    quantity: 0.5,
    reason: 'Expired',
    recordedAt: '1900-01-01T00:00:00.000Z',
    notes: ''
  });

  assert.equal(rpcName, 'costtrack_log_waste');
  assert.equal(Object.hasOwn(rpcArgs.payload, 'recorded_at'), false);
  assert.equal(Object.hasOwn(rpcArgs.payload, 'waste_date'), false);
  assert.equal(saved.recordedAt, savedAt);
  assert.equal(saved.date, '2026-11-18');
});

test('prepared-food waste saves through its stock-neutral RPC and maps the returned record', async () => {
  let rpcName;
  let rpcArgs;
  const savedAt = '2026-11-18T22:18:00.123Z';
  const { record } = loadSupabaseRecord((name, args) => {
    rpcName = name;
    rpcArgs = args;
    return {
      abortSignal() {
        return Promise.resolve({
          data: {
            id: 'PREP-WASTE-1',
            dish_name: 'Sisig',
            production_batch_id: 'BATCH-1',
            production_batch_label: 'Sisig · #1 · 2026-11-18',
            quantity: 3,
            reason: 'Leftover after service',
            waste_date: '2026-11-18',
            recorded_at: savedAt,
            recorded_by: 'USER-1',
            notes: ''
          },
          error: null
        });
      }
    };
  });

  const saved = await record.upsert('preparedFoodWasteLogs', {
    id: 'PREP-WASTE-1',
    dishName: 'Sisig',
    productionBatchId: 'BATCH-1',
    quantity: 3,
    reason: 'Leftover after service',
    date: '2026-11-18',
    notes: ''
  });

  assert.equal(rpcName, 'costtrack_log_prepared_food_waste');
  assert.deepEqual(JSON.parse(JSON.stringify(rpcArgs.payload)), {
    id: 'PREP-WASTE-1',
    dish_name: 'Sisig',
    production_batch_id: 'BATCH-1',
    quantity: 3,
    reason: 'Leftover after service',
    waste_date: '2026-11-18',
    notes: ''
  });
  assert.equal(Object.hasOwn(rpcArgs.payload, 'ingredient_id'), false);
  assert.equal(Object.hasOwn(rpcArgs.payload, 'recorded_at'), false);
  assert.equal(saved.productionBatchLabel, 'Sisig · #1 · 2026-11-18');
  assert.equal(saved.recordedAt, savedAt);
  assert.equal(saved.recordedBy, 'USER-1');
  assert.equal(saved.date, '2026-11-18');
});

test('posSaveBill aborts and rejects a pending RPC after 15 seconds', async () => {
  let signal;
  const { record, timers } = loadSupabaseRecord(() => ({
    abortSignal(requestSignal) {
      signal = requestSignal;
      return new Promise(() => {});
    }
  }));
  const pending = record.posSaveBill({
    adultCount: 1,
    seniorCount: 0,
    kidsCount: 0,
    compedCount: 0,
    idempotencyKey: 'same-request'
  });
  const [timeout] = timers.values();

  timeout();

  await assert.rejects(
    pending,
    /Bill save timed out after 15 seconds\..*same form.*idempotency key/
  );
  assert.equal(signal.aborted, true);
  assert.equal(timers.size, 0);
});

test('reservation mapping preserves details and guest counts in both directions', async () => {
  let inserted;
  const client = {
    from(table) {
      assert.equal(table, 'reservations');
      return {
        insert(row) {
          inserted = row;
          return {
            select() {
              return {
                async single() {
                  return { data: { updated_at: '2026-11-11T00:00:00Z' }, error: null };
                }
              };
            }
          };
        }
      };
    }
  };
  const { record } = loadSupabaseRecord(() => ({}), client);
  const mapped = record.mapRecord('reservations', {
    id: 'RS-1',
    name: 'Juan Dela Cruz',
    email: 'test@example.com',
    phone: '09123456789',
    reservation_date: '2026-11-11',
    reservation_time: '11:00 AM',
    guests: 7,
    adults: 4,
    senior_pwd_count: 1,
    children: 2,
    source: 'Phone',
    status: 'Pending',
    type: 'Reservation',
    occasion: 'Birthday',
    request: 'Window seat near the garden',
    created_at: '2026-11-11T00:00:00.000Z',
    package_override_reason: 'Approved event exception'
  });

  assert.equal(mapped.name, 'Juan Dela Cruz');
  assert.equal(mapped.email, 'test@example.com');
  assert.equal(mapped.phone, '09123456789');
  assert.equal(mapped.date, '2026-11-11');
  assert.equal(mapped.time, '11:00 AM');
  assert.equal(mapped.adults, 4);
  assert.equal(mapped.seniorPwdCount, 1);
  assert.equal(mapped.children, 2);
  assert.equal(mapped.guests, 7);
  assert.equal(mapped.source, 'Phone');
  assert.equal(mapped.status, 'Pending');
  assert.equal(mapped.type, 'Reservation');
  assert.equal(mapped.occasion, 'Birthday');
  assert.equal(mapped.request, 'Window seat near the garden');
  assert.equal(mapped.createdAt, '2026-11-11T00:00:00.000Z');
  assert.equal(mapped.packageOverrideReason, 'Approved event exception');
  await record.upsert('reservations', {
    id: 'RS-1',
    name: 'Juan Dela Cruz',
    email: 'test@example.com',
    phone: '09123456789',
    date: '2026-11-11',
    time: '11:00 AM',
    guests: 7,
    adults: 4,
    seniorPwdCount: 1,
    children: 2,
    source: 'Phone',
    status: 'Pending',
    type: 'Reservation',
    occasion: 'Birthday',
    request: 'Window seat near the garden',
    packageOverrideReason: 'Approved event exception'
  });
  assert.equal(inserted.name, 'Juan Dela Cruz');
  assert.equal(inserted.email, 'test@example.com');
  assert.equal(inserted.phone, '09123456789');
  assert.equal(inserted.reservation_date, '2026-11-11');
  assert.equal(inserted.reservation_time, '11:00 AM');
  assert.equal(inserted.senior_pwd_count, 1);
  assert.equal(inserted.source, 'Phone');
  assert.equal(inserted.status, 'Pending');
  assert.equal(inserted.type, 'Reservation');
  assert.equal(inserted.occasion, 'Birthday');
  assert.equal(inserted.request, 'Window seat near the garden');
  assert.equal(inserted.package_override_reason, 'Approved event exception');
});

test('public reservation RPC receives categorized counts and the calculated guest total', async () => {
  let call;
  const { record } = loadSupabaseRecord((name, args) => {
    call = { name, args };
    return Promise.resolve({ data: 'RSV-1', error: null });
  });

  assert.equal(await record.submitPublicReservation({
    name: 'Juan Dela Cruz',
    email: 'test@example.com',
    phone: '09123456789',
    date: '2026-11-25',
    time: '11:00 AM',
    adults: 2,
    seniorPwdCount: 1,
    children: 2,
    guests: 5,
    occasion: 'Birthday',
    request: 'Window seat near the garden'
  }), 'RSV-1');
  assert.equal(call.name, 'public_create_reservation');
  assert.equal(call.args.payload.name, 'Juan Dela Cruz');
  assert.equal(call.args.payload.email, 'test@example.com');
  assert.equal(call.args.payload.phone, '09123456789');
  assert.equal(call.args.payload.occasion, 'Birthday');
  assert.equal(call.args.payload.request, 'Window seat near the garden');
  assert.equal(call.args.payload.adults, 2);
  assert.equal(call.args.payload.senior_pwd_count, 1);
  assert.equal(call.args.payload.children, 2);
  assert.equal(call.args.payload.guests, 5);
  assert.equal(call.args.payload.reservation_date, '2026-11-25');
  assert.equal(call.args.payload.reservation_time, '11:00 AM');
});

test('public reservation RPC preserves large categorized guest totals without capping them at six', async () => {
  const calls = [];
  const { record } = loadSupabaseRecord((name, args) => {
    calls.push({ name, payload: args.payload });
    return Promise.resolve({ data: `RSV-${calls.length}`, error: null });
  });
  const examples = [
    { adults: 7, seniorPwdCount: 0, children: 0, guests: 7 },
    { adults: 5, seniorPwdCount: 1, children: 2, guests: 8 },
    { adults: 5, seniorPwdCount: 2, children: 3, guests: 10 },
    { adults: 6, seniorPwdCount: 2, children: 4, guests: 12 }
  ];

  for (const [index, counts] of examples.entries()) {
    await record.submitPublicReservation({
      name: `Large party ${counts.guests}`,
      date: '2026-11-25',
      time: '11:00 AM',
      ...counts
    });
    assert.equal(calls[index].name, 'public_create_reservation');
    assert.equal(calls[index].payload.guests, counts.guests);
    assert.equal(calls[index].payload.senior_pwd_count, counts.seniorPwdCount);
  }
});

test('reservation reference email invokes the server function with only its lookup fields', async () => {
  let call;
  const { record } = loadSupabaseRecord(
    () => ({}),
    {
      functions: {
        async invoke(name, options) {
          call = { name, options };
          return { data: { sent: true }, error: null };
        }
      }
    }
  );

  assert.equal(await record.sendPublicReservationReference('RSV-1', 'guest@example.com'), true);
  assert.equal(call.name, 'send-reservation-email');
  assert.equal(call.options.body.reference, 'RSV-1');
  assert.equal(call.options.body.email, 'guest@example.com');
  assert.deepEqual(Object.keys(call.options.body).sort(), ['email', 'reference']);
});

test('posSaveBill returns a successful RPC response without waiting for its timeout', async () => {
  const expected = { bill: { id: 'bill-1' } };
  const { record, timers } = loadSupabaseRecord(() => ({
    abortSignal() {
      return Promise.resolve({ data: expected, error: null });
    }
  }));

  assert.equal(await record.posSaveBill({}), expected);
  assert.equal(timers.size, 0);
});

test('recipe mapping preserves active state and saves without legacy menu price', async () => {
  const savedRow = {
    id: 'REC-1',
    name: 'Test Stew',
    category: 'Main Course',
    wastage: 5,
    batch_yield: 4,
    prep_target: 12,
    prep_notes: '',
    is_active: false,
    updated_at: '2026-11-18T00:00:00Z',
    ingredients: [{ ingredient_id: 'ING-1', quantity: 2 }]
  };
  let rpcCall;
  const { record, timers } = loadSupabaseRecord((name, args) => {
    rpcCall = { name, args };
    return {
      abortSignal() {
        return Promise.resolve({ data: savedRow, error: null });
      }
    };
  });

  const saved = await record.upsert('recipes', {
    id: 'REC-1',
    name: 'Test Stew',
    category: 'Main Course',
    wastage: 5,
    batchYield: 4,
    prepTarget: 12,
    prepNotes: '',
    isActive: false,
    ingredients: [{ ingredientId: 'ING-1', quantity: 2 }]
  });

  assert.equal(rpcCall.name, 'save_recipe');
  assert.equal(Object.hasOwn(rpcCall.args.payload, 'menu_price'), false);
  assert.equal(rpcCall.args.payload.is_active, false);
  assert.equal(JSON.stringify(rpcCall.args.payload.ingredients), JSON.stringify([{ ingredient_id: 'ING-1', quantity: 2 }]));
  assert.equal(saved.isActive, false);
  assert.equal(Object.hasOwn(saved, 'price'), false);
  assert.equal(JSON.stringify(saved.ingredients), JSON.stringify([{ ingredientId: 'ING-1', quantity: 2 }]));
  assert.equal(timers.size, 0);
});

test('product lifecycle RPC uses the guarded timeout and product mapping retains inactive state', async () => {
  let call;
  const inspection = {
    product_id: 'ING-7',
    is_active: false,
    is_used: true,
    usage: { physical_counts: 2 },
    active_recipes: []
  };
  const { record, timers } = loadSupabaseRecord((name, args) => {
    call = { name, args };
    return {
      abortSignal() {
        return Promise.resolve({ data: inspection, error: null });
      }
    };
  });

  const product = record.mapRecord('ingredients', {
    id: 'ING-7',
    name: 'Archived product',
    category: 'Dry Goods',
    unit: 'kg',
    cost: '5.25',
    stock: '0',
    minimum: '1',
    is_active: false,
    updated_at: '2026-11-18T00:00:00Z'
  });
  assert.equal(product.isActive, false);

  assert.equal(await record.productLifecycle('inspect', 'ING-7'), inspection);
  assert.equal(call.name, 'costtrack_product_lifecycle');
  assert.deepEqual(JSON.parse(JSON.stringify(call.args)), {
    action_value: 'inspect',
    product_id_value: 'ING-7',
    reason_value: null
  });
  assert.equal(timers.size, 0);
});

test('production log mapping retains its immutable cost snapshot', () => {
  const { record } = loadSupabaseRecord(() => ({}));
  const mapped = record.mapRecord('productionLogs', {
    id: 'PROD-1',
    recipe_id: 'REC-1',
    quantity: 1,
    covers_produced: 18,
    batch_cost_snapshot: '328.5000',
    cost_snapshot_at: '2026-11-18T02:30:00Z',
    production_date: '2026-11-18',
    mode: 'Buffet batch #1'
  });

  assert.equal(mapped.batchCostSnapshot, 328.5);
  assert.equal(mapped.costSnapshotAt, '2026-11-18T02:30:00Z');
});

test('posCloseBill sends the bill, tender, and idempotency key and clears its timeout', async () => {
  let call;
  const expected = { bill: { id: 'bill-1', status: 'Closed' } };
  const { record, timers } = loadSupabaseRecord((name, args) => {
    call = { name, args };
    return {
      abortSignal() {
        return Promise.resolve({ data: expected, error: null });
      }
    };
  });

  assert.equal(await record.posCloseBill('bill-1', 1496, 'same-payment-key'), expected);
  assert.equal(call.name, 'pos_close_bill_phase3');
  assert.equal(call.args.p_bill_id, 'bill-1');
  assert.equal(call.args.p_tendered_amount, 1496);
  assert.equal(call.args.p_idempotency_key, 'same-payment-key');
  assert.equal(timers.size, 0);
});

test('posCloseBill aborts and reports when the RPC does not respond within 15 seconds', async () => {
  let signal;
  const { record, timers } = loadSupabaseRecord(() => ({
    abortSignal(requestSignal) {
      signal = requestSignal;
      return new Promise(() => {});
    }
  }));
  const pending = record.posCloseBill('bill-1', 1496, 'retry-same-payment');
  const [timeout] = timers.values();

  timeout();

  await assert.rejects(
    pending,
    /Bill close timed out after 15 seconds\..*same payment form.*idempotency key/
  );
  assert.equal(signal.aborted, true);
  assert.equal(timers.size, 0);
});

test('posListUnresolvedStaleBookings calls the role-guarded listing RPC', async () => {
  let call;
  const expected = [{ reservation_id: 'reservation-1', resolution_label: 'Payable' }];
  const { record, timers } = loadSupabaseRecord(name => {
    call = { name };
    return {
      abortSignal() {
        return Promise.resolve({ data: expected, error: null });
      }
    };
  });

  assert.deepEqual(await record.posListUnresolvedStaleBookings(), expected);
  assert.equal(call.name, 'pos_list_unresolved_stale_bookings');
  assert.equal(timers.size, 0);
});

test('posResolveStaleBooking sends explicit outcome, confirmation, deposit, and idempotency arguments', async () => {
  let call;
  const expected = { reservation_id: 'reservation-1', status: 'Completed' };
  const { record, timers } = loadSupabaseRecord((name, args) => {
    call = { name, args };
    return {
      abortSignal() {
        return Promise.resolve({ data: expected, error: null });
      }
    };
  });

  assert.equal(await record.posResolveStaleBooking({
    reservationId: 'reservation-1',
    outcome: 'close_without_charge',
    reason: 'Verified test record; no meal was served.',
    confirmNoMeal: true,
    depositAction: 'refund',
    depositReason: 'Return the held customer deposit.',
    idempotencyKey: 'same-resolution-key'
  }), expected);
  assert.equal(call.name, 'pos_resolve_stale_booking');
  assert.equal(JSON.stringify(call.args), JSON.stringify({
    p_reservation_id: 'reservation-1',
    p_outcome: 'close_without_charge',
    p_reason: 'Verified test record; no meal was served.',
    p_confirm_no_meal: true,
    p_deposit_action: 'refund',
    p_deposit_reason: 'Return the held customer deposit.',
    p_idempotency_key: 'same-resolution-key'
  }));
  assert.equal(timers.size, 0);
});

test('posRevenueReport sends date, grouping, and pagination arguments through the guarded RPC', async () => {
  let call;
  const expected = { today_revenue: 1250, closed_bill_count: 3 };
  const { record, timers } = loadSupabaseRecord((name, args) => {
    call = { name, args };
    return {
      abortSignal() {
        return Promise.resolve({ data: expected, error: null });
      }
    };
  });

  assert.deepEqual(await record.posRevenueReport(
    'closed_bill_summary', '2026-11-01', '2026-11-17', 'day', true, 2, 50
  ), expected);
  assert.equal(call.name, 'pos_revenue_report');
  assert.deepEqual(JSON.parse(JSON.stringify(call.args)), {
    p_report_key: 'closed_bill_summary',
    p_start_date: '2026-11-01',
    p_end_date: '2026-11-17',
    p_group_by: 'day',
    p_include_waste: true,
    p_page: 2,
    p_page_size: 50
  });
  assert.equal(timers.size, 0);
});

test('posRevenueReport aborts and reports a 15-second timeout', async () => {
  let signal;
  const { record, timers } = loadSupabaseRecord(() => ({
    abortSignal(requestSignal) {
      signal = requestSignal;
      return new Promise(() => {});
    }
  }));
  const pending = record.posRevenueReport('dashboard');
  const [timeout] = timers.values();

  timeout();

  await assert.rejects(pending, /POS revenue report timed out after 15 seconds/);
  assert.equal(signal.aborted, true);
  assert.equal(timers.size, 0);
});

test('posResolveStaleBooking aborts after 15 seconds and retains retry guidance', async () => {
  let signal;
  const { record, timers } = loadSupabaseRecord(() => ({
    abortSignal(requestSignal) {
      signal = requestSignal;
      return new Promise(() => {});
    }
  }));
  const pending = record.posResolveStaleBooking({
    reservationId: 'reservation-1',
    outcome: 'close_without_charge',
    reason: 'Verified test record; no meal was served.',
    confirmNoMeal: true,
    idempotencyKey: 'retry-same-resolution'
  });
  const [timeout] = timers.values();

  timeout();

  await assert.rejects(
    pending,
    /Stale booking resolution timed out after 15 seconds\..*same dialog.*idempotency key/
  );
  assert.equal(signal.aborted, true);
  assert.equal(timers.size, 0);
});

test('posListUnresolvedStaleBookings reports a timeout and aborts the request', async () => {
  let signal;
  const { record, timers } = loadSupabaseRecord(() => ({
    abortSignal(requestSignal) {
      signal = requestSignal;
      return new Promise(() => {});
    }
  }));
  const pending = record.posListUnresolvedStaleBookings();
  const [timeout] = timers.values();

  timeout();

  await assert.rejects(pending, /Unresolved bookings request timed out after 15 seconds/);
  assert.equal(signal.aborted, true);
  assert.equal(timers.size, 0);
});

test('posSeatAndOpenWalkIn sends all counts and the stable idempotency key', async () => {
  let call;
  const expected = { reservation: { id: 'walk-in-1' }, bill: { id: 'bill-1' } };
  const { record, timers } = loadSupabaseRecord((name, args) => {
    call = { name, args };
    return {
      abortSignal() {
        return Promise.resolve({ data: expected, error: null });
      }
    };
  });

  assert.equal(await record.posSeatAndOpenWalkIn({
    customerName: 'Walk-in guest',
    phone: '',
    email: '',
    date: '2026-11-11',
    time: '12:00 PM',
    tableId: 'T05',
    adultCount: 4,
    seniorCount: 1,
    kidsCount: 2,
    notes: '',
    idempotencyKey: 'same-walk-in-request'
  }), expected);
  assert.equal(call.name, 'pos_seat_and_open_walkin');
  assert.equal(call.args.p_adult_count, 4);
  assert.equal(call.args.p_senior_count, 1);
  assert.equal(call.args.p_kids_count, 2);
  assert.equal(call.args.p_idempotency_key, 'same-walk-in-request');
  assert.equal(timers.size, 0);
});

test('posSeatAndOpenWalkIn aborts after the 15-second timeout', async () => {
  let signal;
  const { record, timers } = loadSupabaseRecord(() => ({
    abortSignal(requestSignal) {
      signal = requestSignal;
      return new Promise(() => {});
    }
  }));
  const pending = record.posSeatAndOpenWalkIn({
    idempotencyKey: 'retry-same-request'
  });
  const [timeout] = timers.values();

  timeout();

  await assert.rejects(pending, /Walk-in seat-and-bill request timed out after 15 seconds\..*same form.*idempotency key/);
  assert.equal(signal.aborted, true);
  assert.equal(timers.size, 0);
});

test('inviteUser calls the Edge Function with normalized invitation fields', async () => {
  let invocation;
  const { record, inviteRoles } = loadSupabaseRecord(() => ({}), {
    functions: {
      async invoke(name, options) {
        invocation = { name, options };
        return { data: { invitation_id: 'invite-1', status: 'Pending' }, error: null };
      }
    }
  });

  const result = await record.inviteUser({
    email: '  Staff@Example.com ',
    fullName: '  Sam Staff  ',
    role: 'Receptionist'
  });

  assert.equal(invocation.name, 'invite-user');
  assert.equal(invocation.options.body.action, 'invite');
  assert.equal(invocation.options.body.email, 'staff@example.com');
  assert.equal(invocation.options.body.full_name, 'Sam Staff');
  assert.equal(invocation.options.body.role, 'Receptionist');
  assert.equal(result.invitation_id, 'invite-1');
  assert.deepEqual(Array.from(inviteRoles), ['Manager', 'Receptionist', 'Inventory Clerk', 'Chef / Kitchen Staff']);
});

test('user-management Edge Function requests abort after 15 seconds', async () => {
  let signal;
  const { record, timers } = loadSupabaseRecord(() => ({}), {
    functions: {
      invoke(name, options) {
        signal = options.signal;
        return new Promise(() => {});
      }
    }
  });

  const pending = record.inviteUser({
    email: 'staff@example.com',
    fullName: 'Staff User',
    role: 'Manager'
  });
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  await assert.rejects(pending, /Invitation request timed out after 15 seconds/);
  assert.equal(signal.aborted, true);
  assert.equal(timers.size, 0);
});

test('inviteUser rejects Administrator and surfaces Edge Function error messages', async () => {
  let invoked = false;
  const { record } = loadSupabaseRecord(() => ({}), {
    functions: {
      async invoke() {
        invoked = true;
        return {
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: { clone: () => ({ json: async () => ({ error: 'A pending invitation already exists.' }) }) }
          }
        };
      }
    }
  });

  await assert.rejects(
    record.inviteUser({ email: 'admin@example.com', fullName: 'Admin User', role: 'Administrator' }),
    /valid staff role/
  );
  assert.equal(invoked, false);
  await assert.rejects(
    record.inviteUser({ email: 'staff@example.com', fullName: 'Staff User', role: 'Manager' }),
    /A pending invitation already exists/
  );
});

test('resendUserInvitation invokes the Edge Function and retains structured error codes', async () => {
  let invocation;
  const { record } = loadSupabaseRecord(() => ({}), {
    functions: {
      async invoke(name, options) {
        invocation = { name, options };
        return {
          data: {
            invitation_id: 'invite-1',
            status: 'Pending',
            expires_at: '2026-11-25T12:00:00Z'
          },
          error: null
        };
      }
    }
  });

  const result = await record.resendUserInvitation('invite-1');
  assert.equal(invocation.name, 'invite-user');
  assert.deepEqual(JSON.parse(JSON.stringify(invocation.options.body)), {
    action: 'resend',
    invitation_id: 'invite-1'
  });
  assert.equal(result.status, 'Pending');

  const failed = loadSupabaseRecord(() => ({}), {
    functions: {
      async invoke() {
        return {
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: {
              clone: () => ({
                json: async () => ({
                  error: 'Supabase Auth email rate limit reached. Try again later.',
                  message: 'Supabase Auth email rate limit reached. Try again later.',
                  code: 'rate_limited'
                })
              })
            }
          }
        };
      }
    }
  });
  await assert.rejects(
    failed.record.resendUserInvitation('invite-1'),
    error => error.message.includes('rate limit') && error.code === 'rate_limited'
  );
});

test('loadUserInvites reads required history fields and expiry newest-first', async () => {
  const invitation = {
    id: 'invite-1',
    email: 'staff@example.com',
    full_name: 'Staff User',
    role: 'Manager',
    status: 'Accepted',
    invited_at: '2026-11-18T12:00:00Z',
    accepted_at: '2026-11-18T13:00:00Z',
    expires_at: '2026-11-25T12:00:00Z',
    invited_by: 'admin-1'
  };
  let query;
  const { record } = loadSupabaseRecord(() => ({}), {
    from(table) {
      query = { table };
      return {
        select(columns) {
          query.columns = columns;
          return this;
        },
        order(column, options) {
          query.order = { column, options };
          return Promise.resolve({ data: [invitation], error: null });
        }
      };
    }
  });

  assert.deepEqual(await record.loadUserInvites(), [invitation]);
  assert.equal(query.table, 'user_invites');
  assert.equal(query.columns, 'id,email,full_name,role,status,invited_at,accepted_at,expires_at,invited_by');
  assert.equal(query.order.column, 'invited_at');
  assert.equal(query.order.options.ascending, false);
});

test('notification read-state adapters validate and use the shared RPCs', async () => {
  const calls = [];
  const { record, timers } = loadSupabaseRecord((name, args) => {
    calls.push({ name, args });
    return {
      abortSignal() {
        return Promise.resolve({
          data: name === 'costtrack_notification_read_keys' ? ['stock:flour'] : 2,
          error: null
        });
      }
    };
  });

  assert.deepEqual(await record.notificationReadKeys(), ['stock:flour']);
  assert.equal(await record.markNotificationsRead(['stock:flour', 'reservation:r1']), 2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { name: 'costtrack_notification_read_keys' },
    {
      name: 'costtrack_mark_notifications_read',
      args: { p_notification_keys: ['stock:flour', 'reservation:r1'] }
    }
  ]);
  assert.equal(timers.size, 0);
  await assert.rejects(record.markNotificationsRead([1]), /array of strings/);
});

test('notification and expiry batch records map the fields used by the bell', () => {
  const { record } = loadSupabaseRecord(() => ({}));
  const notification = record.mapRecord('notifications', {
    id: 'NOTICE-1',
    type: 'low_stock',
    severity: 'warning',
    message: 'Flour is low',
    target_roles: ['Administrator', 'Inventory Clerk'],
    reference_type: 'ingredient',
    reference_id: 'ING-1',
    is_resolved: false,
    dedupe_key: 'stock:ING-1',
    created_at: '2026-11-18T02:30:00Z'
  });
  const batch = record.mapRecord('inventoryBatches', {
    id: 'BATCH-1',
    product_id: 'ING-1',
    quantity_remaining: '3',
    expiration_date: '2026-11-20',
    received_date: '2026-11-10',
    status: 'Active',
    created_at: '2026-11-10T02:30:00Z'
  });

  assert.equal(notification.dedupeKey, 'stock:ING-1');
  assert.deepEqual(notification.targetRoles, ['Administrator', 'Inventory Clerk']);
  assert.equal(notification.createdAt, '2026-11-18T02:30:00Z');
  assert.equal(batch.quantityRemaining, 3);
  assert.equal(batch.expirationDate, '2026-11-20');
});
