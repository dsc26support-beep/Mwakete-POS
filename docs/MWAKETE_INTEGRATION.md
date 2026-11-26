# Mwakete Marketplace integration (optional, NOT connected)

The POS works fully on its own. `js/integrations/mwakete.js` is a closed door: it reports "not connected", refuses every action with a clear message, and makes no network call (checked by `tests/mwakete.test.js`). No Mwakete API was invented.

## What the Mwakete team must supply before it can be built
1. The identity / sign-in service for sellers, and how a POS device is authorised for one store.
2. Catalogue and inventory endpoints (read products, read and change stock) with data shapes.
3. The order / sale submission endpoint, an idempotency-key rule, and error codes.
4. The tenancy rule: which store a seller owns, and how marketplace data is kept apart from independent-business data.
5. A test environment and test accounts.

## Contract to fill in
| Item | Value |
|---|---|
| Base URL (test / live) | |
| Auth method and token lifetime | |
| Store (tenant) identifier | |
| GET catalogue | path, fields, paging |
| POST sale | path, body, idempotency header, response |
| Stock change | path, body, conflict rule |
| Error codes and retry advice | |

## Rules for whoever builds it
- Marketplace sellers use the existing Mwakete identity, customers and inventory; never create a second source of truth.
- Keep marketplace tenant data separate from independent-business Firestore data.
- Sales go to the marketplace only after the server confirms the sale id; reuse the same `pending -> synced` rule.
- Never put a secret in the front end. Tests for the adapter must prove no call is made without configuration.
