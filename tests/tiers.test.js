const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/tiers.js");

function fakeStore(seed = {}) {
  const stores = { settings: new Map(), products: new Map(), sales: new Map() };
  for (const [s, rows] of Object.entries(seed))
    for (const r of rows) stores[s].set(r.key ?? r.id, structuredClone(r));
  return {
    stores,
    async get(s, k) {
      return stores[s].get(k);
    },
    async put(s, v) {
      stores[s].set(v.key ?? v.id, structuredClone(v));
      return v;
    },
    async all(s) {
      return [...stores[s].values()];
    },
  };
}

test("an install with no tier saved is Counter (existing users unchanged)", async () => {
  assert.equal(await T.getTier(fakeStore()), "counter");
});

test("unknown and empty tiers all fall back to Counter", async () => {
  for (const bad of ["", "admin", null, undefined, "__proto__", "Wholesale "]) {
    const s = fakeStore({ settings: [{ key: "tier", value: bad }] });
    assert.equal(await T.getTier(s), "counter", String(bad));
  }
  assert.equal(T.normalize("constructor"), "counter");
});

test("Counter has no Retail features; Retail has all of them", () => {
  for (const f of [
    "barcode",
    "discounts",
    "receipts",
    "customers",
    "categories",
    "reports",
    "lowStock",
    "refunds",
    "register",
    "stock",
  ]) {
    assert.equal(T.has("counter", f), false, f);
    assert.equal(T.has("retail", f), true, f);
  }
  assert.equal(T.has("retail", "invoices"), false);
  assert.equal(T.has("nonsense", "reports"), false);
});

test("Wholesale includes every Retail feature plus only the features shipped so far (PR 1-2)", () => {
  assert.equal(T.TIERS.wholesale.available, true);
  assert.ok(
    T.TIERS.retail.features.every((f) =>
      T.TIERS.wholesale.features.includes(f),
    ),
  );
  for (const f of [
    "priceTiers",
    "bulkUnits",
    "tradeCustomers",
    "tax",
    "invoices",
    "purchaseOrders",
  ]) {
    assert.equal(T.has("wholesale", f), true, f);
    assert.equal(T.has("retail", f), false, f);
    assert.equal(T.has("counter", f), false, f);
  }
  // Later Wholesale PRs: still off, so nothing half-built is visible.
  for (const f of ["quotes"]) assert.equal(T.has("wholesale", f), false, f);
  assert.equal(T.canChange("counter", "wholesale").ok, true);
});

test("switching from Wholesale to Retail warns that Wholesale screens are hidden and data is kept", () => {
  assert.match(T.changeWarning("wholesale", "retail"), /data is kept/i);
  assert.equal(T.changeWarning("retail", "wholesale"), "");
});

test("setTier saves Retail and Wholesale and rejects unknown tiers without changing anything", async () => {
  const s = fakeStore();
  const r = await T.setTier(s, "retail");
  assert.equal(r.ok, true);
  assert.equal(await T.getTier(s), "retail");
  assert.equal((await T.setTier(s, "wholesale")).ok, true);
  assert.equal(await T.getTier(s), "wholesale");
  await T.setTier(s, "retail");
  for (const bad of ["root", "", "Wholesale "]) {
    assert.equal((await T.setTier(s, bad)).ok, false);
    assert.equal(await T.getTier(s), "retail");
  }
});

test("downgrading warns that screens are hidden but data is kept; upgrading does not warn", async () => {
  assert.match(T.changeWarning("retail", "counter"), /data is kept/i);
  assert.equal(T.changeWarning("counter", "retail"), "");
  assert.equal(T.canChange("retail", "counter").ok, true);
});

test("changing tier never touches products, sales or other settings", async () => {
  const s = fakeStore({
    products: [{ id: "p1", name: "Water", price: 1, stock: 5 }],
    sales: [{ id: "s1", total: 1, syncStatus: "pending" }],
    settings: [{ key: "businessName", value: "Shop" }],
  });
  await T.setTier(s, "retail");
  await T.setTier(s, "counter");
  assert.deepEqual(s.stores.products.get("p1"), {
    id: "p1",
    name: "Water",
    price: 1,
    stock: 5,
  });
  assert.deepEqual(s.stores.sales.get("s1"), {
    id: "s1",
    total: 1,
    syncStatus: "pending",
  });
  assert.equal(s.stores.settings.get("businessName").value, "Shop");
});
