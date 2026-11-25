const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/stock.js");

const tea = { id: "p1", name: "Tea", price: 10, stock: 5 };
const jam = { id: "p2", name: "Jam", price: 5, stock: 0 };

test("receiving adds, damage removes, both recorded as movements with a reason", () => {
  const r = S.buildMove(tea, "receive", "10", {
    id: "m1",
    now: 5,
    note: "PO 7",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(
    [
      r.value.delta,
      r.value.reason,
      r.value.productId,
      r.value.createdAt,
      r.value.syncStatus,
      r.value.note,
      r.newStock,
    ],
    [10, "purchase", "p1", 5, "pending", "PO 7", 15],
  );
  const d = S.buildMove(tea, "damage", 2, { id: "m2" });
  assert.deepEqual(
    [d.value.delta, d.value.reason, d.newStock],
    [-2, "damage", 3],
  );
});

test("a stock count sets the shelf number and records the difference", () => {
  assert.equal(S.buildMove(tea, "count", 8, { id: "m" }).value.delta, 3);
  assert.equal(S.buildMove(tea, "count", 2, { id: "m" }).value.delta, -3);
  assert.equal(S.buildMove(tea, "count", 0, { id: "m" }).value.delta, -5);
  assert.equal(S.buildMove(tea, "count", 0, { id: "m" }).newStock, 0);
  assert.match(S.buildMove(tea, "count", 5, { id: "m" }).error, /matches/);
});

test("stock can never go negative", () => {
  assert.match(
    S.buildMove(tea, "damage", 6, { id: "m" }).error,
    /Only 5 of Tea/,
  );
  assert.match(S.buildMove(tea, "remove", 6, { id: "m" }).error, /Only 5/);
  assert.equal(S.buildMove(tea, "remove", 5, { id: "m" }).newStock, 0);
  assert.match(
    S.buildMove(jam, "damage", 1, { id: "m" }).error,
    /Only 0 of Jam/,
  );
});

test("quantities must be whole numbers; actions and products must be valid", () => {
  for (const bad of ["", "abc", 1.5, -1, null, undefined, 2e9])
    assert.equal(S.buildMove(tea, "receive", bad, {}).ok, false, String(bad));
  assert.equal(
    S.buildMove(tea, "receive", 0, {}).ok,
    false,
    "receiving 0 is pointless",
  );
  assert.equal(S.buildMove(tea, "steal", 1, {}).ok, false);
  assert.equal(S.buildMove(null, "receive", 1, {}).ok, false);
  assert.equal(
    S.buildMove(tea, "receive", 1, { note: "n".repeat(201) }).ok,
    false,
  );
});

test("a corrupt stock value on the device is treated as zero, not NaN", () => {
  const bad = { id: "p9", name: "Odd", stock: "abc" };
  assert.equal(S.buildMove(bad, "receive", 3, {}).newStock, 3);
  assert.equal(
    S.buildMove({ ...bad, stock: -4 }, "receive", 3, {}).newStock,
    3,
  );
});

test("movesFor returns one product's movements, newest first", () => {
  const ms = [
    { productId: "p1", createdAt: 1 },
    { productId: "p2", createdAt: 9 },
    { productId: "p1", createdAt: 5 },
  ];
  assert.deepEqual(
    S.movesFor(ms, "p1").map((m) => m.createdAt),
    [5, 1],
  );
  assert.equal(S.deltaText(3), "+3");
  assert.equal(S.deltaText(-2), "-2");
});

test("PO numbers are unique, ordered and share the device code; the counter is per kind", async () => {
  const data = new Map();
  const store = {
    get: async (_s, k) => data.get(k),
    put: async (_s, v) => void data.set(v.key, v),
  };
  const [a, b, c] = await Promise.all(
    [1, 2, 3].map(() => S.nextNumber(store, "PO", "poSeq", () => 0.2)),
  );
  assert.deepEqual(
    [a, b, c].map((n) => n.split("-")[2]),
    ["0001", "0002", "0003"],
  );
  assert.ok([a, b, c].every(S.isValidPoNumber));
  const other = await S.nextNumber(store, "QT", "quoteSeq", () => 0.9);
  assert.match(other, /^QT-[A-Z0-9]{4}-0001$/);
  assert.equal(other.split("-")[1], a.split("-")[1]);
});

test("suppliers: a name is required, the rest is trimmed and limited", () => {
  const ok = S.buildSupplier(
    { name: "  Pacific Traders ", phone: " +686 1 ", note: "" },
    { id: "s1", now: 7 },
  );
  assert.deepEqual(
    [ok.value.name, ok.value.phone, "note" in ok.value, ok.value.updatedAt],
    ["Pacific Traders", "+686 1", false, 7],
  );
  assert.equal(S.buildSupplier({ name: "" }, {}).ok, false);
  assert.equal(S.buildSupplier({ name: "x".repeat(101) }, {}).ok, false);
  assert.equal(
    S.buildSupplier({ name: "A", phone: "1".repeat(41) }, {}).ok,
    false,
  );
});

const products = [tea, jam];
const line = (productId, qty, unitCost) => ({ productId, qty, unitCost });

test("a purchase order totals its lines exactly in cents", () => {
  const r = S.buildPurchaseOrder(
    {
      supplierName: "Pacific Traders",
      supplierId: "sup1",
      lines: [line("p1", 3, "1.10"), line("p2", 7, 0.1)],
      note: "Rush",
    },
    products,
    { id: "po1", number: "PO-AB12-0001", now: 9, currency: "AUD" },
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.total, 4); // 3 x 1.10 + 7 x 0.10 = 3.30 + 0.70
  assert.deepEqual(
    [
      r.value.status,
      r.value.createdAt,
      r.value.updatedAt,
      r.value.syncStatus,
      r.value.supplierId,
    ],
    ["draft", 9, 9, "pending", "sup1"],
  );
  assert.deepEqual(r.value.items[0], {
    productId: "p1",
    name: "Tea",
    qty: 3,
    unitCost: 1.1,
  });
});

test("a purchase order refuses bad suppliers and lines", () => {
  const mk = (over, lines = [line("p1", 1, 1)]) =>
    S.buildPurchaseOrder({ supplierName: "S", lines, ...over }, products, {});
  assert.equal(mk({ supplierName: " " }).ok, false);
  assert.equal(mk({}, []).ok, false);
  assert.equal(mk({}, [line("ghost", 1, 1)]).ok, false);
  assert.equal(mk({}, [line("p1", 0, 1)]).ok, false);
  assert.equal(mk({}, [line("p1", 1.5, 1)]).ok, false);
  assert.equal(mk({}, [line("p1", 1, -1)]).ok, false);
  assert.equal(mk({}, [line("p1", 1, "")]).ok, false);
  assert.equal(mk({}, [line("p1", 1, 1.005)]).ok, false);
  assert.match(mk({}, [line("p1", 1, 1), line("p1", 2, 1)]).error, /twice/);
  assert.equal(mk({ note: "n".repeat(201) }).ok, false);
  assert.equal(mk({}, [line("p1", 1e9, 1e9)]).ok, false);
});

test("order -> receive writes one purchase movement per line and freezes the order", () => {
  let n = 0;
  const po = S.buildPurchaseOrder(
    { supplierName: "S", lines: [line("p1", 24, 1.2), line("p2", 6, 2)] },
    products,
    { id: "po1", number: "PO-AB12-0001", now: 10 },
  ).value;
  const ordered = S.transition(po, "order", { now: 20 });
  assert.equal(ordered.order.status, "ordered");
  assert.equal(ordered.order.updatedAt, 20);
  assert.deepEqual(ordered.moves, []);
  assert.equal(
    S.transition(ordered.order, "order", {}).ok,
    false,
    "cannot order twice",
  );
  const got = S.transition(ordered.order, "receive", {
    now: 30,
    newId: () => "mv" + ++n,
  });
  assert.equal(got.order.status, "received");
  assert.equal(got.order.receivedAt, 30);
  assert.deepEqual(
    got.moves.map((m) => [
      m.id,
      m.productId,
      m.delta,
      m.reason,
      m.refId,
      m.note,
    ]),
    [
      ["mv1", "p1", 24, "purchase", "po1", "PO-AB12-0001"],
      ["mv2", "p2", 6, "purchase", "po1", "PO-AB12-0001"],
    ],
  );
  for (const a of ["order", "receive", "cancel"])
    assert.match(
      S.transition(got.order, a, { newId: () => "x" }).error,
      /received order cannot/,
    );
});

test("a draft can be received directly, or cancelled; a cancelled order is frozen", () => {
  const po = S.buildPurchaseOrder(
    { supplierName: "S", lines: [line("p1", 2, 1)] },
    products,
    { id: "po1", now: 10 },
  ).value;
  assert.equal(
    S.transition(po, "receive", { now: 11, newId: () => "m" }).order.status,
    "received",
  );
  const c = S.transition(po, "cancel", { now: 11 });
  assert.equal(c.order.status, "cancelled");
  assert.equal(
    S.transition(c.order, "receive", { newId: () => "m" }).ok,
    false,
  );
  assert.equal(S.transition(po, "ship", {}).ok, false);
  assert.equal(S.transition(null, "order", {}).ok, false);
});

test("a change marks the order pending again and clears an old refusal; updatedAt never goes back", () => {
  const po = {
    id: "po1",
    status: "draft",
    items: [{ productId: "p1", name: "Tea", qty: 1, unitCost: 1 }],
    updatedAt: 100,
    syncStatus: "rejected",
    syncError: "Refused",
    number: "PO-AB12-0001",
  };
  const o = S.transition(po, "order", { now: 50 }).order;
  assert.equal(o.syncStatus, "pending");
  assert.equal("syncError" in o, false);
  assert.equal(o.updatedAt, 100);
});

test("the purchase order text lists lines, total, supplier and status", () => {
  const po = S.buildPurchaseOrder(
    {
      supplierName: "Pacific Traders",
      lines: [line("p1", 24, 1.2)],
      note: "Friday",
    },
    products,
    {
      id: "po1",
      number: "PO-AB12-0007",
      now: Date.UTC(2026, 10, 25),
      currency: "AUD",
    },
  ).value;
  const t = S.buildPurchaseOrderText(po, { name: "Corner Shop" });
  assert.match(t, /Corner Shop/);
  assert.match(t, /PURCHASE ORDER PO-AB12-0007/);
  assert.match(t, /Supplier: Pacific Traders/);
  assert.match(t, /24 x 1\.20\s+28\.80/);
  assert.match(t, /TOTAL AUD\s+28\.80/);
  assert.match(t, /Note: Friday/);
  assert.ok(t.split("\n").every((l) => l.length <= 40));
});
