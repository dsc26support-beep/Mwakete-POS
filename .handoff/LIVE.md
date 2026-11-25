# handoff: mwakete-pos-live
project: mwakete-pos
type: code
generated: 2026-11-25
goal: Close EVERY capability in user's PDF (POS-001..172, sections M device/PWA, N optional Mwakete). FREE only (no Blaze/paid SMS), all tests green ("nothing breaks 100%"), non-stop. Then security review + fixes, then report + recommendations.

## next-steps  <!-- resume here -->
1. Barcode: unknown barcode -> register product; camera scan (BarcodeDetector, optional); hardware scanner on all tiers (POS-021,022,026-029).
2. PWA/section M: PNG icons, install prompt, update-available prompt, connection badge, onboarding wizard.
3. Optional Mwakete integration: honest DISCONNECTED screens + docs template; no invented APIs.
4. Cloud role e2e (manager/inventory/auditor) in tests/e2e/firebase-cloud.e2e.js.
5. User tasks via workarounds: delete smoke-test acct (firestore:delete businesses/<uid> --recursive + Identity Toolkit admin delete w/ CLI token); API-key restriction only w/ tested rollback; App Check no-op until site key.
6. Docs set (ARCHITECTURE, OFFLINE_SYNC, DATA_MODEL, TESTING, TROUBLESHOOTING, CHANGELOG, DEPLOYMENT, FIREBASE_SETUP, API_DOCUMENTATION); update README, SECURITY.md, rules header comment.
7. Security review + fixes; final report (implemented/verified/failed/pending separately).

## state
- done: Phase0 docs/CAPABILITY_REGISTER.md (source of truth); checkout.js; catalogue.js; txn.js; delivery.js; analytics.js; security.js (+ *-ui.js); roles in firestore.rules (cashier/manager/inventory/auditor).
- deployed: https://mwakete-pos.web.app incl. rules. Branch claude/pensive-curie-l1iir1, PR #1 draft.
- verified: unit 321, browser x16 suites, rules 50, cloud e2e, axe 0.
- unverified: real devices, screen reader, manager/auditor through real cloud sign-in.

## decisions
- Receipt delivery = mailto/sms/wa.me links + local queue; "Delivered" = user-confirmed (no paid APIs, no stored creds).
- costPrice + product image device-only (cashiers can read catalogue; margins must stay private).
- Stock warn-not-block (per-device counts can be stale); qty cap 9999.
- Audit log + PIN device-local (no DB bump); hash chain = tamper-evident only.

## gotchas
- Bash hook: <=10 statements, <=500 chars, no heredocs; use Write for scratchpad scripts (regress.sh, flaky.sh, reg1.sh).
- Top-level const in classic scripts not on window: use typeof X !== "undefined".
- waitForFunction async predicate always true; poll from Node. e.currentTarget null after await.
- Offline reload tests need serviceWorker.ready + wait. Fixed real bug: draftReady gate in app.js.
- New sale fields need rules checks (validSale <=40 keys).
- Deploy: npx -y firebase-tools@latest deploy --only firestore:rules,hosting --project mwakete-pos.

## git
- branch: claude/pensive-curie-l1iir1; HEAD ~004938a

## open-questions
- Marketplace API contract unavailable (stub only).
- User's "Create standoff" read as "write a handoff".
