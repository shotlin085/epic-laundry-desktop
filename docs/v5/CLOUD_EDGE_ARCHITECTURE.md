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
  (`EPIC_MARKETPLACE_CLOUD_API_URL`, explicitly supplied in development; the
  packaged Desktop launcher defaults only to the canonical
  `https://api.lndry.in/api/v1` production boundary — endpoint configuration
  is not a login or a credential), connect/status/disconnect, and at-rest
  token encryption (see §4).

### Website partner-intake handoff

The marketing website now has a controlled bridge to the canonical backend:
the website stores its validated Supabase lead first, then uses a server-only
HMAC call to create an idempotent `partner_leads` staging record in LNDRY.
This is intentionally not vendor onboarding—no vendor, user, KYC approval, or
marketplace access is created from a website form. The Platform Control queue
can list and claim those cloud-owned leads for follow-up, but cannot promote
them around the existing verified onboarding workflow. The shared secret,
deployment URLs and Supabase migration are deployment configuration, not
embedded Desktop credentials. See the website's
`docs/CANONICAL_PARTNER_LEAD_HANDOFF.md` for the exact contract.
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

## 4e. Reconciliation — the recount, and the invariant it protects (2026-09-11)

`cloud-order-progress.ts` adds order detail, outward stage progression, and
the reconciliation proposal.

**The invariant (mandate §33): the customer's original request is never
overwritten.** Three separate rows now exist per cloud order, reusing Desktop's
existing, already-tested order-truth domain rather than a parallel model:

1. the **original request**, recorded immutably the first time an order is
   pulled (`createMarketplaceOrderRequest`, which returns the existing row
   unchanged on every later sync, so re-pulling can never rewrite it) — this
   was previously missing for cloud orders, which is what made the rest of the
   chain impossible;
2. the **physical intake** — what was actually counted, stored with the
   evidence and carrying `originalEstimate` alongside, so the difference stays
   explainable side by side;
3. the **reassessment** — the price change, carrying the marketplace's own
   computed amounts.

**Desktop never prices the recount.** The backend resolves rates from THIS
vendor's own active, approved rates and refuses a client-supplied price; the
amounts recorded locally are the ones the customer will actually be asked to
approve. A test asserts the outbound body contains no `rate_paise` at all.

**Desktop never approves on the customer's behalf.** The reassessment is
created with `tolerancePaise: 0`, so no tolerance band can silently
auto-approve part of a marketplace price change. When the recount produces a
zero delta, no reassessment row is created at all — the local domain would
have marked it `Approved` immediately, which would claim a decision the
marketplace has not granted (the order is still `RECONCILIATION_PENDING`
there). The physical count is still recorded.

**Evidence is mandatory and never invented.** The marketplace requires at least
one photo; Desktop enforces it at the route schema too, so an unevidenced
recount never even leaves the machine (asserted by a test that checks no
request reached the marketplace). Desktop has no camera and does not pretend
otherwise: the URLs are either evidence an operator supplied or evidence
already attached to the order upstream.

**Stage gating is reported as a precondition, not a failure.** The marketplace
only accepts a recount between "received at the store" and the start of
washing. That refusal now surfaces as **409** with the marketplace's own
`remoteCode` plus a plain-language `hint`. Desktop can also move the order's
stage outward (`RECEIVED_AT_VENDOR` → `WASHING`/`DRYING`/`IRONING` → `PACKED`,
with the dispatch slot only on `PACKED`), which is what makes the
customer-visible progress change.

A latent routing bug was caught by the test here: the new `INVALID_STAGE`
mapping sat *after* the generic `CloudClientError → 400` return and was
unreachable, so a stage refusal came back as a flat 400 with no reason. Moved
ahead of the fallthrough.

**Live-verified end to end** against the real backend and seeded vendor, with a
real order carrying a real `order_lines` row: a recount before receipt returned
409 with the hint; marking received moved the real order to
`RECEIVED_AT_VENDOR`; an unevidenced recount was rejected before any request
left; and the real recount (3 hoodies counted as 5, plus 2kg of wash-and-fold
found in the bag) came back with the backend's own figures — ₹300.00 →
₹632.00 — and set the order to `RECONCILIATION_PENDING`. Reading back
afterwards: the original request was byte-identical (`immutable: true`, still
3 shirts at ₹300.00), the intake row held the count and the evidence, the
reassessment sat at `PendingApproval`, and the marketplace's own copy of the
order still showed `confirmed_quantity: null` — it stages the proposal without
applying it, exactly as its own documentation claims.

