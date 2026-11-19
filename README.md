# Mwakete POS

Standalone, no-build-step PWA starter for a free, offline-first point of sale.

## Current implementation
- Responsive cashier interface and product catalogue.
- IndexedDB persistence for products, settings and sales.
- Offline app-shell caching with a service worker.
- Local cash sale recording and pending-sync status.
- Unique transaction IDs and an Apps Script sample using `LockService` and duplicate-ID checks.
- Explicit integration boundaries for Google and Mwakete.

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
