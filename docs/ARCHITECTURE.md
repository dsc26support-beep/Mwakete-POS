# Architecture

A static, no-build web app (installable PWA). Everything runs in the browser; Firebase is optional.

## Layers
| Layer | What | Where |
|---|---|---|
| Screens (UI) | Read the page, call the cores, draw results. No business rules. | `js/*-ui.js`, `index.html`, `css/app.css` |
| Cores (logic) | Pure functions: no page, no storage. Unit tested in Node. | `js/checkout.js`, `catalogue.js`, `txn.js`, `delivery.js`, `analytics.js`, `security.js`, `scan.js`, `pwa.js`, `onboarding.js`, `refunds.js`, `register.js`, `stock.js`, `trade.js`, `csv.js`, `backup.js`, `cloudreport.js`, `invoices.js`, `retail.js`, `wholesale.js` |
| Local storage | IndexedDB `mwakete-pos-v1` (version 5): the offline queue and the working copy. | `js/db.js` |
| Sync | Sends confirmed-safe batches to Firebase; marks a record `synced` only after Firestore confirms. | `js/sync.js`, `js/integrations/firebase.js` |
| Cloud | Firebase Auth (email + password, verified email) and Firestore (Standard, australia-southeast1). | `firestore.rules`, `firebase.json` |
| Offline shell | Service worker caches every script, style and icon. | `service-worker.js` |
| Optional links | Mwakete Marketplace adapter, deliberately NOT connected. | `js/integrations/mwakete.js` |

## Editions
Counter (micro), Retail, Wholesale. `js/tiers.js` lists the features of each; elements with `data-feature="x"` are shown only when the edition has `x`. Switching edition never deletes data.

## Rules that hold everywhere
- IndexedDB is a queue, not the ledger of record. A sale is `pending` until Firestore confirms it.
- A recorded digital payment (EFTPOS, banking, M-PAiSA) is never marked verified.
- Sales, refunds, registers and stock moves are append-only; corrections are new records.
- Cost price and product pictures stay on the device. Cashiers can read the catalogue, so margins must not be in it.
- No secrets in the front end. The Firebase web config is public by design; access is enforced by rules.

## Adding a feature (the pattern)
1. Pure logic in `js/<name>.js` with `module.exports` for Node. 2. Tests in `tests/<name>.test.js`.
3. Screen in `js/<name>-ui.js`, markup in `index.html`, script tags in dependency order. 4. Add both files to `service-worker.js` and bump its cache number.
5. If a new field is synced: update `firestore.rules` and `tests/rules/rules.test.js`. 6. Browser test in `tests/e2e/`. 7. Update `docs/CAPABILITY_REGISTER.md`.
