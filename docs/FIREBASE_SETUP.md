# Firebase setup (project mwakete-pos)

| Item | Value |
|---|---|
| Project | `mwakete-pos` |
| Web app id | `1:648701661858:web:e96059c73228e578d43dfb` (used by this PWA) |
| Android app id | `1:648701661858:android:a415bbcc6cb9df9cd43dfb` (not touched by this repo) |
| Auth | Email and password; a verified email is required by the rules |
| Firestore | Standard, `australia-southeast1`, default database, rules in `firestore.rules` |
| Hosting | site `mwakete-pos`, public folder = repo root, test and doc files excluded |
| Billing | Spark (free). Do not turn on Blaze unless you accept costs |

## From a new computer
```bash
npx -y firebase-tools@latest login
npx -y firebase-tools@latest use mwakete-pos
npx -y firebase-tools@latest emulators:start --only auth,firestore
```
Open `http://localhost:<port>/?emulator=1` to run against the emulators (works on localhost only).

## Staff accounts
A staff member makes their own account in the app, verifies their email, and sends the owner their staff code. The owner adds them in Setup -> Staff and picks a role. Removing access sets `active` to false (records are never deleted).

## Keys
The web config in `js/integrations/firebase-config.js` is public by design. Service-account keys, admin keys and passwords never go in the repo. The API key is limited to the two Hosting origins.
