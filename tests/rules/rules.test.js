// Firestore security rules tests. Run with `npm test` inside tests/rules (starts the emulator).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  collection,
  query,
  where,
} = require("firebase/firestore");

const OWNER = "ownerA";
const OTHER = "ownerB";
const CASHIER = "cashierC";
const CASHIER2 = "cashierD";
let env;

const sale = (id, by = OWNER, over = {}) => ({
  id,
  staffUid: by,
  createdAt: 1700000000000,
  currency: "AUD",
  paymentMethod: "cash",
  paymentVerified: true,
  total: 5,
  syncStatus: "pending",
  items: [{ productId: "p1", name: "Water", unitPrice: 2.5, quantity: 2 }],
  ...over,
});
// The shape the real app sends for a Wholesale tax invoice on account.
const invoiceSale = (id, by = OWNER) =>
  sale(id, by, {
    tier: "wholesale",
    customerId: "c1",
    paymentMethod: "account",
    paymentVerified: false,
    subtotal: 100,
    discount: { type: "percent", value: 10, amount: 11.11 },
    total: 112.5,
    tax: 12.5,
    invoice: {
      number: "INV-A1-1",
      mode: "account",
      taxRate: 12.5,
      taxableNet: 100,
      tax: 12.5,
      total: 112.5,
      customerName: "Trade Co",
      sellerTaxNumber: "T-1",
    },
  });
const payment = (id, by = OWNER, over = {}) => ({
  id,
  staffUid: by,
  customerId: "c1",
  amount: 20,
  createdAt: 1700000000001,
  method: "cash",
  note: "",
  ...over,
});
const business = (over = {}) => ({
  ownerUid: OWNER,
  name: "Test Shop",
  createdAt: 1700000000000,
  currency: "AUD",
  tier: "retail",
  ...over,
});
const product = (id, over = {}) => ({
  id,
  name: "Water",
  price: 2.5,
  stock: 10,
  sku: "W1",
  updatedAt: 1700000000000,
  ...over,
});
const staff = (uid, over = {}) => ({
  uid,
  name: "Tina",
  role: "cashier",
  active: true,
  createdAt: 1700000000000,
  ...over,
});

// db(uid) = verified email; db(uid, false) = signed in but email NOT verified; db(null) = anonymous.
const db = (uid, verified = true) =>
  uid
    ? env
        .authenticatedContext(uid, {
          email_verified: verified,
          email: uid + "@example.com",
        })
        .firestore()
    : env.unauthenticatedContext().firestore();
const ref = (d, ...p) => doc(d, ...p);

// Seed the owner's business and an active cashier, bypassing the rules.
async function seed({ cashierActive = true } = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, "businesses", OWNER), business());
    await setDoc(
      doc(d, "businesses", OWNER, "staff", CASHIER),
      staff(CASHIER, { active: cashierActive }),
    );
  });
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-mwakete-pos",
    firestore: {
      rules: fs.readFileSync(
        path.join(__dirname, "../../firestore.rules"),
        "utf8",
      ),
    },
  });
});
test.after(async () => env.cleanup());
test.beforeEach(async () => env.clearFirestore());

/* ---------- business ---------- */
test("business: owner can create their own; other users and anonymous cannot", async () => {
  await assertSucceeds(setDoc(ref(db(OWNER), "businesses", OWNER), business()));
  await assertFails(setDoc(ref(db(OTHER), "businesses", OWNER), business()));
  await assertFails(setDoc(ref(db(null), "businesses", OWNER), business()));
});

test("business: ownerUid must match, tier must be known, createdAt is immutable, no delete", async () => {
  await assertFails(
    setDoc(ref(db(OWNER), "businesses", OWNER), business({ ownerUid: OTHER })),
  );
  await assertFails(
    setDoc(ref(db(OWNER), "businesses", OWNER), business({ tier: "platinum" })),
  );
  await assertFails(
    setDoc(ref(db(OWNER), "businesses", OWNER), business({ extra: 1 })),
  );
  await assertSucceeds(setDoc(ref(db(OWNER), "businesses", OWNER), business()));
  await assertSucceeds(
    setDoc(
      ref(db(OWNER), "businesses", OWNER),
      business({ name: "Renamed", updatedAt: 5 }),
    ),
  );
  await assertFails(
    setDoc(ref(db(OWNER), "businesses", OWNER), business({ createdAt: 1 })),
  );
  await assertFails(deleteDoc(ref(db(OWNER), "businesses", OWNER)));
});

/* ---------- email verification ---------- */
test("email verification: an owner with an UNVERIFIED email is refused everywhere", async () => {
  await seed();
  const u = db(OWNER, false);
  await assertFails(getDoc(ref(u, "businesses", OWNER)));
  await assertFails(
    setDoc(ref(u, "businesses", OWNER, "sales", "s1"), sale("s1")),
  );
  await assertFails(
    setDoc(ref(u, "businesses", OWNER, "products", "p1"), product("p1")),
  );
  await assertFails(
    setDoc(ref(u, "businesses", OWNER, "staff", CASHIER2), staff(CASHIER2)),
  );
  await assertFails(getDocs(collection(u, "businesses", OWNER, "products")));
});

test("email verification: an unverified cashier is refused even with an active staff record", async () => {
  await seed();
  const u = db(CASHIER, false);
  await assertFails(
    setDoc(ref(u, "businesses", OWNER, "sales", "s1"), sale("s1", CASHIER)),
  );
  await assertFails(getDoc(ref(u, "businesses", OWNER, "staff", CASHIER)));
  await assertFails(getDocs(collection(u, "businesses", OWNER, "products")));
});

test("products: description, unit, archived and price history are accepted; bad shapes and cost price are refused", async () => {
  const w = (id, extra) =>
    setDoc(ref(db(OWNER), "businesses", OWNER, "products", id), {
      ...product(id),
      ...extra,
    });
  await assertSucceeds(
    w("c1", {
      description: "Loose leaf",
      unit: "kg",
      archived: true,
      priceHistory: [{ at: 1, from: 1, to: 2 }],
    }),
  );
  await assertFails(w("c2", { description: "x".repeat(301) }));
  await assertFails(w("c3", { archived: "yes" }));
  await assertFails(w("c4", { priceHistory: "none" }));
  await assertSucceeds(
    w("c7", { minQty: 12, qtyBreaks: [{ qty: 10, pct: 5 }] }),
  );
  // ids are plain characters only (they are drawn into pages)
  await assertFails(
    setDoc(colDoc(OWNER, "products", 'bad"id'), { ...product('bad"id') }),
  );
  // a product cannot be rolled back to an older version or pinned far in the future
  await assertSucceeds(w("roll", { updatedAt: 1700000000500 }));
  await assertFails(w("roll", { updatedAt: 1700000000100 }));
  await assertSucceeds(
    w("roll", { updatedAt: 1700000000500, name: "Same time, new name" }),
  );
  await assertFails(w("roll", { updatedAt: 9999999999999 }));
  await assertSucceeds(w("c12", { barcode: "9310000000012" }));
  await assertFails(w("c13", { barcode: "x".repeat(81) }));
  await assertFails(w("c8", { minQty: 0 }));
  await assertFails(w("c9", { minQty: 2.5 }));
  await assertFails(w("c10", { qtyBreaks: "10:5" }));
  await assertFails(
    w("c11", {
      qtyBreaks: [1, 2, 3, 4, 5, 6].map((n) => ({ qty: n + 1, pct: n })),
    }),
  );
  // cost price never leaves the device, so the cloud schema refuses it
  await assertFails(w("c5", { costPrice: 3 }));
  await assertFails(w("c6", { image: "data:image/png;base64,AAAA" }));
});

