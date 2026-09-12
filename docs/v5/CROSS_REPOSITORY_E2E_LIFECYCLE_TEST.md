# Cross-Repository End-to-End Lifecycle Test — V5.1

A single real order driven through every stage — real customer checkout,
real vendor acceptance and processing through Desktop's cloud connector,
real rider delivery, real settlement — against the real `Lndry_backend` +
Postgres + Redis, not mocks and not directly-seeded shortcuts (the one prior
exception this session always took to get orders onto Desktop's queue
quickly). This is the first time this session an order reached Desktop by
actually being placed through the real customer-facing checkout API, rather
than being inserted directly into Postgres.

## 1. The chain, in order

1. **Customer checkout** (real HTTP calls, real customer account):
   `POST /quotes` → real rate lookup against the seeded vendor's
   `vendor_service_rates` (2× Wash & Fold @ ₹49 = ₹98) → `POST /slot-holds`
   (real recurring `vendor_slots` row, Sunday 08:00–12:00) →
   `POST /orders/prepare` (real fee breakdown: ₹98 items + ₹20 delivery + ₹5
   handling + ₹5 platform = ₹128) → a `payments` row seeded `PAID`/`ADVANCE`
   (the one deliberate substitution — no real Razorpay credentials are
   available in this environment, so the advance-payment gate that
   `placeOrderFromDraft` unconditionally requires, even for COD, is
   satisfied with a real-shaped row rather than a real gateway callback) →
   `POST /orders` → real order `LNDR-20260912-W16`, `WAITING_VENDOR_CONFIRMATION`.
2. **Desktop pulls and works the order** — a fresh Desktop instance (fresh
   bootstrap, fresh SQLite store) connected to the real vendor via the real
   phone+OTP flow (§4c–§4d), then through the actual browser UI: "Pull from
   marketplace" → the real order appears with real customer name/phone and
   `ADVANCE_PAID` correctly reflected → Accept → real `VENDOR_ACCEPTED` →
   Mark received at store → Washing → Drying → Ironing → Packed, all via
   the Evidence Center UI built in §4h, all confirmed against the real
   backend at every step (remote status, timeline entries, source version
   incrementing).
3. **Delivery** — outside Desktop's current scope (§5: "Pickup/delivery
   *assignment* … is untouched by this work"), so driven directly against
   the real backend as the other real actors: a real platform-ADMIN account
   assigns a real rider (`PUT /orders/admin/:id/rider`) → the rider (a real
   `VENDOR_RIDER` `vendor_employees` row, real shop-scoped JWT) calls
   `POST /vendor/rider/jobs/:id/start-delivery` → real `OUT_FOR_DELIVERY` →
   fetches the real customer delivery OTP (`GET /orders/:id/otp?purpose=DELIVERY`)
   → `POST /vendor/rider/jobs/:id/delivery-otp/verify` → real `DELIVERED`.
4. **Settlement** — `SettlementService.settleShopForPeriod` run for the
   vendor's day: real `shop_financials` row, `gross_revenue ₹148` (this
   order ₹98 + a second minimal fixture order ₹50), `platform_commission
   ₹14.80` (10%), `net_revenue`/`payout_amount ₹113.20`, plus the correct
   four-entry-per-order `shop_transactions` ledger.

Every step used the real endpoint, the real database, and — for every actor
other than the one payment-gateway substitution — a genuinely, separately
authenticated account (customer, vendor owner via Desktop, platform admin,
rider), not a shared or elevated token.

## 2. Two real bugs this test caught

