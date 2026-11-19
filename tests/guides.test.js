const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../js/guides.js");

// Minimal in-memory stand-in for POSDB (same get/put interface, "settings" store only).
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

test("official guides are well-formed and unique", () => {
  const ids = new Set();
  for (const g of G.OFFICIAL_GUIDES) {
    assert.ok(!ids.has(g.id), "duplicate id " + g.id);
    ids.add(g.id);
    assert.ok(
      G.CATEGORIES.some((c) => c.id === g.category),
      "unknown category " + g.category,
    );
    assert.ok(g.title && g.subtitle && g.description && g.steps.length >= 3);
    assert.equal(g.source, "official");
    assert.equal(g.status, "published");
  }
  for (const c of G.CATEGORIES)
    assert.ok(
      G.OFFICIAL_GUIDES.some((g) => g.category === c.id),
      "empty category " + c.id,
    );
});

test("every official link is valid https", () => {
  for (const l of G.OFFICIAL_LINKS) assert.ok(G.normalizeUrl(l.url).ok, l.url);
});

test("normalizeUrl accepts public https and rejects unsafe values", () => {
  assert.equal(G.normalizeUrl(" https://example.com/a?b=1 ").ok, true);
  for (const bad of [
    "",
    "   ",
    "javascript:alert(1)",
    "data:text/html,hi",
    "http://example.com",
    "ftp://example.com",
    "https://user:pw@example.com",
    "https://localhost/x",
    "https://192.168.0.1/",
    "https://[::1]/",
    "https://intranet/",
    "not a url",
    "https://example.com/" + "a".repeat(2100),
  ]) {
    assert.equal(
      G.normalizeUrl(bad).ok,
      false,
      "should reject: " + bad.slice(0, 40),
    );
  }
  assert.equal(G.normalizeUrl("https://Example.COM/x").host, "example.com");
});

test("search matches titles, subtitles and descriptions, and filters by category", () => {
  const t = G.searchGuides(G.OFFICIAL_GUIDES, "first sale");
  assert.ok(t.some((g) => g.id === "g-first-sale"));
  assert.ok(
    G.searchGuides(G.OFFICIAL_GUIDES, "mobile money").some(
      (g) => g.id === "g-digital-pay",
    ),
    "description match",
  );
  assert.ok(
    G.searchGuides(G.OFFICIAL_GUIDES, "SYNCHRONISE").length > 0,
    "case-insensitive",
  );
  assert.equal(G.searchGuides(G.OFFICIAL_GUIDES, "zzzznotfound").length, 0);
  const inv = G.searchGuides(G.OFFICIAL_GUIDES, "", "inventory");
  assert.ok(inv.length && inv.every((g) => g.category === "inventory"));
  assert.equal(
    G.searchGuides(G.OFFICIAL_GUIDES, "").length,
    G.OFFICIAL_GUIDES.length,
  );
});

test("archived or draft guides never appear in search", () => {
  const list = [
    {
      id: "a",
      title: "Old",
      subtitle: "",
      description: "",
      status: "archived",
    },
    {
      id: "b",
      title: "New",
      subtitle: "",
      description: "",
      status: "published",
    },
  ];
  assert.deepEqual(
    G.searchGuides(list, "").map((g) => g.id),
    ["b"],
  );
});

test("add, list and remove business links and notes", async () => {
  const s = fakeStore();
  const a = await G.addResource(
    s,
    {
      kind: "link",
      title: "  Supplier ",
      url: "https://supplier.example/orders",
      note: "Weekly",
    },
    "r1",
    1000,
  );
  assert.equal(a.ok, true);
  assert.equal(a.item.title, "Supplier");
  assert.equal(a.item.source, "business");
  const b = await G.addResource(
    s,
    { kind: "note", title: "Opening", note: "Count the till first." },
    "r2",
  );
  assert.equal(b.ok, true);
  assert.equal((await G.listResources(s)).length, 2);
  assert.equal(await G.removeResource(s, "r1"), true);
  assert.equal(await G.removeResource(s, "missing"), false);
  assert.deepEqual(
    (await G.listResources(s)).map((r) => r.id),
    ["r2"],
  );
});

