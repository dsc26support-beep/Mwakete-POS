const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../js/analytics.js");

// Wednesday 2026-11-25 12:00 local
const NOW = new Date(2026, 10, 25, 12).getTime();
const at = (m, d, h = 10) => new Date(2026, m, d, h).getTime();

test("ranges: today, yesterday, week starts Monday, last week, month, last month", () => {
  const r = (p) => A.range(p, NOW);
  const day = (ms) => A.dayKey(ms);
  assert.equal(day(r("today").from), "2026-11-25");
  assert.equal(day(r("yesterday").from), "2026-11-24");
  assert.equal(day(r("week").from), "2026-11-23"); // Monday
  assert.equal(day(r("lastweek").from), "2026-11-16");
  assert.equal(day(r("lastweek").to), "2026-11-22");
  assert.equal(day(r("month").from), "2026-11-01");
  assert.equal(day(r("lastmonth").from), "2026-10-01");
  assert.equal(day(r("lastmonth").to), "2026-10-31");
});

test("custom range validation", () => {
  assert.ok(
    A.range("custom", NOW, { from: NOW - 1000 * 86400000, to: NOW }).error,
  );
  assert.ok(A.range("custom", NOW, { from: NOW, to: NOW - 86400000 }).error);
  assert.ok(A.range("custom", NOW, {}).error);
  assert.ok(A.range("nope", NOW).error);
  const ok = A.range("custom", NOW, { from: at(10, 1), to: at(10, 3) });
  assert.equal(A.dayKey(ok.to), "2026-11-03");
});

const products = [
  { id: "t", name: "Tea", category: "Drinks", costPrice: 2 },
  { id: "r", name: "Rice", category: "Food" },
];
const sale = (o) => ({
  id: "s" + Math.random(),
  createdAt: at(10, 25),
  paymentMethod: "cash",
  staffUid: "u1",
  items: [{ productId: "t", name: "Tea", unitPrice: 5, quantity: 2 }],
  total: 10,
  ...o,
});

test("totals, breakdowns, refunds net off", () => {
  const sales = [
    sale({}),
    sale({
      items: [{ productId: "r", name: "Rice", unitPrice: 4, quantity: 3 }],
      total: 12,
      createdAt: at(10, 24),
      staffUid: "u2",
    }),
    sale({ syncStatus: "rejected", total: 99 }),
  ];
  const refunds = [{ saleId: sales[0].id, total: 5, createdAt: at(10, 25) }];
  const r = A.build(sales, refunds, products, {
    from: at(10, 24, 0),
    to: at(10, 25, 23),
  });
  assert.equal(r.totals.count, 2);
  assert.equal(r.totals.gross, 22);
  assert.equal(r.totals.refunds, 5);
  assert.equal(r.totals.net, 17);
  assert.equal(r.totals.average, 11);
  assert.deepEqual(
    r.byDay.map((d) => d.day),
    ["2026-11-24", "2026-11-25"],
  );
  assert.deepEqual(
    r.byCategory.map((c) => c.category),
    ["Food", "Drinks"],
  );
  assert.equal(r.byStaff.length, 2);
  assert.equal(r.byEdition[0].edition, "counter");
});

test("period excludes sales outside it", () => {
  const r = A.build(
    [sale({ createdAt: at(9, 1) })],
    [],
    products,
    A.range("week", NOW),
  );
  assert.equal(r.totals.count, 0);
});

test("split payments spread across methods; method filter", () => {
  const s = sale({
    paymentMethod: "split",
    total: 10,
    payments: [
      { method: "eftpos", amount: 4 },
      { method: "cash", amount: 6 },
    ],
  });
  const all = A.build([s, sale({})], [], products, {});
  assert.equal(all.byMethod.find((m) => m.method === "cash").gross, 16);
  assert.equal(all.byMethod.find((m) => m.method === "eftpos").gross, 4);
  assert.equal(
    A.build([s, sale({})], [], products, { method: "eftpos" }).totals.count,
    1,
  );
});

test("category filter keeps only matching sales and their refunds", () => {
  const a = sale({});
  const b = sale({
    items: [{ productId: "r", name: "Rice", unitPrice: 4, quantity: 1 }],
    total: 4,
  });
  const refunds = [
    { saleId: a.id, total: 1, createdAt: a.createdAt },
    { saleId: b.id, total: 2, createdAt: b.createdAt },
  ];
  const r = A.build([a, b], refunds, products, { category: "Food" });
  assert.equal(r.totals.count, 1);
  assert.equal(r.totals.refunds, 2);
  assert.equal(
    A.build([a, b], [], products, { category: "__none__" }).totals.count,
    0,
  );
});

test("profit estimate: costed products only, discount shared out, uncosted listed", () => {
  const s = sale({
    items: [
      { productId: "t", name: "Tea", unitPrice: 5, quantity: 2 },
      { productId: "r", name: "Rice", unitPrice: 4, quantity: 1 },
    ],
    discount: { amount: 1.4 },
    total: 12.6,
  });
  const r = A.build([s], [], products, {});
  // lines 14.00, discount 1.40 -> factor 0.9; tea revenue after discount 9.00, cost 4.00
  assert.equal(r.profit.costedRevenue, 9);
  assert.equal(r.profit.cost, 4);
  assert.equal(r.profit.estimate, 5);
  assert.equal(r.profit.marginPct, 55.6);
  assert.equal(r.profit.uncostedRevenue, 3.6);
  assert.deepEqual(r.profit.uncostedProducts, ["Rice"]);
});

test("pack sales count cost per unit", () => {
  const s = sale({
    items: [
      { productId: "t", name: "Tea", unitPrice: 20, quantity: 1, packUnits: 6 },
    ],
    total: 20,
  });
  const r = A.build([s], [], products, {});
  assert.equal(r.profit.cost, 12);
  assert.equal(r.totals.units, 6);
});

test("edition and staff filters", () => {
  const s1 = sale({ tier: "retail" });
  const s2 = sale({});
  assert.equal(
    A.build([s1, s2], [], products, { tier: "retail" }).totals.count,
    1,
  );
  assert.equal(
    A.build([s1, s2], [], products, { staffUid: "zzz" }).totals.count,
    0,
  );
});

test("CSV has sections and neutralises formulas", () => {
  const s = sale({
    items: [{ productId: "x", name: "=cmd()", unitPrice: 1, quantity: 1 }],
    total: 1,
  });
  const csv = A.toCsv(A.build([s], [], products, {}), "Today");
  assert.ok(csv.includes("By product"));
  assert.ok(csv.includes("'=cmd()"));
  assert.ok(csv.startsWith("Report,Today\r\n"));
});