Both were found because the test insisted on completing the *whole* chain
through to settlement rather than stopping once the vendor-facing part
(already covered by prior sessions' work) looked fine.

### 2a. `orders.delivered_at` was never set by the real delivery flow

`vendor-rider.service.js`'s `_advanceOrder()` — the function every real
rider delivery confirmation goes through — updates `orders.status` to
`DELIVERED` and stamps `order_assignments.delivered_at`, but never touched
`orders.delivered_at`. Both of settlement's queries
(`aggregateDeliveredOrders`, `_recordPerOrderTransactions`) filter on
`orders.delivered_at >= periodStart AND < periodEnd` — a `NULL` there fails
both comparisons unconditionally, so **every order ever delivered through
the real rider app would be silently excluded from settlement, forever**.
The admin manual status-override path (`orders.service.js#adminUpdateStatus`)
already correctly sets `deliveredAt` on this exact transition, which is
what confirms this was a real oversight in one path rather than an
intentional design — the correct behavior already existed elsewhere in the
same codebase.

Caught live: after driving the real order through real rider delivery,
`orders.delivered_at` was NULL despite `status = 'DELIVERED'` and
`order_assignments.delivered_at` being correctly stamped. Fixed by setting
`delivered_at = NOW()` in the same `UPDATE orders` statement whenever
`finalStatus === 'DELIVERED'`. Re-verified live with a second, isolated
order: `delivered_at` now populates correctly through the same real
endpoint.

### 2b. Settlement's per-order ledger has no retry/idempotency guard

`settleShopForPeriod`'s aggregate `shop_financials` row is a proper UPSERT
(safe to retry — the worker's own doc-comment says so). Its per-order
ledger write (`_recordPerOrderTransactions` → `TransactionWriterService
.recordSettlementEntries`, in `archived_modules/shop-finance/`) has no such
guard — it unconditionally inserts a fresh `ORDER_REVENUE` /
`PLATFORM_COMMISSION` / `DELIVERY_FEE` / `RIDER_COST` row per delivered
order on every call. BullMQ retries the settlement job up to 3 times on any
transient failure (queue default), and a manual re-run (an admin "re-settle
this shop" action, or exactly the kind of mistake this test itself made —
see below) hits the same path.

Caught by reproducing it directly: `settleShopForPeriod` was called twice
in a row for the same shop and day (first accidentally, by a test-harness
bug of my own — an earlier call was missing the required `periodEnd`
argument and crashed on the final UPSERT *after* the per-order entries had
already committed; investigating that crash is what led to noticing the
per-order writes aren't wrapped in the same all-or-nothing guarantee as the
aggregate). Result: `shop_financials.gross_revenue` stayed correctly at
₹148 (the UPSERT overwrote cleanly), but `shop_transactions` held 12 rows —
exactly double the correct 6. A vendor reconciling their detailed
transaction history against their settlement summary would find it
permanently, silently wrong.

Fixed by excluding, in `_recordPerOrderTransactions`'s own order-selection
query, any order that already has an `ORDER_REVENUE` entry for it
(`NOT EXISTS (... WHERE reference_id = o.id AND type = 'ORDER_REVENUE')`).
Verified live: cleared the ledger, ran settlement three times in a row —
`shop_financials` stayed correct throughout, and `shop_transactions` ended
with exactly one `ORDER_REVENUE`/`PLATFORM_COMMISSION` per order and one
`DELIVERY_FEE`/`RIDER_COST` for the one order that had a nonzero delivery
fee — no duplication on any of the three runs.

## 3. What this does NOT cover

- The payment-gateway leg is substituted (a real-shaped `PAID` row, not a
  real Razorpay callback) — this environment has no real Razorpay
  credentials. Everything downstream of "payment exists and is PAID" is
  real.
- Desktop's own UI does not yet drive rider assignment or the
  pickup/delivery leg (confirmed, unchanged from §5) — that portion of this
  test used direct backend calls as the admin/rider actors, not Desktop.
- Refunds, cancellations, and the reconciliation/recount path were not
  re-exercised here — §4h already covered reconciliation live in a
  separate pass.
- This was one order through one vendor with one rider; concurrency
  (multiple orders settling, multiple riders on the same vendor) is not
  exercised by a single sequential lifecycle.

## 4. Cleanup

All fixture rows (2 test orders, order_assignments, payments, quotes,
addresses, order_otps, shop_transactions, shop_financials, and 3 test users
across customer/rider/admin roles) were deleted afterward — the database
was left in the same state it was in before this test, aside from the two
code fixes above. The Desktop test workspace created for this run
(a fresh bootstrap, needed because the persisted dev workspace's owner
credentials from an earlier session were not recorded) was discarded and
the prior persisted workspace restored.

Committed locally (`Lndry_backend` commit `e9b5c8f`), **not pushed**.
