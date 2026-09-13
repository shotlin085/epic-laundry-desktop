import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-marketplace-cloud-catalogue-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
process.env.EPIC_MARKETPLACE_CLOUD_API_URL = 'https://fake-lndry-cloud.test/api/v1';

let closeStore: (() => void) | undefined;
const originalFetch = globalThis.fetch;

// Field names copied verbatim from the real `GET /shop-garment_rates`
// response captured live against the real backend this session (real
// seeded vendor, real Postgres) — not guessed.
const REMOTE_ITEMS = [
  { id: 'vs-001', vendor_id: 'vendor-row-555', garment_rate_id: 'gt-001', price: '450.00', sale_price: null, cost_price: null, stock_quantity: 0, low_stock_threshold: 5, max_order_qty: 50, is_available: true, is_featured: false, sold_out_at: null, approval_status: 'APPROVED', approved_at: null, approved_by: null, rejection_reason: null, deleted_at: null, created_at: '2026-09-11T15:40:14.352Z', updated_at: '2026-09-11T15:40:14.352Z', product: { id: 'gt-001', name: 'Small Carpet', sku: null, image_url: null, category_id: 'cat-1', category_name: 'Carpet Cleaning' }, shop_name: 'LNDRY Prime - Bengaluru Hub' },
  { id: 'vs-002', vendor_id: 'vendor-row-555', garment_rate_id: 'gt-002', price: '300.00', sale_price: '275.00', cost_price: '150.00', stock_quantity: 12, low_stock_threshold: 5, max_order_qty: 50, is_available: true, is_featured: false, sold_out_at: null, approval_status: 'APPROVED', approved_at: null, approved_by: null, rejection_reason: null, deleted_at: null, created_at: '2026-09-11T15:40:14.346Z', updated_at: '2026-09-11T15:40:14.346Z', product: { id: 'gt-002', name: 'Normal Curtain', sku: 'CRT-002', image_url: null, category_id: 'cat-2', category_name: 'Curtain Cleaning' }, shop_name: 'LNDRY Prime - Bengaluru Hub' },
];

