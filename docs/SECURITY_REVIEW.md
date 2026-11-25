# Security review (2026-11-25)

Done by the development team using the Firebase rules red-team checklist plus a code and configuration pass. **This is not an independent review.** An outside review is still a production blocker.

## Result in one line
No way was found for a person to read another business's data, give themselves a role, or change a stored sale, payment, refund, shift or stock movement. Remaining risks are known design limits, listed below.

## Rules checklist (firestore.rules, 50 emulator tests)
| Check | Finding |
|---|---|
| Update bypass | Ledger kinds (sales, payments, refunds, registers, stock moves) accept only an identical re-send by the same writer. Products, customers, quotes, orders and staff are re-validated on every update. No create-then-corrupt path found. |
| Authority source | A role comes only from `staff/{uid}.role`, writable only by the owner. A staff member cannot create, edit or reactivate their own staff record. Deactivation removes every right immediately (tested). |
| Business logic | Each role can do its job (tested per role); the auditor can read but not write; inventory staff cannot sell. |
| Storage abuse | Strings and lists have size limits (items 200, payments 4, price history 20, quantity discounts 5, etc.). |
| Type safety | Money, ids, times and flags are type-checked. |
| Identity vs field checks | Every write also checks the writer's role; field checks never stand alone. |

## Findings
| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Moderate | **A sale's total is not checked against its lines** (rules cannot loop; Cloud Functions would be needed, which are paid). A dishonest cashier's device could store a wrong price. | Accepted, documented, mitigated by append-only records, the staff stamp, the record checks screen and the owner's report. |
| 2 | Moderate | **Records can be back-dated** (only an upper time limit exists, because devices may be offline for weeks). | Accepted; the staff stamp and append-only rule keep it traceable. |
| 3 | Minor | The contents of some lists (price history entries, quantity discount entries, sale items) are not checked item by item; they are size-capped and limited by the 1 MB document size, and only affect the writer's own business. | Open, low risk. |
| 4 | Minor | No Content-Security-Policy, frame, or Permissions-Policy headers. | **Fixed:** added to `firebase.json` (script, style, font, connect and frame sources limited to this site, Firebase and Google Fonts; `frame-ancestors 'none'`; camera only for this site). Tested on the hosting emulator and on the live site: no violations, sign-in works. |
| 5 | Minor | Web API key had no referrer restriction. | **Fixed:** limited to the two Hosting origins; foreign origins now get HTTP 403. Rollback in TROUBLESHOOTING.md. |
| 6 | Minor | A throwaway test account and its data existed. | **Fixed:** deleted and verified. |
| 7 | Minor | App Check is off. | Wired but off until a reCAPTCHA v3 site key is supplied; turning on enforcement is the owner's choice after testing. |
| 8 | Info | A manager can change prices and customers; this is by design. All product edits are written to the device's activity log; price changes are kept as price history. | By design. |
| 9 | Info | The screen-lock PIN, approval PIN and activity log live in the browser. Someone with control of the device (developer tools, clearing site data) can bypass or erase them. | Documented; they stop casual misuse and make log edits detectable. |
| 10 | Info | Local data (customers, sales, pictures, cost prices) is not encrypted at rest. | Documented blocker; use a device lock. |

## Code and configuration pass
- Cross-site scripting: every value drawn into a page from stored data goes through an HTML-escape helper (checked in all new screens); picture sources must be a short `data:image/(jpeg|png|webp)` URL; the CSP blocks inline and third-party scripts.
- Injection: CSV and activity-log exports neutralise leading `= + - @`; receipt links percent-encode every part (a test checks that a line break in a subject cannot add a mail header).
- Secrets: no key, token or password in the repository (searched). The Firebase web config is public by design. The App Check **secret** key is never used.
- Dependencies: the app has no runtime dependencies (the Firebase SDK is loaded from Google's CDN, version-pinned 11.10.0). Test tools are dev-only.
- Network: the Mwakete adapter makes no network calls (tested). Receipt delivery opens the user's own apps; nothing is sent by the app.
- Privacy: cost prices, margins and pictures never leave the device; the diagnostics summary contains no business content.

## Still to do before real money
1. Independent security review. 2. Tax-law review of invoice wording. 3. Pilot on real phones, scanners and a printer. 4. Screen-reader test. 5. Decide on App Check enforcement. 6. Consider Cloud Functions (paid) for server-side total checks if the risk of a dishonest cashier matters more than the cost.
