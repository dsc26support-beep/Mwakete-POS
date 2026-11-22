# Handoff — Mwakete POS tiers + Help centre
Branch: claude/beautiful-fermi-vdsx4j (reset to main @ 6378cff after merge). PR #1 and #2 both MERGED. No open PR.

## Goal
One app, 3 tiers chosen in Business setup: Counter (existing app, restaurants/micro-sellers), Retail (shops), Wholesale (trade). Plus Help & guides, Report a problem, support contacts.

## Next steps
1. USER must re-deploy google-apps-script/Code.gs (new server-side total/discount validation; old script accepts any total).
2. Plan then build Wholesale in its own PR (user said to do it next only when asked): price tiers, bulk units, trade customers/invoices/credit, purchase orders, quotes/delivery notes.
3. Confirm Messenger handle moote.nakau is the business channel; get Marketplace URL -> OFFICIAL_LINKS in js/guides.js.
4. Optional: drop .handoff/LIVE.md from main if user does not want session notes in the repo.

## State
- Shipped on main: Counter/Retail tiers (js/tiers.js, retail.js, tier-ui.js, retail-ui.js), IndexedDB v2 (+customers), Retail guides, Code.gs validation, Help centre, Report a problem, support contacts (admin@mwakete.com, m.me/moote.nakau, +686 73052765). SW cache v6.
- Tests at merge: npm test 58/58; npm run test:e2e 41/41. Not tested: Android devices, printers, camera scan, real Apps Script, mail/dialler.

## Decisions
- One app + tier setting (not 3 apps). Missing tier => counter, so existing installs unchanged. Tier is UI-only, NOT authorization.
- Customers local-only/unencrypted; sales carry opaque customerId only.
- Money in integer cents; server recomputes and rejects mismatches.
- Wholesale credit/invoices = production blocker until server-authoritative ledger.
- Merge commits used for both PRs.

## Gotchas
- PostToolUse formatter reformats on Edit/Write (bloated app.js once). Patch minified files with exact-match python (ruff must pass); check git diff --stat.
- Bash hook: max 500 chars / 10 statements. `git push` blocked by sixth-sense; user authorised override -> run scratchpad push.sh.
- `const X` in classic scripts is NOT window.X (expose explicitly).
- Bump CACHE in service-worker.js (+appVersion in js/help.js) on any shipped JS change.
- Stop hooks demand a push each time.

## Open questions
- Messenger handle correct? Marketplace URL? Start Wholesale planning?
