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

## Business tiers (Counter / Retail / Wholesale)
- **Counter** (done): the original app; default tier.
- **Retail** (done, local-only): barcode Enter-to-add, reorder levels, categories, discounts, receipts, customers, reports. Still needed for production: camera scanning, printer support, server-authoritative stock and pricing, customer sync under the retailer's own Google/Mwakete tenant, device-level data protection.
- **Wholesale** (next phase, not started): price tiers per customer group; bulk units (case/carton ↔ unit, minimum order quantity); trade customer accounts with invoice numbers and credit balances; purchase orders / supplier restock; quotes and delivery notes. Credit balances and invoices are financial records and are a **production blocker until the server-authoritative ledger exists**; any interim version must be local-only and labelled "not an official ledger".
- Tier is a UI setting; entitlement/permission enforcement belongs in the authenticated backend.

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
