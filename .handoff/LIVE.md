# Handoff — Mwakete POS Wholesale tier
Branch: claude/beautiful-fermi-vdsx4j | Draft PR: dsc26support-beep/Mwakete-POS#4 (Wholesale PR 2 of 4). PR #1-#3 merged.

## Goal
3 tiers in one app (Counter/Retail/Wholesale). Wholesale in 4 PRs: 1 trade selling (merged), 2 invoices + credit ledger (PR #4, draft), 3 purchase orders, 4 quotes + delivery notes.

## Next steps
1. User: merge PR #4 (not yet asked/answered).
2. On go-ahead: plan PR 3 purchase orders / stock-in (suppliers, PO draft->ordered->received, goods-received idempotent by receipt id, append-only StockMovements sync). Then PR 4 quotes + delivery notes (quote->invoice conversion idempotent by quote id).
3. USER must re-deploy google-apps-script/Code.gs (new app does NOT work with old server) and, only if accepting the risk, set script property LEDGER_ENABLED=true.
4. Open: Messenger handle moote.nakau? Marketplace URL? Accountant review of tax treatment.

## State
- PR #4 pushed (cb64bf5): js/invoices.js (pure), js/invoices-ui.js, Code.gs schema v2, sync.js rewritten (per-record), IndexedDB v4 (+payments), Accounts tab, guides g-invoices/g-ledger, docs. SW cache v8.
- Tests: npm test 135/135; test:e2e tiers 41 + wholesale 54 + invoices 59 (real Code.gs via vm behind page.route). Not tested: deployed Apps Script, Android, printers.

## Decisions (user chose)
- Tax 12.5%, prices before tax, per-product exempt, Wholesale invoices only; discount reduces taxable base pro-rata; tax once per invoice, half-up, cents (BigInt).
- Ledger NOT production-ready (Apps Script has no verified sign-in); off until owner sets LEDGER_ENABLED=true; credit limit owned by owner's Sheet (client only seeds); balances server-computed.
- Over limit: warn + confirm, never block (offline). Payments against account balance, not per invoice.
- Invoice stored ON the sale (atomic); sale.total = gross; reports subtract sale.tax.
- Server answers per record; synced only when id returned; rejected kept with reason + Retry.

## Gotchas
- PostToolUse formatter reformats on Edit/Write: patch minified app.js/db.js/service-worker.js via exact-match python script in scratchpad (ruff clean); check git diff --stat.
- Bash hook: max 500 chars/10 statements; `git push` blocked by sixth-sense, user authorised override -> run scratchpad push.sh.
- Browser native min/max blocks submit before app validation: e2e sets form.noValidate. e2e needs NODE_PATH=$(npm root -g) for playwright.
- `const X` in classic scripts is NOT window.X (expose explicitly). Bump SW CACHE + help.js appVersion on JS changes.
- Stop hooks demand a push each time.

## Open questions
- Merge PR #4? Plan PR 3? Messenger handle? Marketplace URL?
