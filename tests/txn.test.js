const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/txn.js");

const mem = () => {
  const m = new Map();
  return {
    get: async (s, k) => m.get(s + k),
    put: async (s, r) => void m.set(s + r.key, r),
  };
};
const sale = (o = {}) => ({
  id: "s1-abcdefghijklmnopqrstuvwxyz",
  createdAt: Date.UTC(2026, 10, 1, 5),
  paymentMethod: "cash",
  items: [
    { productId: "a", name: "Tea", sku: "T1", unitPrice: 5, quantity: 2 },
  ],
  subtotal: 10,
  total: 10,
  syncStatus: "pending",
  ...o,
});

test("receipt numbers are sequential, unique and persisted", async () => {
  const st = mem();
  const a = await T.nextReceiptNumber(st);
  const b = await T.nextReceiptNumber(st);
  const [c1, c2] = await Promise.all([
    T.nextReceiptNumber(st),
    T.nextReceiptNumber(st),
  ]);
  assert.match(a, /^R-[A-Z0-9]{4}-0001$/);
  assert.ok(b.endsWith("-0002"));
  assert.equal(new Set([a, b, c1, c2]).size, 4);
  assert.equal(a.slice(0, 7), b.slice(0, 7));
});

test("status", () => {
  const s = sale();
  assert.equal(T.status(s, []), "Completed");
  assert.equal(T.status(s, [{ saleId: s.id, total: 4 }]), "Partly refunded");
  assert.equal(T.status(s, [{ saleId: s.id, total: 10 }]), "Fully refunded");
  assert.equal(T.status(s, [{ saleId: "other", total: 10 }]), "Completed");
  assert.equal(T.status(sale({ paymentMethod: "account" }), []), "On account");
  assert.equal(
    T.status(sale({ syncStatus: "rejected" }), []),
    "Not accepted by the cloud",
  );
});

test("filter by text, date, method, amount, status", () => {
  const list = [
    sale({ id: "a", receiptNo: "R-AAAA-0001", createdAt: 1000 }),
    sale({
      id: "b",
      createdAt: 5000,
      paymentMethod: "split",
      total: 30,
      payments: [
        { method: "eftpos", amount: 10, reference: "EF77" },
        { method: "cash", amount: 20 },
      ],
    }),
  ];
  assert.deepEqual(
    T.filter(list, [], { q: "ef77" }).map((s) => s.id),
    ["b"],
  );
  assert.deepEqual(
    T.filter(list, [], { q: "0001" }).map((s) => s.id),
    ["a"],
  );
  assert.deepEqual(T.filter(list, [], { q: "tea" }).length, 2);
  assert.deepEqual(
    T.filter(list, [], { from: 2000 }).map((s) => s.id),
    ["b"],
  );
  assert.deepEqual(
    T.filter(list, [], { to: 2000 }).map((s) => s.id),
    ["a"],
  );
  assert.deepEqual(
    T.filter(list, [], { method: "eftpos" }).map((s) => s.id),
    ["b"],
  );
  assert.deepEqual(
    T.filter(list, [], { min: 20 }).map((s) => s.id),
    ["b"],
  );
  assert.deepEqual(
    T.filter(list, [], { max: 20 }).map((s) => s.id),
    ["a"],
  );
  assert.deepEqual(
    T.filter(list, [{ saleId: "a", total: 10 }], {
      status: "Fully refunded",
    }).map((s) => s.id),
    ["a"],
  );
});

test("CSV export neutralises formulas and quotes commas", () => {
  const csv = T.exportCsv(
    [
      sale({
        invoice: { number: "=HYPERLINK(1)", total: 10, customerName: 'A, "B"' },
      }),
    ],
    [],
  );
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith("'=HYPERLINK(1),"));
  assert.ok(lines[1].includes('"A, ""B"""'));
});

test("integrity check", () => {
  assert.deepEqual(T.checkIntegrity(sale()), []);
  assert.equal(T.checkIntegrity(sale({ total: 9 })).length, 1);
  assert.equal(
    T.checkIntegrity(sale({ discount: { amount: 2 }, total: 8 })).length,
    0,
  );
  assert.equal(
    T.checkIntegrity(sale({ payments: [{ method: "cash", amount: 4 }] }))
      .length,
    1,
  );
  assert.ok(
    T.checkIntegrity(sale({ items: [{ unitPrice: 1, quantity: 0 }] })).length >=
      1,
  );
});

test("integrity check allows the recorded cash rounding and nothing more", () => {
  const ok = sale({
    total: 10.03,
    subtotal: 10.03,
    items: [{ unitPrice: 10.03, quantity: 1 }],
    payments: [{ method: "cash", amount: 10.05 }],
    rounding: 0.02,
  });
  assert.deepEqual(T.checkIntegrity(ok), []);
  assert.equal(T.checkIntegrity({ ...ok, rounding: undefined }).length, 1);
  assert.equal(
    T.checkIntegrity({ ...ok, payments: [{ method: "cash", amount: 10.09 }] })
      .length,
    1,
  );
});

test("timeline lists the sale and its credit notes in order", () => {
  const s = sale();
  const t = T.timeline(s, [
    {
      saleId: s.id,
      number: "CN-1",
      total: 4,
      createdAt: s.createdAt + 10,
      reason: "wrong size",
    },
    { saleId: "x", total: 1, createdAt: 1 },
  ]);
  assert.equal(t.length, 2);
  assert.ok(/Credit note CN-1 for 4.00 — wrong size/.test(t[1].text));
});

test("customer history: count, spend, refunds, newest first, rejected ignored", () => {
  const a = sale({ id: "a", customerId: "c1", total: 10, createdAt: 100 });
  const b = sale({ id: "b", customerId: "c1", total: 5, createdAt: 300 });
  const c = sale({ id: "c", customerId: "c2", total: 99, createdAt: 200 });
  const d = sale({
    id: "d",
    customerId: "c1",
    total: 50,
    createdAt: 400,
    syncStatus: "rejected",
  });
  const h = T.customerHistory(
    [a, b, c, d],
    [
      { saleId: "a", total: 4 },
      { saleId: "c", total: 9 },
    ],
    "c1",
  );
  assert.equal(h.count, 2);
  assert.equal(h.total, 15);
  assert.equal(h.refunded, 4);
  assert.equal(h.net, 11);
  assert.deepEqual(
    h.last.map((s) => s.id),
    ["b", "a"],
  );
  assert.equal(h.firstAt, 100);
  assert.equal(h.lastAt, 300);
  const none = T.customerHistory([a], [], "zzz");
  assert.deepEqual(
    [none.count, none.total, none.lastAt, none.last.length],
    [0, 0, null, 0],
  );
  assert.equal(T.customerHistory([a, b], [], "c1", 1).last.length, 1);
});

test("summary", () => {
  assert.deepEqual(T.summary([sale(), sale({ total: 2.5 })]), {
    count: 2,
    total: 12.5,
  });
});
