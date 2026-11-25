// Roles (owner / cashier), staff stamping and product sync for the Firebase backend.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { fakeFs } = require("./helpers/fakefs.js");

global.FIREBASE_CONFIG = require("../js/integrations/firebase-config.js");
const FB = require("../js/integrations/firebase.js");
const { syncWith, mergeProducts, productToCloud, isDirty } = FB._test;

const sale = (id, over = {}) => ({
  id,
  createdAt: 1,
  total: 5,
  paymentMethod: "cash",
  items: [{ productId: "p", name: "Water", unitPrice: 2.5, quantity: 2 }],
  ...over,
});
const prod = (id, over = {}) => ({
  id,
  name: "Water",
  price: 2.5,
  stock: 10,
  sku: "",
  updatedAt: 100,
  ...over,
});
const cashier = { businessId: "OWNER1", role: "cashier" };

test("every sale and payment carries the writer's uid (audit trail)", async () => {
  const f = fakeFs();
  await syncWith(f, {}, "U1", {
    transactions: [sale("s1")],
    payments: [{ id: "p1", customerId: "c1", amount: 5, createdAt: 2 }],
  });
  assert.equal(f.store.get("businesses/U1/sales/s1").staffUid, "U1");
  assert.equal(f.store.get("businesses/U1/payments/p1").staffUid, "U1");
});

test("a cashier writes into the owner's business as themselves", async () => {
  const f = fakeFs();
  const r = await syncWith(
    f,
    {},
    "STAFF1",
    { transactions: [sale("s1")] },
    cashier,
  );
  assert.deepEqual(r.acceptedIds, ["s1"]);
  assert.equal(f.store.get("businesses/OWNER1/sales/s1").staffUid, "STAFF1");
  assert.ok(!f.store.has("businesses/STAFF1/sales/s1"));
});

test("a cashier never pushes products or customers, never deletes, and gets no balances", async () => {
  const f = fakeFs({ existing: { "businesses/OWNER1/products/x": prod("x") } });
  const r = await syncWith(
    f,
    {},
    "STAFF1",
    {
      products: [prod("p1")],
      productDeletes: ["x"],
      customers: [{ id: "c1", name: "T" }],
      transactions: [
        sale("s1", {
          customerId: "c1",
          invoice: { mode: "account", total: 9 },
        }),
      ],
    },
    cashier,
  );
  assert.ok(!f.store.has("businesses/OWNER1/products/p1"));
  assert.ok(
    f.store.has("businesses/OWNER1/products/x"),
    "the owner's product was not deleted",
  );
  assert.ok(!f.store.has("businesses/OWNER1/customers/c1"));
  assert.deepEqual(r.balances, {});
  assert.deepEqual(r.acceptedProducts, []);
});

test("the owner pushes a dirty product and the server's confirmation is reported", async () => {
  const f = fakeFs();
  const r = await syncWith(f, {}, "U1", {
    products: [prod("p1", { updatedAt: 200 })],
  });
  assert.deepEqual(r.acceptedProducts, [{ id: "p1", updatedAt: 200 }]);
  assert.equal(f.store.get("businesses/U1/products/p1").price, 2.5);
});

test("a refused product is reported, not accepted", async () => {
  const f = fakeFs({ failWith: { bad: "permission-denied" } });
  const r = await syncWith(f, {}, "U1", {
    products: [prod("bad"), prod("ok")],
  });
  assert.deepEqual(
    r.acceptedProducts.map((p) => p.id),
    ["ok"],
  );
  assert.equal(r.rejectedProducts.length, 1);
  assert.equal(r.rejectedProducts[0].id, "bad");
});

test("a product removal is reported only once the server confirms it", async () => {
  const f = fakeFs({
    existing: {
      "businesses/U1/products/p1": prod("p1"),
      "businesses/U1/products/p2": prod("p2"),
    },
  });
  const r = await syncWith(f, {}, "U1", { productDeletes: ["p1"] });
  assert.deepEqual(r.deletedProductIds, ["p1"]);
  assert.ok(!f.store.has("businesses/U1/products/p1"));
  const f2 = fakeFs({
    failWith: { p1: "unavailable" },
    existing: { "businesses/U1/products/p1": prod("p1") },
  });
  await assert.rejects(
    syncWith(f2, {}, "U1", { productDeletes: ["p1"] }),
    /Could not reach the cloud/,
  );
});

