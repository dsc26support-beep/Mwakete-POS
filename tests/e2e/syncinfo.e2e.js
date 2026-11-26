/* Browser test (not part of `npm test`): needs Playwright + Chromium.
 *   NODE_PATH=$(npm root -g) node tests/e2e/syncinfo.e2e.js
 * Sync history: finished runs are listed, repeats collapse, the list is capped at 20 and can be cleared.
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
  const page = await (
    await browser.newContext({ serviceWorkers: "block" })
  ).newPage();
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
  await page.click('[data-view="setup"]');
  ok(
    /No sync has finished/.test(await page.innerText("#syncHistory")),
    "starts empty with a clear message",
  );

  console.log("Runs are listed");
  await page.evaluate(async () => {
    await PwaUI.logSync("Sync complete", "3 record(s) synchronised.");
    await PwaUI.logSync(
      "Sync needs attention",
      "No internet. Trying again automatically.",
    );
  });
  eq(
    await page.locator("#syncHistory .resource-row").count(),
    2,
    "two runs listed",
  );
  ok(
    /Sync needs attention/.test(
      await page.locator("#syncHistory .resource-row").first().innerText(),
    ),
    "newest first",
  );

  console.log("Repeats collapse");
  await page.evaluate(async () => {
    await PwaUI.logSync(
      "Sync needs attention",
      "No internet. Trying again automatically.",
    );
    await PwaUI.logSync(
      "Sync needs attention",
      "No internet. Trying again automatically.",
    );
  });
  eq(
    await page.locator("#syncHistory .resource-row").count(),
    2,
    "the same message again within a minute is not added",
  );

  console.log("Capped at 20, survives a reload, can be cleared");
  await page.evaluate(async () => {
    for (let i = 0; i < 30; i++)
      await PwaUI.logSync("Sync complete", "run " + i);
  });
  eq(
    await page.locator("#syncHistory .resource-row").count(),
    20,
    "only the newest 20 are kept",
  );
  await page.reload();
  await page.waitForSelector("#year");
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll("#syncHistory .resource-row").length === 20,
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  eq(
    await page.locator("#syncHistory .resource-row").count(),
    20,
    "the list is still there after a reload",
  );
  await page.click('[data-view="setup"]');
  await page.click("#syncHistoryClear");
  await page.waitForTimeout(200);
  ok(
    /No sync has finished/.test(await page.innerText("#syncHistory")),
    "Clear history empties it",
  );

  console.log("A real finished sync writes to the history");
  await page.evaluate(() =>
    setSyncUI("Sync complete", "0 record(s) synchronised."),
  );
  await page.waitForTimeout(300);
  ok(
    /Sync complete/.test(await page.innerText("#syncHistory")),
    "setSyncUI feeds the history",
  );
  await page.evaluate(() => setSyncUI("Syncing…", "1 record(s) being sent."));
  await page.waitForTimeout(200);
  eq(
    await page.locator("#syncHistory .resource-row").count(),
    1,
    "in-progress messages are not logged",
  );

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
