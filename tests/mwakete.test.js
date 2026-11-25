const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Any network call from the adapter would be a bug: it has no verified API to call.
let calls = 0;
global.fetch = () => {
  calls++;
  throw new Error("network call");
};
global.XMLHttpRequest = function () {
  calls++;
};
const M = require("../js/integrations/mwakete.js");

test("the Mwakete adapter reports not connected and says why", async () => {
  const s = await M.status();
  assert.equal(s.connected, false);
  assert.equal(s.configured, false);
  assert.match(s.reason, /not been supplied|runs on its own/i);
});

test("every action refuses with a clear message and never touches the network", async () => {
  for (const fn of ["authenticate", "getCatalogue", "submitSale"])
    await assert.rejects(() => M[fn]({ any: "thing" }), /not configured/i, fn);
  assert.deepEqual(await M.disconnect(), { connected: false, changed: false });
  assert.equal(calls, 0);
});

test("the needs list names what the Mwakete team must supply", () => {
  assert.ok(M.requirements.length >= 4);
  const text = M.requirements.join(" ").toLowerCase();
  for (const word of [
    "identity",
    "catalogue",
    "idempotency",
    "tenant",
    "test environment",
  ])
    assert.ok(text.includes(word), word);
});

test("the source contains no hard-coded Mwakete address or key", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../js/integrations/mwakete.js"),
    "utf8",
  );
  assert.ok(
    !/https?:\/\//.test(src.replace(/\/\*[\s\S]*?\*\//g, "")),
    "no URL in code",
  );
  assert.ok(
    !/apikey|api_key|secret|token\s*[:=]/i.test(
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
    ),
  );
});
