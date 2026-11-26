# handoff: capability-checklist
project: mwakete-pos
type: code
generated: 2026-11-25 09:00
goal: Close EVERY capability in the user's "Mwakete POS — Master Capability & Development Reference" PDF (POS-001..POS-172 + sections M, N, 4 UIs, architecture), keep all tests green ("nothing breaks 100%"), FREE only (no Blaze/paid services). Then security checks + fixes, then report + recommendations. Work non-stop.

## next-steps  <!-- resume here -->
1. Read PDF pages 13-37 (pp1-12 read): /root/.claude/uploads/ddc10b85-12cb-5e9a-8b4e-f1f85a5d6b09/809ce4bb-Mwakete_POS_Master_Capability_Development_Reference.pdf (c862978a-... is the same 37-page file). Max 20 pages per Read call.
2. Build docs/CAPABILITY_MATRIX.md: one row per POS-ID -> status (done|partial|missing) -> file/test proving it. VERIFY in code, don't trust PDF statuses (PDF says status != readiness).
3. Implement gaps (free workarounds), each with unit + browser tests; keep ALL suites green before any deploy.
4. Then security review pass + fixes, then final report with recommendations.
5. User-task workarounds (authorised: "complete via work arounds, no payment, nothing breaks"): (a) delete smoke-test account mwakete.smoketest.1795582984250@example.com: `firebase firestore:delete businesses/<uid> --recursive` (uid via `firebase auth:export`) + Auth user delete via Identity Toolkit admin REST with CLI token (hosts identitytoolkit/oauth2 already allowed); (b) API key restriction: only with a tested rollback, verify live sign-in after; (c) App Check: reCAPTCHA key can't be created free via CLI -> code stays optional/no-op until user supplies site key; (d) Marketplace: build DISCONNECTED optional adapter (status/authorize/disconnect screens, "not configured"), NO invented APIs.

## state
- done (see PR #1 + .handoff/20261125-0830-firebase-pos-complete.md): Firebase auth/roles/sync, refunds, register, stock, POs, quotes, delivery notes, statements, CSV, owner report, backup, diagnostics, retry, a11y. Live: https://mwakete-pos.web.app
- PDF gaps spotted in pp1-12 (verify first): hold/resume sale (008/009), change due (006/089), invalid-qty/checkout validation (011/012), product description/image/cost/wholesale price/UoM/availability/archive (033,035,039,040,042,044,045), bulk edit (047), stock valuation/reconciliation/alerts (056-059), discount authorization + price history + rounding (075,078,079,080), EFTPOS/IB/MPaisa recording, split + partial payments (082-086), receipt number/print (097,099), receipt delivery email/SMS/WhatsApp (101-106: free workaround = mailto:/sms:/wa.me links + queue/status), transaction search/filter/export/audit (112-119), security audit log + session mgmt (158,160), weekly/monthly/custom/profit reports (164-166,172), min wholesale qty + customer-specific pricing (076,069), device registration/management (section M), hardware + camera barcode (021,022,027,028), Micro POS UI w/ change calc.

## decisions
- Free only: no Blaze/Cloud Functions; no paid SMS/WhatsApp APIs -> use device links (sms:, wa.me, mailto:) + local delivery queue/status
- Don't claim Marketplace integration (no API contract); build honest disconnected adapter
- Regression rule: run unit + 10 browser suites + rules (41) + cloud e2e + a11y before every deploy

## verified
- works at last commit: unit 267, browser x10, rules 41, cloud e2e, axe 0, live smoke
- unverified: everything in PDF pp13-37; real devices; screen reader

## gotchas
- Bash hook: <=10 statements, <=500 chars, no heredocs/inline scripts. Formatter rewrites after Write: Read before Edit.
- e.currentTarget null after await; Playwright waitForFunction async predicate always true.
- Cloud e2e: NODE_PATH=$(npm root -g) npx -y firebase-tools@latest emulators:exec --only auth,firestore --project mwakete-pos "node tests/e2e/firebase-cloud.e2e.js"
- Tests are in tests/, tests/e2e, tests/rules, tests/a11y (see README "Full test inventory")
- CLI logged in admin@mwakete.com; env mwakete-pos allowlist has Firebase hosts; GitHub PR #1 draft, branch claude/pensive-curie-l1iir1

## git
- branch: claude/pensive-curie-l1iir1
- recent: fd5fe6b live handoff; 3781a5a handoff; 8f09b85 offline/a11y/backup/docs

## open-questions
- Marketplace API contract still unavailable (blocks real integration)
- PDF pp13-37 unread: may add requirements (monitoring, recovery, roadmap/dev rules)
