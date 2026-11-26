const test = require("node:test");
const assert = require("node:assert/strict");
const Reg = require("../js/register.js");

const open = { id: "shift-1", openedAt: 1000, openingFloat: 50 };
const sale = (total, at, over = {}) => ({
  id: "s" + at,
  createdAt: at,
  total,
  paymentMethod: "cash",
  syncStatus: "pending",
  ...over,
});

test("opening needs a valid float (0 is fine, negative or text is not)", () => {
  assert.equal(Reg.buildOpen("50", { id: "a", now: 5 }).value.openingFloat, 50);
  assert.equal(Reg.buildOpen(0, { id: "a", now: 5 }).ok, true);
  assert.equal(Reg.buildOpen(0, { id: "a", now: 5 }).value.openedAt, 5);
  for (const bad of ["", "abc", -1, 1.234, 2e9, null, undefined])
    assert.equal(Reg.buildOpen(bad, { id: "a" }).ok, false, String(bad));
});

test("expected cash = float + cash sales + cash payments - cash refunds, exactly", () => {
  const s = Reg.summarize(
    open,
    [
      sale(10.1, 1100),
      sale(0.2, 1200),
      sale(5, 1300, { paymentMethod: "other" }),
      sale(99, 1400, { paymentMethod: "account" }),
    ],
    [
      { createdAt: 1500, amount: 20.05, method: "cash" },
      { createdAt: 1500, amount: 7, method: "other" },
    ],
    [
      { createdAt: 1600, total: 3.3, method: "cash" },
      { createdAt: 1600, total: 40, method: "account" },
    ],
    5000,
  );
  assert.equal(s.cashSales, 10.3);
  assert.equal(s.cashPayments, 20.05);
  assert.equal(s.cashRefunds, 3.3);
  assert.equal(s.salesCount, 2);
  assert.equal(s.expectedCash, 77.05); // 50 + 10.30 + 20.05 - 3.30
});

test("only records inside the shift count; rejected records never do", () => {
  const s = Reg.summarize(
    open,
    [
      sale(10, 999),
      sale(10, 1000),
      sale(10, 5000),
      sale(10, 5001),
      sale(10, 2000, { syncStatus: "rejected" }),
    ],
    [],
    [],
    5000,
  );
  assert.equal(s.cashSales, 20);
  assert.equal(s.salesCount, 2);
});

test("a payment without a method is treated as cash (older records)", () => {
  const s = Reg.summarize(open, [], [{ createdAt: 1100, amount: 5 }], [], 5000);
  assert.equal(s.cashPayments, 5);
});

test("closing reports over, short and balanced", () => {
  const sales = [sale(25, 1100)];
  const make = (counted) =>
    Reg.buildClose(open, counted, { id: "x", now: 2000, sales });
  assert.equal(make(75).value.difference, 0);
  assert.equal(make(75.5).value.difference, 0.5);
  assert.equal(make(70).value.difference, -5);
  assert.equal(make(75).value.expectedCash, 75);
  const r = make(70).value;
  assert.deepEqual(
    [
      r.id,
      r.openedAt,
      r.closedAt,
      r.openingFloat,
      r.countedCash,
      r.cashSales,
      r.salesCount,
      r.syncStatus,
    ],
    ["shift-1", 1000, 2000, 50, 70, 25, 1, "pending"],
  );
  assert.match(Reg.differenceText(-5), /Short by 5\.00/);
  assert.match(Reg.differenceText(0.5), /Over by 0\.50/);
  assert.match(Reg.differenceText(0), /Balanced/);
});

test("closing validates the count and the note, and needs an open shift", () => {
  assert.equal(Reg.buildClose(null, 10, {}).ok, false);
  assert.match(Reg.buildClose(open, "", { id: "x" }).error, /Cash counted/);
  assert.equal(Reg.buildClose(open, -1, {}).ok, false);
  assert.equal(Reg.buildClose(open, 1.005, {}).ok, false);
  assert.equal(Reg.buildClose(open, 10, { note: "n".repeat(201) }).ok, false);
  const ok = Reg.buildClose(open, 10, {
    note: "  Short a coin  ",
    currency: "AUD",
    now: 3000,
  });
  assert.equal(ok.value.note, "Short a coin");
  assert.equal(ok.value.currency, "AUD");
});

test("a clock that went backwards never produces a shift that closes before it opened", () => {
  const r = Reg.buildClose({ ...open, openedAt: 9000 }, 50, { now: 1000 });
  assert.equal(r.value.closedAt, 9000);
});

test("the shift report shows every figure and the difference", () => {
  const rec = Reg.buildClose(open, 70, {
    id: "x",
    now: Date.UTC(2026, 10, 25, 9, 30),
    sales: [sale(25, 1100)],
    note: "Coin short",
  }).value;
  const t = Reg.buildShiftText(rec, { name: "Corner Shop" });
  assert.match(t, /Corner Shop/);
  assert.match(t, /REGISTER SHIFT REPORT/);
  assert.match(t, /Opening float\s+50\.00/);
  assert.match(t, /Cash sales \(1\)\s+25\.00/);
  assert.match(t, /EXPECTED IN DRAWER\s+75\.00/);
  assert.match(t, /COUNTED\s+70\.00/);
  assert.match(t, /DIFFERENCE\s+-5\.00/);
  assert.match(t, /Short by 5\.00/);
  assert.match(t, /Note: Coin short/);
  assert.ok(t.split("\n").every((l) => l.length <= 40));
});
