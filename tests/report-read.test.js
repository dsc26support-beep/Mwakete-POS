// The owner's whole-business report read (js/integrations/firebase.js reportWith).
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeFs } = require("./helpers/fakefs.js");

global.FIREBASE_CONFIG = require("../js/integrations/firebase-config.js");
const { reportWith } = require("../js/integrations/firebase.js")._test;

const seed = () =>
  fakeFs({
    existing: {
      "businesses/U1/sales/a": { id: "a", createdAt: 100, total: 1 },
      "businesses/U1/sales/b": { id: "b", createdAt: 300, total: 2 },
      "businesses/U1/sales/c": { id: "c", createdAt: 50, total: 9 },
      "businesses/U1/refunds/r": { id: "r", createdAt: 200, total: 1 },
      "businesses/U1/staff/s1": { uid: "s1", name: "Tina" },
      "businesses/OTHER/sales/z": { id: "z", createdAt: 400, total: 5 },
    },
  });

test("reads sales and credit notes since a date, newest first, plus the staff list, from this business only", async () => {
  const r = await reportWith(seed(), {}, "U1", 100);
  assert.deepEqual(
    r.sales.map((s) => s.id),
    ["b", "a"],
  );
  assert.deepEqual(
    r.refunds.map((x) => x.id),
    ["r"],
  );
  assert.deepEqual(
    r.staff.map((s) => s.name),
    ["Tina"],
  );
  assert.equal(r.capped, false);
});

test("a cap protects a phone from a huge history, and says when it was hit", async () => {
  const small = await reportWith(seed(), {}, "U1", 0, { limit: 2 });
  assert.equal(small.sales.length, 2);
  assert.deepEqual(
    small.sales.map((s) => s.id),
    ["b", "a"],
    "the newest records are kept",
  );
  assert.equal(small.capped, true);
});