/* ---------- sales (owner) ---------- */
test("sales: owner can create a plain sale and the real wholesale invoice shape", async () => {
  await assertSucceeds(
    setDoc(ref(db(OWNER), "businesses", OWNER, "sales", "s1"), sale("s1")),
  );
  await assertSucceeds(
    setDoc(
      ref(db(OWNER), "businesses", OWNER, "sales", "i1"),
      invoiceSale("i1"),
    ),
  );
});

test("sales: split payments with references are accepted; malformed ones and verified digital are refused", async () => {
  const w = (id, extra) =>
    setDoc(ref(db(OWNER), "businesses", OWNER, "sales", id), {
      ...sale(id),
      ...extra,
    });
  await assertSucceeds(
    w("sp1", {
      paymentMethod: "split",
      paymentVerified: false,
      tendered: 20,
      change: 2.5,
      payments: [
        { method: "eftpos", amount: 12.5, reference: "A1" },
        { method: "cash", amount: 17.5 },
      ],
    }),
  );
  await assertFails(w("sp2", { payments: [] }));
  await assertFails(w("sp3", { payments: [{ method: "bitcoin", amount: 1 }] }));
  await assertFails(
    w("sp4", { payments: [{ method: "cash", amount: 1, extra: true }] }),
  );
  await assertFails(w("sp5", { payments: [{ method: "cash", amount: "1" }] }));
  await assertFails(w("sp6", { change: "2" }));
  await assertFails(
    w("sp7", {
      paymentMethod: "split",
      paymentVerified: true,
      payments: [{ method: "mpaisa", amount: 1 }],
    }),
  );
});

test("sales: re-sending the identical record is accepted (idempotent retry)", async () => {
  const r = ref(db(OWNER), "businesses", OWNER, "sales", "s1");
  await assertSucceeds(setDoc(r, sale("s1")));
  await assertSucceeds(setDoc(r, sale("s1")));
});

test("sales: a stored sale can never be altered or deleted", async () => {
  const r = ref(db(OWNER), "businesses", OWNER, "sales", "s1");
  await assertSucceeds(setDoc(r, sale("s1")));
  await assertFails(setDoc(r, sale("s1", OWNER, { total: 1 })));
  await assertFails(deleteDoc(r));
});

test("sales: other users and anonymous cannot read or write another business", async () => {
  await assertSucceeds(
    setDoc(ref(db(OWNER), "businesses", OWNER, "sales", "s1"), sale("s1")),
  );
  await assertFails(getDoc(ref(db(OTHER), "businesses", OWNER, "sales", "s1")));
  await assertFails(getDoc(ref(db(null), "businesses", OWNER, "sales", "s1")));
  await assertFails(
    setDoc(
      ref(db(OTHER), "businesses", OWNER, "sales", "s2"),
      sale("s2", OTHER),
    ),
  );
  await assertFails(
    setDoc(ref(db(null), "businesses", OWNER, "sales", "s2"), sale("s2")),
  );
  await assertSucceeds(
    getDoc(ref(db(OWNER), "businesses", OWNER, "sales", "s1")),
  );
});

test("sales: invalid records are refused", async () => {
  const w = (id, data) =>
    setDoc(ref(db(OWNER), "businesses", OWNER, "sales", id), data);
  await assertFails(w("s1", sale("different-id")));
  await assertFails(w("s1", sale("s1", OWNER, { total: -1 })));
  await assertFails(w("s1", sale("s1", OWNER, { total: "5" })));
  await assertFails(w("s1", sale("s1", OWNER, { total: 2e9 })));
  await assertFails(w("s1", sale("s1", OWNER, { items: [] })));
  await assertFails(w("s1", sale("s1", OWNER, { items: "x" })));
  await assertFails(w("s1", sale("s1", OWNER, { paymentMethod: "" })));
  await assertFails(
    w("s1", sale("s1", OWNER, { currency: "TOOLONGCURRENCY" })),
  );
  await assertFails(w("s1", sale("s1", OWNER, { paymentVerified: "yes" })));
  const { paymentMethod, ...missing } = sale("s1");
  await assertFails(w("s1", missing));
  const { staffUid, ...noStaff } = sale("s1");
  await assertFails(w("s1", noStaff));
  const tooMany = sale("s1");
  for (let i = 0; i < 40; i++) tooMany["f" + i] = i;
  await assertFails(w("s1", tooMany));
});

test("sales: a record must be stamped with the writer's own uid (no impersonation)", async () => {
  await assertFails(
    setDoc(
      ref(db(OWNER), "businesses", OWNER, "sales", "s1"),
      sale("s1", CASHIER),
    ),
  );
  await seed();
  await assertFails(
    setDoc(
      ref(db(CASHIER), "businesses", OWNER, "sales", "s1"),
      sale("s1", OWNER),
    ),
  );
});

/* ---------- audit hardening: types, invoices, verified payments, timestamps ---------- */
test("sales: optional fields are type-checked (tier, subtotal, tax, discount, syncStatus)", async () => {
  const w = (id, data) =>
    setDoc(ref(db(OWNER), "businesses", OWNER, "sales", id), data);
  await assertSucceeds(
    w(
      "t1",
      sale("t1", OWNER, {
        tier: "retail",
        subtotal: 5,
        tax: 0,
        syncStatus: "pending",
      }),
    ),
  );
  await assertFails(w("t2", sale("t2", OWNER, { tier: "platinum" })));
  await assertFails(w("t2", sale("t2", OWNER, { subtotal: "5" })));
  await assertFails(w("t2", sale("t2", OWNER, { subtotal: -1 })));
  await assertFails(w("t2", sale("t2", OWNER, { tax: { amount: 1 } })));
  await assertFails(w("t2", sale("t2", OWNER, { syncStatus: "x".repeat(21) })));
  await assertFails(w("t2", sale("t2", OWNER, { discount: 5 })));
  await assertFails(w("t2", sale("t2", OWNER, { discount: { amount: "5" } })));
  await assertFails(w("t2", sale("t2", OWNER, { discount: { amount: -1 } })));
  await assertSucceeds(
    w(
      "t3",
      sale("t3", OWNER, { discount: { type: "fixed", value: 1, amount: 1 } }),
    ),
  );
});

