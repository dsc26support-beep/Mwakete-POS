/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/security.e2e.js
 * Screen lock (PIN, idle, lock-out), activity log chain and tamper warning, device name, device id on sales.
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
  await page.goto(base + "/");
  await page.waitForSelector("#year");
  await page.evaluate(async () => {
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
  const settle = () => page.waitForTimeout(250);

  console.log("A sale carries the device id and a receipt number");
  await page.click('[data-view="sale"]');
  await page.click('[data-add="p1"]');
  await page.click("#checkout");
  await settle();
  const sale = (await page.evaluate(() => POSDB.all("sales")))[0];
  ok(
    /^[A-Z0-9]{4}$/.test(sale.deviceId || ""),
    "sale has a 4-character device id",
  );
  ok(
    sale.receiptNo.includes(sale.deviceId),
    "receipt number is built from the same device id",
  );

  console.log("Device name");
  await page.click('[data-view="setup"]');
  await page.fill('#deviceForm [name="deviceName"]', "Front till");
  await page.click('#deviceForm button[type="submit"]');
  await settle();
  eq(
    await page.evaluate(
      async () => (await POSDB.get("settings", "deviceName")).value,
    ),
    "Front till",
    "device name is saved",
  );
  ok(
    (await page.innerText("#deviceCodeText")).trim().length === 4,
    "device code is shown",
  );
  await page.fill('#deviceForm [name="deviceName"]', "   ");
  await page.click('#deviceForm button[type="submit"]');
  await settle();
  eq(
    await page.evaluate(
      async () => (await POSDB.get("settings", "deviceName")).value,
    ),
    "Front till",
    "a blank name is refused",
  );

  console.log("PIN rules");
  await page.fill('#pinForm [name="pin"]', "1234");
  await page.click('#pinForm button[type="submit"]');
  await settle();
  eq(
    await page.evaluate(() => POSDB.get("settings", "pinRecord")),
    undefined,
    "a simple PIN is refused",
  );
  await page.selectOption("#idleSelect", "5");
  await page.fill('#pinForm [name="pin"]', "");
  await page.click('#pinForm button[type="submit"]');
  await settle();
  eq(
    await page.evaluate(() => POSDB.get("settings", "idleMinutes")),
    undefined,
    "idle lock needs a PIN first",
  );

  console.log("Set a PIN, lock, wrong then right PIN");
  await page.selectOption("#idleSelect", "1");
  await page.fill('#pinForm [name="pin"]', "739204");
  await page.click('#pinForm button[type="submit"]');
  await page.waitForTimeout(1200); // hashing rounds
  const rec = await page.evaluate(
    async () => (await POSDB.get("settings", "pinRecord")).value,
  );
  ok(
    rec.hash && rec.salt && !JSON.stringify(rec).includes("739204"),
    "the PIN is stored hashed with a salt",
  );
  await page.click("#lockNow");
  await page.waitForSelector("#lockScreen:not(.hidden)");
  ok(
    await page.evaluate(() => document.activeElement.id === "lockPin"),
    "focus goes to the PIN box",
  );
  await page.fill("#lockPin", "000000");
  await page.click('#lockForm button[type="submit"]');
  await page.waitForTimeout(1200);
  ok(
    /not right/.test(await page.innerText("#lockError")),
    "wrong PIN is refused",
  );
  ok(await page.isVisible("#lockScreen"), "still locked after a wrong PIN");
  await page.fill("#lockPin", "739204");
  await page.click('#lockForm button[type="submit"]');
  await page.waitForTimeout(1200);
  ok(await page.isHidden("#lockScreen"), "the right PIN unlocks");

  console.log("Lock-out after five wrong PINs");
  await page.click("#lockNow");
  await page.waitForSelector("#lockScreen:not(.hidden)");
  for (let i = 0; i < 5; i++) {
    await page.fill("#lockPin", "55555" + i);
    await page.click('#lockForm button[type="submit"]');
    await page.waitForTimeout(1100);
  }
  ok(
    /Wait \d+ seconds/.test(await page.innerText("#lockError")),
    "the fifth wrong PIN starts a wait",
  );
  await page.fill("#lockPin", "739204");
  await page.click('#lockForm button[type="submit"]');
  await page.waitForTimeout(1200);
  ok(
    await page.isVisible("#lockScreen"),
    "even the right PIN is refused during the wait",
  );

  console.log("Reopening the app locks it again");
  await page.evaluate(() =>
    POSDB.put("settings", {
      key: "pinFail",
      value: { fails: 0, lockedUntil: 0 },
    }),
  );
  await page.reload();
  await page.waitForSelector("#year");
  await page.waitForSelector("#lockScreen:not(.hidden)");
  ok(true, "the lock screen appears when the app is opened");
  await page.fill("#lockPin", "739204");
  await page.click('#lockForm button[type="submit"]');
  await page.waitForTimeout(1200);
  ok(await page.isHidden("#lockScreen"), "unlocked again");

  console.log("Activity log");
  await page.click('[data-view="setup"]');
  const entries = await page.evaluate(
    async () => (await POSDB.get("settings", "auditLog")).value,
  );
  const names = entries.map((e) => e.action);
  ok(
    ["device-rename", "pin-set", "lock", "unlock", "unlock-failed"].every((a) =>
      names.includes(a),
    ),
    "renames, PIN, lock, unlock and wrong PIN are all logged",
  );
  ok(
    /Chain check passed/.test(await page.innerText("#auditState")),
    "chain check passes",
  );
  ok(!JSON.stringify(entries).includes("739204"), "no PIN appears in the log");

  console.log("Tampering is detected");
  await page.evaluate(async () => {
    const v = (await POSDB.get("settings", "auditLog")).value;
    v[1].detail = "edited by hand";
    await POSDB.put("settings", { key: "auditLog", value: v });
  });
  await page.reload();
  await page.waitForSelector("#lockScreen:not(.hidden)");
  await page.fill("#lockPin", "739204");
  await page.click('#lockForm button[type="submit"]');
  await page.waitForTimeout(1200);
  await page.click('[data-view="setup"]');
  ok(
    /Warning: the activity log was changed/.test(
      await page.innerText("#auditState"),
    ),
    "an edited entry shows a warning",
  );

  console.log("Remove the PIN");
  await page.click("#pinClear");
  await settle();
  eq(
    await page.evaluate(() => POSDB.get("settings", "pinRecord")),
    undefined,
    "PIN removed",
  );
  await page.reload();
  await page.waitForSelector("#year");
  await page.waitForTimeout(500);
  ok(await page.isHidden("#lockScreen"), "no lock screen without a PIN");

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
