import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-platform-review-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
process.env.EPIC_MARKETPLACE_CLOUD_API_URL = 'https://fake-lndry-cloud.test/api/v1';

const originalFetch = globalThis.fetch;
let closeStore: (() => void) | undefined;
const calls: Array<{ method: string; path: string; body: unknown }> = [];

function mockFetch(): typeof fetch {
  return (async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(String(url));
    const path = `${parsed.pathname.replace('/api/v1', '')}${parsed.search}`;
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const authorization = String((init.headers as Record<string, string> | undefined)?.authorization || '');
    calls.push({ method, path, body });
    const json = (status: number, value: unknown) => ({ status, json: async () => value }) as any;
    if (path === '/admin/auth/login' && method === 'POST') {
      assert.deepEqual(body, { email: 'platform@test.local', password: 'PlatformPassword!26' });
      return json(200, { success: true, data: { accessToken: 'platform-access-token', user: { email: 'platform@test.local', full_name: 'Platform Test Admin' }, isSuperAdmin: true } });
    }
    if (path === '/admin/auth/me' && method === 'GET') {
      assert.equal(authorization, 'Bearer platform-access-token');
      return json(200, { success: true, data: { permissions: ['platform.manage'] } });
    }
    if (path === '/vendors/admin/list?status=DRAFT&search=Pending&limit=100' && method === 'GET') {
      assert.equal(authorization, 'Bearer platform-access-token');
      return json(200, { success: true, data: [{ id: 'application-001', name: 'Pending Laundry', owner_name: 'Pending Owner', status: 'DRAFT', city: 'Kolkata', state: 'West Bengal', created_at: '2026-09-13T00:00:00.000Z' }], meta: { total: 1 } });
    }
    if (path === '/vendors/admin/application-001' && method === 'GET') {
      assert.equal(authorization, 'Bearer platform-access-token');
      return json(200, { success: true, data: { id: 'application-001', name: 'Pending Laundry', owner_name: 'Pending Owner', status: 'DRAFT', requested_service_radius_km: 7, requested_daily_capacity: 40, documents: [{ id: 'document-001', document_type: 'GST_CERTIFICATE', status: 'PENDING' }] } });
    }
    if (path === '/vendors/admin/application-001/review' && method === 'POST') {
      assert.equal(authorization, 'Bearer platform-access-token');
      return json(200, { success: true, data: { id: 'application-001', name: 'Pending Laundry', status: (body as any).status, correction_sections: (body as any).correctionSections, rejection_reason: (body as any).rejectionReason } });
    }
    if (path === '/admin/orders?status=OUT_FOR_DELIVERY&search=ORD-1&limit=50&page=1' && method === 'GET') {
      assert.equal(authorization, 'Bearer platform-access-token');
      return json(200, { success: true, data: { orders: [{ id: 'order-001', order_number: 'ORD-1', status: 'OUT_FOR_DELIVERY', customer_name: 'Asha', total_amount: '475.00', payment_status: 'PAID' }], pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } } });
    }
    if (path === '/admin/orders/order-001' && method === 'GET') {
      assert.equal(authorization, 'Bearer platform-access-token');
      return json(200, { success: true, data: { id: 'order-001', order_number: 'ORD-1', status: 'OUT_FOR_DELIVERY', customer_name: 'Asha', items: [{ name: 'Shirt', quantity: 2 }], timeline: [{ to_status: 'OUT_FOR_DELIVERY', changed_at: '2026-09-14T10:00:00.000Z', actor_role: 'RIDER' }] } });
    }
    if (path === '/admin/audit-logs?action=vendor_reviewed&limit=50&page=1' && method === 'GET') {
      assert.equal(authorization, 'Bearer platform-access-token');
      return json(200, { success: true, data: { items: [{ id: 'audit-001', action: 'vendor_reviewed', actor_role: 'ADMIN', target_type: 'vendor', target_id: 'application-001', after: { status: 'CORRECTION_REQUIRED' }, created_at: '2026-09-14T10:05:00.000Z' }], total: 1, page: 1, limit: 50 } });
    }
    throw new Error(`unexpected platform mock call: ${method} ${path}`);
  }) as unknown as typeof fetch;
}

