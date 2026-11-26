const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.FIREBASE_CONFIG = require("../js/integrations/firebase-config.js");
const FB = require("../js/integrations/firebase.js");
const { toRecord, computeBalance, syncWith, friendlyAuthError } = FB._test;

// A tiny fake of the Firestore functions used by the adapter.
function fakeFs({ failWith = {}, existing = {} } = {}) {
  const store = new Map(Object.entries(existing));
  const calls = [];
  const api = {
    store,
    calls,
    doc: (_db, ...p) => p.join("/"),
    collection: (_db, ...p) => ({ col: p.join("/") }),
    where: (f, op, v) => ({ f, op, v }),
    query: (c, w) => ({ ...c, w }),
    setDoc: async (ref, data) => {
      calls.push(ref);
      const id = ref.split("/").pop();
      if (failWith[id])
        throw Object.assign(new Error("x"), { code: failWith[id] });
      store.set(ref, data);
    },
    deleteDoc: async (ref) => {
      const id = ref.split("/").pop();
      if (failWith[id])
        throw Object.assign(new Error("x"), { code: failWith[id] });
      store.delete(ref);
    },
    getDocs: async (q) => ({
      docs: [...store.entries()]
        .filter(
          ([k, v]) =>
            k.startsWith(q.col + "/") &&
            !k.slice(q.col.length + 1).includes("/") &&
            (!q.w || v[q.w.f] === q.w.v),
        )
        .map(([, v]) => ({ data: () => v })),
    }),
  };
  return api;
}
const sale = (id, over = {}) => ({
  id,
  createdAt: 1,
  total: 5,
  paymentMethod: "cash",
  items: [{ productId: "p", name: "Water", unitPrice: 2.5, quantity: 2 }],
  ...over,
});

test("config points at the mwakete-pos web app and holds no secrets", () => {
  assert.equal(FIREBASE_CONFIG.projectId, "mwakete-pos");
  assert.match(FIREBASE_CONFIG.appId, /^1:648701661858:web:/);
  const keys = Object.keys(FIREBASE_CONFIG).join(",");
  assert.doesNotMatch(keys, /private|secret|service|password|token/i);
});

test("toRecord drops undefined and null top-level fields", () => {
  const r = toRecord({
    id: "a",
    customerId: null,
    note: undefined,
    n: 1,
    items: [{ x: undefined, y: 2 }],
  });
  assert.deepEqual(r, { id: "a", n: 1, items: [{ y: 2 }] });
});

test("a confirmed sale is accepted and stored under businesses/{uid}/sales/{id}", async () => {
  const f = fakeFs();
  const r = await syncWith(f, {}, "U1", { transactions: [sale("s1")] });
  assert.deepEqual(r.acceptedIds, ["s1"]);
  assert.deepEqual(r.rejected, []);
  assert.ok(f.store.has("businesses/U1/sales/s1"));
});

test("re-sending the same sale is idempotent (same document, no duplicate)", async () => {
  const f = fakeFs();
  await syncWith(f, {}, "U1", { transactions: [sale("s1")] });
  const r = await syncWith(f, {}, "U1", { transactions: [sale("s1")] });
  assert.deepEqual(r.acceptedIds, ["s1"]);
  assert.equal(
    [...f.store.keys()].filter((k) => k.includes("/sales/")).length,
    1,
  );
});

test("a rules refusal is reported as rejected with a reason, and does not block other records", async () => {
  const f = fakeFs({ failWith: { bad: "permission-denied" } });
  const r = await syncWith(f, {}, "U1", {
    transactions: [sale("bad"), sale("ok")],
  });
  assert.deepEqual(r.acceptedIds, ["ok"]);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].id, "bad");
  assert.match(r.rejected[0].reason, /security rules/);
});

test("when the cloud is unreachable nothing is reported synced and the sync throws", async () => {
  const f = fakeFs({ failWith: { s1: "unavailable" } });
  await assert.rejects(
    syncWith(f, {}, "U1", { transactions: [sale("s1")] }),
    /Could not reach the cloud/,
  );
});

test("a write that never answers times out and is NOT marked accepted", async () => {
  const f = fakeFs();
  f.setDoc = () => new Promise(() => {});
  await assert.rejects(
    syncWith(f, {}, "U1", { transactions: [sale("s1")] }, { timeoutMs: 20 }),
    /Could not reach the cloud/,
  );
});

test("payments and trade customers sync; balance = account invoices minus payments", async () => {
  const f = fakeFs();
  const inv = sale("i1", {
    customerId: "c1",
    invoice: { mode: "account", total: 100.1 },
  });
  const r = await syncWith(f, {}, "U1", {
    transactions: [inv],
    payments: [{ id: "p1", customerId: "c1", amount: 40.05, createdAt: 2 }],
    customers: [{ id: "c1", name: "Trade Co", creditLimit: 500 }],
  });
  assert.deepEqual(r.acceptedIds, ["i1"]);
  assert.deepEqual(r.acceptedPaymentIds, ["p1"]);
  assert.ok(f.store.has("businesses/U1/customers/c1"));
  assert.equal(r.balances.c1, 60.05);
});

test("computeBalance uses integer cents (no float drift)", () => {
  const sales = [0.1, 0.2].map((t) => ({
    invoice: { mode: "account", total: t },
  }));
  assert.equal(computeBalance(sales, []), 0.3);
  assert.equal(
    computeBalance([{ invoice: { mode: "paid", total: 9 } }], []),
    0,
  );
});

test("sign-in without an account never claims a sync", async () => {
  assert.equal(FB.isSignedIn(), false);
  assert.deepEqual(await FB.sync({ transactions: [sale("s1")] }), {
    configured: false,
  });
});

test("auth errors become plain-language messages", () => {
  assert.match(
    friendlyAuthError({ code: "auth/invalid-credential" }),
    /incorrect/,
  );
  assert.match(
    friendlyAuthError({ code: "auth/email-already-in-use" }),
    /already exists/,
  );
  assert.match(
    friendlyAuthError({ code: "auth/network-request-failed" }),
    /internet/,
  );
});

test("firestore.rules: default deny, owner-only, append-only ledger", () => {
  const r = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
  assert.doesNotMatch(r, /allow [^;]*:\s*if\s+true/);
  assert.match(r, /request\.auth\.uid == businessId/);
  assert.match(r, /match \/sales\/\{saleId\}[\s\S]*allow delete: if false/);
  assert.match(
    r,
    /match \/payments\/\{paymentId\}[\s\S]*allow delete: if false/,
  );
  assert.match(r, /request\.resource\.data == resource\.data/);
});
