/* Accessibility scan (not part of `npm test`): needs Playwright + Chromium.
 *   cd tests/a11y && npm install && NODE_PATH=$(npm root -g) node a11y.e2e.js
 * Runs axe-core (WCAG 2.0/2.1 A and AA rules, including colour contrast) on every screen, in every business type, and on the
 * dialogs, with realistic data on screen. Any violation fails the run.
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "../..");
const axeSource = fs.readFileSync(
  require.resolve("axe-core/axe.min.js"),
  "utf8",
);
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

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://localhost:" + server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 },
  }); // a small phone
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(base + "/");
  await page.waitForSelector("#year");
  await page.addScriptTag({ content: axeSource });

  // Realistic data so lists, tables and rows are on screen.
  await page.evaluate(async () => {
    const now = Date.now();
    await TierCore.setTier(POSDB, "wholesale");
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
      category: "Food",
      reorderLevel: 5,
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "b",
      name: "Salt",
      price: 5,
      stock: 2,
      sku: "S",
      taxExempt: true,
      reorderLevel: 5,
      updatedAt: 1,
    });
    await POSDB.put("sales", {
      id: "s-plain-0001",
      createdAt: now - 5000,
      currency: "AUD",
      items: [
        { productId: "a", name: "Rice 25kg", unitPrice: 40, quantity: 1 },
      ],
      total: 40,
      paymentMethod: "cash",
      paymentVerified: true,
      syncStatus: "pending",
    });
    await POSDB.put("sales", {
      id: "s-inv-0002",
      createdAt: now - 4000,
      currency: "AUD",
      customerId: "c1",
      items: [
        { productId: "a", name: "Rice 25kg", unitPrice: 50, quantity: 2 },
      ],
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
    await POSDB.put("refunds", {
      id: "r1",
      number: "CN-TEST-0001",
      saleId: "s-plain-0001",
      method: "cash",
      total: 10,
      items: [{ lineIndex: 0, name: "Rice 25kg", unitPrice: 40, quantity: 1 }],
      createdAt: now - 3000,
      syncStatus: "pending",
    });
    await POSDB.put("registers", {
      id: "g1",
      openedAt: now - 9000,
      closedAt: now - 8000,
      openingFloat: 50,
      countedCash: 90,
      expectedCash: 90,
      difference: 0,
      salesCount: 1,
      syncStatus: "pending",
    });
    await POSDB.put("stockMoves", {
      id: "m1",
      productId: "a",
      productName: "Rice 25kg",
      delta: 24,
      reason: "purchase",
      createdAt: now - 2000,
      syncStatus: "pending",
    });
    await POSDB.put("suppliers", {
      id: "sup1",
      name: "Pacific Traders",
      phone: "+686 12345",
      updatedAt: now,
      syncStatus: "pending",
    });
    await POSDB.put("purchaseOrders", {
      id: "po1",
      number: "PO-TEST-0001",
      supplierName: "Pacific Traders",
      status: "ordered",
      items: [{ productId: "a", name: "Rice 25kg", qty: 24, unitCost: 30 }],
      total: 720,
      createdAt: now - 1000,
      updatedAt: now,
      syncStatus: "pending",
    });
    await POSDB.put("quotes", {
      id: "q1",
      number: "QT-TEST-0001",
      customerId: "c1",
      customerName: "Trade Co",
      status: "open",
      items: [
        { productId: "a", name: "Rice 25kg", unitPrice: 45, quantity: 3 },
      ],
      subtotal: 135,
      tax: 16.88,
      total: 151.88,
      createdAt: now - 500,
      updatedAt: now - 500,
      validUntil: now + 86400000 * 7,
      syncStatus: "pending",
    });
    await POSDB.put("settings", {
      key: "registerOpen",
      value: { id: "open1", openedAt: now - 1000, openingFloat: 20 },
    });
    await refresh();
    await TierUI.apply();
  });

  const results = [];
  async function scan(label) {
    const r = await page.evaluate(async () =>
      (
        await axe.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
          },
          resultTypes: ["violations"],
        })
      ).violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes
          .slice(0, 4)
          .map(
            (n) =>
              n.target.join(" ") +
              " :: " +
              (n.failureSummary || "").split("\n").slice(1, 2).join(" ").trim(),
          ),
      })),
    );
    results.push(...r.map((v) => ({ where: label, ...v })));
    console.log(
      (r.length ? "  ✗ " : "  ✓ ") +
        label +
        (r.length ? " — " + r.map((v) => v.id).join(", ") : ""),
    );
  }

  for (const tier of ["counter", "retail", "wholesale"]) {
    console.log("Business type: " + tier);
    await page.evaluate(async (t) => {
      await TierCore.setTier(POSDB, t);
      await TierUI.apply();
    }, tier);
    const views = await page.$$eval(
      ".tab[data-view]:not(.hidden):not(.role-hidden)",
      (els) => els.map((e) => e.dataset.view),
    );
    for (const v of views) {
      await page.click('.tab[data-view="' + v + '"]');
      await scan(tier + " / " + v);
    }
  }

  console.log("Dialogs and documents (Wholesale)");
  await page.click('.tab[data-view="sales"]');
  await page.click(".sale-row[data-sale-id]");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  await scan("receipt dialog");
  await page.click("#receiptRefund");
  await page.waitForSelector("#refundPanel:not(.hidden)");
  await scan("refund dialog");
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    document.getElementById("receiptPanel").classList.add("hidden"),
  );
  await page.click('.tab[data-view="sale"]');
  await page.click("#resumeSale");
  await page.waitForSelector("#heldPanel:not(.hidden)");
  await scan("held sales dialog");
  await page.click("#heldClose");
  await page.click('.tab[data-view="products"]');
  await page.evaluate(async () => {
    await POSDB.put("products", {
      id: "a11y1",
      name: "Scan item",
      price: 2,
      stock: 0,
      updatedAt: 1,
    });
    await refresh();
  });
  await page.click('[data-edit="a11y1"]');
  await page.waitForSelector("#productEditPanel:not(.hidden)");
  await scan("product edit dialog");
  await page.click("#productEditCancel");
  await scan("product list with alerts and bulk bar");
  await page.evaluate(() => {
    document.getElementById("onboardPanel").classList.remove("hidden");
    document.getElementById("setupCard").classList.remove("hidden");
    document.getElementById("updateBar").classList.remove("hidden");
  });
  await scan("set-up dialog, set-up card and update bar");
  await page.evaluate(() => {
    document.getElementById("onboardPanel").classList.add("hidden");
    document.getElementById("setupCard").classList.add("hidden");
    document.getElementById("updateBar").classList.add("hidden");
  });
  await page.evaluate(() =>
    document.getElementById("scanPanel").classList.remove("hidden"),
  );
  await scan("camera scan dialog");
  await page.evaluate(() =>
    document.getElementById("scanPanel").classList.add("hidden"),
  );
  await page.evaluate(() =>
    document.getElementById("approvePanel").classList.remove("hidden"),
  );
  await scan("manager approval dialog");
  await page.evaluate(() =>
    document.getElementById("approvePanel").classList.add("hidden"),
  );
  await page.evaluate(() =>
    document.getElementById("lockScreen").classList.remove("hidden"),
  );
  await scan("lock screen");
  await page.evaluate(() =>
    document.getElementById("lockScreen").classList.add("hidden"),
  );
  await page.click('.tab[data-view="setup"]');
  await scan("signed-out cloud account panel");

  console.log("Keyboard: a dialog traps focus and gives it back");
  await page.click('.tab[data-view="sales"]');
  await page.focus(".sale-row[data-sale-id]");
  const rowId = await page.evaluate(
    () => document.activeElement.dataset.saleId,
  );
  await page.keyboard.press("Enter");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  const inside = () =>
    page.evaluate(() =>
      document.getElementById("receiptPanel").contains(document.activeElement),
    );
  assert.ok(await inside(), "focus moves into the dialog when it opens");
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    assert.ok(
      await inside(),
      "Tab stays inside the dialog (press " + (i + 1) + ")",
    );
  }
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Shift+Tab");
    assert.ok(
      await inside(),
      "Shift+Tab stays inside the dialog (press " + (i + 1) + ")",
    );
  }
  await page.keyboard.press("Escape");
  await page.waitForSelector("#receiptPanel.hidden", { state: "attached" });
  assert.equal(
    await page.evaluate(
      () => document.activeElement && document.activeElement.dataset.saleId,
    ),
    rowId,
    "focus returns to the row that opened it",
  );
  console.log(
    "  ✓ Enter opens, Tab and Shift+Tab stay inside, Escape closes, focus returns",
  );

  await browser.close();
  server.close();

  if (errors.length) console.log("\nPage errors:\n  " + errors.join("\n  "));
  if (results.length) {
    console.log("\n" + results.length + " accessibility violation(s):");
    for (const r of results) {
      console.log(
        "\n[" + r.impact + "] " + r.id + " — " + r.help + "  (" + r.where + ")",
      );
      for (const n of r.nodes) console.log("    " + n);
    }
  }
  assert.deepEqual(errors, [], "no page errors");
  assert.equal(results.length, 0, "no accessibility violations");
  console.log("\nAll screens pass the automated accessibility scan.");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
