const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers/gas.js");

const sale = (over = {}) => ({
  id: "s1",
  createdAt: 1000,
  currency: "AUD",
  paymentMethod: "cash",
  total: 5,
  items: [{ productId: "p", name: "Water", unitPrice: 2.5, quantity: 2 }],
  ...over,
});
const sync = (transactions, extra = {}) => ({
  type: "pos_sync",
  schemaVersion: 2,
  transactions,
  ...extra,
});
const SALES_COLS = 12;

test("a plain Counter sale (no new fields) is accepted exactly as before", () => {
  const { post, rows } = load();
  const r = post(sync([sale()]));
  assert.deepEqual(r.acceptedIds, ["s1"]);
  assert.deepEqual(r.rejected, []);
  assert.equal(r.ok, true);
  assert.equal(rows("Sales").length, 2);
  assert.equal(rows("Sales")[1][3], 5);
  assert.equal(rows("Sales")[1][6], 0);
  assert.equal(rows("Sales")[1][8], "counter");
  assert.deepEqual(
    [rows("Sales")[1][9], rows("Sales")[1][10], rows("Sales")[1][11]],
    [0, "", ""],
  );
  assert.equal(
    rows("Invoices"),
    null,
    "no ledger sheets are created for non-invoice sales",
  );
});

test("an old v1 request (schemaVersion 1, no payments/customers) still works", () => {
  const { post } = load();
  assert.deepEqual(
    post({ type: "pos_sync", schemaVersion: 1, transactions: [sale()] })
      .acceptedIds,
    ["s1"],
  );
});

test("a Retail sale with a discount is accepted and its columns are stored", () => {
  const { post, rows } = load();
  const r = post(
    sync([
      sale({
        id: "r1",
        total: 4.5,
        subtotal: 5,
        discount: { type: "percent", value: 10, amount: 0.5 },
        customerId: "c-1",
        tier: "retail",
      }),
    ]),
  );
  assert.deepEqual(r.acceptedIds, ["r1"]);
  assert.deepEqual(rows("Sales")[1].slice(6, 9), [0.5, "c-1", "retail"]);
});

test("a Wholesale pack sale (no invoice) is validated by arithmetic and stored with its tier", () => {
  const { post, rows } = load();
  const items = [
    { productId: "p", name: "Rice", unitPrice: 8.5, quantity: 1 },
    {
      productId: "p",
      name: "Rice (Carton x24)",
      unitPrice: 204,
      quantity: 2,
      packId: "pack1",
      packUnits: 24,
    },
  ];
  assert.deepEqual(
    post(
      sync([
        sale({
          id: "w1",
          total: 416.5,
          tier: "wholesale",
          priceListId: "trade",
          customerId: "c-9",
          items,
        }),
      ]),
    ).acceptedIds,
    ["w1"],
  );
  assert.equal(rows("Sales")[1][8], "wholesale");
  const bad = post(
    sync([sale({ id: "w2", total: 416, tier: "wholesale", items })]),
  );
  assert.deepEqual(bad.acceptedIds, []);
  assert.match(bad.rejected[0].reason, /does not match/);
});

test("floating-point sums are tolerated (0.1 x 3)", () => {
  const { post } = load();
  assert.deepEqual(
    post(
      sync([
        sale({
          id: "f1",
          total: 0.30000000000000004,
          items: [{ unitPrice: 0.1, quantity: 3 }],
        }),
      ]),
    ).acceptedIds,
    ["f1"],
  );
});

test("a total that does not match the items and discount is REJECTED and nothing is stored", () => {
  for (const bad of [
    sale({ total: 4 }),
    sale({ total: 6 }),
    sale({ total: 5, discount: { amount: 0.5 } }),
    sale({ total: 4.5, discount: { amount: 0.4 } }),
  ]) {
    const { post, rows } = load();
    const r = post(sync([bad]));
    assert.equal(r.ok, true);
    assert.deepEqual(r.acceptedIds, []);
    assert.deepEqual(
      r.rejected.map((x) => [x.id, x.kind]),
      [["s1", "sale"]],
    );
    assert.match(r.rejected[0].reason, /does not match/);
    assert.equal(rows("Sales").length, 1, "only the header may exist");
  }
});

test("excessive, negative or malformed discounts are rejected", () => {
  for (const discount of [{ amount: 6 }, { amount: -1 }, { amount: "abc" }]) {
    const { post } = load();
    const r = post(sync([sale({ total: 0, discount })]));
    assert.deepEqual(r.acceptedIds, []);
    assert.equal(r.rejected.length, 1);
  }
});

