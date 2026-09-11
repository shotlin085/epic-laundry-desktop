import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-marketplace-cloud-order-actions-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
process.env.EPIC_MARKETPLACE_CLOUD_API_URL = 'https://fake-lndry-cloud.test/api/v1';

const TENANT = 'CLOUD-ACTIONS-API';
const STORE = 'STORE-CLOUD-ACTIONS';
const VENDOR_ID = 'vendor-row-777';

let closeStore: (() => void) | undefined;
const originalFetch = globalThis.fetch;

type RemoteOrder = { id: string; order_number: string; status: string };
type MockState = {
  accessToken: string;
  remote: Map<string, RemoteOrder>;
  postBodies: Array<{ path: string; body: unknown }>;
  refreshCalls: number;
  /** When set, the next POST fails this way instead of reaching the state machine. */
  nextPostFailure?: 'network' | 'forbidden';
};

function buildMockFetch(state: MockState): typeof fetch {
  return (async (url: string, init: any = {}) => {
    const path = String(url).replace('https://fake-lndry-cloud.test/api/v1', '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (status: number, payload: unknown) => ({ status, json: async () => payload }) as any;
    const auth = String(init.headers?.authorization || '');

    if (path === '/auth/send-otp' && method === 'POST') return json(200, { success: true });
    if (path === '/auth/verify-otp' && method === 'POST') return json(200, { success: true, data: { accessToken: state.accessToken, refreshToken: 'refresh-1' } });
    if (path === '/auth/refresh-token' && method === 'POST') { state.refreshCalls += 1; return json(200, { success: true, data: { accessToken: state.accessToken, refreshToken: 'refresh-1' } }); }
    if (path === '/auth/session' && method === 'GET') return json(200, { success: true, data: { user: { id: 'user-777', phone: '9999999999', name: 'Actions Vendor', role: 'VENDOR_OWNER' } } });
    if (path === '/vendor/profile' && method === 'GET') return json(200, { success: true, data: { id: VENDOR_ID, name: 'Actions Vendor' } });
    if (path === '/auth/logout' && method === 'POST') return json(200, { success: true });

    const actionMatch = path.match(/^\/vendor\/orders\/([^/]+)\/(accept|reject)$/);
    if (actionMatch && method === 'POST') {
      if (state.nextPostFailure === 'network') { state.nextPostFailure = undefined; throw new Error('socket hang up'); }
      if (state.nextPostFailure === 'forbidden') { state.nextPostFailure = undefined; return json(403, { success: false, message: 'Not a vendor', code: 'NOT_VENDOR' }); }
      if (!auth.includes(state.accessToken)) return json(401, { success: false, message: 'Unauthorized' });
      const [, orderId, action] = actionMatch;
      state.postBodies.push({ path, body });
      const order = state.remote.get(orderId);
      if (!order) return json(404, { success: false, message: 'Order not found', code: 'ORDER_NOT_FOUND' });
      const target = action === 'accept' ? 'VENDOR_ACCEPTED' : 'VENDOR_REJECTED';
      // Faithful to the real backend's state machine, verified by reading
      // `src/utils/state-machine.js#validateTransition` and confirmed against a
      // live instance: a same-status transition is an explicitly VALID no-op
      // (so a repeat accept succeeds rather than erroring), while any other
      // illegal transition answers with the single INVALID_TRANSITION code
      // regardless of the underlying reason.
      if (order.status === target) return json(200, { success: true, data: { orderId, status: target } });
      if (order.status !== 'WAITING_VENDOR_CONFIRMATION') {
        return json(400, { success: false, message: `Cannot transition from ${order.status} to ${target}`, code: 'INVALID_TRANSITION' });
      }
      order.status = target;
      return json(200, { success: true, data: { orderId, status: target } });
    }

    const detailMatch = path.match(/^\/vendor\/orders\/([^/?]+)$/);
    if (detailMatch && method === 'GET') {
      const order = state.remote.get(detailMatch[1]);
      if (!order) return json(404, { success: false, message: 'Order not found', code: 'ORDER_NOT_FOUND' });
      return json(200, { success: true, data: { ...order, items: [], subtotal: '100.00' } });
    }

    if (path.startsWith('/vendor/orders') && method === 'GET') {
      const orders = [...state.remote.values()].map((order) => ({
        ...order, user_id: 'cust-1', items: [{ name: 'Shirt', qty: 2 }], subtotal: '250.00', delivery_fee: '30.00',
        platform_fee: '0.00', tax_amount: '0.00', handling_fee: '0.00', total_amount: '280.00', payment_method: 'ONLINE',
        payment_status: 'PAID', delivery_address: {}, vendor_slot_id: null, pickup_date: null, estimated_amount_paise: 28000,
        payable_amount_paise: 28000, fee_breakdown: {}, processing_stage: null, created_at: '2026-09-14T10:00:00Z',
        updated_at: '2026-09-14T10:00:00Z', customer_name: 'Asha Rao', customer_phone: '9000000001',
      }));
      return json(200, { success: true, data: orders });
    }
    throw new Error(`unexpected mock fetch call: ${method} ${path}`);
  }) as unknown as typeof fetch;
}

try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { registerApi } = await import('./api.js');
  const { laundryCatalogue, seedLaundryDefaults } = await import('./modules/laundry/domain.js');
  const { saveSupplierTaxProfile } = await import('./modules/gst/tax-policy.js');
  closeStore = () => store.close();
  const app = Fastify(); registerApi(app);
  const boot = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'actions-owner', password: 'StrongCloudActionsPassword!26', tenant: TENANT, storeId: STORE, businessName: 'Cloud Actions Laundry' } });
  assert.equal(boot.statusCode, 200);
  const headers = { cookie: String(boot.headers['set-cookie']).split(';')[0] };

  const catalogue = store.withStoreScope(TENANT, STORE, () => { seedLaundryDefaults(TENANT); return laundryCatalogue(TENANT); });
  const garment = catalogue.garments.find((candidate: any) => candidate.unit === 'Piece')!;
  const service = catalogue.services[0]!;

  const state: MockState = {
    accessToken: 'token-actions',
    postBodies: [],
    refreshCalls: 0,
    remote: new Map<string, RemoteOrder>([
      ['order-A', { id: 'order-A', order_number: 'LND-A', status: 'WAITING_VENDOR_CONFIRMATION' }],
      ['order-D', { id: 'order-D', order_number: 'LND-D', status: 'VENDOR_REJECTED' }],
      ['order-E', { id: 'order-E', order_number: 'LND-E', status: 'WAITING_VENDOR_CONFIRMATION' }],
      ['order-F', { id: 'order-F', order_number: 'LND-F', status: 'WAITING_VENDOR_CONFIRMATION' }],
      ['order-G', { id: 'order-G', order_number: 'LND-G', status: 'WAITING_VENDOR_CONFIRMATION' }],
    ]),
  };
  (globalThis as any).fetch = buildMockFetch(state);

  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/otp', headers, payload: { phone: '9999999999' } });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/connect', headers, payload: { phone: '9999999999', otp: '123456' } });
  const synced = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/sync-orders', headers });
  assert.equal(synced.json().created, 5, 'all five remote orders materialize as projections first');

  const projectionOf = (externalOrderId: string) =>
    store.withStoreScope(TENANT, STORE, () => store.getMarketplaceOrderProjection(TENANT, 'MARKETPLACE', externalOrderId));

  // ── An order that has never been synced cannot be acted on ──
  const unknown = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-nope/accept', headers });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().code, 'CLOUD_ORDER_NOT_SYNCED');

  // ── A: accept a real-shaped cloud order → remote accepted, local parked for intake ──
  const acceptA = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-A/accept', headers });
  assert.equal(acceptA.statusCode, 200);
  const outcomeA = acceptA.json();
  assert.equal(outcomeA.remoteStatus, 'VENDOR_ACCEPTED', 'the remote is the authority on the new status');
  assert.equal(outcomeA.transition, 'applied', 'the remote accepted the call');
  assert.equal(outcomeA.projectionState, 'IntakeRequired');
  // A brand-new store has no supplier tax profile yet, and that gap blocks
  // invoicing for ANY order — so it is reported as a setup problem the owner
  // must fix, not as "waiting for the bags".
  assert.equal(outcomeA.materialization, 'blocked_by_setup', 'a store-setup gap is reported as such, not conflated with awaiting physical intake');
  assert.equal(outcomeA.materializationReason, 'TAX_PROFILE_INCOMPLETE', 'the real refusal reason is surfaced, not swallowed');
  assert.equal(outcomeA.localOrderId, undefined);
  assert.equal(state.remote.get('order-A')!.status, 'VENDOR_ACCEPTED', 'the remote order really moved');
  assert.equal(projectionOf('order-A')!.syncState, 'Current', 'cloud-confirmed state is Current, not PendingOutbound');

  // ── B: retrying the same accept is safe (the backend treats it as a no-op) ──
  const acceptAgain = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-A/accept', headers });
  assert.equal(acceptAgain.statusCode, 200, 'a crash-retry of an accept that already landed is a success, not an error');
  assert.equal(acceptAgain.json().transition, 'applied', 'the backend accepts a same-status repeat as a valid no-op, and the outcome does not pretend to distinguish that from a fresh transition');
  assert.equal(acceptAgain.json().remoteStatus, 'VENDOR_ACCEPTED');
  assert.equal(projectionOf('order-A')!.state, 'IntakeRequired', 'a repeat accept does not regress local state');

  // ── B2: an equivalent terminal state IS reported as already_final ──
  // AUTO_REJECTED → VENDOR_REJECTED is neither legal nor a self-transition, so
  // the remote refuses; re-reading shows the order is already rejected, which
  // is what the operator asked for. This is the path that genuinely produces
  // 'already_final' against the real backend.
  state.remote.set('order-B2', { id: 'order-B2', order_number: 'LND-B2', status: 'AUTO_REJECTED' });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/sync-orders', headers });
  const alreadyRejected = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-B2/reject', headers, payload: { reason: 'No capacity' } });
  assert.equal(alreadyRejected.statusCode, 200, 'an order the marketplace already auto-rejected satisfies a reject request');
  assert.equal(alreadyRejected.json().transition, 'already_final');
  assert.equal(alreadyRejected.json().remoteStatus, 'AUTO_REJECTED', 'the real remote status is reported, not flattened into the requested one');
  assert.equal(projectionOf('order-B2')!.state, 'Rejected');

  // ── Owner completes store tax setup — the blocker above is now gone, and the
  // next deferral reason becomes the genuinely intake-dependent one ──
  store.withStoreScope(TENANT, STORE, () => saveSupplierTaxProfile(TENANT, 'actions-owner', {
    legalName: 'Cloud Actions Laundry Private Limited', address: 'Kolkata, West Bengal', stateCode: '19',
    pincode: '700001', registrationStatus: 'Unregistered', invoiceSeries: 'CA',
  }));
  state.remote.set('order-B', { id: 'order-B', order_number: 'LND-B', status: 'WAITING_VENDOR_CONFIRMATION' });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/sync-orders', headers });
  const acceptB = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-B/accept', headers });
  assert.equal(acceptB.statusCode, 200);
  assert.equal(acceptB.json().materialization, 'awaiting_intake', 'with setup complete, a cloud order with no locally-resolvable garment/service ids awaits physical intake');
  assert.equal(acceptB.json().materializationReason, 'MARKETPLACE_INTAKE_ITEMS_INVALID');
  assert.equal(acceptB.json().projectionState, 'IntakeRequired');

  // ── C: when the request carries real local garment/service ids, the full bridge runs ──
  const projectionA = projectionOf('order-A')!;
  store.withStoreScope(TENANT, STORE, () => store.saveMarketplaceOrderProjection({
    ...projectionA,
    id: 'proj-C', externalOrderId: 'order-C', orderNumber: 'LND-C', state: 'AwaitingAcceptance', localOrderId: undefined,
    request: { items: [{ garmentId: garment.id, serviceId: service.id, qty: 2 }], expectedDeliveryDate: '2026-10-20' },
  }));
  state.remote.set('order-C', { id: 'order-C', order_number: 'LND-C', status: 'WAITING_VENDOR_CONFIRMATION' });
  const acceptC = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-C/accept', headers });
  assert.equal(acceptC.statusCode, 200);
  const outcomeC = acceptC.json();
  assert.equal(outcomeC.materialization, 'created', 'a complete request becomes a real local laundry order');
  assert.ok(outcomeC.localOrderId, 'the created local order id is returned');
  const localOrder = store.withStoreScope(TENANT, STORE, () => store.getRow(TENANT, outcomeC.localOrderId));
  assert.equal(localOrder?.entity, 'laundry_order');
  assert.equal(localOrder?.data.external_order_id, 'order-C', 'the local order records which marketplace order it came from');
  assert.equal(localOrder?.data.source, 'Marketplace');
  const link = store.withStoreScope(TENANT, STORE, () => store.getOrderExternalLink(TENANT, 'MARKETPLACE', 'order-C'));
  assert.equal(link?.localOrderId, outcomeC.localOrderId, 'an external link row ties the two identities together');

  // ── D: a genuine conflict (remote already rejected while this operator accepted) ──
  const conflict = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-D/accept', headers });
  assert.equal(conflict.statusCode, 409, 'losing the race is a conflict, not a generic failure');
  assert.equal(conflict.json().code, 'CLOUD_ORDER_CONFLICT');
  assert.equal(conflict.json().remoteStatus, 'VENDOR_REJECTED', 'the operator is told what the remote truth actually is');
  assert.equal(conflict.json().attempted, 'accept');
  assert.equal(projectionOf('order-D')!.state, 'Rejected', 'local state is corrected to the remote truth rather than left stale');

  // ── E: an unreachable cloud must leave NO optimistic local state ──
  const beforeE = projectionOf('order-E')!;
  assert.equal(beforeE.state, 'AwaitingAcceptance');
  state.nextPostFailure = 'network';
  const unreachable = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-E/accept', headers });
  assert.equal(unreachable.statusCode, 502);
  assert.equal(unreachable.json().code, 'CLOUD_UNREACHABLE');
  const afterE = projectionOf('order-E')!;
  assert.equal(afterE.state, 'AwaitingAcceptance', 'a failed remote transition must never leave the order looking accepted locally');
  assert.equal(afterE.sourceVersion, beforeE.sourceVersion, 'no local version was burned on a transition that did not happen');
  assert.equal(state.remote.get('order-E')!.status, 'WAITING_VENDOR_CONFIRMATION');

  // ── F: reject requires a reason, passes it to the cloud, and records it ──
  const noReason = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-F/reject', headers, payload: { reason: '   ' } });
  assert.equal(noReason.statusCode, 400, 'rejecting queues a real customer refund on the backend — a reason is mandatory');
  const rejected = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-F/reject', headers, payload: { reason: 'Machine breakdown, cannot service today' } });
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.json().remoteStatus, 'VENDOR_REJECTED');
  assert.equal(rejected.json().materialization, 'not_applicable', 'a rejected order never creates a local operational order, and that is not a deferral');
  assert.equal(rejected.json().localOrderId, undefined);
  const rejectBody = state.postBodies.find((entry) => entry.path === '/vendor/orders/order-F/reject');
  assert.equal((rejectBody?.body as any)?.reason, 'Machine breakdown, cannot service today', 'the reason actually reaches the cloud, not just the local note');
  assert.match(projectionOf('order-F')!.notes, /Machine breakdown/, 'the reason is recorded locally too');

  // ── G: a 403 must NOT burn a token refresh — refreshing cannot fix a permission problem ──
  const refreshesBefore = state.refreshCalls;
  state.nextPostFailure = 'forbidden';
  const forbidden = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/orders/order-G/accept', headers });
  assert.equal(forbidden.statusCode, 401, 'an authorization failure is surfaced as such');
  assert.equal(state.refreshCalls, refreshesBefore, 'a 403 does not trigger a pointless token refresh (only a 401 does)');
  assert.equal(projectionOf('order-G')!.state, 'AwaitingAcceptance', 'a forbidden action changes nothing locally');

  console.log('PASS marketplace cloud order actions: cloud-authoritative accept/reject, crash-retry convergence, real conflict detection with local correction, no optimistic write on failure, full local materialization bridge, mandatory reject reason, and 401-only refresh self-test complete');
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.EPIC_MARKETPLACE_CLOUD_API_URL;
  try { closeStore?.(); } catch { /* already closed above */ }
  rmSync(tempDir, { recursive: true, force: true });
}
