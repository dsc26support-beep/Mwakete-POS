const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const P = require("../js/pwa.js");

test("install advice by situation", () => {
  assert.equal(P.installAdvice({ standalone: true }).state, "installed");
  assert.equal(P.installAdvice({ navStandalone: true }).state, "installed");
  assert.equal(P.installAdvice({ canPrompt: true }).state, "prompt");
  assert.equal(
    P.installAdvice({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" }).state,
    "ios",
  );
  assert.equal(
    P.installAdvice({ ua: "Mozilla/5.0 (Linux; Android 13)" }).state,
    "android",
  );
  assert.equal(
    P.installAdvice({ ua: "Mozilla/5.0 (X11; Linux)" }).state,
    "browser",
  );
  assert.equal(P.installAdvice({}).state, "browser");
});

test("first service-worker takeover is not an update", () => {
  assert.equal(P.updateReady(false, true), false);
  assert.equal(P.updateReady(true, true), true);
  assert.equal(P.updateReady(true, false), false);
});

test("backlog counts waiting and refused records", () => {
  const b = P.backlog({
    sales: [
      { syncStatus: "synced" },
      { syncStatus: "pending" },
      { syncStatus: "rejected" },
      {},
    ],
    refunds: [{ syncStatus: "pending" }],
    empty: null,
  });
  assert.deepEqual(b, { waiting: 3, refused: 1 });
  assert.equal(
    P.backlogText(b, true, true),
    "3 waiting to sync, 1 refused by the cloud",
  );
  assert.equal(
    P.backlogText(b, false, true),
    "3 waiting to sync, 1 refused by the cloud (offline)",
  );
  assert.equal(
    P.backlogText({ waiting: 0, refused: 0 }, true, true),
    "Everything is synced.",
  );
  assert.equal(P.backlogText({ waiting: 0, refused: 0 }, true, false), "");
});

test("manifest is installable: PNG icons at 192 and 512, a maskable icon, scope and start_url", () => {
  const root = path.join(__dirname, "..");
  const m = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"),
  );
  assert.equal(m.display, "standalone");
  assert.ok(m.start_url && m.scope && m.id);
  const has = (size, purpose) =>
    m.icons.some(
      (i) =>
        i.sizes === size && i.type === "image/png" && i.purpose === purpose,
    );
  assert.ok(has("192x192", "any"));
  assert.ok(has("512x512", "any"));
  assert.ok(has("512x512", "maskable"));
  for (const i of m.icons)
    assert.ok(fs.existsSync(path.join(root, i.src)), i.src + " exists");
});

test("every script in index.html and every icon is in the service worker cache list", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  const scripts = [...html.matchAll(/<script src="(\.\/js\/[^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.ok(scripts.length > 20);
  for (const s of scripts)
    assert.ok(sw.includes('"' + s + '"'), s + " is cached for offline use");
  for (const f of [
    "./css/app.css",
    "./manifest.webmanifest",
    "./assets/icon.svg",
  ])
    assert.ok(sw.includes('"' + f + '"'), f + " is cached");
});
