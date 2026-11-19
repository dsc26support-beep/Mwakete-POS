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

Report vulnerabilities privately to the repository owner. Do not publish exploit details before a fix is available.