function buildMockFetch(opts: { accessToken: string; vendorLinked: boolean; items: typeof REMOTE_ITEMS }): typeof fetch {
  return (async (url: string, init: any = {}) => {
    const path = String(url).replace('https://fake-lndry-cloud.test/api/v1', '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (status: number, payload: unknown) => ({ status, json: async () => payload }) as any;
    const auth = String(init.headers?.authorization || '');

    if (path === '/auth/send-otp' && method === 'POST') return json(200, { success: true });
    if (path === '/auth/verify-otp' && method === 'POST') {
      if (body.otp !== '123456') return json(401, { success: false, message: 'Invalid OTP' });
      return json(200, { success: true, data: { accessToken: opts.accessToken, refreshToken: 'refresh-1', expires_at: new Date(Date.now() + 900_000).toISOString() } });
    }
    // connectCloudSession refreshes once immediately after verify-otp — the
    // real verify-otp token carries no shopRole claim, only refresh-token's
    // response does, and shop-garment_rates' guard reads shopRole straight
    // off the JWT with no DB fallback. Returns the same access token here
    // (this self-test only needs a shopRole-bearing token to exist, not to
    // exercise rotation — that's cloud-client's own self-test).
    if (path === '/auth/refresh-token' && method === 'POST') {
      if (body.refreshToken !== 'refresh-1') return json(401, { success: false, message: 'Invalid refresh token' });
      return json(200, { success: true, data: { access_token: opts.accessToken, refresh_token: 'refresh-1', expires_at: new Date(Date.now() + 900_000).toISOString() } });
    }
    if (path === '/auth/session' && method === 'GET') {
      if (!auth.includes(opts.accessToken)) return json(401, { success: false });
      return json(200, { success: true, data: { user: { id: 'user-001', phone: '9999999999', name: 'Catalogue Vendor', role: 'VENDOR_OWNER' } } });
    }
    if (path === '/vendor/profile' && method === 'GET') {
      if (!auth.includes(opts.accessToken)) return json(401, { success: false });
      if (!opts.vendorLinked) return json(404, { success: false, message: 'Vendor profile not found' });
      return json(200, { success: true, data: { id: 'vendor-row-555', name: 'Catalogue Vendor' } });
    }
    if (path.startsWith('/shop-garment_rates') && method === 'GET') {
      if (!auth.includes(opts.accessToken)) return json(401, { success: false });
      return json(200, { success: true, data: { items: opts.items, total: opts.items.length, page: 1, limit: 200 } });
    }
    const patchMatch = path.match(/^\/shop-garment_rates\/([^/]+)$/);
    if (patchMatch && method === 'PATCH') {
      if (!auth.includes(opts.accessToken)) return json(401, { success: false });
      const item = opts.items.find((i) => i.id === patchMatch[1]);
      if (!item) return json(404, { success: false, message: 'Shop product not found', code: 'PRODUCT_NOT_FOUND' });
      const updated = { ...item, ...body, updated_at: new Date().toISOString() };
      return json(200, { success: true, data: updated });
    }
    const stockMatch = path.match(/^\/shop-garment_rates\/([^/]+)\/stock$/);
    if (stockMatch && method === 'PATCH') {
      if (!auth.includes(opts.accessToken)) return json(401, { success: false });
      const item = opts.items.find((i) => i.id === stockMatch[1]);
      if (!item) return json(404, { success: false, message: 'Shop product not found', code: 'PRODUCT_NOT_FOUND' });
      // Real shape, confirmed live: { shopProduct, prev }, not the flat row
      // — and shopProduct (from findByIdForUpdate's plain SELECT, no JOIN)
      // carries no product/category. This is exactly the mismatch the
      // mock originally got wrong and a real PATCH to a real backend caught.
      const { product: _product, shop_name: _shopName, ...flatColumns } = item as any;
      const shopProduct = { ...flatColumns, stock_quantity: body.stock_quantity, updated_at: new Date().toISOString() };
      return json(200, { success: true, data: { shopProduct, prev: { stock_quantity: item.stock_quantity } } });
    }
    if (path === '/auth/logout' && method === 'POST') return json(200, { success: true });
    throw new Error(`unexpected mock fetch call: ${method} ${path}`);
  }) as unknown as typeof fetch;
}

try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { registerApi } = await import('./api.js');
  closeStore = () => store.close();
  const app = Fastify(); registerApi(app);
  const boot = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'catalogue-owner', password: 'StrongCatalogueOwnerPwd!26', tenant: 'CATALOGUE-API', storeId: 'STORE-CATALOGUE', businessName: 'Catalogue Laundry' } });
  assert.equal(boot.statusCode, 200);
  const headers = { cookie: String(boot.headers['set-cookie']).split(';')[0] };

  // ── Not connected ──────────────────────────────────────────
  const notConnected = await app.inject({ method: 'GET', url: '/api/marketplace/cloud/catalogue', headers });
  assert.equal(notConnected.statusCode, 409);
  assert.equal(notConnected.json().code, 'CLOUD_NOT_CONNECTED');

  // ── Connected but no vendor linked ──────────────────────────
  (globalThis as any).fetch = buildMockFetch({ accessToken: 'token-a', vendorLinked: false, items: REMOTE_ITEMS });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/otp', headers, payload: { phone: '9999999999' } });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/connect', headers, payload: { phone: '9999999999', otp: '123456' } });
  const noVendorList = await app.inject({ method: 'GET', url: '/api/marketplace/cloud/catalogue', headers });
  assert.equal(noVendorList.statusCode, 409, 'reading the catalogue requires an actually-linked vendor, not just a connected account');
  assert.equal(noVendorList.json().code, 'CLOUD_VENDOR_NOT_LINKED');
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/disconnect', headers });

  // ── Connected with a real linked vendor — the real list path ──
  (globalThis as any).fetch = buildMockFetch({ accessToken: 'token-b', vendorLinked: true, items: REMOTE_ITEMS });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/otp', headers, payload: { phone: '9999999999' } });
  await app.inject({ method: 'POST', url: '/api/marketplace/cloud/connect', headers, payload: { phone: '9999999999', otp: '123456' } });

  const list = await app.inject({ method: 'GET', url: '/api/marketplace/cloud/catalogue', headers });
  assert.equal(list.statusCode, 200);
  const items = list.json();
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'vs-001');
  assert.equal(items[0].name, 'Small Carpet', 'name comes from the nested product object, not the vendor_services row itself');
  assert.equal(items[0].categoryName, 'Carpet Cleaning');
  assert.equal(items[0].price, 450, 'price string from the real API is parsed to a number');
  assert.equal(items[0].isAvailable, true);
  assert.equal(items[0].salePrice, undefined, 'a real null sale_price (no sale configured) must stay undefined, not become 0 — Number(null) === 0 is the exact trap this guards against');
  assert.equal(items[0].costPrice, undefined, 'same null-to-0 trap, for cost_price');
  assert.equal(items[1].sku, 'CRT-002');
  assert.equal(items[1].salePrice, 275);

  // ── Update price/availability (PATCH /:id — everything except stock) ──
  const updated = await app.inject({ method: 'PATCH', url: '/api/marketplace/cloud/catalogue/vs-001', headers, payload: { price: 475, isAvailable: false } });
  assert.equal(updated.statusCode, 200);
  const updatedBody = updated.json();
  assert.equal(updatedBody.price, 475);
  assert.equal(updatedBody.isAvailable, false);

  // ── Update stock (PATCH /:id/stock — the separate, row-locked endpoint) ──
  const stocked = await app.inject({ method: 'PATCH', url: '/api/marketplace/cloud/catalogue/vs-002/stock', headers, payload: { stockQuantity: 25 } });
  assert.equal(stocked.statusCode, 200);
  assert.equal(stocked.json().stockQuantity, 25);

  // ── A real 404 from the backend (unknown item id) surfaces as a clean
  // 4xx, not a crash — cloudErrorStatus's generic CloudClientError
  // fallthrough maps any unmatched remote status to 400 today (the same
  // behavior every other cloud route already has; not changed here). ──
  const missing = await app.inject({ method: 'PATCH', url: '/api/marketplace/cloud/catalogue/vs-does-not-exist', headers, payload: { price: 10 } });
  assert.equal(missing.statusCode, 400);

  console.log('PASS marketplace cloud catalogue: real-shape field mapping, not-connected/not-linked guards, price/availability update, and stock update self-test complete');
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.EPIC_MARKETPLACE_CLOUD_API_URL;
  try { closeStore?.(); } catch { /* already closed above */ }
  rmSync(tempDir, { recursive: true, force: true });
}
