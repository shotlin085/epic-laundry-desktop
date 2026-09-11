# Cloud Edge Architecture — Desktop ↔ LNDRY Backend Connector Foundation

Written 2026-09-11. Covers the first real network connection between Epic
Laundry Desktop and the real LNDRY Cloud Backend.

## 1. The architectural correction this makes

Desktop's existing `server/src/modules/marketplace/edge-sync.ts` defines a
`SyncTransport` interface and an outbox/inbox/device-envelope model —
idempotent, versioned, ordered, with a device keypair enrollment concept. It
is well-built. It also assumes a bespoke bidirectional sync protocol that
`Lndry_backend` does not implement: the backend's only "device" concept
(`/api/v1/devices`) is an FCM push-notification token registry, nothing like
an envelope-based sync control plane; there is no `/api/v1/marketplace/sync`,
no device-pubkey registration endpoint, no envelope format on the backend
side at all.

Building a real connector by implementing `SyncTransport` against the real
backend would therefore require *adding a brand-new custom protocol to the
backend* to match Desktop's invented shape — which is exactly what the
mandate prohibits ("never create an independent Desktop marketplace backend
that competes with this one" — §13/§16/§17). The backend is the canonical
system; Desktop must speak its actual contract, not the other way around.

**The correction: Desktop connects the same way Dashboard and Vendor App
already do** — phone+OTP auth (`/auth/send-otp` → `/auth/verify-otp`), a JWT
access/refresh pair, and ordinary REST calls to the same endpoints those
clients use. This is a new, separate capability
(`server/src/modules/marketplace/cloud-client.ts` +
`cloud-session.ts`) — not a replacement for edge-sync.ts, and not (yet) wired
into it. It is the literal "connector foundation" the mandate's phase order
calls for: proof that Desktop can authenticate and talk to the real backend at
all, before any larger "pull real orders into local projections" work is
attempted.

## 2. What was built

- **`cloud-client.ts`** — pure HTTP layer. Typed functions for `sendOtp`,
  `verifyOtp`, `refreshAccessToken`, `getSession`, `logout`, and a generic
  `authenticatedGet` with one automatic refresh-and-retry on a 401. Every
  response is shape-checked before being trusted (`CloudClientError` with a
  stable `code`, never a raw parsed blob handed back uninspected) — no
  endpoint's JSON is trusted just because it parsed.
- **`cloud-session.ts`** — business logic: configuration check
  (`EPIC_MARKETPLACE_CLOUD_API_URL`, unset by default — "not configured" is a
  first-class state, not an error), connect/status/disconnect, and at-rest
  token encryption (see §4).
- **Migration 37** (`marketplace-cloud-session`) — one row per store,
  `marketplace_cloud_sessions(tenant, store_id)`, storing connection status,
  the remote vendor's name/phone (for display only — never a secret), and the
  encrypted token envelope. Wired into the existing data-reset and
  per-store-delete paths in `kernel/store.ts` alongside the other marketplace
  tables.
- **Four new routes** under `/api/marketplace/cloud/*`
  (`otp`, `connect`, `status`, `disconnect`, `vendor-profile`), guarded the
  same way every other marketplace route is (`guard` + `allow('settings.manage')`
  for mutations, `allow('orders.read')` for the read-only status check), with
  audit-log entries on connect/disconnect.
- **Self-test** `_selftest-marketplace-cloud-client.ts` (`npm run
  test:marketplace-cloud-client`), covering: not-configured state, real OTP
  request/verify round trip against a mocked backend, wrong-OTP failing
  closed, encrypted-at-rest token storage (asserts the plaintext tokens never
  appear in the stored row, and that the stored envelope is a genuine
  `{iv, tag, ciphertext}` AES-GCM structure), transparent refresh-on-401, and
  disconnect clearing state and calling the real logout endpoint.

## 3. Verified live, not just mocked

Static/mocked test coverage alone was treated as insufficient (per the
mandate's anti-hallucination stance on trusting untested contract
assumptions). The connector was driven for real against a live local
`Lndry_backend`:

1. Started the real backend (isolated dev Postgres/Redis, `ALLOW_DEMO_OTP=true`
   temporarily set in a local-only, gitignored `.env` for this test only, then
   reverted to `false` afterward).
2. Started Desktop's server pointed at it
   (`EPIC_MARKETPLACE_CLOUD_API_URL=http://localhost:4500/api/v1`).
3. Bootstrapped a Desktop owner, then drove the real flow via `curl` against
   Desktop's own API: `POST /api/marketplace/cloud/otp` → real OTP dispatched
   by the real backend → `POST /api/marketplace/cloud/connect` with the real
   OTP → `GET /api/marketplace/cloud/status` confirms `connected: true` with
   the real phone number → `GET /api/marketplace/cloud/vendor-profile` against
   a non-vendor test account correctly surfaces the real backend's own
   `"Vendor profile not found"` error rather than crashing or fabricating data
   → `POST /api/marketplace/cloud/disconnect` cleanly clears the session.

**This caught a real bug before it shipped.** The initial implementation
assumed `/auth/session`'s profile fields were flat on `data` (based on reading
`auth.controller.js`/`auth.schema.js` and the route list, without exercising
it). The live call returned `data.user.{id,name,role,phone}` — nested one
level deeper. The mocked self-test, written from the same initial assumption,
did not catch this (it validated the client against its own author's guess).
Only the live call did. Fixed in both `cloud-client.ts` (now reads
`data.user` with a flat-`data` fallback, defensively, since this codebase's
endpoints are not shape-consistent with each other) and in the self-test's
mock (now matches the real shape, so this specific regression can't recur
silently).

## 4. Token storage — a deliberately interim design

Tokens are encrypted at rest with AES-256-GCM using a machine-generated key
file (same primitive as `server/src/modules/ops/backup-crypto.ts`, keyed
differently — a random machine key, not a user passphrase — since there is no
natural point to prompt an operator for a passphrase just to keep a
background cloud session alive).

This is **not** the mandate's preferred design (§18: Electron `safeStorage`).
The reason: Desktop's Fastify server runs as a separate child process from
Electron's main process (`desktop/main.js` uses `spawn(...)`, confirmed by
reading it) and `safeStorage` is a main-process-only Electron API. Reaching it
from the server would require a new IPC bridge (renderer/main already talk via
`preload.js`; the server does not currently talk to main at all for anything
like this). Building that bridge is real, scoped, separate work — recorded
here as the natural hardening follow-up, not silently glossed over. The
current design is materially better than plaintext (which is what would have
shipped without this) and keeps the secret out of the SQLite file itself
(verified by the self-test), but it does not yet reach OS-keychain-grade
protection.

