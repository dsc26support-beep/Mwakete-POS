/* Firebase backend adapter: Email/Password Authentication + Cloud Firestore.
 *
 * - The Firebase SDK is loaded lazily from Google's CDN, so the app still starts and works offline.
 * - Cloud sign-in is optional. Without it, sales stay safely in IndexedDB (the offline queue).
 * - Firestore uses its default in-memory cache only. IndexedDB stays the single offline queue.
 * - A record is reported accepted ONLY after Firestore confirms the write (the setDoc promise
 *   resolves once the server has committed it). Never mark a record synced any other way.
 * - Sync is idempotent: the document ID is the record ID and firestore.rules accept a re-send only
 *   if it is identical to the stored record.
 */
const FirebaseBackend = (() => {
  const SDK_VERSION = "11.10.0";
  const CDN = "https://www.gstatic.com/firebasejs/" + SDK_VERSION + "/";
  const WRITE_TIMEOUT_MS = 20000;
  let sdk = null,
    auth = null,
    db = null,
    loading = null,
    user = null;
  const listeners = new Set();

  /* ---------- pure helpers (unit tested) ---------- */
  // Firestore rejects undefined; drop undefined/null top-level fields and deep-clone through JSON.
  function toRecord(obj) {
    const clean = JSON.parse(JSON.stringify(obj));
    for (const k of Object.keys(clean)) if (clean[k] === null) delete clean[k];
    return clean;
  }
  const cents = (n) => Math.round(Number(n || 0) * 100);
  // Balance owed by a customer = invoices on account minus payments, in integer cents.
  function computeBalance(sales, payments) {
    let c = 0;
    for (const s of sales)
      if (s.invoice && s.invoice.mode === "account")
        c += cents(s.invoice.total);
    for (const p of payments) c -= cents(p.amount);
    return c / 100;
  }
  function friendlyAuthError(e) {
    const code = (e && e.code) || "";
    const map = {
      "auth/invalid-email": "That email address is not valid.",
      "auth/missing-password": "Enter your password.",
      "auth/weak-password": "Use a password of at least 8 characters.",
      "auth/email-already-in-use":
        "An account already exists for that email. Try signing in.",
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/wrong-password": "Email or password is incorrect.",
      "auth/user-not-found": "Email or password is incorrect.",
      "auth/too-many-requests":
        "Too many attempts. Wait a few minutes and try again.",
      "auth/network-request-failed":
        "No internet connection. Try again when online.",
    };
    return (
      map[code] ||
      "Could not complete that. " + (e && e.message ? e.message : "")
    );
  }
  function withTimeout(promise, ms) {
    let t;
    const timeout = new Promise((_, rej) => {
      t = setTimeout(
        () => rej(Object.assign(new Error("Timed out"), { code: "timeout" })),
        ms,
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
  }

  /* Writes one batch and returns the per-record answer the synchroniser expects.
   * fs = the Firestore functions {doc, setDoc, getDoc, getDocs, query, where, collection}. */
  async function syncWith(fs, dbRef, uid, payload, opts = {}) {
    const timeoutMs = opts.timeoutMs || WRITE_TIMEOUT_MS;
    const base = ["businesses", uid];
    const acceptedIds = [],
      acceptedPaymentIds = [],
      rejected = [];
    let transient = 0,
      attempted = 0,
      lastError = null;

    const write = async (sub, record, onOk) => {
      attempted++;
      try {
        await withTimeout(
          fs.setDoc(fs.doc(dbRef, ...base, sub, record.id), toRecord(record)),
          timeoutMs,
        );
        onOk(record.id);
      } catch (e) {
        if (e && e.code === "permission-denied")
          rejected.push({
            id: record.id,
            reason:
              "Refused by the cloud security rules (check the record's fields).",
          });
        else {
          transient++;
          lastError = e;
        }
      }
    };

    // Business profile is created once by ensureBusiness(); trade customers are mutable upserts.
    for (const c of payload.customers || [])
      await write(
        "customers",
        {
          id: c.id,
          name: c.name,
          creditLimit: c.creditLimit,
          terms: c.terms,
          taxNumber: c.taxNumber,
        },
        () => {},
      );
    for (const s of payload.transactions || [])
      await write("sales", s, (id) => acceptedIds.push(id));
    for (const p of payload.payments || [])
      await write("payments", p, (id) => acceptedPaymentIds.push(id));

    if (
      attempted &&
      transient &&
      !acceptedIds.length &&
      !acceptedPaymentIds.length &&
      !rejected.length
    )
      throw new Error(
        "Could not reach the cloud (" +
          ((lastError && (lastError.code || lastError.message)) || "network") +
          "). Records stay safely on this device.",
      );

    // Confirmed balances are read back from Firestore for the customers touched in this batch.
    const balances = {};
    const ids = new Set([
      ...(payload.transactions || [])
        .filter((s) => s.invoice && s.customerId)
        .map((s) => s.customerId),
      ...(payload.payments || []).map((p) => p.customerId),
    ]);
    for (const id of ids) {
      try {
        const [ss, ps] = await Promise.all([
          fs.getDocs(
            fs.query(
              fs.collection(dbRef, ...base, "sales"),
              fs.where("customerId", "==", id),
            ),
          ),
          fs.getDocs(
            fs.query(
              fs.collection(dbRef, ...base, "payments"),
              fs.where("customerId", "==", id),
            ),
          ),
        ]);
        balances[id] = computeBalance(
          ss.docs.map((d) => d.data()),
          ps.docs.map((d) => d.data()),
        );
      } catch (_) {
        /* balance stays unconfirmed; the app shows it as pending */
      }
    }
    return { ok: true, acceptedIds, acceptedPaymentIds, rejected, balances };
  }

  /* ---------- SDK loading and auth ---------- */
  function load() {
    if (loading) return loading;
    loading = (async () => {
      const [appMod, authMod, fsMod] = await Promise.all([
        import(CDN + "firebase-app.js"),
        import(CDN + "firebase-auth.js"),
        import(CDN + "firebase-firestore.js"),
      ]);
      const app = appMod.initializeApp(FIREBASE_CONFIG);
      auth = authMod.getAuth(app);
      db = fsMod.getFirestore(app); // default memory cache: no second offline store
      sdk = { authMod, fsMod };
      authMod.onAuthStateChanged(auth, (u) => {
        user = u;
        listeners.forEach((fn) => {
          try {
            fn(u);
          } catch (_) {}
        });
      });
    })().catch((e) => {
      loading = null; // allow a retry when the connection returns
      throw e;
    });
    return loading;
  }
  const need = () => {
    if (!sdk)
      throw new Error(
        "Cloud sign-in is not available yet. Connect to the internet and try again.",
      );
  };

  async function ensureBusiness(info) {
    const { doc, getDoc, setDoc } = sdk.fsMod;
    const ref = doc(db, "businesses", user.uid);
    const snap = await getDoc(ref);
    const now = Date.now();
    const name =
      String((info && info.name) || "My business").slice(0, 100) ||
      "My business";
    if (!snap.exists())
      await setDoc(
        ref,
        toRecord({
          ownerUid: user.uid,
          name,
          createdAt: now,
          currency: info && info.currency,
          tier: info && info.tier,
          updatedAt: now,
        }),
      );
  }

  return {
    init: load,
    onChange(fn) {
      listeners.add(fn);
      if (user) fn(user);
      return () => listeners.delete(fn);
    },
    isSignedIn: () => !!user,
    email: () => (user && user.email) || "",
    async signUp(email, password) {
      await load();
      need();
      if (String(password || "").length < 8)
        throw new Error("Use a password of at least 8 characters.");
      try {
        await sdk.authMod.createUserWithEmailAndPassword(
          auth,
          String(email).trim(),
          password,
        );
      } catch (e) {
        throw new Error(friendlyAuthError(e));
      }
    },
    async signIn(email, password) {
      await load();
      need();
      try {
        await sdk.authMod.signInWithEmailAndPassword(
          auth,
          String(email).trim(),
          password,
        );
      } catch (e) {
        throw new Error(friendlyAuthError(e));
      }
    },
    async signOut() {
      need();
      await sdk.authMod.signOut(auth);
    },
    async resetPassword(email) {
      await load();
      need();
      try {
        await sdk.authMod.sendPasswordResetEmail(auth, String(email).trim());
      } catch (e) {
        throw new Error(friendlyAuthError(e));
      }
    },
    async sync(payload) {
      if (!user) return { configured: false };
      need();
      const info = payload.business || {};
      await ensureBusiness(info);
      return syncWith(sdk.fsMod, db, user.uid, payload);
    },
    _test: { toRecord, computeBalance, syncWith, friendlyAuthError },
  };
})();
if (typeof module !== "undefined") module.exports = FirebaseBackend;
