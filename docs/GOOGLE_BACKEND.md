# Google-owned backend design

## Intended onboarding
1. Business owner chooses **Connect Google**.
2. Google OAuth consent screen identifies the requested scopes and purpose.
3. Owner authorises the application.
4. A secure provisioning service creates a business folder, spreadsheet and Apps Script project/deployment in the owner's Google account.
5. The owner can open the spreadsheet and revoke access.
6. POS stores a tenant-scoped backend reference, not a Google password or client secret.

## Important implementation requirements
- Provisioning requires a verified Google Cloud OAuth client and appropriate Google APIs/scopes.
- Apps Script API / Drive API permissions and deployment behaviour must be tested with real Google accounts.
- Do not embed OAuth client secrets or refresh tokens in browser JavaScript.
- The production provisioning broker must encrypt refresh tokens in a server-side secret store and support revocation.
- Use one isolated spreadsheet/data environment per independent business.
- A browser must not be allowed to choose another tenant's spreadsheet ID.
- Apps Script quotas and Sheets concurrency limits must be load-tested. Batch writes; avoid one request per cell.
- Consider a signed, authenticated relay for browser-to-Apps-Script requests. Do not use opaque `no-cors` fetch responses to confirm a sale was synced.

The sample in `google-apps-script/Code.gs` is not safe for public production deployment until authentication and tenant validation are added.
