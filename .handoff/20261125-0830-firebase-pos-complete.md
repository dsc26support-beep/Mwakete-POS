# handoff: firebase-pos-complete
project: mwakete-pos
type: code
generated: 2026-11-25 08:30
goal: Free offline-first 3-tier POS (Counter/Retail/Wholesale) for Kiribati on Firebase (Email/Password Auth + Firestore). All buildable roadmap features done, tested, deployed. Remaining = user-side console tasks + pilot.

## next-steps  <!-- resume here -->
1. User does console tasks (links/steps given in chat): delete smoke-test account; restrict API key to domains; create App Check reCAPTCHA key; send Mwakete Marketplace API docs.
2. When App Check site key arrives: wire it in js/integrations/firebase.js load() (initializeAppCheck + ReCaptchaV3Provider), enforce in console AFTER testing, add to SECURITY.md.
3. When Marketplace API docs arrive: read them first (CLAUDE.md rule 1), keep marketplace tenant data separate from independent-business data, never break marketplace backend.
4. Supervised pilot in one shop on real Android phones/scanners/printers; fix what it finds.
5. Optional later: camera barcode scan, thermal printer, stock shared across devices, independent security + tax-law review.

## state
- done: Auth Email/Password + verified email required; owner/cashier roles (rules); staffUid stamp; append-only ledgers; idempotent sync (synced only after Firestore confirms)
- done: refunds/credit notes, register shifts, stock moves, suppliers+POs, quotes->one invoice, delivery notes, statements (oldest-first allocation), CSV import/export, owner whole-business report, product sync, backup/restore, diagnostics, retry backoff, cart crash recovery, list caps for slow phones, a11y (axe 0 violations)
- done: rules audited+hardened and deployed; Hosting live https://mwakete-pos.web.app; Firestore Standard australia-southeast1
- PR #1 (draft) dsc26support-beep/mwakete-pos <- claude/pensive-curie-l1iir1, subscribed to events; main created from 10235b7 with user's OK

## changes
- A js/{refunds,register,stock,trade,csv,backup,diagnostics,cloudreport,a11y}.js + *-ui.js — pure cores + screens
- M js/integrations/firebase.js — adapter: roles, generic `extra` kinds, report read, emulator switch (localhost ?emulator=1 only)
- M js/sync.js — SyncBackoff, applyExtra, applyCloud
- M firestore.rules — validators for all kinds; audit fixes (invoice total==sale total, no verified non-cash, validTime +7d)
- M css/app.css — contrast fixes (#6d6780 muted, #6a4fd3 purple, #bf3a52 red, #1f7a54 green)
- M service-worker.js — cache v18; non-navigation failures return Response.error() not index.html

## decisions
- Standard not Enterprise (free quota); Sydney region (immutable)
- No Blaze/Cloud Functions (user said no) => server cannot verify sale totals; documented as blocker
- Stock per device (avoid multi-till overwrite); cashiers see only own records; staff never deleted (active=false)
- Cloud optional (offline-first, IndexedDB = queue)
- Backup excludes deviceCode/seq counters/cloudBusiness/cartDraft/registerOpen/errorLog (no duplicate invoice numbers)
- rejected: firestore-rules-author subagent — its tool names don't exist here (wrote rules directly per skill fallback)

## verified
- works: npm test 267; browser suites x10 (tiers 41, wholesale 54, invoices 59, refunds 24, register 21, stock 38, trade 31, csv 22, resilience 27, backup 26); rules emulator 41; cloud owner+cashier e2e; a11y scan 0; live site smoke after deploy
- unverified: real phones/scanners/printers; screen reader; App Check; load beyond 5k products

## gotchas
- Bash hook: <=10 statements, <=500 chars, no inline scripts/heredocs; use Write/Edit
- Formatter hook rewrites files after Write; Read before Edit
- e.currentTarget is null after await (bit cloud-ui, register-ui) — capture form first
- Playwright waitForFunction with async predicate is always true — poll from Node
- Script order: trade.js loads before invoices.js; resolve InvoiceCore lazily
- Firebase CLI login via `login --no-localhost <code>`; env mwakete-pos (env_01PVna8f56ygeMpw2TPk9Nyw) allowlists Firebase hosts
- e2e run: NODE_PATH=$(npm root -g); cloud: emulators:exec --only auth,firestore --project mwakete-pos "node tests/e2e/firebase-cloud.e2e.js"
- node_modules/.firebase ignored via .gitignore

## git
- branch: claude/pensive-curie-l1iir1
- uncommitted: clean except this handoff
- recent: 8f09b85 offline hardening/a11y/backup/docs; 5ce218e CSV+report; 520e53a trade paperwork

## open-questions
- Marketplace API contract + test env? (blocks integration)
- Android packaging of the PWA (TWA)? needs package name + signing key
- Tax 12.5% and invoice wording confirmed by a Kiribati tax adviser?
