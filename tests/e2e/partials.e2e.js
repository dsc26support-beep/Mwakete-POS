/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/partials.e2e.js
 * Customer purchase history, second barcode, below-cost warning, stock report, cancel / correct a sale.
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
  const dialogs = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !/fonts\.g|ERR_|Failed to load resource/.test(m.text())
    )
      errors.push(m.text());
  });
  let answer = true;
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    answer ? d.accept() : d.dismiss();
  });
  await page.goto(base + "/");
  await page.waitForSelector("#year");
  await page.evaluate(async () => {
    await TierCore.setTier(POSDB, "retail");
    await TierUI.apply();
    await POSDB.put("customers", {
      id: "c1",
      name: "Teuea",
      phone: "",
      notes: "",
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "p1",
      name: "Tea",
      price: 5,
      stock: 20,
      sku: "T1",
      barcode: "ALT-777",
      costPrice: 2,
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "p2",
      name: "Rice",
      price: 8,
      stock: 5,
      sku: "R1",
      updatedAt: 1,
    });
    await refresh();
  });
  const settle = async (ms = 350) => {
    await page.waitForTimeout(ms);
    if (await page.locator("#receiptPanel:not(.hidden)").count())
      await page.click("#receiptClose");
  };
  const sellTea = async (qty = 1) => {
    await page.click('[data-view="sale"]');
    for (let i = 0; i < qty; i++) await page.click('[data-add="p1"]');
    await page.selectOption("#saleCustomer", "c1");
    await page.click("#checkout");
    await settle();
  };

  console.log("Second barcode");
  await page.click('[data-view="sale"]');
  await page.fill("#productSearch", "ALT-777");
  await page.press("#productSearch", "Enter");
  await page.waitForTimeout(300);
  eq(
    await page.evaluate(() => cart.length),
    1,
    "the second barcode adds the product",
  );
  await page.evaluate(() => {
    cart = [];
    renderCart();
  });

  console.log("Customer purchase history");
  await sellTea(2);
  await sellTea(1);
  await page.click('[data-view="customers"]');
  await page.click('[data-history="c1"]');
  await page.waitForSelector("#txnPanel:not(.hidden)");
  const hist = await page.innerText("#txnBody");
  ok(
    /2\s+sale\(s\), total\s+15\.00/.test(hist),
    "2 sales, total 15.00 (10 + 5)",
  );
  ok(
    (await page.locator("#txnBody li").count()) === 2,
    "both sales are listed",
  );
  ok(
    await page.isHidden("#txnSend"),
    "no 'send receipt' button on a customer's list",
  );
  await page.click("#txnClose");

  console.log("Selling below cost needs a second look");
  await page.click('[data-view="products"]');
  await page.click('[data-edit="p1"]');
  await page.fill('#productEditForm [name="price"]', "1.5");
  answer = false;
  const before = dialogs.length;
  await page.click('#productEditForm button[type="submit"]');
  await page.waitForTimeout(300);
  ok(
    dialogs.length === before + 1 &&
      /below the cost 2\.00/.test(dialogs.at(-1)),
    "a price under the cost asks first",
  );
  eq(
    (await page.evaluate(() => POSDB.get("products", "p1"))).price,
    5,
    "No keeps the old price",
  );
  answer = true;
  await page.click('#productEditForm button[type="submit"]');
  await page.waitForTimeout(300);
  eq(
    (await page.evaluate(() => POSDB.get("products", "p1"))).price,
    1.5,
    "Yes saves it",
  );
  await page.click('[data-edit="p1"]');
  await page.fill('#productEditForm [name="price"]', "5");
  await page.click('#productEditForm button[type="submit"]');
  await page.waitForTimeout(300);

  console.log("Stock report");
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#stockReportCsv"),
  ]);
  const csv = fs.readFileSync(await dl.path(), "utf8").replace(/^﻿/, "");
  const lines = csv.trim().split("\r\n");
  ok(
    lines[0].startsWith(
      "name,sku,category,unit,stock,status,price,cost,value at price,value at cost",
    ),
    "header row",
  );
  ok(
    lines.some(
      (l) =>
        l.startsWith("Rice,R1,") && l.includes(",5,Available,8.00,,40.00,"),
    ),
    "a product without cost leaves the cost columns blank",
  );
  ok(lines.at(-1).startsWith("TOTAL,"), "totals row");
  ok(await page.isVisible("#stockReportPrint"), "a print button is there too");

  console.log("Cancel a sale (full refund)");
  await page.click('[data-view="sales"]');
  await page.click("[data-txn]");
  ok(
    (await page.isVisible("#txnCancelSale")) &&
      (await page.isVisible("#txnCorrect")),
    "cancel and correct are offered",
  );
  await page.click("#txnCancelSale");
  await page.waitForSelector("#refundPanel:not(.hidden)");
  const qtys = await page.evaluate(() =>
    [...document.querySelectorAll("#refundLines [data-line]")].map((i) => [
      i.value,
      i.max,
    ]),
  );
  ok(
    qtys.length > 0 && qtys.every(([v, m]) => v === m),
    "every item is ticked for return",
  );
  ok(
    /Sale cancelled/.test(await page.inputValue('#refundForm [name="reason"]')),
    "the reason is filled in",
  );
  await page.click("#refundConfirm");
  await settle(600);
  eq(
    (await page.evaluate(() => POSDB.all("refunds"))).length,
    1,
    "one credit note was made",
  );

  console.log("Correct a sale: refund, then the items come back to the cart");
  await page.evaluate(() => {
    cart = [];
    renderCart();
  });
  await page.click('[data-view="sales"]');
  await page.locator("[data-txn]").nth(1).click(); // the newest sale is already cancelled; take the one before it
  await page.waitForSelector("#txnPanel:not(.hidden)");
  await page.click("#txnCorrect");
  await page.waitForSelector("#refundPanel:not(.hidden)");
  await page.click("#refundConfirm");
  await page.waitForTimeout(700);
  eq(
    (await page.evaluate(() => POSDB.all("refunds"))).length,
    2,
    "a second credit note was made",
  );
  ok(await page.isVisible("#view-sale"), "the till opens");
  ok(
    (await page.evaluate(() => cart.length)) >= 1,
    "the original items are back in the cart",
  );
  ok(
    /original items are in the cart/.test(await page.innerText("#toast")),
    "the cashier is told what to do next",
  );

  console.log("Cash rounding to 5 cents");
  await settle(100); // the credit note viewer from the step above may still be open
  await page.evaluate(async () => {
    cart = [];
    renderCart();
    await POSDB.put("products", {
      id: "p9",
      name: "Odd price",
      price: 10.03,
      stock: 9,
      sku: "O9",
      updatedAt: 1,
    });
    await POSDB.put("settings", { key: "cashRounding", value: 0.05 });
    await CheckoutUI.loadRounding();
    await refresh();
  });
  await page.click('[data-view="sale"]');
  await page.click('[data-add="p9"]');
  await page.selectOption("#saleCustomer", "");
  await page.fill("#cashTendered", "20");
  ok(
    /Change due: 9\.95/.test(await page.innerText("#changeDue")),
    "the change is worked out from the rounded amount (20.00 - 10.05)",
  );
  await page.fill("#cashTendered", "");
  ok(
    /Cash due 10\.05 \(rounded from 10\.03\)/.test(
      await page.innerText("#changeDue"),
    ),
    "exact cash shows the rounded amount",
  );
  await page.fill("#cashTendered", "20");
  await page.click("#checkout");
  await settle(500);
  const rs = (await page.evaluate(() => POSDB.all("sales"))).find((s) =>
    s.items.some((i) => i.productId === "p9"),
  );
  eq(
    [rs.total, rs.rounding, rs.payments[0].amount, rs.change],
    [10.03, 0.02, 10.05, 9.95],
    "the sale keeps its real total, the rounding and the cash taken",
  );
  await page.click('[data-view="sales"]');
  await page.locator(`[data-txn="${rs.id}"]`).click();
  ok(
    /Record checks passed/.test(await page.innerText("#txnBody")),
    "the record check accepts the recorded rounding",
  );
  await page.click("#txnClose");
  await page.evaluate(async () => {
    await POSDB.put("settings", { key: "cashRounding", value: 0 });
    await CheckoutUI.loadRounding();
  });

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
