import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { store, type PlatformAdminSessionRecord } from '../../kernel/store.js';
import { callCloud } from './cloud-client.js';
import type { FetchLike } from './cloud-client.js';

/**
 * Connects Epic Desktop to a real LNDRY platform-admin account
 * (`POST /admin/auth/login`, email+password) — a THIRD, independent
 * identity alongside the local operator login and the vendor phone+OTP
 * marketplace connector (cloud-session.ts). This endpoint lives on the
 * exact same backend base URL as the vendor connector
 * (`EPIC_MARKETPLACE_CLOUD_API_URL` already includes `/api/v1`) — it's
 * just a different auth surface on the same server, confirmed live, so no
 * new config is needed.
 *
 * Unlike the vendor connector, the real login response carries no refresh
 * token (confirmed live: only `accessToken`, 24h expiry) — the browser
 * Dashboard relies on httpOnly cookies for silent renewal, which doesn't
 * apply to this headless client. Accepted for v1: platform-admin usage is
 * expected to be occasional/interactive, unlike the always-on vendor
 * session, so a 24h token that requires re-login on expiry is a fine
 * tradeoff rather than building a parallel renewal mechanism for it.
 */

export type PlatformAdminConnectionStatus = {
  configured: boolean;
  connected: boolean;
  email?: string;
  fullName?: string;
  isSuperAdmin?: boolean;
  permissions?: string[];
  connectedAt?: string;
};

/** The real `/vendors/admin/:id/review` request contract. These are kept
 * camel-cased because that is the backend's actual Fastify schema, not a
 * Desktop-only translation. Document review values are supported by the
 * proxy even though the UI deliberately defers document-level decisions
 * until it has a safe document-preview transport. */
export type PlatformVendorReviewInput = {
  status: 'APPROVED' | 'REJECTED' | 'CORRECTION_REQUIRED' | 'SUSPENDED';
  approvedRadius?: number;
  approvedDailyCapacity?: number;
  rejectionReason?: string;
  correctionSections?: Array<'business' | 'owner_bank' | 'location' | 'radius' | 'documents'>;
  documentReviews?: Array<{ documentId: string; status: 'APPROVED' | 'REJECTED'; rejectionReason?: string }>;
};

export type PlatformVendorListFilters = {
  status?: string;
  search?: string;
  city?: string;
  page?: number;
  limit?: number;
};

/** Read-only filters supported by the real platform admin order directory.
 * This deliberately mirrors the cloud API rather than inventing a second
 * order-search grammar on the Desktop edge. */
export type PlatformOrderListFilters = {
  status?: string;
  paymentMethod?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
};

/** Filters intentionally mirror the real append-only HQ audit-log reader.
 * There is no local event copy: Desktop observes the cloud evidence trail
 * rather than making a competing audit authority. */
export type PlatformAuditListFilters = {
  actor_user_id?: string;
  actor_shop_id?: string;
  target_type?: string;
  target_id?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

/** Read-only platform-finance filters. These deliberately match the real
 * HQ finance endpoints; no Desktop-specific payout state or calculation is
 * introduced at the edge. */
export type PlatformFinanceVendorListFilters = {
  page?: number;
  limit?: number;
  search?: string;
  has_pending_payout?: boolean;
};

export type PlatformFinanceFinancialFilters = {
  period_type?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  from?: string;
  to?: string;
  payout_status?: 'PENDING' | 'PROCESSING' | 'PAID' | 'HELD';
  page?: number;
  limit?: number;
};

export type PlatformFinanceTransactionFilters = {
  type?: string;
  direction?: 'CREDIT' | 'DEBIT';
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

/** Website enquiries are platform staging records, never vendor applications.
 * This filter maps directly to the real admin queue without creating a
 * Desktop-local prospect authority. */
export type PlatformPartnerLeadFilters = {
  state?: 'RECEIVED' | 'CLAIMED' | 'ARCHIVED';
  page?: number;
  limit?: number;
};

function cloudApiBaseUrl(): string | undefined {
  const value = String(process.env.EPIC_MARKETPLACE_CLOUD_API_URL || '').trim();
  return value || undefined;
}

export function isPlatformConfigured(): boolean {
  return Boolean(cloudApiBaseUrl());
}

function requireConfigured(): string {
  const baseUrl = cloudApiBaseUrl();
  if (!baseUrl) throw new Error('CLOUD_NOT_CONFIGURED');
  return baseUrl;
}

// ─── At-rest token protection ──────────────────────────────────────────────
// Same AES-256-GCM machine-key-file primitive as cloud-session.ts (the key
// file itself is shared and tenant-independent, so reusing it here is
// deliberate, not accidental). Kept as a parallel encrypt/decrypt
// implementation rather than importing cloud-session.ts's private
// encryptTokens/decryptTokens because those are typed to CloudTokens, which
// requires a refreshToken this identity never has.
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

type PlatformToken = { accessToken: string; accessTokenExpiresAt: string };

function encryptToken(token: PlatformToken): string {
  const key = machineKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(token), 'utf8')), cipher.final()]);
  return JSON.stringify({ iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') });
}

function decryptToken(encryptedJson: string): PlatformToken {
  const envelope = JSON.parse(encryptedJson) as { iv: string; tag: string; ciphertext: string };
  const key = machineKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as PlatformToken;
}

function defaultFetch(): FetchLike {
  return (globalThis as { fetch: FetchLike }).fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`PLATFORM_LOGIN_MISSING_FIELD:${field}`);
  return value;
}

