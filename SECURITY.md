# Security policy

This repository is not production-ready for live customer or payment data.

Before production:
1. Implement Google OAuth using a verified OAuth client and least-privilege scopes.
2. Implement a secure provisioning flow that creates resources in the consenting owner's Google Drive.
3. Authenticate every backend request; never trust a tenant/business ID supplied by the browser.
4. Enforce tenant isolation server-side.
5. Validate all prices, quantities, permissions and transaction payloads server-side.
6. Use idempotency keys and a durable transaction ledger.
7. Verify digital payments with the payment provider; never trust client-side success.
8. Add audit logs, rate limits, monitoring, backup and recovery tests.
9. Minimise local customer data and provide device logout / local-data clearing controls.
10. Keep secrets in platform secret stores; never commit them to Git.

## Guides & Links (Help tab)
- Official guides are bundled with the app, not fetched at runtime, so no remote content can be injected into them. Remote publishing must not be added without authenticated admin roles and server-side validation.
- Business links and notes are untrusted input: every value is HTML-escaped on render, and links are re-validated at render time (https only, no credentials, no localhost/IP/intranet hosts, no `javascript:` / `data:`).
- External links use `rel="noopener noreferrer"` and show a confirmation naming the destination domain.
- Business notes are stored unencrypted in the browser on that device and are visible to anyone with access to the browser profile. Users are warned not to store passwords, tokens or keys there.
- Problem reports are stored locally, escaped on render, length-limited (1000 chars, 50 reports) and never transmitted by the app. Copy/Email are user-initiated; the diagnostics block is opt-in and allow-listed (app version, online flag, browser string) so sales, products, customers and the backend URL can never leak into a report. The mailto address must be a single valid address set in code.
- Any local user can currently add/remove business links; there are no owner/cashier roles until the authenticated backend exists.

## Business types (Counter / Retail / Wholesale)
- The business type is a **local UI setting only**. It is not an authorization or entitlement check and must never be trusted by a server. Production must enforce what each business may do server-side.
- Discounts and totals are computed in the browser. The server **must not trust them**: the sample `Code.gs` recomputes each sale in integer cents and rejects mismatches, over-large discounts and malformed items. Any production backend must do the same, plus validate prices against its own catalogue.
- Customers (name, optional phone, note) are stored **unencrypted on the device**, scoped to that business, and never sent to the backend or shared with other businesses. Sales reference a customer only by an opaque local ID. Anyone with access to the browser profile can read them; add device protection and a data-clearing control before production.
- Reports and stock counts are local approximations, not an authoritative ledger.
- Receipts label non-cash payments "recorded, NOT verified". The app still does not verify digital payments.
- Wholesale credit balances and invoices (planned) are financial records and **must not ship as local-only data** in production; they need the server-authoritative ledger.

Report vulnerabilities privately to the repository owner. Do not publish exploit details before a fix is available.