## 4f. The customer's answer, and what evidence is actually readable (2026-09-11)

**The recount loop now closes.** A proposal no longer sits locally forever:
reading an order's detail brings back the marketplace's own reconciliation
record and resolves the pending local reassessment from it.

The signal is `order_reconciliations.status` (PENDING_CUSTOMER / ACCEPTED /
REJECTED / APPLIED) — the marketplace's explicit record of what the customer
did. The order's *status* is deliberately NOT used: an order can move on for
reasons unrelated to a recount, and reading "the customer must have agreed"
out of that would be Desktop inventing a decision. While the record still says
PENDING_CUSTOMER nothing is nudged, and an already-decided reassessment is
never decided twice.

**An attribution bug was caught by looking at the result.** The first version
recorded `decidedBy: <the Desktop operator whose sync happened to run>` —
crediting a store employee with a decision the customer made, in a row whose
whole purpose is explaining a price change afterwards. Now the decision is
attributed to `marketplace:customer`, with the observing operator kept
separately in the audit entry.

**Evidence — what is and is not possible, from reading the backend.** The
backend stores three photo contexts (`order_pickup_photos.context` =
`RIDER_PICKUP` | `VENDOR_RECONCILIATION` | `DELIVERY_PROOF`), but the only
read path anywhere in it selects photos by `order_reconciliation_id`
(confirmed by grepping every query against that table — three call sites, all
the same filter). **Rider pickup proof and delivery proof are therefore
written and never readable by any client, the vendor included.** So Desktop
now surfaces reconciliation evidence, and cannot surface the rest — recorded
here as a backend capability gap rather than filled with a placeholder that
would imply an evidence trail exists. Building the Evidence Center the mandate
describes needs a backend read endpoint first.

The marketplace's own status timeline (`order_events`: actor role, note, old
and new status) now comes back with the detail too — the first real
cross-system timeline data Desktop holds, including actors other than this
store.

**Live-verified both ways** against the real backend, with a real customer
account acting on its own order: a recount was proposed from Desktop; while
undecided, re-reading returned no decision and left the reassessment pending;
the customer then **accepted** on the marketplace, and the next detail sync
recorded `approve` with the reassessment `Approved`, the projection moved to
`Processing`, and the real order line showed `estimated 2 → confirmed 4`;
re-reading again decided nothing further. On a second order the customer
**rejected**, and Desktop recorded `Rejected`, `decidedBy:
marketplace:customer`, leaving the order needing attention. Throughout, the
original request stayed immutable and unchanged.

## 4g. Closing the evidence gap — a backend fix, not a workaround (2026-09-11)

§4f recorded rider pickup proof and delivery proof photos as unreadable by
any client — a real backend gap, not something Desktop could fix on its own
side. Per the mandate's §83 ("backend changes are allowed when required"),
fixed it there: `Lndry_backend@29b8158` adds one additional, already
tenant-scoped query to `VendorOrdersService#getOrder` returning every photo
ever attached to the order across all three contexts
(`RIDER_PICKUP`/`VENDOR_RECONCILIATION`/`DELIVERY_PROOF`), with the
uploader's name joined in.

**Purely additive.** The existing `latestReconciliation.photos` field (scoped
to only the current/latest recount) is untouched — no existing client's
response shape changed. No new authorization filter was needed either:
`orderId` is already resolved against the calling vendor by the main order
query's `o.vendor_id = $2` check earlier in the same method, which throws 404
before the new query would ever run for another vendor's order — confirmed
live with a non-vendor account (403 `NOT_VENDOR`, never reaching the new
query) and backed by 3 new backend unit tests.

**Desktop wired up to consume it**: `CloudOrderDetail.evidence` (a new,
typed, cross-context array — url, context, uploader name, timestamp),
persisted onto the local projection on every detail-sync so it is queryable
without repeating the sync. Live-verified through the full chain: a real
order seeded with a real `RIDER_PICKUP` and a real `DELIVERY_PROOF` photo
came back through Desktop's typed parser with both photos and the uploading
rider's name, and was still readable from the local projection afterward
with no further network call.

## 4h. Evidence Center UI, live-verified, and two session-breaking bugs it caught (2026-09-12)

