# Implementation roadmap

## Status (25 November 2026)
| Gate | Done | Left |
| --- | --- | --- |
| 1 Identity, tenancy, data ownership | Firebase email/password sign-in with verified email; one business per owner; owner and cashier roles; staff stamping on every record; rules tested against the emulator (41 tests) and audited | Mwakete Marketplace identity bridge (API contract not available); Google Drive per-business provisioning (superseded by Firebase); App Check |
| 2 Core POS | Cashier roles, register open/close, discounts, refunds and credit notes, receipts, delivery notes, statements | Server-authoritative pricing and stock (needs Cloud Functions: not used); camera barcode scanning; thermal printer drivers |
| 3 Offline reliability | Durable local queue, automatic retry with backoff, pending / syncing / synced / refused states, unfinished sale survives a crash, nothing unconfirmed is ever discarded | Conflict handling between devices beyond "newest edit wins" for products |
| 4 Inventory and reporting | Stock movement audit trail, suppliers and purchase orders, owner whole-business report across all tills | Stock shared between devices; Mwakete marketplace inventory adapter; multi-outlet transfers |
| 5 Connection Hub | CSV product import and export with preview and duplicate detection | Customer import; third-party POS APIs and webhooks |
| 6 Production readiness | Accessibility scan and keyboard handling, backup and restore, diagnostics, performance on a slow CPU, tests for every feature | Independent security review, tax-law review, real-device pilot (phones, scanners, printers), manual screen-reader testing, monitoring beyond the on-device error log |

Wholesale (all four parts) is built: price lists and pack sizes, tax invoices and credit accounts, purchase orders, quotes and delivery notes.

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
- **Wholesale** (4 PRs). **PR 1 trade selling — done (local-only):** named price lists, pack sizes, trade customers, tax settings (12.5% default, prices before tax, per-product exempt). **PR 2 invoices and credit ledger — done, labelled NOT production-ready until authenticated sign-in exists** (Wholesale sales are tax invoices; Apps Script ledger with server-recomputed money and server-computed balances; per-record, idempotent sync; owner switch `LEDGER_ENABLED`; credit limit owned by the owner's Sheet; Accounts tab; payments against the balance). Remaining for production: authenticated identity and tenant validation, roles and audit log, credit notes/refunds/voiding, per-invoice payment allocation, statements, tax-law review. **PR 3 purchase orders / stock-in.** **PR 4 quotes and delivery notes** (quote → invoice idempotent). Original scope: price tiers per customer group; bulk units (case/carton ↔ unit, minimum order quantity); trade customer accounts with invoice numbers and credit balances; purchase orders / supplier restock; quotes and delivery notes. Credit balances and invoices are financial records and are a **production blocker until the server-authoritative ledger exists**; any interim version must be local-only and labelled "not an official ledger".
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
