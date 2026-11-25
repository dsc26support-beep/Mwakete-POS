# handoff: mwakete-pos-live
project: mwakete-pos
type: code
generated: 2026-11-25
goal: Close every PDF capability (POS-001..172, M, N), free only, all tests green; then security review and final report. STATUS: all done; only the optional follow-ups below remain.

## next-steps  <!-- resume here -->
1. Supervised pilot on real Android phones, scanner, printer (biggest unknown); fix what it finds.
2. Independent security review + Kiribati tax review of invoice wording (blockers in SECURITY.md).
3. User choice: App Check (paste reCAPTCHA v3 SITE key into js/integrations/firebase-config.js, test, then enforce in console).
4. When Mwakete API contract arrives: build adapter per docs/MWAKETE_INTEGRATION.md.
5. Optional: fill empty notes on Partial rows (POS-065,077,095,130,143), cloud sync of activity log/devices (needs DB v6), cloud role e2e through real sign-in, screen-reader test.

## state
- Register: 139 Verified, 33 Partial, 0 Missing (docs/CAPABILITY_REGISTER.md).
- Live https://mwakete-pos.web.app: rules + hosting + CSP deployed; branch claude/pensive-curie-l1iir1 (HEAD f437d90+), PR #1 draft updated.
- Tests last run green: unit 353, browser 19 suites, rules 50, cloud e2e, axe 0. Live sign-in + CSP check ok.
- Housekeeping done: smoke-test account + data deleted (Auth now empty); web API key limited to the 2 Hosting origins (rollback: set browserKeyRestrictions to {}); API Keys API was enabled (free) to do it; App Check wired but off.

## decisions
- Free only: receipt delivery via mailto/sms/wa.me + local queue; Delivered = user-confirmed.
- costPrice + images device-only; stock per device; stock warn-not-block.
- Audit log/PIN device-local (hash chain = tamper-evident only).
- Mwakete adapter closed (no network, no invented API).

## gotchas
- Bash hook: <=10 statements, <=500 chars, no heredocs/inline scripts: use Write for scratchpad scripts (regress.sh, flaky.sh, reg1.sh, csp-run.sh).
- Top-level const in classic scripts not on window: use typeof X !== "undefined".
- Playwright waitForFunction async predicate always true; offline-reload tests need serviceWorker.ready + wait.
- New sale fields need rules checks; new product fields need productToCloud + CATALOGUE + rules.
- Deploy: npx -y firebase-tools@latest deploy --only firestore:rules,hosting --project mwakete-pos.

## open-questions
- Marketplace API contract (blocks real integration).
- App Check site key from the owner (optional).
