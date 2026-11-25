/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/txn.e2e.js
 * Sales history: receipt numbers, search, filters, details dialog, CSV export, refund status.
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
    await POSDB.put("products", {
      id: "p1",
      name: "Tea",
      price: 10,
      stock: 50,
      sku: "T",
      updatedAt: 1,
    });
    await refresh();
  });
  const sell = async (method, extra) => {
    await page.click('[data-view="sale"]');
    await page.click('[data-add="p1"]');
    await page.selectOption("#paymentMethod", method);
    if (extra) await extra();
    await page.click("#checkout");
    await page.waitForTimeout(250);
  };
  await sell("cash");
  await sell("mpaisa", () => page.fill("#payRef", "MP-777"));
  await sell("cash");

  console.log("Receipt numbers");
  const all = await page.evaluate(() => POSDB.all("sales"));
  const nos = all.map((s) => s.receiptNo).sort();
  ok(
    nos.every((n) => /^R-[A-Z0-9]{4}-000[1-3]$/.test(n)),
    "every sale has R-<device>-000n",
  );
  eq(new Set(nos).size, 3, "receipt numbers are unique");

  console.log("History list, search and filters");
  await page.click('[data-view="sales"]');
  eq(
    await page.locator("#salesList .sale-row").count(),
    3,
    "three sales listed",
  );
  ok(
    /3 sale\(s\), total 30\.00/.test(await page.innerText("#txnSummary")),
    "summary shows count and total",
  );
  await page.fill("#txnText", "MP-777");
  eq(
    await page.locator("#salesList .sale-row").count(),
    1,
    "search finds the sale by payment reference",
  );
  await page.fill("#txnText", "");
  await page.selectOption("#txnMethod", "mpaisa");
  eq(
    await page.locator("#salesList .sale-row").count(),
    1,
    "payment filter works",
  );
  await page.selectOption("#txnMethod", "");
  await page.fill("#txnFrom", "2999-01-01");
  eq(
    await page.locator("#salesList .sale-row").count(),
    0,
    "a future start date shows nothing",
  );
  ok(
    /No sales match/.test(await page.innerText("#txnSummary")),
    "empty state message",
  );
  await page.fill("#txnFrom", "");

  console.log("Details dialog");
  await page.click("[data-txn]");
  await page.waitForSelector("#txnPanel:not(.hidden)");
  const body = await page.innerText("#txnBody");
  ok(
    /Completed|Sale/.test(body) && /Record checks passed/.test(body),
    "details show status and passed checks",
  );
  ok(
    /History/.test(body) && /Sale recorded/.test(body),
    "details show the timeline",
  );
  await page.click("#txnClose");

  console.log("Refund changes status");
  await page.evaluate(async () => {
    const s = (await POSDB.all("sales"))[0];
    await POSDB.put("refunds", {
      id: "r1",
      saleId: s.id,
      number: "CN-T-1",
      total: s.total,
      method: "cash",
      createdAt: Date.now(),
      items: [],
      reason: "test",
      syncStatus: "pending",
    });
    await refresh();
  });
  await page.selectOption("#txnStatus", "Fully refunded");
  eq(
    await page.locator("#salesList .sale-row").count(),
    1,
    "status filter finds the refunded sale",
  );
  await page.selectOption("#txnStatus", "");

  console.log("CSV export");
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#txnExport"),
  ]);
  const text = fs.readFileSync(await dl.path(), "utf8");
  const lines = text.replace(/^﻿/, "").trim().split("\r\n");
  eq(lines.length, 4, "header + 3 sales exported");
  ok(
    lines[0].startsWith("receipt,date,status,payment,reference"),
    "header row",
  );
  ok(
    lines.some((l) => l.includes("MP-777")),
    "payment reference is in the export",
  );
  ok(
    lines.some((l) => l.includes("Fully refunded")),
    "status is in the export",
  );

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
