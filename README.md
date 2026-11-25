# Mwakete POS

Standalone, no-build-step PWA starter for a free, offline-first point of sale.

## Current implementation
- Responsive cashier interface and product catalogue.
- IndexedDB persistence for products, settings and sales.
- Offline app-shell caching with a service worker.
- Local cash sale recording and pending-sync status.
- Unique transaction IDs and an Apps Script sample using `LockService` and duplicate-ID checks.
- Explicit integration boundaries for Google and Mwakete.
- **Help & guides tab (Guides & Links)** — hybrid management model:
  - *Official guides and links* (Mwakete-managed) are bundled in `js/guides.js`, cached by the service worker, and work offline. They are updated through normal app releases and are read-only for businesses.
  - *Business links and staff notes* (owner-managed) are stored locally in the IndexedDB `settings` store (keys `helpResources`, `helpBookmarks`, `helpRecent`). They are **per device only**: not synced, not shared with staff on other devices, not encrypted. No schema migration; existing products, sales and settings are untouched.
  - Search (title, subtitle, description), categories, step-by-step guides, bookmarks, recently viewed.
  - External links: https only, no embedded credentials, no localhost/IP/intranet hosts, `rel="noopener noreferrer"`, and a confirmation naming the destination site before leaving the app.
  - **Not implemented yet:** admin publish/update/archive UI and remote guide updates (needs the authenticated Mwakete backend), owner-vs-cashier permissions, cross-device sync of business links, screenshots, video tutorials, delivery of problem reports to Mwakete (see below), and an official Mwakete Marketplace link (URL not yet supplied; add it to `OFFICIAL_LINKS` once confirmed).
  - **Support contacts** (supplied by the Mwakete owner, in `SUPPORT_CONTACTS` in `js/guides.js`): email `admin@mwakete.com`, Messenger `https://m.me/moote.nakau`, phone `+686 73052765` (Kiribati). Shown under "Contact Mwakete Support"; Messenger goes through the leave-the-app confirmation. The Messenger handle looks like a personal profile — confirm it is the intended business channel.
  - **Report a problem:** form on the Help tab (also "Report a problem with this guide"). Reports are saved **on this device only (`helpReports`) and are never sent automatically** — each is labelled "Not sent". Users can Copy a report, or Email it to `SUPPORT_EMAIL` (`admin@mwakete.com`), which opens the user's own email app — nothing is sent until they press send there. Technical details (app version, online status, browser) are opt-in and contain no sales, product or customer data. A server-side report inbox needs the authenticated backend.
  - To change an official guide, edit `OFFICIAL_GUIDES` in `js/guides.js`, and bump `CACHE` in `service-worker.js` so devices refresh.

## Business types (tiers)
One app, three tiers, chosen in **Business setup → Business type** (stored locally under the `tier` setting). Switching never deletes data; it only shows or hides screens.

| Tier | For | Status |
| --- | --- | --- |
| **Counter** | Restaurants, micro-sellers (very limited products) | The original app, unchanged. Default for every existing install. |
| **Retail** | Shops with many products | Barcode scan-to-add (keyboard-style scanner + Enter, exact SKU match), reorder levels and low-stock list, product categories, percent/fixed discounts, receipts (print/copy/reopen from Sales history), customers, and reports (sales by day/category, top products, stock value). |
| **Wholesale** | Trade sellers | **All 4 parts built (trade selling, tax invoices and credit accounts, purchase orders, quotes and delivery notes):** everything in Retail plus named **price lists** (per-product price per list; falls back to the base price), **pack sizes** (e.g. Carton = 24; own barcode; optional fixed pack price, else unit price × units; stock always counted in single units), **trade customers** (price list, credit limit and payment terms as notes), and tax settings (default 12.5%, prices before tax, per-product tax-exempt flag). Choosing a trade customer selects their price list at the till and re-prices the cart. **Part 2 (invoices and credit ledger):** every Wholesale sale is a **tax invoice** (prices before tax, 12.5% by default, tax computed once on the taxable amount after a pro-rata discount, per-product exempt flag), paid at the till or **on account** (needs a trade customer). Invoice numbers are `INV-<device code>-<n>`. Over a customer's credit limit you get a warning and can continue (offline, the balance can be stale). The **Accounts** tab shows each trade customer's *confirmed* balance (from the ledger) plus *pending on this device*, lets you record cash payments against the account balance (not matched to invoices), and lists invoices. A rejected record is kept, shows its reason, and can be retried. **The credit ledger is NOT production-ready** (see Ledger below). **Also built (see "What the app does" below):** purchase orders and suppliers, quotes that become invoices once, delivery notes, credit notes (refunds), customer statements with oldest-first payment allocation. **Not built:** per-invoice payment allocation stored as a record (it is worked out from the records instead), voiding an invoice other than by a credit note, tax-law review of invoice wording. See `docs/ROADMAP.md`. |

