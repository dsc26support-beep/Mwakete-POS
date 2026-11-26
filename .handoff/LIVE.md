# handoff: mwakete-pos-live
project: mwakete-pos
type: code
generated: 2026-11-26
goal: Camera scan on all phones + receipt share (WhatsApp/email) + user recs 2-5 done autonomously. Free only, all tests green before each deploy.

## state
- DEPLOYED 2026-11-26 (rules + hosting) from branch claude/pensive-curie-l1iir1 (pushed; draft PR #1). Firebase CLI re-authed (login works until creds expire again).
- Live checks ok: scan-bundled e2e 11/11 vs https://mwakete-pos.web.app; CSP 0 violations; sign-in endpoint answers.
- Regression before deploy green (unit 381, browser 25 suites, a11y 0, rules 50, cloud e2e).
- App Check (rec 3): reCAPTCHA Enterprise API is DISABLED on project; enabling likely needs billing (Blaze) = against free-only rule. NOT enabled. Script: scratchpad appcheck-key.js (list/create).

## next-steps  <!-- resume here -->
1. User decision: App Check via free classic reCAPTCHA v3 (user creates site key at google.com/recaptcha/admin, domains mwakete-pos.web.app + mwakete-pos.firebaseapp.com, pastes SITE key; I wire + register in App Check console) or skip.
2. Open review findings: PIN to change approval limits; restore staffRole/clear business data on reload; refund duplicate/cumulative guard; customers updatedAt guard; backup restore force pending; stronger device code; PBKDF2 PIN; firebase.json ignore *.log/*.md; narrow CSP script-src; precache vendor/* in SW; SHA-256 in vendor/README; Code.gs auth.
3. Update README counts, CHANGELOG, TESTING, register, PR #1 body (note deploy done).
4. User: real-phone pilot (camera, share sheet, printer); Kiribati tax check; Mwakete API contract.

## decisions
- Camera: bundle MIT reader (user chose). Mwakete: keep closed, adapter only (user chose).
- Review is self-run, labelled not independent / not legal advice.
- Free only: do not enable billing-linked APIs.

## gotchas
- Bash hook: <=10 statements, <=500 chars, no heredocs; use Write for scripts. Scratchpad regress.sh runs everything.
- Firebase login: background process dies when Bash call ends; use `firebase login <code>` (state persists) not a fifo.
- Top-level const not on window; Playwright async waitForFunction always true.
- New synced fields need rules + productToCloud/CATALOGUE.

## open-questions
- App Check choice; real-phone pilot results; Mwakete API contract.
