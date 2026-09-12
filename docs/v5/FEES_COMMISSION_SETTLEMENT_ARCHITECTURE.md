# Fees, Commission & Settlement Architecture — V5.1

Written 2026-09-11. Covers `Lndry_backend` (the canonical financial authority
for marketplace commission/settlement) and how Epic Desktop's local marketplace
settlement (a different, local concept — see
[CROSS_REPOSITORY_CAPABILITY_MATRIX.md](CROSS_REPOSITORY_CAPABILITY_MATRIX.md)
§4) relates to it.

## 1. The gap this document is about

Mandate §48-49 flagged, as a known risk to reverify: vendor commission could be
configured administratively while never actually driving settlement math. This
was re-verified from scratch (not assumed) by reading `Lndry_backend`'s actual
code, and the risk was confirmed real — with much more precision than "might be
a problem": every entry point into the correctly-written commission/settlement
calculation was commented out.

## 2. What was actually wrong (before this fix)

- `vendors.commission_rate` (`src/database/migrations/029_shops.sql`) is
  configured via `PATCH /api/v1/shops/:id` (admin-only) and really persists.
- The only code that turns it into money —
  `src/modules/shop-financials/financial-formula.js` (`computeCommission`) and
  `src/modules/shop-financials/settlement.service.js`
  (`SettlementService.settleShopForPeriod`) — was **unreachable**:
  - `shop-financials.routes.js` registration was commented out in `src/app.js`.
  - `shop-transactions.routes.js` registration was commented out in `src/app.js`.
  - The settlement/payout worker imports, `startSettlementWorker`/
    `startPayoutWorker` calls, and `scheduleSettlementCron`/`schedulePayoutCron`
    invocations were all commented out in `src/runtime/workers.js`.
  - The one adjacent route that *was* live, `/api/v1/admin/finance`, only
    reports on the `shop_financials` table — which nothing ever wrote to,
    since its writer (the settlement worker) never ran.
- Net effect: changing a vendor's commission rate had **zero observable
  effect** on any real number anywhere in the system.

## 3. Why this was safe to fix (not "why it was probably fine to leave off")

Before touching financial code, the following was verified:

1. **This repo's git history is a single squashed "Initial commit"** — there is
   no commit history or blame trail explaining *why* these were disabled, so
   "it's disabled for a good reason I can't see" could not be ruled out by
   history alone.
