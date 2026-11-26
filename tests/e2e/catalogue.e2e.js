/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/catalogue.e2e.js
 * Products: edit (new fields), price history, archive/restore, filters, out-of-stock badge, bulk %, valuation, picture, quantity cap.
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
// 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
  await page.evaluate(async () => {
    await TierCore.setTier(POSDB, "retail");
    await TierUI.apply();
    const mk = (id, name, price, stock, extra = {}) =>
      POSDB.put("products", {
        id,
        name,
        price,
        stock,
        sku: id.toUpperCase(),
        updatedAt: 1,
        ...extra,
      });
    await mk("p1", "Tea", 10, 5, { category: "Drinks" });
    await mk("p2", "Rice", 4, 0, { category: "Food" });
    await mk("p3", "Soap", 3, 2, { reorderLevel: 3 });
    await refresh();
  });
  const get = (id) => page.evaluate((i) => POSDB.get("products", i), id);
  await page.click('[data-view="products"]');

  console.log("Alerts, badges and filters");
  ok(
    /1 out of stock · 1 low stock/.test(await page.innerText("#stockAlerts")),
    "alerts count out-of-stock and low-stock products",
  );
  ok(
    (await page.locator(".badge.out").count()) >= 1,
    "out-of-stock badge is shown",
  );
  await page.selectOption("#prodFilterAvail", "out");
  eq(
    await page.locator("#productTable tbody tr").count(),
    1,
    "filter: out of stock shows one row",
  );
  await page.selectOption("#prodFilterAvail", "");
  await page.selectOption("#prodFilterCat", "Drinks");
  eq(
    await page.locator("#productTable tbody tr").count(),
    1,
    "filter: category Drinks shows one row",
  );
  await page.selectOption("#prodFilterCat", "");
  await page.fill("#prodFilterText", "soap");
  eq(
    await page.locator("#productTable tbody tr").count(),
    1,
    "search finds Soap",
  );
  await page.fill("#prodFilterText", "");

  console.log("Edit product: new fields and price history");
  await page.click('[data-edit="p1"]');
  await page.fill('#productEditForm [name="price"]', "12");
  await page.fill('#productEditForm [name="costPrice"]', "7");
  await page.fill('#productEditForm [name="description"]', "Loose leaf");
  await page.selectOption('#productEditForm [name="unit"]', "kg");
  await page.click('#productEditForm button[type="submit"]');
  await page.waitForTimeout(300);
  let p1 = await get("p1");
  eq(
    [p1.price, p1.costPrice, p1.description, p1.unit],
    [12, 7, "Loose leaf", "kg"],
    "price, cost, description and unit saved",
  );
  eq(p1.priceHistory.length, 1, "one price change recorded");
  eq(
    [p1.priceHistory[0].from, p1.priceHistory[0].to],
    [10, 12],
    "history is 10 → 12",
  );
  eq(p1.stock, 5, "stock is untouched by an edit");
  await page.click('[data-edit="p1"]');
  ok(
    /10\.00 → 12\.00/.test(await page.innerText("#productHistory")),
    "history is shown in the dialog",
  );
  await page.click("#productEditCancel");

  console.log("Invalid edit refused");
  await page.click('[data-edit="p1"]');
  await page.fill('#productEditForm [name="name"]', "   ");
  await page.click('#productEditForm button[type="submit"]');
  await page.waitForTimeout(200);
  eq((await get("p1")).name, "Tea", "blank name is not saved");
  await page.click("#productEditCancel");

  console.log("Picture is resized and kept on the device");
  await page.click('[data-edit="p2"]');
  await page.setInputFiles('#productEditForm [name="imageFile"]', {
    name: "x.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.click('#productEditForm button[type="submit"]');
  await page.waitForTimeout(500);
  const img = (await get("p2")).image;
  ok(
    typeof img === "string" && img.startsWith("data:image/jpeg;base64,"),
    "picture saved as a small JPEG",
  );
  ok(
    (await page.locator("img.thumb").count()) === 1,
    "thumbnail shows in the list",
  );

  console.log("Archive hides from the till but keeps the product");
  await page.click('[data-edit="p3"]');
  await page.check('#productEditForm [name="archived"]');
  await page.click('#productEditForm button[type="submit"]');
  await page.waitForTimeout(300);
  eq((await get("p3")).archived, true, "p3 archived");
  await page.click('[data-view="sale"]');
  eq(
    await page.locator('#productGrid [data-add="p3"]').count(),
    0,
    "archived product is not sold at the till",
  );
  await page.click('[data-view="products"]');
  eq(
    await page.locator('[data-edit="p3"]').count(),
    0,
    "archived hidden from the default list",
  );
  await page.selectOption("#prodFilterAvail", "archived");
  eq(
    await page.locator('[data-edit="p3"]').count(),
    1,
    "archived filter shows it",
  );
  await page.click('[data-edit="p3"]');
  await page.uncheck('#productEditForm [name="archived"]');
  await page.click('#productEditForm button[type="submit"]');
  await page.waitForTimeout(300);
  await page.selectOption("#prodFilterAvail", "");
  eq("archived" in (await get("p3")), false, "restoring clears the flag");

  console.log("Bulk price change");
  await page.check('[data-sel="p1"]');
  await page.check('[data-sel="p2"]');
  await page.selectOption("#bulkType", "percent");
  await page.fill("#bulkValue", "10");
  await page.click("#bulkApply");
  await page.waitForTimeout(400);
  eq(
    [(await get("p1")).price, (await get("p2")).price],
    [13.2, 4.4],
    "prices raised 10% on the two selected",
  );
  eq((await get("p3")).price, 3, "an unselected product is unchanged");
  await page.fill("#bulkValue", "0");
  await page.check('[data-sel="p1"]');
  await page.click("#bulkApply");
  await page.waitForTimeout(200);
  eq((await get("p1")).price, 13.2, "0% is refused");

  console.log("Stock valuation");
  ok(
    /worth .* at selling price; 84\.00 at cost/.test(
      (await page.innerText("#stockValue")).replace(/\s+/g, " "),
    ) || /at cost/.test(await page.innerText("#stockValue")),
    "valuation mentions cost for costed products",
  );
  ok(
    /left out of the cost figure|at cost/.test(
      await page.innerText("#stockValue"),
    ),
    "products without cost price are called out, not guessed",
  );

  console.log("Quantity cap and stock warning");
  await page.click('[data-view="sale"]');
  await page.evaluate(() => {
    cart = [];
  });
  await page.click('[data-add="p1"]');
  await page.evaluate(() => {
    cart[0].qty = 9999;
    renderCart();
  });
  await page.click('[data-inc="p1"]');
  eq(await page.evaluate(() => cart[0].qty), 9999, "quantity stops at 9999");
  await page.evaluate(() => {
    cart = [];
    renderCart();
  });
  await page.click('[data-add="p1"]');
  await page.click('[data-inc="p1"]');
  for (let i = 0; i < 5; i++) await page.click('[data-inc="p1"]');
  ok(
    /Only 5 of Tea in stock/.test(await page.innerText("#toast")),
    "going past the stock count warns (does not block)",
  );
  eq(
    await page.evaluate(() => cart[0].qty),
    7,
    "the sale can still go through",
  );

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