test("malformed transactions and line items are rejected per record", () => {
  for (const bad of [
    null,
    sale({ id: "" }),
    sale({ id: 5 }),
    sale({ items: [] }),
    sale({ items: "x" }),
    sale({ items: [{ unitPrice: 1, quantity: 0 }] }),
    sale({ items: [{ unitPrice: 1, quantity: 1.5 }] }),
    sale({ items: [{ unitPrice: -1, quantity: 1 }] }),
    sale({ total: "abc" }),
    sale({ total: NaN }),
  ]) {
    const { post } = load();
    const r = post(sync([bad]));
    assert.equal(r.ok, true, JSON.stringify(bad));
    assert.deepEqual(r.acceptedIds, [], JSON.stringify(bad));
    assert.equal(r.rejected.length, 1, JSON.stringify(bad));
  }
});

test("ONE BAD RECORD DOES NOT BLOCK THE OTHERS (previously it failed the whole batch)", () => {
  const { post, rows } = load();
  const r = post(
    sync([
      sale({ id: "good1" }),
      sale({ id: "bad", total: 99 }),
      sale({ id: "good2" }),
    ]),
  );
  assert.deepEqual(r.acceptedIds, ["good1", "good2"]);
  assert.deepEqual(
    r.rejected.map((x) => x.id),
    ["bad"],
  );
  assert.equal(rows("Sales").length, 3);
});

test("tax is only allowed on invoices (a Retail sale cannot smuggle tax in)", () => {
  const { post } = load();
  const r = post(sync([sale({ total: 5.5, tax: 0.5 })]));
  assert.deepEqual(r.acceptedIds, []);
  assert.match(r.rejected[0].reason, /Tax is only allowed on invoices/);
  assert.deepEqual(post(sync([sale({ id: "z", tax: 0 })])).acceptedIds, ["z"]);
});

test("re-sending the same sale is idempotent: confirmed again, stored once", () => {
  const { post, rows } = load();
  assert.deepEqual(post(sync([sale()])).acceptedIds, ["s1"]);
  assert.deepEqual(post(sync([sale()])).acceptedIds, ["s1"]);
  assert.equal(rows("Sales").length, 2);
});

test("an existing sheet with an old header is upgraded without losing rows", () => {
  const old6 = [
    [
      "Transaction ID",
      "Created At",
      "Currency",
      "Total",
      "Payment Method",
      "Items JSON",
    ],
    ["old1", 1, "AUD", 5, "cash", "[]"],
  ];
  const a = load({ sheets: { Sales: old6 } });
  assert.equal(a.post(sync([sale({ id: "new1" })])).ok, true);
  assert.equal(a.rows("Sales").length, 3);
  assert.equal(a.rows("Sales")[0].length, SALES_COLS);
  assert.equal(a.rows("Sales")[1][0], "old1");
  const old9 = [
    [
      "Transaction ID",
      "Created At",
      "Currency",
      "Total",
      "Payment Method",
      "Items JSON",
      "Discount",
      "Customer ID",
      "Tier",
    ],
    ["old2", 1, "AUD", 5, "cash", "[]", 0, "", "retail"],
  ];
  const b = load({ sheets: { Sales: old9 } });
  assert.deepEqual(b.post(sync([sale({ id: "new2" })])).acceptedIds, ["new2"]);
  assert.equal(b.rows("Sales")[0].length, SALES_COLS);
  assert.equal(b.rows("Sales")[1][8], "retail");
});

test("whole-request problems still fail the request: bad type, bad JSON, oversize batch or body", () => {
  const { post } = load();
  assert.equal(post({ type: "other" }).ok, false);
  assert.equal(post("not json").ok, false);
  assert.equal(
    post(sync(Array.from({ length: 101 }, (_, i) => sale({ id: "x" + i })))).ok,
    false,
  );
  assert.equal(post(sync("nope")).ok, false);
  assert.equal(
    post(sync([], { payments: Array.from({ length: 101 }, () => ({})) })).ok,
    false,
  );
  assert.equal(post("x".repeat(1000001)).ok, false);
});

test("doGet reports the schema version and whether the ledger is enabled", () => {
  assert.deepEqual(
    [load().get().schemaVersion, load().get().ledgerEnabled],
    [2, false],
  );
  assert.equal(
    load({ props: { LEDGER_ENABLED: "true" } }).get().ledgerEnabled,
    true,
  );
  assert.equal(
    load({ props: { LEDGER_ENABLED: "yes" } }).get().ledgerEnabled,
    false,
    "only the exact string true enables it",
  );
});
