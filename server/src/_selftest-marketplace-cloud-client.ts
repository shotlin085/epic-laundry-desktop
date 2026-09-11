import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-marketplace-cloud-client-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
delete process.env.EPIC_MARKETPLACE_CLOUD_API_URL;

let closeStore: (() => void) | undefined;
const originalFetch = globalThis.fetch;

type MockState = { otpSent: string[]; validOtp: string; accessToken: string; refreshToken: string; rotatedAccessToken: string; refreshCalls: number; forceProfile401Once: boolean; vendorLinked: boolean };

function buildMockFetch(state: MockState): typeof fetch {
  return (async (url: string, init: any = {}) => {
    const path = String(url).replace('https://fake-lndry-cloud.test/api/v1', '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (status: number, payload: unknown) => ({ status, json: async () => payload }) as any;

    if (path === '/auth/send-otp' && method === 'POST') {
      state.otpSent.push(body.phone);
      return json(200, { success: true, message: 'OTP sent' });
    }
    if (path === '/auth/verify-otp' && method === 'POST') {
      if (body.otp !== state.validOtp) return json(401, { success: false, message: 'Invalid OTP', code: 'INVALID_OTP' });
      return json(200, { success: true, data: { access_token: state.accessToken, refresh_token: state.refreshToken, expires_at: new Date(Date.now() + 900_000).toISOString() } });
    }
    if (path === '/auth/session' && method === 'GET') {
      // Shape matches the REAL backend, confirmed against a live local instance:
      // the profile is nested under data.user, not flat on data.
      const auth = String(init.headers?.authorization || '');
      if (!auth.includes(state.accessToken) && !auth.includes(state.rotatedAccessToken)) return json(401, { success: false, message: 'Unauthorized' });
      return json(200, { success: true, data: { user: { id: 'vendor-user-001', phone: '9999999999', email: null, name: 'Verify Vendor Co', role: 'VENDOR_OWNER', avatar_url: null }, permissions: [], onboarding_state: { has_application: true, application_status: 'APPROVED', vendor_id: 'vendor-001', vendor_name: 'Verify Vendor Co' } } });
    }
    if (path === '/vendor/profile' && method === 'GET') {
      const auth = String(init.headers?.authorization || '');
      if (state.forceProfile401Once && auth.includes(state.accessToken)) {
        state.forceProfile401Once = false;
        return json(401, { success: false, message: 'Access token expired' });
      }
      if (!auth.includes(state.accessToken) && !auth.includes(state.rotatedAccessToken)) return json(401, { success: false, message: 'Unauthorized' });
      if (!state.vendorLinked) return json(404, { success: false, message: 'Vendor profile not found' });
      // Deliberately a DIFFERENT id than the connecting user's own id
      // ('vendor-user-001') — this is the real backend's actual shape
      // (vendors.id, not users.id) and the connector must keep them separate.
      return json(200, { success: true, data: { id: 'vendor-row-778', name: 'Verify Vendor Co', businessName: 'Verify Vendor Co', commissionRate: 15 } });
    }
    if (path === '/auth/refresh-token' && method === 'POST') {
      state.refreshCalls += 1;
      // The real backend's refreshTokenSchema requires this body key as
      // camelCase `refreshToken`, unlike every other endpoint here which
      // speaks snake_case — confirmed live; asserting it here is what
      // would have caught the original refresh_token-vs-refreshToken bug.
      if (body.refreshToken !== state.refreshToken) return json(401, { success: false, message: 'Invalid refresh token' });
      return json(200, { success: true, data: { access_token: state.rotatedAccessToken, refresh_token: state.refreshToken, expires_at: new Date(Date.now() + 900_000).toISOString() } });
    }
    if (path === '/auth/logout' && method === 'POST') {
      return json(200, { success: true, message: 'Logged out' });
    }
    throw new Error(`unexpected mock fetch call: ${method} ${path}`);
  }) as unknown as typeof fetch;
}

try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { registerApi } = await import('./api.js');
  closeStore = () => store.close();
  const app = Fastify(); registerApi(app);
  const boot = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'cloud-owner', password: 'StrongCloudConnectPassword!26', tenant: 'CLOUD-CONNECT-API', storeId: 'STORE-CLOUD', businessName: 'Cloud Connect Laundry' } });
  assert.equal(boot.statusCode, 200, 'owner bootstrap succeeds');
  const headers = { cookie: String(boot.headers['set-cookie']).split(';')[0] };

  // ── Not configured ──────────────────────────────────────────
  const statusUnconfigured = await app.inject({ method: 'GET', url: '/api/marketplace/cloud/status', headers });
  assert.equal(statusUnconfigured.statusCode, 200);
  assert.deepEqual(statusUnconfigured.json(), { configured: false, connected: false }, 'unconfigured status is explicit, not a silent empty state');

  const otpUnconfigured = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/otp', headers, payload: { phone: '9999999999' } });
  assert.equal(otpUnconfigured.statusCode, 409, 'requesting OTP without cloud configuration fails closed, not silently');
  assert.equal(otpUnconfigured.json().code, 'CLOUD_NOT_CONFIGURED');

  // ── Configure + mock the real backend ───────────────────────
  process.env.EPIC_MARKETPLACE_CLOUD_API_URL = 'https://fake-lndry-cloud.test/api/v1';
  const state: MockState = { otpSent: [], validOtp: '123456', accessToken: 'access-token-v1', refreshToken: 'refresh-token-v1', rotatedAccessToken: 'access-token-v2', refreshCalls: 0, forceProfile401Once: false, vendorLinked: true };
  (globalThis as any).fetch = buildMockFetch(state);

  const statusConfiguredNotConnected = await app.inject({ method: 'GET', url: '/api/marketplace/cloud/status', headers });
  assert.deepEqual(statusConfiguredNotConnected.json(), { configured: true, connected: false }, 'configured-but-not-connected is a distinct state from not-configured');

  const otpOk = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/otp', headers, payload: { phone: '9999999999' } });
  assert.equal(otpOk.statusCode, 200);
  assert.deepEqual(state.otpSent, ['9999999999'], 'OTP request actually reached the (mocked) real backend with the given phone');

  // ── Wrong OTP fails closed with the real backend's auth error ──
  const wrongOtp = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/connect', headers, payload: { phone: '9999999999', otp: '000000' } });
  assert.equal(wrongOtp.statusCode, 401, 'wrong OTP surfaces the backend auth failure, not a fabricated success');
  assert.equal(wrongOtp.json().code, 'CLOUD_AUTH_FAILED');
  assert.deepEqual(await getStatus(), { configured: true, connected: false }, 'a failed connect attempt must not leave a connected state behind');

  // ── Correct OTP connects for real ───────────────────────────
  const connected = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/connect', headers, payload: { phone: '9999999999', otp: '123456' } });
  assert.equal(connected.statusCode, 200);
  assert.equal(connected.json().connected, true);
  assert.equal(connected.json().remoteVendorName, 'Verify Vendor Co');
  assert.equal(connected.json().remoteVendorId, 'vendor-row-778', 'the real vendor identity (vendors.id) is captured');
  assert.notEqual(connected.json().remoteVendorId, 'vendor-user-001', 'the vendor id must NEVER be conflated with the connecting user id — they are different backend rows');
  assert.equal(connected.json().remoteUserRole, 'VENDOR_OWNER');
  assert.equal(connected.json().phone, '9999999999');
  assert.equal(typeof (connected.json() as any).accessToken, 'undefined', 'the access token must never be returned to a caller of this API');
  assert.equal(typeof (connected.json() as any).refreshToken, 'undefined', 'the refresh token must never be returned to a caller of this API');

  // Verify the same separation is durable in storage, not just in the API response.
  const storedIdentity = store.withStoreScope('CLOUD-CONNECT-API', 'STORE-CLOUD', () => store.getMarketplaceCloudSession('CLOUD-CONNECT-API'));
  assert.equal(storedIdentity?.remoteVendorId, 'vendor-row-778');
  assert.equal(storedIdentity?.remoteUserId, 'vendor-user-001');
  assert.notEqual(storedIdentity?.remoteVendorId, storedIdentity?.remoteUserId, 'vendor identity and connecting-user identity are stored as distinct facts');

  // ── At-rest encryption: the stored row must not contain the plaintext tokens ──
  const storedSession = store.withStoreScope('CLOUD-CONNECT-API', 'STORE-CLOUD', () => store.getMarketplaceCloudSession('CLOUD-CONNECT-API'));
  assert.ok(storedSession, 'a connected session row exists');
  assert.ok(!storedSession!.encryptedTokensJson.includes(state.accessToken), 'the plaintext access token must never be persisted');
  assert.ok(!storedSession!.encryptedTokensJson.includes(state.refreshToken), 'the plaintext refresh token must never be persisted');
  const envelope = JSON.parse(storedSession!.encryptedTokensJson);
  assert.ok(typeof envelope.iv === 'string' && typeof envelope.tag === 'string' && typeof envelope.ciphertext === 'string', 'tokens are stored as a genuine AES-GCM envelope, not a re-encoded copy of the plaintext');

  // ── Real data round trip through the connected session ──────
  const profile = await app.inject({ method: 'GET', url: '/api/marketplace/cloud/vendor-profile', headers });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().businessName, 'Verify Vendor Co', 'fetched real vendor data through the connected cloud session');
  assert.equal(profile.json().commissionRate, 15);

  // ── Expired access token triggers exactly one silent refresh-and-retry ──
  state.forceProfile401Once = true;
  const refreshedProfile = await app.inject({ method: 'GET', url: '/api/marketplace/cloud/vendor-profile', headers });
  assert.equal(refreshedProfile.statusCode, 200, 'an expired access token is transparently refreshed, not surfaced as a failure');
  assert.equal(state.refreshCalls, 1, 'refresh happened exactly once for one expired-token request');
  assert.equal(refreshedProfile.json().businessName, 'Verify Vendor Co');

  // ── Disconnect clears the session and calls the real backend's logout ──
  const disconnected = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/disconnect', headers });
  assert.equal(disconnected.statusCode, 200);
  assert.deepEqual(disconnected.json(), { configured: true, connected: false });

  const afterDisconnectProfile = await app.inject({ method: 'GET', url: '/api/marketplace/cloud/vendor-profile', headers });
  assert.equal(afterDisconnectProfile.statusCode, 409, 'no cached vendor data is servable once disconnected');
  assert.equal(afterDisconnectProfile.json().code, 'CLOUD_NOT_CONNECTED');

  // ── An account with NO linked vendor still connects successfully — a real
  // state (platform admin, plain customer), not fabricated vendor data ──
  state.vendorLinked = false;
  const reconnectedNoVendor = await app.inject({ method: 'POST', url: '/api/marketplace/cloud/connect', headers, payload: { phone: '9999999999', otp: '123456' } });
  assert.equal(reconnectedNoVendor.statusCode, 200);
  assert.equal(reconnectedNoVendor.json().connected, true, 'connecting must not require a linked vendor to succeed');
  assert.equal(reconnectedNoVendor.json().remoteVendorId, undefined, 'no vendor id is fabricated when none is linked');
  assert.equal(reconnectedNoVendor.json().remoteVendorName, undefined);
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/disconnect', headers });

  async function getStatus() {
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/cloud/status', headers });
    return res.json();
  }

  console.log('PASS marketplace cloud connector: configuration state, real OTP round trip (mocked backend), at-rest token encryption, transparent refresh-and-retry, and disconnect self-test complete');
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.EPIC_MARKETPLACE_CLOUD_API_URL;
  try { closeStore?.(); } catch { /* already closed above */ }
  rmSync(tempDir, { recursive: true, force: true });
}