/**
 * POST /admin/auth/login, then persists the token (encrypted at rest) plus
 * a redacted status record. Confirmed live this session: a real
 * ADMIN/platform_role login returns `{ accessToken, user, vendors,
 * isSuperAdmin, requiresShopSelection }` under `data` — login itself does
 * NOT return the real `permissions` array (only `/admin/auth/me` does), so
 * this fetches `/me` once immediately after login to capture them before
 * persisting, mirroring cloud-session.ts's "resolve full identity before
 * persisting" pattern.
 *
 * A 2FA-enabled admin account gets `requires2FA: true` back from login
 * instead of a usable token — out of scope for this slice (no seeded test
 * admin has TOTP enabled); surfaced as a distinct, catchable error rather
 * than silently failing as a generic login failure.
 */
export async function connectPlatformSession(
  tenant: string,
  actor: string,
  input: { email: string; password: string },
  fetchImpl: FetchLike = defaultFetch(),
): Promise<PlatformAdminConnectionStatus> {
  const baseUrl = requireConfigured();
  const email = String(input.email || '').trim();
  const password = String(input.password || '');
  if (!email || !password) throw new Error('PLATFORM_CONNECT_INPUT_REQUIRED');

  const loginBody = await callCloud(fetchImpl, baseUrl, '/admin/auth/login', { method: 'POST', body: { email, password } });
  const loginData = isRecord(loginBody.data) ? loginBody.data : loginBody;
  if (loginData.requires2FA) throw new Error('PLATFORM_2FA_REQUIRED');
  const accessToken = requireString(loginData.accessToken, 'accessToken');
  const user: Record<string, unknown> = isRecord(loginData.user) ? loginData.user : {};

  const meBody = await callCloud(fetchImpl, baseUrl, '/admin/auth/me', { accessToken });
  const meData = isRecord(meBody.data) ? meBody.data : meBody;
  const permissions = Array.isArray(meData.permissions) ? meData.permissions.filter((p): p is string => typeof p === 'string') : [];

  const now = new Date().toISOString();
  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const record: PlatformAdminSessionRecord = {
    tenant,
    storeId: '',
    status: 'Connected',
    email: typeof user.email === 'string' ? user.email : email,
    fullName: typeof user.full_name === 'string' ? user.full_name : '',
    isSuperAdmin: Boolean(loginData.isSuperAdmin),
    permissions,
    encryptedTokenJson: encryptToken({ accessToken, accessTokenExpiresAt: tokenExpiresAt }),
    tokenExpiresAt,
    connectedAt: now,
    connectedBy: actor,
    updatedAt: now,
  };
  store.savePlatformAdminSession(record);
  return getPlatformSessionStatus(tenant);
}

export function getPlatformSessionStatus(tenant: string): PlatformAdminConnectionStatus {
  const configured = isPlatformConfigured();
  const session = store.getPlatformAdminSession(tenant);
  if (!session || session.status !== 'Connected') return { configured, connected: false };
  return {
    configured,
    connected: true,
    email: session.email || undefined,
    fullName: session.fullName || undefined,
    isSuperAdmin: session.isSuperAdmin,
    permissions: session.permissions,
    connectedAt: session.connectedAt,
  };
}

/**
 * No remote logout call: `/admin/auth/logout` only clears httpOnly cookies
 * this headless bearer-token client never held (confirmed by reading the
 * controller — it does not bump `session_version` or otherwise invalidate
 * the JWT; only `change-password` does that), so there is nothing real for
 * it to revoke server-side. Disconnect is purely local, same end state as
 * the token simply expiring.
 */
