# handoff: mwakete-pos-live
project: mwakete-pos
type: code
generated: 2026-11-26
goal: Camera scan on all phones + receipt share (WhatsApp/email) + user recs 2-5 done autonomously. Free only, all tests green before each deploy.

## state
- DEPLOYED (hosting, SW cache v34; rules deployed earlier today). Branch claude/pensive-curie-l1iir1 pushed; draft PR #1. Firebase CLI logged in.
- Regression green before deploy (unit 382, browser 25 suites, a11y 0, rules 50, cloud e2e). Live: scan-bundled 11/11, CSP 0 violations, sign-in answers.
- App Check: reCAPTCHA v3 SITE key set in firebase-config.js (public). Not enforced. Secret key NOT with me: user must register site in Firebase console > App Check > Apps > Web.
- WHY preflight: with reCAPTCHA unreachable, Firebase Auth fails sign-in with network error once App Check is initialised; firebase.js recaptchaReachable() skips App Check for that visit. Reachable-path (real Google) cannot be tested from this sandbox (proxy blocks google.com/recaptcha).
- docs/DEPLOYMENT.md updated (App Check note) but uncommitted at handoff time unless later commit exists.

## next-steps  <!-- resume here -->
1. User: register reCAPTCHA v3 in Firebase console App Check (secret key there only), test on a real phone (sign in, sync), watch App Check metrics; enforce Firestore only after clean period. Rollback: untick enforcement or empty site key + redeploy.
2. Open review findings: PIN to change approval limits; restore staffRole/clear business data on reload; refund duplicate/cumulative guard; customers updatedAt guard; backup restore force pending; stronger device code; PBKDF2 PIN; firebase.json ignore *.log/*.md; narrow CSP script-src; precache vendor/* in SW; SHA-256 in vendor/README; Code.gs auth.
3. Update README counts, CHANGELOG, TESTING, register, PR #1 body.
4. User: real-phone pilot (camera, share sheet, printer); Kiribati tax check; Mwakete API contract.

## decisions
- Camera: bundle MIT reader. Mwakete: closed adapter only. Free only: reCAPTCHA Enterprise API not enabled (needs billing); classic v3 used.
- Review is self-run, not independent / not legal advice.

## gotchas
- Bash hook: <=10 statements, <=500 chars, no heredocs; use Write for scripts. Scratchpad regress.sh runs everything; csp-check.js / appcheck-diag.js for live checks.
- Firebase login: use `firebase login <code>` (state persists); fifo/background dies.
- scan-bundled dup-frame test must wait < 1.5s window.
- Top-level const not on window; new synced fields need rules + productToCloud/CATALOGUE.

## open-questions
- Real-phone App Check result; pilot results; Mwakete API contract.
