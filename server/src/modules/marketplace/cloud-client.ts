/**
 * LndryCloudClient — the first real network transport to the LNDRY Cloud
 * Backend. Desktop's existing `SyncTransport` abstraction (edge-sync.ts)
 * assumes a bespoke envelope/outbox-inbox protocol that the real backend does
 * not implement (confirmed by reading Lndry_backend: its only device concept
 * is an FCM push-token registry, not a marketplace sync control plane). The
 * real backend exposes an ordinary phone+OTP auth flow and REST endpoints —
 * the same ones Dashboard and Vendor App already use — so this client talks
 * that protocol directly rather than inventing a parallel one.
 *
 * Never trusts raw JSON: every response is checked for the expected shape
 * before being handed back to a caller.
 */

export type CloudClientErrorCode =
  | 'CLOUD_NOT_CONFIGURED'
  | 'CLOUD_UNREACHABLE'
  | 'CLOUD_TIMEOUT'
  | 'CLOUD_AUTH_FAILED'
  | 'CLOUD_UNEXPECTED_RESPONSE';

export class CloudClientError extends Error {
  code: CloudClientErrorCode;
  httpStatus?: number;
  /**
   * The backend's OWN error code from the response body (e.g.
   * 'INVALID_TRANSITION', 'ORDER_NOT_FOUND', 'NOT_VENDOR'). Preserved
   * separately from our transport-level `code` because callers that act on
   * remote state machines must branch on the remote's precise reason — string
   * matching an error message is not a contract.
   */
  remoteCode?: string;
  constructor(code: CloudClientErrorCode, message: string, httpStatus?: number, remoteCode?: string) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.remoteCode = remoteCode;
  }
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json: () => Promise<unknown> }>;

export type CloudTokens = { accessToken: string; refreshToken: string; accessTokenExpiresAt: string };

const REQUEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Exported (not just used internally) so a second, independent connected
 * identity — e.g. platform-session.ts's admin login, which has no refresh
 * token and so cannot reuse authenticatedGet/Post/Patch's refresh-and-retry
 * wrapper — can still reuse this shared request/error-shape plumbing
 * instead of duplicating it.
 */