export function disconnectPlatformSession(tenant: string): PlatformAdminConnectionStatus {
  store.deletePlatformAdminSession(tenant);
  return getPlatformSessionStatus(tenant);
}

function connectedPlatformCall(tenant: string) {
  const baseUrl = requireConfigured();
  const session = store.getPlatformAdminSession(tenant);
  if (!session || session.status !== 'Connected') throw new Error('PLATFORM_NOT_CONNECTED');
  const token = decryptToken(session.encryptedTokenJson);
  return { baseUrl, accessToken: token.accessToken };
}

/**
 * Calls any already-mounted, ADMIN-gated backend GET endpoint using the
 * connected platform-admin session's stored token. No refresh-and-retry
 * (see module header) — a 401 here means the session has expired and the
 * caller must reconnect; it surfaces as `CloudClientError` with code
 * `CLOUD_AUTH_FAILED`, the same shape every other cloud call already uses.
 */
export async function callConnectedPlatformApi(tenant: string, path: string, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  const { baseUrl, accessToken } = connectedPlatformCall(tenant);
  const body = await callCloud(fetchImpl, baseUrl, path, { accessToken });
  return body.data ?? body;
}

/**
 * Mutating counterpart of callConnectedPlatformApi — same no-retry behavior.
 * Takes an explicit HTTP method because the real admin-side endpoints this
 * proxies to are inconsistent about it (e.g. `PUT /vendors/admin/:id/capacity`
 * vs a hypothetical PATCH elsewhere) — confirmed by reading vendors.routes.js
 * rather than assumed to all be one verb.
 */
export async function writeConnectedPlatformApi(tenant: string, method: 'POST' | 'PATCH' | 'PUT', path: string, requestBody: unknown, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  const { baseUrl, accessToken } = connectedPlatformCall(tenant);
  const body = await callCloud(fetchImpl, baseUrl, path, { method, body: requestBody, accessToken });
  return body.data ?? body;
}

function vendorListPath(filters: PlatformVendorListFilters = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return `/vendors/admin/list${suffix ? `?${suffix}` : ''}`;
}

/** Read the real combined vendor/application review queue. The backend owns
 * filtering and merges non-approved applications with active vendors. */
export async function listConnectedPlatformVendors(tenant: string, filters: PlatformVendorListFilters = {}, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  return callConnectedPlatformApi(tenant, vendorListPath(filters), fetchImpl);
}

/**
 * Desktop needs proof that a vendor supplied review-critical details, not a
 * second copy of account, PAN, GSTIN, or private document URLs. Keep those
 * fields in the platform service; send only minimal verification signals
 * across the cloud/edge boundary. This is deliberately applied to both
 * reads and review responses because the backend returns full rows after a
 * successful review.
 */
function sanitizePlatformVendorRecord(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const record = { ...value } as Record<string, unknown>;
  const bankDetailsRecorded = Boolean(record.bank_account_number && record.bank_ifsc);
  const taxIdentifiersRecorded = {
    gst: Boolean(record.gst_number),
    pan: Boolean(record.pan_number),
  };
  delete record.bank_account_number;
  delete record.bank_ifsc;
  delete record.bank_name;
  delete record.bank_holder_name;
  delete record.gst_number;
  delete record.pan_number;
  if (Array.isArray(record.documents)) {
    record.documents = record.documents.map((document) => {
      if (!isRecord(document)) return document;
      const safeDocument = { ...document } as Record<string, unknown>;
      delete safeDocument.file_url;
      return safeDocument;
    });
  }
  return { ...record, bank_details_recorded: bankDetailsRecorded, tax_identifiers_recorded: taxIdentifiersRecorded };
}

/**
 * Partner-lead contact details and the applicant's free-form message belong
 * in the canonical platform workflow. Platform Control's compact intake card
 * needs only enough context to triage and claim work, so do not copy contact
 * data into the store's local Desktop process just to render that queue.
 */
function sanitizePlatformPartnerLead(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const record = { ...value } as Record<string, unknown>;
  delete record.email;
  delete record.phone;
  delete record.address;
  delete record.message;
  return record;
}

function sanitizePlatformPartnerLeadPage(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const page = { ...value } as Record<string, unknown>;
  if (Array.isArray(page.leads)) page.leads = page.leads.map(sanitizePlatformPartnerLead);
  return page;
}

