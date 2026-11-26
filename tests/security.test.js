const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/security.js");

test("audit log: entries chain and verify", async () => {
  let log = [];
  log = await S.append(
    log,
    { action: "sign-in", detail: "owner@example.com", actor: "owner" },
    1000,
  );
  log = await S.append(
    log,
    {
      action: "product-edit",
      detail: "Tea 10 -> 12",
      actor: "owner",
      deviceId: "AB12",
    },
    2000,
  );
  log = await S.append(
    log,
    { action: "refund", detail: "CN-1", actor: "u1" },
    3000,
  );
  assert.equal(log.length, 3);
  assert.equal(log[0].prev, S.GENESIS);
  assert.equal(log[1].prev, log[0].hash);
  assert.deepEqual(await S.verify(log), { ok: true });
});

test("audit log: edits, deletions and reordering are detected", async () => {
  let log = [];
  for (const a of ["sign-in", "refund", "product-edit", "sign-out"])
    log = await S.append(
      log,
      { action: a, detail: a },
      Math.random() * 1e6 + 1,
    );
  const edited = log.map((e) => ({ ...e }));
  edited[1].detail = "changed";
  assert.equal((await S.verify(edited)).ok, false);
  assert.equal((await S.verify(edited)).index, 1);
  const removed = [log[0], log[2], log[3]];
  const r = await S.verify(removed);
  assert.equal(r.ok, false);
  assert.equal(r.index, 1);
  assert.equal((await S.verify([log[1], log[0]])).ok, false);
  const bad = log.map((e) => ({ ...e }));
  delete bad[2].hash;
  assert.equal((await S.verify(bad)).ok, false);
});

test("audit log: unknown action becomes 'other', text is cleaned and capped", async () => {
  const e = await S.makeEntry(
    null,
    { action: "hack", detail: "x\n".repeat(200), actor: "a".repeat(100) },
    5,
  );
  assert.equal(e.action, "other");
  assert.ok(e.detail.length <= 200 && !/\n/.test(e.detail));
  assert.equal(e.actor.length, 60);
});

test("audit log: capped; the chain of what is kept still verifies", async () => {
  let log = [];
  for (let i = 0; i < S.MAX_LOG + 5; i++)
    log = await S.append(log, { action: "lock", detail: String(i) }, i + 1);
  assert.equal(log.length, S.MAX_LOG);
  assert.equal(log[0].detail, "5");
  assert.equal((await S.verify(log)).ok, true);
});

test("filter and CSV (formulas neutralised)", async () => {
  let log = [];
  log = await S.append(
    log,
    { action: "refund", detail: "=cmd()", actor: "u1" },
    1000,
  );
  log = await S.append(
    log,
    { action: "sign-in", detail: "ok", actor: "u2" },
    5000,
  );
  assert.equal(S.filter(log, { action: "refund" }).length, 1);
  assert.equal(S.filter(log, { from: 2000 }).length, 1);
  assert.equal(S.filter(log, { q: "u2" }).length, 1);
  const csv = S.toCsv(log);
  assert.ok(csv.startsWith("time,action,detail,who,device,hash\r\n"));
  assert.ok(csv.includes("'=cmd()"));
});

test("PIN rules", () => {
  assert.equal(S.validPin("1234").ok, false);
  assert.equal(S.validPin("1111").ok, false);
  assert.equal(S.validPin("9876").ok, false);
  assert.equal(S.validPin("12").ok, false);
  assert.equal(S.validPin("12ab").ok, false);
  assert.equal(S.validPin("739204").ok, true);
});

test("PIN is stored salted and hashed and verifies only the right PIN", async () => {
  const a = await S.makePin("739204");
  const b = await S.makePin("739204");
  assert.equal(a.ok, true);
  assert.notEqual(a.record.hash, b.record.hash); // different salt each time
  assert.ok(!JSON.stringify(a.record).includes("739204"));
  assert.equal(await S.checkPin(a.record, "739204"), true);
  assert.equal(await S.checkPin(a.record, "739205"), false);
  assert.equal(await S.checkPin(null, "739204"), false);
  assert.equal((await S.makePin("1111")).ok, false);
});

test("lock-out after 5 wrong attempts, cleared on success", () => {
  let st = { fails: 0, lockedUntil: 0 };
  for (let i = 0; i < 4; i++) st = S.afterAttempt(st, false, 1000);
  assert.equal(st.fails, 4);
  assert.equal(S.waitSeconds(st, 1000), 0);
  st = S.afterAttempt(st, false, 1000);
  assert.equal(S.waitSeconds(st, 1000), S.LOCK.seconds);
  assert.equal(S.waitSeconds(st, 1000 + 31000), 0);
  assert.deepEqual(S.afterAttempt(st, true, 5), { fails: 0, lockedUntil: 0 });
});

test("approval is needed only above a limit that is set", () => {
  const limits = { discountPct: 10, refundAmount: 50 };
  assert.equal(S.needsApproval("discount", 10, limits), false);
  assert.equal(S.needsApproval("discount", 10.01, limits), true);
  assert.equal(S.needsApproval("refund", 50, limits), false);
  assert.equal(S.needsApproval("refund", 50.01, limits), true);
  assert.equal(S.needsApproval("discount", 99, { discountPct: 0 }), false);
  assert.equal(S.needsApproval("discount", 99, undefined), false);
  assert.equal(S.needsApproval("refund", 1e6, {}), false);
});

test("limit validation", () => {
  assert.deepEqual(
    S.validLimits({ discountPct: "15", refundAmount: "20.505" }).value,
    { discountPct: 15, refundAmount: 20.51 },
  );
  assert.deepEqual(S.validLimits({ discountPct: "", refundAmount: "" }).value, {
    discountPct: 0,
    refundAmount: 0,
  });
  assert.equal(
    S.validLimits({ discountPct: "101", refundAmount: "0" }).ok,
    false,
  );
  assert.equal(
    S.validLimits({ discountPct: "5", refundAmount: "-1" }).ok,
    false,
  );
  assert.equal(
    S.validLimits({ discountPct: "x", refundAmount: "1" }).ok,
    false,
  );
});

test("idle timing and device names", () => {
  assert.equal(S.idleDue(0, 0, 1e9), false);
  assert.equal(S.idleDue(0, 5, 4 * 60000), false);
  assert.equal(S.idleDue(0, 5, 5 * 60000), true);
  assert.equal(S.deviceName("  Till 2\n").value, "Till 2");
  assert.equal(S.deviceName("   ").ok, false);
  assert.equal(S.deviceName("x".repeat(80)).value.length, 30);
});
