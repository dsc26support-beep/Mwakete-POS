# Offline and sync

## Offline
- The service worker caches the whole app on first visit; later visits open with no internet.
- Every sale, refund, register shift, stock move and quote is written to IndexedDB first.
- Cart in progress is saved on the device (`cartDraft`) and restored after a crash. Saving only starts after the draft was read at start-up, so a slow start cannot wipe it.
- Held sales (`heldSales`) and the receipt delivery queue (`deliveryQueue`) are also on the device.

## Sync states of a record
`pending` (waiting) -> `synced` (Firestore confirmed) or `rejected` (rules refused it; it stays on the device with the reason). A record is never marked `synced` on a guess.

## How a sync run goes
1. Collect unsynced records. 2. Write each to Firestore with its own id (same id = same document, so a retry is safe: rules accept an identical re-send). 3. Mark only the ids Firestore confirmed. 4. Pull the catalogue and trade customers. 5. On failure, back off 30 s doubling to 15 min (+-25%); "Verify your email" does not back off.

## Conflicts
- Sales and other ledger records cannot conflict: each has a unique id and never changes.
- Products: the newest edit wins (`updatedAt`); removal markers (tombstones) make deletes travel. Stock counts stay per device on purpose.
- A record refused by the rules is shown as "refused by the cloud" and can be retried after fixing it.

## What is not shared
Stock between devices, cost price, pictures, the PIN, the activity log, held sales and the delivery queue.
