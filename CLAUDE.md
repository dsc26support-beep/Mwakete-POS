# Mwakete POS — development instructions

## Product principles
- Free forever for essential checkout.
- Offline-first, fast on low-cost Android devices and low-bandwidth connections.
- Independent businesses own their Google data.
- Mwakete Marketplace sellers reuse existing Mwakete identity, customer and inventory services.
- Never break the existing Mwakete marketplace backend.

## Mandatory workflow
1. Inspect the whole repository and existing Mwakete API contracts before changing integrations.
2. Separate independent-business data from Mwakete Marketplace tenant data.
3. Implement secure Google OAuth and owner-authorised provisioning before claiming Google connection is complete.
4. Never put secrets in frontend files or Git.
5. Keep IndexedDB as an offline queue, not the authoritative cloud ledger.
6. Make sync idempotent; never mark a transaction synced until the server confirms its ID.
7. Do not treat a recorded digital-payment method as verified payment.
8. Add tests for every feature and report actual results. Never claim tests were run if they were not.
9. Preserve existing accounts, customers, orders, products and inventory.
10. Update README and SECURITY.md when behaviour changes.

## Completion report
Report completed, partial, not implemented and blocked items separately. Include changed files, API assumptions, security controls, tests and failures, deployment steps, required secrets/configuration and remaining production blockers.
