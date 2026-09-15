import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-marketplace-cloud-order-sync-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
process.env.EPIC_MARKETPLACE_CLOUD_API_URL = 'https://fake-lndry-cloud.test/api/v1';

let closeStore: (() => void) | undefined;
const originalFetch = globalThis.fetch;

// Realistic remote order shapes — field names copied verbatim from the real
// backend's own SQL SELECT in vendor-orders.service.js#listOrders, not
// guessed, so a field-name typo here would be a real regression, not a
// tautology against my own assumption.
const REMOTE_ORDERS = [
  { id: 'order-remote-001', order_number: 'LND-1001', status: 'WAITING_VENDOR_CONFIRMATION', user_id: 'cust-1', items: [{ name: 'Shirt', qty: 2 }], subtotal: '250.00', delivery_fee: '30.00', platform_fee: '5.00', tax_amount: '0.00', handling_fee: '0.00', total_amount: '285.00', payment_method: 'ONLINE', payment_status: 'PAID', delivery_address: {}, vendor_slot_id: null, pickup_date: '2026-09-15', estimated_amount_paise: 28500, payable_amount_paise: 28500, fee_breakdown: {}, processing_stage: null, pickup_otp: null, delivery_otp: null, created_at: '2026-09-14T10:00:00Z', updated_at: '2026-09-14T10:00:00Z', customer_name: 'Asha Rao', customer_phone: '9000000001' },
  { id: 'order-remote-002', order_number: 'LND-1002', status: 'PROCESSING', user_id: 'cust-2', items: [{ name: 'Bedsheet', qty: 1 }], subtotal: '180.00', delivery_fee: '0.00', platform_fee: '5.00', tax_amount: '0.00', handling_fee: '0.00', total_amount: '185.00', payment_method: 'COD', payment_status: 'PENDING', delivery_address: {}, vendor_slot_id: 'slot-9', pickup_date: '2026-09-13', estimated_amount_paise: 18500, payable_amount_paise: 18500, fee_breakdown: {}, processing_stage: 'Washing', pickup_otp: null, delivery_otp: null, created_at: '2026-09-13T09:00:00Z', updated_at: '2026-09-14T11:00:00Z', customer_name: 'Vikram Shah', customer_phone: '9000000002' },
  { id: 'order-remote-003', order_number: 'LND-1003', status: 'DELIVERED', user_id: 'cust-3', items: [{ name: 'Saree', qty: 1 }], subtotal: '400.00', delivery_fee: '40.00', platform_fee: '5.00', tax_amount: '0.00', handling_fee: '0.00', total_amount: '445.00', payment_method: 'ONLINE', payment_status: 'PAID', delivery_address: {}, vendor_slot_id: null, pickup_date: '2026-09-10', estimated_amount_paise: 44500, payable_amount_paise: 44500, fee_breakdown: {}, processing_stage: null, pickup_otp: null, delivery_otp: null, created_at: '2026-09-10T08:00:00Z', updated_at: '2026-09-12T18:00:00Z', customer_name: 'Deepa Iyer', customer_phone: '9000000003' },
  // A status the local mapping table doesn't (yet) know about — proves one
  // unmapped order is skipped with a reason, not a crash that loses the
  // other real orders in the same pull.
  { id: 'order-remote-999', order_number: 'LND-1999', status: 'SOME_FUTURE_STATUS_NOT_YET_MAPPED', user_id: 'cust-9', items: [], subtotal: '0.00', delivery_fee: '0.00', platform_fee: '0.00', tax_amount: '0.00', handling_fee: '0.00', total_amount: '0.00', payment_method: 'ONLINE', payment_status: 'PAID', delivery_address: {}, vendor_slot_id: null, pickup_date: null, estimated_amount_paise: 0, payable_amount_paise: 0, fee_breakdown: {}, processing_stage: null, pickup_otp: null, delivery_otp: null, created_at: '2026-09-14T12:00:00Z', updated_at: '2026-09-14T12:00:00Z', customer_name: 'Test Edge Case', customer_phone: '9000000009' },
];

