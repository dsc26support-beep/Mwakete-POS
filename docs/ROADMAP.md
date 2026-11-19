# Implementation roadmap

## Gate 1 — Identity, tenancy and data ownership
- Define independent-business tenant model and per-business Google Drive ownership.
- Define Mwakete identity bridge without duplicating marketplace accounts.
- Define shared Mwakete customer identity and retailer-scoped relationships.
- Complete OAuth consent, revocation and least-privilege scope review.
- Implement automated spreadsheet + Apps Script provisioning and recovery.
- Add tenant-isolation and consent tests.

## Gate 2 — Core POS
- Cashier sessions, roles, register open/close, discounts, refunds and receipts.
- Server-authoritative pricing and stock validation.
- Barcode scanner and thermal-printer support.

## Gate 3 — Offline reliability
- Durable outbox, retry/backoff, conflict handling and crash recovery.
- Explicit pending / syncing / synced / failed states.
- Never discard unconfirmed transactions.

## Gate 4 — Inventory and reporting
- Independent business stock ledger.
- Mwakete marketplace inventory adapter using existing APIs.
- Multi-outlet movements and reconciliation.
- Sales and stock reports.

## Gate 5 — Connection Hub
- CSV/Excel import, mapping, duplicate detection and reconciliation.
- Third-party POS APIs and webhooks.

## Gate 6 — Production readiness
- Security review, privacy controls, backups, monitoring, accessibility and performance.
- End-to-end tests on Android, desktop, barcode scanners and receipt printers.
