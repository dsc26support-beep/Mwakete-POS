/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/pwa.e2e.js
 * Installability: manifest + icons served, install prompt button, update banner (never auto-reloads), sync backlog count,
 * and that a second visit works offline from the service worker cache.
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
  ".webmanifest": "application/manifest+json",
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
  const ctx = await browser.newContext(); // service worker allowed here
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
  await page.goto(base + "/");
  await page.waitForSelector("#year");

  console.log("Manifest and icons");
  const man = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]').href;
    const m = await (await fetch(link)).json();
    const sizes = [];
    for (const i of m.icons) {
      const r = await fetch(new URL(i.src, link));
      sizes.push([
        i.src.split("/").pop(),
        r.status,
        r.headers.get("content-type"),
      ]);
    }
    return { m, sizes };
  });
  ok(
    man.sizes.every((s) => s[1] === 200),
    "every icon in the manifest is served",
  );
  ok(
    man.sizes.some((s) => s[0] === "icon-512.png" && s[2] === "image/png"),
    "a 512 PNG icon exists",
  );
  ok(
    man.m.icons.some((i) => i.purpose === "maskable"),
    "there is a maskable icon",
  );

  console.log("Install button");
  await page.click('[data-view="setup"]');
  ok(
    (await page.innerText("#installText")).length > 10,
    "install advice is shown",
  );
  ok(
    await page.isHidden("#installBtn"),
    "no install button until the browser offers one",
  );
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = () => (window.__prompted = true);
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  ok(
    await page.isVisible("#installBtn"),
    "the install button appears when the browser offers install",
  );
  await page.click("#installBtn");
  await page.waitForTimeout(150);
  ok(
    await page.evaluate(() => window.__prompted === true),
    "pressing it shows the browser's install prompt",
  );
  ok(await page.isHidden("#installBtn"), "the button goes away afterwards");

  console.log("Update banner");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Reload until the page starts under a service worker (the banner only exists for an UPDATE of an installed app).
  for (let i = 0; i < 4; i++) {
    await page.reload();
    await page.waitForSelector("#year");
    if (await page.evaluate(() => !!navigator.serviceWorker.controller)) break;
    await page.waitForTimeout(1000);
  }
  ok(
    await page.evaluate(() => !!navigator.serviceWorker.controller),
    "the app is running under the service worker",
  );
  ok(await page.isHidden("#updateBar"), "no banner on a normal start");
  const urlBefore = page.url();
  await page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange")),
  );
  ok(await page.isVisible("#updateBar"), "a new version shows the banner");
  await page.waitForTimeout(500);
  eq(page.url(), urlBefore, "the page did not reload by itself");
  await page.click("#updateLater");
  ok(await page.isHidden("#updateBar"), "Later hides the banner");

  console.log("Sync backlog count");
  await page.evaluate(async () => {
    await POSDB.put("sales", {
      id: "w1",
      createdAt: Date.now(),
      paymentMethod: "cash",
      total: 1,
      items: [{ productId: "x", name: "X", unitPrice: 1, quantity: 1 }],
      syncStatus: "pending",
    });
    await POSDB.put("sales", {
      id: "w2",
      createdAt: Date.now(),
      paymentMethod: "cash",
      total: 1,
      items: [{ productId: "x", name: "X", unitPrice: 1, quantity: 1 }],
      syncStatus: "rejected",
    });
    await PwaUI.now();
  });
  ok(
    /1 waiting to sync, 1 refused by the cloud/.test(
      await page.innerText("#pendingCount"),
    ),
    "the sync card shows what is waiting",
  );

  console.log("Works offline on the next visit");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(2500);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector("#year");
  await page.waitForFunction(
    () => typeof PwaUI !== "undefined" && document.getElementById("syncStatus"),
    null,
    { timeout: 10000 },
  );
  ok(await page.isVisible("#syncStatus"), "the app opens offline");
  await page
    .waitForFunction(
      () =>
        /Offline/i.test(document.getElementById("connectionText").textContent),
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
  ok(
    /Offline/i.test(await page.innerText("#connectionText")),
    "the connection badge says offline",
  );
  await ctx.setOffline(false);

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
