// Generic cloud sync for credit notes, shifts, stock movements, purchase orders and quotes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { fakeFs } = require("./helpers/fakefs.js");

global.FIREBASE_CONFIG = require("../js/integrations/firebase-config.js");
const FB = require("../js/integrations/firebase.js");
const Invoice = require("../js/invoices.js");
const { syncWith, computeBalance } = FB._test;

const sale = (id, over = {}) => ({
  id,
  createdAt: 1,
  total: 5,
  paymentMethod: "cash",
  items: [{ productId: "p", name: "Water", unitPrice: 2.5, quantity: 2 }],
  ...over,
});
const refund = (id, over = {}) => ({
  id,
  number: "CN-AB12-1",
  saleId: "s1",
  createdAt: 2,
  method: "cash",
  total: 2.5,
  items: [{ lineIndex: 0, quantity: 1 }],
  ...over,
});

test("extra records are written after the sales, stamped with the writer, and reported per kind", async () => {
  const order = [];
  const f = fakeFs();
  const real = f.setDoc;
  f.setDoc = async (ref, data) => {
    order.push(ref.split("/").slice(-2, -1)[0]);
    return real(ref, data);
  };
  const r = await syncWith(f, {}, "U1", {
    transactions: [sale("s1")],
    extra: { refunds: [refund("r1")], registers: [{ id: "g1", openedAt: 1 }] },
  });
  assert.deepEqual(r.acceptedExtra.refunds, ["r1"]);
  assert.deepEqual(r.acceptedExtra.registers, ["g1"]);
  assert.ok(
    order.indexOf("sales") < order.indexOf("refunds"),
    "the sale is stored before its refund",
  );
  assert.equal(f.store.get("businesses/U1/refunds/r1").staffUid, "U1");
});

test("unknown record kinds are never written", async () => {
  const f = fakeFs();
  await syncWith(f, {}, "U1", {
    extra: { passwords: [{ id: "x" }], sales: [sale("evil")] },
  });
  assert.deepEqual([...f.store.keys()], []);
});

test("a cashier does not send owner-only kinds (suppliers, purchase orders) but does send the rest", async () => {
  const f = fakeFs();
  const r = await syncWith(
    f,
    {},
    "STAFF1",
    {
      extra: {
        suppliers: [{ id: "sup1", name: "Wholesaler" }],
        purchaseOrders: [{ id: "po1" }],
        refunds: [refund("r1")],
        quotes: [{ id: "q1" }],
      },
    },
    { businessId: "OWNER1", role: "cashier" },
  );
  assert.deepEqual(Object.keys(r.acceptedExtra).sort(), ["quotes", "refunds"]);
  assert.ok(f.store.has("businesses/OWNER1/refunds/r1"));
  assert.ok(!f.store.has("businesses/OWNER1/suppliers/sup1"));
  assert.ok(!f.store.has("businesses/OWNER1/purchaseOrders/po1"));
});

test("a record the cloud rules refuse is reported as rejected, others still go through", async () => {
  const f = fakeFs({ failWith: { bad: "permission-denied" } });
  const r = await syncWith(f, {}, "U1", {
    extra: { refunds: [refund("bad"), refund("ok")] },
  });
  assert.deepEqual(r.acceptedExtra.refunds, ["ok"]);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].id, "bad");
});

test("balance = invoices on account - payments - credit notes to the account (cash credit notes do not count)", () => {
  const sales = [
    { invoice: { mode: "account", total: 100 } },
    { invoice: { mode: "paid", total: 50 } },
  ];
  const payments = [{ amount: 30 }];
  const refunds = [
    { method: "account", total: 20 },
    { method: "cash", total: 99 },
  ];
  assert.equal(computeBalance(sales, payments, refunds), 50);
  assert.equal(computeBalance(sales, payments), 70);
});