test("sales: an invoice must agree with the sale and be well formed", async () => {
  const w = (id, data) =>
    setDoc(ref(db(OWNER), "businesses", OWNER, "sales", id), data);
  const inv = (over = {}) => ({ ...invoiceSale("x").invoice, ...over });
  await assertSucceeds(w("i1", invoiceSale("i1")));
  // total on the invoice differs from the sale's total (a forged balance)
  await assertFails(
    w("i2", { ...invoiceSale("i2"), invoice: inv({ total: 1 }) }),
  );
  await assertFails(
    w("i3", { ...invoiceSale("i3"), invoice: inv({ total: "112.5" }) }),
  );
  await assertFails(
    w("i4", { ...invoiceSale("i4"), invoice: inv({ mode: "gift" }) }),
  );
  await assertFails(
    w("i5", { ...invoiceSale("i5"), invoice: inv({ number: "" }) }),
  );
  await assertFails(
    w("i6", { ...invoiceSale("i6"), invoice: inv({ tax: "x" }) }),
  );
  await assertFails(
    w("i7", {
      ...invoiceSale("i7"),
      invoice: inv({ customerName: "n".repeat(101) }),
    }),
  );
  await assertFails(w("i8", { ...invoiceSale("i8"), invoice: "INV-1" }));
  const { number, ...noNumber } = inv();
  await assertFails(w("i9", { ...invoiceSale("i9"), invoice: noNumber }));
  // an invoice on account must name the customer
  const { customerId, ...noCustomer } = invoiceSale("i10");
  await assertFails(w("i10", noCustomer));
  // a paid invoice does not need one
  await assertSucceeds(
    w("i11", {
      ...noCustomer,
      id: "i11",
      paymentMethod: "cash",
      paymentVerified: true,
      invoice: inv({ mode: "paid" }),
    }),
  );
});

test("sales: a non-cash payment can never be recorded as verified", async () => {
  const w = (id, data) =>
    setDoc(ref(db(OWNER), "businesses", OWNER, "sales", id), data);
  await assertSucceeds(
    w(
      "v1",
      sale("v1", OWNER, { paymentMethod: "cash", paymentVerified: true }),
    ),
  );
  await assertSucceeds(
    w(
      "v2",
      sale("v2", OWNER, { paymentMethod: "other", paymentVerified: false }),
    ),
  );
  const { paymentVerified, ...none } = sale("v3", OWNER, {
    paymentMethod: "other",
  });
  await assertSucceeds(w("v3", none));
  await assertFails(
    w(
      "v4",
      sale("v4", OWNER, { paymentMethod: "other", paymentVerified: true }),
    ),
  );
  await assertFails(
    w(
      "v5",
      sale("v5", OWNER, { paymentMethod: "account", paymentVerified: true }),
    ),
  );
});

test("timestamps: positive and at most 7 days ahead; sales, payments and business", async () => {
  const day = 86400000;
  const w = (id, data) =>
    setDoc(ref(db(OWNER), "businesses", OWNER, "sales", id), data);
  await assertSucceeds(
    w("c1", sale("c1", OWNER, { createdAt: Date.now() + day })),
  );
  await assertFails(
    w("c2", sale("c2", OWNER, { createdAt: Date.now() + 30 * day })),
  );
  await assertFails(w("c3", sale("c3", OWNER, { createdAt: 0 })));
  await assertFails(w("c4", sale("c4", OWNER, { createdAt: -5 })));
  await assertFails(w("c5", sale("c5", OWNER, { createdAt: "now" })));
  await assertFails(
    setDoc(
      ref(db(OWNER), "businesses", OWNER, "payments", "p1"),
      payment("p1", OWNER, { createdAt: Date.now() + 30 * day }),
    ),
  );
  await assertFails(
    setDoc(
      ref(db(OWNER), "businesses", OWNER),
      business({ createdAt: Date.now() + 30 * day }),
    ),
  );
});

test("staff: the staff ID is length limited", async () => {
  const long = "s".repeat(129);
  await assertFails(
    setDoc(ref(db(OWNER), "businesses", OWNER, "staff", long), staff(long)),
  );
  await assertSucceeds(
    setDoc(
      ref(db(OWNER), "businesses", OWNER, "staff", "s".repeat(128)),
      staff("s".repeat(128)),
    ),
  );
});

/* ---------- payments ---------- */
test("payments: valid payment accepted; zero, negative, missing customer refused; append-only", async () => {
  const w = (id, data) =>
    setDoc(ref(db(OWNER), "businesses", OWNER, "payments", id), data);
  await assertSucceeds(w("p1", payment("p1")));
  await assertSucceeds(w("p1", payment("p1")));
  await assertFails(w("p1", payment("p1", OWNER, { amount: 1 })));
  await assertFails(
    deleteDoc(ref(db(OWNER), "businesses", OWNER, "payments", "p1")),
  );
  await assertFails(w("p2", payment("p2", OWNER, { amount: 0 })));
  await assertFails(w("p3", payment("p3", OWNER, { amount: -5 })));
  await assertFails(w("p4", payment("p4", OWNER, { customerId: "" })));
  await assertFails(w("p5", payment("other-id")));
  await assertFails(
    setDoc(
      ref(db(OTHER), "businesses", OWNER, "payments", "p6"),
      payment("p6", OTHER),
    ),
  );
});

/* ---------- customers ---------- */
test("customers: owner can create and edit, not delete; unknown fields and other users refused", async () => {
  const r = ref(db(OWNER), "businesses", OWNER, "customers", "c1");
  await assertSucceeds(
    setDoc(r, {
      id: "c1",
      name: "Trade Co",
      creditLimit: 500,
      terms: "Net 30",
      taxNumber: "T-1",
    }),
  );
  await assertSucceeds(
    setDoc(r, { id: "c1", name: "Trade Co Ltd", creditLimit: 800 }),
  );
  await assertFails(deleteDoc(r));
  await assertFails(setDoc(r, { id: "c1", name: "X", secret: "no" }));
  await assertFails(setDoc(r, { id: "c1", name: "", creditLimit: 1 }));
  await assertFails(setDoc(r, { id: "c1", name: "X", creditLimit: -1 }));
  await assertFails(
    setDoc(ref(db(OTHER), "businesses", OWNER, "customers", "c2"), {
      id: "c2",
      name: "Y",
    }),
  );
});