test("sync returns the cloud catalogue and trade customers for every role", async () => {
  const f = fakeFs({
    existing: {
      "businesses/OWNER1/products/p1": prod("p1"),
      "businesses/OWNER1/customers/c1": { id: "c1", name: "Trade Co" },
    },
  });
  const r = await syncWith(f, {}, "STAFF1", {}, cashier);
  assert.deepEqual(
    r.cloudProducts.map((p) => p.id),
    ["p1"],
  );
  assert.deepEqual(
    r.cloudCustomers.map((c) => c.id),
    ["c1"],
  );
});

test("a failed catalogue read leaves cloudProducts undefined (the local catalogue is kept)", async () => {
  const f = fakeFs();
  const real = f.getDocs;
  f.getDocs = async (q) => {
    if (q.col.endsWith("/products")) throw new Error("offline");
    return real(q);
  };
  const r = await syncWith(f, {}, "U1", { transactions: [sale("s1")] });
  assert.equal(r.cloudProducts, undefined);
  assert.deepEqual(r.acceptedIds, ["s1"]);
});

test("productToCloud keeps only whitelisted fields and drops empty values", () => {
  const c = productToCloud({
    ...prod("p1"),
    category: "",
    reorderLevel: "",
    prices: { a: 1 },
    packs: [],
    taxExempt: true,
    cloudSyncedAt: 5,
    secretLocal: "x",
  });
  assert.deepEqual(Object.keys(c).sort(), [
    "id",
    "name",
    "packs",
    "price",
    "prices",
    "stock",
    "taxExempt",
    "updatedAt",
  ]);
});

test("productToCloud syncs description/unit/archived/history but never cost price or image", () => {
  const c = productToCloud({
    ...prod("p1"),
    description: "Loose leaf",
    unit: "kg",
    archived: true,
    priceHistory: [{ at: 1, from: 1, to: 2 }],
    costPrice: 4,
    image: "data:image/png;base64,AAAA",
  });
  assert.equal(c.description, "Loose leaf");
  assert.equal(c.unit, "kg");
  assert.equal(c.archived, true);
  assert.equal(c.priceHistory.length, 1);
  assert.equal("costPrice" in c, false);
  assert.equal("image" in c, false);
  assert.equal(
    "archived" in productToCloud({ ...prod("p2"), archived: false }),
    false,
  );
});

test("isDirty: edited after the last cloud confirmation", () => {
  assert.equal(isDirty({ updatedAt: 10 }), true);
  assert.equal(isDirty({ updatedAt: 10, cloudSyncedAt: 10 }), false);
  assert.equal(isDirty({ updatedAt: 11, cloudSyncedAt: 10 }), true);
});

test("mergeProducts: a new cloud product is added with its stock, marked synced", () => {
  const { upserts, removes } = mergeProducts(
    [],
    [prod("p1", { stock: 7, updatedAt: 50 })],
  );
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].stock, 7);
  assert.equal(upserts[0].cloudSyncedAt, 50);
  assert.deepEqual(removes, []);
});

test("mergeProducts: a newer cloud product updates catalogue fields but keeps this device's stock", () => {
  const local = [
    prod("p1", {
      stock: 3,
      price: 1,
      updatedAt: 10,
      cloudSyncedAt: 10,
      category: "Old",
    }),
  ];
  const { upserts } = mergeProducts(local, [
    prod("p1", { stock: 99, price: 4, updatedAt: 20 }),
  ]);
  assert.equal(upserts[0].price, 4);
  assert.equal(upserts[0].stock, 3);
  assert.equal(upserts[0].updatedAt, 20);
  assert.equal(upserts[0].cloudSyncedAt, 20);
  assert.equal(
    "category" in upserts[0],
    false,
    "a field cleared in the cloud is cleared here",
  );
});

test("mergeProducts: a newer local edit is kept (it will be pushed); an older cloud copy is ignored", () => {
  const local = [prod("p1", { price: 9, updatedAt: 30, cloudSyncedAt: 10 })];
  const { upserts, removes } = mergeProducts(local, [
    prod("p1", { price: 4, updatedAt: 20 }),
  ]);
  assert.deepEqual(upserts, []);
  assert.deepEqual(removes, []);
});

test("mergeProducts: removed in the cloud -> removed here only if it was synced and not edited since", () => {
  const synced = prod("a", { updatedAt: 10, cloudSyncedAt: 10 });
  const edited = prod("b", { updatedAt: 20, cloudSyncedAt: 10 });
  const neverSynced = prod("c", { updatedAt: 10 });
  assert.deepEqual(mergeProducts([synced, edited, neverSynced], []).removes, [
    "a",
  ]);
});

