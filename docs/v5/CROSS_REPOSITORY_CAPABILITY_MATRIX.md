# Cross-Repository Capability Matrix — V5.1

Built 2026-09-11 by reading the actual code of all four repositories (Explore
agents, one per repo, each instructed to distinguish "code exists" from "code is
wired/mounted/called at runtime"). Where a repo's own code/comments explicitly
state a limitation, that is quoted rather than paraphrased.

Full per-repo evidence (file:line citations) is preserved in this session's
transcript; this document is the synthesized, decision-relevant summary. It will
be regenerated (per mandate §120) after implementation work, not just written
once.

> **2026-09-15 correction / current implementation note.** The historical
> summary below accurately records the pre-connector audit, but is no longer
> the current Desktop state. Desktop now has a direct vendor-account connector
> to the real Fastify backend, real order pull, cloud-authoritative
> accept/reject/progress/reconciliation/catalogue paths, and a restart-safe
> per-store REST polling fallback with durable health/backoff state. The local
> edge outbox/inbox remains a distinct, unconnected envelope protocol; no
> document should describe the direct connector as an ACK transport. The full
> current boundary and remaining gaps are recorded in
> [ECOSYSTEM_CONVERGENCE_AUDIT_2026-09-15.md](ECOSYSTEM_CONVERGENCE_AUDIT_2026-09-15.md).

## 0. The single most important cross-repo finding

**Epic Laundry Desktop has a real, well-built local marketplace domain model —
and zero live network connection to the real LNDRY Cloud Backend.**

Desktop's `server/src/modules/marketplace/*` (availability, catalogue,
customer-links, customer-status, edge-sync outbox/inbox, order-truth, pickup,
provider-events, settlements, settlement-batches, settlement-statement,
notifications) is real, tested (7+ passing self-tests), and wired into local
`/api/marketplace/*` routes and into `LaundryOnlineOrders.tsx` /
`LaundrySyncStatus.tsx`. But:

- The only implementation of the sync transport interface (`SyncTransport` in
  `edge-sync.ts:26`) is `MarketplaceIntegrationSimulator`
  (`server/src/modules/marketplace/simulator.ts`), whose own header comment
  says: *"Development-only deterministic stand-in for the unavailable
  marketplace control plane... must never be treated as a live endpoint."*
- `relayMarketplaceOutbox` (`edge-sync.ts:94`), the function that would push
  queued events anywhere, is called only from `_selftest-*.ts` files — never
  from `api.ts` or `index.ts` in the production runtime path.
- Device enrollment for marketplace sync exists (`registerMarketplaceDevice`,
  ed25519 keypair) but the enrollment response itself is flagged
  `activation: 'EXTERNAL_MARKETPLACE_ACTIVATION_REQUIRED'` — an admitted stub.
- No code anywhere in Desktop's `server/src` contains a base URL, client, or
  outbound call aimed at an LNDRY backend host (verified by grep for
  `LNDRY_API|MARKETPLACE_API_URL|CLOUD_API` — zero hits). Real outbound calls
  that DO exist go to GST e-invoicing, a local WhatsApp bridge, an
  OpenAI-compatible endpoint, and configurable SMTP/SMS bridges — none of them
  LNDRY.

Meanwhile, Dashboard and Vendor App are both real, production-shaped clients of
the real `Lndry_backend` (see §2/§3) — they already do what Desktop's
marketplace layer only simulates.

**Implication for the mandate's dependency order (§114):** "CLOUD CONTRACT /
CONNECTOR FOUNDATION" is not a refinement step — it is close to a from-scratch
build. The good news is Desktop's local-side plumbing (idempotent outbox/inbox,
projections, audit trail) is already the right shape to plug a real transport
into; it does not need to be redesigned, only connected.

**Status: a real connector foundation now exists (2026-09-11)** — see
[CLOUD_EDGE_ARCHITECTURE.md](CLOUD_EDGE_ARCHITECTURE.md) for the full design
and verification write-up. Summary: rather than trying to retrofit Desktop's
invented outbox/inbox envelope protocol onto a backend that has no matching
concept, Desktop now authenticates directly against the real backend's actual
phone+OTP auth flow (the same one Vendor App uses) and can call its real REST
endpoints as a connected vendor account. Verified live against a real local
`Lndry_backend` instance, not just mocked: real OTP send, real OTP verify,
real session fetch, encrypted-at-rest token storage, and a clean disconnect —
all confirmed via `curl` against Desktop's new `/api/marketplace/cloud/*`
routes with the real backend running. This process caught a genuine contract
bug before it shipped: the real `/auth/session` response nests the profile
under `data.user`, not flat on `data` as first assumed from reading the route
file alone — the mocked self-test (written first) did not catch this because
it encoded the same wrong assumption; only calling the real backend did. Fixed
and both the client and the self-test's mock now reflect the real shape.

Not yet done, deliberately left as documented next steps rather than silently
skipped: multi-shop/multi-role account selection (`select-shop`/`select-role`)
is not wired; no real backend data is yet pulled into Desktop's existing local
marketplace projections (order-truth, catalogue, etc.) — this connector proves
the transport works, it does not yet make Desktop's local marketplace
simulation start reflecting real orders; and token-at-rest protection uses a
locally-generated machine-key file (AES-256-GCM) rather than Electron's
`safeStorage` API, because the Fastify server runs as a separate child process
from Electron's main process (confirmed by reading `desktop/main.js`) and no
IPC bridge exists yet to reach `safeStorage` from there — a real improvement
over plaintext, but explicitly flagged as an interim step, not the final one.