test("queries the app uses (by customerId) work for the owner and fail for others", async () => {
  await assertSucceeds(
    setDoc(
      ref(db(OWNER), "businesses", OWNER, "sales", "i1"),
      invoiceSale("i1"),
    ),
  );
  const q = (d) =>
    getDocs(
      query(
        collection(d, "businesses", OWNER, "sales"),
        where("customerId", "==", "c1"),
      ),
    );
  const snap = await assertSucceeds(q(db(OWNER)));
  assert.equal(snap.size, 1);
  await assertFails(q(db(OTHER)));
  await assertFails(q(db(null)));
});

/* ---------- staff management ---------- */
test("staff: only the owner can add or deactivate staff; role and createdAt are fixed; no delete", async () => {
  await assertSucceeds(
    setDoc(
      ref(db(OWNER), "businesses", OWNER, "staff", CASHIER),
      staff(CASHIER),
    ),
  );
  await assertSucceeds(
    setDoc(
      ref(db(OWNER), "businesses", OWNER, "staff", CASHIER),
      staff(CASHIER, { active: false }),
    ),
  );
  await assertFails(
    setDoc(
      ref(db(OWNER), "businesses", OWNER, "staff", CASHIER),
      staff(CASHIER, { role: "owner" }),
    ),
  );
  await assertFails(
    setDoc(
      ref(db(OWNER), "businesses", OWNER, "staff", CASHIER),
      staff(CASHIER, { createdAt: 5 }),
    ),
  );
  await assertFails(
    deleteDoc(ref(db(OWNER), "businesses", OWNER, "staff", CASHIER)),
  );
  await assertFails(
    setDoc(
      ref(db(OWNER), "businesses", OWNER, "staff", "someoneElse"),
      staff(CASHIER),
    ),
  );
  await assertFails(
    setDoc(ref(db(OWNER), "businesses", OWNER, "staff", OWNER), staff(OWNER)),
  );
  await assertFails(
    setDoc(ref(db(OWNER), "businesses", OWNER, "staff", CASHIER2), {
      ...staff(CASHIER2),
      extra: 1,
    }),
  );
  await assertFails(
    setDoc(
      ref(db(OTHER), "businesses", OWNER, "staff", CASHIER2),
      staff(CASHIER2),
    ),
  );
});

test("staff: a cashier cannot make themselves staff, or change their own record", async () => {
  await assertFails(
    setDoc(
      ref(db(CASHIER), "businesses", OWNER, "staff", CASHIER),
      staff(CASHIER),
    ),
  );
  await seed();
  await assertFails(
    setDoc(
      ref(db(CASHIER), "businesses", OWNER, "staff", CASHIER),
      staff(CASHIER, { name: "Boss" }),
    ),
  );
});

test("staff: a cashier can read only their own record; the owner can list all", async () => {
  await seed();
  await assertSucceeds(
    getDoc(ref(db(CASHIER), "businesses", OWNER, "staff", CASHIER)),
  );
  await assertFails(
    getDoc(ref(db(CASHIER2), "businesses", OWNER, "staff", CASHIER)),
  );
  await assertFails(
    getDocs(collection(db(CASHIER), "businesses", OWNER, "staff")),
  );
  await assertSucceeds(
    getDocs(collection(db(OWNER), "businesses", OWNER, "staff")),
  );
});

/* ---------- cashier role ---------- */
test("cashier: an active cashier can sell and record payments as themselves", async () => {
  await seed();
  const c = db(CASHIER);
  await assertSucceeds(
    setDoc(ref(c, "businesses", OWNER, "sales", "s1"), sale("s1", CASHIER)),
  );
  await assertSucceeds(
    setDoc(ref(c, "businesses", OWNER, "sales", "s1"), sale("s1", CASHIER)),
  );
  await assertSucceeds(
    setDoc(
      ref(c, "businesses", OWNER, "payments", "p1"),
      payment("p1", CASHIER),
    ),
  );
  await assertFails(
    setDoc(
      ref(c, "businesses", OWNER, "sales", "s1"),
      sale("s1", CASHIER, { total: 1 }),
    ),
  );
  await assertFails(deleteDoc(ref(c, "businesses", OWNER, "sales", "s1")));
});

test("cashier: sees only their own sales and payments, not the owner's or other cashiers'", async () => {
  await seed();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(
      doc(d, "businesses", OWNER, "sales", "owner1"),
      sale("owner1", OWNER),
    );
    await setDoc(
      doc(d, "businesses", OWNER, "sales", "mine"),
      sale("mine", CASHIER),
    );
    await setDoc(
      doc(d, "businesses", OWNER, "payments", "pmine"),
      payment("pmine", CASHIER),
    );
    await setDoc(
      doc(d, "businesses", OWNER, "payments", "powner"),
      payment("powner", OWNER),
    );
  });
  const c = db(CASHIER);
  await assertSucceeds(getDoc(ref(c, "businesses", OWNER, "sales", "mine")));
  await assertFails(getDoc(ref(c, "businesses", OWNER, "sales", "owner1")));
  await assertFails(getDocs(collection(c, "businesses", OWNER, "sales")));
  const mine = await assertSucceeds(
    getDocs(
      query(
        collection(c, "businesses", OWNER, "sales"),
        where("staffUid", "==", CASHIER),
      ),
    ),
  );
  assert.equal(mine.size, 1);
  await assertSucceeds(
    getDoc(ref(c, "businesses", OWNER, "payments", "pmine")),
  );
  await assertFails(getDoc(ref(c, "businesses", OWNER, "payments", "powner")));
  await assertSucceeds(
    getDocs(collection(db(OWNER), "businesses", OWNER, "sales")),
  );
});

test("cashier: cannot edit products, customers, the business, or other cashiers' records", async () => {
  await seed();
  const c = db(CASHIER);
  await assertFails(
    setDoc(ref(c, "businesses", OWNER, "products", "p1"), product("p1")),
  );
  await assertFails(
    setDoc(ref(c, "businesses", OWNER, "customers", "c1"), {
      id: "c1",
      name: "X",
    }),
  );
  await assertFails(
    setDoc(ref(c, "businesses", OWNER), business({ name: "Hijacked" })),
  );
  await assertFails(
    setDoc(ref(c, "businesses", OWNER, "sales", "s9"), sale("s9", CASHIER2)),
  );
});

test("cashier: can read the catalogue, trade customers and the business", async () => {
  await seed();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), "businesses", OWNER, "products", "p1"),
      product("p1"),
    );
    await setDoc(doc(ctx.firestore(), "businesses", OWNER, "customers", "c1"), {
      id: "c1",
      name: "Trade Co",
    });
  });
  const c = db(CASHIER);
  const ps = await assertSucceeds(
    getDocs(collection(c, "businesses", OWNER, "products")),
  );
  assert.equal(ps.size, 1);
  await assertSucceeds(
    getDocs(collection(c, "businesses", OWNER, "customers")),
  );
  await assertSucceeds(getDoc(ref(c, "businesses", OWNER)));
});