2. **The disabling pattern is a staged-rollout pattern, not a kill-switch.**
   The surrounding comments reference specific task numbers ("task 8.8", "task
   8.9", "task 10.2 — comes online in 10.2", "R22", "R23.10") consistent with a
   phased build where later-numbered work is built ahead of its activation
   point. Nothing in the comments says "broken", "do not enable", "pending
   legal", or similar.
3. **The module itself is not in `archived_modules/`** (that directory holds
   genuinely retired modules — `cart`, `wallet`, `wishlist`, `bulk-orders`,
   `scheduled-orders`, `product-families`, `shop-finance` (singular — a
   different, actually-archived module)). `shop-financials` (plural) and
   `shop-transactions` were never archived, only left unregistered.
4. **All 71 tests that specifically cover this code
   (`settlement.service.test.js`, `settlement.worker.test.js`,
   `payout.worker.test.js`, `settlement-aggregation.property.test.js` — found
   sitting in `archived_tests/`, excluded from the vitest `include` glob, which
   is why they weren't running) pass unmodified against current code.** They
   had been moved out of the active suite at a different relative depth than
   their `../../../src/...` imports assumed, which is *why* they were
   effectively disabled as tests (a mechanical side-effect of a file move, not
   a judgment that they were wrong).
5. Only after 1-4 did the actual fix happen: uncomment 4 route/worker
   registration blocks, move the 4 test files back into `tests/` at the
   correct relative depth (`git mv`, so the file history is preserved), rerun
   everything.

## 4. Verification performed (see the capability matrix's Priority-Zero entry
for the full log)

- Static: all 71 restored tests pass; full backend suite shows zero new
  failures (confirmed via `git stash` A/B comparison); `eslint src/` clean.
- Dynamic: real local Postgres/Redis (isolated dev ports, migrations applied
  cleanly — 101 migrations including `shop_financials`, `shop_transactions`),
  real server + real worker process both boot cleanly, new routes respond
  `401` (not `404`/`500`, i.e., genuinely registered and guarded), worker log
  confirms `Settlement worker started` / `Payout worker started` / both crons
  registered.
- Financial correctness: a disposable vendor (commission_rate 15%) and a
  disposable delivered order (subtotal ₹1000, delivery_fee ₹50) were inserted,
  `SettlementService.settleShopForPeriod` was run against them for real, and
  the resulting `shop_financials` row and `shop_transactions` ledger entries
  were read back and asserted: `platform_commission = 150.00`,
  `net_revenue = 800.00`, `payout_amount = 800.00`, plus four correctly-valued
  ledger rows (`ORDER_REVENUE` 1000, `PLATFORM_COMMISSION` 150,
  `DELIVERY_FEE` 50, `RIDER_COST` 50). All fixtures were deleted afterward.

## 5. What is committed vs. deployed

Committed **locally only**, `Lndry_backend` commit `1d55396`
("fix: wire vendor commission into settlement/payout (was fully dead code)").
**Not pushed.** Turning this on in a real production deployment means real
vendor payouts start accruing based on real commission configuration — that is
a business/ops decision (does finance want this live now? has anyone told
vendors their commission is about to start being deducted?), not just a code
correctness question, so it is deliberately left for the repo owner to push
and deploy on their own timeline, not something this session does
unilaterally.

## 5a. Correction (2026-09-12): "responds 401" was not the same as "a real vendor can use it"

§4's verification confirmed the routes are genuinely registered and
auth-guarded (`401`, not `404`) and confirmed the settlement math is correct
by calling `SettlementService.settleShopForPeriod` **directly** — bypassing
the HTTP route entirely, so its own `preHandler` guard was never actually
exercised. Neither check tried the route as an authenticated real vendor
owner, which is the gap that follow-on work on `shop-garment_rates` (same
session, next slice) surfaced: `shop-financials.routes.js`'s guard checks
`shopRole === 'SHOP_ADMIN' || shopRole === 'SHOP_MANAGER'` — a role
vocabulary that **no real account can ever hold**. `vendor_employees.role`
has a live DB `CHECK` constraint permitting only `VENDOR_OWNER`,
`VENDOR_STAFF`, `VENDOR_RIDER` (confirmed directly against Postgres), and
the login/refresh-token flow only ever populates the JWT's `shopRole` claim
from that column. Confirmed live: the real seeded vendor owner
(`shopRole: VENDOR_OWNER`) gets `403 FORBIDDEN — Shop Admin, Shop Manager,
or Super Admin access required` from `GET /api/v1/shop-financials/`; a
token crafted with `shopRole: 'SHOP_ADMIN'` (matching what the module's own
guard expects, and what its route-level JSDoc describes) gets through.

**`shop-transactions` does not have this problem** — its guard
(`shop-transactions.routes.js:38-40`) checks
`shopRole === 'VENDOR_OWNER' || shopRole === 'VENDOR_STAFF'`, the real
vocabulary, and was confirmed live in this same follow-up pass: the real
vendor owner gets a real `200` with a real (empty, since none exist yet)
transaction list.

**Net effect on this document's "FIXED" claim**: the settlement/payout
*computation and worker pipeline* is genuinely fixed and correct — that part
of §4's verification stands. What is NOT yet true is "a vendor can log into
anything and see their own settlement/payout data through
`/api/v1/shop-financials`" — no account can, today, regardless of this
fix, because of this separate, pre-existing role-vocabulary gap. This is
not something to patch by guessing (e.g., loosening the guard to accept
`VENDOR_OWNER` too) — see
`docs/v5/CROSS_REPOSITORY_CAPABILITY_MATRIX.md` §5 for the full write-up
of why this spans more than one module and needs a deliberate decision
about which role vocabulary the multi-vendor permission layer actually
uses, not a one-file fix.

**Resolved (2026-09-12).** Rewrote `shop-financials.routes.js`'s `canRead`
guard (and its service-layer duplicate, `ShopFinancialsService
.authorizeRead`) to check `shopRole === 'VENDOR_OWNER'` instead of
`SHOP_ADMIN | SHOP_MANAGER` — owner-only, not owner+staff, preserving the
original documented intent that financial visibility is narrower than
general shop access (`VENDOR_STAFF` is the only non-owner role in the real
vocabulary, so excluding it here is the equivalent of the original "NOT
SHOP_STAFF or SHOP_VIEWER"). Verified live: the real seeded vendor owner
(no crafted claims) now gets a real `200` from `GET /api/v1/shop-financials/`.
Full write-up (mapping rationale, service-layer defence-in-depth fix,
`shop-garment_rates`'s twin fix, and test updates) in
`docs/v5/CROSS_REPOSITORY_CAPABILITY_MATRIX.md` §5a.

## 6. A related, smaller design note — commission effective-dating

Mandate §50 asks for immutable per-order policy snapshots so historical orders
are explainable under the policy that existed when they were placed. Customer-
facing fees (delivery/platform/express fee/tax) already work this way —
`orders.service.js` snapshots the full `fee_breakdown` into the `orders` row at
placement time, so a later admin change to fee config never retroactively
changes an already-placed order. **Commission does not have this**: settlement
reads the vendor's *current* `commission_rate` at the moment the nightly
settlement job runs for a given day (`settlement.service.js:333-336`).

In practice this risk is smaller than it first sounds, because of how
settlement is structured, not because of any change made in this session:

- Settlement runs **daily** (cron `0 2 * * *` UTC), one calendar day at a time.
  A commission change is only "live" for whichever day(s) it's in effect when
  that day's 02:00 UTC job runs — not for an entire week/month.
- **Weekly and monthly settlements do not re-read the live rate at all** —
  `runWeeklySettlement`/`runMonthlySettlement` sum the already-computed *daily*
  `shop_financials` rows (`sumDailyRows`), each of which already has its
  `platform_commission` baked in from whatever rate was in effect on that
  specific day. So a mid-month commission change cannot retroactively alter
  commission already booked for earlier days in that month — only the
  Priority-Zero fix in this document changes whether commission is booked at
  all, not this behavior.
- The realistic exposure is: if commission changes *during* the same UTC day a
  delivered order is aggregated (before the 02:00 UTC run for that day), that
  whole day's settlement for that vendor uses the new rate for every order in
  the day, not the rate at each order's own delivery time. This is a real gap
  relative to a strict per-order snapshot model, but it is a same-day window,
  not the settlement-period-wide retroactive risk the mandate's wording
  implies.

**This was left as-is rather than "fixed" further in this session**, because
closing it properly would mean adding a new migration (a per-order or
effective-dated commission column) plus changes to both
`orders.service.js`(capture) and `settlement.service.js` (prefer the capture
over the live lookup) — a materially larger, separate change from "the
calculation that already exists correctly is disconnected," which was the
actual Priority-Zero defect. Recorded here as a real, scoped, deferred
improvement rather than silently left unmentioned.

## 7. Desktop's separate, unrelated settlement concept

Epic Desktop's `server/src/modules/marketplace/settlements.ts` computes its own
commission/settlement entirely locally, against its own simulated marketplace
data — it has no connection to `Lndry_backend` at all (see capability matrix
§0). Fixing `Lndry_backend`'s wiring does not change Desktop's behavior; the
two will only become one financial truth once Desktop has a real network
connection to `Lndry_backend` (mandate's "cloud contract/connector foundation"
step, not yet built — see capability matrix §0 for what exists today).
