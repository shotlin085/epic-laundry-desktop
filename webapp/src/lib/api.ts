// When served at /ui/app/, the API is at ../../api relative to origin root.
const BASE = "/api";

type RequestOptions = { idempotencyKey?: string };

const idempotencyKey = () => crypto.randomUUID();
const notifyUnauthorized = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('epic-auth-expired'));
};
// A 401 from the marketplace cloud connector (`code: 'CLOUD_AUTH_FAILED'`,
// e.g. wrong OTP, or a dead connector token the server couldn't refresh)
// means the REMOTE marketplace session is the thing that's invalid — not
// the operator's own Desktop login. Treating every 401 the same forced the
// whole app into "Your session expired, sign in again" over a marketplace
// hiccup unrelated to the operator's own session (caught live: a stale
// connector token on the online-orders page logged the operator out of the
// entire counter workspace, not just the marketplace panel).
const notifyUnauthorizedUnlessCloud = (body: unknown) => {
  if (body && typeof body === 'object' && (body as { code?: string }).code === 'CLOUD_AUTH_FAILED') return;
  notifyUnauthorized();
};

export type OfflineQueueItem = {
  id: string;
  entity: 'laundry_order' | 'laundry_expense' | 'party';
  data: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  deadLetter?: boolean;
};

const OFFLINE_QUEUE_KEY = 'epic-laundry-offline-commands-v1';
const queueEvent = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('epic-offline-queue-changed')); };
const randomId = () => typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export class OfflineQueuedError extends Error {
  readonly queued = true;
  constructor(public readonly commandId: string) { super('The local server is unavailable. This action was saved to the offline queue and will retry when the connection returns.'); this.name = 'OfflineQueuedError'; }
}

export class ApiError extends Error {
  constructor(message: string, readonly code?: string, readonly details?: Record<string, unknown>) { super(message); this.name = 'ApiError'; }
}

const operatorMessages: Record<string, string> = {
  TAG_NOT_FOUND: 'That tag was not found in this branch. Check the code and scan the active store tag.',
  TAG_RETIRED: 'This tag was replaced. Scan the current active tag shown in the history.',
  INVALID_GARMENT_TRANSITION: 'That garment cannot move to the selected stage from its current stage.',
  INVALID_CONTAINER_TRANSITION: 'That container cannot move to the selected stage from its current stage.',
  ASSEMBLY_INCOMPLETE: 'Assembly is blocked until every tracked garment or container reaches its required ready state.',
  STALE_ORDER_VERSION: 'This order changed in another workspace. Refresh it before trying again.',
  ORDER_NOT_FOUND: 'This order is no longer available in the active store.',
  PRINT_JOB_INVALID: 'The print request is invalid. Check the selected document, tags, and copy count.',
  PRINT_JOB_FAILED: 'The print job failed. Record the failure reason and retry from Print Centre.',
  RIDER_ONLY_ACCOUNT: 'This phone is registered as a Captain (delivery) account. Captains cannot access the store desktop app.',
  AMBIGUOUS_VENDOR_ACCOUNT: 'This phone is not recognized as a vendor account for any shop. Contact support if you believe this is wrong.',
  CLOUD_LOGIN_INPUT_REQUIRED: 'Enter your phone number and the one-time code.',
};

export function operatorErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return (error.code && operatorMessages[error.code]) || error.message || fallback;
  return error instanceof Error ? error.message || fallback : fallback;
}