## 1. Repositories and their actual current HEAD (2026-09-11)

| Repo | Local path | origin/main HEAD | Local HEAD | Ahead/behind |
|---|---|---|---|---|
| Epic Laundry Desktop | `epic_crm_shotlin` | `b81daf0` | `61ddf6b` | +6 / 0 |
| LNDRY Backend | `Lndry_backend` | (at clone) | `e5f16dc` | +4 / 0 |
| LNDRY Dashboard | `Lndry_dashboard_frontend` | `3ad89c2...` | same (freshly cloned) | 0 / 0 |
| LNDRY Vendor App | `Lndry_vendor_app` | `fa837ea8...` | same (freshly cloned) | 0 / 0 |

## 2. LNDRY Dashboard (`Lndry_dashboard_frontend`) — real capabilities

Next.js app, one central typed axios client (`src/lib/api.ts`), real JWT +
cookie session, fine-grained permission-token RBAC (`src/lib/permissions.ts`)
with per-route guards and a client-side "viewer is read-only" enforcement layer
in the axios interceptor itself (defense in depth, though the real boundary
must still be the backend — see §79/§28 of the mandate).

**~35 of 36 dashboard pages are real** (fetch/mutate real backend data via
TanStack Query + service modules): dashboard overview, vendor applications
(review/approve/reject/correction, radius), vendors (detail, KYC docs, services
&amp; rates, employees, capacity/slots, Express Pickup toggle), orders (list,
manual create, detail), exceptions (a derived view over two real order
queries), customers (incl. block/unblock), customer segments, delivery
employees/riders, laundry categories, vendor-service approvals (with admin
price override), coupons, first-time-offers, cart-milestones, incomplete/
abandoned-order recovery, banners, support tickets, notification templates,
reports (PDF/Excel export), analytics, audit logs, admin employees/RBAC teams,
payments + refunds, review moderation, watermark settings, fee settings
(delivery fee mode, Express Pickup fee, advance payment, vendor commission),
payment method toggles, payment offers, tip presets.

**One confirmed stub:** `/admin-states` — a static UI-pattern reference page,
no data fetching. Not a real capability, just a design reference.

**Confirmed Priority-Zero gap, first-party admission from the frontend's own
code:** `src/app/(dashboard)/settings/platform/page.tsx`'s `VendorCommissionSection`
renders a visible badge reading **"Not applied to payouts yet"**, and the file's
own doc comment says the admin-configured commission is *"configured here, not
yet deducted automatically."* The value is genuinely persisted
(`feeSettingsService.update()` → `/api/v1/admin/fee-settings`), so this is a
real, saved setting that the dashboard's own authors flagged as disconnected
from settlement math — not a hypothetical from the mandate.

## 3. LNDRY Vendor App (`Lndry_vendor_app`) — real capabilities

Flutter app, one central `Dio` client (`lib/core/network/dio_client_provider.dart`)
with bearer-token injection + automatic 401 refresh, one real repository
(`api_vendor_repository.dart`, ~90 methods) selected unless a (currently
hard-coded-off) demo mode is enabled.

**Real, backend-wired:** OTP auth, vendor onboarding wizard (business/GST/PAN,
bank, real GPS-captured location via `geolocator`+`geocoding`, document
upload, submit/resubmit), dashboard stats, order queue + accept/reject/
processing/ready + reconciliation (with real camera capture via
`image_picker`), services &amp; garment pricing (incl. bulk rate upsert),
staff/employee CRUD, rider roster CRUD, rider job workflow end-to-end (start
pickup → doorstep measurement → real camera photos → OTP; start delivery →
COD collection → real camera photos → OTP → delivered), slots/hours/capacity,
analytics summary, notifications (incl. real FCM device-token registration),
profile edit/publish, support tickets (create/rate/follow-up).

**Confirmed stubs:** Inventory feature (pure hardcoded local list, zero API);
Settings page's push/sound/auto-accept toggles (local-only `setState`, never
persisted or read); "Partner Helpdesk"/"Terms"/"Privacy" tiles (SnackBar
placeholder, no real content); no dedicated Reviews screen (ratings only shown
read-only inside order details). Google Maps is a declared but unused
dependency (no map widget anywhere).

**Not present at all:** Express Pickup (no such feature/string anywhere in the
app). **No socket/realtime channel of any kind** — everything is pull/refresh-
based; the only push-adjacent thing is FCM device-token registration (no
`onMessage` handler found, so even incoming push display isn't confirmed
wired).

## 4. Epic Laundry Desktop (`epic_crm_shotlin`) — real capabilities

Real navigation groups (from `webapp/src/components/laundry/LaundryShell.tsx`,
not the orphaned `webapp/src/lib/nav.ts` — see §6 below): Home (dashboard,
statistics), Counter (new-order, orders, print-centre), Production (operations,
garment-tracking, production-queue, quality-claims, corrections, returns),
Pickup &amp; delivery (routes, dispatch, rider settlements), Finance &amp;
compliance (finance, statutory, cash-closing, expenses, settlements), Customer
programs (packages), Business controls (management, finance-setup,
online-orders, sync-status, reports, catalogue, imports, settings).