test("the owner's confirmed balance includes a credit note sent in the same sync", async () => {
  const f = fakeFs();
  const inv = sale("i1", {
    customerId: "c1",
    total: 100,
    invoice: { mode: "account", total: 100 },
  });
  const r = await syncWith(f, {}, "U1", {
    transactions: [inv],
    extra: {
      refunds: [
        refund("r1", {
          saleId: "i1",
          method: "account",
          customerId: "c1",
          total: 40,
        }),
      ],
    },
  });
  assert.equal(r.balances.c1, 60);
});

test("pending balance on the device also subtracts open credit notes to the account", () => {
  const sales = [
    {
      id: "i1",
      customerId: "c1",
      syncStatus: "pending",
      invoice: { mode: "account", total: 100 },
    },
  ];
  const refunds = [
    { method: "account", customerId: "c1", total: 30, syncStatus: "pending" },
    { method: "account", customerId: "c1", total: 5, syncStatus: "synced" },
    { method: "account", customerId: "c1", total: 7, syncStatus: "rejected" },
    { method: "cash", customerId: "c1", total: 9, syncStatus: "pending" },
    { method: "account", customerId: "c2", total: 4, syncStatus: "pending" },
  ];
  assert.equal(Invoice.pendingBalance(sales, [], "c1", refunds), 70);
  assert.equal(Invoice.pendingBalance(sales, [], "c1"), 100);
});

/* applyExtra (js/sync.js) against an in-memory POSDB */
function loadSync(stores) {
  const data = {};
  for (const [k, v] of Object.entries(stores))
    data[k] = v.map((x) => ({ ...x }));
  const POSDB = {
    get: async (s, k) => {
      const r = (data[s] || []).find((x) => x.id === k);
      return r ? { ...r } : undefined;
    },
    put: async (s, v) => {
      data[s] = data[s] || [];
      const i = data[s].findIndex((x) => x.id === v.id);
      if (i >= 0) data[s][i] = { ...v };
      else data[s].push({ ...v });
    },
  };
  const ctx = vm.createContext({
    POSDB,
    FirebaseBackend: FB,
    document: { getElementById: () => null },
    window: {},
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/sync.js"), "utf8"),
    ctx,
  );
  return {
    applyExtra: ctx.applyExtra,
    stores: () => data,
    kinds: vm.runInContext("EXTRA_STORES", ctx),
  };
}

test("applyExtra marks synced only what the server confirmed; rejected keep the reason; unmentioned stay pending", async () => {
  const recs = [
    { id: "a", syncStatus: "pending" },
    { id: "b", syncStatus: "pending" },
    { id: "c", syncStatus: "pending" },
  ];
  const s = loadSync({ refunds: recs });
  const out = await s.applyExtra(
    {
      acceptedExtra: { refunds: ["a"] },
      rejected: [{ id: "b", reason: "Refused" }],
    },
    { refunds: recs },
  );
  const by = Object.fromEntries(s.stores().refunds.map((r) => [r.id, r]));
  assert.equal(by.a.syncStatus, "synced");
  assert.equal(by.b.syncStatus, "rejected");
  assert.equal(by.b.syncError, "Refused");
  assert.equal(by.c.syncStatus, "pending");
  assert.equal(out.synced, 1);
  assert.equal(out.rejected, 1);
});

test("applyExtra never overwrites a record that was edited while the sync ran", async () => {
  const sent = {
    id: "po1",
    status: "draft",
    updatedAt: 10,
    syncStatus: "pending",
  };
  const s = loadSync({
    purchaseOrders: [{ ...sent, status: "ordered", updatedAt: 11 }],
  });
  const out = await s.applyExtra(
    { acceptedExtra: { purchaseOrders: ["po1"] } },
    { purchaseOrders: [sent] },
  );
  const now = s.stores().purchaseOrders[0];
  assert.equal(now.status, "ordered");
  assert.equal(now.syncStatus, "pending");
  assert.equal(out.synced, 0);
});

test("the list of synced local stores matches what the adapter accepts", () => {
  const s = loadSync({});
  assert.deepEqual([...s.kinds].sort(), [
    "purchaseOrders",
    "quotes",
    "refunds",
    "registers",
    "stockMoves",
    "suppliers",
  ]);
});