function readOfflineQueue(): OfflineQueueItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string' && typeof item.entity === 'string') : [];
  } catch { return []; }
}
function writeOfflineQueue(items: OfflineQueueItem[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
  queueEvent();
}
export function offlineQueueSnapshot() { return readOfflineQueue(); }
export function clearOfflineDeadLetters() { writeOfflineQueue(readOfflineQueue().filter((item) => !item.deadLetter)); }
export function retryOfflineDeadLetters() { writeOfflineQueue(readOfflineQueue().map((item) => item.deadLetter ? { ...item, attempts: 0, deadLetter: false, nextAttemptAt: undefined, lastError: undefined } : item)); }
export function exportOfflineQueue() { return JSON.stringify(readOfflineQueue(), null, 2); }

function isNetworkFailure(error: unknown) {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return /failed to fetch|networkerror|network request failed|connection refused|local server is unavailable/i.test(message);
}

export async function apiPostOffline<T = any>(path: string, body: Record<string, unknown>, entity: OfflineQueueItem['entity']): Promise<T> {
  const idempotencyKey = randomId();
  try { return await apiPost<T>(path, body, { idempotencyKey }); }
  catch (error) {
    if (!isNetworkFailure(error)) throw error;
    const item: OfflineQueueItem = { id: randomId(), entity, data: body, idempotencyKey, createdAt: new Date().toISOString(), attempts: 0 };
    writeOfflineQueue([...readOfflineQueue(), item]);
    throw new OfflineQueuedError(item.id);
  }
}

export async function replayOfflineQueue(options: { force?: boolean } = {}) {
  const current = readOfflineQueue();
  const now = Date.now();
  const pending = current.filter((item) => !item.deadLetter && (options.force || !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now));
  if (!pending.length) return { accepted: 0, applied: 0, failed: 0, remaining: current.length };
  const res = await fetch(BASE + '/sync/push', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs: pending.map((item) => ({ entity: item.entity, data: item.data, idempotencyKey: item.idempotencyKey })) }) });
  if (res.status === 401) { notifyUnauthorized(); throw new Error('Authentication is required before offline commands can be replayed.'); }
  if (!res.ok) throw new Error(`Offline replay could not reach the local server (${res.status}).`);
  const response = await res.json() as { accepted: number; applied: number; results: Array<{ index: number; ok: boolean; error?: string }> };
  const successful = new Set((response.results || []).filter((result) => result.ok).map((result) => result.index));
  const failedByIndex = new Map((response.results || []).filter((result) => !result.ok).map((result) => [result.index, result.error || 'Command rejected by the local server']));
  const next = current.filter((item) => {
    const index = pending.findIndex((candidate) => candidate.id === item.id);
    if (index < 0) return true;
    if (successful.has(index)) return false;
    const attempts = item.attempts + 1;
    const delayMs = Math.min(15 * 60_000, 5_000 * (2 ** Math.max(0, attempts - 1)));
    return Object.assign(item, { attempts, nextAttemptAt: new Date(Date.now() + delayMs).toISOString(), lastError: failedByIndex.get(index) || 'Replay failed', deadLetter: attempts >= 5 });
  });
  writeOfflineQueue(next);
  return { accepted: response.accepted, applied: response.applied, failed: pending.length - successful.size, remaining: next.length };
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { credentials: "same-origin" });
  if (res.status === 401) notifyUnauthorizedUnlessCloud(await res.clone().json().catch(() => undefined));
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

export async function apiPost<T = any>(path: string, body?: any, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Idempotency-Key": options.idempotencyKey || idempotencyKey() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; code?: string; details?: Record<string, unknown> };
    if (res.status === 401) notifyUnauthorizedUnlessCloud(err);
    throw new ApiError(err.error || `POST ${path} -> ${res.status}`, err.code, err.details);
  }
  return res.json();
}

export async function apiPatch<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(BASE + path, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; code?: string; details?: Record<string, unknown> };
    if (res.status === 401) notifyUnauthorizedUnlessCloud(err);
    throw new ApiError(err.error || `PATCH ${path} -> ${res.status}`, err.code, err.details);
  }
  return res.json();
}

export async function apiPut<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(BASE + path, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; code?: string; details?: Record<string, unknown> };
    if (res.status === 401) notifyUnauthorizedUnlessCloud(err);
    throw new ApiError(err.error || `PUT ${path} -> ${res.status}`, err.code, err.details);
  }
  return res.json();
}

// Convenience for entity CRUD
export const listEntity = <T = any>(entity: string) => apiGet<T[]>(`/${entity}`);
export const createEntity = <T = any>(entity: string, data: any) => apiPost<T>(`/${entity}`, { data });
