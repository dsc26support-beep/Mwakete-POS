const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/checkout.js");

test("changeDue: exact, over, short, invalid", () => {
  assert.deepEqual(C.changeDue(12.5, 20), {
    ok: true,
    change: 7.5,
    tendered: 20,
  });
  assert.equal(C.changeDue(10, 10).change, 0);
  const s = C.changeDue(10, 4.5);
  assert.equal(s.ok, false);
  assert.equal(s.short, 5.5);
  assert.equal(C.changeDue(10, "abc").ok, false);
  assert.equal(C.changeDue(10, -1).ok, false);
  // float safety
  assert.equal(C.changeDue(0.1 + 0.2, 1).change, 0.7);
});

test("single cash payment: tendered defaults to total, change computed", () => {
  const a = C.build(10, [{ method: "cash" }]);
  assert.equal(a.ok, true);
  assert.equal(a.paymentMethod, "cash");
  assert.equal(a.paymentVerified, true);
  assert.equal(a.change, 0);
  const b = C.build(10, [{ method: "cash", tendered: 20 }]);
  assert.equal(b.change, 10);
  assert.deepEqual(b.payments, [{ method: "cash", amount: 10 }]);
  const c = C.build(10, [{ method: "cash", tendered: 5 }]);
  assert.equal(c.ok, false);
  assert.equal(c.short, 5);
});

test("digital payment is recorded, never verified, with trimmed reference", () => {
  const r = C.build(25, [{ method: "mpaisa", reference: "  TXN\n123  " }]);
  assert.equal(r.ok, true);
  assert.equal(r.paymentMethod, "mpaisa");
  assert.equal(r.paymentVerified, false);
  assert.deepEqual(r.payments, [
    { method: "mpaisa", amount: 25, reference: "TXN 123" },
  ]);
  assert.equal(r.change, undefined);
});

