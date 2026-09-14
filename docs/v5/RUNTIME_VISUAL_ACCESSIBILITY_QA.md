# Runtime visual and accessibility QA

## Scope and status

Phase 4 began on 15 September 2026 against an isolated, seeded demo
workspace. This is runtime evidence, not a source-only review: Playwright
started the real local Fastify process and exercised the built React
application through Chromium. Its database, legacy JSON fixture and report
export directory were unique temporary paths, so the audit did not mutate a
store workspace or the production-mode verification server.

`VERIFIED_CURRENT` for this slice:

- the documented isolated demo sign-in and the integrated Laundry Desk entry
  point;
- reduced-motion behaviour and the principal operator surfaces;
- every major listed operator route at 1024, 1280, 1366, 1440, 1920 and 2560
  px wide viewports;
- representative populated captures at 1024, 1366 and 1920 px, including
  dashboard, order booking, customer work-card drawer, finance, statutory
  compliance, catalogue, reports and settings;
- the static accessible-name audit for native interactive controls.

`NEEDS_REAL_HARDWARE`: packaged Electron-specific behaviour (Windows
installer launch, native print/scanner/scale paths, keyboard focus through
the actual Electron shell, and printer output). The Electron application was
not running as a controllable native window during this slice, so this report
does not present browser-runtime evidence as a packaged-app certification.

## Evidence

On 15 September 2026:

1. `npm run audit:a11y` passed. The AST audit found no unnamed buttons or
   unlabeled input/select/textarea controls outside intentionally composable
   UI primitives.
2. `PLAYWRIGHT_PORT=3924 npm run test:e2e` passed all six tests. The final
   Playwright result was `passed` with no failed tests.
3. The visual route sweep verified the authenticated shell, no application
   error text, no JavaScript `Cannot read properties` text and no permanent
   page-loading state across its route/viewport matrix.
4. Human review of the generated full-page captures confirmed the dashboard
   hierarchy, visual order-booking catalogue, finance command centre and
   customer work-card drawer at desktop width. At 1024 px, the booking tray
   intentionally stacks below the product catalogue rather than competing
   with it for horizontal space. The customer list preserves its complete
   seven-column table through an intentional horizontal scroll container;
   it does not silently remove actions or financial context.

The representative capture set is generated at runtime under
`demo-runtime/visual-review/` and is deliberately not committed as product
source or user data.

## Recovery made during the audit

The standard Playwright configuration formerly fixed its server to port
3920. A pre-existing local development server made that test fail before it
could start. `webapp/playwright.config.ts` now accepts `PLAYWRIGHT_PORT`
(defaulting to 3920), and keeps its base URL, health probe and child-server
port coherent. This permits an isolated test run without stopping an
unrelated developer server and makes the runtime test repeatable in a dirty
local environment.

## Findings

No reasonably fixable Critical or High visual/accessibility defect was found
in this first runtime slice. The interface is deliberately desktop-dense at
1024 px; large tables retain all operational columns via horizontal scroll,
and the order tray moves below catalogue content. This is an intentional
tablet/desktop trade-off verified in the capture rather than a claim of a
phone-first layout.

The next Phase 4 slice should exercise interaction states that screenshots
cannot prove: keyboard tab order and focus return for drawers/dialogs,
empty/error/retry states, and native Electron packaging/hardware paths where
a real Windows app window and devices are available.
