/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/stock.e2e.js
 * Stock changes with a recorded reason, then suppliers and purchase orders (draft -> ordered -> received).
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
  const dialogs = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !/fonts\.g|ERR_|Failed to load resource/.test(m.text())
    )
      errors.push(m.text());
  });
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    d.accept();
  });
  await page.goto(base + "/");
  await page.waitForSelector("#year");

  const setTier = (t) =>
    page.evaluate(async (x) => {
      await TierCore.setTier(POSDB, x);
      await TierUI.apply();
    }, t);
  const text = (sel) => page.innerText(sel).then((s) => s.replace(/\s+/g, " "));
  const stock = (id) =>
    page.evaluate((i) => POSDB.get("products", i).then((p) => p.stock), id);
  const all = (store) => page.evaluate((s) => POSDB.all(s), store);
  const toastText = () => page.textContent("#toast");

  console.log("Counter has no stock screen");
  ok(await page.isHidden('[data-view="stock"]'), "no Stock tab on Counter");

  console.log("Retail: stock changes with a reason");
  await setTier("retail");
  await page.evaluate(async () => {
    await POSDB.put("products", {
      id: "p1",
      name: "Tea",
      price: 10,
      stock: 5,
      sku: "T",
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "p2",
      name: "Jam",
      price: 5,
      stock: 0,
      sku: "J",
      updatedAt: 1,
    });
    await refresh();
  });
  ok(await page.isVisible('[data-view="stock"]'), "Stock tab shows on Retail");
  ok(
    await page.isHidden('[data-view="purchasing"]'),
    "Purchasing is Wholesale only",
  );
  await page.click('[data-view="stock"]');
  await page.selectOption("#stockProduct", "p1");
  await page.selectOption("#stockAction", "receive");
  await page.fill('#stockForm [name="qty"]', "10");
  ok(
    /Tea: 5 → 15 \(\+10\)/.test(await text("#stockPreview")),
    "the preview shows before and after",
  );
  await page.fill('#stockForm [name="note"]', "Delivery from Tarawa");
  await page.click('#stockForm button[type="submit"]');
  await page.waitForFunction(() =>
    /Tea is now 15/.test(document.getElementById("toast").textContent),
  );
  eq(await stock("p1"), 15, "stock rose to 15");
  let moves = await all("stockMoves");
  eq(
    [
      moves.length,
      moves[0].delta,
      moves[0].reason,
      moves[0].productId,
      moves[0].note,
      moves[0].syncStatus,
    ],
    [1, 10, "purchase", "p1", "Delivery from Tarawa", "pending"],
    "one pending 'stock received' movement was recorded",
  );
  ok(
    /Tea.*Stock received.*Delivery from Tarawa.*\+10/.test(
      await text("#stockMoves"),
    ),
    "the history shows it",
  );

  await page.selectOption("#stockAction", "damage");
  await page.fill('#stockForm [name="qty"]', "20");
  ok(
    /Only 15 of Tea/.test(await text("#stockPreview")),
    "removing more than is in stock is refused with a reason",
  );
  await page.click('#stockForm button[type="submit"]');
  await page.waitForTimeout(200);
  eq(await stock("p1"), 15, "stock is unchanged after the refused change");
  eq((await all("stockMoves")).length, 1, "and no movement was recorded");

  await page.selectOption("#stockAction", "count");
  await page.fill('#stockForm [name="qty"]', "12");
  ok(
    /15 → 12 \(-3\)/.test(await text("#stockPreview")),
    "a stock count shows the difference",
  );
  await page.click('#stockForm button[type="submit"]');
  await page.waitForFunction(() =>
    /Tea is now 12/.test(document.getElementById("toast").textContent),
  );
  moves = (await all("stockMoves")).sort((a, b) => a.createdAt - b.createdAt);
  eq(
    moves.map((m) => [m.delta, m.reason]),
    [
      [10, "purchase"],
      [-3, "count"],
    ],
    "the count was recorded as -3",
  );
  await page.fill('#stockForm [name="qty"]', "12");
  ok(
    /matches/.test(await text("#stockPreview")),
    "counting the same number changes nothing",
  );

  console.log("Wholesale: suppliers and purchase orders");
  await setTier("wholesale");
  ok(
    await page.isVisible('[data-view="purchasing"]'),
    "Purchasing tab shows on Wholesale",
  );
  await page.click('[data-view="purchasing"]');
  await page.fill('#poForm [name="supplierName"]', "Pacific Traders");
  await page.selectOption("#poProduct", "p2");
  await page.fill("#poQty", "6");
  await page.fill("#poCost", "2");
  await page.click("#poAddLine");
  await page.selectOption("#poProduct", "p1");
  await page.fill("#poQty", "24");
  await page.fill("#poCost", "1.2");
  await page.click("#poAddLine");
  ok(
    /Order total: 40\.80/.test(await text("#poTotal")),
    "the total is exact (6 x 2.00 + 24 x 1.20 = 40.80)",
  );
  await page.selectOption("#poProduct", "p2");
  await page.fill("#poQty", "1");
  await page.fill("#poCost", "2");
  await page.click("#poAddLine");
  ok(/twice/.test(await toastText()), "the same product twice is refused");
  await page.click("[data-remove-line='1']");
  ok(
    /Order total: 12\.00/.test(await text("#poTotal")),
    "a line can be removed",
  );
  await page.selectOption("#poProduct", "p1");
  await page.fill("#poQty", "24");
  await page.fill("#poCost", "1.2");
  await page.click("#poAddLine");
  await page.fill('#poForm [name="note"]', "Friday boat");
  await page.click('#poForm button[type="submit"]');
  await page.waitForSelector("#poList [data-po-id]");
  let pos = await all("purchaseOrders");
  eq(
    [
      pos.length,
      pos[0].status,
      pos[0].total,
      pos[0].supplierName,
      pos[0].syncStatus,
    ],
    [1, "draft", 40.8, "Pacific Traders", "pending"],
    "a draft order was saved",
  );
  ok(/^PO-[A-Z0-9]{4}-0001$/.test(pos[0].number), "with a numbered reference");
  const sups = await all("suppliers");
  eq(
    sups.map((s) => s.name),
    ["Pacific Traders"],
    "the new supplier was added automatically",
  );
  eq(pos[0].supplierId, sups[0].id, "and linked to the order");
  ok(
    /Pacific Traders/.test(await text("#supplierList")),
    "it appears in the supplier list",
  );
  eq(await stock("p2"), 0, "a draft does not change stock");

  await page.click('[data-po-act="order"]');
  await page.waitForFunction(() =>
    /Ordered/.test(document.getElementById("poList").textContent),
  );
  ok(
    await page.isHidden('[data-po-act="order"]').catch(() => true),
    "an ordered order cannot be ordered again",
  );
  await page.click('[data-po-act="view"]');
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  ok(
    /PURCHASE ORDER PO-/.test(await text("#receiptBody")) &&
      /Pacific Traders/.test(await text("#receiptBody")),
    "the order can be viewed",
  );
  await page.click("#receiptClose");

  await page.click('[data-po-act="receive"]');
  await page.waitForFunction(() =>
    /Received/.test(document.getElementById("poList").textContent),
  );
  ok(
    dialogs.some((d) => /Receive this stock now/.test(d)),
    "receiving asks for confirmation",
  );
  eq(
    [await stock("p2"), await stock("p1")],
    [6, 36],
    "stock rose by the ordered quantities",
  );
  moves = (await all("stockMoves")).filter((m) => m.refId === pos[0].id);
  eq(
    moves.map((m) => [m.productId, m.delta, m.reason]).sort(),
    [
      ["p1", 24, "purchase"],
      ["p2", 6, "purchase"],
    ],
    "one purchase movement per line, pointing at the order",
  );
  pos = await all("purchaseOrders");
  eq(
    [pos[0].status, typeof pos[0].receivedAt],
    ["received", "number"],
    "the order is received",
  );
  ok(
    (await page
      .locator(
        '#poList [data-po-act="receive"], #poList [data-po-act="cancel"]',
      )
      .count()) === 0,
    "a received order has no actions left to change it",
  );

  console.log("Cancel a draft; a bad order is refused without using a number");
  await page.fill('#poForm [name="supplierName"]', "Island Foods");
  await page.click('#poForm button[type="submit"]');
  await page.waitForFunction(() =>
    /at least one product/.test(document.getElementById("toast").textContent),
  );
  ok(true, "an order with no lines is refused");
  eq(
    (await page.evaluate(() => POSDB.get("settings", "poSeq"))).value,
    1,
    "and no order number was used up",
  );
  await page.selectOption("#poProduct", "p2");
  await page.fill("#poQty", "3");
  await page.fill("#poCost", "2");
  await page.click("#poAddLine");
  await page.click('#poForm button[type="submit"]');
  await page.waitForFunction(
    () => document.querySelectorAll("#poList [data-po-id]").length === 2,
  );
  await page
    .locator('[data-po-id]:has-text("Island Foods") [data-po-act="cancel"]')
    .click();
  await page.waitForFunction(() =>
    /Cancelled/.test(document.getElementById("poList").textContent),
  );
  eq(
    (await all("purchaseOrders")).map((o) => o.status).sort(),
    ["cancelled", "received"],
    "the second order is cancelled and frozen",
  );
  eq(await stock("p2"), 6, "cancelling changes no stock");
  await page.fill('#supplierForm [name="name"]', "pacific traders");
  await page.click('#supplierForm button[type="submit"]');
  await page.waitForFunction(() =>
    /already have a supplier/.test(
      document.getElementById("toast").textContent,
    ),
  );
  ok(true, "a duplicate supplier name is refused");

  console.log("Back to Counter: data is kept, screens are hidden");
  await setTier("counter");
  ok(
    (await page.isHidden('[data-view="stock"]')) &&
      (await page.isHidden('[data-view="purchasing"]')),
    "both tabs hidden",
  );
  eq(
    [(await all("purchaseOrders")).length, (await all("stockMoves")).length],
    [2, 4],
    "orders and movements are kept",
  );

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