test("invalid business resources are rejected and not stored", async () => {
  const s = fakeStore();
  for (const input of [
    { kind: "link", title: "", url: "https://example.com" },
    { kind: "link", title: "x", url: "javascript:alert(1)" },
    { kind: "link", title: "x", url: "http://example.com" },
    { kind: "link", title: "x".repeat(81), url: "https://example.com" },
    { kind: "note", title: "x", note: "" },
    { kind: "note", title: "x", note: "y".repeat(501) },
  ]) {
    assert.equal((await G.addResource(s, input, "id")).ok, false);
  }
  assert.equal((await G.listResources(s)).length, 0);
});

test("business resource count is capped", async () => {
  const s = fakeStore();
  for (let i = 0; i < G.LIMITS.resources; i++)
    assert.equal(
      (
        await G.addResource(
          s,
          { kind: "note", title: "n" + i, note: "x" },
          "id" + i,
        )
      ).ok,
      true,
    );
  assert.equal(
    (await G.addResource(s, { kind: "note", title: "extra", note: "x" }, "idx"))
      .ok,
    false,
  );
});

test("bookmarks toggle and recent list is de-duplicated and capped", async () => {
  const s = fakeStore();
  assert.equal(await G.toggleBookmark(s, "g-setup"), true);
  assert.deepEqual(await G.listBookmarks(s), ["g-setup"]);
  assert.equal(await G.toggleBookmark(s, "g-setup"), false);
  assert.deepEqual(await G.listBookmarks(s), []);
  for (let i = 0; i < 12; i++) await G.recordView(s, "g" + i);
  await G.recordView(s, "g5");
  const r = await G.listRecent(s);
  assert.equal(r.length, G.LIMITS.recent);
  assert.equal(r[0], "g5");
  assert.equal(new Set(r).size, r.length);
});

test("help data does not touch POS stores (sales/products preserved)", async () => {
  const s = fakeStore();
  await G.addResource(s, { kind: "note", title: "t", note: "n" }, "r");
  await G.toggleBookmark(s, "x");
  await G.recordView(s, "x");
  assert.deepEqual(
    [...s.rows.keys()].sort(),
    [G.KEYS.bookmarks, G.KEYS.recent, G.KEYS.resources].sort(),
  );
});

test("HTML builders escape stored text (XSS)", () => {
  const evil = `<img src=x onerror=alert(1)>"'`;
  const row = G.resourceRow({
    id: 'i"><b>',
    kind: "note",
    title: evil,
    note: evil,
  });
  assert.ok(!row.includes("<img") && !row.includes("<b>"));
  const link = G.resourceRow({
    id: "1",
    kind: "link",
    title: evil,
    url: 'https://example.com/?q="><script>',
    note: evil,
  });
  assert.ok(!link.includes("<img") && !link.includes("<script"));
  assert.ok(
    G.externalLink({ title: "x", url: "javascript:alert(1)" }).includes(
      "invalid link hidden",
    ),
  );
  assert.ok(
    !G.externalLink({ title: "x", url: "javascript:alert(1)" }).includes("<a "),
  );
  assert.ok(
    !G.guideCard({ id: evil, title: evil, subtitle: evil }, false).includes(
      "<img",
    ),
  );
});

test("external links open safely and identify the destination", () => {
  const html = G.externalLink({
    title: "Drive",
    url: "https://drive.google.com/",
  });
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /data-ext="drive\.google\.com"/);
});

test("official guides do not claim unavailable features are active", () => {
  const text = JSON.stringify(G.OFFICIAL_GUIDES);
  assert.match(
    G.OFFICIAL_GUIDES.find((g) => g.id === "g-google").steps[0],
    /NOT available yet/,
  );
  assert.match(
    G.OFFICIAL_GUIDES.find((g) => g.id === "g-marketplace").steps[0],
    /NOT active/,
  );
  assert.ok(
    !/verified payment/i.test(text) || /not verified|unverified/i.test(text),
  );
});
