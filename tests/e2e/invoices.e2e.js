/* Browser test (not part of `npm test`): needs Playwright + Chromium.  npm run test:e2e
 * Seeds a v3 database (what live Wholesale installs have after PR 1), upgrades it to v4, then exercises invoices,
 * credit accounts and sync against the REAL google-apps-script/Code.gs (loaded in a Node vm behind page.route).
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { load } = require("../helpers/gas.js");

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
  if (p === "/__blank") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<html></html>");
  }
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
  await new Promise((r) => server.listen(0, r));
  const base = "http://localhost:" + server.address().port;
  const gas = load(); // ledger OFF to start
  let serverCalls = 0;
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.route("https://script.google.com/**", async (route) => {
    serverCalls++;
    const result = gas.post(route.request().postData() || "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(result),
    });
  });
  const page = await ctx.newPage();
  const errors = [];
  const dialogs = [];
  let acceptDialogs = true;
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
    acceptDialogs ? d.accept() : d.dismiss();
  });
  const dump = () =>
    page.evaluate(async () => ({
      p: await POSDB.all("products"),
      s: await POSDB.all("sales"),
      c: await POSDB.all("customers"),
      pay: await POSDB.all("payments"),
      st: Object.fromEntries(
        (await POSDB.all("settings")).map((x) => [x.key, x.value]),
      ),
    }));
  const sync = async () => {
    await page.click("#syncNow");
    await page.waitForFunction(() => !POSSynchroniser.running);
    await page.waitForTimeout(150);
  };
  const sell = async (customerLabel, cards, method) => {
    await page.click('[data-view="sale"]');
    await page.selectOption(
      "#saleCustomer",
      customerLabel ? { label: customerLabel } : { value: "" },
    );
    for (const c of cards)
      await page
        .locator("#productGrid .product-card[data-add]", { hasText: c })
        .click();
    await page.selectOption("#paymentMethod", method);
    await page.click("#checkout");
  };

  console.log("Migration: existing v3 (Wholesale part 1) install -> v4");
  await page.goto(base + "/__blank");
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("mwakete-pos-v1", 3);
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore("products", { keyPath: "id" }).createIndex(
            "sku",
            "sku",
            { unique: false },
          );
          d.createObjectStore("sales", { keyPath: "id" }).createIndex(
            "createdAt",
            "createdAt",
          );
          d.createObjectStore("settings", { keyPath: "key" });
          d.createObjectStore("customers", { keyPath: "id" }).createIndex(
            "name",
            "name",
          );
          d.createObjectStore("priceLists", { keyPath: "id" });
        };
        req.onsuccess = () => {
          const d = req.result,
            t = d.transaction(
              ["products", "sales", "settings", "customers", "priceLists"],
              "readwrite",
            );
          t.objectStore("products").put({
            id: "rice",
            name: "Rice",
            price: 100,
            stock: 50,
            sku: "RICE",
            updatedAt: 1,
          });
          t.objectStore("products").put({
            id: "salt",
            name: "Salt",
            price: 10,
            stock: 100,
            sku: "SALT",
            taxExempt: true,
            updatedAt: 1,
          });
          t.objectStore("sales").put({
            id: "old-s",
            createdAt: 5,
            currency: "AUD",
            tier: "wholesale",
            subtotal: 40,
            total: 40,
            items: [
              { productId: "rice", name: "Rice", unitPrice: 40, quantity: 1 },
            ],
            paymentMethod: "cash",
            paymentVerified: true,
            syncStatus: "pending",
          });
          for (const [key, value] of Object.entries({
            tier: "wholesale",
            businessName: "Trade Shop",
            currency: "AUD",
            taxRate: 12.5,
            taxNumber: "S-100",
            apiUrl: "https://script.google.com/macros/s/TEST/exec",
          }))
            t.objectStore("settings").put({ key, value });
          t.objectStore("customers").put({
            id: "c1",
            name: "Moote Trading",
            phone: "",
            notes: "",
            type: "trade",
            creditLimit: 300,
            terms: "30 days",
            taxNumber: "TX-9",
            createdAt: 1,
          });
          t.oncomplete = () => {
            d.close();
            resolve();
          };
          t.onerror = () => reject(t.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  await page.goto(base + "/");
  await page.waitForSelector("#productGrid .product-card");
  let d = await dump();
  eq(
    d.p.map((x) => x.id).sort(),
    ["rice", "salt"],
    "existing products survive v3 -> v4",
  );
  eq(
    d.s.map((x) => [x.id, x.syncStatus]),
    [["old-s", "pending"]],
    "existing pending sale survives",
  );
  eq(
    d.c.map((x) => x.id),
    ["c1"],
    "existing trade customer survives",
  );
  eq(
    await page.evaluate(() => POSDB.all("payments")),
    [],
    "new payments store exists and is empty",
  );

  console.log("Accounts screen and warnings");
  ok(
    await page.locator('[data-view="accounts"]').isVisible(),
    "Accounts tab visible in Wholesale",
  );
  await page.click('[data-view="accounts"]');
  ok(
    /not production-ready/.test(
      await page.locator("#view-accounts .notice.warn").innerText(),
    ),
    "not-production-ready banner is shown",
  );
  ok(
    /never confirmed/.test(await page.locator("#accountList").innerText()),
    "a never-synced balance says 'never confirmed'",
  );
  ok(
    (await page.locator('#paymentMethod option[value="account"]').count()) ===
      1,
    "'On account (invoice)' payment option exists",
  );

  console.log("Invoice 1: on account, with an exempt line");
  await sell("Moote Trading", ["Rice", "Rice", "Salt"], "account");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  const inv1 = await page.locator("#receiptBody").innerText();
  ok(
    /TAX INVOICE INV-[A-Z0-9]{4}-0001/.test(inv1),
    "invoice number is INV-<device code>-0001",
  );
  ok(
    /Tax no: S-100/.test(inv1) &&
      /Customer: Moote Trading/.test(inv1) &&
      /Customer tax no: TX-9/.test(inv1),
    "seller and customer tax numbers shown",
  );
  ok(
    /Salt \(exempt\)/.test(inv1) &&
      /Tax 12\.5%\s+25\.00/.test(inv1) &&
      /TOTAL AUD\s+235\.00/.test(inv1),
    "tax 12.5% on the taxable 200 only: total 235.00",
  );
  ok(
    /ON ACCOUNT - 30 days/.test(inv1) &&
      /Pending: not yet confirmed/.test(inv1),
    "on account, terms, and not yet confirmed",
  );
  eq(dialogs.length, 0, "no over-limit warning (235 < 300 limit)");
  await page.click("#receiptClose");
  d = await dump();
  const s1 = d.s.find((x) => x.invoice && x.invoice.number.endsWith("-0001"));
  ok(
    s1.total === 235 &&
      s1.tax === 25 &&
      s1.subtotal === 210 &&
      s1.paymentMethod === "account" &&
      s1.paymentVerified === false &&
      s1.syncStatus === "pending",
    "sale saved: gross total 235, tax 25, account, unverified, pending",
  );
  eq(
    s1.items.map((i) => [i.name, !!i.taxExempt]),
    [
      ["Rice", false],
      ["Salt", true],
    ]
      .map(([n, e]) => [n, e])
      .slice(0, 2),
    "exempt flag is carried on the item",
  );
  eq(
    [
      d.p.find((x) => x.id === "rice").stock,
      d.p.find((x) => x.id === "salt").stock,
    ],
    [48, 99],
    "stock reduced",
  );

  console.log("Invoice 2: over the credit limit -> warning -> confirmed");
  await sell("Moote Trading", ["Rice"], "account");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  eq(dialogs.length, 1, "exactly one over-limit warning");
  ok(
    /OVER CREDIT LIMIT/.test(dialogs[0]) &&
      /347\.50/.test(dialogs[0]) &&
      /over by 47\.50/.test(dialogs[0]) &&
      /never confirmed/.test(dialogs[0]),
    "warning shows projected 347.50, limit and 47.50 over, and that the balance was never confirmed",
  );
  await page.click("#receiptClose");

  console.log("Over the limit and declined -> no sale, no number used");
  acceptDialogs = false;
  const before = (await dump()).s.length;
  await sell("Moote Trading", ["Rice"], "account");
  await page.waitForTimeout(300);
  d = await dump();
  eq(d.s.length, before, "declining the warning creates no sale");
  eq(d.st.invoiceSeq, 2, "no invoice number was consumed");
  ok(!(await page.locator("#receiptPanel").isVisible()), "no invoice shown");
  acceptDialogs = true;
  await page.click("#clearCart");

  console.log("On account without a trade customer is refused");
  await sell(null, ["Rice"], "account");
  await page.waitForTimeout(200);
  ok(
    /Choose a trade customer/.test(await page.textContent("#toast")),
    "asks for a trade customer",
  );
  eq((await dump()).s.length, before, "no sale created");
  await page.click("#clearCart");

  console.log("Walk-in cash sale becomes a paid tax invoice");
  await sell(null, ["Salt", "Salt"], "cash");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  const paid = await page.locator("#receiptBody").innerText();
  ok(
    /Customer: Walk-in/.test(paid) &&
      /Paid: Cash/.test(paid) &&
      /Tax 12\.5%\s+0\.00/.test(paid) &&
      /TOTAL AUD\s+20\.00/.test(paid),
    "walk-in paid invoice, exempt goods, tax 0.00",
  );
  await page.click("#receiptClose");
  d = await dump();
  eq(
    d.s.find((x) => x.invoice && x.invoice.number.endsWith("-0003")).invoice
      .mode,
    "paid",
    "paid invoice 0003 saved",
  );

  console.log("Balances before any sync");
  await page.click('[data-view="accounts"]');
  const rowText = await page.locator("#accountList").innerText();
  ok(
    /pending on this device 347\.50/.test(rowText) &&
      /OVER LIMIT/.test(rowText),
    "pending 347.50 and OVER LIMIT shown",
  );

  console.log("Sync with the ledger OFF: rejected, never marked synced");
  await sync();
  d = await dump();
  const byNum = (n) =>
    d.s.find((x) => x.invoice && x.invoice.number.endsWith(n));
  eq(
    [byNum("-0001").syncStatus, byNum("-0002").syncStatus],
    ["rejected", "rejected"],
    "both account invoices rejected",
  );
  ok(
    /Ledger not enabled/.test(byNum("-0001").syncError),
    "the reason is stored on the record",
  );
  eq(
    byNum("-0003").syncStatus,
    "rejected",
    "the paid invoice is an invoice too, so it is rejected while the ledger is off",
  );
  eq(
    d.s.find((x) => x.id === "old-s").syncStatus,
    "synced",
    "the old plain sale synced (plain sales never need the ledger)",
  );
  ok(
    /Sync needs attention/.test(await page.textContent("#syncStatus")),
    "sync status says it needs attention",
  );
  await page.click('[data-view="accounts"]');
  ok(
    (await page.locator("#rejectedBox").isVisible()) &&
      (await page.textContent("#rejectedCount")) === "3",
    "Accounts shows 3 rejected records",
  );
  ok(
    /Ledger not enabled/.test(await page.locator("#invoiceList").innerText()),
    "the reason is visible in the invoice list",
  );
  const calls = serverCalls;
  await sync();
  eq(
    [
      serverCalls,
      (await dump()).s.filter((x) => x.syncStatus === "rejected").length,
    ],
    [calls, 3],
    "rejected records are kept and NOT re-sent blindly (no extra server call), none dropped",
  );

  console.log("Owner turns the ledger ON, retries, and the ledger confirms");
  gas.props.LEDGER_ENABLED = "true";
  await page.click("[data-retry-rejected]");
  await page.waitForFunction(async () =>
    (await POSDB.all("sales")).every((s) => s.syncStatus !== "rejected"),
  );
  await sync();
  d = await dump();
  eq(
    d.s.filter((x) => x.invoice).map((x) => x.syncStatus),
    ["synced", "synced", "synced"],
    "all three invoices confirmed by the ledger",
  );
  eq(d.st.balances.c1.amount, 347.5, "balance comes from the server: 347.50");
  eq(
    [
      gas.rows("Invoices").length,
      gas.rows("Customers").length,
      gas.rows("Sales").length,
    ],
    [4, 2, 5],
    "server sheets: 3 invoices, 1 customer seeded, 4 sales",
  );
  eq(
    gas.rows("Customers")[1].slice(0, 3),
    ["c1", "Moote Trading", 300],
    "the credit limit was seeded in the owner's Sheet",
  );
  // Rows arrive in database-key order, so whichever invoice crosses the 300 limit gets the flag: exactly one does.
  eq(
    gas
      .rows("Invoices")
      .slice(1)
      .filter((r) => r[15] === "YES")
      .map((r) => r[13]),
    ["account"],
    "exactly one account invoice is flagged over limit on the server",
  );
  await page.click('[data-view="accounts"]');
  const row2 = await page.locator("#accountList").innerText();
  ok(
    /Confirmed 347\.50 \(as of /.test(row2) &&
      /pending on this device 0\.00/.test(row2) &&
      /OVER LIMIT/.test(row2),
    "Accounts: confirmed 347.50, nothing pending, still over limit",
  );
  ok(!(await page.locator("#rejectedBox").isVisible()), "rejected box is gone");

  console.log("Payment received");
  await page.selectOption("#paymentCustomer", { label: "Moote Trading" });
  await page.fill("#paymentForm [name=amount]", "100");
  await page.fill("#paymentForm [name=note]", "part payment");
  await page.click("#paymentForm button[type=submit]");
  await page.waitForFunction(
    async () => (await POSDB.all("payments")).length === 1,
  );
  await page.waitForFunction(() =>
    /pending on this device -100\.00/.test(
      document.getElementById("accountList").innerText,
    ),
  );
  ok(true, "pending shows -100.00 before sync");
  await page.fill("#paymentForm [name=amount]", "0");
  await page.evaluate(() => {
    document.getElementById("paymentForm").noValidate = true;
  });
  await page.selectOption("#paymentCustomer", { label: "Moote Trading" });
  await page.click("#paymentForm button[type=submit]");
  await page.waitForTimeout(150);
  eq((await dump()).pay.length, 1, "a zero payment is rejected");
  await sync();
  d = await dump();
  eq(
    [d.pay[0].syncStatus, d.pay[0].amount, d.st.balances.c1.amount],
    ["synced", 100, 247.5],
    "payment confirmed; server balance 247.50",
  );
  ok(
    !/OVER LIMIT/.test(await page.locator("#accountList").innerText()),
    "OVER LIMIT clears once the balance is under 300",
  );
  eq(gas.rows("Payments").length, 2, "payment stored once on the server");
  await sync();
  eq(
    gas.rows("Payments").length,
    2,
    "a second sync does not duplicate anything",
  );

  console.log("A poison record does not block the others");
  await page.evaluate(async () => {
    const bad = (await POSDB.all("sales")).find((s) => s.invoice);
    await POSDB.put("sales", {
      ...bad,
      id: "poison",
      invoice: { ...bad.invoice, number: "INV-ZZZZ-0099", tax: 1 },
      tax: 1,
      syncStatus: "pending",
    });
    await POSDB.put("sales", {
      id: "good-plain",
      createdAt: Date.now(),
      currency: "AUD",
      tier: "wholesale",
      subtotal: 5,
      total: 5,
      items: [{ productId: "salt", name: "Salt", unitPrice: 5, quantity: 1 }],
      paymentMethod: "cash",
      paymentVerified: true,
      syncStatus: "pending",
    });
  });
  await sync();
  d = await dump();
  eq(
    [
      d.s.find((x) => x.id === "poison").syncStatus,
      d.s.find((x) => x.id === "good-plain").syncStatus,
    ],
    ["rejected", "synced"],
    "the tampered invoice is rejected; the good sale still syncs",
  );
  ok(
    /Tax does not match/.test(d.s.find((x) => x.id === "poison").syncError),
    "reason: tax does not match",
  );

  console.log("Reopen a confirmed invoice; reports exclude tax");
  await page.click('[data-view="accounts"]');
  await page.locator("#invoiceList .sale-row", { hasText: "-0001" }).click();
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  ok(
    /Confirmed by your ledger/.test(
      await page.locator("#receiptBody").innerText(),
    ),
    "a confirmed invoice says so",
  );
  await page.keyboard.press("Escape");
  await page.click('[data-view="reports"]');
  ok(
    /Totals exclude tax/.test(await page.locator("#reportBody").innerText()),
    "reports say totals exclude tax",
  );

  console.log("Retail and Counter after Wholesale");
  await page.click('[data-view="setup"]');
  await page.click('[data-tier="retail"]');
  await page.waitForSelector('[data-view="accounts"].hidden', {
    state: "attached",
  });
  eq(
    await page.locator('#paymentMethod option[value="account"]').count(),
    0,
    "the 'On account' option is removed in Retail",
  );
  ok(
    !(await page.locator('[data-view="accounts"]').isVisible()),
    "Accounts tab hidden in Retail",
  );
  await page.click('[data-view="sale"]');
  await page
    .locator("#productGrid .product-card[data-add]", { hasText: "Salt" })
    .click();
  await page.click("#checkout");
  await page.waitForSelector("#receiptPanel:not(.hidden)");
  await page.click("#receiptClose");
  d = await dump();
  const retailSale = d.s.filter((x) => x.tier === "retail")[0];
  ok(
    retailSale &&
      !retailSale.invoice &&
      retailSale.tax === undefined &&
      retailSale.total === 10,
    "a Retail sale has no invoice and no tax",
  );
  eq((await dump()).pay.length, 1, "payments are kept while in Retail");
  await page.click('[data-view="setup"]');
  await page.click('[data-tier="wholesale"]');
  await page.waitForSelector('[data-view="accounts"]:not(.hidden)');
  ok(
    /Moote Trading/.test(await page.locator("#accountList").innerText()),
    "accounts are back after switching to Wholesale",
  );

  console.log("Offline reload");
  await page.waitForTimeout(500);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector("#productGrid .product-card");
  await page.click('[data-view="accounts"]');
  const off = await dump();
  eq(
    [
      off.s.filter((x) => x.invoice).length,
      off.pay.length,
      off.st.balances.c1.amount,
    ],
    [4, 1, 247.5],
    "invoices, payments and the confirmed balance survive an offline reload",
  );
  ok(
    /Moote Trading/.test(await page.locator("#accountList").innerText()),
    "accounts render offline",
  );
  await ctx.setOffline(false);

  eq(errors, [], "no page errors");
  await browser.close();
  server.close();
  console.log("\n" + passed + " browser checks passed");
})().catch(async (e) => {
  console.error("\nFAILED:", e.message);
  server.close();
  process.exit(1);
});