Important limits:
- The tier is a **UI setting, not an authorization boundary**. Real enforcement needs the authenticated backend.
- Customers, reports, stock counts and discounts are **local to the device** (IndexedDB). Reports are not the cloud ledger. Customer names/phones are never synchronised; a sale carries only an opaque `customerId`.
- Not included: camera barcode scanning, thermal-printer drivers, cross-device customer sync.
- Wholesale part 2 adds IndexedDB version 4 (a `payments` store). An invoice is stored **on the sale** (`sale.invoice`, `sale.tax`), so a sale and its invoice are saved in one atomic write; for an invoice `sale.total` is the **gross** amount owed and reports subtract `sale.tax`. Counter and Retail sales are unchanged.
- Wholesale part 1 adds IndexedDB version 3 (a `priceLists` store). Products gain optional `prices` (per list), `packs` and `taxExempt`; customers gain optional `type:"trade"`, `priceListId`, `creditLimit`, `terms`, `taxNumber`; a sale line for a pack carries `packId`/`packUnits` and its `productId` still points at the product. Counter and Retail sales are saved exactly as before. Price lists, trade customers and credit limits are **local to the device**; a credit limit is only a note until the PR 2 ledger exists.
- Data model is additive only: IndexedDB version 2 adds a `customers` store; products gain optional `category`/`reorderLevel`; Retail sales gain optional `tier`, `subtotal`, `discount`, `customerId`. Counter sales are saved exactly as before.
- The sample Apps Script (`google-apps-script/Code.gs`) now recomputes every sale in integer cents and **rejects** a total that does not equal items minus discount, a discount above the subtotal, or malformed line items. It also stores Discount / Customer ID / Tier columns and upgrades an old 6-column sheet header. Re-deploy your Apps Script after updating.

## Credit ledger (Wholesale invoices) — NOT production-ready
> **Update:** with a **cloud account** (Firebase) the invoices, payments and credit notes go to Firestore instead, with a verified sign-in, owner/cashier roles and append-only rules. That removes the "no verified sign-in" problem described below. It does **not** make the ledger production-ready on its own: the server still cannot recompute a sale's total (no Cloud Functions), so the owner's and cashiers' devices are trusted for prices and arithmetic. The Google Sheet ledger below is the older optional backend.

Invoices, payments and balances are kept in the **business's own Google Sheet** through `google-apps-script/Code.gs` (schema v2). Read this before enabling it:
- **No verified sign-in.** The Apps Script cannot yet verify who is calling it (secrets may not live in the browser). Do **not** use the ledger with real customer or payment data until authenticated Google sign-in and owner-authorised provisioning exist.
- **Off until the owner switches it on.** Invoices and payments are rejected with "Ledger not enabled" unless the owner sets the script property `LEDGER_ENABLED=true`. Optional `TAX_RATE` (for example `12.5`) rejects invoices at any other rate. Plain sales (Counter, Retail and cash sales without an invoice) never need the ledger.
- **The server does not trust the browser's money.** It recomputes subtotal, discount, taxable amount, tax and total in integer cents, rejects any mismatch, and computes each customer's **balance itself** (invoices on account minus payments). The app never sends a balance.
- **Idempotent and per-record.** Re-sending a record is safe (stored once). The server answers for each record: accepted or rejected with a reason; one bad record never blocks the rest. The app marks a record **synced only when the server returns its id**. A reused invoice number with a different sale id is rejected.
- **The credit limit lives in the owner's Sheet.** The app seeds a trade customer's limit into the `Customers` tab the first time; after that only the owner edits it there. Invoices over the limit are flagged in the `Invoices` tab.
- Sheets created: `Invoices`, `Payments`, `Customers` (plus new columns on `Sales`). **After updating, re-deploy `Code.gs`.** Customer names and trade details on invoices are written to that Sheet.
- Prices are chosen by the browser, so the server can verify arithmetic only; stock stays local; balances shown offline can be out of date.

## Tests
No build step or dependencies. Requires Node 20+:

```powershell
npm test
```

`npm test` runs the unit tests in `tests/*.test.js`: guides/reports/support contacts, tier rules, discount/receipt/report/customer logic, and the real `Code.gs` loaded with stubbed Google services (validation, idempotency, header upgrade).

