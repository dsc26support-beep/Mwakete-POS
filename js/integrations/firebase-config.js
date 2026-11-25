/* Firebase WEB app config for project mwakete-pos (app "Mwakete POS Web").
 * These values are public identifiers, not secrets: access is enforced by Firebase
 * Authentication and firestore.rules. Do NOT add service-account keys, admin keys or
 * passwords here. Restrict the API key to this app's domains in Google Cloud Console.
 * Regenerate with: npx -y firebase-tools@latest apps:sdkconfig WEB <APP_ID> --project mwakete-pos
 */
const FIREBASE_CONFIG = {
  projectId: "mwakete-pos",
  appId: "1:648701661858:web:e96059c73228e578d43dfb",
  apiKey: "AIzaSyDkabfrt3y05LXmooSOLCnHL8Ff1_nCH4M",
  authDomain: "mwakete-pos.firebaseapp.com",
  storageBucket: "mwakete-pos.firebasestorage.app",
  messagingSenderId: "648701661858",
};
/* OPTIONAL App Check. Paste the reCAPTCHA v3 SITE key (public) here to turn it on; leave empty to keep it off.
 * Never paste the secret key. Turn on enforcement in the Firebase console only after testing with this set. */
const FIREBASE_APPCHECK_SITE_KEY = "";
if (typeof module !== "undefined") module.exports = FIREBASE_CONFIG;
