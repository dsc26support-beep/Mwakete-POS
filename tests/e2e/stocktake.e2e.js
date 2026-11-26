/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/stocktake.e2e.js
 * Stock take (count the whole shop) and the full history of one product's stock.
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
  const ctx = await browser.newContext({
    serviceWorkers: "block",
    acceptDownloads: true,
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
  await page.evaluate(async () => {
    await TierCore.setTier(POSDB, "retail");
    await TierUI.apply();
    await POSDB.put("products", {
      id: "p1",
      name: "Tea",
      price: 5,
      stock: 10,
      sku: "T",
      costPrice: 2,
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "p2",
      name: "Rice",
      price: 8,
      stock: 5,
      sku: "R",
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "p3",
      name: "Salt",
      price: 1,
      stock: 3,
      sku: "S",
      updatedAt: 1,
    });
    await refresh();
  });
  const stock = (id) =>
    page.evaluate((i) => POSDB.get("products", i).then((p) => p.stock), id);

  // a sale of 2 Tea first, so the history has a sale in it
  await page.click('[data-view="sale"]');
  await page.click('[data-add="p1"]');
  await page.click('[data-add="p1"]');
  await page.click("#checkout");
  await page.waitForTimeout(400);
  if (await page.locator("#receiptPanel:not(.hidden)").count())
    await page.click("#receiptClose");
  eq(await stock("p1"), 8, "the sale took 2 Tea off the shelf");

  console.log("Stock take");
  await page.click('[data-view="stock"]');
  eq(
    await page.locator("#takeTable input").count(),
    3,
    "every product has a count box",
  );
  await page.fill('[data-take="p1"]', "6");
  await page.fill('[data-take="p2"]', "5");
  await page.fill('[data-take="p3"]', "-1");
  await page.click("#takeCheck");
  ok(
    /not whole numbers/.test(await page.innerText("#takeSummary")),
    "a bad count is flagged",
  );
  await page.fill('[data-take="p3"]', "");
  await page.click("#takeCheck");
  ok(
    /1 product\(s\) differ: short 2, over 0, worth -4\.00 at cost/.test(
      await page.innerText("#takeSummary"),
    ),
    "short 2, worth -4.00 at cost",
  );
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#takeCsv"),
  ]);
  const csv = fs
    .readFileSync(await dl.path(), "utf8")
    .replace(/^﻿/, "")
    .trim()
    .split("\r\n");
  ok(
    csv.includes("Tea,8,6,-2,-4.00") && csv.includes("Rice,5,5,0,"),
    "the CSV has the differences (negative numbers stay numbers)",
  );
  await page.click("#takeApply");
  await page.waitForTimeout(600);
  eq(
    [await stock("p1"), await stock("p2"), await stock("p3")],
    [6, 5, 3],
    "only the product that differed changed",
  );
  const moves = await page.evaluate(() => POSDB.all("stockMoves"));
  eq(moves.length, 1, "one stock-count movement was recorded");
  eq(
    [moves[0].reason, moves[0].delta],
    ["count", -2],
    "reason count, change -2",
  );
  ok(
    /^[A-Z0-9]{4}$/.test(moves[0].deviceId || ""),
    "the movement carries the device code",
  );
  ok(/Stock take/.test(moves[0].note), "and a 'Stock take' note");

  console.log("History of one product");
  await page.selectOption("#stockProduct", "p1");
  await page.waitForTimeout(300);
  const h = await page.innerText("#productHistoryList");
  ok(/Stock count/.test(h) && /-2/.test(h), "the count is in the history");
  ok(/Sold/.test(h), "and the sale");
  ok(
    (await page.locator("#productHistoryList .sale-row").count()) === 2,
    "two events: count and sale",
  );
  await page.selectOption("#stockProduct", "p3");
  await page.waitForTimeout(300);
  ok(
    /Nothing recorded/.test(await page.innerText("#productHistoryList")),
    "a product with no changes says so",
  );

  console.log("Nothing differs");
  await page.fill('[data-take="p2"]', "5");
  await page.click("#takeApply");
  await page.waitForTimeout(300);
  ok(
    /Nothing to change|Enter at least one count|match/.test(
      await page.innerText("#toast"),
    ),
    "equal counts change nothing",
  );
  eq(
    (await page.evaluate(() => POSDB.all("stockMoves"))).length,
    1,
    "no extra movement",
  );

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
