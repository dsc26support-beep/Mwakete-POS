# Troubleshooting

| Problem | What to do |
|---|---|
| "Verify your email" and nothing syncs | Open Business setup -> Cloud account, press the link in the verification email, then Sync now. |
| A sale shows "refused by the cloud" | The rules refused a field. Open the sale details; fix the cause (for example a very old device clock) and Retry. The sale is still safe on the device. |
| Cashier cannot see Products / Purchasing | By design. Only the owner and managers (and inventory staff for products) can manage them. |
| "Your staff role cannot make sales" | The owner gave this account the Inventory or Auditor role. Ask the owner to change it in Staff. |
| Forgot the lock PIN | Remove the site data for the app in the browser, or restore from a backup after clearing it. Sales not yet synced are lost if you clear data without a backup, so make a backup first if the screen can still be used. |
| The app shows an old version | A banner offers "Reload now" when a new version is ready. Or close all tabs of the app and open it again. |
| Camera scan button missing | The browser has no barcode detector (works on Chrome for Android). Use a barcode scanner or type the code. |
| "Storage not guaranteed" | Press "Ask the browser to keep my data" in Setup, install the app to the home screen, and make regular backups. |
| Counts look wrong across devices | Stock is counted per device on purpose. Do a stock count on each device. |
| Support | Backup and Support panel -> Copy support details (no sales or names are included). |

## Rollback of risky changes
- **Web API key restriction:** `apikeys.googleapis.com` -> key "Browser key (auto created by Firebase)" -> set `browserKeyRestrictions` back to `{}` (the original state: no referrer limit). In the console: APIs and Services -> Credentials -> that key -> Application restrictions -> None.
- **Firestore rules:** `git checkout <earlier commit> -- firestore.rules` then `firebase deploy --only firestore:rules`.
- **Hosting:** Firebase console -> Hosting -> release history -> Roll back to a previous version.
- **A bad app release on devices:** deploy a fixed version; the update banner asks each device to reload. Raise the number in `service-worker.js` (`CACHE`) with every release.