test("cashier: a deactivated cashier loses all access; a stranger never had any", async () => {
  await seed({ cashierActive: false });
  const c = db(CASHIER);
  await assertFails(
    setDoc(ref(c, "businesses", OWNER, "sales", "s1"), sale("s1", CASHIER)),
  );
  await assertFails(getDocs(collection(c, "businesses", OWNER, "products")));
  await assertFails(getDoc(ref(c, "businesses", OWNER)));
  await assertFails(
    setDoc(
      ref(db(CASHIER2), "businesses", OWNER, "sales", "s1"),
      sale("s1", CASHIER2),
    ),
  );
  await assertFails(
    getDocs(collection(db(CASHIER2), "businesses", OWNER, "products")),
  );
});

test("cashier: staff of one business cannot reach another business", async () => {
  await seed();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), "businesses", OTHER),
      business({ ownerUid: OTHER }),
    );
  });
  await assertFails(
    setDoc(
      ref(db(CASHIER), "businesses", OTHER, "sales", "s1"),
      sale("s1", CASHIER),
    ),
  );
  await assertFails(getDoc(ref(db(CASHIER), "businesses", OTHER)));
});

/* ---------- products ---------- */
test("products: owner can create, edit and delete; invalid or unknown fields are refused", async () => {
  const r = ref(db(OWNER), "businesses", OWNER, "products", "p1");
  await assertSucceeds(setDoc(r, product("p1")));
  await assertSucceeds(
    setDoc(
      r,
      product("p1", {
        price: 3,
        category: "Drinks",
        reorderLevel: 2,
        prices: { retail: 3 },
        packs: [{ name: "Carton", units: 24 }],
        taxExempt: true,
        updatedAt: 1700000000500,
      }),
    ),
  );
  await assertSucceeds(deleteDoc(r));
  const w = (id, data) =>
    setDoc(ref(db(OWNER), "businesses", OWNER, "products", id), data);
  await assertFails(w("p2", product("p2", { price: -1 })));
  await assertFails(w("p2", product("p2", { name: "" })));
  await assertFails(w("p2", product("p2", { stock: -1 })));
  await assertFails(w("p2", product("p2", { secret: "x" })));
  await assertFails(w("p2", product("other-id")));
  await assertFails(w("p2", product("p2", { packs: "x" })));
  await assertFails(w("p2", product("p2", { updatedAt: "now" })));
  const { updatedAt, ...noStamp } = product("p3");
  await assertFails(w("p3", noStamp));
});

test("products: other users and anonymous cannot read or write the catalogue", async () => {
  await assertSucceeds(
    setDoc(
      ref(db(OWNER), "businesses", OWNER, "products", "p1"),
      product("p1"),
    ),
  );
  await assertFails(
    setDoc(
      ref(db(OTHER), "businesses", OWNER, "products", "p2"),
      product("p2"),
    ),
  );
  await assertFails(
    getDocs(collection(db(OTHER), "businesses", OWNER, "products")),
  );
  await assertFails(
    getDocs(collection(db(null), "businesses", OWNER, "products")),
  );
  await assertFails(
    deleteDoc(ref(db(OTHER), "businesses", OWNER, "products", "p1")),
  );
});

/* ---------- refunds (credit notes) ---------- */
const refundDoc = (id, by = OWNER, over = {}) => ({
  id,
  staffUid: by,
  saleId: "s1",
  number: "CN-AB12-1",
  createdAt: 1700000000002,
  currency: "AUD",
  method: "cash",
  items: [
    {
      lineIndex: 0,
      productId: "p1",
      name: "Water",
      unitPrice: 2.5,
      quantity: 1,
    },
  ],
  tax: 0,
  total: 2.5,
  restock: true,
  syncStatus: "pending",
  ...over,
});
// Seed (rules bypassed) a plain sale s1 (total 5), an invoice on account i1 (customer c1) and a paid invoice i2.
async function seedSales() {
  await seed();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, "businesses", OWNER, "sales", "s1"), sale("s1", OWNER));
    await setDoc(
      doc(d, "businesses", OWNER, "sales", "i1"),
      invoiceSale("i1", OWNER),
    );
    await setDoc(
      doc(d, "businesses", OWNER, "sales", "c-sale"),
      sale("c-sale", CASHIER),
    );
    await setDoc(doc(d, "businesses", OWNER, "sales", "i2"), {
      ...invoiceSale("i2", OWNER),
      paymentMethod: "cash",
      paymentVerified: true,
      invoice: { ...invoiceSale("i2").invoice, mode: "paid" },
    });
  });
}
const colDoc = (uid, col, id) => ref(db(uid), "businesses", OWNER, col, id);

test("refunds: a credit note against an existing sale is accepted, idempotent, append-only", async () => {
  await seedSales();
  await assertSucceeds(setDoc(colDoc(OWNER, "refunds", "r1"), refundDoc("r1")));
  await assertSucceeds(setDoc(colDoc(OWNER, "refunds", "r1"), refundDoc("r1")));
  await assertFails(
    setDoc(
      colDoc(OWNER, "refunds", "r1"),
      refundDoc("r1", OWNER, { total: 1 }),
    ),
  );
  await assertFails(deleteDoc(colDoc(OWNER, "refunds", "r1")));
});

test("refunds: never larger than the sale, and the sale must exist", async () => {
  await seedSales();
  await assertSucceeds(
    setDoc(
      colDoc(OWNER, "refunds", "r1"),
      refundDoc("r1", OWNER, { total: 5 }),
    ),
  );
  await assertFails(
    setDoc(
      colDoc(OWNER, "refunds", "r2"),
      refundDoc("r2", OWNER, { total: 5.01 }),
    ),
  );
  await assertFails(
    setDoc(
      colDoc(OWNER, "refunds", "r3"),
      refundDoc("r3", OWNER, { saleId: "ghost" }),
    ),
  );
  await assertFails(
    setDoc(
      colDoc(OWNER, "refunds", "r4"),
      refundDoc("r4", OWNER, { total: 0 }),
    ),
  );
  await assertFails(
    setDoc(
      colDoc(OWNER, "refunds", "r5"),
      refundDoc("r5", OWNER, { total: -2 }),
    ),
  );
});

test("refunds: invalid or unexpected fields are refused", async () => {
  await seedSales();
  const w = (id, over) =>
    setDoc(colDoc(OWNER, "refunds", id), refundDoc(id, OWNER, over));
  await assertFails(w("x1", { method: "bitcoin" }));
  await assertFails(w("x2", { items: [] }));
  await assertFails(w("x3", { secret: "x" }));
  await assertFails(w("x4", { number: "" }));
  await assertFails(w("x5", { reason: "r".repeat(201) }));
  await assertFails(w("x6", { createdAt: Date.now() + 30 * 86400000 }));
  await assertFails(w("x7", { restock: "yes" }));
  await assertFails(
    setDoc(colDoc(OWNER, "refunds", "x8"), refundDoc("other-id")),
  );
  await assertSucceeds(w("ok", { reason: "Wrong size" }));
});

