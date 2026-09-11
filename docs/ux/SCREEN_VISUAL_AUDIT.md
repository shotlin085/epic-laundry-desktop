# Epic Laundry screen visual audit

Status: source audit complete · automated runtime capture complete · deterministic demo-login runtime verified · human visual acceptance pending

This audit records current route intent and the next visual acceptance check. “Verified” means runtime evidence exists in this workspace; “Pending” means source inspection alone is not treated as proof.

The 10 September 2026 runtime accessibility pass now emulates `prefers-reduced-motion: reduce` and verifies the global motion contract (animation/transition collapse and automatic scrolling) on the live demo shell across Dashboard, New Order and Finance. The static interactive-control audit also passes. The same pass provides data-derived screen-reader summaries for the Overview and Dashboard chart surfaces. This verifies the motion/accessibility guard; it does not replace the open human review for typography, density, copy and composition.

Automated runtime evidence now covers the 33 major operator routes, including report-detail and import surfaces, at 1024, 1280, 1366, 1440, 1920 and 2560px (198 route/viewport captures) in a disposable authenticated workspace. Route capture waits for the shared named loading surface to resolve, so a transient blank/spinner state cannot be mistaken for a finished screen. Finance Command Center, Statutory Controls and Marketplace Sync now all use that same intentional loading contract instead of isolated spinners. A separate browser test now signs into the seeded demo workspace with the documented demo account and verifies the populated dashboard. A production-mode empty-state walkthrough creates a fresh workspace and verifies branded empty-state imagery across customers, orders, online orders, production, quality, corrections, returns, dispatch, settlements and expenses. The desktop/root-entry regression also confirms `/ui/` redirects to `/ui/app/` and does not expose the retired generic ERP shell. This proves the shell, route render path, demo authentication path and core empty-state path; it does not replace human review of composition, spacing, copy, density, or the remaining customer-detail variant.

Representative rendered-image review on 10 September 2026 covered Dashboard, Overview, New Order, Customers, Customer Work Card, Finance, People & Payroll and Store Settings at 1366px, with 1024px and 1920px captures also generated. The review found and fixed a collapsed People & Payroll attendance chart, stretched customer-detail timeline panel, and preserved directory scroll offset on detail navigation; route-level scroll restoration now places each drill-down heading below the sticky workspace bar. On 11 September 2026, Route Control was manually rendered at 1366px and 1024px; its five-card summary collapsed explanatory labels at 1024px, so it now uses a three-column intermediate breakpoint while retaining five columns at wide desktop. The fixed 1024px render has no horizontal overflow and no truncated summary label. Finance Command Center was also checked with its source request deliberately delayed: it now shows the shared branded, named `page-loading` surface (including the local-records explanation) before it renders the command center, rather than a bare spinner that can read as an empty page. After the latest chart-accessibility change, the representative capture was rerun successfully and the server regression/E2E suite remained green. The remaining surfaces are still tracked for a complete human visual-owner pass.

| Surface | Primary user | Visual opportunity | Current evidence/status |
|---|---|---|---|
| Dashboard | Owner/operator | heartbeat KPIs, pipeline, trend, attention | Existing charts and shared empty state; automated route capture complete, human review open |
| Overview / Statistics | Owner/manager | trends, mix, period comparison | Charts present; automated route capture complete, human review open |
| Operations centre | Manager/production | workload and bottlenecks | Source surface exists; automated route capture complete, human review open |
| Finance command centre | Owner/accountant | revenue, cash, EBITDA readiness | Recharts + reconciliation model present; named shared loading surface verified under delayed local-data request; automated route capture complete, human review open |
| Statutory controls | Accountant | liabilities, policy/evidence state | Liability chart and policy/evidence surfaces now expose screen-reader summaries; Finance empty visual added; automated route capture complete, human review open |
| People & payroll | Manager | attendance, payroll readiness, leave, claims, loans, hiring | Attendance/quality charts plus HR-depth visual cards; automated route capture complete, human review open |
| Finance setup | Owner/accountant | readiness sequence and missing facts | Source surface exists; automated route capture complete, human review open |
| Customers / customer detail | Counter/owner | segments, spend, balance, timeline | Directory/detail route plus persisted order-status journey and shared empty states; direct 1366px verification confirms the customer work card docks as a 464px right drawer with the directory preserved behind it and no URL navigation; automated route capture complete, customer-detail variant included in representative capture, human review open |
| Care packages | Counter/owner | utilization and liability | Route exists; automated route capture complete, human review open |
| New Order | Counter operator | visual category, garment and unit speed | Category media and order tray present; runtime verified from prior review |
| Store orders | Counter/manager | state distribution and due risk | Paginated table now leads with a page-scoped Order Pulse (active work, ready-to-move, payment attention, review count and labeled pipeline); automated route capture complete, human review open |
| Online orders | Vendor coordinator | acceptance, intake, approval, payment | V4 cockpit pattern documented; automated route capture complete, human review open |
| Marketplace sync | Support/owner | push/pull, retry, dead letter, device | Route exists; automated route capture complete, human review open |
| Garment tracking | Production | scan-to-history trace | Route, durable tag model and branded filtered-empty state; automated route capture complete, human review open |
| Production queue | Production worker | queue depth, due time, stage | Route exists; automated route capture complete, human review open |
| Quality claims | QC/supervisor | exception urgency and resolution | Claims analytics present; shared quality empty state added; automated route capture complete, human review open |
| Corrections | Supervisor/accountant | correction document evidence | Route and branded quality empty state; automated route capture and empty-state walkthrough complete, human review open |
| Returns | Counter/supervisor | reason, refund, status | Route exists; automated route capture complete, human review open |
| Routes | Rider coordinator | stops, capacity, stage, exceptions | Route workload analytics now separates skipped-stop exceptions from completed stops; direct 1366px/1024px review fixed metric-label truncation with zero horizontal overflow; automated route capture complete, human review open |
| Pickup & delivery | Rider coordinator | next handoff and rider assignment | Shared delivery empty state added; automated route capture complete, human review open |
| Rider settlements | Finance/rider coordinator | collections and reconciliation | Route exists; automated route capture complete, human review open |
| Cash closing | Cashier/owner | drawer equation and variance | Drill and immutable history present; automated route capture complete, human review open |
| Print centre | Counter/production | pending jobs and output state | Route exists; automated route capture complete, human review open |
| Expenses | Owner/accountant | category, approval and trend | Category composition and largest-driver views now expose a data-derived chart summary; automated route capture complete, human review open |
| Reports / report detail | Owner/accountant | grouped previews and drill-down | Routes exist; automated route capture complete, human review open |
| Catalogue / garment prices | Owner/counter | media, unit and price coverage | Media and price matrix present; automated route capture complete, human review open |
| Import surfaces | Owner/admin | progress, validation and recovery | Routes and branded import-history empty state; automated route capture complete, human review open |
| Store settings | Owner/admin | grouped readiness, not endless form | Persisted settings groups now render as keyboard-accessible tab panels instead of one all-sections page; automated route capture and tab-panel runtime check complete, human review open |

## Cross-screen acceptance checklist

- First glance identifies purpose and primary action.
- KPI meaning is explicit; revenue, cash, tax and liabilities are not conflated.
- Data, filter-empty, not-configured, permission and provider-failure states are distinct.
- Generated imagery is contextual, recognisable and never a functional icon.
- Tables remain available where exact evidence or editing matters.
- Keyboard focus, labels, contrast, reduced motion and 1024px layout pass.
- Runtime screenshots—not JSX inspection—decide final status.
