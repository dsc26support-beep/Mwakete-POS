/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/controls.e2e.js
 * Sales controls: quantity discounts, minimum trade quantity, manager approval for big discounts and refunds.
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
  const sales = () => page.evaluate(() => POSDB.all("sales"));
  // wait, then close the receipt pop-up that a finished sale opens
  const settle = async (ms = 300) => {
    await page.waitForTimeout(ms);
    if (await page.locator("#receiptPanel:not(.hidden)").count())
      await page.click("#receiptClose");
  };
  await page.evaluate(async () => {
    await TierCore.setTier(POSDB, "wholesale");
    await TierUI.apply();
    await POSDB.put("products", {
      id: "p1",
      name: "Rice 1kg",
      price: 10,
      stock: 500,
      sku: "R1",
      qtyBreaks: [
        { qty: 10, pct: 5 },
        { qty: 50, pct: 10 },
      ],
      minQty: 12,
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "p2",
      name: "Tea",
      price: 100,
      stock: 50,
      sku: "T",
      updatedAt: 1,
    });
    await POSDB.put("customers", {
      id: "c1",
      name: "Trade Co",
      type: "trade",
      phone: "",
      notes: "",
      updatedAt: 1,
    });
    await refresh();
  });
  await page.click('[data-view="sale"]');

  console.log("Quantity discounts");
  await page.click('[data-add="p1"]');
  eq(await page.evaluate(() => cart[0].price), 10, "1 unit: full price");
  await page.evaluate(() => {
    cart[0].qty = 9;
    renderCart();
  });
  eq(await page.evaluate(() => cart[0].price), 10, "9 units: still full price");
  await page.click('[data-inc="p1"]');
  eq(await page.evaluate(() => cart[0].price), 9.5, "10 units: 5% off");
  ok(
    /5% quantity discount/.test(await page.innerText("#cartItems")),
    "the cart says why",
  );
  eq(await page.textContent("#total"), "95.00", "total is 10 x 9.50");
  await page.evaluate(() => {
    cart[0].qty = 50;
    renderCart();
  });
  eq(await page.evaluate(() => cart[0].price), 9, "50 units: 10% off");
  await page.click('[data-dec="p1"]');
  eq(await page.evaluate(() => cart[0].price), 9.5, "49 units: back to 5%");
  await page.evaluate(() => {
    cart[0].qty = 3;
    renderCart();
  });
  eq(
    await page.evaluate(() => cart[0].price),
    10,
    "3 units: back to full price, not compounded",
  );

  console.log("The quantity discount survives hold and resume");
  await page.evaluate(() => {
    cart[0].qty = 10;
    renderCart();
  });
  await page.click("#holdSale");
  await settle();
  await page.click("#resumeSale");
  await page.click("[data-resume]");
  await settle();
  eq(
    await page.evaluate(() => [cart[0].qty, cart[0].price]),
    [10, 9.5],
    "resumed at 10 x 9.50 (not discounted twice)",
  );

  console.log("Minimum trade quantity");
  await page.evaluate(() => {
    cart[0].qty = 5;
    renderCart();
  });
  await page.selectOption("#saleCustomer", "c1");
  await page.selectOption("#paymentMethod", "account");
  const before = (await sales()).length;
  await page.click("#checkout");
  await settle();
  ok(
    /at least 12/.test(await page.innerText("#toast")),
    "a trade sale below the minimum is refused with the reason",
  );
  eq((await sales()).length, before, "nothing was saved");
  await page.evaluate(() => {
    cart[0].qty = 12;
    renderCart();
  });
  await page.click("#checkout");
  await settle(500);
  eq((await sales()).length, before + 1, "12 units goes through");
  await page.selectOption("#paymentMethod", "cash");

  console.log("Manager approval for big discounts");
  await page.click('[data-view="setup"]');
  await page.fill('#approvalForm [name="pin"]', "739204");
  await page.fill('#approvalForm [name="discountPct"]', "10");
  await page.fill('#approvalForm [name="refundAmount"]', "50");
  await page.click('#approvalForm button[type="submit"]');
  await page.waitForTimeout(1500);
  ok(
    /Approval is on/.test(await page.innerText("#approvalState")),
    "approval settings saved",
  );
  const rec = await page.evaluate(
    async () => (await POSDB.get("settings", "approvalPin")).value,
  );
  ok(
    rec.hash && !JSON.stringify(rec).includes("739204"),
    "the approval PIN is stored hashed",
  );

  await page.click('[data-view="sale"]');
  await page.evaluate(() => {
    cart = [];
    renderCart();
  });
  await page.click('[data-add="p2"]');
  await page.selectOption("#discountType", "percent");
  await page.fill("#discountValue", "5");
  const s0 = (await sales()).length;
  await page.click("#checkout");
  await settle(500);
  eq(
    (await sales()).length,
    s0 + 1,
    "a 5% discount (under the limit) needs no approval",
  );
  await page.click('[data-add="p2"]');
  await page.selectOption("#discountType", "percent");
  await page.fill("#discountValue", "20");
  await page.click("#checkout");
  await page.waitForSelector("#approvePanel:not(.hidden)");
  ok(
    /Discount of 20%/.test(await page.innerText("#approveReason")),
    "a 20% discount asks for approval and says what for",
  );
  await page.fill("#approvePin", "000000");
  await page.click('#approveForm button[type="submit"]');
  await page.waitForTimeout(1500);
  ok(
    /not right/.test(await page.innerText("#approveError")),
    "a wrong PIN is refused",
  );
  await page.fill("#approvePin", "739204");
  await page.click('#approveForm button[type="submit"]');
  await settle(1800);
  eq((await sales()).length, s0 + 2, "the right PIN lets the sale through");
  const log = await page.evaluate(async () =>
    (await POSDB.get("settings", "auditLog")).value.map((e) => e.action),
  );
  ok(
    log.includes("discount-override") && log.includes("approval-failed"),
    "approval and the refused attempt are in the activity log",
  );

  console.log("Cancelling approval keeps the cart");
  await page.click('[data-add="p2"]');
  await page.selectOption("#discountType", "percent");
  await page.fill("#discountValue", "30");
  await page.click("#checkout");
  await page.waitForSelector("#approvePanel:not(.hidden)");
  await page.click("#approveCancel");
  await settle();
  eq((await sales()).length, s0 + 2, "no sale when approval is cancelled");
  eq(await page.evaluate(() => cart.length), 1, "the cart is kept");

  console.log("Manager approval for big refunds");
  await page.evaluate(async () => {
    cart = [];
    renderCart();
    await POSDB.put("sales", {
      id: "bigsale",
      createdAt: Date.now(),
      currency: "AUD",
      paymentMethod: "cash",
      paymentVerified: true,
      syncStatus: "pending",
      items: [{ productId: "p2", name: "Tea", unitPrice: 100, quantity: 2 }],
      total: 200,
    });
    await refresh();
    await RefundsUI.open("bigsale");
  });
  await page.waitForSelector("#refundPanel:not(.hidden)");
  await page.fill("#refundLines [data-line]", "1");
  await page.click("#refundConfirm");
  await page.waitForSelector("#approvePanel:not(.hidden)");
  ok(
    /Refund of 100\.00/.test(await page.innerText("#approveReason")),
    "a 100.00 refund (limit 50) asks for approval",
  );
  await page.click("#approveCancel");
  await settle();
  eq(
    (await page.evaluate(() => POSDB.all("refunds"))).length,
    0,
    "cancelling approval records no refund",
  );
  await page.click("#refundConfirm");
  await page.waitForSelector("#approvePanel:not(.hidden)");
  await page.fill("#approvePin", "739204");
  await page.click('#approveForm button[type="submit"]');
  await settle(1800);
  eq(
    (await page.evaluate(() => POSDB.all("refunds"))).length,
    1,
    "the right PIN lets the refund through",
  );
  const log2 = await page.evaluate(async () =>
    (await POSDB.get("settings", "auditLog")).value.map((e) => e.action),
  );
  ok(
    log2.includes("refund-override") && log2.includes("refund"),
    "the refund and its approval are in the activity log",
  );

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
