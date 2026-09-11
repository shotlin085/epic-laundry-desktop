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

## 4b. Real order pull — the first durable-sync slice (2026-09-11, same-day)

Built `cloud-order-sync.ts#pullCloudOrders`: pulls this store's real orders
from `GET /vendor/orders` on the connected vendor account and materializes
each into `marketplace_order_projections` (channel `MARKETPLACE`), the exact
projection table `edge-sync.ts`'s envelope pipeline also writes to.

**Deliberately does not go through `receiveMarketplaceOrder`/edge-sync.ts's
envelope pipeline.** That pipeline is gated behind `requireRegisteredDevice`,
which needs a marketplace device with `status='Registered'` — but Desktop's
own device-enrollment flow is permanently blocked
(`activation: 'EXTERNAL_MARKETPLACE_ACTIVATION_REQUIRED'`) because there is
nothing on the real backend to activate it against. Routing through that
gate would mean building a second fake activation flow, or bypassing a check
that exists for a reason, for a transport this feature doesn't use. Instead
this calls `store.saveMarketplaceOrderProjection` directly — the real,
already-idempotent persistence layer the envelope pipeline itself calls into
— using the connected cloud session as an independent trust boundary. This
does NOT touch or weaken the device/envelope gate; that gate still fully
protects the (currently unreachable) envelope path.