Browser test (optional, needs Playwright + Chromium; not part of `npm test`):

```powershell
npm run test:e2e
```

`tests/e2e/tiers.e2e.js` seeds a v1 database like an existing install, upgrades it, and checks Counter is unchanged, Retail features work, offline reload keeps data, and switching tiers keeps data. `tests/e2e/invoices.e2e.js` seeds a v3 database, upgrades it to v4, and runs invoices, over-limit warnings, payments and rejected/retried records against the **real `Code.gs`** (served to the browser through a stub), including a poison record, reports excluding tax, and offline reload. `tests/e2e/wholesale.e2e.js` seeds a v2 (Retail) database, upgrades it to v3, and checks price lists, pack sales (stock in single units), trade-customer pricing, re-pricing, barcode scan of a pack, tier switching and offline reload.

### Full test inventory
Run everything with these (each prints its own pass/fail count):

| What | Command | Needs |
| --- | --- | --- |
| Unit tests (267) | `npm test` | Node 20+ |
| Browser suites (10: tiers, wholesale, invoices, refunds, register, stock, trade, CSV, resilience, backup) | `NODE_PATH=$(npm root -g) npm run test:e2e` | Playwright + Chromium |
| Firestore rules, emulator (41) | `cd tests/rules && npm install && npm test` | Java 11+ |
| Cloud flows, owner + cashier, emulators | `NODE_PATH=$(npm root -g) npx -y firebase-tools@latest emulators:exec --only auth,firestore --project mwakete-pos "node tests/e2e/firebase-cloud.e2e.js"` | Playwright, Java 11+ |
| Accessibility scan (axe, WCAG 2.1 A/AA, every screen and business type, plus keyboard checks on dialogs) | `cd tests/a11y && npm install && NODE_PATH=$(npm root -g) node a11y.e2e.js` | Playwright |

Automated accessibility checks catch only part of what matters. A person using a screen reader, large text and the keyboard alone should still try each screen before a shop depends on it.

## What the app does
| Area | What is built | Where |
| --- | --- | --- |
| Selling | Counter, Retail and Wholesale tills; discounts; barcode Enter-to-add; receipts; pack sizes; price lists | Quick sale |
| Refunds | Partial or full refund of any sale as an append-only **credit note**; the sale is never changed; refunds can never add up to more than the sale; stock can be put back; an invoice on account is credited to the customer's account | Sales history → open a sale → Refund… |
| Register | Open with a float, close with a count; expected cash = float + cash sales + cash payments − cash refunds; shift report; short/over shown | Register |
| Stock | Every hand change (receive, damage, count, correction) recorded with a reason; stock never below 0 | Stock |
| Purchasing | Suppliers and purchase orders (draft → ordered → received or cancelled); receiving adds stock; a received or cancelled order is frozen | Purchasing (Wholesale, owner) |
| Quotes | Quote with exact tax and an expiry date; **Make invoice** loads it into the till at the quoted prices; a quote can become one invoice only | Quotes (Wholesale) |
| Delivery notes | Goods and a signature box, no prices, from any invoice | Receipt of an invoice |
| Statements | A customer's invoices, payments and credit notes with a running balance; payments are matched to the **oldest invoices first** | Accounts → Statement |
| CSV | Import with a preview, per-row problems, duplicate detection (barcode, then name) and stock kept unless you choose otherwise; export with spreadsheet-formula protection | Products |
| Cloud (optional) | Email/password sign-in, verified email, owner and cashier roles, sync of sales, payments, credit notes, shifts, stock changes, products, purchase orders and quotes, owner's whole-business report | Business setup |
| Offline | Everything above works offline; an unfinished sale survives a reload; failed syncs retry by themselves (30 s, then longer, at most every 15 min); long lists stay fast on a slow phone | Always |
| Your data | Download and restore a backup file; diagnostics summary for support (no business content) | Business setup |

Stock is counted **per device**, not shared between tills (see `SECURITY.md`). Credit notes, shifts, stock changes, suppliers, purchase orders and quotes sync only through a cloud account.

## Important status
This is a **complete, tested application for a supervised pilot**, not yet a product to rely on without supervision. Do **not** use it for live business transactions until the items in `SECURITY.md` → "Production blockers" are done: an independent security review, a tax-law review of the invoice wording, and a trial on the real phones, barcode scanners and printers in a pilot shop. What it still does **not** do: verify digital payments (a recorded card/mobile payment is only a record), check on the server that a sale's total equals its lines (this needs Cloud Functions on Firebase's paid plan, which this project deliberately does not use), share stock between devices, connect to the Mwakete Marketplace (the API contract is not available), or drive barcode cameras and thermal printers.

