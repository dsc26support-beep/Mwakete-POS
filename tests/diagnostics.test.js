const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../js/diagnostics.js");

test("errors are kept newest first, cleaned, and capped at 30", () => {
  let list = [];
  for (let i = 0; i < 40; i++)
    list = D.addError(
      list,
      { message: "Problem " + i, where: "app.js:" + i },
      1000 + i,
    );
  assert.equal(list.length, 30);
  assert.equal(list[0].message, "Problem 39");
  assert.equal(list[29].message, "Problem 10");
  const e = D.addError(
    [],
    {
      message: "  too\n\n  much   space " + "x".repeat(500),
      where: "w".repeat(200),
    },
    5,
  )[0];
  assert.ok(
    e.message.length <= 300 && !/\n/.test(e.message) && e.where.length <= 80,
  );
  assert.deepEqual(
    D.addError([{ at: 1, message: "a" }], { message: "" }),
    [{ at: 1, message: "a" }],
    "an empty message is not logged",
  );
  assert.deepEqual(D.addError(null, { message: "x" }, 1).length, 1);
});

const info = (over = {}) => ({
  now: Date.UTC(2026, 10, 25, 5, 30),
  online: true,
  tier: "wholesale",
  cloud: { signedIn: true, role: "cashier", verified: true },
  waiting: { sales: 3, payments: 0, refunds: 1 },
  refused: { sales: 0, quotes: 2 },
  totals: { products: 120, sales: 800, customers: 14 },
  errors: [
    {
      at: Date.UTC(2026, 10, 25, 4, 0),
      message: "Cannot read properties of null",
      where: "app.js:88",
    },
  ],
  userAgent: "Mozilla/5.0 (Linux; Android 12; Tecno) AppleWebKit/537.36",
  ...over,
});

test("the report has the version, state, what is waiting and recent problems", () => {
  const t = D.buildReport(info());
  assert.match(t, /MWAKETE POS DIAGNOSTICS/);
  assert.match(
    t,
    new RegExp("App version: " + D.APP_VERSION.replace(/\./g, "\\.")),
  );
  assert.match(t, /Time: 2026-11-25 05:30 UTC/);
  assert.match(t, /Online: yes/);
  assert.match(t, /Business type: wholesale/);
  assert.match(t, /signed in as cashier, email verified/);
  assert.match(t, /Waiting to sync: sales 3, refunds 1/);
  assert.match(t, /Refused by the cloud: quotes 2/);
  assert.match(
    t,
    /Records on this device: products 120, sales 800, customers 14/,
  );
  assert.match(
    t,
    /2026-11-25 04:00 UTC {2}Cannot read properties of null \(app\.js:88\)/,
  );
});

test("the report says plainly when things are fine or the person is not signed in", () => {
  const t = D.buildReport(
    info({
      cloud: { signedIn: false },
      waiting: {},
      refused: {},
      errors: [],
      online: false,
    }),
  );
  assert.match(t, /Cloud account: not signed in/);
  assert.match(t, /Waiting to sync: none/);
  assert.match(t, /Refused by the cloud: none/);
  assert.match(t, /Online: no/);
  assert.match(t, /Recent problems \(newest first\):\n {2}none/);
  assert.match(
    D.buildReport(info({ cloud: { signedIn: true, verified: false } })),
    /email NOT verified/,
  );
});

test("the report never contains business content: only counts, versions and error text", () => {
  const t = D.buildReport(info());
  for (const secret of ["@", "Trade Co", "Tea", "AUD", "total"])
    assert.ok(!t.includes(secret), secret);
  assert.match(
    t,
    /No sales, products, customer names, amounts or email addresses/,
  );
  assert.ok(
    D.buildReport(info({ userAgent: "u".repeat(500) }))
      .split("\n")
      .find((l) => l.startsWith("Browser:")).length <= 170,
  );
});

test("only the 10 newest problems are shown", () => {
  let errors = [];
  for (let i = 0; i < 25; i++)
    errors = D.addError(errors, { message: "E" + i }, 1000 + i);
  const t = D.buildReport(info({ errors }));
  assert.equal((t.match(/ UTC {2}E\d+/g) || []).length, 10);
  assert.match(t, /E24/);
  assert.doesNotMatch(t, /E14\b/);
});
