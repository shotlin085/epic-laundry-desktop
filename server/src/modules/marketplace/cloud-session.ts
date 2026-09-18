import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { store, type MarketplaceCloudSessionRecord } from '../../kernel/store.js';
import * as cloudClient from './cloud-client.js';
import type { FetchLike, CloudTokens } from './cloud-client.js';

/**
 * Connects Epic Desktop to a real LNDRY Cloud Backend vendor account.
 *
 * This is deliberately NOT wired into the edge-sync outbox/inbox machinery —
 * see cloud-client.ts's header comment for why. It is a standalone "connect
 * this store to its real marketplace account" capability: the connector
 * foundation the rest of the marketplace convergence work builds on, not the
 * full durable-sync layer itself.
 *
 * Cloud identity is kept separate from local operator identity (mandate's
 * cross-system identity principle): a store's local operators authenticate
 * locally regardless of whether the store has a connected cloud session, and
 * a connected cloud session's tokens are never exposed to the renderer — only
 * a redacted status summary is.
 */

export type CloudConnectionStatus = {
  configured: boolean;
  connected: boolean;
  remoteVendorName?: string;
  /** Present only once a vendor is actually linked — see connectCloudSession's comment on why this is not always set. */
  remoteVendorId?: string;
  remoteUserRole?: string;
  phone?: string;
  connectedAt?: string;
};

function cloudApiBaseUrl(): string | undefined {
  const value = String(process.env.EPIC_MARKETPLACE_CLOUD_API_URL || '').trim();
  return value || undefined;
}

export function isCloudConfigured(): boolean {
  return Boolean(cloudApiBaseUrl());
}

function requireConfigured(): string {
  const baseUrl = cloudApiBaseUrl();
  if (!baseUrl) throw new Error('CLOUD_NOT_CONFIGURED');
  return baseUrl;
}

// ─── At-rest token protection ──────────────────────────────────────────────
// Desktop's server process cannot call Electron's `safeStorage` (that API only
// exists in the Electron main process, which runs this server as a separate
// child process — see desktop/main.js's own use of safeStorage for the backup
// passphrase). Until that IPC bridge is built, tokens are encrypted at rest
// with a locally-generated machine key file (AES-256-GCM, same primitive as
// backup-crypto.ts), which is materially better than plaintext in SQLite but
// is a deliberately-flagged interim step: migrating this to Electron
// safeStorage via IPC is the natural hardening follow-up once the renderer
// round-trip exists to request it.
function machineKeyFile(): string {
  const dbFile = process.env.EPIC_DB_FILE || join(homedir(), '.epic-laundry', 'epic.sqlite');
  return join(dirname(dbFile), 'cloud-connector.key');
}

function machineKey(): Buffer {
  const file = machineKeyFile();
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  const key = randomBytes(32);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}