test("refunds: credit to an account needs an invoice on account for that same customer", async () => {
  await seedSales();
  const acct = (id, over) =>
    setDoc(
      colDoc(OWNER, "refunds", id),
      refundDoc(id, OWNER, {
        method: "account",
        saleId: "i1",
        customerId: "c1",
        total: 50,
        invoiceNumber: "INV-A1-1",
        ...over,
      }),
    );
  await assertSucceeds(acct("a1", {}));
  await assertFails(acct("a2", { customerId: "someone-else" }));
  const { customerId, ...none } = refundDoc("a3", OWNER, {
    method: "account",
    saleId: "i1",
    total: 50,
  });
  await assertFails(setDoc(colDoc(OWNER, "refunds", "a3"), none));
  await assertFails(acct("a4", { saleId: "s1" })); // a plain sale has no account
  await assertFails(acct("a5", { saleId: "i2" })); // a paid invoice is not on account
  await assertFails(acct("a6", { total: 112.51 })); // over the invoice total
});

test("refunds: a cashier can record one, sees only their own, and cannot impersonate", async () => {
  await seedSales();
  await assertSucceeds(
    setDoc(
      colDoc(CASHIER, "refunds", "cr1"),
      refundDoc("cr1", CASHIER, { saleId: "c-sale" }),
    ),
  );
  await assertFails(
    setDoc(
      colDoc(CASHIER, "refunds", "cr2"),
      refundDoc("cr2", OWNER, { saleId: "c-sale" }),
    ),
  );
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), "businesses", OWNER, "staff", CASHIER2),
      staff(CASHIER2),
    );
    await setDoc(
      doc(ctx.firestore(), "businesses", OWNER, "refunds", "or1"),
      refundDoc("or1", OWNER),
    );
  });
  await assertSucceeds(getDoc(colDoc(CASHIER, "refunds", "cr1")));
  await assertFails(getDoc(colDoc(CASHIER, "refunds", "or1")));
  await assertFails(getDoc(colDoc(CASHIER2, "refunds", "cr1")));
  await assertSucceeds(getDoc(colDoc(OWNER, "refunds", "cr1")));
  await assertFails(
    setDoc(colDoc(OTHER, "refunds", "z1"), refundDoc("z1", OTHER)),
  );
  await assertFails(
    setDoc(colDoc(null, "refunds", "z2"), refundDoc("z2", OWNER)),
  );
});

/* ---------- register shifts ---------- */
const shift = (id, by = OWNER, over = {}) => ({
  id,
  staffUid: by,
  openedAt: 1700000000000,
  closedAt: 1700000600000,
  openingFloat: 50,
  countedCash: 120.5,
  expectedCash: 120,
  difference: 0.5,
  salesCount: 7,
  cashSales: 70.5,
  cashRefunds: 0,
  cashPayments: 0,
  currency: "AUD",
  syncStatus: "pending",
  ...over,
});

test("registers: a closed shift is accepted, immutable, and validated", async () => {
  await seed();
  const w = (uid, id, data) => setDoc(colDoc(uid, "registers", id), data);
  await assertSucceeds(w(OWNER, "g1", shift("g1")));
  await assertSucceeds(w(OWNER, "g1", shift("g1")));
  await assertFails(w(OWNER, "g1", shift("g1", OWNER, { countedCash: 1 })));
  await assertFails(deleteDoc(colDoc(OWNER, "registers", "g1")));
  await assertSucceeds(w(CASHIER, "g2", shift("g2", CASHIER)));
  await assertFails(w(CASHIER, "g3", shift("g3", OWNER)));
  await assertFails(
    w(OWNER, "g4", shift("g4", OWNER, { closedAt: 1700000000000 - 1 })),
  );
  await assertFails(w(OWNER, "g5", shift("g5", OWNER, { countedCash: -1 })));
  await assertFails(w(OWNER, "g6", shift("g6", OWNER, { salesCount: 1.5 })));
  await assertFails(w(OWNER, "g7", shift("g7", OWNER, { difference: "0" })));
  await assertFails(w(OWNER, "g8", shift("g8", OWNER, { extra: 1 })));
  await assertFails(w(OTHER, "g9", shift("g9", OTHER)));
  await assertSucceeds(getDoc(colDoc(CASHIER, "registers", "g2")));
  await assertFails(getDoc(colDoc(CASHIER, "registers", "g1")));
});

/* ---------- stock movements ---------- */
const move = (id, by = OWNER, over = {}) => ({
  id,
  staffUid: by,
  productId: "p1",
  productName: "Water",
  delta: 24,
  reason: "purchase",
  refId: "po1",
  createdAt: 1700000000000,
  syncStatus: "pending",
  ...over,
});

test("stockMoves: append-only audit trail with a sensible delta and a known reason", async () => {
  await seed();
  const w = (uid, id, data) => setDoc(colDoc(uid, "stockMoves", id), data);
  await assertSucceeds(w(OWNER, "m1", move("m1")));
  await assertSucceeds(w(OWNER, "m1", move("m1")));
  await assertFails(w(OWNER, "m1", move("m1", OWNER, { delta: 25 })));
  await assertSucceeds(w(OWNER, "m9", move("m9", OWNER, { deviceId: "AB12" })));
  await assertFails(
    w(OWNER, "m10", move("m10", OWNER, { deviceId: "x".repeat(13) })),
  );
  await assertFails(deleteDoc(colDoc(OWNER, "stockMoves", "m1")));
  await assertSucceeds(
    w(OWNER, "m2", move("m2", OWNER, { delta: -3, reason: "damage" })),
  );
  await assertSucceeds(
    w(CASHIER, "m3", move("m3", CASHIER, { reason: "count", delta: -1 })),
  );
  await assertFails(w(OWNER, "m4", move("m4", OWNER, { delta: 0 })));
  await assertFails(w(OWNER, "m5", move("m5", OWNER, { delta: 2e9 })));
  await assertFails(w(OWNER, "m6", move("m6", OWNER, { reason: "gift" })));
  await assertFails(w(OWNER, "m7", move("m7", OWNER, { productId: "" })));
  await assertFails(w(OWNER, "m8", move("m8", OWNER, { delta: "5" })));
  await assertFails(w(CASHIER, "m9", move("m9", OWNER)));
  await assertFails(w(OTHER, "m10", move("m10", OTHER)));
});

/* ---------- suppliers and purchase orders (owner only) ---------- */
const supplier = (id, over = {}) => ({
  id,
  staffUid: OWNER,
  name: "Pacific Traders",
  phone: "+686 12345",
  updatedAt: 1700000000000,
  syncStatus: "pending",
  ...over,
});
const po = (id, over = {}) => ({
  id,
  staffUid: OWNER,
  number: "PO-AB12-1",
  supplierId: "sup1",
  supplierName: "Pacific Traders",
  status: "draft",
  items: [{ productId: "p1", name: "Water", qty: 24, unitCost: 1.2 }],
  total: 28.8,
  currency: "AUD",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  syncStatus: "pending",
  ...over,
});

