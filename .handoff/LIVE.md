# handoff: mwakete-pos-live
project: mwakete-pos
type: code
generated: 2026-11-26
goal: Camera scan everywhere + receipt share (WhatsApp/email) + recs 2-5. Free only, tests green.

## state
- Branch claude/pensive-curie-l1iir1, HEAD ded0053 pushed; draft PR #1.
- Full regression green: unit 381, browser 25 suites, a11y 0, rules 50, cloud e2e.
- Built (committed, NOT deployed): bundled barcode reader (vendor/), torch, share receipt PNG/PDF, send from receipt popup, partial-row closures, Mwakete create() adapter draft (closed), tax notes, security-review fixes batch 1.
- DEPLOY BLOCKED: firebase CLI creds invalid -> user must run `firebase login --reauth` (--no-localhost). Live site still has old code (SW cache v32 in repo).

## next-steps  <!-- resume here -->
1. After re-auth: deploy rules+hosting (npx -y firebase-tools@latest deploy --only firestore:rules,hosting --project mwakete-pos); run csp-check.js live + scan-bundled.e2e.js with BASE_URL=https://mwakete-pos.web.app.
2. Review findings still open: PIN needed to change approval limits; restore staffRole/clear business data on reload; refund duplicate/cumulative guard; held-sale re-pricing (checkout.js resumeLines keeps old prices); customers updatedAt guard; backup restore force pending; stronger device code; PBKDF2 PIN; firebase.json ignore *.log/*.md; narrow CSP script-src; precache vendor/* in SW; SHA-256 in vendor/README; Code.gs auth.
3. App Check (rec 3): create reCAPTCHA Enterprise key after re-auth; wire ReCaptchaEnterpriseProvider; enforce only after live test.
4. Update README counts, CHANGELOG, TESTING, PR #1 body, register.

## gotchas
- Bash hook: <=10 statements, <=500 chars, no heredocs: use Write for scripts. Scratchpad regress.sh runs all suites.
- Top-level const not on window; Playwright async waitForFunction always true.
- New synced fields need rules + productToCloud/CATALOGUE.