/** Full application/vendor record including minimal document metadata. */
export async function getConnectedPlatformVendor(tenant: string, vendorId: string, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  return sanitizePlatformVendorRecord(await callConnectedPlatformApi(tenant, `/vendors/admin/${encodeURIComponent(vendorId)}`, fetchImpl));
}

/** Review is intentionally cloud-authoritative: Desktop does not cache or
 * locally invent a status transition. A caller must invalidate its review
 * queue only after this real ADMIN-gated backend write succeeds. */
export async function reviewConnectedPlatformVendor(tenant: string, vendorId: string, input: PlatformVendorReviewInput, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  return sanitizePlatformVendorRecord(await writeConnectedPlatformApi(tenant, 'POST', `/vendors/admin/${encodeURIComponent(vendorId)}/review`, input, fetchImpl));
}

/** Canonical website-partner staging queue. It remains separate from vendor
 * onboarding because a marketing lead has not yet supplied verified identity
 * or KYC evidence. */
export async function listConnectedPlatformPartnerLeads(tenant: string, filters: PlatformPartnerLeadFilters = {}, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  return sanitizePlatformPartnerLeadPage(await callConnectedPlatformApi(tenant, platformFinancePath('/admin/partner-leads', filters), fetchImpl));
}

/** Claiming assigns cloud-owned follow-up responsibility only; it cannot
 * create a vendor, a user, or an onboarding application. */
export async function claimConnectedPlatformPartnerLead(tenant: string, leadId: string, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  return writeConnectedPlatformApi(tenant, 'POST', `/admin/partner-leads/${encodeURIComponent(leadId)}/claim`, {}, fetchImpl);
}

function platformOrderListPath(filters: PlatformOrderListFilters = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return `/admin/orders${suffix ? `?${suffix}` : ''}`;
}

/**
 * Cloud-owned, read-only marketplace order oversight. The platform's
 * vendor/rider lifecycle is richer than its legacy admin write routes, so
 * this monitor intentionally cannot alter status, rider, payment, or OTP
 * state. It is safe to expose while lifecycle convergence is completed.
 */
export async function listConnectedPlatformOrders(tenant: string, filters: PlatformOrderListFilters = {}, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  return callConnectedPlatformApi(tenant, platformOrderListPath(filters), fetchImpl);
}

/** Full cloud order record, including the backend-provided timeline/payment
 * and delivery sections. Kept read-only for the same lifecycle-safety rule. */
export async function getConnectedPlatformOrder(tenant: string, orderId: string, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  return callConnectedPlatformApi(tenant, `/admin/orders/${encodeURIComponent(orderId)}`, fetchImpl);
}

function platformAuditListPath(filters: PlatformAuditListFilters = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return `/admin/audit-logs${suffix ? `?${suffix}` : ''}`;
}

/** Cloud-owned, append-only evidence trail. No audit write, delete, or
 * local cache is exposed here; the platform remains the sole authority. */
export async function listConnectedPlatformAuditLogs(tenant: string, filters: PlatformAuditListFilters = {}, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  return callConnectedPlatformApi(tenant, platformAuditListPath(filters), fetchImpl);
}

function platformFinancePath(path: string, filters: Record<string, unknown> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return `${path}${suffix ? `?${suffix}` : ''}`;
}

/** Platform finance is an evidence/oversight surface only. The provider
 * gate remains authoritative: Desktop deliberately exposes no payout
 * release, bank-detail, or manual-paid control. */
export async function listConnectedPlatformFinanceVendors(tenant: string, filters: PlatformFinanceVendorListFilters = {}, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  return callConnectedPlatformApi(tenant, platformFinancePath('/admin/finance/vendors', filters), fetchImpl);
}

export async function listConnectedPlatformVendorFinancials(tenant: string, vendorId: string, filters: PlatformFinanceFinancialFilters = {}, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  return callConnectedPlatformApi(tenant, platformFinancePath(`/admin/finance/vendors/${encodeURIComponent(vendorId)}/financials`, filters), fetchImpl);
}

export async function listConnectedPlatformVendorTransactions(tenant: string, vendorId: string, filters: PlatformFinanceTransactionFilters = {}, fetchImpl: FetchLike = defaultFetch()): Promise<unknown> {
  return callConnectedPlatformApi(tenant, platformFinancePath(`/admin/finance/vendors/${encodeURIComponent(vendorId)}/transactions`, filters), fetchImpl);
}
