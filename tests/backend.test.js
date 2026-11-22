const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Loads the real Apps Script file with minimal stubs for Google services.
function load(existingRows) {
  const rows = existingRows ? existingRows.map((r) => [...r]) : [];
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => (rows[0] ? rows[0].length : 0),
    appendRow: (r) => rows.push(r),
    getRange: (row, col, nr, nc) => ({
      getValues: () =>
        rows
          .slice(row - 1, row - 1 + nr)
          .map((r) => r.slice(col - 1, col - 1 + nc)),
      setValues: (v) => {
        rows[0] = v[0];
      },
    }),
  };
  let created = existingRows ? sheet : null;
  const ctx = {
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: () => created,
        insertSheet: () => (created = sheet),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      createTextOutput: (s) => ({
        s,
        setMimeType() {
          return this;
        },
      }),
      MimeType: { JSON: "json" },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../google-apps-script/Code.gs"),
      "utf8",
    ),
    ctx,
  );
  const post = (payload) =>
    JSON.parse(
      ctx.doPost({ postData: { contents: JSON.stringify(payload) } }).s,
    );
  return { ctx, rows, post };
}
const sale = (over = {}) => ({
  id: "s1",
  createdAt: 1000,
  currency: "AUD",
  paymentMethod: "cash",
  total: 5,
  items: [{ productId: "p", name: "Water", unitPrice: 2.5, quantity: 2 }],
  ...over,
});
const sync = (transactions) => ({
  type: "pos_sync",
  schemaVersion: 1,
  transactions,
});

test("a plain Counter sale (no new fields) is accepted exactly as before", () => {
  const { post, rows } = load();
  const r = post(sync([sale()]));
  assert.deepEqual(r, { ok: true, acceptedIds: ["s1"] });
  assert.equal(rows.length, 2);
  assert.equal(rows[1][3], 5);
  assert.equal(rows[1][6], 0);
  assert.equal(rows[1][8], "counter");
});

test("a Retail sale with a discount is accepted and its new columns are stored", () => {
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
  assert.deepEqual(Array.from(rows[1].slice(6)), [0.5, "c-1", "retail"]);
});

test("floating-point sums are tolerated (0.1 x 3)", () => {
  const { post } = load();
  const r = post(
    sync([
      sale({
        id: "f1",
        total: 0.30000000000000004,
        items: [{ unitPrice: 0.1, quantity: 3 }],
      }),
    ]),
  );
  assert.equal(r.ok, true);
});

test("a total that does not match the items and discount is rejected", () => {
  for (const bad of [
    sale({ total: 4 }), // understated
    sale({ total: 6 }), // overstated
    sale({ total: 5, discount: { amount: 0.5 } }), // discount not applied
    sale({ total: 4.5, discount: { amount: 0.4 } }), // discount mismatch
  ]) {
    const { post, rows } = load();
    const r = post(sync([bad]));
    assert.equal(r.ok, false);
    assert.match(r.error, /does not match/);
    assert.equal(rows.length, 1, "nothing but the header may be stored");
  }
});

test("excessive, negative or malformed discounts are rejected", () => {
  for (const discount of [{ amount: 6 }, { amount: -1 }, { amount: "abc" }]) {
    const { post } = load();
    assert.equal(post(sync([sale({ total: 0, discount })])).ok, false);
  }
});

test("malformed transactions and line items are rejected", () => {
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
    assert.equal(post(sync([bad])).ok, false, JSON.stringify(bad));
  }
});

test("re-sending the same sale is idempotent: confirmed again, stored once", () => {
  const { post, rows } = load();
  assert.deepEqual(post(sync([sale()])).acceptedIds, ["s1"]);
  assert.deepEqual(post(sync([sale()])).acceptedIds, ["s1"]);
  assert.equal(rows.length, 2);
});

test("an existing sheet with the old 6-column header is upgraded without losing rows", () => {
  const old = [
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
  const { post, rows } = load(old);
  assert.equal(post(sync([sale({ id: "new1" })])).ok, true);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].length, 9);
  assert.equal(rows[1][0], "old1");
});

test("unsupported request types are rejected", () => {
  const { post } = load();
  assert.equal(post({ type: "other" }).ok, false);
});
