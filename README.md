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
  - **Support contacts** (supplied by the Mwakete owner, in `SUPPORT_CONTACTS` in `js/guides.js`): email `admin@mwakete.com`, Messenger `https://m.me/moote.nakau`, phone `73052765` (no country code assumed). Shown under "Contact Mwakete Support"; Messenger goes through the leave-the-app confirmation. The Messenger handle looks like a personal profile — confirm it is the intended business channel.
  - **Report a problem:** form on the Help tab (also "Report a problem with this guide"). Reports are saved **on this device only (`helpReports`) and are never sent automatically** — each is labelled "Not sent". Users can Copy a report, or Email it to `SUPPORT_EMAIL` (`admin@mwakete.com`), which opens the user's own email app — nothing is sent until they press send there. Technical details (app version, online status, browser) are opt-in and contain no sales, product or customer data. A server-side report inbox needs the authenticated backend.
  - To change an official guide, edit `OFFICIAL_GUIDES` in `js/guides.js`, and bump `CACHE` in `service-worker.js` so devices refresh.

## Tests
No build step or dependencies. Requires Node 20+:

```powershell
npm test
```

`tests/guides.test.js` covers guide integrity, search, URL safety, business link/note storage, bookmarks, recent list, and HTML escaping.

## Important status
This is a **working local prototype / integration foundation**, not a production-ready POS. It does not yet implement secure Google OAuth, automatic Google Drive/Sheets/Apps Script provisioning, production authentication, Mwakete API integration, refunds, staff permissions, multi-outlet inventory, digital-payment verification, or a complete server-authoritative stock ledger. Do not use it for live business transactions until those items are implemented and independently tested.

The Apps Script sample is a starting point only. Its endpoint currently accepts requests without production-grade identity verification. Do not deploy it publicly with real customer or financial data. Add authenticated identity validation, strict access control, schema validation, rate limiting and audit logging first.

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