§4g closed the backend evidence-read gap; this slice built the Desktop UI
that consumes it (`MarketplaceProgressPanel` in `LaundryOnlineOrders.tsx`):
remote-status card, evidence list (clickable links to the photo URL, context
label, uploader name, timestamp), recount status card, marketplace timeline,
stage-advance buttons (`RECEIVED_AT_VENDOR` → `WASHING`/`DRYING`/`IRONING`/
`PACKED`), and the "propose a recount" form (line select, confirmed quantity,
photo URLs, reason).

**Live-verified end to end against a real backend + real Postgres**, not
mocked: seeded a real order with a real `RIDER_PICKUP` photo and a real
`order_lines` row, then through the actual browser UI: accepted the order,
marked it received, advanced it through a stage, proposed a recount (real
line id, real photo URL), and — simulating the customer side with a crafted
JWT for the test customer's own user id — accepted the recount via the real
`/orders/:id/reconciliation/accept` endpoint. Desktop's UI picked the
decision back up correctly: remote status `PROCESSING`, recount card
`ACCEPTED`, and a real timeline entry attributed to `CUSTOMER` ("Customer
accepted the vendor's recalculated total") — confirming the §33 invariant
(customer decision read back from the marketplace's own record, never
inferred) holds through a real customer action, not just a mocked one.

That verification pass caught two real bugs, both now fixed
(`epic_crm_shotlin@c1a7daf`):

**Bug 1 — `refreshAccessToken` sent the wrong field name.** It posted
`{ refresh_token: ... }` (snake_case) to `/auth/refresh-token`, but the real
backend's `refreshTokenSchema` requires camelCase `refreshToken` — every
other cloud endpoint here speaks snake_case, which is exactly what made this
one easy to get wrong by pattern-matching the rest of the file. A body with
the field simply absent (as the schema sees a differently-named key) 400s
with the backend's generic `VALIDATION_ERROR`. Effect in practice: a
connected session works fine for its first ~15 minutes (the access token's
lifetime), then **every** cloud-authoritative action — accept, reject,
detail-sync, stage-advance, reconcile, pull — starts failing with a generic
"Validation error" the instant a 401 triggers the refresh path, with no
indication the real cause is the refresh call itself. Caught because the
recount form's submit genuinely failed live, and tracing it required
restarting the backend with a temporary debug log in its AJV error handler
to see that the *real* failing request was `/auth/refresh-token`, not
`/reconcile` — reproduced directly with curl (`refresh_token` → 400
`VALIDATION_ERROR`; `refreshToken` → 200 with a fresh token pair) before
fixing the client. The self-test's mock backend had the same wrong field
name baked into its assertion, so it was self-confirming the bug rather than
catching it; fixed there too; it now fails against the old code and passes
against the fix.

**Bug 2 — a marketplace-auth 401 logged the operator out of the whole
desktop app.** `cloudErrorStatus` correctly maps the connector's own
`CLOUD_AUTH_FAILED` (wrong OTP, or — per Bug 1 — a refresh that itself
failed) to HTTP 401 on Desktop's local endpoints. But the webapp's fetch
wrapper (`webapp/src/lib/api.ts`) treated *any* 401 from *any* endpoint as
"the operator's own Desktop session expired," dispatching a global
`epic-auth-expired` event that `AuthGate` turns into "Your session expired,
sign in again" for the entire app. A dead marketplace connector token —
which has nothing to do with the operator's own login — was enough to kick
them out of Counter Desk, Reports, Settings, everything. Caught live: after
restarting the Desktop server mid-session, the online-orders page's own
marketplace queries 401'd on the stale connector token and the whole app
dropped to the sign-in screen, even though `/api/auth/session` confirmed the
operator's own session was still completely valid. Fixed by having the
fetch wrapper inspect the error body for `code: 'CLOUD_AUTH_FAILED'` before
firing the global event (`notifyUnauthorizedUnlessCloud`) — that 401 now
stays scoped to the marketplace panel that raised it, with a new operator
hint ("The marketplace connection has expired. Reconnect it from Marketplace
sync.") via `cloudProgressErrorHint`.

Both fixes are narrow and additive: no endpoint's request/response *shape*
changed, only the one wrong field name and the one over-broad global-logout
trigger.

## 4i. Marketplace catalogue — the first write surface beyond orders (2026-09-13)

Built after the real backend's `shop-garment_rates` module (vendor catalogue:
list/get/price/availability/stock/delete) was fixed and mounted (see
`CROSS_REPOSITORY_CAPABILITY_MATRIX.md` §5a) — a new Desktop module,
`cloud-catalogue.ts`, mirroring the exact `cloud-session.ts` plumbing every
other cloud feature uses, plus a new webapp page
(`LaundryMarketplaceCatalogue.tsx`). A vendor connected through Desktop can
now see their real priced marketplace services and edit price/sale price/
cost price/low-stock threshold/max order qty/availability
(`PATCH /shop-garment_rates/:id`) and stock quantity separately
(`PATCH /shop-garment_rates/:id/stock` — a distinct, row-locked real
endpoint, not folded into the general update).

**Deliberately narrower than the full `shop-garment_rates` surface**: create,
soft-delete, bulk-price-update, manual product creation, and the HQ approve/
reject routes are not exposed. Those nested routes are gated by a different,
still-unresolved mechanism (`requirePermission`, reading an empty
`permissions` array for every real account today) — see the capability
matrix's §5a for the full accounting of that separate gap.

**Live-verified against the real backend, not mocked** — and this pass caught
three more real bugs, all fixed:

1. **`connectCloudSession` never refreshed immediately after `verify-otp`,
   so the stored connector token could carry no `shopRole` claim for its
   first ~15 minutes.** The real backend's `verify-otp` response JWT
   contains only `{ id, phone, role: 'CUSTOMER' }` — `shopId`/`shopRole` are
   embedded only by a subsequent `/auth/refresh-token` call (confirmed live
   this session, already noted in §4g's commission-refresh-bug writeup from
   a different angle). Every `shopRole`-gated route reads the claim straight
   off the JWT with no DB fallback, so a freshly connected session hit a real
   `403` the moment it tried anything shopRole-gated — reproduced live (the
   real vendor owner's connected session 403'd on `GET /shop-garment_rates`
   immediately after connecting) and confirmed by checking both the Desktop
   and real-backend request logs side by side. `vendor-orders` and
   `shop-transactions` never exposed this because nothing in this session had
   exercised Desktop's *own* connector token against a shopRole-gated route
   before now — every earlier "shop-transactions works" check in this
   session used a manually-refreshed token obtained via direct `curl`, not
   Desktop's actual stored session. Fixed by having `connectCloudSession`
   refresh once, immediately, before the token is ever persisted.
2. **A `null` → `0` coercion trap in a locally-duplicated `num()` helper.**
   `Number(null) === 0` in JS; `sale_price`/`cost_price` are genuinely
   `NULL` for most real services (confirmed live — "Small Carpet" has
   `sale_price: null`), so the helper turned "no sale price configured"
   into a fake "sale price of ₹0" — which would also have pre-filled the
   edit form with `0` so an unrelated save could silently zero out a real
   price. Fixed by checking `null`/`undefined` explicitly before coercing.
   The exact same helper, with the exact same bug, already existed in
   `cloud-order-progress.ts` (shipped in §4f/§4g) — flagged as a separate
   follow-up task rather than fixed here, since that file's fields
   (`confirmedQuantity`, `ratePaise`, reconciliation amounts) need their own
   live-reachability check against real null-carrying data, not a
   drive-by edit.
3. **The stock-update endpoint's response is shaped differently from every
   other `PATCH` response in this module.** `PATCH /:id` returns the updated
   row flat; `PATCH /:id/stock` returns `{ shopProduct, prev }` — confirmed
   live (a real stock save 500'd with `CLOUD_CATALOGUE_UPDATE_UNEXPECTED_RESPONSE`
   until this was unwrapped correctly). `shopProduct` itself also carries no
   joined product/category (its query has no `JOIN`, unlike the list
   endpoint), so the mapped result from a stock save is honestly missing
   `name`/`categoryName` rather than having them faked — acceptable here
   since the UI re-fetches the full list on every successful save anyway and
   never renders the mutation's own return value.

Also fixed in the same pass: the edit form's number inputs relied on an
implicit accessible name from a wrapping `<label>` + `<span>`, which didn't
resolve to anything useful in practice — added explicit `aria-label`s,
matching the convention `LaundryOnlineOrders.tsx`'s own date/text inputs
already use (and which an earlier WCAG fix this session specifically
established as the right pattern here, not a new one invented for this page).

## 4j. A third connected identity — Platform Control (2026-09-13)

Every prior section in this doc is about ONE connected identity per store:
a vendor, linked through phone+OTP. §5d of
`CROSS_REPOSITORY_CAPABILITY_MATRIX.md` adds a second, wholly independent
kind of connected identity Desktop can hold at the same time — a real
platform administrator, email+password, against the same backend base URL
(`EPIC_MARKETPLACE_CLOUD_API_URL`, no new config) but a different auth
surface (`/admin/auth/*` rather than `/auth/*`). New module:
`server/src/modules/marketplace/platform-session.ts`.

**Why not reuse `cloud-session.ts`'s `CloudTokens`/`encryptTokens`/
`decryptTokens` directly.** The real admin login response carries no
refresh token — only `accessToken` with a 24h expiry (the Dashboard's
browser client relies on httpOnly cookies for silent renewal instead, which
doesn't exist for this headless server-to-server client). `CloudTokens` is
typed to require `refreshToken`, and `authenticatedGet/Post/Patch`'s
refresh-and-retry wrapper has no meaning without one. Rather than force-fit
a fake refresh token or add an optional field that would silently lie about
what this identity can do, `platform-session.ts` has its own `PlatformToken`
type (`{ accessToken, accessTokenExpiresAt }`) and its own AES-256-GCM
encrypt/decrypt pair — same primitive, same shared machine-key file as
`cloud-session.ts` (deliberate: the key file is a machine secret, not scoped
to one identity), just not the same functions. What IS reused: `cloud-
client.ts`'s internal `callCloud` request/error-shape helper, now exported,
since it already does exactly the right thing (timeout, JSON-shape
validation, 401/403 → `CLOUD_AUTH_FAILED`) independent of any refresh logic.

**No refresh-and-retry, by design, not by omission.** A 401 from a stored
platform-admin token means the 24h window has passed; the caller must
reconnect (re-enter the password) rather than silently renewing forever in
the background. This is an intentional difference from the vendor
connector, not a gap to close later — platform-admin usage is expected to
be occasional and interactive (an owner opening Platform Control to check
something), unlike the always-connected vendor session a store depends on
continuously.

**Storage**: a new `platform_admin_sessions` table (migration 39 in
`store.ts`), structurally identical to `marketplace_cloud_sessions` (same
tenant/store-scoped primary key, same encrypted-blob-plus-redacted-status
split) but carrying `is_super_admin` and a real `permissions_json` array —
fields the vendor-session record has no equivalent of, since
`vendor_employees.permissions` is empty by design (§5a) while the real HQ
login always returns a populated, meaningful permission set.

**API surface** (`server/src/api.ts`): `POST/GET/POST
/api/platform/{connect,status,disconnect}` (mirroring the vendor connector's
own three), plus the first two real Platform Control capabilities —
`GET /api/platform/vendors` (directory), `GET`/`PUT
/api/platform/vendors/:vendorId/capacity` — each a thin proxy to the real
`/vendors/admin/*` routes using the connected platform-admin token. All
gated by the same `settings.manage` local permission the vendor connector's
connect/disconnect already uses; the actual security boundary is the real
backend's own ADMIN-only route authorization underneath, confirmed live (a
real `VENDOR_OWNER` token gets `403` from all of them) — this local gate
only controls who may attempt the platform sign-in at all, same division of
responsibility as everywhere else in this doc.

**One more real API-shape mismatch, caught by live editing**:
`GET .../capacity` returns the value as `daily_limit`; `PUT .../capacity`'s
body field for the identical concept is `max_orders_per_day` — confirmed by
reading `vendors.service.js`'s `adminGetVendorCapacity`/
`adminSetDailyCapacity` (the value actually lives inside the vendor's
`operating_hours` JSONB column, under the `max_orders_per_day` key; the GET
handler just relabels it as `daily_limit` in its response). The webapp page
initially read the wrong key and always showed an empty field — fixed
before this was reported as done.

**Application review extension.** Platform Control also proxies the existing
ADMIN-only review contract as thin, connected-session calls:
`GET /api/platform/vendors` forwards the real list filters; `GET
/api/platform/vendors/:vendorId` returns the full cloud-owned application
or vendor detail; and `POST /api/platform/vendors/:vendorId/review` forwards
only the backend's supported decision payload. No application status is
cached or made authoritative at the edge: the Desktop invalidates its
review/detail/capacity queries only after the cloud write succeeds, and the
server audit event records the local actor plus the requested outcome.

The browser workflow is deliberately a review drawer rather than a new
local application page: application detail, requested/approved radius,
capacity, contact/location fields and document *metadata* stay visible over
the queue, while Approve, Request correction, Reject and Suspend map to the
real review states. Migration `098_vendor_application_suspension.sql` closed
the former schema/service mismatch for pending applications and was verified
through both the real backend and the built Desktop UI; the Desktop never
fabricates a transition locally. Per-document KYC actions are intentionally
not rendered yet. At the time of live verification there were zero application
documents, and the backend's masked preview URL needs a future token-safe
binary preview proxy before Desktop can honestly let an operator inspect
content. The typed proxy contract already preserves `documentReviews` for
that future secure slice; it does not fabricate document approval now.

**Review-record privacy boundary.** `/api/platform/vendors/:vendorId` and
the review response are now deliberately narrower than the upstream backend
row. Before a cloud vendor record can reach the Desktop renderer, the edge
removes bank account number, IFSC, bank name, account holder, GSTIN, PAN and
each document's private `file_url`. It substitutes only
`bank_details_recorded` and `tax_identifiers_recorded` booleans, while
retaining non-sensitive application and document-status metadata necessary
for a decision. This prevents Platform Control from becoming an accidental
secondary KYC/bank-data store or private-document locator. The current UI
uses those presence signals; it cannot reveal a raw tax or bank identifier.
The sanitiser runs for both reads and post-review responses because the
backend returns a complete record after a write. Document-content review is
still deferred until the cloud can provide a short-lived, authorization-bound
binary preview transport; it must not be bypassed by exposing a permanent
storage URL at the edge.

**Website partner-intake queue.** A partner enquiry received from the public
website has a different authority and evidence level from a vendor
application. The website stores the validated submission in Supabase first,
then uses a server-only HMAC handoff to create an idempotent
`partner_leads` record in the backend. Desktop's connected platform session
has only `GET /api/platform/partner-leads` and `POST
/api/platform/partner-leads/:leadId/claim`: list staged `RECEIVED` work and
record a real cloud follow-up owner. It cannot create a vendor or bypass
KYC/onboarding. The proxy applies a separate minimisation step, dropping
email, phone, address and free-form message before the row reaches local
SQLite/React; the compact card receives only the business/contact-name,
city/service-area, selected services, status and timestamps required to
triage work. Both local `settings.manage` and upstream `ADMIN` controls are
required, and claim audit follows a successful cloud mutation. A live
Postgres verification exercised signed intake → Desktop queue → claim and
then removed the test record and its test audit evidence. Deployment remains
explicitly blocked until the matching website migration and server-only
shared HMAC configuration are applied to the real services.

**Read-only marketplace order oversight.** The same connected platform-admin
identity now reads the real `GET /admin/orders` directory and `GET
/admin/orders/:id` detail through `GET /api/platform/orders` and `GET
/api/platform/orders/:orderId`. A live code/DB audit found a material
lifecycle split: `utils/state-machine.js` plus the vendor/rider services own
the full physical-order state machine, but legacy platform-admin *write*
routes still validate a shorter sequence. Desktop exposes neither writer.
`LaundryPlatformOrders.tsx` is consequently a cloud-monitoring screen only:
search/status filtering, pagination, amounts, vendor/rider context, items,
and cloud event timeline in a drawer. It makes the limitation visible rather
than allowing a deceptively powerful button that could bypass pickup, OTP,
payment, or rider workflow. A later backend convergence slice must reconcile
the old admin writer to the canonical state-machine before any platform
mutation is added here.

The recovery is enforced at the cloud boundary as well: legacy admin-order
write endpoints now fail closed with `409 ORDER_LIFECYCLE_CONVERGENCE_REQUIRED`.
Desktop's read-only posture is therefore defense in depth, not merely a UI
choice. Reads and exports remain usable; platform mutation returns only when
it has one canonical state-machine implementation with the required audit,
reason, authorization, OTP/payment and idempotency checks.

**Payout boundary is likewise evidence-first.** The platform settlement audit
confirmed that a payout must not be represented as bank-paid merely because a
background process ran or an administrator clicked a button. The backend's
former default worker adapter generated an `INTERNAL-*` reference in the
absence of a real disbursement provider, while an older admin-finance route
could set a period to `PAID` without a provider receipt. Both are now
fail-closed: no configured provider moves an otherwise bank-ready period to
`HELD` with an explicit configuration reason and no retry-attempt burn; the
manual `mark-paid` compatibility endpoint returns `409
PAYOUT_PROVIDER_EVIDENCE_REQUIRED` and does no financial write. Desktop must
therefore not add a payout execution control or call a period "paid" unless a
future provider-backed contract returns external evidence that can be stored,
reconciled and audited. Read-only settlement monitoring remains an eligible
future Platform Control surface; payout execution remains an
`EXTERNAL_BLOCKER`, not a UI gap to paper over.

**Cloud audit evidence reader.** Desktop also now has a separate
`/laundry/platform-audit` Platform Control route, backed solely by the
backend's real `GET /admin/audit-logs` reader. It forwards only that API's
existing bounded filters and preserves the cloud response as the authority;
it does not mirror audit events into SQLite or offer mutation controls. The
screen is intentionally an evidence ledger rather than a generic activity
feed: a compact, filterable list opens an event drawer with the recorded
target, actor role, and before/after snapshots. IP/user-agent values remain
outside the Desktop operator view even though the cloud API may return them.
Both the local `settings.manage` route guard and the cloud's
`audit_logs.view` permission are required. This is verified as a live reader
only; it does not grant the Desktop any power to change the cloud history.

**Cloud finance reader.** Desktop's `/laundry/platform-finance` view makes
three existing finance reads visible without turning the edge into a
settlement authority: the vendor finance directory, per-vendor financial
periods, and per-vendor ledger transactions. It carries the cloud response
through as read-only evidence and deliberately offers no payout release,
manual-paid, bank-detail, or CSV-export route. The finance directory itself
was narrowed at the cloud source to expose `payout_bank_ready` rather than
bank account number, IFSC, bank name, or account-holder name. Both the local
`settings.manage` guard and the cloud `finance.global_view` role are still
necessary; a configured provider plus verifiable provider receipt and
reconciliation workflow remain required before any payout execution surface
can exist.

## 4k. Restart-safe direct order polling (2026-09-15)

The original order pull was deliberately manual. That was safe as a first
connection slice, but it still left a connected vendor with a stale Desktop
until an operator pressed **Pull from marketplace**. The Desktop runtime now
starts `cloud-order-auto-sync.ts` by default after Fastify is listening.

This is a **direct vendor-account REST pull**, not an implementation of the
separate device-envelope protocol:

- It discovers each store that has an encrypted, connected vendor session and
  runs inside that store's explicit scope. A vendor token, projection or health
  record can never cross into another store.
- It calls the same `pullCloudOrders` connector used by the manual action. The
  local projection's immutable original request remains untouched.
- The pull preserves the real backend's response envelope for this endpoint
  rather than throwing away `meta.pagination` with the generic data reader.
  It reads 100-order pages until the backend's declared end (bounded at 1,000
  pages / 100,000 orders per pass). This replaces the former hard-coded
  `limit=50` first-page pull, which would have silently hidden most work for a
  growing vendor. The backend still has offset rather than cursor pagination;
  the bounded scan is safe for the current contract, while cursor/snapshot
  support remains the future consistency upgrade for very high write churn.
