const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../js/guides.js");

function fakeStore() {
  const rows = new Map();
  return {
    async get(store, key) {
      assert.equal(store, "settings");
      return rows.get(key);
    },
    async put(store, value) {
      assert.equal(store, "settings");
      rows.set(value.key, structuredClone(value));
      return value;
    },
    rows,
  };
}

test("valid report is saved locally with status 'saved' (never 'sent')", async () => {
  const s = fakeStore();
  const r = await G.addReport(
    s,
    { category: "sync", message: "  Sync keeps failing  ", guideId: "g-sync" },
    "r1",
    1000,
  );
  assert.equal(r.ok, true);
  assert.equal(r.item.status, "saved");
  assert.equal(r.item.message, "Sync keeps failing");
  assert.equal(r.item.guideId, "g-sync");
  assert.deepEqual(
    (await G.listReports(s)).map((x) => x.id),
    ["r1"],
  );
});

test("invalid reports are rejected and not stored", async () => {
  const s = fakeStore();
  for (const input of [
    { category: "", message: "something broke" },
    { category: "nope", message: "something broke" },
    { category: "app", message: "  " },
    { category: "app", message: "abc" },
    { category: "app", message: "x".repeat(1001) },
    undefined,
  ])
    assert.equal((await G.addReport(s, input, "id")).ok, false);
  assert.equal((await G.listReports(s)).length, 0);
});

test("unknown guide ids are dropped", async () => {
  const s = fakeStore();
  const r = await G.addReport(
    s,
    { category: "guide", message: "unclear step", guideId: "<script>" },
    "r1",
  );
  assert.equal(r.item.guideId, "");
});

test("report count is capped and reports can be removed", async () => {
  const s = fakeStore();
  for (let i = 0; i < G.LIMITS.reports; i++)
    assert.equal(
      (
        await G.addReport(
          s,
          { category: "app", message: "problem " + i },
          "id" + i,
        )
      ).ok,
      true,
    );
  assert.equal(
    (await G.addReport(s, { category: "app", message: "one too many" }, "x"))
      .ok,
    false,
  );
  assert.equal(await G.removeReport(s, "id0"), true);
  assert.equal(await G.removeReport(s, "missing"), false);
  assert.equal((await G.listReports(s)).length, G.LIMITS.reports - 1);
});

test("report text includes diagnostics only when provided, and only allow-listed keys", () => {
  const report = {
    category: "app",
    message: "It crashed",
    guideId: "",
    createdAt: 0,
  };
  const plain = G.buildReportText(report, null);
  assert.match(plain, /It crashed/);
  assert.ok(!plain.includes("Diagnostics"));
  const withDiag = G.buildReportText(report, {
    online: false,
    userAgent: "UA",
    salesTotal: 999,
    apiUrl: "https://secret",
  });
  assert.match(withDiag, /online: false/);
  assert.match(withDiag, /userAgent: UA/);
  assert.ok(!withDiag.includes("999") && !withDiag.includes("secret"));
});

test("mailto link is only built for a valid configured address", () => {
  const report = {
    category: "app",
    message: "Hello & goodbye",
    guideId: "",
    createdAt: 0,
  };
  assert.equal(G.mailtoUrl("", report), "");
  assert.equal(G.mailtoUrl("not-an-email", report), "");
  assert.equal(G.mailtoUrl("a@b.com,c@d.com", report), "");
  const url = G.mailtoUrl("help@example.com", report);
  assert.ok(url.startsWith("mailto:help@example.com?subject="));
  assert.ok(url.includes(encodeURIComponent("Hello & goodbye")));
});

test("no support email is shipped until one is verified", () => {
  assert.equal(G.SUPPORT_EMAIL, "");
});

test("report rows escape text and state clearly that nothing was sent", () => {
  const evil = `<img src=x onerror=alert(1)>`;
  const html = G.reportRow(
    { id: `"><b>`, category: "app", message: evil, guideId: "", createdAt: 0 },
    false,
  );
  assert.ok(!html.includes("<img") && !html.includes('<b>"'));
  assert.match(html, /Not sent/);
  assert.ok(!html.includes("data-email-report"));
  assert.ok(
    G.reportRow(
      { id: "1", category: "app", message: "m", createdAt: 0 },
      true,
    ).includes("data-email-report"),
  );
});

test("reports use their own settings key only", async () => {
  const s = fakeStore();
  await G.addReport(s, { category: "app", message: "something odd" }, "r");
  assert.deepEqual([...s.rows.keys()], [G.KEYS.reports]);
});