function buildMockFetch(opts: { accessToken: string; vendorLinked: boolean; orders: ReadonlyArray<Record<string, unknown>> }): typeof fetch {
  return (async (url: string, init: any = {}) => {
    const [path, queryString = ''] = String(url).replace('https://fake-lndry-cloud.test/api/v1', '').split('?');
    const query = new URLSearchParams(queryString);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (status: number, payload: unknown) => ({ status, json: async () => payload }) as any;
    const auth = String(init.headers?.authorization || '');

    if (path === '/auth/send-otp' && method === 'POST') return json(200, { success: true });
    if (path === '/auth/verify-otp' && method === 'POST') {
      if (body.otp !== '123456') return json(401, { success: false, message: 'Invalid OTP' });
      return json(200, { success: true, data: { accessToken: opts.accessToken, refreshToken: 'refresh-1', expires_at: new Date(Date.now() + 900_000).toISOString() } });
    }
    // connectCloudSession refreshes once immediately after verify-otp (the
    // real verify-otp token carries no shopRole claim — only refresh-token's
    // response does) — see cloud-session.ts's connect flow.
    if (path === '/auth/refresh-token' && method === 'POST') {
      if (body.refreshToken !== 'refresh-1') return json(401, { success: false, message: 'Invalid refresh token' });
      return json(200, { success: true, data: { access_token: opts.accessToken, refresh_token: 'refresh-1', expires_at: new Date(Date.now() + 900_000).toISOString() } });
    }
    if (path === '/auth/session' && method === 'GET') {
      if (!auth.includes(opts.accessToken)) return json(401, { success: false });
      return json(200, { success: true, data: { user: { id: 'user-001', phone: '9999999999', name: 'Order Sync Vendor', role: 'VENDOR_OWNER' } } });
    }
    if (path === '/vendor/profile' && method === 'GET') {
      if (!auth.includes(opts.accessToken)) return json(401, { success: false });
      if (!opts.vendorLinked) return json(404, { success: false, message: 'Vendor profile not found' });
      return json(200, { success: true, data: { id: 'vendor-row-555', name: 'Order Sync Vendor' } });
    }
    if (path.startsWith('/vendor/orders') && method === 'GET') {
      if (!auth.includes(opts.accessToken)) return json(401, { success: false });
      const page = Math.max(1, Number(query.get('page') || 1));
      const limit = Math.max(1, Number(query.get('limit') || 20));
      const total = opts.orders.length;
      return json(200, { success: true, data: opts.orders.slice((page - 1) * limit, page * limit), meta: { pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
    }
    if (path === '/auth/logout' && method === 'POST') return json(200, { success: true });
    throw new Error(`unexpected mock fetch call: ${method} ${path}`);
  }) as unknown as typeof fetch;
}

try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { registerApi } = await import('./api.js');
  const { mapRemoteOrderStatus } = await import('./modules/marketplace/cloud-order-sync.js');
  closeStore = () => store.close();
  const app = Fastify(); registerApi(app);
  const boot = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'order-sync-owner', password: 'StrongOrderSyncPassword!26', tenant: 'ORDER-SYNC-API', storeId: 'STORE-ORDER-SYNC', businessName: 'Order Sync Laundry' } });
  assert.equal(boot.statusCode, 200);
  const headers = { cookie: String(boot.headers['set-cookie']).split(';')[0] };

  // ── Pure mapping function: derived from the real backend enum, cross-checked against customer-status.ts's own semantics ──
  assert.equal(mapRemoteOrderStatus('WAITING_VENDOR_CONFIRMATION'), 'AwaitingAcceptance');
  assert.equal(mapRemoteOrderStatus('processing'), 'Processing', 'mapping is case-insensitive, and keys on the REAL enum value PROCESSING, not the query-filter pseudo-values WASHING/DRYING/IRONING');
  assert.equal(mapRemoteOrderStatus('PACKED'), 'Ready', 'packed maps to Ready, not Processing — packing is complete, awaiting dispatch');
  assert.equal(mapRemoteOrderStatus('DELIVERED'), 'Completed');
  assert.throws(() => mapRemoteOrderStatus('NOT_A_REAL_STATUS'), /CLOUD_ORDER_UNKNOWN_STATUS/);

  // ── Not connected ──────────────────────────────────────────
  const notConnected = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/sync-orders', headers });
  assert.equal(notConnected.statusCode, 409);
  assert.equal(notConnected.json().code, 'CLOUD_NOT_CONNECTED');

  // ── Connected but no vendor linked ──────────────────────────
  (globalThis as any).fetch = buildMockFetch({ accessToken: 'token-a', vendorLinked: false, orders: REMOTE_ORDERS });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/otp', headers, payload: { phone: '9999999999' } });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/connect', headers, payload: { phone: '9999999999', otp: '123456' } });
  const noVendorSync = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/sync-orders', headers });
  assert.equal(noVendorSync.statusCode, 409, 'pulling orders requires an actually-linked vendor, not just a connected account');
  assert.equal(noVendorSync.json().code, 'CLOUD_VENDOR_NOT_LINKED');
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/disconnect', headers });

  // ── Connected with a real linked vendor — the real sync path ──
  (globalThis as any).fetch = buildMockFetch({ accessToken: 'token-b', vendorLinked: true, orders: REMOTE_ORDERS });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/otp', headers, payload: { phone: '9999999999' } });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/connect', headers, payload: { phone: '9999999999', otp: '123456' } });

  const firstSync = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/sync-orders', headers });
  assert.equal(firstSync.statusCode, 200);
  const firstSummary = firstSync.json();
  assert.equal(firstSummary.pulled, 4);
  assert.equal(firstSummary.created, 3, 'the 3 real, mappable orders are created');
  assert.equal(firstSummary.updated, 0);
  assert.equal(firstSummary.skipped.length, 1, 'the one unmapped-status order is skipped, not silently dropped or crashing the whole pull');
  assert.equal(firstSummary.skipped[0].externalOrderId, 'order-remote-999');
  assert.match(firstSummary.skipped[0].reason, /CLOUD_ORDER_UNKNOWN_STATUS/);

  const projections = store.withStoreScope('ORDER-SYNC-API', 'STORE-ORDER-SYNC', () => store.listMarketplaceOrderProjections('ORDER-SYNC-API'));
  assert.equal(projections.length, 3);
  const order1 = projections.find((p) => p.externalOrderId === 'order-remote-001')!;
  assert.ok(order1, 'order 1 materialized');
  assert.equal(order1.state, 'AwaitingAcceptance');
  assert.equal(order1.channel, 'MARKETPLACE');
  assert.equal(order1.vendorId, 'vendor-row-555', 'projection is tagged with the REAL resolved vendor id, not the connecting user id');
  assert.equal(order1.orderNumber, 'LND-1001');
  assert.equal((order1.customer as any).phone, '9000000001');
  assert.equal((order1.request as any).subtotal, '250.00');
  assert.equal(order1.sourceVersion, 1);

  const order2 = projections.find((p) => p.externalOrderId === 'order-remote-002')!;
  assert.equal(order2.state, 'Processing');
  const order3 = projections.find((p) => p.externalOrderId === 'order-remote-003')!;
  assert.equal(order3.state, 'Completed');

  // ── Idempotent re-sync: same data → no duplicates and no invented revisions ──
  const secondSync = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/sync-orders', headers });
  const secondSummary = secondSync.json();
  assert.equal(secondSummary.created, 0, 're-syncing unchanged orders creates nothing new');
  assert.equal(secondSummary.updated, 0, 're-syncing unchanged orders does not rewrite the existing projections');
  const projectionsAfterResync = store.withStoreScope('ORDER-SYNC-API', 'STORE-ORDER-SYNC', () => store.listMarketplaceOrderProjections('ORDER-SYNC-API'));
  assert.equal(projectionsAfterResync.length, 3, 'no duplicate rows were created for the same external order id');
  const order1AfterResync = projectionsAfterResync.find((p) => p.externalOrderId === 'order-remote-001')!;
  assert.equal(order1AfterResync.id, order1.id, 'the same projection row is reused, not replaced, across re-syncs');
  assert.equal(order1AfterResync.sourceVersion, 1, 'source version remains stable when the cloud source has not changed');

  // ── Pagination: Desktop must not silently drop work after the first 100 ──
  const paginatedOrders = Array.from({ length: 205 }, (_, index) => ({
    ...REMOTE_ORDERS[0],
    id: `order-page-${String(index + 1).padStart(3, '0')}`,
    order_number: `LND-PAGE-${index + 1}`,
  }));
  (globalThis as any).fetch = buildMockFetch({ accessToken: 'token-b', vendorLinked: true, orders: paginatedOrders });
  const paginatedSync = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/sync-orders', headers });
  assert.equal(paginatedSync.statusCode, 200);
  const paginatedSummary = paginatedSync.json();
  assert.equal(paginatedSummary.pulled, 205, 'all three backend pages are pulled, not merely the first 100');
  assert.equal(paginatedSummary.created, 205);
  const projectionsAfterPagination = store.withStoreScope('ORDER-SYNC-API', 'STORE-ORDER-SYNC', () => store.listMarketplaceOrderProjections('ORDER-SYNC-API'));
  assert.equal(projectionsAfterPagination.length, 208, 'the previous three plus all 205 paged orders are materialized exactly once');

  // ── A status change on re-sync is reflected ─────────────────
  const advancedOrders = REMOTE_ORDERS.map((o) => (o.id === 'order-remote-001' ? { ...o, status: 'VENDOR_ACCEPTED' } : o));
  (globalThis as any).fetch = buildMockFetch({ accessToken: 'token-b', vendorLinked: true, orders: advancedOrders });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/sync-orders', headers });
  const projectionsAfterStatusChange = store.withStoreScope('ORDER-SYNC-API', 'STORE-ORDER-SYNC', () => store.listMarketplaceOrderProjections('ORDER-SYNC-API'));
  const changedOrder = projectionsAfterStatusChange.find((p) => p.externalOrderId === 'order-remote-001')!;
  assert.equal(changedOrder.state, 'Accepted', 'a real status change on the backend is picked up on the next pull');
  assert.equal(changedOrder.sourceVersion, 2, 'a real cloud change, and only a real cloud change, advances the source revision');

  console.log('PASS marketplace cloud order sync: real-shape field mapping, status-code mapping (incl. an unmapped-status skip), vendor identity tagging, and idempotent re-sync self-test complete');
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.EPIC_MARKETPLACE_CLOUD_API_URL;
  try { closeStore?.(); } catch { /* already closed above */ }
  rmSync(tempDir, { recursive: true, force: true });
}
