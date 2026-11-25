const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../js/backup.js");

const data = () => ({
  products: [{ id: "p1", name: "Tea", price: 2.5, stock: 4 }],
  sales: [
    {
      id: "s1",
      createdAt: 5,
      total: 5,
      items: [{ name: "Tea" }],
      syncStatus: "pending",
    },
  ],
  customers: [{ id: "c1", name: "Trade Co", phone: "123" }],
  payments: [{ id: "pay1", customerId: "c1", amount: 5, createdAt: 6 }],
  refunds: [{ id: "r1", saleId: "s1", total: 1, createdAt: 7 }],
  settings: [
    { key: "businessName", value: "Corner Shop" },
    { key: "deviceCode", value: "AB12" },
    { key: "invoiceSeq", value: 9 },
    { key: "cloudBusiness", value: { uid: "u", businessId: "b" } },
    { key: "cartDraft", value: [] },
    { key: "registerOpen", value: { id: "x" } },
    { key: "errorLog", value: [] },
  ],
});

test("a backup holds every record kind and leaves out device-specific settings", () => {
  const b = B.build(data(), 1234);
  assert.deepEqual([b.app, b.format, b.exportedAt], ["mwakete-pos", 1, 1234]);
  assert.deepEqual(b.counts, {
    products: 1,
    sales: 1,
    customers: 1,
    priceLists: 0,
    payments: 1,
    refunds: 1,
    registers: 0,
    stockMoves: 0,
    suppliers: 0,
    purchaseOrders: 0,
    quotes: 0,
    settings: 1,
  });
  assert.deepEqual(
    b.stores.settings.map((s) => s.key),
    ["businessName"],
  );
});

test("a backup survives being written to a file and read back unchanged", () => {
  const original = data();
  const r = B.parse(JSON.stringify(B.build(original)));
  assert.equal(r.ok, true);
  assert.deepEqual(r.stores.products, original.products);
  assert.deepEqual(r.stores.sales, original.sales);
  assert.deepEqual(r.stores.customers, original.customers);
  assert.deepEqual(r.stores.settings, [
    { key: "businessName", value: "Corner Shop" },
  ]);
  assert.deepEqual(r.skipped, []);
  assert.match(
    B.summary(r.counts),
    /1 products, 1 sales, 1 customers, 1 payments, 1 credit notes, 1 settings/,
  );
});

test("device-specific settings are never restored, even if a file contains them", () => {
  const doc = {
    app: "mwakete-pos",
    format: 1,
    exportedAt: 1,
    stores: {
      settings: [
        { key: "deviceCode", value: "ZZZZ" },
        { key: "invoiceSeq", value: 1 },
        { key: "cloudBusiness", value: {} },
        { key: "taxRate", value: 12.5 },
      ],
    },
  };
  const r = B.parse(JSON.stringify(doc));
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.stores.settings.map((s) => s.key),
    ["taxRate"],
  );
});

test("files that are not a backup of this app are refused with a plain message", () => {
  assert.match(B.parse("").error, /empty/);
  assert.match(B.parse("{not json").error, /could not be read/);
  assert.match(B.parse("[1,2]").error, /not a Mwakete POS backup/);
  assert.match(
    B.parse('{"app":"other","format":1,"stores":{}}').error,
    /not a Mwakete POS backup/,
  );
  assert.match(
    B.parse('{"app":"mwakete-pos","format":2,"stores":{}}').error,
    /different version/,
  );
  assert.match(B.parse('{"app":"mwakete-pos","format":1}').error, /no data/);
  assert.match(
    B.parse('{"app":"mwakete-pos","format":1,"stores":{"products":[]}}').error,
    /no records/,
  );
  assert.match(B.parse("x".repeat(60_000_001)).error, /too big/);
  assert.equal(
    B.parse("﻿" + JSON.stringify(B.build(data()))).ok,
    true,
    "a BOM is fine",
  );
});

test("bad records are skipped and listed; good ones in the same file are kept", () => {
  const doc = {
    app: "mwakete-pos",
    format: 1,
    stores: {
      products: [
        { id: "ok", name: "Tea", price: 1 },
        { id: "bad1", name: "x", price: "free" },
        { id: "bad2", name: "x", price: -1 },
        { name: "no id", price: 1 },
        "junk",
        null,
        [],
        { id: "bad3", name: "x", price: 1, stock: "many" },
      ],
      sales: [
        { id: "s", createdAt: 1, total: 1, items: [] },
        { id: "s2", createdAt: "yesterday", total: 1, items: [] },
        { id: "s3", createdAt: 1, total: NaN, items: [] },
      ],
    },
  };
  const r = B.parse(JSON.stringify(doc));
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.stores.products.map((p) => p.id),
    ["ok"],
  );
  assert.deepEqual(
    r.stores.sales.map((p) => p.id),
    ["s"],
  );
  assert.equal(r.skipped.length, 9);
  assert.ok(
    r.skipped.some(
      (s) =>
        s.store === "products" &&
        s.key === "bad1" &&
        /valid product/.test(s.reason),
    ),
  );
  assert.ok(r.skipped.some((s) => /no valid id/.test(s.reason)));
});

test("a key that is too long, or a __proto__ field, is refused", () => {
  const doc =
    '{"app":"mwakete-pos","format":1,"stores":{"customers":[{"id":"' +
    "k".repeat(201) +
    '","name":"x"},{"id":"c","name":"y","__proto__":{"admin":true}},{"id":"ok","name":"z"}]}}';
  const r = B.parse(doc);
  assert.deepEqual(
    r.stores.customers.map((c) => c.id),
    ["ok"],
  );
  assert.equal(r.skipped.length, 2);
});

test("unknown record kinds are ignored, not written", () => {
  const doc = {
    app: "mwakete-pos",
    format: 1,
    stores: {
      products: [{ id: "p", name: "T", price: 1 }],
      passwords: [{ id: "x" }],
      __proto__: [],
    },
  };
  const r = B.parse(JSON.stringify(doc));
  assert.deepEqual(Object.keys(r.stores), ["products"]);
  assert.deepEqual(r.ignoredStores, ["passwords"]);
});

test("the list of skipped records is capped so a huge bad file cannot flood the screen", () => {
  const bad = Array.from({ length: 500 }, (_, i) => ({
    id: "p" + i,
    name: "x",
    price: "bad",
  }));
  const r = B.parse(
    JSON.stringify({
      app: "mwakete-pos",
      format: 1,
      stores: { products: [...bad, { id: "ok", name: "T", price: 1 }] },
    }),
  );
  assert.equal(r.skipped.length, 20);
  assert.equal(r.skipped.skipped, 480);
  assert.equal(r.stores.products.length, 1);
});
