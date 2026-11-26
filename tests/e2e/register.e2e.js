/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/register.e2e.js
 * Cash register shifts: open with a float, sell, refund, see the expected cash, close balanced and short, read the report.
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
  const sell = async () => {
    await page.click('[data-view="sale"]');
    await page.click("[data-add]");
    await page.click("#checkout");
    await page.waitForTimeout(200);
    if (await page.locator("#receiptPanel:not(.hidden)").count())
      await page.click("#receiptClose");
  };
  const text = (sel) => page.innerText(sel).then((s) => s.replace(/\s+/g, " "));

  console.log("Counter has no register");
  ok(
    await page.isHidden('[data-view="register"]'),
    "no Register tab on Counter",
  );

  console.log("Retail: open, sell, refund");
  await setTier("retail");
  await page.evaluate(async () => {
    await POSDB.put("products", {
      id: "p1",
      name: "Tea",
      price: 10,
      stock: 9,
      sku: "T",
      updatedAt: 1,
    });
    await refresh();
  });
  ok(
    await page.isVisible('[data-view="register"]'),
    "Register tab shows on Retail",
  );
  await page.click('[data-view="register"]');
  await page.fill('#registerOpenForm [name="float"]', "-5");
  await page.click('#registerOpenForm button[type="submit"]');
  ok(await page.isVisible("#registerClosed"), "a negative float is refused");
  await page.fill('#registerOpenForm [name="float"]', "50");
  await page.click('#registerOpenForm button[type="submit"]');
  await page.waitForSelector("#registerOpen:not(.hidden)");
  ok(
    /Expected in the drawer 50\.00/.test(await text("#registerLive")),
    "expected cash starts at the float",
  );

  await sell();
  await sell();
  await page.click('[data-view="register"]');
  ok(
    /Cash sales \(2\) 20\.00/.test(await text("#registerLive")) &&
      /Expected in the drawer 70\.00/.test(await text("#registerLive")),
    "two 10.00 cash sales raise expected cash to 70.00",
  );

  // refund one tea in cash
  await page.click('[data-view="sales"]');
  await page.click(".sale-row[data-sale-id]");
  await page.click("#receiptRefund");
  await page.fill('#refundLines [data-line="0"]', "1");
  await page.click("#refundConfirm");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  await page.click("#receiptClose");
  await page.click('[data-view="register"]');
  ok(
    /Cash refunds 10\.00/.test(await text("#registerLive")) &&
      /Expected in the drawer 60\.00/.test(await text("#registerLive")),
    "a 10.00 cash refund lowers expected cash to 60.00",
  );

  console.log("Close short: warning, then the shift report");
  await page.fill('#registerCloseForm [name="counted"]', "55");
  ok(
    /Short by 5\.00/.test(await text("#registerDiff")),
    "the difference is shown before closing",
  );
  await page.fill('#registerCloseForm [name="note"]', "Coin tray");
  await page.click('#registerCloseForm button[type="submit"]');
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  ok(
    dialogs.some((d) => /Short by 5\.00/.test(d)),
    "closing short asks for confirmation",
  );
  const rep = await text("#receiptBody");
  ok(
    /REGISTER SHIFT REPORT/.test(rep) &&
      /EXPECTED IN DRAWER 60\.00/.test(rep) &&
      /COUNTED 55\.00/.test(rep) &&
      /DIFFERENCE -5\.00/.test(rep) &&
      /Note: Coin tray/.test(rep),
    "the report shows expected, counted and difference",
  );
  await page.click("#receiptClose");
  const regs = await page.evaluate(() => POSDB.all("registers"));
  eq(
    [
      regs.length,
      regs[0].difference,
      regs[0].cashSales,
      regs[0].cashRefunds,
      regs[0].salesCount,
      regs[0].syncStatus,
    ],
    [1, -5, 20, 10, 2, "pending"],
    "the closed shift is saved as pending",
  );
  ok(await page.isVisible("#registerClosed"), "the register is closed again");
  eq(
    await page.evaluate(() => POSDB.get("settings", "registerOpen")),
    undefined,
    "the open-shift marker is cleared",
  );
  ok(
    /Short by 5\.00/.test(await text("#registerList")),
    "the past shifts list shows it",
  );
  await page.click("#registerList [data-shift-id]");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  ok(
    /REGISTER SHIFT REPORT/.test(await text("#receiptBody")),
    "a past shift can be reopened",
  );
  await page.click("#receiptClose");

  console.log("A second shift starts clean and closes balanced");
  await page.fill('#registerOpenForm [name="float"]', "20");
  await page.click('#registerOpenForm button[type="submit"]');
  await page.waitForSelector("#registerOpen:not(.hidden)");
  ok(
    /Cash sales \(0\) 0\.00/.test(await text("#registerLive")) &&
      /Expected in the drawer 20\.00/.test(await text("#registerLive")),
    "earlier sales do not carry into the new shift",
  );
  await page.fill('#registerCloseForm [name="counted"]', "20");
  const before = dialogs.length;
  await page.click('#registerCloseForm button[type="submit"]');
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  eq(dialogs.length, before, "a balanced close needs no confirmation");
  ok(/Balanced/.test(await text("#receiptBody")), "the report says balanced");
  await page.click("#receiptClose");
  eq(
    (await page.evaluate(() => POSDB.all("registers"))).length,
    2,
    "two shifts are stored",
  );

  console.log("Switching back to Counter keeps the data and hides the tab");
  await setTier("counter");
  ok(
    await page.isHidden('[data-view="register"]'),
    "Register tab hidden again",
  );
  eq(
    (await page.evaluate(() => POSDB.all("registers"))).length,
    2,
    "shifts are kept",
  );

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
