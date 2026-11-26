/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/share.e2e.js
 * Sending a receipt: button on the receipt pop-up and after every sale, WhatsApp / email links, and the phone's share
 * sheet with a PDF or picture attached (share sheet faked: the shared files are captured and inspected).
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
  await page.addInitScript(() => {
    window.__shared = [];
    window.__opened = [];
    HTMLAnchorElement.prototype.click = function () {
      if (this.target === "_blank") window.__opened.push(this.href);
    };
    window.__canShare = true;
    navigator.canShare = (d) =>
      window.__canShare && !!(d && d.files && d.files.length);
    navigator.share = async (d) => {
      const files = [];
      for (const f of d.files || []) {
        const head = Array.from(
          new Uint8Array(await f.arrayBuffer()).slice(0, 8),
        );
        files.push({ name: f.name, type: f.type, size: f.size, head });
      }
      window.__shared.push({ title: d.title, text: d.text, files });
    };
  });
  await page.goto(base + "/");
  await page.waitForSelector("#year");
  const sell = async () => {
    await page.click('[data-view="sale"]');
    await page.click('[data-add="p1"]');
    const sel = page.locator("#saleCustomer");
    if (await sel.isVisible()) await sel.selectOption("c1");
    await page.click("#checkout");
    await page.waitForTimeout(400);
  };
  await page.evaluate(async () => {
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

  console.log(
    "Counter: no receipt pop-up, but the last receipt can still be sent",
  );
  ok(
    await page.isHidden("#sendLast"),
    "no 'send the last receipt' button before any sale",
  );
  await sell();
  ok(await page.isVisible("#sendLast"), "after a sale the button appears");
  await page.click("#sendLast");
  await page.waitForSelector("#deliveryPanel:not(.hidden)");
  ok(
    /Test Shop – Receipt R-/.test(await page.inputValue("#deliveryText")),
    "the receipt text is ready",
  );
  ok(
    await page.isVisible("#shareBox"),
    "file sharing is offered where the phone supports it",
  );
  await page.click("#deliveryCancel");

  console.log("Retail: Send / share… on the receipt pop-up");
  await page.evaluate(async () => {
    await TierCore.setTier(POSDB, "retail");
    await TierUI.apply();
  });
  await sell();
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  await page.click("#receiptSend");
  await page.waitForSelector("#deliveryPanel:not(.hidden)");
  ok(await page.isHidden("#receiptPanel"), "the receipt pop-up closes");
  eq(
    await page.inputValue("#deliveryTo"),
    "72123456",
    "the customer's phone is filled in",
  );

  console.log("WhatsApp and email with the full number / address");
  await page.selectOption("#deliveryChannel", "whatsapp");
  await page.click('#deliveryForm button[type="submit"]');
  await page.waitForTimeout(300);
  ok(
    (await page.evaluate(() => window.__opened))
      .at(-1)
      .startsWith("https://wa.me/68672123456?text="),
    "WhatsApp opens the customer's chat with the receipt",
  );
  await page.click("#sendLast");
  await page.selectOption("#deliveryChannel", "email");
  await page.fill("#deliveryTo", "teuea@example.com");
  await page.click('#deliveryForm button[type="submit"]');
  await page.waitForTimeout(300);
  ok(
    (await page.evaluate(() => window.__opened))
      .at(-1)
      .startsWith("mailto:teuea%40example.com?subject="),
    "email opens a message to the customer",
  );

  console.log("Share sheet with a PDF attached");
  await page.click("#sendLast");
  await page.click("#deliverySharePdf");
  await page.waitForTimeout(500);
  let shared = await page.evaluate(() => window.__shared);
  eq(shared.length, 1, "the share sheet was opened once");
  const pdf = shared[0].files[0];
  ok(
    /^receipt-R-[A-Z0-9]{4}-\d{4}\.pdf$/.test(pdf.name),
    "file name is receipt-<number>.pdf",
  );
  eq(
    [pdf.type, pdf.head.slice(0, 5)],
    ["application/pdf", [37, 80, 68, 70, 45]],
    "it is a real PDF (%PDF-)",
  );
  ok(pdf.size > 300, "the PDF has content");
  ok(
    /Receipt R-/.test(shared[0].text) || /Test Shop/.test(shared[0].text),
    "a short text goes with it",
  );
  ok(await page.isHidden("#deliveryPanel"), "the dialog closes after sharing");

  console.log("Share sheet with a picture attached");
  await page.click("#sendLast");
  await page.click("#deliveryShareImg");
  await page.waitForTimeout(700);
  shared = await page.evaluate(() => window.__shared);
  const png = shared[1].files[0];
  eq(
    [png.type, png.head],
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
    "it is a real PNG",
  );
  ok(png.size > 1000, "the picture has content");

  console.log("Phones that cannot attach files only get the link buttons");
  await page.evaluate(() => (window.__canShare = false));
  await page.click("#sendLast");
  await page.waitForSelector("#deliveryPanel:not(.hidden)");
  ok(await page.isHidden("#shareBox"), "no file buttons");
  ok(
    await page.isVisible("#deliveryChannel"),
    "WhatsApp / SMS / email are still there",
  );
  await page.click("#deliveryCancel");

  console.log("Sharing is written to the activity log");
  const log = await page.evaluate(async () =>
    (await POSDB.get("settings", "auditLog")).value.map(
      (e) => e.action + ":" + e.detail,
    ),
  );
  ok(
    log.some((l) => /receipt-send:Shared receipt PDF/.test(l)) &&
      log.some((l) => /receipt-send:Shared receipt picture/.test(l)),
    "both shares are logged",
  );

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