- Migration 40 adds `marketplace_cloud_sync_health`. It records only
  operational telemetry: attempt/success time, last pull counts, sanitized
  failure reason, consecutive failures and next retry time. It is deliberately
  excluded from restore truth alongside cloud credentials; it is not a ledger
  or a business event.
- On failure the next network attempt is exponentially delayed, capped at 15
  minutes. The saved `next_attempt_at` is checked before every call, so a
  Desktop restart cannot turn an outage into a retry storm. A disconnected or
  unlinked account reaches no cloud order endpoint at all.
- A successful background pull resets the failure counter. The Sync Status UI
  shows this direct-pull health separately from the local edge outbox/inbox and
  explicitly says that it does **not** acknowledge device-envelope events.
- `EPIC_MARKETPLACE_CLOUD_AUTO_SYNC=false` disables the runtime loop for a
  controlled diagnostic session. `EPIC_MARKETPLACE_CLOUD_POLL_INTERVAL_MS`
  is bounded between 5 seconds and 5 minutes; the default is 30 seconds.

An important integrity fix shipped with this loop: an unchanged remote order
no longer gets a new Desktop `sourceVersion` merely because it was polled.
Only a difference in cloud-owned fields (vendor, mapped state, order number,
payment state, customer, pickup or request snapshot) writes a new projection
revision. Local notes, preferences and links do not cause a cloud rewrite.

