# Handoff (live) — Mwakete POS + Firebase

## Goal
Free offline-first 3-tier POS (Counter/Retail/Wholesale) for Kiribati. Firebase Auth (Email/Password) + Firestore, project `mwakete-pos`. User wants Firebase agent skills used; work continuously, ask only when essential.
Full handoff: .handoff/20261125-0830-firebase-pos-complete.md (also Drive: Claude Handoffs/mwakete-pos).

## State
- ALL buildable roadmap features done, tested, deployed (https://mwakete-pos.web.app). Rules audited+hardened, deployed.
- Tests green: unit 267; browser x10; rules emulator 41; cloud owner+cashier e2e; axe 0 violations; live smoke ok.
- PR #1 (draft) dsc26support-beep/mwakete-pos <- claude/pensive-curie-l1iir1; main created from 10235b7 (user OK). Subscribed to PR events.
- User asked "links and steps": given in chat for (1) delete smoke-test account + its Firestore business doc, (2) restrict API key to web.app/firebaseapp.com (Identity Toolkit, Token Service, Cloud Firestore APIs), (3) App Check reCAPTCHA v3 site key (send SITE key only, do not enforce yet), (4) Marketplace API docs.

## Next steps
1. Wait for user: App Check site key -> wire initializeAppCheck + ReCaptchaV3Provider in js/integrations/firebase.js load(); test; user then enforces in console; update SECURITY.md.
2. Wait for Marketplace API docs -> read first; keep tenant data separate; never break marketplace backend.
3. Supervised pilot on real phones/scanners/printers; fix findings.
4. Later: camera barcode, thermal printer, shared stock, independent security + tax-law review.

## Decisions (why)
- Standard Firestore, Sydney (free quota, nearest, immutable). No Blaze/Functions (user said no) => server can't verify totals; documented blocker.
- Stock per device; cashiers see only own records; staff deactivated not deleted; cloud optional.
- Backup never restores deviceCode/seq counters/cloud link (no duplicate invoice numbers).

## Gotchas
- Bash hook: <=10 statements, <=500 chars, no heredocs/inline scripts. Formatter rewrites files after Write: Read before Edit.
- e.currentTarget null after await. Playwright waitForFunction + async predicate is always true.
- Cloud e2e: NODE_PATH=$(npm root -g) npx -y firebase-tools@latest emulators:exec --only auth,firestore --project mwakete-pos "node tests/e2e/firebase-cloud.e2e.js"
- CLI logged in as admin@mwakete.com; env mwakete-pos allowlists Firebase hosts.

## Open questions
- Marketplace API contract + test env? Android packaging (package name + signing key)? Tax 12.5% / invoice wording reviewed by adviser?
