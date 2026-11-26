/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/backup.e2e.js
 * Backup file download, restore after the data is gone, refusal of bad files, and the support diagnostics.
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
  const ctx = await browser.newContext({
    serviceWorkers: "block",
    acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });
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

  const text = (sel) => page.innerText(sel).then((s) => s.replace(/\s+/g, " "));
  const all = (s) => page.evaluate((x) => POSDB.all(x), s);
  const toastIs = (re) =>
    page.waitForFunction(
      (s) => new RegExp(s).test(document.getElementById("toast").textContent),
      re.source,
    );

  console.log("Seed some data, including things that live only on this device");
  await page.evaluate(async () => {
    await TierCore.setTier(POSDB, "wholesale");
    await POSDB.put("products", {
      id: "p1",
      name: "Tea",
      price: 2.5,
      stock: 8,
      sku: "T",
      updatedAt: 1,
    });
    await POSDB.put("customers", {
      id: "c1",
      name: "Trade Co",
      type: "trade",
      creditLimit: 500,
      phone: "686 123",
    });
    await POSDB.put("priceLists", { id: "pl1", name: "Trade" });
    await POSDB.put("sales", {
      id: "s1",
      createdAt: Date.now(),
      currency: "AUD",
      items: [{ productId: "p1", name: "Tea", unitPrice: 2.5, quantity: 2 }],
      total: 5,
      paymentMethod: "cash",
      paymentVerified: true,
      syncStatus: "pending",
    });
    await POSDB.put("settings", { key: "businessName", value: "Corner Shop" });
    await POSDB.put("settings", { key: "deviceCode", value: "OLD1" });
    await refresh();
  });
  await page.click('[data-view="setup"]');
  ok(
    /not downloaded a backup file yet/.test(await text("#backupLast")),
    "it says no backup has been downloaded yet",
  );

  console.log("Download a backup");
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#backupDownload"),
  ]);
  ok(
    /^mwakete-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()),
    "the file is named mwakete-backup-<date>.json",
  );
  const file = await dl.path();
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  eq(
    [
      doc.app,
      doc.format,
      doc.counts.products,
      doc.counts.customers,
      doc.counts.priceLists,
      doc.counts.sales,
    ],
    ["mwakete-pos", 1, 1, 1, 1, 1],
    "it holds the products, customers, price lists and sales",
  );
  ok(
    !doc.stores.settings.some((s) => s.key === "deviceCode") &&
      doc.stores.settings.some((s) => s.key === "businessName"),
    "the device code is left out, the business name is in",
  );
  await page.waitForFunction(() =>
    /Last backup file: /.test(
      document.getElementById("backupLast").textContent,
    ),
  );
  ok(true, "the screen now shows the date of the last backup");

  console.log("Lose everything, then restore");
  await page.evaluate(async () => {
    for (const s of ["products", "customers", "priceLists", "sales"])
      for (const r of await POSDB.all(s)) await POSDB.remove(s, r.id);
    await POSDB.remove("settings", "businessName");
    await POSDB.put("settings", { key: "deviceCode", value: "NEW1" }); // a different device
  });
  eq(
    [
      (await all("products")).length,
      (await all("customers")).length,
      (await all("sales")).length,
    ],
    [0, 0, 0],
    "the data is gone",
  );
  await page.setInputFiles("#backupFile", file);
  await page.waitForSelector("#backupRestore");
  ok(
    /1 products, 1 sales, 1 customers/.test(await text("#backupPreview")) ||
      /1 products/.test(await text("#backupPreview")),
    "the preview says what the file contains",
  );
  eq((await all("products")).length, 0, "nothing is restored until confirmed");
  await Promise.all([page.waitForNavigation(), page.click("#backupRestore")]);
  await page.waitForSelector("#year");
  eq(
    (await all("products")).map((p) => p.name),
    ["Tea"],
    "the product is back",
  );
  eq(
    (await all("customers")).map((c) => [c.name, c.phone]),
    [["Trade Co", "686 123"]],
    "the customer is back, with the details that were only on the device",
  );
  eq(
    (await all("priceLists")).map((p) => p.name),
    ["Trade"],
    "the price list is back",
  );
  eq(
    (await all("sales")).map((s) => [s.id, s.syncStatus]),
    [["s1", "pending"]],
    "the sale is back and still pending, so it will sync",
  );
  eq(
    (await page.evaluate(() => POSDB.get("settings", "businessName"))).value,
    "Corner Shop",
    "the business name is back",
  );
  eq(
    (await page.evaluate(() => POSDB.get("settings", "deviceCode"))).value,
    "NEW1",
    "this device keeps its own device code (no duplicate invoice numbers)",
  );

  console.log("Bad files are refused");
  await page.click('[data-view="setup"]');
  const bad = async (name, content) => {
    await page.setInputFiles("#backupFile", {
      name,
      mimeType: "application/json",
      buffer: Buffer.from(content),
    });
  };
  await bad("a.json", "not json at all");
  await toastIs(/could not be read/);
  ok(true, "text that is not JSON is refused");
  await bad(
    "b.json",
    JSON.stringify({ app: "something-else", format: 1, stores: {} }),
  );
  await toastIs(/not a Mwakete POS backup/);
  ok(true, "another app's file is refused");
  await bad(
    "c.json",
    JSON.stringify({
      app: "mwakete-pos",
      format: 1,
      stores: {
        products: [
          { id: "good", name: "Salt", price: 1 },
          { id: "bad", name: "Pepper", price: "free" },
        ],
        passwords: [{ id: "x" }],
      },
    }),
  );
  await page.waitForSelector("#backupRestore");
  ok(
    /1 record\(s\) in the file are damaged/.test(await text("#backupPreview")),
    "a file with one damaged record warns and will skip it",
  );
  await page.click("#backupRestore").then(() => page.waitForNavigation());
  await page.waitForSelector("#year");
  eq(
    (await all("products")).map((p) => p.id).sort(),
    ["good", "p1"],
    "only the good record was added; nothing was deleted",
  );

  console.log("Diagnostics for support");
  await page.click('[data-view="setup"]');
  await page.evaluate(() =>
    setTimeout(() => {
      throw new Error("Test boom");
    }, 0),
  );
  await page.waitForTimeout(400);
  const boom = errors.findIndex((e) => /Test boom/.test(e));
  ok(boom >= 0, "(the deliberate test error happened)");
  errors.splice(boom, 1);
  await page.click("#diagBox summary");
  await page.waitForFunction(() =>
    /MWAKETE POS DIAGNOSTICS/.test(
      document.getElementById("diagText").textContent,
    ),
  );
  const dx = await text("#diagText");
  ok(
    /App version: 2026\./.test(dx) &&
      /Online: yes/.test(dx) &&
      /Business type: wholesale/.test(dx),
    "it shows the version, connection and business type",
  );
  ok(/Waiting to sync: sales 1/.test(dx), "and what is waiting to sync");
  ok(/Test boom/.test(dx), "and the recent error");
  ok(
    !/Trade Co|Corner Shop|Tea|686/.test(dx),
    "and nothing about customers, products or the business",
  );
  const href = await page.getAttribute("#diagMail", "href");
  ok(
    href.startsWith("mailto:admin@mwakete.com?subject=") &&
      /MWAKETE%20POS%20DIAGNOSTICS/.test(href),
    "the email link goes to support with the summary filled in",
  );
  await page.click("#diagCopy");
  await page.waitForTimeout(300);
  ok(
    /MWAKETE POS DIAGNOSTICS/.test(
      await page.evaluate(() => navigator.clipboard.readText()),
    ),
    "Copy puts the summary on the clipboard",
  );

  eq(errors, [], "no unexpected page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
