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

const fakeServer = (script = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const r = script[
      init.method + " " + new URL(url).pathname.replace(/^\/api/, "")
    ] || { status: 200, json: { ok: true } };
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.json,
    };
  };
  return { calls, fetchImpl };
};
const cfg = (fetchImpl, extra = {}) => ({
  baseUrl: "https://example.test/api",
  storeId: "store_123",
  getToken: async () => "tok",
  fetchImpl,
  ...extra,
});

test("create() refuses missing or unsafe configuration and never touches the network", () => {
  const before = calls;
  for (const bad of [
    undefined,
    {},
    { baseUrl: "http://x.test", storeId: "abc", getToken() {} },
    { baseUrl: "https://x.test", storeId: "a b", getToken() {} },
    { baseUrl: "https://x.test", storeId: "abc" },
  ])
    assert.throws(() => M.create(bad), /not configured/i);
  assert.equal(calls, before);
});

test("a configured adapter sends the store id, the token and an idempotency key, and only to its base address", async () => {
  const s = fakeServer();
  const a = M.create(cfg(s.fetchImpl));
  await a.submitSale({
    id: "sale-1",
    createdAt: 5,
    total: 9,
    items: [{ name: "Tea" }],
    customerId: "local-only",
    staffUid: "u1",
  });
  const c = s.calls[0];
  assert.equal(c.url, "https://example.test/api/sales");
  assert.equal(c.headers["x-store-id"], "store_123");
  assert.equal(c.headers.authorization, "Bearer tok");
  assert.equal(c.headers["idempotency-key"], "sale-1");
  assert.deepEqual(Object.keys(c.body).sort(), [
    "createdAt",
    "id",
    "items",
    "total",
  ]);
  assert.ok(
    !JSON.stringify(c.body).includes("local-only"),
    "independent-business customer ids are never sent",
  );
});

test("errors are mapped: duplicate = already recorded, 5xx/429 = retry, 401/403 = auth, other 4xx = rejected", async () => {
  const run = async (status) => {
    const a = M.create(
      cfg(fakeServer({ "POST /sales": { status, json: {} } }).fetchImpl),
    );
    try {
      return await a.submitSale({ id: "s", total: 1, items: [] });
    } catch (e) {
      return e.code;
    }
  };
  assert.deepEqual(await run(409), { duplicate: true });
  assert.equal(await run(503), "retry");
  assert.equal(await run(429), "retry");
  assert.equal(await run(401), "auth");
  assert.equal(await run(403), "auth");
  assert.equal(await run(422), "rejected");
});

test("no token means no request", async () => {
  const s = fakeServer();
  const a = M.create(cfg(s.fetchImpl, { getToken: async () => "" }));
  await assert.rejects(
    () => a.getCatalogue(),
    (e) => e.code === "auth",
  );
  assert.equal(s.calls.length, 0);
});

test("status() reports disconnected with the reason instead of throwing", async () => {
  const a = M.create(
    cfg(fakeServer({ "GET /status": { status: 503, json: {} } }).fetchImpl),
  );
  const st = await a.status();
  assert.equal(st.connected, false);
  assert.match(st.reason, /busy/i);
  assert.equal(
    (await M.create(cfg(fakeServer().fetchImpl)).status()).connected,
    true,
  );
});

test("the app itself never calls create(): the POS stays disconnected", () => {
  const dir = path.join(__dirname, "../js");
  const offenders = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    if (
      /MwaketeIntegration\.create\(/.test(
        fs.readFileSync(path.join(dir, f), "utf8"),
      )
    )
      offenders.push(f);
  }
  assert.deepEqual(offenders, []);
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
    // a key / secret / token ASSIGNED a literal value (reading one from getToken() is fine)
    !/(api_?key|secret|token)\s*[:=]\s*["'`][^"'`]{6,}/i.test(
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
    ),
  );
});
