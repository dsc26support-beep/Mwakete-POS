# Handoff — Mwakete POS Wholesale tier
Branch: claude/beautiful-fermi-vdsx4j | Draft PR: dsc26support-beep/Mwakete-POS#3 (Wholesale PR 1 of 4). PR #1, #2 merged.

## Goal
3 tiers in one app (Counter/Retail/Wholesale). Wholesale delivered in 4 PRs: 1 trade selling, 2 invoices + credit ledger, 3 purchase orders, 4 quotes + delivery notes.

## Next steps
1. User: review/merge PR #3 (asked "mark ready and merge?" — not yet answered).
2. On user go-ahead: PR 2 invoices + credit ledger. Plan is in /root/.claude/plans/i-want-a-3-shimmering-parrot.md (may vanish): Apps Script ledger sheets (Invoices, InvoiceLines, Payments, Customers), server recomputes subtotal/tax/total in cents, balances computed server-side, idempotent by client id, invoice no. INV-<device code>-<n>, over-limit flag, apply tax here.
3. USER must re-deploy google-apps-script/Code.gs (Retail validation from PR #2 still not confirmed deployed).
4. Open: Messenger handle moote.nakau? Marketplace URL?

## State
- PR #3 pushed (61a3b9f): js/wholesale.js (pure), js/wholesale-ui.js, tiers.js (wholesale available; flags priceTiers, bulkUnits, tradeCustomers, tax), IndexedDB v3 (+priceLists), guides, docs, SW cache v7.
- Tests: npm test 81/81; test:e2e tiers 41/41 + wholesale 54/54. Not tested: Android, printers, camera, real Apps Script.
- Tax NOT applied to any sale yet (settings + maths only). Wholesale sales are till-paid like Retail until PR 2.

## Decisions (user chose)
- Tax 12.5%, prices before tax, all items taxed unless per-product exempt; tax on invoices/quotes only (not Counter/Retail).
- Named price lists; pack sizes (stock in base units); real Apps Script ledger; 4 PRs; ledger labelled "not production-ready until authenticated sign-in exists".
- Tax computed once on taxable subtotal, round half up (integer cents).
- Pack price fixed regardless of list; blank = unit price (list or base) x units.

## Gotchas
- PostToolUse formatter reformats on Edit/Write: patch minified app.js/db.js/service-worker.js with exact-match python script in scratchpad (ruff clean); check git diff --stat.
- Bash hook: max 500 chars/10 statements; `git push` blocked by sixth-sense, user authorised override -> run scratchpad push.sh.
- Browser's native min/max validation blocks submit before app validation; e2e sets form.noValidate to test app checks.
- `const X` in classic scripts is NOT window.X (expose explicitly). Bump SW CACHE + help.js appVersion on JS changes.
- Stop hooks demand a push each time.

## Open questions
- Merge PR #3? Start PR 2? Messenger handle? Marketplace URL?
