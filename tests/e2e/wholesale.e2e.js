/* Browser test (not part of `npm test`): needs Playwright + Chromium.  npm run test:e2e:wholesale
 * Seeds a v2 database (what live Retail installs have today), upgrades it to v3, then exercises Wholesale PR 1.
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
  await new Promise((r) => server.listen(0, r));
  const base = "http://localhost:" + server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
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
  const dump = () =>
    page.evaluate(async () => ({
      p: await POSDB.all("products"),
      s: await POSDB.all("sales"),
      c: await POSDB.all("customers"),
      l: await POSDB.all("priceLists"),
      st: Object.fromEntries(
        (await POSDB.all("settings")).map((x) => [x.key, x.value]),
      ),
    }));
  const toastText = () => page.textContent("#toast");

  console.log("Migration: existing v2 (Retail) install -> v3");
  await page.goto(base + "/__blank");
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("mwakete-pos-v1", 2);
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
          d.createObjectStore("customers", { keyPath: "id" }).createIndex(
            "name",
            "name",
          );
        };
        req.onsuccess = () => {
          const d = req.result,
            t = d.transaction(
              ["products", "sales", "settings", "customers"],
              "readwrite",
            );
          t.objectStore("products").put({
            id: "r-p",
            name: "Retail biscuit",
            price: 3,
            stock: 10,
            sku: "BISC",
            category: "Food",
            reorderLevel: 2,
            updatedAt: 1,
          });
          t.objectStore("sales").put({
            id: "r-s",
            createdAt: 5,
            currency: "AUD",
            tier: "retail",
            subtotal: 3,
            total: 3,
            items: [
              {
                productId: "r-p",
                name: "Retail biscuit",
                unitPrice: 3,
                quantity: 1,
              },
            ],
            paymentMethod: "cash",
            paymentVerified: true,
            syncStatus: "pending",
          });
          t.objectStore("settings").put({ key: "tier", value: "retail" });
          t.objectStore("settings").put({
            key: "businessName",
            value: "Trade Shop",
          });
          t.objectStore("customers").put({
            id: "r-c",
            name: "Old Retail Customer",
            phone: "",
            notes: "",
            createdAt: 1,
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
  let d = await dump();
  eq(
    d.p.map((x) => x.id),
    ["r-p"],
    "existing product survives v2 -> v3",
  );
  eq(
    d.s.map((x) => [x.id, x.syncStatus, x.tier]),
    [["r-s", "pending", "retail"]],
    "existing Retail sale survives, still pending",
  );
  eq(
    d.c.map((x) => x.name),
    ["Old Retail Customer"],
    "existing customer survives",
  );
  eq(d.st.tier, "retail", "tier setting survives");
  eq(
    await page.evaluate(() => POSDB.all("priceLists")),
    [],
    "new priceLists store exists and is empty",
  );

  console.log("Retail install shows no Wholesale screens");
  for (const sel of [
    '[data-view="pricelists"]',
    "#salePriceList",
    "#productPrices",
    ".packs-box",
    "#customerPriceList",
  ])
    ok(
      !(await page.locator(sel).first().isVisible()),
      "hidden in Retail: " + sel,
    );

  console.log("Switch to Wholesale");
  await page.click('[data-view="setup"]');
  await page.click('[data-tier="wholesale"]');
  await page.waitForSelector('[data-view="pricelists"]:not(.hidden)');
  eq(
    await page.evaluate(() => TierUI.current()),
    "wholesale",
    "tier saved as wholesale",
  );
  ok(
    await page.locator("#taxForm").isVisible(),
    "tax settings visible in Wholesale",
  );
  eq(
    await page.inputValue("#taxForm [name=taxRate]"),
    "12.5",
    "tax rate defaults to 12.5",
  );
  // The browser's own max=100 check would stop this first; bypass it to test the app's own validation too.
  await page.evaluate(() => {
    document.getElementById("taxForm").noValidate = true;
  });
  await page.fill("#taxForm [name=taxRate]", "150");
  await page.click("#taxForm button[type=submit]");
  await page.waitForTimeout(150);
  ok(
    /between 0 and 100/.test(await toastText()),
    "tax rate over 100 is rejected",
  );
  eq((await dump()).st.taxRate, undefined, "invalid tax rate not saved");
  await page.fill("#taxForm [name=taxRate]", "12.5");
  await page.fill("#taxForm [name=taxNumber]", "TX-100");
  await page.click("#taxForm button[type=submit]");
  await page.waitForFunction(
    async () => (await POSDB.get("settings", "taxRate"))?.value === 12.5,
  );
  eq((await dump()).st.taxNumber, "TX-100", "tax settings saved");

  console.log("Price lists");
  await page.click('[data-view="pricelists"]');
  await page.fill("#priceListForm [name=name]", "Trade <b>");
  await page.click("#priceListForm button[type=submit]");
  await page.waitForSelector("#priceListList .resource-row");
  eq(
    await page.locator("#priceListList b").count(),
    0,
    "price list name is escaped",
  );
  await page.fill("#priceListForm [name=name]", "trade <b>");
  await page.click("#priceListForm button[type=submit]");
  await page.waitForTimeout(150);
  ok(
    /already exists/.test(await toastText()),
    "duplicate price list name is rejected",
  );
  const listId = (await dump()).l[0].id;

  console.log("Product with list price, pack and tax exempt");
  await page.click('[data-view="products"]');
  await page.fill("#productForm [name=name]", "Rice 1kg");
  await page.fill("#productForm [name=price]", "10");
  await page.fill("#productForm [name=stock]", "100");
  await page.fill("#productForm [name=sku]", "RICE-1");
  await page.fill(`[data-list-price="${listId}"]`, "8.5");
  await page.fill("#productForm [name=pack1Name]", "Carton");
  await page.fill("#productForm [name=pack1Units]", "24");
  await page.fill("#productForm [name=pack1Sku]", "RICE-C24");
  await page.check("#productForm [name=taxExempt]");
  // Bypass the browser's own min=2 check so the app's validation is what gets tested.
  await page.evaluate(() => {
    document.getElementById("productForm").noValidate = true;
  });
  await page.fill("#productForm [name=pack2Units]", "1");
  await page.click("#productForm button[type=submit]");
  await page.waitForTimeout(200);
  ok(
    /Pack 2/.test(await toastText()),
    "a half-filled pack is rejected with a clear message",
  );
  eq((await dump()).p.length, 1, "nothing saved when a pack is invalid");
  await page.fill("#productForm [name=pack2Units]", "");
  await page.click("#productForm button[type=submit]");
  await page.waitForFunction(
    async () => (await POSDB.all("products")).length === 2,
  );
  d = await dump();
  const rice = d.p.find((x) => x.name === "Rice 1kg");
  eq(rice.prices, { [listId]: 8.5 }, "list price saved on the product");
  eq(
    rice.packs.map((p) => [p.name, p.units, p.sku, p.price]),
    [["Carton", 24, "RICE-C24", undefined]],
    "pack saved (no fixed price)",
  );
  ok(rice.taxExempt === true, "tax exempt saved");
  eq(
    await page.inputValue("#productForm [name=name]"),
    "",
    "form reset after saving",
  );

  console.log("Trade customer");
  await page.click('[data-view="customers"]');
  await page.fill("#customerForm [name=name]", "Moote Trading");
  await page.selectOption("#customerForm [name=customerType]", "trade");
  await page.selectOption("#customerPriceList", listId);
  await page.fill("#customerForm [name=creditLimit]", "500");
  await page.fill("#customerForm [name=terms]", "30 days");
  await page.click("#customerForm button[type=submit]");
  await page.waitForFunction(
    async () => (await POSDB.all("customers")).length === 2,
  );
  d = await dump();
  const trade = d.c.find((x) => x.name === "Moote Trading");
  ok(
    trade.type === "trade" &&
      trade.priceListId === listId &&
      trade.creditLimit === 500 &&
      trade.terms === "30 days",
    "trade customer saved with price list, credit limit, terms",
  );
  ok(
    /Trade customer/.test(await page.locator("#customerList").innerText()),
    "trade badge shown in the customer list",
  );
  await page.fill("#customerForm [name=name]", "Bad Credit");
  await page.selectOption("#customerForm [name=customerType]", "trade");
  await page.fill("#customerForm [name=creditLimit]", "-5");
  await page.click("#customerForm button[type=submit]");
  await page.waitForTimeout(200);
  eq(
    (await dump()).c.length,
    2,
    "negative credit limit is rejected, customer not saved",
  );

  console.log("Till: trade pricing, packs, barcode");
  await page.click('[data-view="sale"]');
  await page.selectOption("#saleCustomer", { label: "Moote Trading" });
  await page.waitForFunction(
    (id) => document.getElementById("salePriceList").value === id,
    listId,
  );
  ok(true, "choosing a trade customer selects their price list");
  const riceCard = page.locator("#productGrid .product-card[data-add]", {
    hasText: "Rice 1kg",
  });
  eq(
    await riceCard.locator("span").textContent(),
    "8.50",
    "product card shows the trade price",
  );
  const packCard = page.locator("#productGrid .product-card.pack", {
    hasText: "Carton",
  });
  eq(
    await packCard.locator("span").textContent(),
    "204.00",
    "pack card shows 8.50 x 24 = 204.00",
  );
  await riceCard.click();
  await packCard.click();
  eq(await page.textContent("#cartCount"), "2", "single + carton in the cart");
  eq(
    await page.textContent("#total"),
    "212.50",
    "total at trade prices = 8.50 + 204.00",
  );
  await page.fill("#productSearch", "rice-c24");
  await page.press("#productSearch", "Enter");
  await page.waitForFunction(
    () => document.getElementById("cartCount").textContent === "3",
  );
  eq(
    await page.textContent("#total"),
    "416.50",
    "scanning the carton barcode adds another carton",
  );
  await page.fill("#productSearch", "");
  await page.selectOption("#salePriceList", "");
  await page.waitForFunction(
    () => document.getElementById("total").textContent === "490.00",
  );
  eq(
    await page.textContent("#total"),
    "490.00",
    "switching to Base price re-prices the cart (10 + 2 x 240)",
  );
  await page.selectOption("#salePriceList", listId);
  await page.waitForFunction(
    () => document.getElementById("total").textContent === "416.50",
  );
  ok(true, "switching back re-prices again");

  console.log("Checkout");
  await page.click("#checkout");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  const receipt = await page.locator("#receiptBody").innerText();
  ok(
    /Rice 1kg \(Carton x24\)/.test(receipt) || /Carton x24/.test(receipt),
    "receipt names the pack",
  );
  ok(/TOTAL AUD\s+416\.50/.test(receipt), "receipt total is 416.50");
  await page.click("#receiptClose");
  d = await dump();
  const sale = d.s.find((x) => x.tier === "wholesale");
  ok(
    sale &&
      sale.total === 416.5 &&
      sale.priceListId === listId &&
      typeof sale.customerId === "string",
    "sale saved with tier, price list and customer id",
  );
  eq(
    sale.items.map((i) => [
      i.productId,
      i.quantity,
      i.unitPrice,
      i.packId,
      i.packUnits,
    ]),
    [
      [rice.id, 1, 8.5, undefined, undefined],
      [rice.id, 2, 204, "pack1", 24],
    ],
    "items point at the product; pack info only on the pack line",
  );
  eq(
    d.p.find((x) => x.id === rice.id).stock,
    100 - 1 - 2 * 24,
    "stock reduced in base units: 100 - 1 - 48 = 51",
  );
  ok(
    sale.syncStatus === "pending",
    "sale stays pending until the server confirms",
  );
  ok(
    !JSON.stringify(sale).includes("Moote"),
    "customer name is not stored on the sale",
  );
  eq(
    await page.inputValue("#salePriceList"),
    "",
    "price list reset after the sale",
  );

  console.log("Sale of a plain product in Wholesale keeps working");
  await page
    .locator("#productGrid .product-card[data-add]", {
      hasText: "Retail biscuit",
    })
    .click();
  await page.click("#checkout");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  await page.click("#receiptClose");
  d = await dump();
  const plain = d.s.find(
    (x) => x.tier === "wholesale" && x.items[0].productId === "r-p",
  );
  ok(
    plain && plain.total === 3 && plain.items[0].packId === undefined,
    "plain product sold at base price, no pack fields",
  );

  console.log("Retail after Wholesale: unchanged behaviour, data kept");
  await page.click('[data-view="setup"]');
  await page.click('[data-tier="retail"]');
  await page.waitForSelector('[data-view="pricelists"].hidden', {
    state: "attached",
  });
  ok(
    !(await page.locator("#salePriceList").isVisible()),
    "price list picker hidden in Retail",
  );
  ok(
    !(await page.locator("#productGrid .product-card.pack").count()),
    "no pack cards in Retail",
  );
  eq(
    await page
      .locator("#productGrid .product-card[data-add]", { hasText: "Rice 1kg" })
      .locator("span")
      .textContent(),
    "10.00",
    "Retail shows the base price",
  );
  await page.click('[data-view="sale"]');
  await page
    .locator("#productGrid .product-card[data-add]", { hasText: "Rice 1kg" })
    .click();
  await page.click("#checkout");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  await page.click("#receiptClose");
  d = await dump();
  const retailSale = d.s
    .filter((x) => x.tier === "retail")
    .find((x) => x.id !== "r-s");
  eq(
    Object.keys(retailSale.items[0]).sort(),
    ["name", "productId", "quantity", "sku", "unitPrice"]
      .concat(retailSale.items[0].category ? ["category"] : [])
      .sort(),
    "a Retail sale item has exactly the original fields",
  );
  eq(d.l.length, 1, "price list kept while in Retail");
  await page.click('[data-view="setup"]');
  await page.click('[data-tier="wholesale"]');
  await page.waitForSelector('[data-view="pricelists"]:not(.hidden)');
  ok(
    (await page.locator("#priceListList").innerText()).includes("Trade"),
    "price list is back after switching to Wholesale",
  );

  console.log("Offline reload");
  await page.waitForTimeout(500);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector("#productGrid .product-card");
  eq(
    await page.evaluate(() => TierUI.current()),
    "wholesale",
    "still Wholesale after an offline reload",
  );
  ok(
    (await page.locator("#productGrid .product-card.pack").count()) > 0,
    "pack cards render offline",
  );
  eq((await dump()).s.length, 4, "all sales present offline");
  await ctx.setOffline(false);

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch(async (e) => {
  console.error("\nFAILED:", e.message);
  server.close();
  process.exit(1);
});
