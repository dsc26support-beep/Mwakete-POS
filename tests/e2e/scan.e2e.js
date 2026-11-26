/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/scan.e2e.js
 * Barcode: hardware-scanner bursts, typing is not a scan, unknown barcode -> new product, archived product,
 * camera scanning (faked camera and detector), Counter edition unchanged.
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
  // A fake camera + detector: the detector "sees" whatever window.__seen holds.
  await page.addInitScript(() => {
    window.__seen = null;
    window.BarcodeDetector = class {
      async detect() {
        return window.__seen ? [{ rawValue: window.__seen }] : [];
      }
    };
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    const g = c.getContext("2d");
    setInterval(() => {
      g.fillStyle =
        "#" +
        Math.floor(Math.random() * 0xffffff)
          .toString(16)
          .padStart(6, "0");
      g.fillRect(0, 0, 16, 16);
    }, 50);
    const md = navigator.mediaDevices;
    if (md) md.getUserMedia = async () => c.captureStream(20);
  });
  await page.goto(base + "/");
  await page.waitForSelector("#year");
  const cartQty = () =>
    page.evaluate(() => cart.reduce((n, x) => n + x.qty, 0));
  const setTier = (t) =>
    page.evaluate(async (x) => {
      await TierCore.setTier(POSDB, x);
      await TierUI.apply();
    }, t);
  await page.evaluate(async () => {
    await POSDB.put("products", {
      id: "p1",
      name: "Tea",
      price: 4,
      stock: 9,
      sku: "9310000000012",
      updatedAt: 1,
    });
    await POSDB.put("products", {
      id: "p2",
      name: "Old stock",
      price: 2,
      stock: 3,
      sku: "1111222233",
      archived: true,
      updatedAt: 1,
    });
    await refresh();
  });

  console.log("Counter keeps the original behaviour");
  await page.click('[data-view="sale"]');
  ok(await page.isHidden("#scanCamera"), "no camera button in Counter");
  await page.keyboard.type("9310000000012");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  eq(await cartQty(), 0, "a scanner burst does nothing in Counter");

  console.log("Retail: hardware scanner anywhere on the till");
  await setTier("retail");
  await page.click('[data-view="sale"]');
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.type("9310000000012");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  eq(await cartQty(), 1, "a fast burst + Enter adds the product");
  await page.keyboard.type("931", { delay: 120 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  eq(await cartQty(), 1, "slow typing is not treated as a scan");

  console.log("Search box scan still works");
  await page.fill("#productSearch", "9310000000012");
  await page.press("#productSearch", "Enter");
  await page.waitForTimeout(300);
  eq(await cartQty(), 2, "Enter in the search box adds it");
  eq(await page.inputValue("#productSearch"), "", "and clears the box");

  console.log("Archived product cannot be sold");
  await page.fill("#productSearch", "1111222233");
  await page.press("#productSearch", "Enter");
  await page.waitForTimeout(300);
  eq(await cartQty(), 2, "archived product is not added");
  ok(
    /archived/.test(await page.innerText("#toast")),
    "the cashier is told why",
  );
  await page.fill("#productSearch", "");
  await page.dispatchEvent("#productSearch", "input");

  console.log("Unknown barcode -> new product");
  const before = dialogs.length;
  await page.fill("#productSearch", "5000000000017");
  await page.press("#productSearch", "Enter");
  await page.waitForTimeout(400);
  ok(
    dialogs.length === before + 1 && /5000000000017/.test(dialogs.at(-1)),
    "asked whether to add the unknown barcode",
  );
  ok(await page.isVisible("#view-products"), "the Products screen opens");
  eq(
    await page.inputValue('#productForm [name="sku"]'),
    "5000000000017",
    "the barcode is filled in",
  );
  ok(
    await page.evaluate(() => document.activeElement.name === "name"),
    "focus is on the name box",
  );
  await page.fill('#productForm [name="name"]', "Biscuits");
  await page.fill('#productForm [name="price"]', "3.5");
  await page.click('#productForm button[type="submit"]');
  await page.waitForTimeout(300);
  const made = await page.evaluate(async () =>
    (await POSDB.all("products")).find((p) => p.sku === "5000000000017"),
  );
  ok(
    made && made.name === "Biscuits",
    "the new product is saved with that barcode",
  );

  console.log("Camera scanning");
  await page.click('[data-view="sale"]');
  ok(
    await page.isVisible("#scanCamera"),
    "camera button shows when the browser supports it",
  );
  await page.click("#scanCamera");
  await page.waitForSelector("#scanPanel:not(.hidden)");
  await page.evaluate(() => (window.__seen = "5000000000017"));
  await page.waitForTimeout(900);
  eq(
    await cartQty(),
    3,
    "the camera adds the product once, not once per frame",
  );
  await page.evaluate(() => (window.__seen = null));
  await page.click("#scanClose");
  ok(await page.isHidden("#scanPanel"), "Done closes the camera");
  const live = await page.evaluate(
    () => document.getElementById("scanVideo").srcObject === null,
  );
  ok(live, "the camera stream is released");

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
