# Handoff (live) — Mwakete POS + Firebase

## Goal
Free 3-tier POS (Counter/Retail/Wholesale) for Kiribati. Firebase backend: Email/Password Auth + Firestore. Project `mwakete-pos`.
User wants Firebase agent skills used for all Firebase work. Skills/agents now loaded: firebase:firestore-rules-author (subagent), firebase:firebase-security-rules-auditor.
User standing orders: keep going without stopping, consult only when absolutely necessary; may create branches/PRs on own.

## State (done, verified, deployed)
- Web app 1:648701661858:web:e96059c73228e578d43dfb (Android app ...android:a415bbcc... untouched).
- Auth Email/Password on. Firestore Standard, australia-southeast1. Rules + Hosting deployed. Live: https://mwakete-pos.web.app
- Verified email REQUIRED (rules + app). Roles: owner (bizId = uid) and cashier (active doc businesses/{id}/staff/{uid}). Sales/payments carry staffUid (rules enforce = writer). Cashier reads only own records; cannot write products/customers/staff.
- Product sync: owner pushes dirty products (updatedAt > cloudSyncedAt), all pull, LWW, stock per device (seeded only when new), tombstones for deletes (settings key productTombstones). Trade customers pulled to cashiers, never overwrite local.
- Code: js/integrations/firebase.js (+firebase-config.js public IDs), js/cloud-ui.js, js/sync.js (applyCloud), js/app.js (tombstone on delete).
- Tests all pass: npm test 167; tests/rules 25 (emulator, cd tests/rules && npm test); tests/e2e/firebase-cloud.e2e.js (owner+cashier vs Auth+Firestore emulators; ?emulator=1 on localhost only).
- PR #1 (draft) dsc26support-beep/mwakete-pos -> main, branch claude/pensive-curie-l1iir1, subscribed to events. main was created from 10235b7 with user's permission.

## Next steps (proposed to user, awaiting "go")
1. Run firebase-security-rules-auditor / firestore-rules-author on firestore.rules (rules were hand-written before those loaded).
2. Wholesale PR3 purchase orders, PR4 quotes/delivery notes, refunds/credit notes/void, payment allocation, statements.
3. Stock ledger, cloud reports, register open/close, CSV import, offline hardening, accessibility.
4. App Check (needs reCAPTCHA key from user).

## Decisions / why
- Standard not Enterprise (free quota); Sydney region (closest to Kiribati, immutable).
- Cloud sign-in optional (CLAUDE.md offline-first, IndexedDB = queue). Synced only after Firestore confirms; re-send idempotent (identical doc rule).
- Stock not synced: avoids multi-till overwrite.
- Server-side total checks need Cloud Functions = Blaze billing. Asked user yes/no; default = no, owner app trusted for prices (documented).

## Gotchas
- Bash hook: <=10 statements, <=500 chars, no inline python/heredoc scripts; use Write tool + Edit.
- Formatter hook rewrites files after Write; Read before editing if needed.
- e2e run: NODE_PATH=$(npm root -g) npx -y firebase-tools@latest emulators:exec --only auth,firestore --project mwakete-pos "node tests/e2e/firebase-cloud.e2e.js"
- e.currentTarget is null after await (fixed in cloud-ui).
- Env mwakete-pos (env_01PVna8f56ygeMpw2TPk9Nyw) allowlist: Firebase hosts, mwakete-pos.web.app, www.gstatic.com.

## Open questions / user todo
- Delete test account mwakete.smoketest.1795582984250@example.com + its Firestore business doc.
- Blaze/Functions yes or no; Mwakete marketplace API docs + test env; tax 12.5% and invoice wording; API key domain restriction; App Check key; Android packaging (package name + signing key); real-device pilot (scanners/printers).
