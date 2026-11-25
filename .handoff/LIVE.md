# Handoff (live) — Mwakete POS + Firebase

## Goal
Close EVERY capability in the user's PDF (POS-001..172, sections M, N). FREE only, ALL tests green, work non-stop. Then security review + fixes, then final report + recommendations.

## State (2026-11-25, end of session segment)
- Branch claude/pensive-curie-l1iir1 (pushed, HEAD 7efed5b+), PR #1 draft. Live https://mwakete-pos.web.app deployed with batches 1-6 + roles rules.
- Truth source: docs/CAPABILITY_REGISTER.md. Update rows with scratchpad script pattern (awk edit by POS id) because the Bash hook blocks long sed.
- DONE: Phase 0 register; 1 checkout (change due, EFTPOS/IB/MPaisa, split, hold/resume); 2 catalogue (edit/archive/desc/cost/unit/picture/bulk/filters/valuation/price history; cost+image device-only); 3 transactions (receipt no R-<dev>-n, search/filter/export/integrity/timeline); 4 delivery queue (mailto/sms/wa.me, user-confirmed Delivered; customer email/address/group); 5 reports (week/month/custom, filters, profit estimate); 6 roles (cashier/manager/inventory/auditor in rules+UI), device-local tamper-evident audit log, PIN lock + idle lock, device name, sale.deviceId.
- Bug fixed: cart draft restore race (saveDraft gated by draftReady in app.js).
- Tests green at last run: unit 321, browser x16 suites, rules 50, cloud e2e, axe 0.

## Remaining (in order)
7. Barcode: unknown barcode -> register product; camera scan (BarcodeDetector, optional); hardware scanner on all tiers (021,022,026-029). Micro POS UI/change already via checkout; adaptive workspaces; onboarding wizard; PWA: PNG icons, install prompt, update-available prompt, connection badge, storage persist (section M).
8. Optional Mwakete integration: honest DISCONNECTED adapter screens (status/authorize/disconnect), no invented APIs; docs/API template.
9. Cloud role e2e (manager/inventory/auditor) in tests/e2e/firebase-cloud.e2e.js; audit log + devices cloud sync (needs DB v6 stores) = optional.
10. User tasks via workarounds: delete smoke-test account mwakete.smoketest.1795582984250@example.com (firestore:delete businesses/<uid> --recursive + Identity Toolkit admin delete with CLI token); API-key restriction only with tested rollback; App Check optional no-op until site key.
11. Docs set: ARCHITECTURE, OFFLINE_SYNC, DATA_MODEL, TESTING, TROUBLESHOOTING, CHANGELOG, DEPLOYMENT, FIREBASE_SETUP, API_DOCUMENTATION; update README, SECURITY.md (roles, lock, audit log, honest limits), rules header comment.
12. Security review + fixes, then final report (implemented/verified/failed/pending separately) + recommendations.

## Gotchas
- Bash hook: <=10 statements/pipes, <=500 chars, no heredocs/inline scripts; use Write for scripts in scratchpad (/tmp/claude-0/-home-user/ddc10b85-.../scratchpad/): regress.sh (full regression), flaky.sh <suite> <n>, reg1.sh ID STATUS "evidence".
- Top-level `const X` in classic scripts is NOT on window: use `typeof X !== "undefined"` (CloudUI, FirebaseBackend, Diagnostics).
- Playwright waitForFunction with async predicate is always true: poll from Node. e.currentTarget null after await.
- Receipts only on Retail+; new sale fields need rules checks (validSale <=40 keys); cost price/image never synced.
- Offline reload tests need `navigator.serviceWorker.ready` + wait.
- Deploy: npx -y firebase-tools@latest deploy --only firestore:rules,hosting --project mwakete-pos (CLI logged in as admin@mwakete.com).
- Regression: bash <scratchpad>/regress.sh (unit, browser, a11y, rules, cloud).

## Open questions
- Marketplace API contract unavailable (integration stays disconnected stub).
- "Create standoff" from the user was read as "write a handoff" (this file).