Local operational engine (garments/tags/bags, POS, cash shift, finance,
statutory, invoices, print) is mature — 36 SQLite migrations, oldest ones
(store scope, garment traceability, cash shift, financial paise journal) date
back well before the marketplace work (migrations 21-23, 35-36).

Marketplace bounded context — see §0. Real but disconnected from any live
backend.

**Confirmed gaps:**
- No photo-evidence domain at all. `deliveryOtp: false, proofOfDelivery: false`
  are explicitly declared unimplemented in `server/src/modules/laundry/domain.ts:1337-1338`,
  with a comment noting there's no push/WebSocket transport either. The only
  "media" that exists is static garment icon assets and base64 expense-receipt
  attachments (capped 1MB, stored inline in SQLite) — nothing resembling
  pickup/delivery/reconciliation proof photos.
- No Cloudinary/S3/multer/external-upload code anywhere.
- **Two unrelated local settlement systems** coexist: marketplace vendor-
  commission settlement (`marketplace/settlements.ts` — commission bps,
  platform-funded promos, payment fees, withholding, immutable statement,
  batches/payouts — all real and self-tested) vs. rider cash settlement
  (`laundry/domain.ts` rider-settlements — COD/pickup cash handed over by
  riders). A third, separate area (`finance/*`) handles general
  accounting/payroll/statutory (GST/ESI) and has zero code overlap with either
  settlement concept.
- Local auth is 100% local (scrypt password hash, server-side session tokens,
  4 roles: owner/counter_staff/processing_staff/rider). No cloud user identity.
  The only "device identity" is the marketplace enrollment stub from §0.

## 5. LNDRY Backend (`Lndry_backend`)

Fastify app, bootstrap in `src/app.js`. ~40 route prefixes are actually
registered and guarded (`fastify.authenticate`/`fastify.authorize`/Zod schemas)
— vendor onboarding, profile, catalogue, capacity/slots, online orders, order
status transitions, rider/delivery assignment, pickup/delivery evidence, OTP
verification, payments, refunds, coupons, support tickets, notifications are
all real and wired. A meaningful number of route files exist on disk but are
**never registered** — their `app.register(...)` call is commented out in
`app.js`: `cart`, `wallet`, `wishlist`, `shop-garment_rates`, `shop-orders`,
`shop-transactions`, `product-families`, `allocation`, `shop-finance`,
`bulk-orders`, `scheduled-orders`, and — critically — **`shop-financials`**
(app.js:404-410), which is the settlement/payout module.

### The Priority-Zero gap, traced end to end with file:line evidence

**Vendor commission is configured, persisted, and has correct calculation
code — but every path that would execute that calculation is disabled.**

1. Admin sets `vendors.commission_rate` via `PATCH /api/v1/shops/:id` — this
   route **is** live (`shops.routes.js`, mounted `app.js:277-279`) and really
   writes to the database (`shops.repository.js:286`).
2. `commission_rate` is **never read** anywhere in `orders`/`quotes` module
   code — confirmed by grep. So it plays no role in what a customer is quoted
   or charged.
3. The only code that turns `commission_rate` into money is
   `shop-financials/financial-formula.js:70-78` (`computeCommission`) and
   `shop-financials/settlement.service.js:322-360`
   (`SettlementService.settleShopForPeriod`, reads the rate live at line
   333-336, non-versioned — see below).
4. That code is **completely unreachable in the running app**:
   - `shop-financials.routes.js` registration is commented out
     (`app.js:404-410`).
   - `shop-transactions.routes.js` registration is commented out
     (`app.js:385-392`).
   - The settlement/payout cron and workers are commented out in
     `src/runtime/workers.js`: settlement processor import (lines 35-41),
     `startSettlementWorker` call (39-41, 64-67), `payout.worker.js`/
     `startPayoutWorker` (39-41, 67), `scheduleSettlementCron` invocation
     (93-100), `schedulePayoutCron` (102-109). `startWorkerRuntime()` only
     actually starts notification/order/SMS/theme workers plus two LNDRY-MVP
     jobs (vendor-auto-reject, slot-hold-expiry) — settlement/payout/
     allocation/scheduled-orders/report-precompute are all dark.
   - The one live-adjacent piece, `/api/v1/admin/finance` (mounted,
     app.js:421-426), only reports on the `shop_financials` table — a table
     nothing ever writes to, since the writer (`SettlementService`) never
     runs. So today this admin screen would show empty/stale data regardless
     of configured commission.
5. **Result: changing `commission_rate` today has zero observable effect on
   any settlement or payout amount**, because no live code path ever computes
   one.

