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

  const staff = await app.inject({ method: 'POST', url: '/api/settings/staff', headers: ownerHeaders, payload: { username: 'platform-counter', password: 'PlatformCounterPassword!26', roles: ['counter_staff'], firstName: 'Platform', lastName: 'Counter' } });
  assert.equal(staff.statusCode, 201);
  const counter = signIn('platform-counter', 'PlatformCounterPassword!26');
  const denied = await app.inject({ method: 'GET', url: '/api/platform/vendors', headers: { cookie: `epic_session=${counter.token}` } });
  assert.equal(denied.statusCode, 403, 'a local counter role cannot access the platform review proxy');

  await app.close();
  console.log('PASS platform vendor review: connected admin session, filtered queue, application detail, cloud-authoritative correction request, and local permission guard complete');
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.EPIC_MARKETPLACE_CLOUD_API_URL;
  try { closeStore?.(); } catch { /* already closed */ }
  rmSync(tempDir, { recursive: true, force: true });
}
