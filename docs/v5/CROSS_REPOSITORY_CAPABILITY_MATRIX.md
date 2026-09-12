# Cross-Repository Capability Matrix — V5.1

Built 2026-09-11 by reading the actual code of all four repositories (Explore
agents, one per repo, each instructed to distinguish "code exists" from "code is
wired/mounted/called at runtime"). Where a repo's own code/comments explicitly
state a limitation, that is quoted rather than paraphrased.

Full per-repo evidence (file:line citations) is preserved in this session's
transcript; this document is the synthesized, decision-relevant summary. It will
be regenerated (per mandate §120) after implementation work, not just written
once.

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
