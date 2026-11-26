/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/scan-bundled.e2e.js
 * Camera scanning with the BUNDLED reader (vendor/): the browser's own BarcodeDetector is removed, a real EAN-13 barcode
 * is drawn on a canvas and used as the fake camera picture, and the product must be added by really decoding it.
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
  ".wasm": "application/wasm",
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

// EAN-13 with a correct check digit, as a string of bars (1 = black module).
const L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const G = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];
const R = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
];
const PAR = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGLGLG",
  "LGGLLG",
  "LGGGLL",
  "LGLGGL",
  "LGGLGL",
];
function ean13(twelve) {
  let sum = 0;
  [...twelve].forEach((d, i) => (sum += Number(d) * (i % 2 ? 3 : 1)));
  const full = twelve + ((10 - (sum % 10)) % 10);
  const par = PAR[Number(full[0])];
  let bits = "101";
  for (let i = 0; i < 6; i++)
    bits += (par[i] === "L" ? L : G)[Number(full[i + 1])];
  bits += "01010";
  for (let i = 7; i < 13; i++) bits += R[Number(full[i])];
  return { code: full, bits: bits + "101" };
}
const BAR = ean13("931000000001");

(async () => {
  // BASE_URL lets the same test run against the hosting emulator, so the real security headers are in force.
  if (!process.env.BASE_URL)
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base =
    process.env.BASE_URL || "http://localhost:" + server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  const fetched = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !/fonts\.g|ERR_|Failed to load resource/.test(m.text())
    )
      errors.push(m.text());
  });
  page.on("response", (r) => {
    if (/\/vendor\//.test(r.url()))
      fetched.push(r.url().split("/").pop() + " " + r.status());
  });
  page.on("dialog", (d) => d.accept());
  await page.addInitScript((bits) => {
    // No built-in reader in this browser: the bundled one must be used.
    delete window.BarcodeDetector;
    const c = document.createElement("canvas");
    c.width = 480;
    c.height = 240;
    const g = c.getContext("2d");
    const draw = () => {
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#000";
      const m = 4;
      const x0 = (c.width - bits.length * m) / 2;
      for (let i = 0; i < bits.length; i++)
        if (bits[i] === "1") g.fillRect(x0 + i * m, 50, m, 140);
    };
    draw();
    setInterval(draw, 100);
    const md = navigator.mediaDevices;
    if (md) md.getUserMedia = async () => c.captureStream(15);
  }, BAR.bits);
  await page.goto(base + "/");
  await page.waitForSelector("#year");
  await page.evaluate(async (code) => {
    await TierCore.setTier(POSDB, "retail");
    await TierUI.apply();
    await POSDB.put("products", {
      id: "p1",
      name: "Biscuits",
      price: 3.5,
      stock: 9,
      sku: code,
      updatedAt: 1,
    });
    await refresh();
  }, BAR.code);

  console.log(
    "The camera button shows although the browser has no built-in reader",
  );
  await page.click('[data-view="sale"]');
  ok(await page.isVisible("#scanCamera"), "camera button is visible");
  eq(
    await page.evaluate(() => typeof window.BarcodeDetector),
    "undefined",
    "the browser really has no BarcodeDetector",
  );
  ok(
    !(await page.evaluate(() => !!window.BarcodeDetectionAPI)),
    "the bundled reader is not loaded until needed",
  );

  console.log("Scanning with the bundled reader");
  await page.click("#scanCamera");
  await page.waitForSelector("#scanPanel:not(.hidden)", { timeout: 20000 });
  let added = false;
  for (let i = 0; i < 60 && !added; i++) {
    added = (await page.evaluate(() => cart.length)) > 0;
    if (!added) await page.waitForTimeout(500);
  }
  ok(
    added,
    "the drawn barcode " + BAR.code + " was decoded and the product added",
  );
  eq(
    await page.evaluate(() => cart[0].name),
    "Biscuits",
    "it is the right product",
  );
  ok(
    fetched.some((f) => f.startsWith("barcode-detector.iife.js 200")),
    "the reader script came from this site (vendor/)",
  );
  ok(
    fetched.some((f) => f.startsWith("zxing_reader.wasm 200")),
    "the decoder came from this site, not the internet",
  );
  await page.waitForTimeout(1500);
  eq(
    await page.evaluate(() => cart[0].qty),
    1,
    "the same frame is not counted again and again",
  );
  ok(
    await page.isHidden("#scanTorch"),
    "no light button when the camera has no torch",
  );
  await page.click("#scanClose");
  ok(await page.isHidden("#scanPanel"), "Done closes the camera");

  eq(errors, [], "no page errors");
  await browser.close();
  if (server.listening) server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
