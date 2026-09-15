import { store, type MarketplaceCloudSyncHealthRecord } from '../../kernel/store.js';
import { getCloudConnectionStatus, isCloudConfigured } from './cloud-session.js';
import { pullCloudOrders, type CloudOrderSyncSummary } from './cloud-order-sync.js';

const MIN_INTERVAL_MS = 5_000;
const MAX_INTERVAL_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

export type CloudOrderAutoSyncRun = {
  attempted: boolean;
  reason?: 'not-configured' | 'not-connected' | 'vendor-not-linked' | 'backoff' | 'already-running';
  health: MarketplaceCloudSyncHealthRecord;
};

export type CloudOrderAutoSync = {
  start(): void;
  stop(): void;
  runOnce(): Promise<CloudOrderAutoSyncRun>;
};

type Options = {
  tenant: string;
  actor?: string;
  intervalMs?: number;
  now?: () => Date;
  configured?: () => boolean;
  connected?: (tenant: string) => ReturnType<typeof getCloudConnectionStatus>;
  pull?: (tenant: string, actor: string) => Promise<CloudOrderSyncSummary>;
  schedule?: (work: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
};

function clampInterval(value: number | undefined) {
  const parsed = Number(value || 30_000);
  return Number.isFinite(parsed) ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(parsed))) : 30_000;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'cloud order pull failed');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

/**
 * Direct REST polling fallback for a connected LNDRY Cloud vendor account.
 *
 * The cloud backend does not expose Desktop's envelope/outbox protocol, so
 * this tracks a separate durable health record and never marks any local
 * device outbox event acknowledged. Pulls are idempotent at the projection
 * layer and the persisted next-attempt timestamp prevents restart loops from
 * hammering a temporarily unavailable cloud endpoint.
 */
export function createCloudOrderAutoSync(options: Options): CloudOrderAutoSync {
  const tenant = options.tenant;
  const actor = options.actor || 'system:marketplace-cloud-sync';
  const intervalMs = clampInterval(options.intervalMs);
  const clock = options.now || (() => new Date());
  const configured = options.configured || isCloudConfigured;
  const connection = options.connected || getCloudConnectionStatus;
  const pull = options.pull || pullCloudOrders;
  const schedule = options.schedule || ((work, delay) => setTimeout(work, delay));
  const cancel = options.cancel || ((handle) => clearTimeout(handle));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let started = false;
  const runningStores = new Set<string>();

  const save = (input: Omit<MarketplaceCloudSyncHealthRecord, 'tenant' | 'storeId' | 'updatedAt'>) =>
    store.saveMarketplaceCloudSyncHealth({ ...input, tenant, storeId: store.currentStore(tenant), updatedAt: clock().toISOString() });

  const idle = (reason: NonNullable<CloudOrderAutoSyncRun['reason']>) => {
    const previous = store.getMarketplaceCloudSyncHealth(tenant);
    if (previous?.state === 'Idle' && previous.lastError === reason) return previous;
    return save({
      state: 'Idle', lastAttemptAt: previous?.lastAttemptAt, lastSuccessAt: previous?.lastSuccessAt,
      lastError: reason, nextAttemptAt: undefined, consecutiveFailures: 0,
      lastPulled: previous?.lastPulled || 0, lastCreated: previous?.lastCreated || 0,
      lastUpdated: previous?.lastUpdated || 0, lastSkipped: previous?.lastSkipped || 0,
    });
  };

  const scheduleNext = (delayMs: number) => {
    if (stopped) return;
    timer = schedule(() => { void runAndSchedule(); }, Math.max(0, delayMs));
  };

  const runOnce = async (): Promise<CloudOrderAutoSyncRun> => {
    const storeId = store.currentStore(tenant);
    if (runningStores.has(storeId)) {
      const health = store.getMarketplaceCloudSyncHealth(tenant) || idle('already-running');
      return { attempted: false, reason: 'already-running', health };
    }
    if (!configured()) {
      const health = idle('not-configured');
      return { attempted: false, reason: 'not-configured', health };
    }
    const status = connection(tenant);
    if (!status.connected) {
      const health = idle('not-connected');
      return { attempted: false, reason: 'not-connected', health };
    }
    if (!status.remoteVendorId) {
      const health = idle('vendor-not-linked');
      return { attempted: false, reason: 'vendor-not-linked', health };
    }
    const previous = store.getMarketplaceCloudSyncHealth(tenant);
    const now = clock();
    const nextAttemptAt = previous?.nextAttemptAt ? Date.parse(previous.nextAttemptAt) : NaN;
    if (previous?.state === 'Backoff' && Number.isFinite(nextAttemptAt) && nextAttemptAt > now.getTime()) {
      return { attempted: false, reason: 'backoff', health: previous };
    }

    runningStores.add(storeId);
    save({
      state: 'Syncing', lastAttemptAt: now.toISOString(), lastSuccessAt: previous?.lastSuccessAt,
      lastError: undefined, nextAttemptAt: undefined, consecutiveFailures: previous?.consecutiveFailures || 0,
      lastPulled: previous?.lastPulled || 0, lastCreated: previous?.lastCreated || 0,
      lastUpdated: previous?.lastUpdated || 0, lastSkipped: previous?.lastSkipped || 0,
    });
    try {
      const summary = await pull(tenant, actor);
      const health = save({
        state: 'Healthy', lastAttemptAt: now.toISOString(), lastSuccessAt: clock().toISOString(),
        lastError: undefined, nextAttemptAt: new Date(clock().getTime() + intervalMs).toISOString(), consecutiveFailures: 0,
        lastPulled: summary.pulled, lastCreated: summary.created, lastUpdated: summary.updated, lastSkipped: summary.skipped.length,
      });
      return { attempted: true, health };
    } catch (error) {
      const failures = (previous?.consecutiveFailures || 0) + 1;
      const delay = Math.min(MAX_BACKOFF_MS, intervalMs * (2 ** Math.min(failures, 8)));
      const health = save({
        state: 'Backoff', lastAttemptAt: now.toISOString(), lastSuccessAt: previous?.lastSuccessAt,
        lastError: errorMessage(error), nextAttemptAt: new Date(clock().getTime() + delay).toISOString(),
        consecutiveFailures: failures, lastPulled: previous?.lastPulled || 0, lastCreated: previous?.lastCreated || 0,
        lastUpdated: previous?.lastUpdated || 0, lastSkipped: previous?.lastSkipped || 0,
      });
      return { attempted: true, health };
    } finally {
      runningStores.delete(storeId);
    }
  };

  const runAndSchedule = async () => {
    // Each store owns a distinct encrypted vendor session and projection
    // space. Never let one store's cloud pull share credentials, health or
    // backoff state with another. AsyncLocalStorage preserves this explicit
    // scope through the promise returned by runOnce.
    const storeIds = store.listConnectedMarketplaceCloudSessionStoreIds(tenant);
    const targets = storeIds.length ? storeIds : [store.currentStore(tenant)];
    await Promise.all(targets.map((storeId) => store.withStoreScope(tenant, storeId, () => runOnce())));
    if (stopped) return;
    // Backoff is enforced durably inside runOnce. Keep the scheduler regular
    // and bounded so a newly connected store is discovered promptly, while
    // never issuing a failed store another network request before its saved
    // nextAttemptAt.
    scheduleNext(intervalMs);
  };

  return {
    start() { if (!stopped && !started) { started = true; void runAndSchedule(); } },
    stop() { stopped = true; if (timer) cancel(timer); timer = undefined; },
    runOnce,
  };
}