**Additional, related gap (mandate §50):** even if this pipeline were
re-enabled as-is, it has no versioning. `settlement.service.js:333-336` reads
the vendor's **current** `commission_rate` at settlement time — there is no
per-order or effective-dated commission capture anywhere in
`src/database/migrations/`. A mid-cycle commission change would apply
retroactively to the whole settlement period rather than only to orders placed
after the change. (Customer-facing fees — delivery/platform/express/tax —
*are* correctly snapshotted into `orders.fee_breakdown` at placement time,
`orders.service.js:1377-1388,1737,1778`; commission is the one monetary input
that isn't.)

**Status: FIXED (2026-09-11), verified against a real local database, not
mocks.** See `docs/v5/FEES_COMMISSION_SETTLEMENT_ARCHITECTURE.md` for the full
write-up. Summary: re-enabled the `shop-financials`/`shop-transactions` route
registrations in `Lndry_backend/src/app.js` and the settlement/payout
worker+cron startup in `Lndry_backend/src/runtime/workers.js`. Before touching
anything, confirmed via `git log`/`git blame`-equivalent inspection (this repo
has only one squashed "Initial commit", so no history to blame) and by running
all 71 previously-archived settlement/payout tests unmodified against current
code (all pass) that this was dormant-but-correct code, not disabled-because-
broken code. Then verified live: started the real server + worker against a
freshly-migrated local Postgres/Redis (isolated dev ports 5434/6380, not the
colliding host defaults), confirmed both new routes respond `401` (auth-
guarded, not `404`/`500`), confirmed the worker log shows `Settlement worker
started` / `Payout worker started` / cron registered with no errors, then
created a real vendor (commission_rate=15%) and a real delivered order
(subtotal=₹1000, delivery_fee=₹50) and ran `SettlementService.settleShopForPeriod`
against them directly. Result, read back from the database: `platform_commission
= 150.00`, `net_revenue = 800.00`, `payout_amount = 800.00`, and four correct
per-order `shop_transactions` ledger entries (`ORDER_REVENUE` 1000,
`PLATFORM_COMMISSION` 150, `DELIVERY_FEE` 50, `RIDER_COST` 50). Fixtures were
cleaned up afterward; no test data left in the database. Zero regressions:
confirmed by running the full backend test suite with and without the fix
(via `git stash`) — the same 5 pre-existing, unrelated assertion failures (in
`manual-product-create.test.js`, `vendor-employees.service.spec.js`,
`lndry-endpoints.test.js`) occur identically either way.

Committed locally (`Lndry_backend` commit `1d55396`), **not pushed** — per
standing instruction, no remote writes without explicit authorization.

### 5a. `shop-garment_rates` mounted (2026-09-12) — same never-registered pattern, plus a real schema-drift bug this time

Continuing the same audit into catalogue/pricing/availability/capacity:
`shop-garment_rates` (vendor_services CRUD — list/get/create/update/delete,
adjust-stock, bulk-price-update, HQ approve/reject) was, like
`shop-financials`, fully built (~3,400 lines across repository/service/
controller/routes) but never registered in `app.js` since the initial
commit. Unlike `shop-financials`, this one was *also* genuinely broken, not
just disconnected: its repository still joined the pre-migration-062 table
names.

- `shop-garment_rates.repository.js`: 4 queries (`findMany` list + count,
  `findProductMetaById`, the stock-movements list) joined
  `garment_rates`/`categories` — renamed to `garment_types`/
  `service_categories` by migration 062, per the *other* prior partial fix
  (`Lndry_backend@67deee3`) which explicitly skipped this file because the
  module was unreachable at the time ("left as dead code rather than
  guessing at a fix for an unreachable path" — same principle applied here,
  now that the path is being made reachable). Also dropped one
  `p.thumbnail_url` reference (column doesn't exist post-migration; that
  commit's sibling fix elsewhere already established the `images->>0`
  replacement pattern).
- `manual-create.service.js`'s master-catalog `INSERT INTO garment_rates`
  was deeper than a rename: it wrote `description`/`price`/`sale_price` into
  columns that don't exist on `garment_types` at all — migration 062 also
  split pricing out to the per-vendor `vendor_services` row (inserted
  correctly, separately, three lines later in the same function). Fixed by
  dropping those three columns from the master-catalog insert; `description`
  stays accepted on the request body (unchanged contract) but has nowhere to
  persist today — not silently faked.
- All 3 fixes confirmed two ways: (a) ran the corrected SQL directly against
  the real local Postgres — the list query now returns the real seeded
  vendor's real priced services (13 real rows: "Small Carpet" ₹450, "Normal
  Curtain" ₹300, etc.) instead of erroring; (b) the module's own pre-existing
  test suite (108 unit + 11 "integration" tests, all mock-based) — 108
  already passed (they mock the DB, so never caught the stale names), the
  11 `manual-product-create.test.js` tests initially failed against the fix
  because the mock's own SQL-matching regexes were written against the same
  stale table names (a second instance of "the test encodes the bug" this
  session already hit with the cloud connector's refresh-token test) — fixed
  the mock's matchers to expect `garment_types`, all 11 now pass. One
  property-based test (`soft-delete-preservation.property.test.js`) had the
  identical issue in its fake-pg SQL matcher; fixed the same way. Full
  backend suite re-run: zero new failures (same 3 pre-existing, unrelated
  failures as the `git stash` baseline — `lndry-endpoints.test.js` ×2,
  `vendor-employees.service.spec.js` ×1).

**A second, larger blocker this surfaced — not fixed, and not guessable:**
even correctly mounted, `shop-garment_rates`' route guards (`canRead`/
`canWrite` in `shop-garment_rates.routes.js`) check
`shopRole ∈ {SHOP_ADMIN, SHOP_MANAGER, SHOP_STAFF, SHOP_VIEWER}` — a role
vocabulary that turns out to not exist anywhere in the live system.
`vendor_employees.role` carries a live Postgres `CHECK` constraint
permitting only `VENDOR_OWNER` / `VENDOR_STAFF` / `VENDOR_RIDER`, and the
real login/refresh-token flow only ever populates the JWT's `shopRole` claim
from that column — so `SHOP_ADMIN` etc. can never appear on a real token.
Confirmed live: the real seeded vendor owner (`shopRole: VENDOR_OWNER`) gets
`403 FORBIDDEN` from every `shop-garment_rates` route; a token crafted with
`shopRole: SHOP_ADMIN` (matching what the guard and the module's own
integration tests both expect via `signTestToken`) passes and returns real
data, proving the SQL/route-logic fix is otherwise complete and correct.

**This is the same blocker `shop-financials` has** (see the correction added
to `docs/v5/FEES_COMMISSION_SETTLEMENT_ARCHITECTURE.md` §5a) — its guard
also checks `SHOP_ADMIN | SHOP_MANAGER`. **`shop-transactions` does not**
(`VENDOR_OWNER | VENDOR_STAFF` — the real vocabulary — confirmed live with a
real `200`). So of the three "Shop *" modules mounted across this session,
one works for real accounts today (`shop-transactions`), two do not
(`shop-financials`, `shop-garment_rates`) — not because anything is broken,
but because an entire `SHOP_ADMIN`/`SHOP_MANAGER`/`SHOP_STAFF`/`SHOP_VIEWER`
+ `CANONICAL_PERMISSIONS` authorization layer (referenced throughout these
modules' comments as "design §4.1/§4.5", "R16-R23") was designed and coded
against, but never actually activated — the real system that shipped uses
the simpler 3-role `VENDOR_OWNER`/`VENDOR_STAFF`/`VENDOR_RIDER` vocabulary
with (for the one real seeded account checked) an empty `permissions` JSONB
array.

Resolving this for real needs one of two deliberate, mutually-exclusive
product/architecture decisions this session does not have standing to make
unilaterally: (a) actually activate the `SHOP_*` role system — extend the
`vendor_employees.role` CHECK constraint, decide who assigns these roles and
how, and backfill/seed real accounts with them; or (b) rewrite the
`shop-financials`/`shop-garment_rates` guards to check the real
`VENDOR_OWNER`/`VENDOR_STAFF`/`VENDOR_RIDER` vocabulary instead, the way
`shop-transactions` already correctly does (the smaller, more surgical
option, but changes who these modules consider "Shop Manager"-equivalent —
a real access-control decision, not a mechanical rename). Routes are left
mounted (they fail safely closed — `403`, never a crash or a bypass — for
every real account today, exactly like the HQ approve/reject routes already
mounted behind `MULTI_VENDOR_PRODUCT_APPROVAL=false`), correct, tested, and
ready for whichever direction is chosen.

Committed locally (`Lndry_backend`, uncommitted as of this writing — commit
pending alongside this doc update), **not pushed**.

**Resolved (2026-09-12) — option (b) chosen.** Rewrote the `canRead`/
`canWrite` guards in `shop-garment_rates.routes.js` and the `canRead` guard
in `shop-financials.routes.js` (plus their service-layer defence-in-depth
duplicates: `ShopProductsService.authorizeMutation`,
`ShopFinancialsService.authorizeRead`, and the `_notifyShopStaff` fan-out
query) to check the real `VENDOR_OWNER`/`VENDOR_STAFF` vocabulary instead —
matching what `shop-transactions.routes.js` already did correctly. Mapping:
`shop-garment_rates` allows `VENDOR_OWNER` and `VENDOR_STAFF` for both read
and write (no real-vocabulary equivalent of a view-only tier exists);
`shop-financials` allows `VENDOR_OWNER` only, preserving the original
documented intent that financial visibility is narrower than general shop
access. Verified live: the real seeded vendor owner (`shopRole: VENDOR_OWNER`,
no crafted claims) now gets real `200`s from both endpoints, and a `PATCH`
price update round-trips correctly; a real `VENDOR_STAFF` account gets the
catalogue endpoint but correctly still `403`s on financials. Full backend
suite re-run after fixing the ~19 tests whose mocks encoded the old
vocabulary: zero new failures (same 3 pre-existing, unrelated baseline
failures). Committed locally, not pushed.

**Still open, deliberately not touched by this fix:** the *nested*
`shop-garment_rates` routes (`adjust-stock`, `bulk-price-update`, `manual`
product creation, the stock-movements list, HQ approve/reject) are gated by
a structurally different mechanism — `requirePermission('vendor_services.*')`,
which reads `request.user.permissions` hydrated from the
`vendor_employees.permissions` JSONB column. The real seeded vendor owner's
row has `permissions: []`, and `permission-check.js` has no role-based
fallback (empty array → zero permissions, by design). This is the same
"designed, never activated" category of gap, but it's an empty-data problem
rather than a vocabulary mismatch, and it's wide — the same mechanism also
gates `shop-orders`, `shop-reports`, `vendor-employees` (staff management
itself), several `admin/*` modules, `coupons`, and `audit-logs`. Tracked as
a separate, future item; not bundled into this fix.

### 5b. Full cross-repository E2E lifecycle test (2026-09-12)

A real order driven end to end — real customer checkout through
`quotes`/`slot-holds`/`orders/prepare`/`orders`, real Desktop pull/accept/
processing through the cloud connector (§4d–§4h), real admin rider
assignment and real rider delivery, real settlement run — caught two
further real bugs, both fixed: `orders.delivered_at` was never set by the
real rider-delivery confirmation path (so settlement would silently never
see a real delivered order), and the settlement service's per-order ledger
writes had no protection against a retried/re-run settlement job silently
duplicating every order's ledger entries (reproduced live: two runs left
the correct total in `shop_financials` but double the rows in
`shop_transactions`). Full write-up, evidence, and verification steps in
`docs/v5/CROSS_REPOSITORY_E2E_LIFECYCLE_TEST.md`.

### 5c. Desktop catalogue UI, built on §5a's fix (2026-09-13)

Vendor Business convergence, Phase 2 of the V5.1 5-phase plan: a Desktop
module + webapp page (`cloud-catalogue.ts`,
`LaundryMarketplaceCatalogue.tsx`) giving a real vendor a real view of their
marketplace catalogue and the ability to edit price/sale price/cost price/
low-stock threshold/max order qty/availability/stock — built directly on
§5a's role-vocabulary fix, which is what made `shop-garment_rates` reachable
by a real `VENDOR_OWNER`/`VENDOR_STAFF` account in the first place.

Caught three more real bugs in the same live-verification pass (full detail
in `docs/v5/CLOUD_EDGE_ARCHITECTURE.md` §4i): `connectCloudSession` never
refreshed the connector's access token immediately after `verify-otp`, so a
freshly connected session could 403 on every shopRole-gated route for its
first ~15 minutes (the real `verify-otp` response carries no `shopRole`
claim — only `refresh-token`'s response does); a `null`→`0` coercion trap
in a locally-duplicated `num()` helper that would have silently faked a
"₹0 sale price" for services with none configured (and the identical bug,
pre-existing, flagged separately for `cloud-order-progress.ts`, not fixed
here); and the stock-update endpoint's response being shaped differently
(`{ shopProduct, prev }`) from every other `PATCH` in the module.

"Capacity" (vendor_slots) is explicitly out of scope, confirmed live rather
than assumed: every write route for it is platform-ADMIN-only
(`vendors.routes.js`'s `/admin/*` prefix) — there is no vendor-facing
backend endpoint to build a Desktop UI against yet.

### 5d. Platform Control — real platform-admin login, capacity, and vendor application review (2026-09-13)

Phase 3 of the V5.1 5-phase plan. Initial premise going in — that
`admin/auth/auth.routes.js` was dead, never-mounted code, the same pattern as
§5a/§5c — was WRONG and corrected during execution, not silently revised:
trying to mount it a second time in `app.js` hit a real
`FST_ERR_DUPLICATED_ROUTE` for `POST /api/v1/admin/auth/login`, proving it
was already registered one level deeper (nested inside
`admin/admin.routes.js` via `fastify.register(adminAuthRoutes, { prefix:
'/auth' })`). No backend route-mounting change was needed. The real, much
narrower gap: zero `users` rows had `platform_role` set, so nobody could
actually log in. Seeded one real test admin (`role='ADMIN'` AND
`platform_role='ADMIN'` — both are required; the token's `role` claim comes
straight from the legacy `users.role` column, not derived from
`platform_role`, so the older `fastify.authorize(['ADMIN'])` guards and the
newer `platform_role`-aware ones both need it set).

Confirmed live end-to-end: real login → real signed JWT with a populated
37-string `permissions` array (`HQ_ROLE_PERMISSIONS['ADMIN']` — unlike
`vendor_employees.permissions`, which is empty by design, see §5a); real
`GET /vendors/admin/list` and `GET/PUT /vendors/admin/:id/capacity`; a real
`VENDOR_OWNER` token gets `403` from all of them.

Built Desktop's side as a THIRD independent connected identity
(`server/src/modules/marketplace/platform-session.ts`), alongside the local
operator login and the vendor phone+OTP connector (§5c) — same
`EPIC_MARKETPLACE_CLOUD_API_URL` backend base, just a different auth surface
on it, no new config needed. Unlike the vendor connector, this login issues
no refresh token (confirmed live — the Dashboard relies on httpOnly cookies
for renewal instead, which doesn't apply here); accepted for v1 as a 24h
token with a plain re-login on expiry, since platform-admin usage is
occasional, not the always-on vendor-connector pattern. `cloud-client.ts`'s
internal `callCloud` request/error-shape helper was exported (no behavior
change — confirmed via the full `marketplace-cloud-*` self-test suite,
unaffected) so this second identity could reuse it without duplicating
retry-free request handling.

New webapp page `LaundryPlatformControl.tsx` (nav entry gated by
`settings.manage`, same tier as the vendor connector's own connect/
disconnect and Marketplace Sync — the real security boundary is the
backend's own ADMIN-only route authorization, not this local gate) — a sign-
in form, then a real vendor directory and a real capacity view/edit panel.
Live editing caught one more real API shape mismatch: `GET .../capacity`
returns the value as `daily_limit`, while `PUT .../capacity`'s body field for
the same value is `max_orders_per_day` — a real, backend-side asymmetry
(confirmed by reading `vendors.service.js`), not a mistake to paper over.

Security, all confirmed live: a Desktop operator role without
`settings.manage` (tested with a real `processing_staff` account) sees no
nav entry, is blocked client-side by `PermissionGate`, AND gets a real `403`
from the server on every `/api/platform/*` route — three independent layers,
not just hidden navigation. A disconnected (or never-connected) tenant gets
`409 PLATFORM_NOT_CONNECTED` from the vendor/capacity routes rather than any
data. The one live edit made during verification (a real vendor's
`operating_hours.max_orders_per_day`, set to 75 to prove the round-trip) was
reverted directly in Postgres back to its original unset state afterward.

**Second Phase 3 slice: cloud-authoritative vendor application review.** The
same Platform Control session now proxies the existing backend review
workflow without recreating an approval state in SQLite:
`GET /vendors/admin/list?status=&search=&city=&page=&limit=`, `GET
/vendors/admin/:id`, and `POST /vendors/admin/:id/review`. The Desktop
route schemas preserve the backend's real camel-case payload (`status`,
`approvedRadius`, `approvedDailyCapacity`, `rejectionReason`,
`correctionSections`, and future `documentReviews`) and reject malformed
states before a cloud call. The UI is a filterable review queue and a
right-side application drawer with four real decisions:
Approve, Request correction, Reject, and Suspend. Approval presents the
radius/capacity decision explicitly; reject/correction requires a human
reason; correction sections are constrained to the backend's supported
business/owner-bank/location/radius/documents vocabulary.

Live verification created one isolated DRAFT application plus isolated
owner in Postgres, opened it from the actual built Desktop UI, approved it
with an approved radius of 12 km and capacity of 48, and confirmed the
backend promoted it to an `APPROVED`, active vendor with a `VENDOR_OWNER`
employee record. The temporary application, vendor, employee record, and
owner were then deleted in one cleanup transaction; a direct post-cleanup
query returned zero of each. Separately, an actual existing VENDOR_OWNER
obtained a real token through the development OTP path and received `403`
from `/vendors/admin/list`. `test:marketplace-platform-control` covers the
not-connected fail-closed path, filter forwarding, detail metadata, exact
review-body forwarding, and the local `settings.manage` guard.

**Document-review decision, evidence based.** The live database had zero
vendor-application documents. More importantly, the backend masks each
document URL behind a remote internal preview path, while Desktop has no
token-safe binary-document proxy or rendered preview surface yet. The
drawer therefore shows real document metadata/status but intentionally does
not expose a pretend per-document approve/reject button that an operator
could use without reviewing its contents. The proxy type can carry
`documentReviews` when that later slice adds the secure preview transport;
until then this is an explicit security/usability deferment, not a missing
state disguised as KYC completion.

**Vendor-review data minimization recovery.** The detailed vendor endpoint
returns the backend's complete application row, including sensitive account,
tax-identifier and document-location fields. A Desktop reviewer needs to
know only whether the required bank and tax evidence was supplied, not the
account number, IFSC, bank name, account holder, GSTIN, PAN or private
document URL. The connected Desktop proxy now strips all of those fields on
both application reads and review-write responses, replacing them with
`bank_details_recorded` and per-identifier presence signals. Document type,
status and rejection reason remain available for a real review decision. The
platform service remains the only system holding the raw record. The
contract self-test asserts the prohibited fields cannot cross the edge; a
live proxy check against the running backend confirmed the same response
shape. Secure per-document viewing remains explicitly deferred until a
token-safe binary preview transport exists.

**Website partner-intake bridge.** A website form is now a deliberately
separate input channel, not a shortcut around vendor approval. The website
first persists a validated marketing lead in Supabase and then sends a
server-only, HMAC-signed, idempotent handoff to the canonical backend's
`partner_leads` staging table. Platform Control exposes only a compact
`RECEIVED` queue and a real `CLAIMED` follow-up action; it cannot create a
vendor, user, marketplace session, KYC decision, or onboarding application.
The Desktop edge strips email, phone, address and free-form messages before
the card is rendered, leaving business/contact-name, location, services and
workflow context. Live verification created a disposable signed lead against
the current Postgres-backed backend, read and claimed it through the actual
Desktop platform session, confirmed `CLAIMED` in Postgres, and removed the
test record plus its test audit evidence afterward. Production activation
still requires applying the website Supabase migration and configuring the
same server-only HMAC secret in both deployed services; neither secret nor a
fake success state exists in Desktop.

**Recovery applied: pending-application suspension.** Final audit found the
controller and service already accepted `SUSPENDED`, while the original
`vendor_applications` check constraint omitted it. Backend migration
`098_vendor_application_suspension.sql` replaces that constraint without
rewriting history. It was run against the live Postgres database, then an
isolated DRAFT application was suspended through the real backend and again
through the built Desktop drawer; both round-tripped as `SUSPENDED` and all
temporary rows were removed afterwards. Suspend is now a real option for a
pending application, not a deceptive control.

**Third Phase 3 slice: safe marketplace-order oversight.** An audit of the
real backend found that its canonical vendor/rider lifecycle is represented
by `utils/state-machine.js` and the `vendor-orders`/delivery surfaces
(`WAITING_VENDOR_CONFIRMATION → VENDOR_ACCEPTED → pickup → processing →
PACKED → delivery → DELIVERED`), while older `/admin/orders` *write* routes
still expose a shorter, incompatible progression. This is a `BUG`, not a
licence for Desktop to choose one silently. Desktop therefore adds only
connected-session, ADMIN-gated read proxies for `GET /admin/orders` and
`GET /admin/orders/:id`, rendered by `LaundryPlatformOrders.tsx` as a
filterable, paginated cloud monitor and a right-side detail/timeline drawer.
It deliberately has no status, rider, payment, OTP, or bulk-action write
control. The UI says why: vendors/riders remain the operational source until
the backend's legacy admin writer is converged with the canonical lifecycle.
The contract test verifies exact filter forwarding, detail/timeline access,
not-connected fail-closed behavior, and that a local counter role receives
403 for the monitor as well as vendor review.

**Lifecycle recovery guard.** The audit also found that the two historical
admin-order write families (`/admin/orders/*` and `/orders/admin/*`) were
still mounted and could bypass that canonical path. Backend commit
`1a50e7a` now returns explicit `409
ORDER_LIFECYCLE_CONVERGENCE_REQUIRED` for every legacy admin order mutation
(manual create, status, rider assignment, cancellation, refund and their
bulk forms) after normal authentication/authorization. Their read/export
surfaces remain available. This is an intentional fail-closed recovery,
not a completed replacement: canonical platform-admin overrides must be
implemented on the state machine with reason, step-up approval, event audit,
OTP/payment preconditions and idempotency before any write control returns.
Live verification used a real ADMIN token against the running backend and
confirmed the manual-order route returns that 409; the complete backend
suite then passed 874/874 tests.

**Settlement/payout evidence recovery.** The subsequent Platform Control
settlement audit found two separate unsafe success paths in the real backend:
the Payout Worker supplied a deterministic `INTERNAL-<financial-id>` value
when no bank provider adapter was configured, and the legacy
`POST /admin/finance/vendors/:shopId/payouts/:periodId/mark-paid` shortcut
could put a period into `PAID` without any external payment evidence. Neither
is an actual bank disbursement. Backend recovery makes both fail closed:
providerless, bank-ready rows now become `HELD` with
`payout provider not configured`, retaining `payout_ref = NULL` and
`attempt_count = 0`; the manual route returns `409
PAYOUT_PROVIDER_EVIDENCE_REQUIRED` without querying or mutating its period.
The normal injected-provider path remains the only path to `PAID` and must
return a real external reference. Live verification used an isolated real
Postgres `shop_financials` row with temporarily restored bank fields,
confirmed `HELD`/no reference/no attempt burn, then deleted both that row and
its audit record (post-cleanup counts: zero). A real platform-admin API call
also returned the new 409. This is a safety recovery, not a payment-provider
integration: real bank disbursement remains `EXTERNAL_BLOCKER` until a
provider adapter, credentials, webhook/reconciliation evidence, and operator
workflow are introduced.

**Platform audit evidence monitor.** A later Phase 3 audit found an already
mounted, permission-enforced cloud contract that was appropriate to expose:
`GET /api/v1/admin/audit-logs`. It is append-only, paginated (maximum 100),
filterable by actor, target, action and time window, and requires the real
`audit_logs.view` permission. Desktop now proxies it through
`GET /api/platform/audit-logs` using the separate encrypted platform-admin
session and renders `LaundryPlatformAudit.tsx` as a read-only evidence
monitor. No cloud audit row is cached, edited, deleted, or emitted by Desktop; the
right-side event drawer only reveals the backend-provided before/after values
and deliberately omits IP address and user-agent fields from the operator
surface. The local `settings.manage` gate and self-test reject a counter role
with 403; the cloud still independently authorizes the stored ADMIN bearer.
Live verification used the production web build with a fresh isolated local
session against the real backend: the route listed live entries and opened a
cloud-event evidence drawer. This creates a useful audit *reader*, not a
second audit authority.

**Platform finance oversight and bank-data minimization.** The real cloud
admin-finance reader now feeds Desktop's read-only
`/laundry/platform-finance` workspace through three independently
permission-gated edge routes: vendor settlement readiness, a selected
vendor's financial periods, and its ledger transactions. Desktop is not
allowed to release a payout, mark it paid, edit a bank profile, or export a
new payout file. The only bank signal available to the UI is
`payout_bank_ready`; a targeted backend recovery removed the previously
returned account number, IFSC, bank name, and holder name from the general
HQ finance vendor directory. This protects the finance view from becoming a
bulk bank-data disclosure surface while still explaining why a payout cannot
be ready. The route is locally gated by `settings.manage` and independently
requires the cloud's `finance.global_view` authorization. The provider
evidence requirement remains `EXTERNAL_BLOCKER`; a held period is therefore
shown as a real exception, never as a payment that Desktop can override.

Explicitly deferred to later Phase 3 slices, not dropped: the remaining
Platform Control domains (commissions/fees/settlements, promotions, approvals, support,
exceptions, analytics, configuration, audit) and the Vendor Business
workspace's own expansion (riders, staff, vendor-facing evidence/photos,
finance, settlements, ratings, support, performance analytics — several may
turn out to have no real vendor-facing endpoint yet either, to be confirmed
live per domain); store-scoped-user restriction, deferred until a domain
that actually needs store-level (not just vendor-level) granularity exists.

## 6. Incidental finding worth separate handling

`webapp/src/lib/nav.ts` in Desktop defines an entirely different, generic-ERP
nav structure (`/pos`, `/crm`, `/inventory`, `/gst`, `/hr` — none of which exist
as real routes in `App.tsx`). It is dead/orphaned, but it is not harmless: it's
still consumed by `CommandPalette.tsx`, meaning the command palette's search
index currently contains broken links to routes that don't exist. `Rail.tsx`
and `SubSidebar.tsx` also import it but are never mounted. This is exactly the
"dead UI" the mandate's §75 prohibits and should be fixed (delete the dead nav
config, or fix the command palette's index) — tracked separately, not blocking
the main convergence work.