The Apps Script sample is the older optional backend. Its endpoint accepts requests without production-grade identity verification. Do not use it with real customer or financial data; use a cloud account instead.

## Run locally
Serve this directory over localhost (service workers and IndexedDB require a secure context; localhost is treated as secure). For example, with Python installed:

```powershell
cd C:\path\to\Mwakete-POS
py -m http.server 8080
```

Open `http://localhost:8080`.

## Deploy to Cloudflare Pages
Create a Pages project connected to this repository. Framework preset: **None**. Build command: leave empty. Build output directory: `/`.

## Google backend direction
The intended model is one Google-owned data environment per independent business. The owner authorises Google access; provisioning creates the spreadsheet and backend under that owner's account. The secure OAuth + provisioning broker is not included yet. Never request or store a Google password, OAuth client secret, refresh token or service-account private key in browser code or Git.

## Mwakete integration
Mwakete sellers must use the existing Mwakete identity, customer and inventory services. Implement the adapter in `js/integrations/mwakete.js` only after inspecting the current Mwakete repository and confirming the actual API contracts. Do not create a second source of truth for marketplace stock or customers.

## Data and privacy
- Local browser data is stored in IndexedDB on the device.
- Device users with access to the browser profile may be able to access local data. Add device-level protection and a secure local-data policy before production.
- Independent businesses must have separate Google-owned data stores and access permissions.
- Never sync or expose one retailer's private customer records to another retailer.
- Digital payment selection is currently labelled unverified and must not be treated as proof of payment.

## Project structure
- `index.html`, `css/`, `js/`: POS application
- `service-worker.js`, `manifest.webmanifest`: PWA shell
- `google-apps-script/`: sample per-business Apps Script backend
- `docs/`: implementation roadmap and API contracts
- `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `.firebaserc`: Firebase project config
- `js/integrations/firebase*.js`, `js/cloud-ui.js`: optional cloud account

## Cloud account (Firebase), optional
- **Settings → Cloud account:** create an account or sign in with email and password (Firebase Authentication, project `mwakete-pos`). While signed in, pending sales, payments and trade customers sync to Cloud Firestore (Standard edition, `australia-southeast1`). Signed out, the app uses the optional Google Apps Script backend or stays local-only.
- **Data layout:** `businesses/{ownerUid}` with `sales`, `payments` and `customers` subcollections. The sale or payment ID is the document ID, so sync is idempotent. See `firestore.rules` (owner-only, append-only ledger, default deny).
- **Balances:** read back from Firestore (account invoices minus payments, integer cents) for the customers in each sync.
- **SDK:** Firebase v11.10.0 loads from Google's CDN on demand, so the app still starts offline.
- **Deploy:** `npx -y firebase-tools@latest deploy --only auth,firestore --project mwakete-pos`
- **IDs:** Web app `1:648701661858:web:e96059c73228e578d43dfb` (used by this PWA). Android app `1:648701661858:android:a415bbcc6cb9df9cd43dfb` is registered in the same project but not used by this PWA.
- **Email verification:** after sign-up Firebase emails a link. Until it is opened (then press **I have verified**), nothing syncs and sales stay safely on the device. The cloud rules refuse unverified accounts too.
- **Roles:** the **owner** is the account whose ID is the business ID (shown as "Your business code"). A **cashier** creates their own account, verifies their email and sends the owner their **staff code**. The owner adds them under *Staff*; the cashier then enters the business code to join. Cashiers can sell and see the product list; they cannot change products, customers or staff, and see only their own sales. The owner can remove access at any time (records are kept). Every sale and payment is stamped with the uid of who recorded it.
- **Product sync:** the owner's catalogue changes (name, price, SKU, category, reorder level, price lists, pack sizes, tax-exempt flag) are pushed; every device pulls. Newest edit wins. **Stock is per device**: it is copied from the cloud only when a product is new on that device, so two tills never overwrite each other's counts. A product the owner deletes is removed from synced devices. Owner-created trade customers are copied to cashier devices (existing local customers are never overwritten).
- **Tests:** see "Full test inventory" above. The app only connects to the Firebase emulators on `http://localhost:<port>/?emulator=1`.
- **Not built yet:** App Check (needs a reCAPTCHA key from the Firebase console), multi-device stock sync, customer sync beyond owner-created trade customers, removing a business or account from the app. See `SECURITY.md`.
