# Security & Tenant-Isolation Verification — V5.1 (mandate §80)

Live attack-simulation pass against the real `Lndry_backend`, real local
Postgres/Redis (isolated dev ports 5434/6380), real HTTP calls — not unit
tests, not mocks. Two real vendors, two real vendor-owner accounts, a real
order, and a real financial-ledger row were used as the attack surface, then
deleted afterward. No production system was touched.

## 1. Setup

- **Vendor A**: the pre-existing seeded vendor (`11111111-…`, "LNDRY Prime -
  Bengaluru Hub"), owner phone `7013352181`.
- **Vendor B** (`22222222-…`, "SecTest Vendor B"): a second real vendor
  cloned into `vendors`, with its own real `VENDOR_OWNER` row in
  `vendor_employees` (owner phone `9988776655`) — a completely independent
  tenant, not a variant of Vendor A.
- A real order (`SEC-TEST-A`) owned by Vendor A, and a real
  `shop_transactions` row (`₹1000 ORDER_REVENUE`) for Vendor A, so a leak
  would be observable as *real, specific data* appearing where it shouldn't
  — not just an empty-list false negative.
- All test rows deleted at the end of this pass; no residue left in the
  database.

## 2. Cross-vendor data access — `vendor-orders` (the module Desktop's cloud
connector depends on entirely)

Vendor B's real, correctly-issued owner token attempted, against Vendor A's
real order:

| Action | Endpoint | Result |
|---|---|---|
| Read | `GET /vendor/orders/:id` | `404 ORDER_NOT_FOUND` |
| Accept | `POST /vendor/orders/:id/accept` | `404 ORDER_NOT_FOUND` |
| Reject | `POST /vendor/orders/:id/reject` | `404 ORDER_NOT_FOUND` |
| Advance stage | `POST /vendor/orders/:id/processing-stage` | `404 ORDER_NOT_FOUND` |
| Reconcile | `POST /vendor/orders/:id/reconcile` | `404 ORDER_NOT_FOUND` |
| List own orders | `GET /vendor/orders` | `200`, `data: []` (correctly scoped to Vendor B, not Vendor A's order) |

Every cross-tenant attempt returns `404`, not `403` — the query itself
(`WHERE o.id = $1 AND o.vendor_id = $2`) never distinguishes "order exists
but isn't yours" from "order doesn't exist," so a hostile vendor can't even
confirm another vendor's order ID is real by probing status codes. This is
the correct, stricter choice for a cross-tenant boundary.

## 3. Cross-vendor financial data — `shop-transactions`

- Vendor A reading their own real transaction: `200`, the real `₹1000`
  `ORDER_REVENUE` row comes back correctly.
- Vendor B reading their own (empty) ledger: `200`, `data.items: []`
  (correct — Vendor B has no transactions).
- **Vendor B attempting to read Vendor A's ledger via the `X-Shop-Id`
  header** (`X-Shop-Id: <Vendor A's real vendor id>`, with Vendor B's own
  valid, shop-scoped JWT attached): still `200`, still `data.items: []`,
  **not** Vendor A's `₹1000` row. The header is documented as an
  escalation path reserved for platform Super Admins
  (`requireShopScope`'s own comment); confirmed live it has no effect for a
  regular vendor-owner token — the middleware resolves shop scope from the
  JWT's own `shopId` claim, not the header, for a non-admin caller.

This was re-verified with a real, distinguishable row specifically because
the first attempt (before seeding Vendor A's transaction) returned `[]` for
both the legitimate and the escalation request — an inconclusive result that
could as easily have meant "the header worked and Vendor A just has no
data" as "the header was correctly ignored." Seeding real, attributable data
before re-testing is what makes this a real finding rather than a coincidence.

## 4. Replay attack — OTP reuse

Re-submitted an OTP code that had already been successfully consumed by a
prior `verify-otp` call for the same phone/challenge: `400 INVALID_OTP`
("OTP expired. Request a new one."). Single-use is enforced — the OTP
challenge is deleted (`repo.deleteOtpChallenge`) and its Redis key cleared
(`redis.del`) on first successful verification, per
`auth.service.js:233-234`.

## 5. JWT tampering — payload modified without re-signing

Took a real, validly-issued access token for Vendor B (`shopId` =
Vendor B's real id, correctly HMAC-signed), base64url-decoded its payload,
rewrote `shopId` to Vendor A's real id in place, and re-assembled the token
with the **original, now-mismatched signature** (no re-signing — this
simulates an attacker who can read/edit a token but doesn't have
`JWT_ACCESS_SECRET`). Used against `GET /shop-transactions`:
`401 UNAUTHORIZED` ("invalid or expired token") — `@fastify/jwt`'s
`request.jwtVerify()` correctly rejects the signature mismatch before any
route logic runs. Confirms the JWT's integrity guarantee holds; a captured
token cannot be locally edited to widen its scope.

## 6. Result

No cross-tenant data leakage, no replay, no signature-bypass found across
the surface tested (`vendor-orders` read/accept/reject/stage/reconcile,
`shop-transactions` read + `X-Shop-Id` escalation attempt, OTP verification,
JWT integrity). This is a positive result for the code paths a real vendor
account can actually reach today — it does **not** cover the
`shop-garment_rates`/`shop-financials` routes, since (per
`CROSS_REPOSITORY_CAPABILITY_MATRIX.md` §5a) no real account can reach them
at all yet (they 403 closed for everyone, which is itself a safe failure
mode, just not a useful one to attack-test further until the underlying
role-vocabulary gap is resolved).

**Not covered by this pass** (would need dedicated setup): rate-limit
exhaustion behavior under sustained load, `session_version` invalidation on
password change (the test accounts here are OTP-only, no password set),
refresh-token rotation/reuse-detection edge cases beyond the one replay
check above, and CSRF/cookie-based attack surfaces (the refresh-token cookie
is `httpOnly`/`sameSite: strict`, not independently exercised here).
