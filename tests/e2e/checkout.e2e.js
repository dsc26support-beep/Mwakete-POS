/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/checkout.e2e.js
 * Checkout: cash change due, exact cash, EFTPOS/M-PAiSA references, split payment, validation, hold / resume, register cash.
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
  await page.evaluate(async () => {
    await TierCore.setTier(POSDB, "retail");
    await TierUI.apply();
    await POSDB.put("products", {
      id: "p1",
      name: "Tea",
      price: 12.5,
      stock: 20,
      sku: "T",
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "p2",
      name: "Rice",
      price: 5,
      stock: 20,
      sku: "R",
      updatedAt: 1,
    });
    await refresh();
  });
  const sales = () => page.evaluate(() => POSDB.all("sales"));
  const last = async () =>
    (await sales()).sort((a, b) => b.createdAt - a.createdAt)[0];
  const addTea = async () => {
    await page.click('[data-view="sale"]');
    await page.click('[data-add="p1"]');
  };
  const closeReceipt = async () => {
    await page.waitForTimeout(200);
    if (await page.locator("#receiptPanel:not(.hidden)").count())
      await page.click("#receiptClose");
  };

  console.log("Cash with change");
  await addTea();
  ok(await page.isVisible("#tenderRow"), "cash received box is shown for cash");
  await page.fill("#cashTendered", "20");
  ok(
    /Change due: 7\.50/.test(await page.innerText("#changeDue")),
    "change due is shown live (20.00 for 12.50 = 7.50)",
  );
  await page.click("#checkout");
  await closeReceipt();
  let s = await last();
  eq(
    [s.paymentMethod, s.paymentVerified, s.tendered, s.change],
    ["cash", true, 20, 7.5],
    "sale stores tendered 20, change 7.50, cash verified",
  );
  eq(
    s.payments,
    [{ method: "cash", amount: 12.5 }],
    "payment line is 12.50 cash",
  );

  console.log("Short cash is refused, nothing saved");
  const before = (await sales()).length;
  await addTea();
  await page.fill("#cashTendered", "10");
  ok(
    /Short by 2\.50/.test(await page.innerText("#changeDue")),
    "shortfall is shown",
  );
  await page.click("#checkout");
  await page.waitForTimeout(200);
  eq((await sales()).length, before, "no sale was saved for short cash");
  ok(
    (await page.evaluate(() => cart.length)) === 1,
    "the cart is kept after the refusal",
  );

  console.log("Exact cash when the box is empty");
  await page.fill("#cashTendered", "");
  await page.click("#checkout");
  await closeReceipt();
  s = await last();
  eq(
    [s.change, s.tendered],
    [0, 12.5],
    "empty box means exact cash, no change",
  );

  console.log("M-PAiSA with a reference is never verified");
  await addTea();
  await page.selectOption("#paymentMethod", "mpaisa");
  ok(await page.isVisible("#refRow"), "reference box shows for digital");
  ok(await page.isHidden("#tenderRow"), "cash box hidden for digital");
  await page.fill("#payRef", "MP-12345");
  const dlg = dialogs.length;
  await page.click("#checkout");
  await closeReceipt();
  s = await last();
  eq(
    [s.paymentMethod, s.paymentVerified],
    ["mpaisa", false],
    "recorded, not verified",
  );
  eq(
    s.payments,
    [{ method: "mpaisa", amount: 12.5, reference: "MP-12345" }],
    "reference stored",
  );
  ok(
    dialogs.length === dlg + 1 &&
      /NOT verify|does NOT verify/i.test(dialogs[dialogs.length - 1]),
    "the unverified warning was shown",
  );

  console.log("Split: EFTPOS 5.00 + cash for the rest with change");
  await page.selectOption("#paymentMethod", "cash");
  await addTea();
  await page.check("#splitOn");
  await page.selectOption("#splitMethod", "eftpos");
  await page.fill("#splitAmount", "5");
  await page.fill("#splitRef", "EF-9");
  await page.fill("#cashTendered", "10");
  await page.click("#checkout");
  await closeReceipt();
  s = await last();
  eq(s.paymentMethod, "split", "method is split");
  eq(s.paymentVerified, false, "split with a digital part is not verified");
  eq(
    s.payments,
    [
      { method: "eftpos", amount: 5, reference: "EF-9" },
      { method: "cash", amount: 7.5 },
    ],
    "eftpos 5.00 + cash part 7.50",
  );
  eq([s.tendered, s.change], [10, 2.5], "10.00 handed over, 2.50 change");
  ok(!(await page.isChecked("#splitOn")), "split switch resets after the sale");

  console.log("Split that does not add up is refused");
  const n = (await sales()).length;
  await addTea();
  await page.selectOption("#paymentMethod", "mpaisa");
  await page.check("#splitOn");
  await page.selectOption("#splitMethod", "eftpos");
  await page.fill("#splitAmount", "99");
  await page.click("#checkout");
  await page.waitForTimeout(200);
  eq((await sales()).length, n, "overpaying a split saves nothing");
  await page.uncheck("#splitOn");
  await page.selectOption("#paymentMethod", "cash");

  console.log("Receipt shows payment lines and change");
  await page.click('[data-view="sales"]');
  await page.click(".sale-row[data-sale-id]");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  const rtext = await page.innerText("#receiptBody");
  ok(
    /EFTPOS\/card \(NOT verified\)[\s\S]*ref EF-9/.test(rtext) &&
      /Change/.test(rtext),
    "receipt lists the EFTPOS line with its reference and the change",
  );
  await page.click("#receiptClose");

  console.log("Hold and resume");
  await page.click('[data-view="sale"]');
  ok(
    await page.isEnabled("#holdSale"),
    "Hold is enabled while the cart has items",
  );
  await page.evaluate(() => {
    cart = [];
    renderCart();
  });
  ok(await page.isDisabled("#holdSale"), "Hold is disabled for an empty cart");
  await page.click('[data-add="p1"]');
  await page.click('[data-add="p2"]');
  await page.click("#holdSale");
  await page.waitForTimeout(200);
  eq(await page.evaluate(() => cart.length), 0, "cart is empty after Hold");
  eq(await page.innerText("#heldCount"), "1", "one sale is held");
  await page.click('[data-add="p2"]');
  await page.click("#resumeSale");
  await page.click("[data-resume]");
  await page.waitForTimeout(200);
  eq(
    await page.evaluate(() => cart.length),
    1,
    "resume refused while the cart has items",
  );
  await page.click("#heldClose");
  await page.evaluate(() => {
    cart = [];
    renderCart();
  });
  await page.click("#resumeSale");
  await page.click("[data-resume]");
  await page.waitForTimeout(300);
  eq(
    await page.evaluate(() => cart.length),
    2,
    "held sale is back in the cart",
  );
  eq(await page.innerText("#heldCount"), "0", "nothing is held any more");

  console.log("Held sale survives a reload");
  await page.click("#holdSale");
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForSelector("#year");
  await page
    .waitForFunction(
      () => document.getElementById("heldCount").textContent === "1",
      null,
      { timeout: 5000 },
    )
    .catch(() => {});
  eq(
    await page.innerText("#heldCount"),
    "1",
    "held sale is still there after reload",
  );
  await page.click("#resumeSale");
  await page.click("[data-discard]");
  await page.waitForTimeout(200);
  eq(await page.innerText("#heldCount"), "0", "discarding removes it");
  await page.click("#heldClose");

  console.log("Held sale drops a product that was deleted meanwhile");
  await page.evaluate(() => {
    cart = [];
  });
  await page.click('[data-add="p1"]');
  await page.click('[data-add="p2"]');
  await page.click("#holdSale");
  await page.waitForTimeout(200);
  await page.evaluate(async () => {
    await POSDB.remove("products", "p2");
    await refresh();
  });
  await page.click("#resumeSale");
  await page.click("[data-resume]");
  await page.waitForTimeout(300);
  eq(
    await page.evaluate(() => cart.map((x) => x.id)),
    ["p1"],
    "deleted product is removed on resume",
  );

  console.log("Register counts only the cash part");
  const exp = await page.evaluate(() => {
    const open = { openedAt: 0 };
    return RegisterCore.summarize(
      open,
      [
        {
          createdAt: 5,
          paymentMethod: "split",
          total: 12.5,
          payments: [
            { method: "eftpos", amount: 5 },
            { method: "cash", amount: 7.5 },
          ],
        },
      ],
      [],
      [],
      10,
    ).cashSales;
  });
  eq(exp, 7.5, "register cash sales include only the cash part of a split");

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