**Status mapping caught a second real contract bug, live.** The real
Postgres `order_status` enum (queried directly against a live backend:
`SELECT unnest(enum_range(NULL::order_status))` — 27 values) does **not**
contain `WASHING`/`DRYING`/`IRONING`. Those strings only exist in
`vendor-orders.routes.js`'s querystring *filter* schema — the service
translates a `?status=WASHING` filter into `status = 'PROCESSING' AND
processing_stage = 'Washing'` for the query, but the value actually stored
in and returned from `orders.status` is `'PROCESSING'`. The first version of
the mapping table keyed on `WASHING`/`DRYING`/`IRONING`, which would have
silently skipped every real order in a wash/dry/iron stage as "unmapped
status" — proven live: a real order inserted with `processing_stage =
'Washing'` came back from the real `/vendor/orders` endpoint as
`"status":"PROCESSING"`, and the mapping table has been corrected to key on
that real value. The full remap, and which entries are confirmed-live vs.
best-effort, is documented in `cloud-order-sync.ts`'s own header comment.

**Full live verification, using a real seeded vendor, not a synthetic one.**
`Lndry_backend`'s own `npm run db:seed` creates a real, `APPROVED`,
`marketplace_published` demo vendor ("LNDRY Prime - Bengaluru Hub") linked as
`VENDOR_OWNER` to phone `7013352181` — used exactly as-is, not a fixture
built for this test. Live sequence: connected Desktop to this account
(`remoteVendorId`/`remoteVendorName` resolved correctly to the real vendor
row), confirmed an empty real order list round-trips to `{pulled:0}` cleanly
(no crash on zero orders), inserted one real order directly into the real
`orders` table (`status='PROCESSING'`, `processing_stage='Washing'`,
real subtotal/delivery fee), reran the sync, and confirmed via the existing
`GET /api/marketplace/orders` route (not a new endpoint built just to check
this) that the materialized projection carries the correct state
(`"Processing"`), the correct real vendor id (not the connecting user id —
re-confirming §4a's identity split against yet another real code path),
the correct real order number, customer phone, and subtotal. Also confirmed
this specific account's real oddity is handled correctly: it is
simultaneously `role: "CUSTOMER"` (the base `users.role` column) and
`VENDOR_OWNER` (via `vendor_employees`) — exactly the scenario §4a's identity
split was designed for, now validated against a real multi-role account
instead of only a mocked one.

Also verified idempotency and change-detection with mocked data (a full
mocked self-test, `test:marketplace-cloud-order-sync`, covers: not-connected,
connected-but-no-vendor, the real per-order field names read verbatim from
`vendor-orders.service.js`'s SQL `SELECT`, one deliberately-unmapped status
being skipped-with-reason rather than crashing the whole pull, re-syncing
unchanged data creating zero duplicates while advancing `sourceVersion`, and
a status change on the backend being picked up on the next pull) —
re-running the exact live insert/sync sequence for every one of those cases
was not repeated, since the mock's field names and status values are now
themselves derived from the live-confirmed real shapes above, not from a
fresh guess.

## 4c. Cloud-authoritative accept/reject — closing the loop (2026-09-11)

`cloud-order-actions.ts` adds the first OUTBOUND mutations: a Desktop operator
can accept or reject a real marketplace order, and the real backend is the
authority on the outcome.

**Cloud-first, not local-first-then-push.** Accepting or rejecting is a
coordination fact the customer, the rider and the platform all depend on, so
the remote transition is attempted FIRST and local state is written only once
the remote answer is known. If the cloud is unreachable, local state is left
completely untouched — there is deliberately no optimistic "Accepted" that the
customer's app never agreed to (covered by a test that asserts both the state
and the unchanged `sourceVersion` after a simulated network failure). Because
the cloud confirms before the local write, the resulting projection is marked
`syncState: 'Current'`, not the `'PendingOutbound'` the local-only path has to
use.

**Retry safety and conflict detection — two different things, told apart by
re-reading the remote.** The backend guards both actions with `SELECT ... FOR
UPDATE` + `validateTransition`, answering the single code `INVALID_TRANSITION`
for anything it won't move. That one code can mean "already in an equivalent
terminal state" (benign) or "moved somewhere incompatible" (a real conflict),
so on that code the order is re-read and the outcome classified honestly
rather than guessed from the message text:

- `transition: 'applied'` — the remote accepted the call.
- `transition: 'already_final'` — the remote refused, and a re-read showed it
  was already where the operator wanted it (e.g. rejecting an order the
  platform had already `AUTO_REJECTED`).
- `CloudOrderConflictError` → HTTP **409**, carrying the real `remoteStatus`
  and what was `attempted`, AND correcting the local projection to the remote
  truth first — so the operator's next look shows what actually happened
  instead of the stale state they acted on.

**A live behavioural discovery corrected a misleading field.** The first
version reported a boolean `converged`, implying Desktop could tell a fresh
transition from an idempotent repeat. Reading `src/utils/state-machine.js` and
confirming against a live backend showed `validateTransition` treats a
same-status transition as an explicitly VALID no-op, and its success response
is byte-identical either way — so a repeat accept returns plain success, and
the boolean was asserting knowledge Desktop does not have. Replaced with the
`transition` enum above, which only claims what is actually determinable
without paying an extra round trip on every accept. The self-test's mock was
also corrected to match this real semantics (it had been stricter than
reality), and `already_final` is now covered via the path that genuinely
produces it on the real backend.

**Materialization deferral is classified by what someone must DO about it.**
After a successful accept, the existing `materializeMarketplaceOrder` bridge
runs to create a real local laundry order. It frequently, legitimately
refuses, and those refusals are no longer one undifferentiated bucket:
`awaiting_intake` (no locally-resolvable garment/service ids, or no delivery
date — resolved when the bags arrive and are counted),
`awaiting_customer_approval` (a reassessment the customer must answer),
`blocked_by_setup` (the store's supplier tax profile is incomplete — nothing
can be invoiced until the owner fixes settings). A live accept against a fresh
store surfaced exactly this last case, which is how the distinction came to be
drawn: "go finish your tax profile" is a completely different instruction from
"wait for the bags". Any refusal reason NOT in the known set is re-thrown
rather than absorbed into a tidy-looking outcome. Critically, none of these
ever roll back or misreport the accept — it genuinely happened remotely.

Rejection requires a non-empty reason (enforced server-side in Desktop, not
just in a form) because rejecting queues a **real customer refund** on the
backend, and the reason is verified to actually reach the cloud, not just the
local note.

**Live-verified end to end** against the real seeded vendor, including the
hardest case: Desktop synced an order as `AwaitingAcceptance`; a separate
client rejected it directly on the real backend (exactly what the Vendor App
would do); Desktop's accept then returned HTTP 409 with
`remoteStatus: VENDOR_REJECTED`, and Desktop's local projection was corrected
to `Rejected` at `sourceVersion: 2`. Also live-verified: a real accept moving
a real order to `VENDOR_ACCEPTED`, a safe repeat accept, a real reject with
reason, and the mandatory-reason guard returning 400.

## 4d. The operator surface — and a dead-button discovery (2026-09-11)

Everything above was server-side until this point. Two existing pages were
extended rather than adding parallel screens:

**Marketplace sync** gained a "Marketplace account" panel: sign in with the
phone number registered to the laundry, receive the real OTP, connect, and see
which vendor the store is attributed to (vendor id, account role, connected
time), plus disconnect. It is owner-only in the UI, matching the
`settings.manage` guard the routes already enforce server-side. The existing
device/outbox section was relabelled "Edge event ledger" — it previously
announced "Local standalone · marketplace not configured", which would now be
actively misleading for a store that IS connected through the account panel.
The two concepts are now visibly distinct rather than one overloaded
"connection state".

**Online orders** gained a "Pull from marketplace" action, a connected-account
banner, and cloud-routed accept/reject. Outcomes are reported as what actually
happened — e.g. *"The marketplace confirmed VENDOR_ACCEPTED. A local order
cannot be created yet: finish the supplier tax profile in settings."* — rather
than a generic "saved". A conflict shows the real remote status and refreshes
the queue so the corrected state is immediately visible.

**The discovery: the existing Accept/Reject buttons were dead.** They posted to
the local `/api/marketplace/orders/:id/accept|reject` routes, which run through
`actOnMarketplaceOrder` → `requireRegisteredDevice`. Probing the real HTTP API
proved the chain is impossible to satisfy: `PUT /api/marketplace/device` with
`status: 'Registered'` returns **409 DEVICE_ACTIVATION_REQUIRED**, and the
accept/reject routes therefore return **400 SYNC_NOT_CONFIGURED** — every time,
in any real deployment. (Existing tests pass only because they call
`registerMarketplaceDevice` directly in-process, bypassing the route's block.)
Those buttons could never have worked for an operator. They now call the cloud
routes, and when no marketplace account is connected they are disabled with the
specific reason and a link to the connect panel, instead of failing when
pressed.

**Verified by using it, not by reading it.** Against the real backend and the
real seeded vendor, in a browser: connected the store through the panel (real
OTP), pulled 3 real orders (an order stored as `PROCESSING` correctly showing
as "Processing" — the §4b mapping fix, confirmed again through the UI),
accepted one and saw the tax-setup message, then rejected an order on the
backend as a separate client and watched the Desktop accept surface the
conflict and auto-correct that order to "Rejected". Checked at 1024px with no
horizontal overflow on either page; the only console error in the whole
session was the deliberate 409.

**One accessibility fix came out of it:** the pull button set a `title`, which
overrides the visible text as the accessible name (WCAG 2.5.3 Label in Name) —
assistive tech would have announced the tooltip instead of "Pull from
marketplace". Noticed because a find-by-visible-label failed in exactly the way
a screen-reader user would hit it. Fixed with an `aria-label` that contains the
visible label in both enabled and disabled states. The repo's a11y audit had
passed regardless, since it only checks that a name exists, not that it matches
the label.

## 5. What this does NOT do yet

- Does not call `select-shop`/`select-role` — an account linked to multiple
  vendors/roles connects with whatever default scope `verify-otp` grants.
  Real, scoped follow-up work, not a silent gap.
- **Orders only, and only accept/reject outbound.** Real vendor orders pull in
  (§4b) and accept/reject go out (§4c) — but catalogue, availability,
  capacity/slots and settlement still have no real backend data flowing either
  direction. The remaining vendor-order mutations the backend exposes
  (`/processing-stage`, `/reconcile`) are not wired yet, so a Desktop operator
  advancing production locally does not yet move the customer-visible stage on
  the marketplace.
- **No scheduled/background sync.** `pullCloudOrders` only runs when
  `/api/marketplace/cloud/sync-orders` is called. Wiring a recurring poll —
  or better, reacting to the backend's already-running Socket.IO transport
  instead of polling — is separate, scoped follow-up work. Until then a new
  marketplace order does not appear in Desktop on its own.
- **UI covers connect + pull + accept/reject only** (§4d). Reconciliation,
  pickup/delivery and settlement surfaces are untouched by this work.
- Does not touch `edge-sync.ts`'s outbox/inbox at all. That machinery remains
  real, tested, and local-only until a decision is made about whether the
  backend should grow a matching sync protocol (a large, separate proposal)
  or whether Desktop should instead poll/react over ordinary REST + Socket.IO
  (the transport the backend already runs — confirmed mounted in
  `Lndry_backend/src/app.js`, not yet explored for Desktop's use).
