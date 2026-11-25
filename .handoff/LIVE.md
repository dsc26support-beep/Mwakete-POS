# Handoff (live) — Mwakete POS + Firebase

## Goal
Close EVERY capability in the user's PDF (POS-001..172, sections M, N). FREE only, ALL tests green, work non-stop. Then security review + fixes, then report + recommendations.

## State (2026-11-25)
- Branch claude/pensive-curie-l1iir1, PR #1 draft. Live: https://mwakete-pos.web.app (deployed after catalogue batch; rules deployed).
- Register of truth: docs/CAPABILITY_REGISTER.md (update rows with /tmp scratchpad reg1.sh-style awk edit; Bash hook limits long sed).
- DONE this segment: Phase 0 register; batch 1 checkout (js/checkout.js, checkout-ui.js: change due, EFTPOS/IB/MPaisa, split, hold/resume); batch 2 catalogue (js/catalogue.js, catalogue-ui.js: edit/archive/description/cost/unit/picture/bulk/filters/valuation/price history; cost+image device-only).
- Tests green after batch 2: unit 286, browser x12 (incl checkout 32, catalogue 27), rules 43, cloud e2e, axe 0.

## Next batches (in order)
3. Transactions: search/filter/export CSV, status, audit history, void/correction flow, receipt number (POS-097,112-120), customer fields/purchase history (107-109).
4. Receipt delivery queue via mailto/sms/wa.me + states Queued/Sending/Delivered/Failed/Retry/Cancelled (101-106).
5. Reports: weekly/monthly/custom, product/category/staff/payment filters, profit estimate w/ assumptions (163-172), print/export.
6. Roles (Manager/Admin/Inventory/Auditor), security audit log, session idle lock, device registration (153-160, section M).
7. Barcode: unknown barcode -> register product, camera (BarcodeDetector) + hardware (021,022,027-029); Micro POS UI; onboarding; PWA install/update prompt, PNG icons.
8. Optional Mwakete integration: honest DISCONNECTED adapter (no invented APIs).
9. User tasks 1-4 workarounds (delete smoke-test acct; API key restriction w/ rollback; App Check no-op; marketplace stub).
10. Docs set (ARCHITECTURE, OFFLINE_SYNC, DATA_MODEL, TESTING, TROUBLESHOOTING, CHANGELOG...), security review, final report.

## Gotchas
- Bash hook: <=10 statements, <=500 chars, no heredocs. Formatter rewrites after Write.
- e.currentTarget null after await; Playwright waitForFunction async predicate always true.
- Regression: npm test; NODE_PATH=$(npm root -g) npm run test:e2e; cd tests/rules && npm test; cd tests/a11y && node a11y.e2e.js; cloud: NODE_PATH=$(npm root -g) npx -y firebase-tools@latest emulators:exec --only auth,firestore --project mwakete-pos "node tests/e2e/firebase-cloud.e2e.js"
- Deploy: npx -y firebase-tools@latest deploy --only firestore:rules,hosting --project mwakete-pos
- Receipts only on Retail+ tier; sale fields sync whole object, so new sale fields need rules checks (validSale <=40 keys).
