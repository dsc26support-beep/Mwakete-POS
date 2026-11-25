/* Firebase backend adapter: Email/Password Authentication + Cloud Firestore.
 *
 * - The Firebase SDK is loaded lazily from Google's CDN, so the app still starts and works offline.
 * - Cloud sign-in is optional. Without it, sales stay safely in IndexedDB (the offline queue).
 * - Firestore uses its default in-memory cache only. IndexedDB stays the single offline queue.
 * - A record is reported accepted ONLY after Firestore confirms the write (the setDoc promise
 *   resolves once the server has committed it). Never mark a record synced any other way.
 * - Sync is idempotent: the document ID is the record ID and firestore.rules accept a re-send only
 *   if it is identical to the stored record.
 * - Email must be verified before anything syncs (firestore.rules enforce it too).
 * - Roles: "owner" (business ID = own uid) and "cashier" (joined an owner's business with a staff
 *   record the owner created). Only the owner writes products, customers and staff. Every sale and
 *   payment carries the writer's uid (staffUid) for the audit trail.
 * - Products: the owner pushes catalogue changes; every device pulls. Stock is per device and is only
 *   seeded from the cloud when a product is new on that device. Newest updatedAt wins.
 */
const FirebaseBackend = (() => {
  const SDK_VERSION = "11.10.0";
  const CDN = "https://www.gstatic.com/firebasejs/" + SDK_VERSION + "/";
  const WRITE_TIMEOUT_MS = 20000;
  // Record kinds that sync through payload.extra (one Firestore collection each). The owner alone writes some.
  const EXTRA_KINDS = [
    "refunds",
    "registers",
    "stockMoves",
    "suppliers",
    "purchaseOrders",
    "quotes",
  ];
  const OWNER_ONLY_KINDS = ["suppliers", "purchaseOrders"];
  let sdk = null,
    auth = null,
    db = null,
    loading = null,
    user = null,
    businessId = null; // set on a cashier device to the owner's business ID
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
  // Credit notes with method "account" reduce it as well.
  function computeBalance(sales, payments, refunds = []) {
    let c = 0;
    for (const s of sales)
      if (s.invoice && s.invoice.mode === "account")
        c += cents(s.invoice.total);
    for (const p of payments) c -= cents(p.amount);
    for (const r of refunds) if (r.method === "account") c -= cents(r.total);
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

  /* ---------- products ---------- */
  const isDirty = (p) => (p.updatedAt || 0) > (p.cloudSyncedAt || 0);
  // The cloud copy of a local product (whitelisted fields only; no device-only flags).
  function productToCloud(p) {
    const out = {
      id: String(p.id),
      name: String(p.name),
      price: Number(p.price),
      stock: Math.max(0, Number(p.stock) || 0),
      sku: p.sku ? String(p.sku) : undefined,
      category: p.category ? String(p.category) : undefined,
      reorderLevel:
        p.reorderLevel === "" ||
        p.reorderLevel === null ||
        p.reorderLevel === undefined ||
        !Number.isFinite(Number(p.reorderLevel))
          ? undefined
          : Number(p.reorderLevel),
      prices: p.prices && typeof p.prices === "object" ? p.prices : undefined,
      packs: Array.isArray(p.packs) ? p.packs : undefined,
      taxExempt: typeof p.taxExempt === "boolean" ? p.taxExempt : undefined,
      // costPrice and image stay on the device on purpose: cashiers can read the catalogue and must not see margins.
      description: p.description
        ? String(p.description).slice(0, 300)
        : undefined,
      unit: p.unit ? String(p.unit).slice(0, 12) : undefined,
      archived: p.archived === true ? true : undefined,
      priceHistory: Array.isArray(p.priceHistory)
        ? p.priceHistory.slice(-20)
        : undefined,
      updatedAt: Number(p.updatedAt) || Date.now(),
    };
    return toRecord(out);
  }
  const CATALOGUE = [
    "name",
    "price",
    "sku",
    "category",
    "reorderLevel",
    "prices",
    "packs",
    "taxExempt",
    "description",
    "unit",
    "archived",
    "priceHistory",
  ];
  // Decide what to change on this device after pulling the cloud catalogue.
  //  - new in the cloud -> add locally (stock is seeded from the cloud once)
  //  - newer in the cloud -> take the catalogue fields, keep this device's stock
  //  - missing from the cloud but previously synced and unchanged here -> removed elsewhere, remove here
  function mergeProducts(local, cloud) {
    const upserts = [],
      removes = [];
    const lById = new Map((local || []).map((p) => [p.id, p]));
    const cById = new Map((cloud || []).map((p) => [p.id, p]));
    for (const c of cloud || []) {
      const l = lById.get(c.id);
      if (!l) {
        upserts.push({
          ...c,
          stock: Number(c.stock) || 0,
          updatedAt: c.updatedAt,
          cloudSyncedAt: c.updatedAt,
        });
      } else if (c.updatedAt > (l.updatedAt || 0)) {
        const next = {
          ...l,
          updatedAt: c.updatedAt,
          cloudSyncedAt: c.updatedAt,
        };
        for (const k of CATALOGUE) {
          if (k in c) next[k] = c[k];
          else delete next[k];
        }
        upserts.push(next);
      }
    }
    for (const l of local || [])
      if (!cById.has(l.id) && l.cloudSyncedAt && !isDirty(l))
        removes.push(l.id);
    return { upserts, removes };
  }

  /* Writes one batch and returns the per-record answer the synchroniser expects.
   * fs = the Firestore functions {doc, setDoc, getDoc, getDocs, deleteDoc, query, where, collection}.
   * opts: {businessId, role: "owner"|"cashier", timeoutMs} */
  async function syncWith(fs, dbRef, uid, payload, opts = {}) {
    const timeoutMs = opts.timeoutMs || WRITE_TIMEOUT_MS;
    const role = opts.role === "cashier" ? "cashier" : "owner";
    const base = ["businesses", opts.businessId || uid];
    const acceptedIds = [],
      acceptedPaymentIds = [],
      acceptedProducts = [],
      deletedProductIds = [],
      acceptedExtra = {},
      rejected = [],
      rejectedProducts = [];
    let transient = 0,
      attempted = 0,
      done = 0,
      lastError = null;

    // onDeny(id) records a rules refusal; onOk(id) a confirmed write.
    const run = async (op, id, onOk, onDeny) => {
      attempted++;
      try {
        await withTimeout(op(), timeoutMs);
        done++;
        onOk(id);
      } catch (e) {
        if (e && e.code === "permission-denied") {
          done++;
          onDeny(id);
        } else {
          transient++;
          lastError = e;
        }
      }
    };
    const denyReason = {
      reason:
        "Refused by the cloud security rules (check the record's fields).",
    };
    const write = (sub, record, onOk, onDeny) =>
      run(
        () =>
          fs.setDoc(fs.doc(dbRef, ...base, sub, record.id), toRecord(record)),
        record.id,
        onOk,
        onDeny || ((id) => rejected.push({ id, ...denyReason })),
      );

    // Owner only: trade customers and the product catalogue.
    if (role === "owner") {
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
          () => {},
        );
      for (const p of payload.products || []) {
        const rec = productToCloud(p);
        await write(
          "products",
          rec,
          () => acceptedProducts.push({ id: rec.id, updatedAt: rec.updatedAt }),
          (id) => rejectedProducts.push({ id, ...denyReason }),
        );
      }
      for (const id of payload.productDeletes || [])
        await run(
          () => fs.deleteDoc(fs.doc(dbRef, ...base, "products", id)),
          id,
          (x) => deletedProductIds.push(x),
          () => {},
        );
    }
    // Everyone: the ledger. Each record carries the writer's uid.
    for (const s of payload.transactions || [])
      await write("sales", { ...s, staffUid: uid }, (id) =>
        acceptedIds.push(id),
      );
    for (const p of payload.payments || [])
      await write("payments", { ...p, staffUid: uid }, (id) =>
        acceptedPaymentIds.push(id),
      );
    // Credit notes, register shifts, stock movements, purchase orders, quotes (always AFTER the sales they refer to).
    // Owner-only kinds are skipped on a cashier device (the rules would refuse them anyway).
    for (const [sub, records] of Object.entries(payload.extra || {})) {
      if (!EXTRA_KINDS.includes(sub)) continue;
      if (role === "cashier" && OWNER_ONLY_KINDS.includes(sub)) continue;
      const ok = (acceptedExtra[sub] = []);
      for (const rec of records || [])
        await write(sub, { ...rec, staffUid: uid }, (id) => ok.push(id));
    }

    if (attempted && transient && !done)
      throw new Error(
        "Could not reach the cloud (" +
          ((lastError && (lastError.code || lastError.message)) || "network") +
          "). Records stay safely on this device.",
      );

    // Pull the catalogue and trade customers (every role can read them).
    let cloudProducts, cloudCustomers;
    try {
      const ps = await fs.getDocs(fs.collection(dbRef, ...base, "products"));
      cloudProducts = ps.docs.map((d) => d.data());
    } catch (_) {
      /* keep the local catalogue as is */
    }
    try {
      const cs = await fs.getDocs(fs.collection(dbRef, ...base, "customers"));
      cloudCustomers = cs.docs.map((d) => d.data());
    } catch (_) {}

    // Confirmed balances (owner only: cashiers cannot read other people's invoices).
    const balances = {};
    if (role === "owner") {
      const ids = new Set([
        ...(payload.transactions || [])
          .filter((s) => s.invoice && s.customerId)
          .map((s) => s.customerId),
        ...(payload.payments || []).map((p) => p.customerId),
        ...((payload.extra && payload.extra.refunds) || [])
          .filter((r) => r.method === "account" && r.customerId)
          .map((r) => r.customerId),
      ]);
      for (const id of ids) {
        try {
          const [ss, ps, rs] = await Promise.all([
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
            fs.getDocs(
              fs.query(
                fs.collection(dbRef, ...base, "refunds"),
                fs.where("customerId", "==", id),
              ),
            ),
          ]);
          balances[id] = computeBalance(
            ss.docs.map((d) => d.data()),
            ps.docs.map((d) => d.data()),
            rs.docs.map((d) => d.data()),
          );
        } catch (_) {
          /* balance stays unconfirmed; the app shows it as pending */
        }
      }
    }
    return {
      ok: true,
      acceptedIds,
      acceptedPaymentIds,
      acceptedExtra,
      rejected,
      balances,
      acceptedProducts,
      deletedProductIds,
      rejectedProducts,
      cloudProducts,
      cloudCustomers,
    };
  }

  // Reads the whole business (owner only): every till's sales and credit notes since `since`, plus the staff list.
  // Capped at 5000 newest records of each kind so a very large history cannot freeze a phone; `capped` says so.
  async function reportWith(fs, dbRef, uid, since, opts = {}) {
    const LIMIT = opts.limit || 5000;
    const base = ["businesses", uid];
    const q = (sub) =>
      fs.query(
        fs.collection(dbRef, ...base, sub),
        fs.where("createdAt", ">=", since),
        fs.orderBy("createdAt", "desc"),
        fs.limit(LIMIT),
      );
    const [ss, rs, st] = await Promise.all([
      fs.getDocs(q("sales")),
      fs.getDocs(q("refunds")),
      fs.getDocs(fs.collection(dbRef, ...base, "staff")),
    ]);
    const sales = ss.docs.map((d) => d.data());
    const refunds = rs.docs.map((d) => d.data());
    return {
      sales,
      refunds,
      staff: st.docs.map((d) => d.data()),
      capped: sales.length >= LIMIT || refunds.length >= LIMIT,
    };
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
      // Local testing only: http://localhost:<port>/?emulator=1 uses the Auth and Firestore emulators
      // instead of the live project. Never active on the real site (hostname must be localhost).
      if (
        typeof location !== "undefined" &&
        location.hostname === "localhost" &&
        /[?&]emulator=1\b/.test(location.search)
      ) {
        authMod.connectAuthEmulator(auth, "http://localhost:9099", {
          disableWarnings: true,
        });
        fsMod.connectFirestoreEmulator(db, "localhost", 8080);
      }
      authMod.onAuthStateChanged(auth, (u) => {
        user = u;
        notify();
      });
    })().catch((e) => {
      loading = null; // allow a retry when the connection returns
      throw e;
    });
    return loading;
  }
  function notify() {
    listeners.forEach((fn) => {
      try {
        fn(user);
      } catch (_) {}
    });
  }
  const need = () => {
    if (!sdk)
      throw new Error(
        "Cloud sign-in is not available yet. Connect to the internet and try again.",
      );
  };
  const needUser = () => {
    need();
    if (!user) throw new Error("Sign in first.");
  };
  const role = () =>
    businessId && user && businessId !== user.uid ? "cashier" : "owner";
  const bid = () => (role() === "cashier" ? businessId : user && user.uid);
  const validId = (s) =>
    typeof s === "string" && /^[A-Za-z0-9_-]{10,128}$/.test(s);

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
    isVerified: () => !!(user && user.emailVerified),
    email: () => (user && user.email) || "",
    uid: () => (user && user.uid) || "",
    role,
    businessId: () => (user ? bid() : null),
    async signUp(email, password) {
      await load();
      need();
      if (String(password || "").length < 8)
        throw new Error("Use a password of at least 8 characters.");
      try {
        const cred = await sdk.authMod.createUserWithEmailAndPassword(
          auth,
          String(email).trim(),
          password,
        );
        await sdk.authMod.sendEmailVerification(cred.user).catch(() => {});
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
      businessId = null;
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
    async sendVerification() {
      needUser();
      try {
        await sdk.authMod.sendEmailVerification(user);
      } catch (e) {
        throw new Error(friendlyAuthError(e));
      }
    },
    // After the user clicks the link in their email: reload the account and refresh the token
    // so Firestore sees email_verified.
    async refresh() {
      needUser();
      await user.reload();
      await user.getIdToken(true);
      notify();
      return !!user.emailVerified;
    },
    /* ----- roles ----- */
    setBusiness(id) {
      businessId = id || null;
    },
    // Cashier device: confirm the owner added this account as active staff, then use their business.
    async joinBusiness(code) {
      needUser();
      const c = String(code || "").trim();
      if (!validId(c))
        throw new Error("That business code does not look right.");
      if (c === user.uid) throw new Error("That is your own account's code.");
      const { doc, getDoc } = sdk.fsMod;
      let snap;
      try {
        snap = await getDoc(doc(db, "businesses", c, "staff", user.uid));
      } catch (e) {
        throw new Error(
          user.emailVerified
            ? "Could not check access. Try again when online."
            : "Verify your email first.",
        );
      }
      if (!snap.exists() || snap.data().active !== true)
        throw new Error(
          "That business has not added you as active staff. Send them your staff code.",
        );
      businessId = c;
      return c;
    },
    leaveBusiness() {
      businessId = null;
    },
    // Owner: staff management.
    async listStaff() {
      needUser();
      const { collection, getDocs } = sdk.fsMod;
      const snap = await getDocs(
        collection(db, "businesses", user.uid, "staff"),
      );
      return snap.docs.map((d) => d.data());
    },
    async saveStaff(staffUid, name, active) {
      needUser();
      if (role() !== "owner")
        throw new Error("Only the owner can manage staff.");
      const id = String(staffUid || "").trim();
      if (!validId(id)) throw new Error("That staff code does not look right.");
      if (id === user.uid)
        throw new Error("You are the owner. Staff need their own account.");
      const n = String(name || "").trim();
      if (!n || n.length > 100)
        throw new Error(
          "Enter the staff member's name (up to 100 characters).",
        );
      await ensureBusiness({});
      const { doc, getDoc, setDoc } = sdk.fsMod;
      const ref = doc(db, "businesses", user.uid, "staff", id);
      const old = await getDoc(ref);
      await setDoc(ref, {
        uid: id,
        name: n,
        role: "cashier",
        active: !!active,
        createdAt: old.exists() ? old.data().createdAt : Date.now(),
      });
    },
    async sync(payload) {
      if (!user) return { configured: false };
      need();
      if (!user.emailVerified)
        throw Object.assign(
          new Error(
            "Verify your email to sync. Open Business setup → Cloud account.",
          ),
          { noBackoff: true },
        );
      const r = role();
      if (r === "owner") await ensureBusiness(payload.business || {});
      return syncWith(sdk.fsMod, db, user.uid, payload, {
        businessId: bid(),
        role: r,
      });
    },
    async fetchReport(since) {
      needUser();
      if (!user.emailVerified) throw new Error("Verify your email first.");
      if (role() !== "owner")
        throw new Error("Only the owner can see the whole-business report.");
      try {
        return await withTimeout(
          reportWith(sdk.fsMod, db, user.uid, Number(since) || 0),
          30000,
        );
      } catch (e) {
        throw new Error(
          e && e.code === "permission-denied"
            ? "The cloud refused the report. Sign in again."
            : "Could not load the report. Check your internet connection.",
        );
      }
    },
    mergeProducts,
    isDirty,
    _test: {
      reportWith,
      toRecord,
      computeBalance,
      syncWith,
      friendlyAuthError,
      mergeProducts,
      productToCloud,
      isDirty,
    },
  };
})();
if (typeof module !== "undefined") module.exports = FirebaseBackend;
