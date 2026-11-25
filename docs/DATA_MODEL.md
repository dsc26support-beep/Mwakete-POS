# Data model

## Local (IndexedDB `mwakete-pos-v1`, version 5)
Stores: `products`, `sales`, `customers`, `priceLists`, `payments`, `refunds`, `registers`, `stockMoves`, `suppliers`, `purchaseOrders`, `quotes`, `settings` (key/value).
Settings keys include: `businessName`, `currency`, `payMethods`, `deviceCode`, `deviceName`, `receiptSeq`, `invoiceSeq`, `cartDraft`, `heldSales`, `deliveryQueue`, `auditLog`, `pinRecord`, `pinFail`, `idleMinutes`, `onboarded`, `setupDismissed`, `productTombstones`, `cloudBusiness`.
Device-only settings are left out of backups (see `SKIP_SETTINGS` in `js/backup.js`).

## Sale (synced)
`id`, `createdAt`, `currency`, `items[{productId,name,sku,unitPrice,quantity,packId?,packUnits?}]`, `total`, `paymentMethod` (`cash|eftpos|internet_banking|mpaisa|other|account|split`), `paymentVerified` (true only for all-cash), `payments[{method,amount,reference?}]`, `tendered`, `change`, `receiptNo` (R-<device>-n), `deviceId`, `staffUid`, `syncStatus`; Retail/Wholesale add `customerId`, `discount`, `subtotal`, `tax`, `tier`, `invoice{}`.

## Cloud (Firestore `businesses/{ownerUid}/...`)
`staff/{uid}` (role: cashier, manager, inventory, auditor; active), `sales`, `payments`, `refunds`, `registers`, `stockMoves` (append-only), `products`, `customers`, `suppliers`, `purchaseOrders`, `quotes`.
The business id is the owner's uid. Field-by-field limits are in the header of `firestore.rules`; every limit has a test in `tests/rules`.

## Roles
| Role | Sells | Catalogue / customers | Stock, suppliers, orders | Reads others' records | Staff / business |
|---|---|---|---|---|---|
| Owner | yes | yes | yes | all | yes |
| Manager | yes | yes | yes | all | no |
| Cashier | yes | no | stock moves | own only | no |
| Inventory | no | products only | yes | no | no |
| Auditor | no | no | no | all (read only) | no |