function encryptTokens(tokens: CloudTokens): string {
  const key = machineKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(tokens), 'utf8')), cipher.final()]);
  return JSON.stringify({ iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') });
}

function decryptTokens(encryptedJson: string): CloudTokens {
  const envelope = JSON.parse(encryptedJson) as { iv: string; tag: string; ciphertext: string };
  const key = machineKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as CloudTokens;
}

function defaultFetch(): FetchLike {
  return (globalThis as { fetch: FetchLike }).fetch;
}

export async function requestCloudOtp(phone: string, fetchImpl: FetchLike = defaultFetch()): Promise<{ sent: true; otp?: string }> {
  const baseUrl = requireConfigured();
  const { otp } = await cloudClient.sendOtp(fetchImpl, baseUrl, phone);
  return { sent: true, otp };
}

/**
 * A read-only pre-check for the primary desktop login gate (`cloud-auth.ts`)
 * — verifies the OTP and returns just the account's role facts, without
 * persisting a connection. The caller decides whether to proceed to a real
 * persisting connect after checking the role.
 *
 * CORRECTION (live-tested 2026-09-17 against real production): the
 * `auth.service.js`-reading claim this comment used to make — that the real
 * backend never invalidates an OTP challenge after one successful verify —
 * is wrong in practice. A second `verify-otp` call with the same
 * still-"unexpired" code reliably 400s with `INVALID_OTP` once the first
 * call has already succeeded (reproduced via bare curl: verify → verify
 * again with the identical body → the second call fails). Whatever the
 * backend does internally (mark-used flag, single-attempt token, etc.),
 * empirically the challenge is single-use. So the login gate must NOT call
 * `connectCloudSession` with the same `{phone, otp}` after this — that would
 * be a second verify and would always fail. Use `persistCloudSession` with
 * the tokens this call already returned instead (see `authenticateWithCloud`
 * in `cloud-auth.ts`).
 */
export async function verifyCloudOtpForLogin(phone: string, otp: string, fetchImpl: FetchLike = defaultFetch()) {
  const baseUrl = requireConfigured();
  return cloudClient.verifyOtp(fetchImpl, baseUrl, phone, otp);
}

/** Every role linked to this phone (`["CUSTOMER", "VENDOR_OWNER"]`, etc.) —
 * see `cloud-client.ts#getMyRoles`'s header for why this, not verify-otp's
 * own response, is the reliable source for the login gate's role check. */
export async function getMyRolesForLogin(accessToken: string, fetchImpl: FetchLike = defaultFetch()): Promise<string[]> {
  const baseUrl = requireConfigured();
  return cloudClient.getMyRoles(fetchImpl, baseUrl, accessToken);
}

/**
 * Verifies the OTP, fetches the account's own session profile, resolves the
 * REAL linked vendor identity (a separate fact from the connecting user's own
 * id — see cloud-client.ts's getVendorProfile), and persists the token pair
 * (encrypted at rest) plus a redacted connection record.
 *
 * A connecting account with no linked vendor (e.g. CUSTOMER role, or a
 * platform admin) still connects successfully — `remoteVendorId` simply stays
 * empty. Fabricating a vendor identity from the user id would be exactly the
 * "display-name / wrong-identity matching" mandate's cross-system identity
 * principle prohibits, so this is a real branch, not an edge case glossed
 * over.
 *
 * Deliberately does not yet call `select-shop`/`select-role` — multi-shop
 * account selection is a real, separate backend capability this connector
 * does not exercise yet. An account linked to more than one shop connects
 * using whatever default scope `verify-otp` grants; narrowing that is a
 * documented next step, not something silently papered over here.
 */
/**
 * Persists a connection from an ALREADY-VERIFIED token pair — no OTP, no
 * verify-otp call. Split out from `connectCloudSession` so a caller that has
 * just verified an OTP itself (e.g. the login gate in `cloud-auth.ts`) can
 * reuse those tokens directly instead of verifying the same one-time code a
 * second time, which the real backend rejects (see `verifyCloudOtpForLogin`'s
 * header comment).
 */
export async function persistCloudSession(
  tenant: string,
  actor: string,
  initialTokens: CloudTokens,
  phone: string,
  fetchImpl: FetchLike = defaultFetch(),
): Promise<CloudConnectionStatus> {
  const baseUrl = requireConfigured();

  // verify-otp's own access token carries only { id, phone, role: 'CUSTOMER' }
  // — no shopId/shopRole claim. The real backend only embeds those on
  // /auth/refresh-token's response (confirmed live). Every shopRole-gated
  // route (shop-garment_rates, shop-financials, shop-transactions, …) reads
  // shopRole directly off the JWT with no DB fallback, so a freshly
  // connected session using the raw verify-otp token 403s on all of them
  // until its first natural 401-triggered refresh happens to occur — which,
  // for a read-only route a vendor opens right after connecting, may be
  // never. Refreshing once here immediately, before the token is ever
  // stored, means the persisted token always carries shopRole from the
  // start rather than depending on an unrelated future request to backfill
  // it by accident.
  const tokens = await cloudClient.refreshAccessToken(fetchImpl, baseUrl, initialTokens.refreshToken);
  const profile = await cloudClient.getSession(fetchImpl, baseUrl, tokens.accessToken);
  const vendor = await cloudClient.getVendorProfile(fetchImpl, baseUrl, tokens.accessToken);

  const now = new Date().toISOString();
  const record: MarketplaceCloudSessionRecord = {
    tenant,
    storeId: '',
    status: 'Connected',
    remoteVendorId: vendor?.vendorId || '',
    remoteVendorName: vendor?.vendorName || '',
    remoteUserId: profile.userId,
    remoteUserRole: profile.role,
    phone: profile.phone || phone,
    encryptedTokensJson: encryptTokens(tokens),
    tokenExpiresAt: tokens.accessTokenExpiresAt,
    connectedAt: now,
    connectedBy: actor,
    updatedAt: now,
  };
  store.saveMarketplaceCloudSession(record);
  // A different account (or a fresh credential for the same account) must
  // never inherit a previous connection's success/failure indicator.
  store.deleteMarketplaceCloudSyncHealth(tenant);
  return getCloudConnectionStatus(tenant);
}

/** Verifies the OTP itself, then persists via `persistCloudSession`. Used by
 * the Settings-page reconnect flow, which (unlike the login gate) has not
 * already verified this OTP itself. */
export async function connectCloudSession(
  tenant: string,
  actor: string,
  input: { phone: string; otp: string },
  fetchImpl: FetchLike = defaultFetch(),
): Promise<CloudConnectionStatus> {
  const baseUrl = requireConfigured();
  const phone = String(input.phone || '').trim();
  const otp = String(input.otp || '').trim();
  if (!phone || !otp) throw new Error('CLOUD_CONNECT_INPUT_REQUIRED');

  const initialTokens = await cloudClient.verifyOtp(fetchImpl, baseUrl, phone, otp);
  return persistCloudSession(tenant, actor, initialTokens, phone, fetchImpl);
}

export function getCloudConnectionStatus(tenant: string): CloudConnectionStatus {
  const configured = isCloudConfigured();
  const session = store.getMarketplaceCloudSession(tenant);
  if (!session || session.status !== 'Connected') return { configured, connected: false };
  return {
    configured,
    connected: true,
    remoteVendorName: session.remoteVendorName || undefined,
    remoteVendorId: session.remoteVendorId || undefined,
    remoteUserRole: session.remoteUserRole || undefined,
    phone: session.phone,
    connectedAt: session.connectedAt,
  };
}

export async function disconnectCloudSession(tenant: string, fetchImpl: FetchLike = defaultFetch()): Promise<CloudConnectionStatus> {
  const session = store.getMarketplaceCloudSession(tenant);
  const baseUrl = cloudApiBaseUrl();
  if (session && session.status === 'Connected' && baseUrl) {
    try {
      const tokens = decryptTokens(session.encryptedTokensJson);
      await cloudClient.logout(fetchImpl, baseUrl, tokens.accessToken);
    } catch {
      // Best-effort: a failed remote logout must not block the local disconnect —
      // the whole point of disconnect is that this installation no longer wants
      // to hold the credential, regardless of whether the cloud side acknowledges it.
    }
  }
  store.deleteMarketplaceCloudSession(tenant);
  store.deleteMarketplaceCloudSyncHealth(tenant);
  return getCloudConnectionStatus(tenant);
}

/**
 * Calls any already-mounted, already-authenticated backend GET endpoint using
 * the connected session's stored tokens, transparently refreshing and
 * persisting a rotated access token if the current one has expired.
 *
 * This is the one shared plumbing point every "pull real X from the cloud"
 * feature should go through (vendor profile, orders, …) rather than each
 * reimplementing token decrypt/refresh/persist — exported so other modules
 * (e.g. cloud-order-sync.ts) can build on it without duplicating it.
 */
export async function callConnectedCloudApi(tenant: string, path: string, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  const { baseUrl, tokens, onRefreshed } = connectedCloudCall(tenant);
  return cloudClient.authenticatedGet(fetchImpl, baseUrl, path, tokens, onRefreshed);
}

/** Use only where the cloud endpoint's metadata is part of the contract, for
 * example offset/cursor pagination. Ordinary connected readers should keep
 * using callConnectedCloudApi so they do not couple to envelope shape. */
export async function callConnectedCloudApiEnvelope(tenant: string, path: string, fetchImpl: FetchLike = defaultFetch()): Promise<Record<string, unknown>> {
  const { baseUrl, tokens, onRefreshed } = connectedCloudCall(tenant);
  return cloudClient.authenticatedGetEnvelope(fetchImpl, baseUrl, path, tokens, onRefreshed);
}

/** POST counterpart of `callConnectedCloudApi` — see authenticatedPost's note on why retrying these is safe. */
export async function postConnectedCloudApi(tenant: string, path: string, body: unknown, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  const { baseUrl, tokens, onRefreshed } = connectedCloudCall(tenant);
  return cloudClient.authenticatedPost(fetchImpl, baseUrl, path, tokens, body, onRefreshed);
}

/** PATCH counterpart of `callConnectedCloudApi` — see authenticatedPatch's note on why retrying these is safe. */
export async function patchConnectedCloudApi(tenant: string, path: string, body: unknown, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  const { baseUrl, tokens, onRefreshed } = connectedCloudCall(tenant);
  return cloudClient.authenticatedPatch(fetchImpl, baseUrl, path, tokens, body, onRefreshed);
}

function connectedCloudCall(tenant: string) {
  const baseUrl = requireConfigured();
  const session = store.getMarketplaceCloudSession(tenant);
  if (!session || session.status !== 'Connected') throw new Error('CLOUD_NOT_CONNECTED');
  const tokens = decryptTokens(session.encryptedTokensJson);
  const onRefreshed = (refreshed: CloudTokens) => {
    store.saveMarketplaceCloudSession({ ...session, encryptedTokensJson: encryptTokens(refreshed), tokenExpiresAt: refreshed.accessTokenExpiresAt, updatedAt: new Date().toISOString() });
  };
  return { baseUrl, tokens, onRefreshed };
}

/**
 * Fetches one real piece of connected-vendor data from the real backend. This
 * is the actual proof that the connector works end to end, not just that
 * auth succeeds — exported for the settings UI and for tests, not just as an
 * internal helper.
 */
export async function fetchConnectedVendorProfile(tenant: string, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  return callConnectedCloudApi(tenant, '/vendor/profile', fetchImpl);
}