/* applyCloud (js/sync.js) run against an in-memory POSDB */
function loadSync(initial) {
  const data = {
    products: [...(initial.products || [])],
    settings: [...(initial.settings || [])],
    customers: [...(initial.customers || [])],
  };
  const keyOf = { products: "id", settings: "key", customers: "id" };
  const POSDB = {
    all: async (s) => data[s].map((x) => ({ ...x })),
    get: async (s, k) => {
      const r = data[s].find((x) => x[keyOf[s]] === k);
      return r ? { ...r } : undefined;
    },
    put: async (s, v) => {
      const i = data[s].findIndex((x) => x[keyOf[s]] === v[keyOf[s]]);
      if (i >= 0) data[s][i] = { ...v };
      else data[s].push({ ...v });
      return v;
    },
    remove: async (s, k) => {
      data[s] = data[s].filter((x) => x[keyOf[s]] !== k);
    },
  };
  const ctx = vm.createContext({
    POSDB,
    FirebaseBackend: FB,
    document: { getElementById: () => null },
    window: {},
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/sync.js"), "utf8"),
    ctx,
  );
  return { applyCloud: ctx.applyCloud, data: () => data };
}

test("applyCloud marks a product synced only for ids the server accepted", async () => {
  const sent = [prod("a", { updatedAt: 5 }), prod("b", { updatedAt: 6 })];
  const s = loadSync({ products: sent });
  await s.applyCloud(
    { acceptedProducts: [{ id: "a", updatedAt: 5 }] },
    sent,
    [],
  );
  const byId = Object.fromEntries(s.data().products.map((p) => [p.id, p]));
  assert.equal(byId.a.cloudSyncedAt, 5);
  assert.equal(byId.b.cloudSyncedAt, undefined);
});

test("applyCloud does not mark a product synced if it was edited again during the sync", async () => {
  const s = loadSync({ products: [prod("a", { updatedAt: 9 })] });
  await s.applyCloud(
    { acceptedProducts: [{ id: "a", updatedAt: 5 }] },
    [prod("a", { updatedAt: 5 })],
    [],
  );
  assert.equal(s.data().products[0].cloudSyncedAt, undefined);
});

test("applyCloud keeps a removal marker until the server confirms the delete", async () => {
  const tomb = {
    key: "productTombstones",
    value: [
      { id: "x", at: 1 },
      { id: "y", at: 2 },
    ],
  };
  const s = loadSync({ settings: [tomb] });
  await s.applyCloud({ deletedProductIds: ["x"] }, [], tomb.value);
  const left = () =>
    s.data().settings.find((r) => r.key === "productTombstones").value;
  assert.deepEqual(left(), [{ id: "y", at: 2 }]);
  await s.applyCloud({ deletedProductIds: [] }, [], [{ id: "y", at: 2 }]);
  assert.deepEqual(left(), [{ id: "y", at: 2 }]);
});

test("applyCloud applies the cloud catalogue and never overwrites local customers", async () => {
  const s = loadSync({
    customers: [{ id: "c1", name: "Local name", phone: "123" }],
  });
  const out = await s.applyCloud(
    {
      cloudProducts: [prod("p1", { updatedAt: 50 })],
      cloudCustomers: [
        { id: "c1", name: "Cloud" },
        { id: "c2", name: "New" },
      ],
    },
    [],
    [],
  );
  assert.equal(s.data().products.length, 1);
  assert.equal(
    s.data().customers.find((c) => c.id === "c1").name,
    "Local name",
  );
  assert.equal(s.data().customers.find((c) => c.id === "c2").type, "trade");
  assert.match(out.summary, /1 product/);
});

test("applyCloud does not re-add a product the owner just deleted locally", async () => {
  const s = loadSync({
    settings: [{ key: "productTombstones", value: [{ id: "p1", at: 1 }] }],
  });
  await s.applyCloud(
    { cloudProducts: [prod("p1")] },
    [],
    [{ id: "p1", at: 1 }],
  );
  assert.equal(s.data().products.length, 0);
});

test("firestore.rules: verified email, roles, staff stamp and product ownership are enforced", () => {
  const r = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
  assert.match(r, /request\.auth\.token\.email_verified == true/);
  assert.match(r, /function isActiveStaff/);
  assert.match(r, /request\.resource\.data\.staffUid == request\.auth\.uid/);
  assert.match(
    r,
    /match \/products\/\{productId\}[\s\S]*allow create: if isOwner/,
  );
  assert.match(r, /match \/staff\/\{staffId\}[\s\S]*allow delete: if false/);
});
