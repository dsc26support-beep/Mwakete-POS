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
    discount: 0,
    total: 112.5,
    tax: { rate: 12.5, amount: 12.5 },
    invoice: {
      number: "INV-A1-1",
      mode: "account",
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

/* ---------- default deny ---------- */
test("default deny: unknown collections are closed to everyone", async () => {
  await assertFails(setDoc(ref(db(OWNER), "anything", "x"), { a: 1 }));
  await assertFails(getDoc(ref(db(OWNER), "anything", "x")));
  await assertFails(
    setDoc(ref(db(OWNER), "businesses", OWNER, "secrets", "x"), { a: 1 }),
  );
  await assertFails(getDoc(ref(db(null), "businesses", OWNER)));
});