try {
  (globalThis as any).fetch = mockFetch();
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { registerApi } = await import('./api.js');
  const { signIn } = await import('./modules/auth/auth.js');
  closeStore = () => store.close();
  const app = Fastify();
  registerApi(app);
  const bootstrap = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'platform-owner', password: 'PlatformOwnerPassword!26', tenant: 'PLATFORM-REVIEW', storeId: 'STORE-PLATFORM-REVIEW', businessName: 'Platform Review Laundry' } });
  assert.equal(bootstrap.statusCode, 200);
  const ownerHeaders = { cookie: String(bootstrap.headers['set-cookie']).split(';')[0] };

  const notConnected = await app.inject({ method: 'GET', url: '/api/platform/vendors', headers: ownerHeaders });
  assert.equal(notConnected.statusCode, 409, 'vendor review queue fails closed before a platform admin connects');

  const connected = await app.inject({ method: 'POST', url: '/api/platform/connect', headers: ownerHeaders, payload: { email: 'platform@test.local', password: 'PlatformPassword!26' } });
  assert.equal(connected.statusCode, 200, 'separate platform-admin identity connects');
  assert.equal(connected.json().connected, true);
  assert.equal(connected.json().email, 'platform@test.local');

  const list = await app.inject({ method: 'GET', url: '/api/platform/vendors?status=DRAFT&search=Pending&limit=100', headers: ownerHeaders });
  assert.equal(list.statusCode, 200, 'cloud-owned review queue is proxyable through the Desktop server');
  assert.equal(list.json()[0].id, 'application-001');

  const detail = await app.inject({ method: 'GET', url: '/api/platform/vendors/application-001', headers: ownerHeaders });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().documents[0].document_type, 'GST_CERTIFICATE', 'application document metadata remains cloud-owned');

  const review = await app.inject({ method: 'POST', url: '/api/platform/vendors/application-001/review', headers: ownerHeaders, payload: { status: 'CORRECTION_REQUIRED', rejectionReason: 'Please provide a readable GST certificate.', correctionSections: ['documents'] } });
  assert.equal(review.statusCode, 200, 'review action reaches the real-review proxy only after a platform connection exists');
  assert.equal(review.json().status, 'CORRECTION_REQUIRED');
  const remoteReview = calls.find((call) => call.path === '/vendors/admin/application-001/review');
  assert.deepEqual(remoteReview?.body, { status: 'CORRECTION_REQUIRED', rejectionReason: 'Please provide a readable GST certificate.', correctionSections: ['documents'] }, 'the Desktop preserves the backend camel-case review contract exactly');

  const orderList = await app.inject({ method: 'GET', url: '/api/platform/orders?status=OUT_FOR_DELIVERY&search=ORD-1&limit=50&page=1', headers: ownerHeaders });
  assert.equal(orderList.statusCode, 200, 'platform order oversight proxies the real cloud admin directory read-only');
  assert.equal(orderList.json().orders[0].order_number, 'ORD-1');
  const orderDetail = await app.inject({ method: 'GET', url: '/api/platform/orders/order-001', headers: ownerHeaders });
  assert.equal(orderDetail.statusCode, 200, 'platform order oversight reads the cloud-owned order detail');
  assert.equal(orderDetail.json().timeline[0].actor_role, 'RIDER');

  const auditList = await app.inject({ method: 'GET', url: '/api/platform/audit-logs?action=vendor_reviewed&limit=50&page=1', headers: ownerHeaders });
  assert.equal(auditList.statusCode, 200, 'platform audit evidence is proxied as a read-only cloud reader');
  assert.equal(auditList.json().items[0].action, 'vendor_reviewed');

  const staff = await app.inject({ method: 'POST', url: '/api/settings/staff', headers: ownerHeaders, payload: { username: 'platform-counter', password: 'PlatformCounterPassword!26', roles: ['counter_staff'], firstName: 'Platform', lastName: 'Counter' } });
  assert.equal(staff.statusCode, 201);
  const counter = signIn('platform-counter', 'PlatformCounterPassword!26');
  const denied = await app.inject({ method: 'GET', url: '/api/platform/vendors', headers: { cookie: `epic_session=${counter.token}` } });
  assert.equal(denied.statusCode, 403, 'a local counter role cannot access the platform review proxy');
  const deniedOrders = await app.inject({ method: 'GET', url: '/api/platform/orders', headers: { cookie: `epic_session=${counter.token}` } });
  assert.equal(deniedOrders.statusCode, 403, 'a local counter role cannot access the platform order monitor');
  const deniedAudit = await app.inject({ method: 'GET', url: '/api/platform/audit-logs', headers: { cookie: `epic_session=${counter.token}` } });
  assert.equal(deniedAudit.statusCode, 403, 'a local counter role cannot access the platform evidence trail');

  await app.close();
  console.log('PASS platform control: connected admin session, vendor review, read-only order and audit oversight, and local permission guards complete');
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.EPIC_MARKETPLACE_CLOUD_API_URL;
  try { closeStore?.(); } catch { /* already closed */ }
  rmSync(tempDir, { recursive: true, force: true });
}
