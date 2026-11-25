/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/refunds.e2e.js
 * Refunds and credit notes, local-only: partial and final refund, stock back on the shelf, credit note viewer,
 * a refund can never exceed the sale, an invoice on account is credited to the customer's account, Counter hides it all.
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

  const setup = (tier) =>
    page.evaluate(async (t) => {
      await TierCore.setTier(POSDB, t);
      await TierUI.apply();
    }, tier);
  const seed = () =>
    page.evaluate(async () => {
      await POSDB.put("products", {
        id: "p1",
        name: "Tea",
        price: 10,
        stock: 3,
        sku: "T",
        updatedAt: 1,
      });
      await POSDB.put("products", {
        id: "p2",
        name: "Jam",
        price: 5,
        stock: 4,
        sku: "J",
        updatedAt: 1,
      });
      await POSDB.put("sales", {
        id: "sale-one-aaaaaaaa",
        createdAt: Date.now() - 1000,
        currency: "AUD",
        tier: "retail",
        items: [
          { productId: "p1", name: "Tea", unitPrice: 10, quantity: 1 },
          { productId: "p2", name: "Jam", unitPrice: 5, quantity: 2 },
        ],
        subtotal: 20,
        discount: { type: "percent", value: 10, amount: 2 },
        total: 18,
        paymentMethod: "cash",
        paymentVerified: true,
        syncStatus: "synced",
      });
      await refresh();
    });
  const stock = (id) =>
    page.evaluate((i) => POSDB.get("products", i).then((p) => p.stock), id);
  const refunds = () => page.evaluate(() => POSDB.all("refunds"));
  const openRefund = async (saleId) => {
    await page.click('[data-view="sales"]');
    await page.click('.sale-row[data-sale-id="' + saleId + '"]');
    await page.waitForSelector("#receiptPanel:not(.hidden)");
    await page.click("#receiptRefund");
  };

  console.log("Retail: partial refund");
  await setup("retail");
  await seed();
  await openRefund("sale-one-aaaaaaaa");
  await page.waitForSelector("#refundPanel:not(.hidden)");
  eq(
    await page.locator("#refundLines [data-line]").count(),
    2,
    "both items can be returned",
  );
  ok(
    await page.isDisabled("#refundConfirm"),
    "Record refund is disabled until something is chosen",
  );
  await page.fill('#refundLines [data-line="0"]', "1");
  ok(
    /9\.00/.test(await page.textContent("#refundTotal")),
    "the preview shows the discounted share (9.00)",
  );
  await page.fill('#refundLines [data-line="1"]', "3");
  ok(
    /Only 2 of Jam/.test(await page.textContent("#refundTotal")),
    "returning more than was sold is refused with a reason",
  );
  ok(await page.isDisabled("#refundConfirm"), "and cannot be submitted");
  await page.fill('#refundLines [data-line="1"]', "0");
  await page.fill('#refundForm [name="reason"]', "Too strong");
  await page.click("#refundConfirm");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  const note = await page.textContent("#receiptBody");
  ok(
    /CREDIT NOTE CN-[A-Z0-9]+-0001/.test(note) &&
      /TOTAL REFUNDED/.test(note) &&
      /Too strong/.test(note),
    "the credit note is shown",
  );
  ok(
    await page.isHidden("#receiptRefund"),
    "no Refund button on a credit note",
  );
  let rs = await refunds();
  eq(
    [rs.length, rs[0].total, rs[0].method, rs[0].syncStatus],
    [1, 9, "cash", "pending"],
    "one pending cash refund of 9.00 was saved",
  );
  eq(await stock("p1"), 4, "the returned tea is back in stock");
  await page.click("#receiptClose");
  ok(
    /refunded 9\.00/.test(await page.textContent("#salesList")),
    "the sale shows it was partly refunded",
  );
  ok(
    /CN-/.test(await page.textContent("#refundsList")),
    "the credit note is listed",
  );

  console.log("Refund the rest, then nothing is left");
  await openRefund("sale-one-aaaaaaaa");
  await page.waitForSelector("#refundPanel:not(.hidden)");
  eq(
    await page.locator("#refundLines [data-line]").count(),
    1,
    "only the jam is left to return",
  );
  await page.fill('#refundLines [data-line="1"]', "2");
  await page.uncheck('#refundForm [name="restock"]');
  ok(
    /9\.00/.test(await page.textContent("#refundTotal")),
    "the rest is exactly 9.00 (no rounding drift)",
  );
  await page.click("#refundConfirm");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  await page.click("#receiptClose");
  rs = await refunds();
  eq(
    rs.reduce((n, r) => n + Math.round(r.total * 100), 0),
    1800,
    "the refunds add up to exactly the sale total",
  );
  eq(
    await stock("p2"),
    4,
    "jam was not restocked because the box was unticked",
  );
  await openRefund("sale-one-aaaaaaaa");
  await page.waitForTimeout(300);
  ok(
    await page.isHidden("#refundPanel"),
    "a fully refunded sale cannot be refunded again",
  );
  await page.click("#receiptClose").catch(() => {});

  console.log("Credit notes can be reopened");
  await page.click('[data-view="sales"]');
  await page.click("#refundsList [data-refund-id]");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  ok(
    /CREDIT NOTE/.test(await page.textContent("#receiptBody")),
    "clicking a credit note opens it",
  );
  await page.click("#receiptClose");

  console.log(
    "Wholesale: an invoice on account is credited to the customer's account",
  );
  await setup("wholesale");
  await page.evaluate(async () => {
    await POSDB.put("customers", {
      id: "c1",
      name: "Trade Co",
      type: "trade",
      creditLimit: 1000,
    });
    await POSDB.put("sales", {
      id: "invoice-one-bbbbbbb",
      createdAt: Date.now(),
      currency: "AUD",
      tier: "wholesale",
      customerId: "c1",
      items: [{ productId: "p1", name: "Widget", unitPrice: 50, quantity: 2 }],
      subtotal: 100,
      tax: 12.5,
      total: 112.5,
      paymentMethod: "account",
      paymentVerified: false,
      syncStatus: "pending",
      invoice: {
        number: "INV-TEST-0001",
        mode: "account",
        taxRate: 12.5,
        taxableNet: 100,
        tax: 12.5,
        total: 112.5,
        customerName: "Trade Co",
      },
    });
    await refresh();
  });
  await openRefund("invoice-one-bbbbbbb");
  await page.waitForSelector("#refundPanel:not(.hidden)");
  eq(
    await page.locator("#refundMethod option").allTextContents(),
    ["Credit the customer's account"],
    "only account credit is offered",
  );
  await page.fill('#refundLines [data-line="0"]', "1");
  ok(
    /56\.25/.test(await page.textContent("#refundTotal")) &&
      /tax 6\.25/.test(await page.textContent("#refundTotal")),
    "half the invoice, with half the tax",
  );
  await page.click("#refundConfirm");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  ok(
    /For invoice: INV-TEST-0001/.test(await page.textContent("#receiptBody")) &&
      /Credited to account/.test(await page.textContent("#receiptBody")),
    "the credit note names the invoice",
  );
  await page.click("#receiptClose");
  const pending = await page.evaluate(async () =>
    InvoiceCore.pendingBalance(
      await POSDB.all("sales"),
      await POSDB.all("payments"),
      "c1",
      await POSDB.all("refunds"),
    ),
  );
  eq(
    pending,
    56.25,
    "the customer's pending balance dropped from 112.50 to 56.25",
  );

  console.log("Counter hides refunds");
  await setup("counter");
  ok(await page.isHidden("#receiptRefund"), "no Refund button");
  ok(await page.isHidden("#refundsList"), "no credit notes list");

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
