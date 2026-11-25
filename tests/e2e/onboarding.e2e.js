/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/onboarding.e2e.js
 * First-run set-up card: shows on a new install, never blocks selling, saves name/currency/edition/payments/device,
 * hides unaccepted payment methods, is not shown to existing users.
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "../..");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/json",
};
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  fs.readFile(path.join(root, p), (e, d) => {
    if (e) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      "content-type": types[path.extname(p)] || "text/plain",
    });
    res.end(d);
  });
});
let passed = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  passed++;
  console.log("  ✓ " + m);
};
const eq = (a, b, m) => {
  assert.deepEqual(a, b, m);
  passed++;
  console.log("  ✓ " + m);
};

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://localhost:" + server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !/fonts\.g|ERR_|Failed to load resource/.test(m.text())
    )
      errors.push(m.text());
  });
  page.on("dialog", (d) => d.accept());
  await page.goto(base + "/");
  await page.waitForSelector("#year");
  await page
    .waitForFunction(
      () => !document.getElementById("setupCard").classList.contains("hidden"),
      null,
      { timeout: 8000 },
    )
    .catch(() => {});

  console.log("A new install gets the set-up card, and can still sell");
  ok(
    await page.isVisible("#setupCard"),
    "the set-up card shows on a new install",
  );
  await page.evaluate(async () => {
    await POSDB.put("products", {
      id: "p1",
      name: "Tea",
      price: 4,
      stock: 9,
      sku: "T",
      updatedAt: 1,
    });
    await refresh();
  });
  await page.click('[data-add="p1"]');
  eq(
    await page.evaluate(() => cart.length),
    1,
    "selling is not blocked by the card",
  );
  await page.evaluate(async () => {
    cart = [];
    renderCart();
    await POSDB.remove("products", "p1");
    await refresh();
  });

  console.log("Validation");
  await page.click("#setupStart");
  await page.waitForSelector("#onboardPanel:not(.hidden)");
  ok(
    await page.evaluate(() => document.activeElement.name === "businessName"),
    "focus starts on the business name",
  );
  await page.click('#onboardForm button[type="submit"]');
  await page.fill('#onboardForm [name="businessName"]', "Teuea Store");
  await page.fill('#onboardForm [name="currency"]', "A1");
  await page.click('#onboardForm button[type="submit"]');
  await page.waitForTimeout(200);
  ok(
    /3-letter currency/.test(await page.innerText("#onboardError")),
    "a bad currency code is explained",
  );

  console.log("Save");
  await page.fill('#onboardForm [name="currency"]', "aud");
  await page.selectOption('#onboardForm [name="edition"]', "wholesale");
  await page.uncheck('#onboardForm [name="m_mpaisa"]');
  await page.fill('#onboardForm [name="deviceName"]', "Back office");
  await page.click('#onboardForm button[type="submit"]');
  await page.waitForTimeout(500);
  const s = await page.evaluate(async () => {
    const g = async (k) => (await POSDB.get("settings", k))?.value;
    return {
      name: await g("businessName"),
      cur: await g("currency"),
      methods: await g("payMethods"),
      device: await g("deviceName"),
      tier: await TierCore.getTier(POSDB),
    };
  });
  eq(
    [s.name, s.cur, s.device, s.tier],
    ["Teuea Store", "AUD", "Back office", "wholesale"],
    "name, currency, device and edition saved",
  );
  eq(
    s.methods,
    ["cash", "eftpos"],
    "cash is always on; EFTPOS ticked, M-PAiSA unticked",
  );
  ok(await page.isHidden("#setupCard"), "the card goes away");

  console.log("Only accepted payment methods are offered");
  await page.click('[data-view="sale"]');
  const opts = await page.evaluate(() =>
    [...document.getElementById("paymentMethod").options]
      .filter((o) => !o.disabled)
      .map((o) => o.value),
  );
  ok(
    opts.includes("cash") && opts.includes("eftpos"),
    "cash and EFTPOS are offered",
  );
  ok(
    !opts.includes("mpaisa") && !opts.includes("internet_banking"),
    "M-PAiSA and internet banking are not offered",
  );
  ok(opts.includes("account"), "wholesale on-account stays available");

  console.log("It stays away after a reload, and for existing users");
  await page.reload();
  await page.waitForSelector("#year");
  await page.waitForTimeout(600);
  ok(await page.isHidden("#setupCard"), "no card after set-up");
  await page.evaluate(async () => {
    await POSDB.remove("settings", "onboarded");
    await POSDB.remove("settings", "businessName");
    await POSDB.put("sales", {
      id: "old",
      createdAt: 1,
      paymentMethod: "cash",
      total: 1,
      items: [{ productId: "x", name: "X", unitPrice: 1, quantity: 1 }],
      syncStatus: "synced",
    });
  });
  await page.reload();
  await page.waitForSelector("#year");
  await page.waitForTimeout(600);
  ok(
    await page.isHidden("#setupCard"),
    "an install that already has sales is never nagged",
  );

  console.log("Not now");
  await page.evaluate(async () => {
    await POSDB.remove("sales", "old");
  });
  await page.reload();
  await page.waitForSelector("#year");
  await page
    .waitForFunction(
      () => !document.getElementById("setupCard").classList.contains("hidden"),
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  ok(
    await page.isVisible("#setupCard"),
    "the card is back on an empty install",
  );
  await page.click("#setupSkip");
  await page.waitForTimeout(300);
  ok(await page.isHidden("#setupCard"), "Not now hides it");
  await page.reload();
  await page.waitForSelector("#year");
  await page.waitForTimeout(600);
  ok(await page.isHidden("#setupCard"), "and it stays hidden");

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