Source verification is automated by:

- `npm run test:marketplace-cloud-order-sync` — unchanged re-pulls write no
  projection revision; a real state change advances exactly one revision; a
  205-order response proves all three backend pages materialize.
- `npm run test:marketplace-cloud-auto-sync` — health persistence, bounded
  exponential backoff, recovery and disconnected-account safety.

**Live verification (2026-09-15):** after Docker/Postgres recovered, a fresh,
isolated Desktop SQLite workspace was started against the real local Fastify
backend on port 4500. Desktop authenticated the real seeded vendor through the
development OTP flow, the background scheduler discovered the newly connected
store, and `GET /api/marketplace/cloud/sync-health` reached `Healthy` after a
real authenticated `GET /vendor/orders`. That vendor had zero current orders,
so this run proves the scheduler/credential/health path without falsely
claiming a new order materialization; earlier §4b verification covers a real
order pull. The temporary SQLite database, its WAL and encrypted cloud token
were removed immediately after the check. No backend order or vendor fact was
changed.

## 5. What this does NOT do yet

- Does not call `select-shop`/`select-role` — an account linked to multiple
  vendors/roles connects with whatever default scope `verify-otp` grants.
  Real, scoped follow-up work, not a silent gap.
- **Orders and core catalogue, not settlement or capacity.** Orders flow both
  ways (pull, accept/reject, stage, recount); catalogue (§4i) now flows both
  ways for price/sale price/cost price/availability/stock/low-stock-
  threshold/max-order-qty. Settlement has no real backend data moving either
  direction from Desktop. Capacity/slots has no vendor-facing backend
  endpoint at all to move data through — confirmed live: every
  `vendor_slots` write route (`POST/PATCH/DELETE /admin/:id/slots`,
  `PUT /admin/:id/capacity`) lives under `vendors.routes.js`'s `/admin/*`
  prefix, platform-ADMIN-only. Not a Desktop gap to close — there is nothing
  on the real backend yet for a vendor to call.
