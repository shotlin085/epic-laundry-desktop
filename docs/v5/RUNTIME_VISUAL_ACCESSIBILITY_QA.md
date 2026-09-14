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

## Follow-up interaction recovery

The first interaction audit found that the customer work-card drawer used
`aria-modal="true"` but did not initially place focus inside the dialog,
trap Tab navigation, or restore the invoking control on dismissal. That is a
real keyboard and screen-reader defect, not cosmetic polish. The drawer now
focuses its close control after mount, cycles focus within its own interactive
content, and returns focus to the exact customer-row trigger after close or
Escape. The runtime regression test verifies all four behaviours. The next
drawer-focused slice should apply the same evidence standard to the order
work card and any other custom modal surface.

The order work card used the same custom modal pattern and received the same
recovery. Its initial loading state now focuses the dialog itself (rather
than leaving focus in the obscured order table); once Tab is pressed the
focus cycle is restricted to order controls, and Escape returns to the
originating `View` action. The three-test focused runtime suite passed after
the correction. This also guards the short interval before asynchronous
order detail loads, where a non-existent close button cannot be a focus
target.

The statutory finance workspace had the same interaction risk across its
return, liability-posting and policy-builder drawers. It now focuses the
drawer close control after opening, keeps keyboard traversal inside the
workspace (including the empty/initial form state), dismisses on Escape, and
restores the initiating action. The focused runtime regression passed against
the rebuilt SPA on 15 September 2026. The backdrop control has a distinct
accessible name so screen readers do not report two identical “Close panel”
actions.

The Print Centre live workset also had a custom right-side dialog with Escape
dismissal but no focus ownership. It now focuses the workset while order
details load, traps Tab navigation within the print controls, and restores the
selected order trigger after dismissal. A seeded print-centre runtime test
passed this flow against the rebuilt SPA on 15 September 2026.

The controlled expense-reason confirmation dialog and route-skip exception
dialog now use the shared dialog-focus recovery hook. The expense flow was
runtime-verified without submitting or changing a record: the reason field
receives focus, Tab remains within the confirmation dialog, Escape dismisses
it, and focus returns to the originating Cancel action. The route-skip
surface receives the same keyboard and Escape behavior through the shared
hook; a populated route-stop fixture was not available in this disposable
operator workspace for a submit-path test.

The platform-admin audit, marketplace-order, and vendor-review drawers now use
the shared lifecycle focus boundary as well. Their cloud-owned actions remain
permission-gated and unchanged: the interaction layer only owns focus,
keyboard containment, Escape dismissal, and return to the invoking row. The
local demo fixture has no connected platform-admin session, so this slice was
validated by TypeScript/build/static checks and the shared drawer regressions;
it is not a claim of a fresh authenticated cloud-admin runtime pass.

## Packaging follow-up

On 15 September 2026, the current runtime was rebuilt through the Windows
Electron packaging pipeline with `npm run pack`. The unpacked artifact was
created at `desktop/dist/win-unpacked/Epic Laundry.exe`; its generated release
manifest verified all 3,828 checksum entries. Desktop workspace, menu-routing,
recovery-policy, release-signature, and production-release-guard tests also
passed. This confirms that the current web/server bundle is accepted by the
packaging pipeline. It does not certify a native-window walkthrough, printer,
scanner, scale, or other hardware path; those remain `NEEDS_REAL_HARDWARE`.

The readiness follow-up also passed on 15 September 2026: clean database
bootstrap, packaged-server restart with offline persistence, fresh-database
backup/restore recovery, production/demo workspace separation, and the
authenticated random-port startup handshake. These checks ran against
isolated temporary state and did not alter a vendor or production workspace.
