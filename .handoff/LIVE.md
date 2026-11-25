# Handoff (live) — Mwakete POS + Firebase

## Goal
Free 3-tier POS (Counter/Retail/Wholesale) for Kiribati. Firebase backend: Email/Password Auth + Firestore. Project `mwakete-pos`.
User wants Firebase agent skills used for all Firebase work (plugin firebase@firebase installed, files in ~/.claude/plugins/marketplaces/firebase/skills; not registered as Skill tool until reload, read SKILL.md directly).

## State (done + verified)
- Web app registered: 1:648701661858:web:e96059c73228e578d43dfb (user's Android app ...android:a415bbcc... untouched; PWA can't use android ID).
- Auth Email/Password enabled+deployed. Firestore Standard, australia-southeast1, rules+indexes deployed (compiled OK).
- Hosting live: https://mwakete-pos.web.app (firebase.json hosting block, public=".", ignores tests/docs/*.md).
- App: optional "Cloud account" panel (js/cloud-ui.js), adapter js/integrations/firebase.js (+firebase-config.js, public IDs only), sync.js picks FirebaseBackend when signed in else GoogleBackend.
- Data: businesses/{ownerUid}/{sales,payments,customers}. Rules owner-only, append-only ledger, re-send ok only if identical.
- npm test 147/147 pass. Live Chromium smoke test passed (signup, sale, synced, signout).
- PR #1 (draft) dsc26support-beep/mwakete-pos -> main, branch claude/pensive-curie-l1iir1. Subscribed to PR events.

## Next steps
1. Emulator rules tests (needs emulator download host allowed via update_environment).
2. Items needing user/Cloud Console: restrict API key to domains; add authorized domains.
3. Decisions pending: staff/cashier roles, require email verification, product sync, App Check (needs reCAPTCHA key).

## Decisions / why
- Standard not Enterprise: Enterprise has no free quota; project must stay free.
- Sydney region: closest to Kiribati; cannot change later.
- Cloud sign-in optional: CLAUDE.md = offline-first, IndexedDB is queue, existing installs must keep working.
- Firestore memory cache only (no 2nd offline store); setDoc resolve = server confirmed; timeout 20s leaves record pending.
- Re-send rule (new data == stored) gives idempotent retries.
- Balances read back from Firestore in integer cents.

## Gotchas
- Bash hook limits: <=10 statements, <=500 chars; no inline python; write scripts to scratchpad.
- CLI login via `login --no-localhost <code>` (done, admin@mwakete.com). Env `mwakete-pos` (env_01PVna8f56ygeMpw2TPk9Nyw) allowlists Firebase hosts + mwakete-pos.web.app + www.gstatic.com.
- Remote default branch quirk: main did not exist remotely; user then authorised creating it (from 10235b7). User gave standing permission for branches/PRs; still ask before cost/deletes/GCP changes.
- .firebase/ ignored via .gitignore.
- Repo URL case: Mwakete-POS (push) vs mwakete-pos (API) both work.

## Open questions / user todo
- Delete test account mwakete.smoketest.1795582984250@example.com (Console > Auth > Users) + its Firestore business doc.
- Rules cannot verify sale total == line items (documented in SECURITY.md).
