/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/analytics.e2e.js
 * Report by period: presets, custom dates, filters, profit estimate wording, CSV export.
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
    const day = 86400000;
    const now = Date.now();
    await POSDB.put("products", {
      id: "t",
      name: "Tea",
      price: 5,
      stock: 50,
      category: "Drinks",
      costPrice: 2,
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "r",
      name: "Rice",
      price: 4,
      stock: 50,
      category: "Food",
      updatedAt: 1,
    });
    const mk = (id, ago, pid, name, price, qty, method = "cash", extra = {}) =>
      POSDB.put("sales", {
        id,
        createdAt: now - ago * day,
        paymentMethod: method,
        paymentVerified: method === "cash",
        syncStatus: "pending",
        items: [{ productId: pid, name, unitPrice: price, quantity: qty }],
        total: price * qty,
        tier: "retail",
        ...extra,
      });
    await mk("a", 0, "t", "Tea", 5, 2);
    await mk("b", 0, "r", "Rice", 4, 3, "mpaisa");
    await mk("c", 40, "t", "Tea", 5, 10);
    await refresh();
  });
  await page.click('[data-view="reports"]');

  console.log("Presets");
  await page.selectOption("#repPeriod", "today");
  ok(
    /Gross[^\d]*22\.00/.test(
      (await page.innerText("#periodReportBody")).replace(/\s+/g, " "),
    ),
    "today: two sales, 22.00",
  );
  const ln = (await page.innerText("#periodReportBody")).replace(/\s+/g, " ");
  ok(/Sales 2/.test(ln), "today shows 2 sales");
  await page.selectOption("#repPeriod", "month");
  ok(
    /Sales [23]/.test(
      (await page.innerText("#periodReportBody")).replace(/\s+/g, " "),
    ),
    "this month still shows recent sales",
  );

  console.log("Custom dates and validation");
  await page.selectOption("#repPeriod", "custom");
  ok(await page.isVisible("#repFrom"), "date boxes appear for custom");
  ok(
    /Choose both dates/.test(await page.innerText("#repError")),
    "missing dates are explained",
  );
  await page.fill("#repFrom", "2999-02-01");
  await page.fill("#repTo", "2999-01-01");
  ok(
    /before the start/.test(await page.innerText("#repError")),
    "end before start is refused",
  );
  const d = (n) =>
    new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  await page.fill("#repFrom", d(45));
  await page.fill("#repTo", d(35));
  const txt = (await page.innerText("#periodReportBody")).replace(/\s+/g, " ");
  ok(
    /Sales 1/.test(txt) && /Gross 50\.00/.test(txt),
    "custom range finds only the old sale (50.00)",
  );

  console.log("Filters");
  await page.selectOption("#repPeriod", "week");
  await page.selectOption("#repMethod", "mpaisa");
  ok(
    /Sales 1/.test(
      (await page.innerText("#periodReportBody")).replace(/\s+/g, " "),
    ),
    "payment filter: one M-PAiSA sale",
  );
  await page.selectOption("#repMethod", "");
  await page.selectOption("#repCategory", "Food");
  ok(
    /Sales 1/.test(
      (await page.innerText("#periodReportBody")).replace(/\s+/g, " "),
    ),
    "category filter: one Food sale",
  );
  await page.selectOption("#repCategory", "");
  await page.selectOption("#repEdition", "wholesale");
  ok(
    /Sales 0/.test(
      (await page.innerText("#periodReportBody")).replace(/\s+/g, " "),
    ),
    "edition filter with no sales shows zero",
  );
  await page.selectOption("#repEdition", "");

  console.log("Profit estimate is honest");
  await page.selectOption("#repPeriod", "today");
  const body = (await page.innerText("#periodReportBody")).replace(/\s+/g, " ");
  ok(
    /Profit estimate: 6\.00/.test(body),
    "profit = 10.00 revenue - 4.00 cost for the costed product only",
  );
  ok(
    /Not counted \(no cost price\): Rice/.test(body),
    "products without a cost price are named, not guessed",
  );
  ok(/today's cost price/.test(body), "the assumption is stated");

  console.log("CSV export");
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#repCsv"),
  ]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  ok(
    /Report,Today/.test(csv) &&
      /By payment method/.test(csv) &&
      /Profit estimate,6\.00/.test(csv),
    "CSV has the summary and sections",
  );

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
