/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/csv.e2e.js
 * CSV product import (preview first, problems listed, duplicates, stock kept) and export.
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
  const ctx = await browser.newContext({
    serviceWorkers: "block",
    acceptDownloads: true,
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

  const text = (sel) => page.innerText(sel).then((s) => s.replace(/\s+/g, " "));
  const products = () => page.evaluate(() => POSDB.all("products"));
  const byName = async () =>
    Object.fromEntries((await products()).map((p) => [p.name, p]));
  const pick = async (csv) => {
    await page.setInputFiles("#csvFile", {
      name: "products.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });
    await page.waitForFunction(
      () => document.getElementById("csvPreview").textContent.length > 0,
    );
  };

  await page.click('[data-view="products"]');
  await page.click("#csvPanel summary");

  console.log("Preview shows problems and saves nothing");
  await pick(
    [
      "Product Name,Barcode,Selling Price,Qty,Category",
      "Tea,T1,2.50,10,Drinks",
      'Jam,J1,"1,200.00",4,',
      "Salt,S1,abc,1,",
      ",X1,1,1,",
      "Tea again,T1,3,1,",
      "Rice,R1,40,1.5,",
    ].join("\r\n"),
  );
  ok(
    /2 to add/.test(await text("#csvPreview")) &&
      /4 with problems/.test(await text("#csvPreview")),
    "2 products are good, 4 rows have problems",
  );
  const pv = await text("#csvPreview");
  ok(
    /Row 4: price must be a number/.test(pv) &&
      /Row 5: needs a product name/.test(pv) &&
      /Row 6: is the same product as row 2/.test(pv) &&
      /Row 7: stock must be a whole number/.test(pv),
    "each problem names its row and reason",
  );
  eq((await products()).length, 0, "nothing was saved yet");
  ok(
    /Import 2 product/.test(await text("#csvImport")),
    "the button says how many will be imported",
  );

  console.log("Import");
  await page.click("#csvImport");
  await page.waitForFunction(
    () => document.getElementById("csvPreview").textContent === "",
  );
  let p = await byName();
  eq(
    Object.keys(p).sort(),
    ["Jam", "Tea"],
    "the two good products were imported",
  );
  eq(
    [
      p.Tea.price,
      p.Tea.stock,
      p.Tea.sku,
      p.Tea.category,
      p.Jam.price,
      p.Jam.stock,
    ],
    [2.5, 10, "T1", "Drinks", 1200, 4],
    "with the right values",
  );
  ok(
    typeof p.Tea.updatedAt === "number" && !!p.Tea.id,
    "and an id and timestamp, so they sync",
  );
  ok(/Tea/.test(await text("#productTable")), "they show in the product list");

  console.log(
    "Duplicates: skipped by default, updated on request, stock kept unless asked",
  );
  await pick("name,barcode,price,stock\nTea,T1,9,99\nSalt,S1,1,5\n");
  ok(
    /1 to add/.test(await text("#csvPreview")) &&
      /1 already here/.test(await text("#csvPreview")),
    "the known product is skipped, the new one added",
  );
  await page.selectOption("#csvDup", "update");
  ok(
    /1 to update/.test(await text("#csvPreview")),
    "choosing update shows it as an update",
  );
  await page.click("#csvImport");
  await page.waitForFunction(
    () => document.getElementById("csvPreview").textContent === "",
  );
  p = await byName();
  eq(
    [p.Tea.price, p.Tea.stock, !!p.Salt],
    [9, 10, true],
    "price updated, stock count kept, new product added",
  );
  await pick("name,barcode,price,stock\nTea,T1,9,77\n");
  await page.selectOption("#csvDup", "update");
  await page.check("#csvStock");
  await page.click("#csvImport");
  await page.waitForFunction(
    () => document.getElementById("csvPreview").textContent === "",
  );
  eq(
    (await byName()).Tea.stock,
    77,
    "stock replaced only when the box is ticked",
  );

  console.log("A file whose headings are not recognised can be mapped by hand");
  await pick("Thing,Amount\nPepper,4.20\n");
  ok(
    /product name/.test(await text("#csvPreview")),
    "it asks which column is the name",
  );
  await page.selectOption('[data-csv-field="name"]', "0");
  await page.selectOption('[data-csv-field="price"]', "1");
  ok(
    /1 to add/.test(await text("#csvPreview")),
    "after choosing the columns the preview works",
  );
  await page.click("#csvImport");
  await page.waitForFunction(
    () => document.getElementById("csvPreview").textContent === "",
  );
  eq((await byName()).Pepper.price, 4.2, "and the product is imported");

  console.log("Bad files are refused with a message");
  await page.setInputFiles("#csvFile", {
    name: "x.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(""),
  });
  await page.waitForFunction(() =>
    /empty/.test(document.getElementById("toast").textContent),
  );
  ok(true, "an empty file is refused");
  await page.setInputFiles("#csvFile", {
    name: "x.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('name,price\n"Tea,2'),
  });
  await page.waitForFunction(() =>
    /never closed/.test(document.getElementById("toast").textContent),
  );
  ok(true, "a file with an unclosed quote is refused");

  console.log("Export");
  await page.evaluate(() =>
    POSDB.put("products", {
      id: "evil",
      name: '=HYPERLINK("http://evil")',
      price: 1,
      stock: 1,
      sku: "",
      updatedAt: 1,
    }),
  );
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#csvExport"),
  ]);
  ok(
    /^products-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()),
    "the file is named products-<date>.csv",
  );
  const body = fs.readFileSync(await dl.path(), "utf8");
  ok(
    body.startsWith("﻿name,sku,price,stock,category,reorderLevel"),
    "it has the headings (and a BOM so Excel reads it right)",
  );
  ok(
    /Tea,T1,9\.00,77,Drinks,/.test(body) && /Jam,J1,1200\.00,4/.test(body),
    "it lists the products",
  );
  ok(
    body.includes('"\'=HYPERLINK(""http://evil"")"'),
    "a formula-looking name is neutralised",
  );

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
