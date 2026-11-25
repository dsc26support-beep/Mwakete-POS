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
let env;

const sale = (id, over = {}) => ({
  id,
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
const invoiceSale = (id) =>
  sale(id, {
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
const payment = (id, over = {}) => ({
  id,
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

const db = (uid) =>
  uid
    ? env.authenticatedContext(uid).firestore()
    : env.unauthenticatedContext().firestore();
const ref = (d, ...p) => doc(d, ...p);

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

test("business: owner can create their own, other users and anonymous cannot", async () => {
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
  await assertFails(setDoc(r, sale("s1", { total: 1 })));
  await assertFails(deleteDoc(r));
});

test("sales: other users and anonymous cannot read or write another business", async () => {
  await assertSucceeds(
    setDoc(ref(db(OWNER), "businesses", OWNER, "sales", "s1"), sale("s1")),
  );
  await assertFails(getDoc(ref(db(OTHER), "businesses", OWNER, "sales", "s1")));
  await assertFails(getDoc(ref(db(null), "businesses", OWNER, "sales", "s1")));
  await assertFails(
    setDoc(ref(db(OTHER), "businesses", OWNER, "sales", "s2"), sale("s2")),
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
  await assertFails(w("s1", sale("s1", { total: -1 })));
  await assertFails(w("s1", sale("s1", { total: "5" })));
  await assertFails(w("s1", sale("s1", { total: 2e9 })));
  await assertFails(w("s1", sale("s1", { items: [] })));
  await assertFails(w("s1", sale("s1", { items: "x" })));
  await assertFails(w("s1", sale("s1", { paymentMethod: "" })));
  await assertFails(w("s1", sale("s1", { currency: "TOOLONGCURRENCY" })));
  await assertFails(w("s1", sale("s1", { paymentVerified: "yes" })));
  const { paymentMethod, ...missing } = sale("s1");
  await assertFails(w("s1", missing));
  const tooMany = sale("s1");
  for (let i = 0; i < 40; i++) tooMany["f" + i] = i;
  await assertFails(w("s1", tooMany));
});

test("payments: valid payment accepted; zero, negative, missing customer refused; append-only", async () => {
  const w = (id, data) =>
    setDoc(ref(db(OWNER), "businesses", OWNER, "payments", id), data);
  await assertSucceeds(w("p1", payment("p1")));
  await assertSucceeds(w("p1", payment("p1")));
  await assertFails(w("p1", payment("p1", { amount: 1 })));
  await assertFails(
    deleteDoc(ref(db(OWNER), "businesses", OWNER, "payments", "p1")),
  );
  await assertFails(w("p2", payment("p2", { amount: 0 })));
  await assertFails(w("p3", payment("p3", { amount: -5 })));
  await assertFails(w("p4", payment("p4", { customerId: "" })));
  await assertFails(w("p5", payment("other-id")));
  await assertFails(
    setDoc(
      ref(db(OTHER), "businesses", OWNER, "payments", "p6"),
      payment("p6"),
    ),
  );
});

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

test("default deny: unknown collections are closed to everyone", async () => {
  await assertFails(setDoc(ref(db(OWNER), "anything", "x"), { a: 1 }));
  await assertFails(getDoc(ref(db(OWNER), "anything", "x")));
  await assertFails(
    setDoc(ref(db(OWNER), "businesses", OWNER, "secrets", "x"), { a: 1 }),
  );
  await assertFails(getDoc(ref(db(null), "businesses", OWNER)));
});