test("split: digital + cash remainder with change on cash only", () => {
  const r = C.build(30, [
    { method: "eftpos", amount: 12.5, reference: "A1" },
    { method: "cash", tendered: 20 },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.paymentMethod, "split");
  assert.equal(r.paymentVerified, false);
  assert.equal(r.change, 2.5);
  assert.equal(r.tendered, 20);
  assert.deepEqual(
    r.payments.map((p) => [p.method, p.amount]),
    [
      ["eftpos", 12.5],
      ["cash", 17.5],
    ],
  );
});

test("split: remainder line takes the rest when no cash", () => {
  const r = C.build(50, [
    { method: "internet_banking", amount: 20 },
    { method: "mpaisa" },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.payments.map((p) => [p.method, p.amount]),
    [
      ["internet_banking", 20],
      ["mpaisa", 30],
    ],
  );
});

test("rejects: overpaying digital, duplicate method, unknown method, two blanks, empty", () => {
  assert.equal(C.build(10, [{ method: "eftpos", amount: 11 }]).ok, false);
  assert.equal(C.build(10, [{ method: "cash" }, { method: "cash" }]).ok, false);
  assert.equal(C.build(10, [{ method: "bitcoin" }]).ok, false);
  assert.equal(
    C.build(10, [{ method: "eftpos" }, { method: "mpaisa" }]).ok,
    false,
  );
  assert.equal(C.build(10, []).ok, false);
  assert.equal(
    C.build(10, [
      { method: "eftpos", amount: 10 },
      { method: "cash", tendered: 5 },
    ]).ok,
    false,
  );
  assert.equal(C.build(10, [{ method: "eftpos", amount: 0 }]).ok, false);
  assert.equal(C.build(10, [{ method: "eftpos", amount: 4 }]).ok, false);
});

test("cash rounding: only the cash part, to the nearest 5 or 10 cents, recorded as a signed amount", () => {
  assert.equal(C.roundCash(10.02, 0.05), 10);
  assert.equal(C.roundCash(10.03, 0.05), 10.05);
  assert.equal(C.roundCash(10.05, 0.1), 10.1);
  assert.equal(C.roundCash(10.04, 0.1), 10);
  assert.equal(C.roundCash(10.03, 0), 10.03);
  assert.equal(C.roundCash(10.03, 0.07), 10.03); // only the allowed steps
  const a = C.build(10.03, [{ method: "cash", tendered: 20 }], {
    rounding: 0.05,
  });
  assert.equal(a.ok, true);
  assert.deepEqual(a.payments, [{ method: "cash", amount: 10.05 }]);
  assert.equal(a.rounding, 0.02);
  assert.equal(a.change, 9.95);
  const b = C.build(10.02, [{ method: "cash" }], { rounding: 0.05 });
  assert.equal(b.rounding, -0.02);
  assert.deepEqual(b.payments, [{ method: "cash", amount: 10 }]);
  // exact amounts and digital payments are not rounded
  assert.equal(
    C.build(10, [{ method: "cash" }], { rounding: 0.05 }).rounding,
    undefined,
  );
  assert.equal(
    C.build(10.03, [{ method: "mpaisa" }], { rounding: 0.05 }).rounding,
    undefined,
  );
  // the cash part of a split sale is the only part rounded
  const s = C.build(
    30.03,
    [
      { method: "eftpos", amount: 10 },
      { method: "cash", tendered: 25 },
    ],
    { rounding: 0.05 },
  );
  assert.deepEqual(
    s.payments.map((p) => [p.method, p.amount]),
    [
      ["eftpos", 10],
      ["cash", 20.05],
    ],
  );
  assert.equal(s.rounding, 0.02);
  // short cash is judged against the rounded amount
  assert.equal(
    C.build(10.03, [{ method: "cash", tendered: 10.04 }], { rounding: 0.05 })
      .ok,
    false,
  );
  assert.equal(
    C.build(10.03, [{ method: "cash", tendered: 10.05 }], { rounding: 0.05 })
      .ok,
    true,
  );
});

test("cashPortion supports old and split sales", () => {
  assert.equal(C.cashPortion({ paymentMethod: "cash", total: 9 }), 9);
  assert.equal(C.cashPortion({ paymentMethod: "other", total: 9 }), 0);
  assert.equal(
    C.cashPortion({
      paymentMethod: "split",
      total: 30,
      payments: [
        { method: "eftpos", amount: 12.5 },
        { method: "cash", amount: 17.5 },
      ],
    }),
    17.5,
  );
});

test("methodTotals spreads split sales and skips rejected", () => {
  const rows = C.methodTotals([
    { paymentMethod: "cash", total: 10 },
    {
      paymentMethod: "split",
      total: 30,
      payments: [
        { method: "eftpos", amount: 12.5 },
        { method: "cash", amount: 17.5 },
      ],
    },
    { paymentMethod: "cash", total: 99, syncStatus: "rejected" },
  ]);
  const cash = rows.find((r) => r.method === "cash");
  assert.equal(cash.gross, 27.5);
  assert.equal(cash.sales, 2);
  assert.equal(rows.find((r) => r.method === "eftpos").gross, 12.5);
});

test("describe", () => {
  assert.equal(C.describe({ paymentMethod: "cash" }), "Cash");
  assert.equal(
    C.describe({
      payments: [
        { method: "mpaisa", amount: 1, reference: "X9" },
        { method: "cash", amount: 2 },
      ],
    }),
    "M-PAiSA ref X9 + Cash",
  );
});

test("hold / resume", () => {
  const cart = [
    { id: "a", name: "Tea", price: 2.5, qty: 2 },
    { id: "b", name: "Rice", price: 10, qty: 1, packId: "p", packUnits: 5 },
  ];
  const m = C.makeHold(cart, { id: "h1", now: 5, label: "Table 3" });
  assert.equal(m.ok, true);
  assert.equal(m.hold.total, 15);
  assert.equal(m.hold.label, "Table 3");
  assert.equal(C.makeHold([], {}).ok, false);
  assert.equal(C.makeHold([{ id: "x", price: 1, qty: 0 }], {}).ok, false);
  let list = C.addHold([], m.hold).list;
  assert.equal(list.length, 1);
  assert.equal(C.removeHold(list, "h1").length, 0);
  const r = C.resumeLines(m.hold, [{ id: "a" }]);
  assert.equal(r.lines.length, 1);
  assert.deepEqual(r.dropped, ["Rice"]);
  let l = [];
  for (let i = 0; i < C.MAX_HELD; i++)
    l = C.addHold(l, { ...m.hold, id: "h" + i }).list;
  assert.equal(C.addHold(l, { ...m.hold, id: "zz" }).ok, false);
});