- **Evidence upload is an EXTERNAL_BLOCKER locally.** The marketplace's upload
  endpoint is Cloudinary-backed (its only "fallback" is signed → unsigned
  Cloudinary, not a local store), so turning an operator's image file into a
  photo URL cannot be exercised without real provider credentials. Desktop
  therefore takes evidence URLs today; wiring a file picker through
  `POST /uploads/image` is real work that cannot be verified here.
- **The customer's decision is read back only on demand.** Resolving a recount
  requires reading that order's detail (`detail-sync`); the list endpoint
  carries no reconciliation record, so nothing resolves on its own until
  someone looks. With no background poll yet (above), a decided recount stays
  locally pending until it is next opened.
- **No real-time subscription yet.** A bounded, restart-safe REST poll now
  refreshes connected vendor orders automatically. Desktop has not yet joined
  the backend's Socket.IO channel, so fresh events can take up to the configured
  poll interval to appear; detail-only changes such as a customer recount still
  require their existing detail-sync path. Socket.IO adoption needs a separately
  verified Desktop token/event contract before it can replace the fallback.
- **UI covers connect + pull + accept/reject + stage progress + reconciliation
  + evidence + catalogue price/availability/stock** (§4d, §4h, §4i).
  Pickup/delivery *assignment* (rider-side, not vendor-side — §4h confirmed
  the vendor's own actionable surface stops at `PACKED`) and settlement
  surfaces are untouched by this work.
- Does not touch `edge-sync.ts`'s outbox/inbox at all. That machinery remains
  real, tested, and local-only until a decision is made about whether the
  backend should grow a matching sync protocol (a large, separate proposal)
  or whether Desktop should instead poll/react over ordinary REST + Socket.IO
  (the transport the backend already runs — confirmed mounted in
  `Lndry_backend/src/app.js`, not yet explored for Desktop's use).
