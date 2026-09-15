# Ecosystem Convergence Audit — 2026-09-15

## Decision

The Fastify/Postgres `Lndry_backend` is the only plausible shared operational
authority for the vendor app, central dashboard and future customer ordering
channels. Epic Laundry Desktop is an offline-capable vendor/store operating
node and controlled platform reader; it must not become a competing cloud
authority.

## What is connected today

| Channel | Evidence-backed connection | Authority boundary |
| --- | --- | --- |
| Vendor app | Flutter uses the real `/api/v1` Fastify API with bearer refresh and vendor/rider workflows. | Backend owns cross-device order/rider state. |
| Central dashboard | Next.js uses the same API and Socket.IO event family. | Backend owns admin reads and permitted admin actions. |
| Epic Laundry Desktop | Encrypted vendor phone+OTP session, real REST order/catalogue/action/reconciliation paths; per-store background pull with durable backoff and 100-order paging (up to 100,000 rows per pass). Separate encrypted platform-admin session exposes bounded platform readers. | Backend remains source for marketplace coordination; SQLite owns local offline work and physical-operational evidence. |
| Website `Shotlin/lndry` | Next.js marketing/partner lead site with its own Supabase vendor-lead flow. | It is **not** a customer order client and is not connected to Fastify order authority. |

## Boundaries that must remain explicit

1. Desktop's local `edge-sync` outbox/inbox is an at-least-once device-envelope
   model. The real backend does not implement that protocol. The new direct
   REST poll never marks an edge outbox event acknowledged.
2. A cloud order projection is a cached operational view, not a second
   marketplace order. Cloud-owned fields are written only when changed; the
   original customer request is immutable once captured locally.
3. Platform Control is permission-gated and intentionally read-heavy. It is
   not permitted to revive legacy admin lifecycle or payout writes that bypass
   rider, OTP, payment, provider-evidence or audit controls.
4. Website vendor-lead data in Supabase is not vendor onboarding in the Fastify
   marketplace until an explicit, idempotent hand-off contract is built.

## Current integration gaps

| Classification | Gap | Required next work |
| --- | --- | --- |
| MISSING | Customer ordering application/API contract was not present in the supplied repos. | Obtain its source or define versioned backend order/customer/identity contracts before claiming customer-channel integration. |
| PARTIAL | Desktop uses polling; Dashboard/Vendor App have evolving realtime implementations. | Verify the backend Socket.IO auth/event contract for Desktop, then add a subscription only if it preserves idempotency and reconnect recovery. |
| PARTIAL | Website vendor leads are isolated in Supabase. | Build an explicit reviewed-lead → Fastify vendor-application hand-off with dedupe and audit, or keep it clearly separate. |
| NEEDS_RECONCILIATION | Local branches are divergent from their fetched remotes: backend +9/-22, vendor app -2, dashboard -4 as observed on 2026-09-15. | Review and integrate intentionally; do not silently merge or overwrite working trees. |
| VERIFIED_CURRENT | Local Docker/Postgres/backend runtime recovered during this slice. | A real seeded-vendor connection and automatic authenticated empty-list pull reached `Healthy`; repeat with a deliberately isolated real order when validating future source-mapping changes. |
| NEEDS_PROVIDER | Production credentials, customer messaging, payment, GSP and payout provider evidence remain unavailable. | Keep all external success claims evidence-gated. |

## Acceptance rule

Do not describe the ecosystem as “fully connected” until the missing customer
channel, website hand-off decision, live runtime verification and intentionally
reconciled backend/client revisions are complete. The current implementation is
a materially stronger vendor-cockpit convergence, not a finished omnichannel
production certification.
