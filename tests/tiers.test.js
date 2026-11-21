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

test("unknown, empty and unavailable tiers all fall back to Counter", async () => {
  for (const bad of ["", "admin", null, undefined, "__proto__", "wholesale"]) {
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
  ]) {
    assert.equal(T.has("counter", f), false, f);
    assert.equal(T.has("retail", f), true, f);
  }
  assert.equal(T.has("retail", "invoices"), false);
  assert.equal(T.has("nonsense", "reports"), false);
});

test("Wholesale is declared but not selectable yet, and includes Retail features", () => {
  assert.equal(T.TIERS.wholesale.available, false);
  assert.ok(
    T.TIERS.retail.features.every((f) =>
      T.TIERS.wholesale.features.includes(f),
    ),
  );
  assert.equal(T.canChange("counter", "wholesale").ok, false);
});

test("setTier saves Retail and rejects unknown / unavailable tiers without changing anything", async () => {
  const s = fakeStore();
  const r = await T.setTier(s, "retail");
  assert.equal(r.ok, true);
  assert.equal(await T.getTier(s), "retail");
  for (const bad of ["wholesale", "root", ""]) {
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
