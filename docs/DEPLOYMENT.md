# Deployment

Free plan only (Spark): Hosting, Authentication (email and password), Firestore Standard. No Cloud Functions.

1. All tests green (see TESTING.md).
2. Raise `CACHE` in `service-worker.js` and `APP_VERSION` in `js/diagnostics.js` when files changed.
3. Deploy: `npx -y firebase-tools@latest deploy --only firestore:rules,hosting --project mwakete-pos`
4. Open https://mwakete-pos.web.app, hard-reload once, sign in with a test account, make a test sale.
5. If something is wrong, roll back (see TROUBLESHOOTING.md).

## One-time settings (already done for mwakete-pos)
- Authentication -> Sign-in method -> Email/Password on.
- Firestore database created in `australia-southeast1` (cannot be changed later), rules from this repo.
- Web API key limited to `https://mwakete-pos.web.app/*` and `https://mwakete-pos.firebaseapp.com/*`.
- App Check: site key is set in the code (public) and the app skips App Check for a visit when Google's reCAPTCHA script cannot be reached, so sign-in never depends on it. The SECRET key is entered only by the owner in Firebase console > App Check > Apps (never in the repository). Do not switch on enforcement until the console's App Check metrics show verified requests from real phones. Rollback: untick enforcement, or set `FIREBASE_APPCHECK_SITE_KEY` to "" and redeploy. Original setup note: paste the reCAPTCHA v3 SITE key into `js/integrations/firebase-config.js` (`FIREBASE_APPCHECK_SITE_KEY`), deploy, check sign-in still works, and only then turn on enforcement in the console.

## Android app (the existing app id)
The project also holds an Android app. Nothing here changes it. A Trusted Web Activity wrapper of this PWA needs a package name and a signing key.
