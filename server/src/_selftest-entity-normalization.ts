import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-entity-normalization-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = join(tempDir, 'legacy.json');
let closeStore: (() => void) | undefined;

try {
  const { store } = await import('./kernel/store.js');
  closeStore = () => store.close();
  const { bookLaundryOrder, laundryCatalogue, seedLaundryDefaults } = await import('./modules/laundry/domain.js');
  const { applyEntityNormalization, previewEntityNormalization } = await import('./modules/ops/entity-normalization.js');
  const tenant = 'ENTITY-NORMALIZE'; const actor = 'migration-owner';
  store.withStoreScope(tenant, 'STORE-DEFAULT', () => seedLaundryDefaults(tenant));
  const catalogue = store.withStoreScope(tenant, 'STORE-DEFAULT', () => laundryCatalogue(tenant));
  const garment = catalogue.garments[0];
  const service = catalogue.services.find((candidate: any) => catalogue.prices.some((price: any) => price.garment === garment.id && price.service === candidate.id))!;
  store.withStoreScope(tenant, 'STORE-DEFAULT', () => bookLaundryOrder(tenant, actor, {
    customer: { name: 'Migration Customer', phone: '9000000456' },
    items: [{ garment: garment.id, service: service.id, qty: 2 }], expectedDeliveryDate: '2026-09-10', fulfillmentMode: 'Home Delivery', paymentMode: 'Pay Later',
  }));
  const partyPreview = store.withStoreScope(tenant, 'STORE-DEFAULT', () => previewEntityNormalization(tenant, 'party'));
  assert.equal(partyPreview.sourceCount, 1, 'customer source row is discovered');
  assert.equal(partyPreview.invalid, 0, 'valid customer source row passes preflight');
  let partyRun: any;
  do { partyRun = store.withStoreScope(tenant, 'STORE-DEFAULT', () => applyEntityNormalization(tenant, actor, 'party', 1)); } while (!partyRun.done);
  assert.equal(partyRun.status, 'completed', 'customer migration completes');
  assert.equal(store.withStoreScope(tenant, 'STORE-DEFAULT', () => store.listNormalizedCustomers(tenant)).length, 1, 'customer projection is persisted');
  const orderPreview = store.withStoreScope(tenant, 'STORE-DEFAULT', () => previewEntityNormalization(tenant, 'laundry_order'));
  assert.equal(orderPreview.sourceCount, 1, 'order source row is discovered');
  assert.equal(orderPreview.invalid, 0, 'valid order source row passes preflight after customer migration');
  let orderRun: any;
  do { orderRun = store.withStoreScope(tenant, 'STORE-DEFAULT', () => applyEntityNormalization(tenant, actor, 'laundry_order', 1)); } while (!orderRun.done);
  assert.equal(orderRun.status, 'completed', 'order migration completes');
  const normalizedOrders = store.withStoreScope(tenant, 'STORE-DEFAULT', () => store.listNormalizedOrders(tenant));
  assert.equal(normalizedOrders.length, 1, 'order projection is persisted');
  assert.equal(normalizedOrders[0].items.length, 1, 'order item projection is persisted');
  assert.equal(normalizedOrders[0].items[0].quantityMilli, 2000, 'piece quantity is preserved at fixed 0.001 scale');
  const repeat = store.withStoreScope(tenant, 'STORE-DEFAULT', () => applyEntityNormalization(tenant, actor, 'laundry_order', 1));
  assert.equal(repeat.done, true, 'completed migration is idempotent for an unchanged source set');
  assert.equal(store.withStoreScope(tenant, 'STORE-DEFAULT', () => store.listCompatibilityMigrationRuns(tenant).filter((run) => run.status === 'completed').length), 2, 'migration evidence is retained for both entities');
  const { freshDatabaseRestoreRehearsal } = await import('./modules/ops/fresh-recovery.js');
  const backup = store.withStoreScope(tenant, 'STORE-DEFAULT', () => store.snapshotFor(tenant, 'STORE-DEFAULT'));
  const rehearsal = freshDatabaseRestoreRehearsal(tenant, 'STORE-DEFAULT', backup);
  assert.equal(rehearsal.counts.normalizedCustomers, 1, 'fresh restore preserves normalized customer projections');
  assert.equal(rehearsal.counts.normalizedOrders, 1, 'fresh restore preserves normalized order projections');
  assert.equal(store.migrationStatus().at(-1)?.version, 39, 'catalogue visual, operational, search, marketplace identity, and platform-admin migrations remain checksum-tracked at the current migration head');
  console.log('PASS  controlled customer/order normalization, fixed-scale item projection, resumability and idempotency self-test complete');
} finally {
  closeStore?.();
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort Windows cleanup */ }
}
