const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("../js/onboarding.js");

const good = {
  businessName: "  Teuea Store ",
  currency: "aud",
  edition: "retail",
  methods: ["mpaisa", "eftpos", "bitcoin"],
  deviceName: "Front till",
};

test("a good answer is cleaned: trimmed name, upper-case currency, unknown methods dropped, cash always on", () => {
  const r = O.validate(good);
  assert.equal(r.ok, true);
  assert.equal(r.value.businessName, "Teuea Store");
  assert.equal(r.value.currency, "AUD");
  assert.deepEqual(r.value.methods, ["cash", "eftpos", "mpaisa"]);
});

test("cash stays on even if nothing is ticked", () => {
  assert.deepEqual(O.validate({ ...good, methods: [] }).value.methods, [
    "cash",
  ]);
  assert.deepEqual(O.validate({ ...good, methods: undefined }).value.methods, [
    "cash",
  ]);
});

test("bad answers are refused with a reason", () => {
  assert.equal(O.validate({ ...good, businessName: "   " }).ok, false);
  assert.equal(O.validate({ ...good, currency: "dollars" }).ok, false);
  assert.equal(O.validate({ ...good, currency: "" }).ok, false);
  assert.equal(O.validate({ ...good, edition: "enterprise" }).ok, false);
  assert.equal(O.validate({ ...good, deviceName: "" }).ok, false);
  for (const bad of [
    { ...good, businessName: "" },
    { ...good, edition: "x" },
  ])
    assert.ok(O.validate(bad).error.length > 5);
});

test("settings to save", () => {
  const s = O.toSettings(O.validate(good).value, 7);
  const m = Object.fromEntries(s.map((x) => [x.key, x.value]));
  assert.equal(m.businessName, "Teuea Store");
  assert.deepEqual(m.payMethods, ["cash", "eftpos", "mpaisa"]);
  assert.deepEqual(m.onboarded, { at: 7, edition: "retail" });
  assert.equal(m.deviceName, "Front till");
});

test("the set-up card shows only on a brand-new, unused install", () => {
  assert.equal(O.needed({}), true);
  assert.equal(O.needed({ onboarded: { at: 1 } }), false);
  assert.equal(O.needed({ dismissed: true }), false);
  assert.equal(O.needed({ businessName: "Shop" }), false);
  assert.equal(O.needed({ hasProducts: true }), false);
  assert.equal(O.needed({ hasSales: true }), false);
});

test("enabled payment methods: older installs get everything; cash is never removable", () => {
  assert.deepEqual(O.enabledMethods(undefined), O.METHODS);
  assert.deepEqual(O.enabledMethods(["eftpos"]), ["cash", "eftpos"]);
  assert.deepEqual(O.enabledMethods([]), ["cash"]);
});
