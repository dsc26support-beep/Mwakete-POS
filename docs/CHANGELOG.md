# Changelog

## 2026-11-25 (capability work)
- Checkout: cash change due, EFTPOS / internet banking / M-PAiSA recording (never "verified"), split payments, hold and resume sales, payment methods the shop accepts.
- Products: edit, archive, description, cost price (device only), unit, picture (device only), bulk edits, filters, stock value, price history, out-of-stock alerts, quantity cap, stock warning.
- Sales history: receipt numbers, search, filters, details, record checks, CSV export.
- Receipts: delivery queue through the user's own email / SMS / WhatsApp app with confirm / fail / retry.
- Customers: email, address, group.
- Reports: today, yesterday, week, month, custom range; filters; profit estimate with its assumptions; print and CSV.
- Staff roles: cashier, manager, inventory, auditor, enforced by Firestore rules.
- Security: screen-lock PIN, idle lock, lock-out, tamper-evident activity log, device name and device id on sales.
- Barcode: keyboard scanners anywhere on the till, camera scanning where supported, unknown barcode -> new product.
- App: PNG icons, install button, update banner, sync backlog count, first-run set-up card.
- Housekeeping: Auth smoke-test account and its data deleted; web API key limited to the two Hosting origins; optional App Check wiring; Mwakete adapter clearly "not connected".
- Fixed: a saved cart could be wiped on a slow start (draft restore race).

## Earlier
Firebase Auth + Firestore sync, roles, refunds, register, stock, purchase orders, quotes, delivery notes, statements, CSV, owner report, backup, diagnostics, accessibility. See `.handoff` notes and PR history.
