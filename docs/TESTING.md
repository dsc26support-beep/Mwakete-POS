# Testing

Run everything with one script, or one group at a time. Nothing is claimed as tested unless it was run.

| Group | Command | What it proves |
|---|---|---|
| Unit (Node, no install) | `npm test` | all pure logic: payments, catalogue, transactions, delivery, reports, security, scanning, sync, rules text |
| Browser (Playwright) | `NODE_PATH=$(npm root -g) npm run test:e2e` | every screen end to end, offline reload, PWA install/update, scanner, lock, reports |
| Firestore rules (emulator) | `cd tests/rules && npm install && npm test` | who may read or write what, per role |
| Cloud flow (emulator) | `NODE_PATH=$(npm root -g) npx -y firebase-tools@latest emulators:exec --only auth,firestore --project mwakete-pos "node tests/e2e/firebase-cloud.e2e.js"` | owner and cashier sign in, sync, refunds, stock, reports |
| Accessibility | `cd tests/a11y && npm install && NODE_PATH=$(npm root -g) node a11y.e2e.js` | axe scan of every screen in every edition, dialogs, keyboard focus |

## Before any deploy
All five groups must pass. Then: `npx -y firebase-tools@latest deploy --only firestore:rules,hosting --project mwakete-pos` and open the live site once.

## Known gaps (not covered by automation)
- Real phones, real barcode scanners and printers (a supervised pilot is needed).
- A screen reader (automated checks only).
- Camera scanning is tested with a faked camera and detector.
- Load beyond about 5,000 products or 3,000 sales per device.

## Writing a test
Pure logic: add `tests/<name>.test.js` (`node:test`). Screens: copy a file in `tests/e2e/`, poll from Node (a Playwright wait with an `async` function is always true). Rules: add to `tests/rules/rules.test.js`.
