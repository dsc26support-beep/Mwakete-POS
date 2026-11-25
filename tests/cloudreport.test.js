const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/cloudreport.js");

const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 20, 10, 0, 0); // 20 Nov 2026 10:00 UTC
const sale = (id, at, total, by, over = {}) => ({
  id,
  createdAt: at,
  total,
  staffUid: by,
  paymentMethod: "cash",
  items: [{ productId: "p1", name: "Tea", unitPrice: total, quantity: 1 }],
  ...over,
});
const refund = (id, at, total, by) => ({
  id,
  createdAt: at,
  total,
  staffUid: by,
  method: "cash",
});
const staff = [{ uid: "c1", name: "Tina" }];
const opts = { ownerUid: "o1", from: T0 - DAY, to: T0 + 5 * DAY };

test("totals add up exactly: sales, refunds, net, tax, average", () => {
  const r = R.summarize(
    [
      sale("a", T0, 0.1, "o1"),
      sale("b", T0, 0.2, "c1"),
      sale("c", T0 + DAY, 112.5, "c1", { tax: 12.5, paymentMethod: "account" }),
    ],
    [refund("r", T0 + 1000, 0.05, "o1")],
    staff,
    opts,
  );
  assert.deepEqual(
    [
      r.totals.sales,
      r.totals.gross,
      r.totals.tax,
      r.totals.refunds,
      r.totals.refundTotal,
      r.totals.net,
    ],
    [3, 112.8, 12.5, 1, 0.05, 112.75],
  );
  assert.equal(r.totals.average, 37.6);
});

test("by staff: owner and cashiers, with refunds counted against who recorded them", () => {
  const r = R.summarize(
    [sale("a", T0, 10, "o1"), sale("b", T0, 30, "c1"), sale("c", T0, 5, "c1")],
    [refund("r", T0, 7, "c1")],
    staff,
    opts,
  );
  assert.deepEqual(
    r.byStaff.map((s) => [
      s.name,
      s.sales,
      s.gross,
      s.refunds,
      s.refundTotal,
      s.net,
    ]),
    [
      ["Tina", 2, 35, 1, 7, 28],
      ["Owner", 1, 10, 0, 0, 10],
    ],
  );
});

test("a person who is no longer staff is still counted, under a neutral label", () => {
  const r = R.summarize([sale("a", T0, 4, "gone")], [], staff, opts);
  assert.equal(r.byStaff[0].name, "Former or unknown staff");
  assert.equal(r.totals.gross, 4);
});

test("only records inside the period are counted", () => {
  const r = R.summarize(
    [
      sale("old", T0 - 2 * DAY, 100, "o1"),
      sale("in", T0, 10, "o1"),
      sale("late", T0 + 9 * DAY, 100, "o1"),
    ],
    [refund("old", T0 - 3 * DAY, 50, "o1")],
    staff,
    opts,
  );
  assert.deepEqual(
    [r.totals.sales, r.totals.gross, r.totals.refunds],
    [1, 10, 0],
  );
  assert.equal(
    R.summarize([sale("x", 5, 1, "o1")], [], [], {}).totals.sales,
    1,
    "no period given: everything counts",
  );
  assert.equal(
    R.summarize([{ id: "bad", total: 5 }], [], [], {}).totals.sales,
    0,
    "a record with no date is left out",
  );
});

test("by day uses the person's own time zone, newest day first", () => {
  const lateNight = Date.UTC(2026, 10, 20, 23, 30); // 23:30 UTC = 11:30 next day at UTC+12 (Kiribati)
  const utc = R.summarize([sale("a", lateNight, 10, "o1")], [], [], {
    from: 0,
    offsetMin: 0,
  });
  const kiribati = R.summarize([sale("a", lateNight, 10, "o1")], [], [], {
    from: 0,
    offsetMin: 12 * 60,
  });
  assert.equal(utc.byDay[0].day, "2026-11-20");
  assert.equal(kiribati.byDay[0].day, "2026-11-21");
  const two = R.summarize(
    [sale("a", T0, 1, "o1"), sale("b", T0 + DAY, 2, "o1")],
    [refund("r", T0 + DAY, 1, "o1")],
    [],
    { from: 0 },
  );
  assert.deepEqual(
    two.byDay.map((d) => [d.day, d.sales, d.gross, d.refundTotal, d.net]),
    [
      ["2026-11-21", 1, 2, 1, 1],
      ["2026-11-20", 1, 1, 0, 1],
    ],
  );
});

test("period starts: today, last 7 days, in the person's own time zone", () => {
  const now = Date.UTC(2026, 10, 20, 23, 30);
  assert.equal(R.periodStart(now, 1, 0), Date.UTC(2026, 10, 20));
  assert.equal(R.periodStart(now, 7, 0), Date.UTC(2026, 10, 14));
  assert.equal(
    R.periodStart(now, 1, 12 * 60),
    Date.UTC(2026, 10, 20, 12) - 0,
    "midnight at UTC+12 is 12:00 UTC the day before... in local terms, the 21st starts at 12:00 UTC on the 20th",
  );
});

test("by payment method and top products", () => {
  const r = R.summarize(
    [
      sale("a", T0, 10, "o1", {
        items: [{ productId: "p1", name: "Tea", unitPrice: 2, quantity: 5 }],
      }),
      sale("b", T0, 6, "o1", {
        paymentMethod: "other",
        items: [
          { productId: "p1", name: "Tea", unitPrice: 2, quantity: 1 },
          { productId: "p2", name: "Jam", unitPrice: 4, quantity: 1 },
        ],
      }),
    ],
    [],
    [],
    opts,
  );
  assert.deepEqual(
    r.byMethod.map((m) => [m.method, m.sales, m.gross]),
    [
      ["cash", 1, 10],
      ["other", 1, 6],
    ],
  );
  assert.deepEqual(
    r.topProducts.map((p) => [p.name, p.quantity, p.revenue]),
    [
      ["Tea", 6, 12],
      ["Jam", 1, 4],
    ],
  );
});

test("an empty period gives zeros, not errors", () => {
  const r = R.summarize([], [], [], opts);
  assert.deepEqual(
    [
      r.totals.sales,
      r.totals.gross,
      r.totals.net,
      r.totals.average,
      r.byStaff.length,
      r.byDay.length,
    ],
    [0, 0, 0, 0, 0, 0],
  );
  const n = R.summarize(null, undefined, null, opts);
  assert.equal(n.totals.sales, 0);
});