export async function callCloud(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  opts: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: { status: number; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method: opts.method || 'GET',
      headers: {
        'content-type': 'application/json',
        ...(opts.accessToken ? { authorization: `Bearer ${opts.accessToken}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CloudClientError('CLOUD_TIMEOUT', `LNDRY cloud request to ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw new CloudClientError('CLOUD_UNREACHABLE', `LNDRY cloud is unreachable: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CloudClientError('CLOUD_UNEXPECTED_RESPONSE', `LNDRY cloud returned a non-JSON response from ${path}`, response.status);
  }
  if (!isRecord(body)) {
    throw new CloudClientError('CLOUD_UNEXPECTED_RESPONSE', `LNDRY cloud returned an unexpected response shape from ${path}`, response.status);
  }
  const remoteCode = typeof body.code === 'string' ? body.code : undefined;
  if (response.status === 401 || response.status === 403) {
    const message = typeof body.message === 'string' ? body.message : 'Authentication failed';
    throw new CloudClientError('CLOUD_AUTH_FAILED', message, response.status, remoteCode);
  }
  if (response.status < 200 || response.status >= 300 || body.success === false) {
    const message = typeof body.message === 'string' ? body.message : `LNDRY cloud request to ${path} failed with status ${response.status}`;
    throw new CloudClientError('CLOUD_UNEXPECTED_RESPONSE', message, response.status, remoteCode);
  }
  return body;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new CloudClientError('CLOUD_UNEXPECTED_RESPONSE', `LNDRY cloud response is missing required field "${field}"`);
  return value;
}

/** POST /auth/send-otp. The real backend echoes the generated code back as
 * `data.otp` whenever it's not wired to a live SMS provider (dev mode, or the
 * `TEST_BYPASS_OTP_PHONES` bypass, which has no production guard) — surface
 * it so the login screen can show it, same as `Lndry_vendor_app` already does. */
export async function sendOtp(fetchImpl: FetchLike, baseUrl: string, phone: string): Promise<{ otp?: string }> {
  const body = await callCloud(fetchImpl, baseUrl, '/auth/send-otp', { method: 'POST', body: { phone } });
  const data = isRecord(body.data) ? body.data : body;
  return { otp: typeof data.otp === 'string' && data.otp ? data.otp : undefined };
}

/** POST /auth/verify-otp — returns the access/refresh token pair. */
export async function verifyOtp(fetchImpl: FetchLike, baseUrl: string, phone: string, otp: string): Promise<CloudTokens> {
  const body = await callCloud(fetchImpl, baseUrl, '/auth/verify-otp', { method: 'POST', body: { phone, otp } });
  const data = isRecord(body.data) ? body.data : body;
  return {
    accessToken: requireString(data.access_token ?? data.accessToken, 'access_token'),
    refreshToken: requireString(data.refresh_token ?? data.refreshToken, 'refresh_token'),
    accessTokenExpiresAt: typeof data.expires_at === 'string' ? data.expires_at : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

/**
 * POST /auth/refresh-token. The real backend's refreshTokenSchema requires
 * the request body key as camelCase `refreshToken` (confirmed against a live
 * local backend: a `refresh_token` snake_case body 400s with VALIDATION_ERROR
 * because the field is simply absent from the request as the schema sees
 * it) — unlike every other endpoint here, which accepts/returns snake_case.
 * Getting this wrong means every connected session silently breaks the
 * moment the ~15min access token expires, surfacing as a generic
 * "Validation error" on whatever action happened to trigger the refresh.
 */
export async function refreshAccessToken(fetchImpl: FetchLike, baseUrl: string, refreshToken: string): Promise<CloudTokens> {
  const body = await callCloud(fetchImpl, baseUrl, '/auth/refresh-token', { method: 'POST', body: { refreshToken } });
  const data = isRecord(body.data) ? body.data : body;
  return {
    accessToken: requireString(data.access_token ?? data.accessToken, 'access_token'),
    refreshToken: requireString(data.refresh_token ?? data.refreshToken ?? refreshToken, 'refresh_token'),
    accessTokenExpiresAt: typeof data.expires_at === 'string' ? data.expires_at : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

export type CloudSessionProfile = { userId: string; name: string; role: string; phone: string };

/**
 * GET /auth/session. The real backend nests the profile under `data.user`
 * (confirmed against a live local backend — the shape is NOT flat on `data`,
 * which is easy to assume incorrectly since other endpoints here are flatter).
 * Falls back to a flat `data` shape too, defensively, in case that nesting is
 * inconsistent across backend versions — never assume only one shape.
 */
export async function getSession(fetchImpl: FetchLike, baseUrl: string, accessToken: string): Promise<CloudSessionProfile> {
  const body = await callCloud(fetchImpl, baseUrl, '/auth/session', { accessToken });
  const data = isRecord(body.data) ? body.data : body;
  const user = isRecord(data.user) ? data.user : data;
  return {
    userId: requireString(user.id ?? user.user_id, 'user.id'),
    name: typeof user.name === 'string' && user.name ? user.name : '',
    role: typeof user.role === 'string' ? user.role : (typeof user.platform_role === 'string' ? user.platform_role : ''),
    phone: typeof user.phone === 'string' ? user.phone : '',
  };
}

/** POST /auth/logout — best-effort; callers should not fail disconnect if this fails. */
export async function logout(fetchImpl: FetchLike, baseUrl: string, accessToken: string): Promise<void> {
  await callCloud(fetchImpl, baseUrl, '/auth/logout', { method: 'POST', accessToken, body: {} });
}

export type CloudVendorIdentity = { vendorId: string; vendorName: string };

/**
 * GET /vendor/profile. The backend resolves this by looking up the vendor
 * row OWNED BY the connecting user (`vendors.findByUserId`) — its `id` is the
 * true remote vendor identity (a `vendors` table row), which is a DIFFERENT
 * fact from the connecting user's own id returned by `/auth/session`. Never
 * treat those two ids as interchangeable (confirmed by reading
 * `vendors.service.js#getPublicPreview`, which spreads the raw `vendors` row
 * — `id`/`name` here are the vendor's, not the user's).
 *
 * Returns `null` (not an error) when the connecting account has no linked
 * vendor — a real, valid state (e.g. a platform-admin-only connection), not a
 * failure of the connector itself.
 */
export async function getVendorProfile(fetchImpl: FetchLike, baseUrl: string, accessToken: string): Promise<CloudVendorIdentity | null> {
  try {
    const body = await callCloud(fetchImpl, baseUrl, '/vendor/profile', { accessToken });
    const data = isRecord(body.data) ? body.data : body;
    return { vendorId: requireString(data.id, 'id'), vendorName: typeof data.name === 'string' ? data.name : '' };
  } catch (error) {
    if (error instanceof CloudClientError && error.httpStatus === 404) return null;
    throw error;
  }
}

/**
 * GET /auth/my-roles — every role linked to this phone (the account's own
 * `role` plus every active shop-staff assignment's role, e.g.
 * `["CUSTOMER", "VENDOR_OWNER"]`). This is the reliable way to read a
 * shop-staff role for the desktop's primary login gate — confirmed live
 * that `/auth/verify-otp`'s own response only embeds `shop_role`/`vendor_id`
 * when called with a real `challenge_id` (a request shape this client
 * deliberately does not use, matching cloud-order-actions.ts's existing
 * phone+otp-only calls); with the plain `{phone, otp}` shape this client
 * actually sends, the backend's own controller has a real quirk where the
 * absent `role` field gets silently populated from the raw `otp` string
 * (`otp || role` reusing `otp` when `role` is undefined), which prevents the
 * single-shop auto-scope branch from ever firing and shop_role never
 * appears. `/auth/my-roles` sidesteps this — it needs only a valid
 * authenticated token, not shop-scoping, and it is the same primitive the
 * real backend's own multi-shop `select-role` flow is built on.
 */
export async function getMyRoles(fetchImpl: FetchLike, baseUrl: string, accessToken: string): Promise<string[]> {
  const body = await callCloud(fetchImpl, baseUrl, '/auth/my-roles', { accessToken });
  const data = isRecord(body.data) ? body.data : body;
  return Array.isArray(data.roles) ? data.roles.filter((role): role is string => typeof role === 'string') : [];
}

/**
 * Generic authenticated GET against any already-mounted backend endpoint,
 * with one automatic refresh-and-retry on a 401. Returns the raw `data`
 * envelope field (the shape every LNDRY backend response uses) — callers are
 * responsible for validating the shape they expect from the specific path
 * they called, same as every method above does explicitly.
 */
export async function authenticatedGet(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  tokens: CloudTokens,
  onRefreshed?: (tokens: CloudTokens) => void,
): Promise<unknown> {
  return authenticatedRequest(fetchImpl, baseUrl, path, tokens, { method: 'GET' }, onRefreshed);
}

/**
 * Envelope-preserving counterpart to authenticatedGet. Most cloud readers
 * need only `data`, but paginated endpoints also need the backend's `meta`
 * contract. Keeping this explicit avoids silently dropping pagination or
 * future server-side cursor metadata at the transport boundary.
 */
export async function authenticatedGetEnvelope(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  tokens: CloudTokens,
  onRefreshed?: (tokens: CloudTokens) => void,
): Promise<Record<string, unknown>> {
  const body = await authenticatedRequest(fetchImpl, baseUrl, path, tokens, { method: 'GET' }, onRefreshed, false);
  if (!isRecord(body)) throw new CloudClientError('CLOUD_UNEXPECTED_RESPONSE', `LNDRY cloud returned an unexpected envelope from ${path}`);
  return body;
}

/**
 * Authenticated POST with the same one-shot refresh-and-retry as the GET path.
 *
 * Retrying a mutation is only safe because the only mutations routed through
 * here are ones the backend guards with its own state machine + row lock
 * (`SELECT ... FOR UPDATE` + `validateTransition`), so a retried call that
 * already took effect is rejected as an invalid transition rather than applied
 * twice. Do NOT route a non-idempotent, unguarded mutation through this
 * helper without revisiting that reasoning.
 */
export async function authenticatedPost(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  tokens: CloudTokens,
  body?: unknown,
  onRefreshed?: (tokens: CloudTokens) => void,
): Promise<unknown> {
  return authenticatedRequest(fetchImpl, baseUrl, path, tokens, { method: 'POST', body: body ?? {} }, onRefreshed);
}

/**
 * Authenticated PATCH with the same one-shot refresh-and-retry as GET/POST.
 *
 * Retrying here is safe for a simpler reason than authenticatedPost's: every
 * PATCH routed through this helper is a plain idempotent field SET (e.g.
 * shop-garment_rates' price/availability/stock update) rather than a delta
 * or an append, so re-sending the same body after a token refresh can never
 * double an effect — it just sets the same fields to the same values again.
 */
export async function authenticatedPatch(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  tokens: CloudTokens,
  body?: unknown,
  onRefreshed?: (tokens: CloudTokens) => void,
): Promise<unknown> {
  return authenticatedRequest(fetchImpl, baseUrl, path, tokens, { method: 'PATCH', body: body ?? {} }, onRefreshed);
}

async function authenticatedRequest(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  tokens: CloudTokens,
  opts: { method: string; body?: unknown },
  onRefreshed?: (tokens: CloudTokens) => void,
  unwrap = true,
): Promise<unknown> {
  try {
    const body = await callCloud(fetchImpl, baseUrl, path, { ...opts, accessToken: tokens.accessToken });
    return unwrap ? body.data ?? body : body;
  } catch (error) {
    // Only an EXPIRED token (401) is worth refreshing. A 403 means the
    // account is authenticated but not permitted (e.g. the backend's
    // NOT_VENDOR / rider-blocked guards) — a new access token carries the
    // same permissions, so retrying would just burn a round trip and
    // obscure the real reason.
    if (error instanceof CloudClientError && error.httpStatus === 401) {
      const refreshed = await refreshAccessToken(fetchImpl, baseUrl, tokens.refreshToken);
      onRefreshed?.(refreshed);
      const body = await callCloud(fetchImpl, baseUrl, path, { ...opts, accessToken: refreshed.accessToken });
      return unwrap ? body.data ?? body : body;
    }
    throw error;
  }
}
