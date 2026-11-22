/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/tiers.e2e.js        (or: npm i -D playwright)
 * Seeds a v1 database like an existing install, upgrades it, then exercises Counter -> Retail -> offline -> Counter.
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
  if (p === "/__blank") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<html></html>");
  }
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
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  passed++;
  console.log("  ✓ " + msg);
};
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  passed++;
  console.log("  ✓ " + msg);
};

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = "http://localhost:" + server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
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

  console.log("Migration: existing v1 install");
  await page.goto(base + "/__blank");
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("mwakete-pos-v1", 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore("products", { keyPath: "id" }).createIndex(
            "sku",
            "sku",
            { unique: false },
          );
          d.createObjectStore("sales", { keyPath: "id" }).createIndex(
            "createdAt",
            "createdAt",
          );
          d.createObjectStore("settings", { keyPath: "key" });
        };
        req.onsuccess = () => {
          const d = req.result,
            t = d.transaction(["products", "sales", "settings"], "readwrite");
          t.objectStore("products").put({
            id: "old-p",
            name: "Old water",
            price: 2,
            stock: 9,
            sku: "OLD1",
            updatedAt: 1,
          });
          t.objectStore("sales").put({
            id: "old-s",
            createdAt: 5,
            currency: "AUD",
            items: [
              {
                productId: "old-p",
                name: "Old water",
                unitPrice: 2,
                quantity: 1,
              },
            ],
            total: 2,
            paymentMethod: "cash",
            paymentVerified: true,
            syncStatus: "pending",
          });
          t.objectStore("settings").put({
            key: "businessName",
            value: "Existing Shop",
          });
          t.oncomplete = () => {
            d.close();
            resolve();
          };
          t.onerror = () => reject(t.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  await page.goto(base + "/");
  await page.waitForSelector("#productGrid .product-card");
  const dump = () =>
    page.evaluate(async () => ({
      p: await POSDB.all("products"),
      s: await POSDB.all("sales"),
      st: await POSDB.all("settings"),
    }));
  let d = await dump();
  eq(
    d.p.map((x) => x.id),
    ["old-p"],
    "existing product survives the v1 -> v2 upgrade",
  );
  eq(
    d.s.map((x) => [x.id, x.syncStatus]),
    [["old-s", "pending"]],
    "existing pending sale survives, still pending",
  );
  ok(
    d.st.some((x) => x.key === "businessName" && x.value === "Existing Shop"),
    "existing settings survive",
  );
  eq(
    await page.evaluate(() => TierUI.current()),
    "counter",
    "an existing install defaults to Counter",
  );

  console.log("Counter looks like the original app");
  for (const sel of [
    '[data-view="customers"]',
    '[data-view="reports"]',
    "#discountType",
    "#saleCustomer",
    "#lowStockList",
  ])
    ok(
      !(await page.locator(sel).first().isVisible()),
      "hidden in Counter: " + sel,
    );
  await page.click(".product-card");
  await page.click("#checkout");
  await page.waitForFunction(
    async () => (await POSDB.all("sales")).length === 2,
  );
  d = await dump();
  const counterSale = d.s.find((x) => x.id !== "old-s");
  eq(
    Object.keys(counterSale).sort(),
    [
      "createdAt",
      "currency",
      "id",
      "items",
      "paymentMethod",
      "paymentVerified",
      "syncStatus",
      "total",
    ],
    "a Counter sale has exactly the original fields (no Retail fields)",
  );
  ok(
    !(await page.locator("#receiptPanel").isVisible()),
    "no receipt pop-up in Counter",
  );

  console.log("Switch to Retail");
  await page.click('[data-view="setup"]');
  eq(
    await page.locator("[data-tier]:disabled").count(),
    1,
    "Wholesale is shown but disabled (coming soon)",
  );
  await page.click('[data-tier="retail"]');
  await page.waitForSelector('[data-view="reports"]:not(.hidden)');
  ok(
    await page.locator('[data-view="customers"]').isVisible(),
    "Customers tab appears",
  );
  ok(
    await page.locator('[data-view="reports"]').isVisible(),
    "Reports tab appears",
  );
  eq(
    await page.evaluate(() => TierUI.current()),
    "retail",
    "tier saved as retail",
  );

  console.log("Retail: products, barcode, discount, customer, receipt");
  await page.click('[data-view="customers"]');
  await page.fill("#customerForm [name=name]", "Amy <b>Tui</b>");
  await page.fill("#customerForm [name=phone]", "+686 73052765");
  await page.click("#customerForm button[type=submit]");
  await page.waitForSelector("#customerList .resource-row");
  eq(
    await page.locator("#customerList b").count(),
    0,
    "customer name is escaped (no injected <b>)",
  );
  await page.click('[data-view="products"]');
  await page.fill("#productForm [name=name]", "Rice 1kg");
  await page.fill("#productForm [name=price]", "10");
  await page.fill("#productForm [name=stock]", "3");
  await page.fill("#productForm [name=sku]", "RICE-1");
  await page.fill("#productForm [name=category]", "Food");
  await page.fill("#productForm [name=reorderLevel]", "5");
  await page.click("#productForm button[type=submit]");
  await page.waitForSelector("#lowStockList .resource-row");
  ok(
    (await page.locator("#lowStockList").innerText()).includes("Rice 1kg"),
    "low-stock list shows Rice 1kg (3 <= 5)",
  );
  d = await dump();
  const rice = d.p.find((x) => x.name === "Rice 1kg");
  ok(
    rice.category === "Food" && rice.reorderLevel === 5,
    "category and reorder level saved on the product",
  );
  await page.fill("#productForm [name=name]", "Bad");
  await page.fill("#productForm [name=price]", "1");
  await page.fill("#productForm [name=reorderLevel]", "-4");
  await page.click("#productForm button[type=submit]");
  await page.waitForTimeout(200);
  eq(
    (await dump()).p.length,
    2,
    "invalid reorder level is rejected, product not saved",
  );
  await page.fill("#productForm [name=reorderLevel]", "");

  await page.click('[data-view="sale"]');
  await page.fill("#productSearch", "rice-1");
  await page.press("#productSearch", "Enter");
  await page.waitForFunction(
    () => document.getElementById("cartCount").textContent === "1",
  );
  eq(
    await page.textContent("#cartCount"),
    "1",
    "barcode + Enter adds the product to the cart",
  );
  eq(
    await page.inputValue("#productSearch"),
    "",
    "search box cleared after scan",
  );
  await page.fill("#productSearch", "NOPE");
  await page.press("#productSearch", "Enter");
  await page.waitForFunction(() =>
    /No product with that barcode/.test(
      document.getElementById("toast").textContent,
    ),
  );
  eq(await page.textContent("#cartCount"), "1", "unknown barcode adds nothing");
  await page.fill("#productSearch", "");
  await page.selectOption("#discountType", "percent");
  await page.fill("#discountValue", "10");
  eq(await page.textContent("#total"), "9.00", "10% off 10.00 shows 9.00");
  await page.fill("#discountValue", "150");
  ok(
    await page.locator("#discountNote").isVisible(),
    "discount over 100% shows a warning",
  );
  eq(
    await page.textContent("#total"),
    "10.00",
    "invalid discount does not change the total",
  );
  await page.click("#checkout");
  await page.waitForTimeout(300);
  eq(
    (await dump()).s.length,
    2,
    "an invalid discount blocks the sale (nothing saved)",
  );
  await page.fill("#discountValue", "10");
  await page.selectOption("#saleCustomer", { label: "Amy <b>Tui</b>" });
  await page.click("#checkout");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  const receipt = await page.locator("#receiptBody").innerText();
  ok(
    /Existing Shop/.test(receipt) &&
      /Rice 1kg/.test(receipt) &&
      /Discount \(10%\)\s+-1\.00/.test(receipt) &&
      /TOTAL AUD\s+9\.00/.test(receipt) &&
      /Customer: Amy/.test(receipt),
    "receipt shows business, item, discount, total, customer",
  );
  await page.click("#receiptClose");
  d = await dump();
  const retailSale = d.s.find((x) => x.tier === "retail");
  ok(
    retailSale &&
      retailSale.total === 9 &&
      retailSale.subtotal === 10 &&
      retailSale.discount.amount === 1,
    "sale saved with subtotal 10, discount 1, total 9",
  );
  ok(
    retailSale.syncStatus === "pending",
    "sale stays pending until the server confirms",
  );
  ok(
    !JSON.stringify(retailSale).includes("Amy"),
    "customer name is not stored on the sale (only an opaque id)",
  );
  ok(
    typeof retailSale.customerId === "string" &&
      retailSale.customerId.length > 0,
    "opaque customer id attached",
  );
  eq(d.p.find((x) => x.name === "Rice 1kg").stock, 2, "stock reduced");
  eq(
    await page.inputValue("#discountType"),
    "none",
    "discount reset after the sale",
  );

  console.log("Reports and receipts from history");
  await page.click('[data-view="reports"]');
  const report = await page.locator("#reportBody").innerText();
  ok(
    /this device/.test(report) &&
      /Food/.test(report) &&
      /Rice 1kg/.test(report),
    "report shows category and top product, labelled device-only",
  );
  await page.click('[data-view="sales"]');
  await page.locator(".sale-row").first().click();
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  ok(true, "clicking a sales-history row reopens its receipt");
  await page.keyboard.press("Escape");

  console.log("Offline reload keeps everything");
  await page.waitForTimeout(500);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector("#productGrid .product-card");
  eq(
    await page.evaluate(() => TierUI.current()),
    "retail",
    "still Retail after an offline reload",
  );
  eq((await dump()).s.length, 3, "all sales still present offline");
  await ctx.setOffline(false);

  console.log("Switch back to Counter keeps data");
  await page.click('[data-view="setup"]');
  await page.click('[data-tier="counter"]');
  await page.waitForSelector('[data-view="reports"].hidden', {
    state: "attached",
  });
  ok(
    !(await page.locator('[data-view="customers"]').isVisible()),
    "Retail tabs hidden again",
  );
  const after = await page.evaluate(async () => ({
    c: (await POSDB.all("customers")).length,
    s: (await POSDB.all("sales")).length,
    p: (await POSDB.all("products")).length,
  }));
  eq(after, { c: 1, s: 3, p: 2 }, "customers, sales and products all kept");
  await page.click('[data-tier="retail"]');
  await page.waitForSelector('[data-view="customers"]:not(.hidden)');
  ok(
    (await page.locator("#customerList").innerText()).includes("Amy"),
    "customer is back after switching to Retail again",
  );

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch(async (e) => {
  console.error("\nFAILED:", e.message);
  server.close();
  process.exit(1);
});
