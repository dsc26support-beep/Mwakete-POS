# Handoff — Mwakete POS tiers + Help centre
Branch: claude/beautiful-fermi-vdsx4j | Draft PR: dsc26support-beep/Mwakete-POS#2 (PR #1 merged)

## Goal
One app, 3 tiers chosen in Business setup: Counter (existing app, restaurants/micro-sellers), Retail (shops), Wholesale (trade). Plus in-app Help & guides (hybrid mgmt), Report a problem, support contacts.

## Next steps
1. User decides: mark PR #2 ready + merge. Must re-deploy google-apps-script/Code.gs after merge (new server validation).
2. Plan + build Wholesale (own PR): price tiers, bulk units, trade customers/invoices/credit, purchase orders, quotes/delivery notes.
3. Confirm Messenger handle moote.nakau is the business channel; get Marketplace URL -> OFFICIAL_LINKS in js/guides.js.

## State
- Done: Counter/Retail tiers (js/tiers.js, retail.js, tier-ui.js, retail-ui.js), IndexedDB v2 (+customers store), Retail guides, Code.gs validation, docs.
- Support contacts: admin@mwakete.com, m.me/moote.nakau, +686 73052765 (SUPPORT_CONTACTS in js/guides.js). SW cache v6.
- Tests: npm test 58/58; npm run test:e2e (Playwright) 41/41. Not tested: Android devices, printers, camera scan, real Apps Script, mail/dialler.

## Decisions
- One app + tier setting (not 3 apps): upgrade without data migration. Missing tier => counter, so existing installs unchanged.
- Tier = UI setting only, NOT authorization; backend must enforce.
- Customers local-only, unencrypted; sale carries opaque customerId only (no PII sync).
- Money in integer cents; Code.gs recomputes totals and rejects mismatches (previously accepted anything).
- Wholesale credit/invoices = production blocker until server-authoritative ledger.
- Report a problem: saved locally, never auto-sent; Copy/Email (user's own mail app).

## Gotchas
- PostToolUse formatter reformats on Edit/Write (bloated app.js once). Patch minified files with an exact-match python script in scratchpad (ruff must pass), verify git diff --stat.
- Bash hook: max 500 chars/10 statements. `git push` blocked by sixth-sense hook; user authorised override -> run scratchpad push.sh.
- `const X` in classic scripts is NOT window.X; app.js guards use window.RetailUI (exposed explicitly).
- Original bug fixed: e.currentTarget null after await in product form.
- Bump CACHE in service-worker.js (+appVersion in help.js) on any shipped JS change.

## Open questions
- Messenger handle correct? Marketplace URL? Merge PR #2 now?