test("suppliers: only the owner, and an older version cannot overwrite a newer one", async () => {
  await seed();
  const w = (uid, id, data) => setDoc(colDoc(uid, "suppliers", id), data);
  await assertSucceeds(w(OWNER, "sup1", supplier("sup1")));
  await assertSucceeds(
    w(
      OWNER,
      "sup1",
      supplier("sup1", {
        name: "Pacific Traders Ltd",
        updatedAt: 1700000005000,
      }),
    ),
  );
  await assertFails(
    w(
      OWNER,
      "sup1",
      supplier("sup1", { name: "Old", updatedAt: 1700000001000 }),
    ),
  );
  await assertFails(w(OWNER, "sup2", supplier("sup2", { name: "" })));
  await assertFails(w(OWNER, "sup3", supplier("sup3", { extra: 1 })));
  await assertFails(deleteDoc(colDoc(OWNER, "suppliers", "sup1")));
  await assertFails(
    w(CASHIER, "sup4", supplier("sup4", { staffUid: CASHIER })),
  );
  await assertFails(getDoc(colDoc(CASHIER, "suppliers", "sup1")));
  await assertFails(getDoc(colDoc(OTHER, "suppliers", "sup1")));
  await assertSucceeds(getDoc(colDoc(OWNER, "suppliers", "sup1")));
});

test("purchaseOrders: draft -> ordered -> received, then frozen; cashiers cannot see or write them", async () => {
  await seed();
  const w = (uid, id, data) => setDoc(colDoc(uid, "purchaseOrders", id), data);
  await assertSucceeds(w(OWNER, "po1", po("po1")));
  await assertSucceeds(
    w(OWNER, "po1", po("po1", { status: "ordered", updatedAt: 1700000001000 })),
  );
  await assertFails(
    w(
      OWNER,
      "po1",
      po("po1", { status: "received", updatedAt: 1700000002000 }),
    ),
  ); // needs receivedAt
  await assertSucceeds(
    w(
      OWNER,
      "po1",
      po("po1", {
        status: "received",
        receivedAt: 1700000002000,
        updatedAt: 1700000002000,
      }),
    ),
  );
  await assertSucceeds(
    w(
      OWNER,
      "po1",
      po("po1", {
        status: "received",
        receivedAt: 1700000002000,
        updatedAt: 1700000002000,
      }),
    ),
  ); // identical re-send
  await assertFails(
    w(
      OWNER,
      "po1",
      po("po1", {
        status: "received",
        receivedAt: 1700000002000,
        updatedAt: 1700000003000,
        total: 1,
      }),
    ),
  );
  await assertFails(
    w(OWNER, "po1", po("po1", { status: "draft", updatedAt: 1700000009000 })),
  );
  await assertFails(w(OWNER, "po2", po("po2", { items: [] })));
  await assertFails(w(OWNER, "po3", po("po3", { total: -1 })));
  await assertFails(w(OWNER, "po4", po("po4", { status: "shipped" })));
  await assertSucceeds(w(OWNER, "po5", po("po5")));
  await assertFails(
    w(
      OWNER,
      "po5",
      po("po5", {
        status: "ordered",
        createdAt: 1700000000500,
        updatedAt: 1700000001000,
      }),
    ),
  );
  await assertFails(w(OWNER, "po5", po("po5", { updatedAt: 1699999999000 })));
  await assertFails(deleteDoc(colDoc(OWNER, "purchaseOrders", "po5")));
  await assertFails(w(CASHIER, "po6", po("po6", { staffUid: CASHIER })));
  await assertFails(getDoc(colDoc(CASHIER, "purchaseOrders", "po1")));
});

/* ---------- quotes ---------- */
const quote = (id, by = CASHIER, over = {}) => ({
  id,
  staffUid: by,
  number: "QT-AB12-1",
  customerId: "c1",
  customerName: "Trade Co",
  status: "open",
  items: [{ productId: "p1", name: "Water", unitPrice: 2.5, quantity: 10 }],
  subtotal: 25,
  tax: 3.13,
  total: 28.13,
  currency: "AUD",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  syncStatus: "pending",
  ...over,
});

test("quotes: a member writes their own, edits it while open, and it freezes once converted", async () => {
  await seed();
  const w = (uid, id, data) => setDoc(colDoc(uid, "quotes", id), data);
  await assertSucceeds(w(CASHIER, "q1", quote("q1")));
  await assertSucceeds(
    w(
      CASHIER,
      "q1",
      quote("q1", CASHIER, { note: "Revised", updatedAt: 1700000001000 }),
    ),
  );
  await assertFails(
    w(
      CASHIER,
      "q1",
      quote("q1", CASHIER, { createdAt: 5, updatedAt: 1700000002000 }),
    ),
  );
  await assertFails(
    w(CASHIER, "q1", quote("q1", CASHIER, { updatedAt: 1699999990000 })),
  );
  await assertFails(
    w(CASHIER, "q1", quote("q1", OWNER, { updatedAt: 1700000002000 })),
  ); // cannot change the author
  await assertFails(
    w(
      CASHIER,
      "q2",
      quote("q2", CASHIER, { status: "converted", updatedAt: 1700000001000 }),
    ),
  ); // needs convertedSaleId
  await assertSucceeds(
    w(
      CASHIER,
      "q1",
      quote("q1", CASHIER, {
        status: "converted",
        convertedSaleId: "s1",
        updatedAt: 1700000003000,
      }),
    ),
  );
  await assertSucceeds(
    w(
      CASHIER,
      "q1",
      quote("q1", CASHIER, {
        status: "converted",
        convertedSaleId: "s1",
        updatedAt: 1700000003000,
      }),
    ),
  ); // identical
  await assertFails(
    w(
      CASHIER,
      "q1",
      quote("q1", CASHIER, { status: "open", updatedAt: 1700000009000 }),
    ),
  );
  await assertFails(deleteDoc(colDoc(CASHIER, "quotes", "q1")));
});

