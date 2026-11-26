const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(navigator = { onLine: true }) {
  const cleared = [];
  const ctx = vm.createContext({
    navigator,
    document: { getElementById: () => null },
    window: {},
    setTimeout,
    clearTimeout: (t) => cleared.push(t),
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/sync.js"), "utf8"),
    ctx,
  );
  return { B: vm.runInContext("SyncBackoff", ctx), cleared };
}

test("waits 30 s, 1 min, 2 min, 4 min, 8 min, then never more than 15 min (no jitter)", () => {
  const { B } = load();
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 20].map((n) => B.delay(n, () => 0.5)),
    [30000, 60000, 120000, 240000, 480000, 900000, 900000, 900000],
  );
});

test("each wait varies by at most 25% either way so devices do not retry together", () => {
  const { B } = load();
  assert.equal(
    B.delay(3, () => 0),
    90000,
  );
  assert.equal(
    B.delay(3, () => 1),
    150000,
  );
  for (let i = 0; i < 200; i++) {
    const d = B.delay(4);
    assert.ok(d >= 180000 && d <= 300000, String(d));
  }
});

test("a failure schedules one retry; a second failure replaces it and waits longer", () => {
  const { B, cleared } = load();
  const scheduled = [];
  const schedule = (fn, ms) => (
    scheduled.push({ fn, ms }),
    "t" + scheduled.length
  );
  let runs = 0;
  B.failed(
    () => runs++,
    schedule,
    () => 0.5,
  );
  B.failed(
    () => runs++,
    schedule,
    () => 0.5,
  );
  assert.deepEqual(
    scheduled.map((s) => s.ms),
    [30000, 60000],
  );
  assert.deepEqual(cleared, ["t1"], "the earlier timer was cancelled");
  assert.equal(B.failures, 2);
  scheduled[1].fn();
  assert.equal(runs, 1);
  assert.equal(B.timer, null);
});

test("the retry is skipped while the device is offline (the 'online' event takes over)", () => {
  const nav = { onLine: false };
  const { B } = load(nav);
  let runs = 0;
  let fn;
  B.failed(
    () => runs++,
    (f) => ((fn = f), "t"),
    () => 0.5,
  );
  fn();
  assert.equal(runs, 0);
});

test("a successful sync resets the count and cancels a waiting retry", () => {
  const { B, cleared } = load();
  B.failed(
    () => {},
    () => "t1",
    () => 0.5,
  );
  B.failed(
    () => {},
    () => "t2",
    () => 0.5,
  );
  B.reset();
  assert.equal(B.failures, 0);
  assert.equal(B.timer, null);
  assert.ok(cleared.includes("t2"));
  assert.equal(
    B.delay(B.failures + 1, () => 0.5),
    30000,
    "the next failure starts again at 30 s",
  );
});
