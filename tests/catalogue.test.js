const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../js/catalogue.js");

const P = (over = {}) => ({
  id: "p1",
  name: "Tea",
  price: 10,
  stock: 5,
  sku: "T",
  updatedAt: 1,
  ...over,
});

test("cleanFields validates and trims", () => {
  const r = K.cleanFields({
    name: "  Tea\n",
    price: "12.345",
    costPrice: "7",
    unit: "kg",
    description: "x".repeat(400),
  });
  assert.equal(r.ok, true);
  assert.equal(r.fields.name, "Tea");
  assert.equal(r.fields.price, 12.35);
  assert.equal(r.fields.costPrice, 7);
  assert.equal(r.fields.description.length, 300);
  assert.equal(K.cleanFields({ name: "  " }).ok, false);
  assert.equal(K.cleanFields({ price: "" }).ok, false);
  assert.equal(K.cleanFields({ price: -1 }).ok, false);
  assert.equal(K.cleanFields({ costPrice: "abc" }).ok, false);
  assert.equal(K.cleanFields({ unit: "bucket" }).ok, false);
  assert.equal(K.cleanFields({ reorderLevel: "2.5" }).ok, false);
  assert.equal(K.cleanFields({ reorderLevel: "" }).ok, true);
});

test("applyEdit records price history, clears empty fields, stamps updatedAt", () => {
  const a = K.applyEdit(
    P({ description: "old", costPrice: 3 }),
    {
      price: 12,
      description: "",
      costPrice: "",
    },
    { now: 50 },
  );
  assert.equal(a.ok, true);
  assert.equal(a.product.price, 12);
  assert.equal("description" in a.product, false);
  assert.equal("costPrice" in a.product, false);
  assert.equal(a.product.updatedAt, 50);
  assert.deepEqual(a.product.priceHistory, [{ at: 50, from: 10, to: 12 }]);
  // unchanged price adds nothing
  const b = K.applyEdit(P(), { price: 10 }, { now: 60 });
  assert.equal(b.product.priceHistory, undefined);
  // original not mutated
  assert.equal(P().price, 10);
});

test("price history is capped", () => {
  let p = P();
  for (let i = 1; i <= 30; i++)
    p = K.applyEdit(p, { price: 10 + i }, { now: i }).product;
  assert.equal(p.priceHistory.length, K.MAX_HISTORY);
  assert.equal(p.priceHistory.at(-1).to, 40);
});

test("availability", () => {
  assert.equal(K.availability(P()), "available");
  assert.equal(K.availability(P({ stock: 0 })), "out");
  assert.equal(K.availability(P({ stock: 2, reorderLevel: 3 })), "low");
  assert.equal(K.availability(P({ archived: true })), "archived");
});

test("valuation uses cost only where known", () => {
  const v = K.valuation([
    P({ stock: 10, price: 5, costPrice: 2 }),
    P({ id: "b", stock: 4, price: 3 }),
    P({ id: "c", stock: 9, price: 1, costPrice: 1, archived: true }),
  ]);
  assert.equal(v.costValue, 20);
  assert.equal(v.retailValue, 62);
  assert.equal(v.units, 14);
  assert.equal(v.missingCost, 1);
  assert.equal(v.costedProducts, 1);
});

test("filter by search, category, availability, archive", () => {
  const list = [
    P({ id: "1", name: "Tea", category: "Drinks" }),
    P({ id: "2", name: "Rice", category: "Food", stock: 0 }),
    P({ id: "3", name: "Old", archived: true }),
    P({ id: "4", name: "Biscuit", description: "sweet tea biscuit" }),
  ];
  assert.deepEqual(
    K.filter(list).map((p) => p.id),
    ["1", "2", "4"],
  );
  assert.deepEqual(
    K.filter(list, { q: "tea" }).map((p) => p.id),
    ["1", "4"],
  );
  assert.deepEqual(
    K.filter(list, { category: "Food" }).map((p) => p.id),
    ["2"],
  );
  assert.deepEqual(
    K.filter(list, { category: "__none__" }).map((p) => p.id),
    ["4"],
  );
  assert.deepEqual(
    K.filter(list, { availability: "out" }).map((p) => p.id),
    ["2"],
  );
  assert.deepEqual(
    K.filter(list, { availability: "archived" }).map((p) => p.id),
    ["3"],
  );
  assert.equal(K.filter(list, { includeArchived: true }).length, 4);
  assert.deepEqual(K.categories(list), ["Drinks", "Food"]);
});

test("bulk edits", () => {
  const list = [
    P({ id: "1", price: 10 }),
    P({ id: "2", price: 3.33 }),
    P({ id: "3" }),
  ];
  const r = K.bulk(
    list,
    ["1", "2"],
    { type: "percent", value: 10 },
    { now: 9 },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.changed.map((p) => p.price),
    [11, 3.66],
  );
  assert.equal(r.changed[0].priceHistory[0].note, "bulk 10%");
  assert.equal(K.bulk(list, [], { type: "archive" }).ok, false);
  assert.equal(K.bulk(list, ["1"], { type: "percent", value: 0 }).ok, false);
  assert.equal(K.bulk(list, ["1"], { type: "percent", value: -95 }).ok, false);
  assert.equal(K.bulk(list, ["1"], { type: "bogus" }).ok, false);
  const a = K.bulk(list, ["3"], { type: "archive" });
  assert.equal(a.changed[0].archived, true);
  const back = K.bulk(a.changed, ["3"], { type: "restore" });
  assert.equal("archived" in back.changed[0], false);
  assert.equal(
    K.bulk(list, ["1"], { type: "unit", value: "kg" }).changed[0].unit,
    "kg",
  );
});

test("thumbnail sizing and image validation", () => {
  assert.deepEqual(K.thumbSize(400, 200), { w: 96, h: 48 });
  assert.deepEqual(K.thumbSize(50, 40), { w: 50, h: 40 });
  assert.equal(K.validImage("data:image/jpeg;base64,AAAA"), true);
  assert.equal(K.validImage("data:text/html;base64,AAAA"), false);
  assert.equal(K.validImage("javascript:alert(1)"), false);
  assert.equal(
    K.validImage("data:image/png;base64," + "A".repeat(30000)),
    false,
  );
});
