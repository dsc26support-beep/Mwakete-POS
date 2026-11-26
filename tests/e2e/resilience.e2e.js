/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/resilience.e2e.js
 * Offline-first behaviour: an unfinished sale survives a reload, selling offline, automatic retry after a failed sync,
 * no pointless retry when nothing is set up, and a very long product list on a slow (4x throttled) CPU.
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { load } = require("../helpers/gas.js");

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
  const gas = load();
  let serverCalls = 0,
    failFirst = 0;
  await ctx.route("https://script.google.com/**", async (route) => {
    serverCalls++;
    if (failFirst > 0) {
      failFirst--;
      return route.fulfill({
        status: 503,
        contentType: "text/plain",
        headers: { "access-control-allow-origin": "*" },
        body: "unavailable",
      });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(gas.post(route.request().postData() || "")),
    });
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

  const db = (store) => page.evaluate((s) => POSDB.all(s), store);
  const text = (sel) => page.innerText(sel).then((s) => s.replace(/\s+/g, " "));
  const settle = () => page.waitForTimeout(250);

  await page.evaluate(async () => {
    await POSDB.put("products", {
      id: "p1",
      name: "Tea",
      price: 3,
      stock: 50,
      sku: "T",
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "p2",
      name: "Jam",
      price: 5,
      stock: 50,
      sku: "J",
      updatedAt: 1,
    });
    await refresh();
  });

  console.log("Crash recovery: an unfinished sale survives a reload");
  await page.click('[data-add="p1"]');
  await page.click('[data-add="p1"]');
  await page.click('[data-add="p2"]');
  await settle();
  eq(
    (await page.evaluate(() => POSDB.get("settings", "cartDraft"))).value.map(
      (l) => [l.productId, l.qty],
    ),
    [
      ["p1", 2],
      ["p2", 1],
    ],
    "the cart is saved on the device as it changes",
  );
  await page.reload();
  await page.waitForSelector("#year");
  await page.waitForFunction(() =>
    /unfinished sale was restored/.test(
      document.getElementById("toast").textContent,
    ),
  );
  eq(
    await page.textContent("#cartCount"),
    "3",
    "after a reload the 3 items are back",
  );
  ok(
    /Tea/.test(await text("#cartItems")) &&
      /Jam/.test(await text("#cartItems")),
    "with their names",
  );
  ok(
    /11\.00/.test(await text("#total")),
    "and the right total (2 x 3.00 + 5.00)",
  );
  await page.click("#checkout");
  await settle();
  eq(
    await page.textContent("#cartCount"),
    "0",
    "a completed sale empties the cart",
  );
  eq(
    (await page.evaluate(() => POSDB.get("settings", "cartDraft"))).value,
    [],
    "and clears the saved copy",
  );
  await page.reload();
  await page.waitForSelector("#year");
  await settle();
  eq(
    await page.textContent("#cartCount"),
    "0",
    "so nothing comes back after the next reload",
  );

  console.log("A saved cart for a product that no longer exists is ignored");
  await page.evaluate(() =>
    POSDB.put("settings", {
      key: "cartDraft",
      value: [
        { id: "gone", productId: "gone", name: "Ghost", price: 1, qty: 1 },
      ],
    }),
  );
  await page.reload();
  await page.waitForSelector("#year");
  await settle();
  eq(await page.textContent("#cartCount"), "0", "no ghost items");

  console.log("Selling offline");
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.click('[data-add="p1"]');
  await page.click("#checkout");
  await settle();
  ok(
    /offline/i.test(await text("#connectionText")),
    "the app says it is working offline",
  );
  const sales = await db("sales");
  eq(
    sales.map((s) => s.syncStatus).sort(),
    ["pending", "pending"],
    "both sales so far are saved and pending (nothing lost offline)",
  );
  await ctx.setOffline(false);

  console.log("Nothing set up: no pointless retry timer");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await settle();
  await page.click("#syncNow");
  await page.waitForFunction(() =>
    /No cloud account or Google backend/.test(
      document.getElementById("syncDetail").textContent,
    ),
  );
  ok(true, "the message explains that no backend is set up");
  eq(
    await page.evaluate(() => [SyncBackoff.failures, SyncBackoff.timer]),
    [0, null],
    "and no retry was scheduled",
  );

  console.log("A failed sync retries by itself, then succeeds");
  await page.evaluate(async () => {
    SyncBackoff.delay = () => 300; // the real wait is 30 s or more; shortened so the test can watch it
    await GoogleBackend.configure(
      "https://script.google.com/macros/s/test/exec",
    );
  });
  failFirst = 1;
  const callsBefore = serverCalls;
  await page.click("#syncNow");
  await page.waitForFunction(() =>
    /Trying again automatically/.test(
      document.getElementById("syncDetail").textContent,
    ),
  );
  ok(true, "the first attempt failed and the screen says it will try again");
  ok(
    !(await db("sales")).some((s) => s.syncStatus === "synced"),
    "nothing was marked synced by the failed attempt",
  );
  // Poll from here: waitForFunction would treat an async predicate (a Promise) as already true.
  for (let i = 0; i < 60; i++) {
    if ((await db("sales")).every((s) => s.syncStatus === "synced")) break;
    await page.waitForTimeout(250);
  }
  ok(
    (await db("sales")).every((s) => s.syncStatus === "synced"),
    "the retry went through and the sales are synced",
  );
  await page.waitForFunction(() => SyncBackoff.failures === 0, null, {
    timeout: 5000,
  });
  ok(
    serverCalls >= callsBefore + 2,
    "a second attempt was made without anyone pressing a button",
  );
  eq(
    await page.evaluate(() => [SyncBackoff.failures, SyncBackoff.timer]),
    [0, null],
    "success resets the retry counter",
  );
  ok(
    /Sync complete/.test(await text("#syncStatus")),
    "and the screen says it is done",
  );

  console.log("A very long product list on a slow phone (4x slower CPU)");
  await page.evaluate(async () => {
    const d = await new Promise((res, rej) => {
      const r = indexedDB.open("mwakete-pos-v1");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const t = d.transaction(["products", "sales"], "readwrite");
      for (let i = 0; i < 5000; i++)
        t.objectStore("products").put({
          id: "bulk" + i,
          name: "Product " + i,
          price: 1 + (i % 50),
          stock: 10,
          sku: "SKU" + i,
          updatedAt: 1,
          cloudSyncedAt: 1,
        });
      for (let i = 0; i < 3000; i++)
        t.objectStore("sales").put({
          id: "bulk-sale-" + i,
          createdAt: 1000 + i,
          currency: "AUD",
          items: [
            {
              productId: "bulk" + i,
              name: "Product " + i,
              unitPrice: 1,
              quantity: 1,
            },
          ],
          total: 1,
          paymentMethod: "cash",
          paymentVerified: true,
          syncStatus: "synced",
        });
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
    d.close();
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const t0 = Date.now();
  await page.reload();
  await page.waitForSelector("#productGrid .product-card");
  const loadMs = Date.now() - t0;
  console.log(
    "    (5,000 products and 3,000 sales: the till was ready in " +
      loadMs +
      " ms at 4x CPU slowdown)",
  );
  ok(loadMs < 8000, "the till is ready in under 8 seconds");
  eq(
    await page.locator("#productGrid .product-card").count(),
    150,
    "only 150 product cards are drawn",
  );
  ok(
    /Showing 150 of 50\d\d/.test(await text("#productGrid")),
    "with a note saying so",
  );
  await page.fill("#productSearch", "SKU4999");
  await page.waitForFunction(
    () => document.querySelectorAll("#productGrid .product-card").length === 1,
  );
  ok(
    /Product 4999/.test(await text("#productGrid")),
    "search still finds a product that is not in the first 150",
  );
  await page.fill("#productSearch", "");
  await page.click('[data-view="products"]');
  ok(
    (await page.locator("#productTable tbody tr").count()) === 200,
    "the product list draws 200 rows",
  );
  ok(
    /Showing the first 200 of 50\d\d/.test(await text("#productTable")),
    "with a note about the rest",
  );
  await page.click('[data-view="sales"]');
  eq(
    await page.locator("#salesList .sale-row").count(),
    100,
    "the sales history draws the newest 100",
  );
  ok(
    /Showing the newest 100 of 30\d\d matching sales/.test(await text("#salesList")),
    "with a note about the rest",
  );
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message, (e.stack || "").split("\n").filter((l) => l.includes("e2e")).slice(0, 2).join(" | "));
  process.exit(1);
});