test("quotes: other cashiers cannot read or change them; the owner can read and update an open one", async () => {
  await seed();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), "businesses", OWNER, "staff", CASHIER2),
      staff(CASHIER2),
    );
  });
  await assertSucceeds(setDoc(colDoc(CASHIER, "quotes", "q1"), quote("q1")));
  await assertFails(getDoc(colDoc(CASHIER2, "quotes", "q1")));
  await assertFails(
    setDoc(
      colDoc(CASHIER2, "quotes", "q1"),
      quote("q1", CASHIER, { note: "hijack", updatedAt: 1700000001000 }),
    ),
  );
  await assertSucceeds(getDoc(colDoc(OWNER, "quotes", "q1")));
  await assertSucceeds(
    setDoc(
      colDoc(OWNER, "quotes", "q1"),
      quote("q1", CASHIER, { note: "Owner edit", updatedAt: 1700000001000 }),
    ),
  );
  await assertFails(setDoc(colDoc(OTHER, "quotes", "q9"), quote("q9", OTHER)));
  await assertFails(
    setDoc(
      colDoc(CASHIER, "quotes", "q8"),
      quote("q8", CASHIER, { total: -1 }),
    ),
  );
  await assertFails(
    setDoc(
      colDoc(CASHIER, "quotes", "q7"),
      quote("q7", CASHIER, { status: "won" }),
    ),
  );
});

/* ---------- default deny ---------- */
test("default deny: unknown collections are closed to everyone", async () => {
  await assertFails(setDoc(ref(db(OWNER), "anything", "x"), { a: 1 }));
  await assertFails(getDoc(ref(db(OWNER), "anything", "x")));
  await assertFails(
    setDoc(ref(db(OWNER), "businesses", OWNER, "secrets", "x"), { a: 1 }),
  );
  await assertFails(getDoc(ref(db(null), "businesses", OWNER)));
});

/* ---------- staff roles: cashier / manager / inventory / auditor ---------- */
const MANAGER = "managerM",
  INVENTORY = "inventoryI",
  AUDITOR = "auditorA";
async function seedRoles() {
  await seed();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    for (const [uid, role] of [
      [MANAGER, "manager"],
      [INVENTORY, "inventory"],
      [AUDITOR, "auditor"],
    ])
      await setDoc(
        doc(d, "businesses", OWNER, "staff", uid),
        staff(uid, { role }),
      );
    await setDoc(
      doc(d, "businesses", OWNER, "sales", "cs1"),
      sale("cs1", CASHIER),
    );
  });
}

test("roles: the owner can set any known role, but not an unknown one", async () => {
  const r = (role) =>
    setDoc(
      ref(db(OWNER), "businesses", OWNER, "staff", "newStaffX"),
      staff("newStaffX", { role }),
    );
  await assertSucceeds(r("manager"));
  await assertSucceeds(r("auditor"));
  await assertSucceeds(r("inventory"));
  await assertSucceeds(r("cashier"));
  await assertFails(r("owner"));
  await assertFails(r("admin"));
});

test("roles: who may sell", async () => {
  await seedRoles();
  const w = (uid) =>
    setDoc(colDoc(uid, "sales", "x" + uid), sale("x" + uid, uid));
  await assertSucceeds(w(CASHIER));
  await assertSucceeds(w(MANAGER));
  await assertFails(w(INVENTORY));
  await assertFails(w(AUDITOR));
});

test("roles: who may read other people's sales", async () => {
  await seedRoles();
  const r = (uid) => getDoc(colDoc(uid, "sales", "cs1"));
  await assertSucceeds(r(OWNER));
  await assertSucceeds(r(CASHIER));
  await assertSucceeds(r(MANAGER));
  await assertSucceeds(r(AUDITOR));
  await assertFails(r(INVENTORY));
  await assertFails(r(OTHER));
  await env.withSecurityRulesDisabled(async (ctx) =>
    setDoc(
      doc(ctx.firestore(), "businesses", OWNER, "staff", "cashier2"),
      staff("cashier2"),
    ),
  );
  await assertFails(r("cashier2"));
});

test("roles: catalogue and customers", async () => {
  await seedRoles();
  const p = (uid, id) => setDoc(colDoc(uid, "products", id), product(id));
  await assertSucceeds(p(MANAGER, "pm"));
  await assertSucceeds(p(INVENTORY, "pi"));
  await assertFails(p(CASHIER, "pc"));
  await assertFails(p(AUDITOR, "pa"));
  await assertFails(deleteDoc(colDoc(MANAGER, "products", "pi")));
  await assertFails(deleteDoc(colDoc(INVENTORY, "products", "pi")));
  await assertSucceeds(deleteDoc(colDoc(OWNER, "products", "pm")));
  const c = (uid, id) =>
    setDoc(colDoc(uid, "customers", id), { id, name: "Trade Co" });
  await assertSucceeds(c(MANAGER, "c1"));
  await assertFails(c(INVENTORY, "c2"));
  await assertFails(c(CASHIER, "c3"));
  await assertSucceeds(getDoc(colDoc(AUDITOR, "products", "pi")));
});

test("roles: stock, suppliers and purchase orders", async () => {
  await seedRoles();
  const m = (uid, id) => setDoc(colDoc(uid, "stockMoves", id), move(id, uid));
  await assertSucceeds(m(INVENTORY, "m1"));
  await assertSucceeds(m(MANAGER, "m2"));
  await assertSucceeds(m(CASHIER, "m3"));
  await assertFails(m(AUDITOR, "m4"));
  const s = (uid, id) =>
    setDoc(colDoc(uid, "suppliers", id), supplier(id, { staffUid: uid }));
  await assertSucceeds(s(INVENTORY, "s1"));
  await assertSucceeds(s(MANAGER, "s2"));
  await assertFails(s(CASHIER, "s3"));
  await assertFails(s(AUDITOR, "s4"));
  await assertFails(getDoc(colDoc(CASHIER, "suppliers", "s1")));
  await assertFails(getDoc(colDoc(AUDITOR, "suppliers", "s1")));
  await assertSucceeds(
    setDoc(
      colDoc(INVENTORY, "purchaseOrders", "o1"),
      po("o1", { staffUid: INVENTORY }),
    ),
  );
});

test("roles: nobody but the owner manages staff or the business", async () => {
  await seedRoles();
  for (const uid of [CASHIER, MANAGER, INVENTORY, AUDITOR]) {
    await assertFails(
      setDoc(colDoc(uid, "staff", "newStaffY"), staff("newStaffY")),
    );
    await assertFails(
      setDoc(ref(db(uid), "businesses", OWNER), business({ name: "Hijack" })),
    );
    await assertFails(
      getDocs(collection(db(uid), "businesses", OWNER, "staff")),
    );
  }
});

test("roles: a deactivated manager loses everything", async () => {
  await seedRoles();
  await env.withSecurityRulesDisabled(async (ctx) =>
    setDoc(
      doc(ctx.firestore(), "businesses", OWNER, "staff", MANAGER),
      staff(MANAGER, { role: "manager", active: false }),
    ),
  );
  await assertFails(
    setDoc(colDoc(MANAGER, "sales", "z1"), sale("z1", MANAGER)),
  );
  await assertFails(getDoc(colDoc(MANAGER, "sales", "cs1")));
  await assertFails(setDoc(colDoc(MANAGER, "products", "pz"), product("pz")));
});
