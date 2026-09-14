# Epic Laundry V5.1 final audit snapshot

Audit date: 15 September 2026  
Desktop HEAD: `0056551`  
Backend HEAD: `8388102`  
Scope: local main branches only; no push, deploy, or production-data mutation.

## Genuinely complete in this audit

- Platform-admin identity and permission-gated Platform Control surfaces.
- Vendor application review, platform order oversight, finance oversight, and
  read-only audit evidence paths.
- Keyboard focus ownership, Tab containment, Escape dismissal, and focus
  restoration for the customer, order, statutory, print, expense, route-skip,
  platform audit, platform order, and vendor-review panels.
- Offline SQLite restart/recovery behavior, clean database bootstrap,
  production/demo separation, fixed-scale financial checks, marketplace sync
  idempotency, and the existing garment/tag/print safeguards.
- Current web bundle accepted by the Windows Electron unpacked and installer
  packaging pipelines.

## Evidence

- Full CI-equivalent backend self-test set: passed after updating two stale
  migration-head assertions and extending the isolated demo startup wait for
  slower CI/Windows seed materialization.
- Web TypeScript build: passed; 2,467 modules transformed.
- Web dependency audit: 0 vulnerabilities.
- Server dependency audit: 0 vulnerabilities.
- Desktop dependency audit: 0 vulnerabilities.
- Static accessibility audit: passed.
- Frontend Playwright suite: 11 passed, including core workflow, visual route,
  representative-screen, and drawer keyboard tests.
- Fresh-production empty-state walkthrough: passed.
- Desktop workspace, menu-routing, recovery-policy, release-signature, and
  production-release-guard tests: passed.
- Windows `dist:win`: completed; release manifest verified 3,829 checksum
  entries.

## Corrections made during final audit

- Migration regression coverage now asserts a continuous current sequence and
  recognizes migration 39, `platform-admin-session`, as the current head.
- Workspace-mode health polling now allows the expanded demo fixture up to 60
  seconds in the test harness only; product startup behavior was not weakened.

## Remaining non-complete items

### `NEEDS_REAL_HARDWARE`

Native packaged-window walkthrough and real printer, scanner, weighing-scale,
and physical output verification remain open. Browser and self-test evidence
does not certify hardware.

### `EXTERNAL_BLOCKER`

The local Windows installer is unsigned (`Get-AuthenticodeSignature`:
`NotSigned`). A production Authenticode certificate and protected signing
pipeline are still required.

### `NEEDS_PROVIDER` / `PROVIDER_EVIDENCE_REQUIRED`

Production payment, GSP/IRP, messaging, backup-provider, update-feed, and
marketplace cloud credentials/evidence were not fabricated or marked as live.
The statutory and marketplace software paths remain fail-closed until real
provider evidence is supplied.

### `NEEDS_LEGAL_VALIDATION`

Entity-specific PAN/TAN/GST registrations, EPF/ESIC applicability, state PT and
minimum-wage policy, and marketplace supplier-of-record/settlement contracts
still require the real business configuration and professional/legal sign-off.

### `NEEDS_VERIFICATION`

This audit did not query the current remote GitHub Actions result. Local CI-
equivalent gates are green; remote CI status must be read from GitHub before a
production-candidate claim.

## Release conclusion

The current local branches are a strong production-candidate build for
controlled internal acceptance, not a fully production-certified release.
No Critical or High issue was found in the exercised local software gates.
The remaining blockers are external signing, provider, hardware, remote-CI,
and entity/legal evidence—not silently converted into software passes.
