/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/delivery.e2e.js
 * Receipt delivery queue: validation, queue, send (link opened), confirm, fail, retry, cancel, persistence; customer fields.
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
  // Capture links instead of really opening another app.
  await page.addInitScript(() => {
    window.__opened = [];
    HTMLAnchorElement.prototype.click = function () {
      if (this.target === "_blank") window.__opened.push(this.href);
    };
  });
  await page.goto(base + "/");
  await page.waitForSelector("#year");
  await page.evaluate(async () => {
    await TierCore.setTier(POSDB, "retail");
    await TierUI.apply();
    await POSDB.put("settings", { key: "businessName", value: "Test Shop" });
    await POSDB.put("customers", {
      id: "c1",
      name: "Teuea",
      phone: "72123456",
      email: "teuea@example.com",
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "p1",
      name: "Tea",
      price: 4,
      stock: 9,
      sku: "T",
      updatedAt: 1,
    });
    await refresh();
  });
  await page.click('[data-view="sale"]');
  await page.click('[data-add="p1"]');
  await page.selectOption("#saleCustomer", "c1");
  await page.click("#checkout");
  await page.waitForTimeout(300);
  if (await page.locator("#receiptPanel:not(.hidden)").count())
    await page.click("#receiptClose");

  console.log("Open the send dialog from sale details");
  await page.click('[data-view="sales"]');
  await page.click("[data-txn]");
  await page.click("#txnSend");
  await page.waitForSelector("#deliveryPanel:not(.hidden)");
  eq(
    await page.inputValue("#deliveryChannel"),
    "sms",
    "SMS is chosen when the customer has a phone",
  );
  eq(
    await page.inputValue("#deliveryTo"),
    "72123456",
    "the customer's phone is filled in",
  );
  ok(
    /Test Shop – Receipt R-/.test(await page.inputValue("#deliveryText")),
    "short receipt text is prepared",
  );
  await page.selectOption("#deliveryChannel", "email");
  ok(
    /TOTAL/.test(await page.inputValue("#deliveryText")),
    "email gets the full receipt text",
  );
  await page.selectOption("#deliveryChannel", "sms");

  console.log("Bad recipient is refused and nothing is queued");
  await page.fill("#deliveryTo", "12");
  await page.click("#deliveryQueue");
  ok(
    /7 to 15 digits/.test(await page.innerText("#deliveryError")),
    "short phone number is refused",
  );
  eq(
    await page.locator("#deliveryList .resource-row").count(),
    0,
    "queue is still empty",
  );

  console.log("Queue it, then send");
  await page.fill("#deliveryTo", "72123456");
  await page.click("#deliveryQueue");
  await page.waitForSelector("#deliveryPanel.hidden", { state: "attached" });
  ok(
    /Queued/.test(await page.innerText("#deliveryList")),
    "message shows as Queued",
  );
  await page.click('[data-act="send"]');
  await page.waitForTimeout(200);
  ok(
    /Sending/.test(await page.innerText("#deliveryList")),
    "status becomes Sending",
  );
  const opened = await page.evaluate(() => window.__opened);
  ok(
    opened.length === 1 && opened[0].startsWith("sms:+68672123456?&body="),
    "the SMS app link was opened with the number",
  );
  await page.click('[data-act="fail"]');
  await page.waitForTimeout(200);
  ok(
    /Failed/.test(await page.innerText("#deliveryList")),
    "can be marked Failed",
  );
  await page.click('[data-act="retry"]');
  await page.waitForTimeout(200);
  ok(
    /Retry pending/.test(await page.innerText("#deliveryList")),
    "retry puts it in Retry pending",
  );
  await page.click('[data-act="send"]');
  await page.waitForTimeout(200);
  await page.click('[data-act="done"]');
  await page.waitForTimeout(200);
  ok(
    /Delivered \(you confirmed\)/.test(await page.innerText("#deliveryList")),
    "Delivered is labelled as confirmed by the user",
  );
  eq(
    await page.locator("#deliveryList [data-act]").count(),
    0,
    "no actions remain on a delivered message",
  );
  const q = await page.evaluate(
    async () => (await POSDB.get("settings", "deliveryQueue")).value,
  );
  eq(
    [q[0].attempts, q[0].history.map((h) => h.status).join(">")],
    [2, "Queued>Sending>Failed>Retry pending>Sending>Delivered"],
    "history and attempts are recorded",
  );

  console.log("Send now via WhatsApp, cancel, and persistence");
  await page.click("[data-txn]");
  await page.click("#txnSend");
  await page.selectOption("#deliveryChannel", "whatsapp");
  await page.fill("#deliveryTo", "+61 400 123 456");
  await page.click('#deliveryForm button[type="submit"]');
  await page.waitForTimeout(200);
  const op2 = await page.evaluate(() => window.__opened);
  ok(
    op2.at(-1).startsWith("https://wa.me/61400123456?text="),
    "WhatsApp link uses the full international number",
  );
  await page.click('[data-act="cancel"]');
  await page.waitForTimeout(200);
  ok(
    /Cancelled/.test(await page.innerText("#deliveryList")),
    "a sending message can be cancelled",
  );
  await page.reload();
  await page.waitForSelector("#year");
  await page.click('[data-view="sales"]');
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll("#deliveryList .resource-row").length === 2,
      null,
      { timeout: 5000 },
    )
    .catch(() => {});
  eq(
    await page.locator("#deliveryList .resource-row").count(),
    2,
    "the queue survives a reload",
  );

  console.log("Email link is encoded safely");
  await page.click("[data-txn]");
  await page.click("#txnSend");
  await page.selectOption("#deliveryChannel", "email");
  await page.fill("#deliveryTo", "a@b.com");
  await page.click('#deliveryForm button[type="submit"]');
  await page.waitForTimeout(200);
  const op3 = (await page.evaluate(() => window.__opened)).at(-1);
  ok(
    op3.startsWith("mailto:a%40b.com?subject=") && !/[\r\n ]/.test(op3),
    "mailto link has no raw line breaks or spaces",
  );

  console.log("Customer details");
  await page.click('[data-view="customers"]');
  await page.fill('#customerForm [name="name"]', "Maria");
  await page.fill('#customerForm [name="email"]', "not-an-email");
  await page.fill('#customerForm [name="category"]', "Staff");
  await page.click('#customerForm button[type="submit"]');
  await page.waitForTimeout(300);
  const before = await page.evaluate(
    async () => (await POSDB.all("customers")).length,
  );
  eq(before, 1, "an invalid email is refused");
  await page.fill('#customerForm [name="email"]', "maria@example.com");
  await page.fill('#customerForm [name="address"]', "Betio");
  await page.click('#customerForm button[type="submit"]');
  await page.waitForTimeout(300);
  const m = await page.evaluate(async () =>
    (await POSDB.all("customers")).find((c) => c.name === "Maria"),
  );
  eq(
    [m.email, m.category, m.address],
    ["maria@example.com", "Staff", "Betio"],
    "email, group and address are saved",
  );

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
