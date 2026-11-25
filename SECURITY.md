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
- Wholesale part 1 (price lists, pack sizes, trade customers) is **local-only and unencrypted** on the device. Trade customer details (name, phone, credit limit, terms, tax number) do not leave the device; a sale carries only an opaque `customerId` and `priceListId`. A credit limit is a note, not a control. Prices are chosen client-side, so the server can validate only arithmetic until a server-side catalogue exists. Tax is applied to Wholesale invoices from PR 2 (see below).
- **Credit ledger (PR 2) is NOT production-ready.** The Apps Script has no verified sign-in, so it **must not be used with real customer or payment data** until authenticated Google sign-in and owner-authorised provisioning exist. Anyone who learns the Web App URL could call it. Mitigations (not authentication): the ledger is **off until the owner sets `LEDGER_ENABLED=true`**; request size and batch limits; script lock around writes; the app and docs label it clearly.
- Invoices write the customer's name, tax number, and (via seeding) trade customer details to the business's **own** Google Sheet, so Wholesale invoices, unlike Retail customers, do leave the device. Each business must use its own spreadsheet and Apps Script; never share one between businesses.
- **The server never trusts browser money.** `Code.gs` recomputes subtotal, discount, taxable amount, tax and total in integer cents (BigInt for the ratios), rejects mismatches, rejects tax on a non-invoice sale, optionally pins the tax rate (`TAX_RATE`), and computes balances itself. A balance sent by a client is never used. Prices are still chosen by the browser, so only arithmetic can be checked until a server-side catalogue exists.
- **The credit limit is owner-controlled:** the client may only seed a new `Customers` row; it can never change an existing limit.
- Sync is per record: a rejected record is kept and flagged with its reason (never silently dropped); a record is "synced" only when the server returns its id; idempotency means retries cannot double-count an invoice or payment. A reused invoice number with a different sale id is rejected.
- Payments are cash only and are recorded by a cashier on the device; there is no verification that cash was received and no staff roles or audit trail yet. Anyone using the device can record a payment or invoice.
- Unresolved before production: authenticated identity, tenant validation, audit log, roles (owner vs cashier), credit notes/refunds and voiding, tax-law review of invoice wording and rounding (12.5% on the discounted taxable amount, rounded half up once per invoice), and a statement/reconciliation process.

