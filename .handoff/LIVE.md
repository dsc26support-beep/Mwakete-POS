# handoff: mwakete-pos-live
project: mwakete-pos
type: code
generated: 2026-11-26
goal: Camera scan on all phones + receipt share (WhatsApp/email) + user recs 2-5 done autonomously. Free only, all tests green before each deploy.

## state
- Branch claude/pensive-curie-l1iir1, HEAD ded0053 + handoff commit, pushed; draft PR #1.
- Full regression green (unit 381, browser 25 suites, a11y 0, rules 50, cloud e2e).
- Committed NOT deployed: bundled reader (vendor/), torch, PNG/PDF share, send-from-popup, partial-row closures, Mwakete create() draft (closed), TAX_NOTES (unverified), review fixes batch 1.
- DEPLOY BLOCKED: firebase CLI creds expired. User must run `firebase login --reauth --no-localhost`. Live site = old code.

## next-steps  <!-- resume here -->
1. After re-auth: deploy (npx -y firebase-tools@latest deploy --only firestore:rules,hosting --project mwakete-pos); csp-check.js live; scan-bundled.e2e.js with BASE_URL=https://mwakete-pos.web.app.
2. Open review findings: PIN to change approval limits; restore staffRole/clear business data on reload; refund duplicate/cumulative guard; held-sale re-pricing (checkout.js resumeLines keeps old prices); customers updatedAt guard; backup restore force pending; stronger device code; PBKDF2 PIN; firebase.json ignore *.log/*.md; narrow CSP script-src; precache vendor/* in SW; SHA-256 in vendor/README; Code.gs auth.
3. Rec 3 App Check: reCAPTCHA Enterprise key after re-auth, ReCaptchaEnterpriseProvider, enforce only after live test.
4. Update README counts, CHANGELOG, TESTING, register, PR #1 body.

## decisions
- Camera: bundle MIT reader (user chose). Mwakete: keep closed, adapter only (user chose).
- Review is self-run, labelled not independent / not legal advice.
- Hardware/paid rows stay documented, not claimed.

## gotchas
- Bash hook: <=10 statements, <=500 chars, no heredocs; use Write for scripts. Scratchpad regress.sh runs everything.
- Top-level const not on window; Playwright async waitForFunction always true.
- New synced fields need rules + productToCloud/CATALOGUE.

## open-questions
- Real-phone pilot results; Mwakete API contract; App Check key.
