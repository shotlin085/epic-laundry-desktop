import { getCloudConnectionStatus, callConnectedCloudApi } from './cloud-session.js';
import type { FetchLike } from './cloud-client.js';
import { createLaundryRider } from '../laundry/domain.js';

/**
 * Real captain (rider) roster sync — `GET /vendor/employees?role=VENDOR_RIDER`
 * on the real backend, confirmed live to return `{staff: [...], total, page,
 * limit}` (unlike the vendor-services endpoints, this controller wraps the
 * whole service-layer result as `data` rather than unwrapping the array —
 * verified by reading `vendor-employees.service.js#list`/`.controller.js`
 * directly, not assumed). Each row has `user_name`/`user_phone` joined from
 * `users` — a real name/phone, not a placeholder.
 *
 * Deliberately identity-only. There is no real backend concept of per-rider
 * settlement/payout data (only vendor-level shop-financial settlement
 * exists) — `listLaundryRiderSettlements`/`saveLaundryRiderSettlement` stay
 * exactly as they are today: 100% local, manual "New handover" entry.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireLinkedVendor(tenant: string) {
  const status = getCloudConnectionStatus(tenant);
  if (!status.connected) throw new Error('CLOUD_NOT_CONNECTED');
  if (!status.remoteVendorId) throw new Error('CLOUD_VENDOR_NOT_LINKED');
}

export type CloudCaptain = { userId: string; name: string; phone: string };

function toCaptain(raw: unknown): CloudCaptain | undefined {
  if (!isRecord(raw)) return undefined;
  const userId = String(raw.user_id || '');
  const name = String(raw.user_name || '').trim();
  if (!userId || !name) return undefined;
  return { userId, name, phone: String(raw.user_phone || '').trim() };
}

/** `GET /vendor/employees?role=VENDOR_RIDER&is_active=true` — this vendor's real, currently-active riders. */
export async function fetchCloudCaptains(tenant: string, fetchImpl?: FetchLike): Promise<CloudCaptain[]> {
  requireLinkedVendor(tenant);
  const raw = await callConnectedCloudApi(tenant, '/vendor/employees?role=VENDOR_RIDER&is_active=true&limit=100', fetchImpl);
  const staff = isRecord(raw) && Array.isArray(raw.staff) ? raw.staff : [];
  const mapped: CloudCaptain[] = [];
  for (const row of staff) {
    const parsed = toCaptain(row);
    if (parsed) mapped.push(parsed);
  }
  return mapped;
}

export type CaptainSyncSummary = { seen: number; created: number; alreadyPresent: number };

/**
 * Reuses `createLaundryRider()` exactly as-is (it already dedupes by name-or-phone,
 * per `domain.ts` — confirmed no changes needed there). A duplicate throw is
 * treated as "already synced," not a failure — this sync is meant to be safely
 * re-run any time, e.g. after the vendor hires a new real delivery captain.
 */
export async function syncLocalCaptainsFromCloud(tenant: string, actor: string, fetchImpl?: FetchLike): Promise<CaptainSyncSummary> {
  const captains = await fetchCloudCaptains(tenant, fetchImpl);
  let created = 0;
  let alreadyPresent = 0;
  for (const captain of captains) {
    if (!captain.name) continue;
    try {
      createLaundryRider(tenant, actor, { name: captain.name, phone: captain.phone });
      created += 1;
    } catch {
      // "a rider with this name or phone already exists" — expected on a
      // repeat sync, not a real error condition.
      alreadyPresent += 1;
    }
  }
  return { seen: captains.length, created, alreadyPresent };
}