## 4a. Cross-system identity split (2026-09-11, same-day follow-up)

Reading the real backend's `vendors.service.js#getPublicPreview` (which
backs `GET /vendor/profile`) surfaced a real bug in the first version of this
connector: it resolves the vendor via `findByUserId(userId)` and returns the
**`vendors` table row** (`vendors.id`), which is architecturally a different
fact from the connecting **user's** own id (`users.id`, returned by
`/auth/session`). The first implementation stored the session's `userId` as
`remoteVendorId` — factually wrong (and exactly the "don't use the wrong
identity as authority" mistake mandate §22 warns about), even though it
happened to be "present" for every account, vendor-linked or not.

Fixed: added `cloud-client.ts#getVendorProfile` (calls the real `/vendor/profile`,
returns `null` — not an error — when the account has no linked vendor, since
that's a real valid state, not a failure), migration 38 adding
`remote_user_id`/`remote_user_role` columns distinct from
`remote_vendor_id`/`remote_vendor_name`, and updated `connectCloudSession` to
populate both correctly instead of conflating them.

Verified live twice: once confirming the "no vendor linked" branch behaves
correctly (a CUSTOMER-role test account connects successfully with
`remoteUserRole: "CUSTOMER"` and no fabricated `remoteVendorId`/
`remoteVendorName`), and via a mocked self-test scenario asserting a
deliberately-different mock vendor id (`vendor-row-778`) is never conflated
with the mock user id (`vendor-user-001`) — both in the API response and in
the persisted SQLite row. A live test against an actual vendor-owner account
(to exercise the "vendor found, ids differ" branch against the real backend,
not just the mock) was not performed — it would require seeding a full real
vendor application/approval in the local backend, which is unrelated
plumbing; the mocked assertion plus the code being read directly from the
real backend's own resolver function is the verification basis for that
specific branch.

## 5. What this does NOT do yet

- Does not call `select-shop`/`select-role` — an account linked to multiple
  vendors/roles connects with whatever default scope `verify-otp` grants.
  Real, scoped follow-up work, not a silent gap.
- Does not feed real backend data into Desktop's existing local marketplace
  projections (`order-truth.ts`, `catalogue.ts`, etc.). This connector proves
  the transport and identity model work; wiring real orders through it into
  the projections `edge-sync.ts` already models durably is the next phase
  ("cross-system identity" / "durable sync" in the mandate's own dependency
  order), deliberately not attempted in the same change as the foundation
  itself.
- Does not touch `edge-sync.ts`'s outbox/inbox at all. That machinery remains
  real, tested, and local-only until a decision is made about whether the
  backend should grow a matching sync protocol (a large, separate proposal)
  or whether Desktop should instead poll/react over ordinary REST + Socket.IO
  (the transport the backend already runs — confirmed mounted in
  `Lndry_backend/src/app.js`, not yet explored for Desktop's use).
