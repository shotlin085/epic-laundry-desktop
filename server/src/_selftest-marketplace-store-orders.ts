import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Proves the three-way split store-order-push.ts's design depends on:
// a walk-in booking for a phone that resolves to a real LNDRY account pushes
// exactly one store order; a walk-in for an unresolved phone pushes zero
// (and never fails the local sale); an offline-replayed booking pushes
// exactly one too; and — the actual circular-write risk the design doc calls
// out — a marketplace-ORIGIN order materialized locally via edge-sync pushes
// zero, because that customer's purchase didn't happen at this counter.

const tempDir = mkdtempSync(join(tmpdir(), 'epic-marketplace-store-orders-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'epic.json');
process.env.EPIC_MARKETPLACE_CLOUD_API_URL = 'https://fake-lndry-cloud.test/api/v1';

const LINKED_PHONE = '9000000701';
const LINKED_USER_ID = 'real-user-linked-001';
const UNKNOWN_PHONE = '9000000702';

type MockState = {
  accessToken: string;
  resolveCalls: string[];
  pushedOrders: Array<{ path: string; body: any }>;
};

function buildMockFetch(state: MockState): typeof fetch {
  return (async (url: string, init: any = {}) => {
    const path = String(url).replace('https://fake-lndry-cloud.test/api/v1', '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (status: number, payload: unknown) => ({ status, json: async () => payload }) as any;

    if (path === '/auth/send-otp' && method === 'POST') return json(200, { success: true, data: { otp: '123456' } });
    if (path === '/auth/verify-otp' && method === 'POST') return json(200, { success: true, data: { accessToken: state.accessToken, refreshToken: 'refresh-1' } });
    if (path === '/auth/refresh-token' && method === 'POST') return json(200, { success: true, data: { accessToken: state.accessToken, refreshToken: 'refresh-1' } });
    if (path === '/auth/session' && method === 'GET') return json(200, { success: true, data: { user: { id: 'user-store-owner', phone: '9999999999', name: 'Store Orders Vendor', role: 'VENDOR_OWNER' } } });
    if (path === '/vendor/profile' && method === 'GET') return json(200, { success: true, data: { id: 'vendor-row-store-orders', name: 'Store Orders Vendor' } });

    if (path === '/vendor/customers/resolve-phone' && method === 'POST') {
      state.resolveCalls.push(body.phone);
      if (body.phone === LINKED_PHONE) return json(200, { success: true, data: { userId: LINKED_USER_ID, name: 'Linked Customer' } });
      return json(404, { success: false, message: 'No LNDRY account found for this phone number', code: 'NOT_FOUND' });
    }

    if (path === '/vendor/store-orders' && method === 'POST') {
      state.pushedOrders.push({ path, body });
      return json(200, { success: true, data: { id: `store-order-${state.pushedOrders.length}`, ...body } });
    }

    throw new Error(`unexpected mock fetch call: ${method} ${path}`);
  }) as unknown as typeof fetch;
}

let closeStore: (() => void) | undefined;
const originalFetch = globalThis.fetch;

try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { registerApi } = await import('./api.js');
  const { bootstrapOwner, signIn } = await import('./modules/auth/auth.js');
  const { laundryCatalogue, seedLaundryDefaults } = await import('./modules/laundry/domain.js');
  const { createDeviceEnrollment, actOnMarketplaceOrder, registerMarketplaceDevice, receiveMarketplaceOrder } = await import('./modules/marketplace/edge-sync.js');
  const { MarketplaceIntegrationSimulator } = await import('./modules/marketplace/simulator.js');
  const { saveSupplierTaxProfile } = await import('./modules/gst/tax-policy.js');
  closeStore = () => store.close();

  const owner = bootstrapOwner({ username: 'store-orders-owner', password: 'StoreOrdersOwnerPassword!26', tenant: 'STORE-ORDERS', storeId: 'STORE-ORDERS-MAIN' });
  store.withStoreScope(owner.tenant, owner.storeId, () => seedLaundryDefaults(owner.tenant));
  store.withStoreScope(owner.tenant, owner.storeId, () => saveSupplierTaxProfile(owner.tenant, owner.username, { legalName: 'Store Orders Laundry Pvt Ltd', tradeName: 'Store Orders Laundry', address: '1 Test Road, Kolkata', stateCode: '19', pincode: '700001', registrationStatus: 'Unregistered', einvoiceState: 'NotApplicable' }));
  const catalogue = store.withStoreScope(owner.tenant, owner.storeId, () => laundryCatalogue(owner.tenant));
  const garment = catalogue.garments.find((item: any) => item.unit === 'Piece')!;
  const service = catalogue.services[0]!;
  const session = signIn('store-orders-owner', 'StoreOrdersOwnerPassword!26');
  const headers = { cookie: `epic_session=${session.token}` };
  const app = Fastify(); registerApi(app);

  const state: MockState = { accessToken: 'token-store-orders', resolveCalls: [], pushedOrders: [] };
  (globalThis as any).fetch = buildMockFetch(state);

  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/otp', headers, payload: { phone: '9999999999' } });
  const connect = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/connect', headers, payload: { phone: '9999999999', otp: '123456' } });
  assert.equal(connect.statusCode, 200, `cloud connect succeeds: ${connect.body}`);

  // ── A: a walk-in sale for a phone that resolves to a real account pushes exactly one store order ──
  const bookLinked = await app.inject({
    method: 'POST', url: '/api/laundry/orders',
    headers: { ...headers, 'idempotency-key': 'store-order-linked-001' },
    payload: { customer: { name: 'Linked Customer', phone: LINKED_PHONE }, items: [{ garment: garment.id, service: service.id, qty: 2 }], expectedDeliveryDate: '2026-09-20', fulfillmentMode: 'Home Delivery', paymentMode: 'Cash' },
  });
  assert.equal(bookLinked.statusCode, 201, `linked-phone booking succeeds: ${bookLinked.body}`);
  const linkedOrder = bookLinked.json().order;
  await new Promise((resolve) => setTimeout(resolve, 20)); // the push is fire-and-forget
  assert.equal(state.pushedOrders.length, 1, 'a walk-in sale for a resolvable phone pushes exactly one store order');
  assert.equal(state.pushedOrders[0].body.customerUserId, LINKED_USER_ID, 'the pushed order is attributed to the resolved real account');
  assert.equal(state.pushedOrders[0].body.posOrderId, linkedOrder.id, 'the local order id is the idempotency key on the cloud side');
  assert.equal(state.pushedOrders[0].body.totalPaise, Math.round(linkedOrder.grandTotal * 100), 'totalPaise matches the real grand total, converted to paise');
  assert.equal(state.pushedOrders[0].body.items.length, 1, 'the denormalized item snapshot carries one line');
  assert.equal(state.pushedOrders[0].body.items[0].qty, 2);
  assert.equal(state.pushedOrders[0].body.paymentMethod, 'Cash');

  // ── B: a walk-in sale for a phone with no real account pushes zero, and the local sale is unaffected ──
  const bookUnknown = await app.inject({
    method: 'POST', url: '/api/laundry/orders',
    headers: { ...headers, 'idempotency-key': 'store-order-unknown-001' },
    payload: { customer: { name: 'Unknown Customer', phone: UNKNOWN_PHONE }, items: [{ garment: garment.id, service: service.id, qty: 1 }], expectedDeliveryDate: '2026-09-20', fulfillmentMode: 'Home Delivery', paymentMode: 'Cash' },
  });
  assert.equal(bookUnknown.statusCode, 201, `unresolvable-phone booking still succeeds locally: ${bookUnknown.body}`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(state.pushedOrders.length, 1, 'a walk-in sale for a phone with no real account pushes nothing new');

  // ── C: an offline-replayed booking for the linked phone also pushes exactly one ──
  const replay = await app.inject({
    method: 'POST', url: '/api/sync/push', headers,
    payload: { docs: [{ entity: 'laundry_order', idempotencyKey: 'store-order-offline-001', data: { customer: { name: 'Linked Customer', phone: LINKED_PHONE }, items: [{ garment: garment.id, service: service.id, qty: 1 }], expectedDeliveryDate: '2026-09-21', fulfillmentMode: 'Home Delivery', paymentMode: 'Cash' } }] },
  });
  assert.equal(replay.statusCode, 200, `offline replay succeeds: ${replay.body}`);
  assert.equal(replay.json().results[0].ok, true, 'the replayed booking itself succeeded');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(state.pushedOrders.length, 2, 'an offline-replayed walk-in booking also pushes a store order');
  assert.equal(state.resolveCalls.filter((phone) => phone === LINKED_PHONE).length, 1, 'the second sale for an already-linked local customer reuses the saved link instead of resolving the phone again');

  // ── D: a marketplace-ORIGIN order materialized via edge-sync must push ZERO — the exact circular-write this design avoids ──
  const enrollment = store.withStoreScope(owner.tenant, owner.storeId, () => createDeviceEnrollment());
  const device = store.withStoreScope(owner.tenant, owner.storeId, () => registerMarketplaceDevice(owner.tenant, owner.username, {
    deviceId: enrollment.deviceId, vendorId: 'VENDOR-MKT', station: 'Store-orders test station', publicKey: enrollment.publicKey,
    credentialRef: 'sim://store-orders/device-token', softwareVersion: '4.0.0-test', status: 'Registered',
  }));
  const simulator = new MarketplaceIntegrationSimulator();
  const orderEnvelope = simulator.enqueueOrder(device.id, {
    tenantId: owner.tenant, vendorId: 'VENDOR-MKT', storeId: owner.storeId, aggregateVersion: 1, eventVersion: 1, correlationId: 'store-orders-mkt-1', externalOrderId: 'APP-ORDER-STORE-001',
    eventType: 'marketplace.order.assigned.v1', payload: {
      channel: 'CUSTOMER_APP', state: 'AwaitingAcceptance', orderNumber: 'APP-ORDER-STORE-001',
      customer: { name: 'App Customer', phone: '9000000703' },
      pickup: { address: '1 App Street', fulfillmentMode: 'Home Delivery' },
      request: { items: [{ garmentId: garment.id, serviceId: service.id, qty: 1 }], expectedDeliveryDate: '2026-09-22' },
      paymentState: 'Pending', externalCustomerId: 'cust-app-store-001',
    },
  });
  for (const event of simulator.pull(device.id)) store.withStoreScope(owner.tenant, owner.storeId, () => receiveMarketplaceOrder(owner.tenant, owner.username, event));
  const accepted = store.withStoreScope(owner.tenant, owner.storeId, () => actOnMarketplaceOrder(owner.tenant, owner.username, 'APP-ORDER-STORE-001', { action: 'accept' }));
  assert.equal(accepted.materialized?.created, true, 'the marketplace order materializes into a real local order');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(state.pushedOrders.length, 2, 'materializing a marketplace-origin order pushes NOTHING back to the cloud — the exact circular write this design avoids');

  console.log('PASS marketplace store-orders: linked-phone push, unresolved-phone no-op, offline-replay push, link reuse, and materialize-never-pushes-back self-test complete');
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.EPIC_MARKETPLACE_CLOUD_API_URL;
  try { closeStore?.(); } catch { /* already closed above */ }
  rmSync(tempDir, { recursive: true, force: true });
}