## Firebase cloud account (Email/Password + Firestore)
- **Optional.** The app works fully offline without it. IndexedDB remains the offline queue; Firestore is the cloud ledger. Firestore runs with its default in-memory cache only (no second offline store).
- **Identity:** Firebase Authentication, Email/Password, project `mwakete-pos`. Passwords never touch this app's code or storage; Firebase handles them. Password reset uses Firebase's email link. **A verified email is required**: the rules refuse every read and write from an unverified account, and the app does not sync until verified.
- **Tenancy:** each business lives at `businesses/{ownerUid}`. `firestore.rules` allow only that signed-in user to read or write it; everything else is denied by default. Independent-business data is separate from Mwakete Marketplace data, and nothing here touches the marketplace backend.
- **Append-only ledger:** `sales` and `payments` can be created but never deleted. A re-send is accepted only if identical to the stored record, so retries are idempotent and stored records cannot be altered. `customers` can be edited by the owner but never deleted.
- **Synced means confirmed:** a record is marked synced only after Firestore confirms the write. A rules refusal is kept as "rejected" with a reason. A timeout or network error leaves the record pending.
- **Public web config:** `js/integrations/firebase-config.js` holds public identifiers, not secrets. Restrict the API key to the app's domains in Google Cloud Console and keep the rules deployed. Never commit service-account keys or admin credentials.
- **Roles (enforced by the rules, not the UI):** *owner* = the account whose uid is the business ID; *cashier* = a verified account with an **active** record at `businesses/{id}/staff/{uid}` created by the owner. Cashiers can create sales and payments and read the catalogue and trade customers; they cannot write products, customers, staff or the business record, and can read only records they wrote. Staff records are never deleted (access is removed by setting `active` to false). A cashier cannot add themselves or change their own record. The "business code" and "staff code" are account IDs, not passwords: they are useless without the owner adding that account as staff.
- **Audit trail:** every sale and payment must carry `staffUid` equal to the writer's uid; the rules refuse impersonation. A re-send is accepted only from the same writer.
- **Product sync:** only the owner writes `products`. Conflicts: newest `updatedAt` wins. Stock is per device and is not overwritten by sync. Deleting a product is an owner action and a deleted product is removed from synced devices.
- **Test-only emulator switch:** the app connects to local emulators only when the page is served from `localhost` with `?emulator=1`. It cannot be triggered on the real site.
- **Known limits (production blockers):** rules cannot verify that a sale's total equals its line items, so the owner's own app (and a cashier's app) is trusted for prices and totals; the business and staff codes are guessable only by someone who knows the account ID; a cashier's device keeps its local data after access is removed (sign out and clear site data on a lost device); the rules are tested against the Firestore emulator (`tests/rules`, 25 tests) and the owner/cashier flows against the Auth and Firestore emulators, but only with the cases written there, and have had no independent security review; no App Check; no per-device revocation; no rate limiting beyond Firebase's defaults.

## Controls added with the full feature set
- **Credit notes (refunds):** append-only, stamped with who recorded them. The cloud rules require the original sale to exist, the credit note to be no larger than that sale, and a credit to a customer's account to match an invoice on account for the same customer. The rules **cannot add up several credit notes** against one sale; the app does that sum exactly (integer cents, the last refund returns exactly what is left) and the owner can audit the list.
- **Register shifts:** a closed shift is append-only. The expected-cash arithmetic runs on the device that sold, so a person with the device can change the numbers before they sync; the shift report is an aid for honest counting, not proof against theft.
- **Stock movements:** append-only audit trail with a reason. Stock itself is **per device**: nothing stops two devices from selling the same last item, and a sale or refund changes stock without writing a movement.
- **Suppliers and purchase orders:** owner only. An order can be edited until it is received or cancelled, never rolled back to an older version (`updatedAt` must not go backwards), and receiving writes one movement per line.
- **Quotes:** a member edits only their own quote while it is open; the owner can edit any open one. A quote becomes an invoice once: "Make invoice" loads the till, and the quote is marked converted only after the sale is saved and only if the sale contains the quoted goods for the quoted customer.
- **CSV import:** a preview first, nothing saved until confirmed; 2 MB and 5,000-row limits; every row validated; duplicates by barcode then name; stock counts kept unless chosen. **Export** neutralises spreadsheet formulas (a leading `= + - @` gets an apostrophe).
- **Backup and restore:** a backup file is **plain text** with the business's customers (names, phones), prices and sales. Keep it private; it is not encrypted. Restore validates every record, ignores unknown record kinds, skips and lists bad records, replaces records with the same ID and deletes nothing, and **never restores** the device code, document counters, cloud sign-in link, unfinished cart, open register or error log (so restoring onto a second device cannot cause duplicate invoice numbers).
- **Diagnostics:** an error log of the app's own messages (30 newest) is kept on the device. The support summary contains versions, counts and error text only. Nothing is sent unless the person copies or emails it.
- **Unfinished sale:** the cart is saved in IndexedDB so a crash does not lose it. It is not encrypted (like everything else on the device).
- **Retry:** a failed sync retries on its own with backoff (30 s up to 15 min, +/-25%). Errors the person must fix (no backend, unverified email) are not retried on a timer.
- **Rules audit:** the Firestore rules were audited against a red-team checklist. Fixed: unchecked invoice/discount/tax/tier types on a sale, an invoice total that could differ from its sale, a non-cash payment marked verified, back- or forward-dated records (limit: 7 days ahead of the server clock), and an unbounded staff ID length.
- **Accessibility:** every screen in every business type, plus the dialogs, passes an automated WCAG 2.0/2.1 A and AA scan (axe), including colour contrast; dialogs trap and restore keyboard focus; clickable rows work with Tab, Enter and Space. Manual testing with a screen reader is still to do.

## Browser protections
Hosting sends a Content-Security-Policy (scripts only from this site and Google's Firebase CDN; connections only to this site, Firebase and the optional Google Apps Script), `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, a strict referrer policy and a Permissions-Policy (camera for this site only). Checked on the hosting emulator and on the live site with no violations. The full review is in `docs/SECURITY_REVIEW.md`.

## Roles, screen lock and activity log
- **Roles (cloud rules):** `cashier`, `manager`, `inventory`, `auditor` (plus the owner). The owner chooses the role when adding staff and can change it later. Cashiers and managers can sell and refund; managers and inventory staff manage products, stock, suppliers and orders; managers also manage customers; managers and auditors read every record, cashiers only their own; inventory staff and auditors cannot sell; auditors cannot write anything; only the owner manages staff and the business record. Deactivating an account removes every right at once. 50 emulator tests cover this.
- **Screen lock:** a 4 to 8 digit PIN stored as a salted, stretched (10,000 rounds) SHA-256 hash; simple PINs (1234, 1111) are refused; five wrong PINs force a 30 second wait; the app locks when reopened and after the chosen idle time. This protects against casual use. It cannot protect data from someone who controls the browser profile (IndexedDB is not encrypted).
- **Activity log:** each device keeps a hash-chained log (sign-in/out, product edits, bulk changes, refunds, register open/close, backup restore, receipt sending, PIN and lock events). Editing or removing an entry is detected and shown as a warning. It is stored on the device, can be exported, is not synced to the cloud, and a person who wipes the browser data removes it.
- **Receipt delivery:** the app never sends a message itself and stores no email, SMS or WhatsApp credentials. It opens the person's own app with the text filled in; "Delivered" only ever means the person confirmed it. Phone numbers and emails are validated and URL-encoded (no header injection). Only send a receipt to a customer who asked for it.
- **Cost price and pictures** stay on the device and are refused by the cloud rules, so cashiers cannot read margins from the catalogue.
- **Web API key** is limited to the two Hosting origins; **App Check** is optional and off.
- **Mwakete adapter** is closed: it makes no network call and holds no secret (tested).

## Production blockers (the honest list)
Do not rely on this app for real money without supervision until these are closed:
1. **The server does not check totals.** Firestore rules cannot recompute a sale from its lines. Doing so needs Cloud Functions, which needs Firebase's paid plan; this project deliberately does not use it. A tampered device or a hostile cashier can store a wrong total or price.
2. **No independent security review** of the rules, the app or the emulator-based tests.
3. **No tax-law review** of invoice wording and rounding (12.5% on the discounted taxable amount, rounded half up once per invoice, per-product exemption).
4. **No real-device pilot.** Not tested on real low-cost Android phones, barcode scanners or thermal printers. Camera barcode scanning exists but was only tested with a faked camera; thermal printer drivers are not built (receipts use the browser's print).
5. **App Check is not on.** The wiring exists and is off until a reCAPTCHA v3 **site** key is set in `firebase-config.js`; enforcement must be turned on in the console only after testing. The web API key **is now restricted** to `https://mwakete-pos.web.app/*` and `https://mwakete-pos.firebaseapp.com/*` (tested live; rollback in `docs/TROUBLESHOOTING.md`). A key restriction is not authentication: Firestore rules remain the real control.
6. **Stock is not shared between devices.**
7. **Digital payments are not verified.** A recorded card or mobile payment is only a record.
8. **No Mwakete Marketplace integration.** The existing API contract was not available.
9. **Local data is not encrypted at rest.** A lost or stolen device exposes what is stored on it. Use a device lock; sign out and clear site data on a lost device (an owner can also remove a cashier's access in the cloud).
10. **Manual accessibility testing** with a screen reader, large text and the keyboard alone is still to do.
11. **Roles stop at the rules, not at the screen.** A manager can change catalogue prices and customers by design; the activity log and screen lock are device-local and protect against casual misuse only (see "Roles, screen lock and activity log").
12. *(closed)* The throwaway smoke-test account and its data were deleted; the project now has no test users.

Report vulnerabilities privately to the repository owner. Do not publish exploit details before a fix is available.
