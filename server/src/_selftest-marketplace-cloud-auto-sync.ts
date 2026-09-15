import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-marketplace-cloud-auto-sync-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;

let closeStore: (() => void) | undefined;

try {
  const { store } = await import('./kernel/store.js');
  const { createCloudOrderAutoSync } = await import('./modules/marketplace/cloud-order-auto-sync.js');
  closeStore = () => store.close();

  const tenant = 'AUTO-SYNC';
  const storeId = 'STORE-AUTO-SYNC';
  let now = new Date('2026-09-15T08:00:00.000Z');
  let pullCalls = 0;
  let pullFailure: Error | undefined;
  let connected = true;
  const runner = createCloudOrderAutoSync({
    tenant,
    intervalMs: 10_000,
    now: () => now,
    configured: () => true,
    connected: () => ({ configured: true, connected, remoteVendorId: 'vendor-auto-sync' } as any),
    pull: async () => {
      pullCalls += 1;
      if (pullFailure) throw pullFailure;
      return { pulled: 3, created: 1, updated: 1, skipped: [{ externalOrderId: 'unknown', reason: 'unmapped' }] };
    },
  });
  const run = () => store.withStoreScope(tenant, storeId, () => runner.runOnce());
  const health = () => store.withStoreScope(tenant, storeId, () => store.getMarketplaceCloudSyncHealth(tenant));

  const first = await run();
  assert.equal(first.attempted, true);
  assert.equal(first.health.state, 'Healthy');
  assert.equal(first.health.consecutiveFailures, 0);
  assert.equal(first.health.lastPulled, 3);
  assert.equal(first.health.lastCreated, 1);
  assert.equal(first.health.lastUpdated, 1);
  assert.equal(first.health.lastSkipped, 1);
  assert.equal(pullCalls, 1);
  assert.equal(health()?.state, 'Healthy', 'health survives outside the in-memory runner result');

  pullFailure = new Error('temporary marketplace timeout');
  now = new Date('2026-09-15T08:00:10.000Z');
  const failed = await run();
  assert.equal(failed.attempted, true);
  assert.equal(failed.health.state, 'Backoff');
  assert.equal(failed.health.consecutiveFailures, 1);
  assert.equal(failed.health.lastError, 'temporary marketplace timeout');
  assert.equal(pullCalls, 2);

  // A restart or timer tick before the persisted retry time must not issue a
  // second network request; this is the safety property that makes polling a
  // fallback rather than a cloud outage amplifier.
  now = new Date('2026-09-15T08:00:15.000Z');
  const backoff = await run();
  assert.equal(backoff.attempted, false);
  assert.equal(backoff.reason, 'backoff');
  assert.equal(pullCalls, 2);

  pullFailure = undefined;
  now = new Date('2026-09-15T08:00:30.000Z');
  const recovered = await run();
  assert.equal(recovered.attempted, true);
  assert.equal(recovered.health.state, 'Healthy');
  assert.equal(recovered.health.consecutiveFailures, 0);
  assert.equal(pullCalls, 3);

  connected = false;
  const disconnected = await run();
  assert.equal(disconnected.attempted, false);
  assert.equal(disconnected.reason, 'not-connected');
  assert.equal(disconnected.health.state, 'Idle');
  assert.equal(pullCalls, 3, 'an account that has disconnected never reaches the cloud pull');

  console.log('PASS marketplace cloud auto sync: durable health, bounded exponential backoff, recovery, and disconnected safety verified');
} finally {
  try { closeStore?.(); } catch { /* test cleanup */ }
  rmSync(tempDir, { recursive: true, force: true });
}
