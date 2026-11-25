/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/trade.e2e.js
 * Wholesale paperwork: quote -> invoice at the quoted prices (once only), delivery note, customer statement with
 * oldest-first payment allocation, expired and declined quotes, and the guard against a sale that does not match the quote.
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

  const text = (sel) => page.innerText(sel).then((s) => s.replace(/\s+/g, " "));
  const all = (store) => page.evaluate((s) => POSDB.all(s), store);
  const toastIs = (re) =>
    page.waitForFunction(
      (s) => new RegExp(s).test(document.getElementById("toast").textContent),
      re.source,
    );
  const setTier = (t) =>
    page.evaluate(async (x) => {
      await TierCore.setTier(POSDB, x);
      await TierUI.apply();
    }, t);
  const closeModal = async () => {
    if (await page.locator("#receiptPanel:not(.hidden)").count())
      await page.click("#receiptClose");
  };

  console.log("Quotes need Wholesale");
  await setTier("retail");
  ok(await page.isHidden('[data-view="quotes"]'), "no Quotes tab on Retail");
  await setTier("wholesale");
  await page.evaluate(async () => {
    await POSDB.put("customers", {
      id: "c1",
      name: "Trade Co",
      type: "trade",
      creditLimit: 5000,
    });
    await POSDB.put("products", {
      id: "a",
      name: "Rice 25kg",
      price: 40,
      stock: 20,
      sku: "R",
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "b",
      name: "Salt",
      price: 5,
      stock: 50,
      sku: "S",
      taxExempt: true,
      updatedAt: 1,
    });
    await refresh();
  });
  ok(
    await page.isVisible('[data-view="quotes"]'),
    "Quotes tab shows on Wholesale",
  );

  console.log("Write a quote");
  await page.click('[data-view="quotes"]');
  await page.selectOption("#quoteCustomer", "c1");
  await page.selectOption("#quoteProduct", "a");
  eq(
    await page.inputValue("#quotePrice"),
    "40",
    "the price starts at the product's price",
  );
  await page.fill("#quoteQty", "3");
  await page.fill("#quotePrice", "30");
  await page.click("#quoteAddLine");
  await page.selectOption("#quoteProduct", "b");
  await page.fill("#quoteQty", "2");
  await page.click("#quoteAddLine");
  await page.waitForFunction(() =>
    /111\.25/.test(document.getElementById("quoteTotal").textContent),
  );
  ok(
    /111\.25/.test(await text("#quoteTotal")) &&
      /tax 11\.25/.test(await text("#quoteTotal")),
    "total 111.25: tax only on the taxable rice (90.00 x 12.5%)",
  );
  await page.selectOption("#quoteProduct", "a");
  await page.fill("#quoteQty", "1");
  await page.fill("#quotePrice", "30");
  await page.click("#quoteAddLine");
  await toastIs(/twice/);
  ok(true, "the same product twice is refused");
  await page.fill('#quoteForm [name="note"]', "Delivery to Betio");
  await page.click('#quoteForm button[type="submit"]');
  await page.waitForSelector("#quoteList [data-quote-id]");
  let quotes = await all("quotes");
  eq(
    [
      quotes.length,
      quotes[0].status,
      quotes[0].total,
      quotes[0].customerId,
      quotes[0].syncStatus,
    ],
    [1, "open", 111.25, "c1", "pending"],
    "an open pending quote was saved",
  );
  ok(/^QT-[A-Z0-9]{4}-0001$/.test(quotes[0].number), "with a number");
  await page.click('[data-quote-act="view"]');
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  ok(
    /QUOTE QT-/.test(await text("#receiptBody")) &&
      /3 x 30\.00\s*90\.00/.test(await text("#receiptBody")) &&
      /not an invoice/.test(await text("#receiptBody")),
    "the quote can be viewed",
  );
  await closeModal();

  console.log(
    "Make invoice: loads the till at the quoted prices, invoice made once",
  );
  await page.click('[data-quote-act="invoice"]');
  await page.waitForSelector("#view-sale:not(.hidden)");
  eq(
    await page.inputValue("#paymentMethod"),
    "account",
    "payment is set to on account",
  );
  eq(await page.inputValue("#saleCustomer"), "c1", "the customer is selected");
  ok(
    /30\.00 × 3/.test(await text("#cartItems")),
    "the cart has the quoted price, not the shelf price of 40.00",
  );
  await page.click("#checkout");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  const sales = await all("sales");
  eq(
    [sales.length, sales[0].invoice.total, sales[0].invoice.mode, sales[0].tax],
    [1, 111.25, "account", 11.25],
    "a tax invoice of 111.25 on account was made",
  );
  ok(
    await page.isVisible("#receiptDelivery"),
    "the invoice receipt offers a delivery note",
  );
  await page.click("#receiptDelivery");
  await page.waitForFunction(() =>
    /DELIVERY NOTE/.test(document.getElementById("receiptBody").textContent),
  );
  const dn = await text("#receiptBody");
  ok(
    /DELIVERY NOTE/.test(dn) &&
      /Rice 25kg\s*x 3/.test(dn) &&
      /Salt\s*x 2/.test(dn) &&
      /Signature/.test(dn) &&
      !/111\.25|30\.00/.test(dn),
    "the delivery note lists goods, a signature box and no prices: " + dn,
  );
  ok(
    await page.isHidden("#receiptDelivery"),
    "a delivery note has no delivery-note button",
  );
  await closeModal();
  quotes = await all("quotes");
  eq(
    [quotes[0].status, quotes[0].convertedSaleId, quotes[0].syncStatus],
    ["converted", sales[0].id, "pending"],
    "the quote is now converted and linked to that invoice",
  );
  await page.click('[data-view="quotes"]');
  ok(
    /Made into an invoice/.test(await text("#quoteList")) &&
      (await page.locator('[data-quote-act="invoice"]').count()) === 0,
    "it cannot be made into a second invoice",
  );

  console.log("Statement and payment allocation");
  await page.evaluate(async () => {
    await POSDB.put("payments", {
      id: "pay1",
      customerId: "c1",
      customerName: "Trade Co",
      amount: 50,
      method: "cash",
      createdAt: Date.now() + 1000,
      syncStatus: "pending",
    });
    await POSDB.put("refunds", {
      id: "cn1",
      number: "CN-TEST-0001",
      saleId: "x",
      customerId: "c1",
      method: "account",
      total: 20,
      items: [],
      createdAt: Date.now() + 2000,
      syncStatus: "pending",
    });
    await InvoiceUI.render();
  });
  await page.click('[data-view="accounts"]');
  await page.click('[data-statement="c1"]');
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  const st = await text("#receiptBody");
  ok(
    /STATEMENT OF ACCOUNT/.test(st) && /Customer: Trade Co/.test(st),
    "the statement opens",
  );
  ok(
    /Invoice/.test(st) && /Payment/.test(st) && /Credit note/.test(st),
    "it lists the invoice, the payment and the credit note",
  );
  ok(
    /BALANCE DUE\s*41\.25/.test(st),
    "balance due is 111.25 - 50.00 - 20.00 = 41.25",
  );
  ok(
    /Unpaid invoices \(oldest first\)/.test(st) &&
      /INV-[A-Z0-9]+-\d+\s*41\.25/.test(st),
    "the unpaid part is matched to the invoice",
  );
  ok(/not yet confirmed/.test(st), "unconfirmed records are flagged");
  await closeModal();

  console.log("Expired, declined and mismatching quotes");
  await page.evaluate(async () => {
    await POSDB.put("quotes", {
      id: "old",
      number: "QT-TEST-0099",
      customerName: "Trade Co",
      customerId: "c1",
      status: "open",
      items: [
        { productId: "a", name: "Rice 25kg", unitPrice: 30, quantity: 1 },
      ],
      subtotal: 30,
      tax: 3.75,
      total: 33.75,
      createdAt: 1000,
      updatedAt: 1000,
      validUntil: 2000,
      syncStatus: "synced",
    });
    await QuotesUI.render();
  });
  await page.click('[data-view="quotes"]');
  const oldRow = page.locator('[data-quote-id="old"]');
  ok(
    /Expired/.test(await oldRow.innerText()) &&
      (await oldRow.locator('[data-quote-act="invoice"]').count()) === 0,
    "an open quote past its date shows as expired and cannot be made into an invoice",
  );

  await page.selectOption("#quoteCustomer", "c1");
  await page.selectOption("#quoteProduct", "a");
  await page.fill("#quoteQty", "2");
  await page.fill("#quotePrice", "35");
  await page.click("#quoteAddLine");
  await page.click('#quoteForm button[type="submit"]');
  await page.waitForFunction(
    () => document.querySelectorAll("#quoteList [data-quote-id]").length === 3,
  );
  const newest = page
    .locator('#quoteList [data-quote-id]:has-text("QT-"):has-text("Open")')
    .first();
  await newest.locator('[data-quote-act="invoice"]').click();
  await page.waitForSelector("#view-sale:not(.hidden)");
  await page.click("#checkout"); // sells exactly the quoted goods? No: first change the cart so it no longer matches.
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  await closeModal();
  eq(
    (await all("quotes")).filter((q) => q.status === "converted").length,
    2,
    "a second matching sale converts the second quote",
  );

  await page.click('[data-view="quotes"]');
  await page.selectOption("#quoteCustomer", "c1");
  await page.selectOption("#quoteProduct", "b");
  await page.fill("#quoteQty", "4");
  await page.click("#quoteAddLine");
  await page.click('#quoteForm button[type="submit"]');
  await page.waitForFunction(
    () => document.querySelectorAll("#quoteList [data-quote-id]").length === 4,
  );
  await page
    .locator(
      '#quoteList [data-quote-id]:has-text("Open") [data-quote-act="invoice"]',
    )
    .first()
    .click();
  await page.waitForSelector("#view-sale:not(.hidden)");
  await page.click("#productGrid [data-add]"); // the person adds something else to the till
  await page.click("#checkout");
  await toastIs(/does not match the quote/);
  ok(true, "a sale that does not match the quote leaves the quote open");
  await closeModal();
  const stillOpen = (await all("quotes")).filter(
    (q) =>
      q.status === "open" &&
      !q.validUntil === false &&
      q.number !== "QT-TEST-0099",
  );
  ok(stillOpen.length === 1, "exactly one open quote remains");

  await page.click('[data-view="quotes"]');
  await page
    .locator(
      '#quoteList [data-quote-id]:has-text("Open") [data-quote-act="decline"]',
    )
    .first()
    .click();
  await page.waitForFunction(() =>
    /Declined/.test(document.getElementById("quoteList").textContent),
  );
  ok(true, "an open quote can be declined");
  ok(
    (await page
      .locator(
        '#quoteList [data-quote-id]:has-text("Declined") [data-quote-act="invoice"]',
      )
      .count()) === 0,
    "and then cannot be invoiced",
  );

  console.log("Back to Retail: paperwork hidden, data kept");
  await setTier("retail");
  ok(await page.isHidden('[data-view="quotes"]'), "Quotes tab hidden again");
  eq((await all("quotes")).length, 4, "all quotes are kept");

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
