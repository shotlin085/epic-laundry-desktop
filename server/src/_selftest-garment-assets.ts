import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'epic-garment-assets-'));
process.env.EPIC_DB_FILE = join(dir, 'epic.sqlite'); process.env.EPIC_DATA_FILE = join(dir, 'legacy.json'); process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
let close: (() => void) | undefined;
try {
  const { store } = await import('./kernel/store.js'); const { auditGarmentAssets } = await import('./modules/laundry/garment-assets.js'); close = () => store.close(); const tenant = 'ASSET-AUDIT';
  const base = { tenant, status: 'Active', version: 1, created_by: 'test', created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as const;
  store.withStoreScope(tenant, 'STORE-ASSET', () => { store.insertRow({ ...base, id: 'cat-top', entity: 'laundry_category', data: { name: 'Topwear' } }); store.insertRow({ ...base, id: 'g-exact', entity: 'laundry_garment', data: { name: 'Shirt', category: 'cat-top', visual_key: 'foldedShirt', photo: '/ui/app/garments/optimized/lndry-folded-shirt-v3.webp', active: true } }); store.insertRow({ ...base, id: 'g-shared', entity: 'laundry_garment', data: { name: 'Formal shirt', category: 'cat-top', visual_key: 'foldedShirt', active: true } }); store.insertRow({ ...base, id: 'g-bad', entity: 'laundry_garment', data: { name: 'Unknown', category: 'cat-top', active: true } }); });
  const report = store.withStoreScope(tenant, 'STORE-ASSET', () => auditGarmentAssets(tenant));
  assert.equal(report.total, 3); assert.equal(report.items[0]?.category, 'Topwear'); assert.equal(report.counts.exact_visual, 1); assert.equal(report.counts.intentional_shared_visual, 1); assert.equal(report.counts.missing, 1); assert.equal(report.ok, false); assert.equal(report.failures, 1);
  console.log('PASS active garment asset audit classification and failure reporting self-test complete');
} finally { close?.(); rmSync(dir, { recursive: true, force: true }); }
