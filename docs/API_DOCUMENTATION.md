# API documentation

This app has no server of its own. The only network services it uses are Firebase (Authentication, Firestore) and Firebase Hosting. There is no public API to document yet.

## Browser modules (the "API" between parts of the app)
Each core exports plain functions; screens call them. The main ones:

| Module | Main functions |
|---|---|
| `CheckoutCore` | `changeDue`, `build` (payments), `makeHold`, `addHold`, `resumeLines`, `cashPortion`, `methodTotals` |
| `CatalogueCore` | `applyEdit`, `bulk`, `filter`, `valuation`, `availability` |
| `TxnCore` | `nextReceiptNumber`, `status`, `filter`, `exportCsv`, `checkIntegrity`, `timeline` |
| `DeliveryCore` | `make`, `move`, `buildLink`, `shortText`, `normalizePhone` |
| `AnalyticsCore` | `range`, `build`, `toCsv` |
| `SecurityCore` | `append`, `verify` (audit chain), `makePin`, `checkPin`, `afterAttempt` |
| `ScanCore` | `createBuffer`, `isDuplicate`, `cameraSupport` |
| `RefundCore`, `RegisterCore`, `StockCore`, `TradeCore`, `CsvCore`, `BackupCore` | see the header comment of each file |
| `FirebaseBackend` | `signIn`, `signUp`, `signOut`, `sync`, `saveStaff`, `joinBusiness`, `fetchReport` |

## Firestore documents
See DATA_MODEL.md and the header of `firestore.rules`.

## Mwakete Marketplace
Not connected. See MWAKETE_INTEGRATION.md.
