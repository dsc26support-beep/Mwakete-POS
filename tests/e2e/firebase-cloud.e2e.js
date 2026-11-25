/* Browser test (not part of `npm test`): owner + cashier flows against the Firebase Auth and Firestore EMULATORS.
 *   cd tests/e2e && NODE_PATH=$(npm root -g) npx -y firebase-tools@latest emulators:exec --only auth,firestore \
 *     --project mwakete-pos --config ../../firebase.json "node firebase-cloud.e2e.js"
 * Needs Playwright + Chromium and Java. Uses http://localhost:<port>/?emulator=1 (the adapter only connects to the
 * emulators on localhost). Real email verification is simulated by opening the link the Auth emulator "sends".
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "../..");
const PROJECT = "mwakete-pos";
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
      "content-type": types[path.extname(p)] || "application/octet-stream",
    });
    res.end(d);
  });
});

const rest = (p) =>
  fetch(
    "http://127.0.0.1:8080/v1/projects/" +
      PROJECT +
      "/databases/(default)/documents/" +
      p,
    {
      headers: { Authorization: "Bearer owner" }, // the emulator treats this as an admin call (bypasses rules)
    },
  ).then((r) => r.json());
async function verifyEmailFor(email) {
  const j = await fetch(
    "http://127.0.0.1:9099/emulator/v1/projects/" + PROJECT + "/oobCodes",
  ).then((r) => r.json());
  const codes = j.oobCodes.filter(
    (c) => c.email === email && c.requestType === "VERIFY_EMAIL",
  );
  assert.ok(codes.length, "a verification email was 'sent' to " + email);
  await fetch(
    codes[codes.length - 1].oobLink.replace("localhost", "127.0.0.1"),
  );
}
const pages = [];
const PW = "Test-password-123";
const stamp = Date.now();

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://localhost:" + server.address().port + "/?emulator=1";
  const browser = await chromium.launch();
  const errors = [];
  const open = async (name) => {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    const page = await ctx.newPage();
    pages.push([name, page]);
    page.on("pageerror", (e) => errors.push(name + ": " + e.message));
    await page.goto(url, { waitUntil: "networkidle" });
    return page;
  };
  const tab = (p, v) => p.click('[data-view="' + v + '"]');
  const status = (p) => p.textContent("#cloudStatus");
  const waitStatus = (p, re) =>
    p.waitForFunction(
      (s) =>
        new RegExp(s).test(document.getElementById("cloudStatus").textContent),
      re,
      { timeout: 30000 },
    );
  const salesText = async (p) => {
    await tab(p, "sales");
    return (await p.textContent("#salesList")).replace(/\s+/g, " ");
  };
  const waitSales = (p, re) =>
    p.waitForFunction(
      (s) =>
        new RegExp(s).test(document.getElementById("salesList").textContent),
      re,
      { timeout: 30000 },
    );
  async function signUp(p, email) {
    await tab(p, "setup");
    await waitStatus(p, "Not signed in");
    await p.fill('#cloudForm [name="email"]', email);
    await p.fill('#cloudForm [name="password"]', PW);
    await p.click("#cloudSignUp");
    await waitStatus(p, "Signed in as");
  }
  async function sell(p) {
    await tab(p, "sale");
    await p.click("[data-add]");
    await p.click("#checkout");
    await p.waitForTimeout(250);
    // Retail and Wholesale open a receipt after each sale; close it so the page is usable.
    if (await p.locator("#receiptPanel:not(.hidden)").count())
      await p.click("#receiptClose");
  }

  /* ----- owner: unverified email blocks sync; verified email syncs ----- */
  const owner = await open("owner");
  const ownerEmail = "owner" + stamp + "@example.test";
  await signUp(owner, ownerEmail);
  assert.match(await status(owner), /not verified/i);
  assert.ok(await owner.isVisible("#cloudVerify"), "verify panel is shown");
  await tab(owner, "products");
  await owner.fill('#productForm [name="name"]', "Cola");
  await owner.fill('#productForm [name="price"]', "3.00");
  await owner.fill('#productForm [name="stock"]', "20");
  await owner.click('#productForm button[type="submit"]');
  await sell(owner);
  await owner.click("#syncNow");
  await owner.waitForTimeout(1500);
  assert.match(
    await salesText(owner),
    /pending/,
    "an unverified account does not sync",
  );
  assert.doesNotMatch(await salesText(owner), /synced/);
  console.log("ok: unverified email -> nothing syncs, sale stays pending");

  await verifyEmailFor(ownerEmail);
  await tab(owner, "setup");
  await owner.click("#cloudRefresh");
  await waitSales(owner, "synced");
  assert.doesNotMatch(await salesText(owner), /pending/);
  const ownerUid = await owner.textContent("#cloudBizCode");
  assert.ok(ownerUid.length >= 20);
  let products = await rest("businesses/" + ownerUid + "/products");
  assert.equal(
    (products.documents || []).length,
    1,
    "the owner's product reached the cloud",
  );
  assert.equal(products.documents[0].fields.name.stringValue, "Cola");
  console.log("ok: verified email -> sale synced, product pushed to the cloud");

  /* ----- cashier: signs up, owner adds them, they join and sell ----- */
  const cash = await open("cashier");
  const cashEmail = "cashier" + stamp + "@example.test";
  await signUp(cash, cashEmail);
  await verifyEmailFor(cashEmail);
  await tab(cash, "setup");
  await cash.click("#cloudRefresh");
  await cash.waitForSelector("#cloudStaffJoin:not(.hidden)", {
    timeout: 30000,
  });
  const staffCode = await cash.textContent("#cloudMyCode");

  await tab(owner, "setup");
  await owner.fill('#staffForm [name="staffCode"]', staffCode);
  await owner.fill('#staffForm [name="staffName"]', "Tina Cashier");
  await owner.click('#staffForm button[type="submit"]');
  await owner.waitForFunction(
    () => /Tina Cashier/.test(document.getElementById("staffList").textContent),
    null,
    { timeout: 30000 },
  );

  await cash.fill('#joinForm [name="bizCode"]', "wrongcodewrongcode1234");
  await cash.click('#joinForm button[type="submit"]');
  await cash.waitForTimeout(1500);
  assert.ok(
    await cash.isVisible("#cloudStaffJoin"),
    "a wrong business code does not join",
  );
  await cash.fill('#joinForm [name="bizCode"]', ownerUid);
  await cash.click('#joinForm button[type="submit"]');
  await cash.waitForSelector("#cloudCashier:not(.hidden)", { timeout: 30000 });
  await tab(cash, "products");
  await cash.waitForFunction(
    () => /Cola/.test(document.getElementById("productTable").textContent),
    null,
    { timeout: 30000 },
  );
  assert.equal(
    await cash.isVisible("#productForm"),
    false,
    "cashiers cannot add products",
  );
  console.log(
    "ok: cashier joined, owner's product list pulled, product form hidden",
  );

  await sell(cash);
  await cash.click("#syncNow");
  await waitSales(cash, "synced");
  const sales = await rest("businesses/" + ownerUid + "/sales");
  const docs = sales.documents || [];
  assert.equal(
    docs.length,
    2,
    "owner's sale + cashier's sale are both in the owner's business",
  );
  const cashUid = await cash.textContent("#cloudMyCode");
  assert.ok(
    docs.some((d) => d.fields.staffUid.stringValue === cashUid),
    "the cashier's sale is stamped with their uid",
  );
  assert.ok(
    docs.some((d) => d.fields.staffUid.stringValue === ownerUid),
    "the owner's sale is stamped with their uid",
  );
  console.log(
    "ok: cashier sale synced into the owner's business with their uid",
  );

  /* ----- credit notes reach the cloud, stamped with who recorded them ----- */
  for (const p of [owner, cash])
    await p.evaluate(async () => {
      await TierCore.setTier(POSDB, "retail");
      await TierUI.apply();
    });
  for (const p of [owner, cash]) {
    await tab(p, "sales");
    await p.click(".sale-row[data-sale-id]");
    await p.waitForSelector("#receiptPanel:not(.hidden)");
    await p.click("#receiptRefund");
    await p.fill('#refundLines [data-line="0"]', "1");
    await p.click("#refundConfirm");
    await p.waitForSelector("#receiptPanel:not(.hidden)");
    await p.click("#receiptClose");
    await p.click("#syncNow");
    await p.waitForFunction(
      () =>
        /Backed up/.test(document.getElementById("refundsList").textContent),
      null,
      { timeout: 30000 },
    );
  }
  const refundDocs =
    (await rest("businesses/" + ownerUid + "/refunds")).documents || [];
  assert.equal(
    refundDocs.length,
    2,
    "both credit notes are in the owner's business",
  );
  assert.ok(
    refundDocs.some((d) => d.fields.staffUid.stringValue === cashUid),
    "the cashier's credit note carries their uid",
  );
  assert.ok(
    refundDocs.every(
      (d) =>
        d.fields.method.stringValue === "cash" &&
        Number(d.fields.total.doubleValue ?? d.fields.total.integerValue) === 3,
    ),
  );
  console.log("ok: credit notes synced from owner and cashier");

  /* ----- stock movements, register shifts and purchase orders reach the cloud ----- */
  const backedUp = (p, id) =>
    p.waitForFunction(
      (x) => /Backed up/.test(document.getElementById(x).textContent),
      id,
      { timeout: 30000 },
    );
  for (const [p, qty] of [
    [owner, "5"],
    [cash, "7"],
  ]) {
    await tab(p, "stock");
    await p.selectOption("#stockAction", "receive");
    await p.fill('#stockForm [name="qty"]', qty);
    await p.click('#stockForm button[type="submit"]');
    await p.waitForFunction(
      () => /Backed up/.test(document.getElementById("stockMoves").textContent),
      null,
      { timeout: 30000 },
    );
    await tab(p, "register");
    await p.fill('#registerOpenForm [name="float"]', "10");
    await p.click('#registerOpenForm button[type="submit"]');
    await p.waitForSelector("#registerOpen:not(.hidden)");
    await p.fill('#registerCloseForm [name="counted"]', "10");
    await p.click('#registerCloseForm button[type="submit"]');
    await p.waitForSelector("#receiptPanel:not(.hidden)");
    await p.click("#receiptClose");
    await backedUp(p, "registerList");
  }
  const moveDocs =
    (await rest("businesses/" + ownerUid + "/stockMoves")).documents || [];
  assert.equal(
    moveDocs.length,
    2,
    "both stock movements are in the owner's business",
  );
  assert.ok(
    moveDocs.some(
      (d) =>
        d.fields.staffUid.stringValue === cashUid &&
        d.fields.reason.stringValue === "purchase",
    ),
    "the cashier's movement carries their uid",
  );
  const shiftDocs =
    (await rest("businesses/" + ownerUid + "/registers")).documents || [];
  assert.equal(
    shiftDocs.length,
    2,
    "both register shifts are in the owner's business",
  );
  assert.ok(
    shiftDocs.every(
      (d) =>
        Number(
          d.fields.difference.doubleValue ?? d.fields.difference.integerValue,
        ) === 0,
    ),
  );
  console.log(
    "ok: stock movements and register shifts synced from owner and cashier",
  );

  await owner.evaluate(async () => {
    await TierCore.setTier(POSDB, "wholesale");
    await TierUI.apply();
  });
  await cash.evaluate(async () => {
    await TierCore.setTier(POSDB, "wholesale");
    await TierUI.apply();
  });
  assert.equal(
    await cash.isHidden('[data-view="purchasing"]'),
    true,
    "cashiers do not get the Purchasing screen",
  );
  assert.equal(
    await owner.isVisible('[data-view="purchasing"]'),
    true,
    "the owner does",
  );
  await tab(owner, "purchasing");
  await owner.fill('#poForm [name="supplierName"]', "Pacific Traders");
  await owner.fill("#poQty", "12");
  await owner.fill("#poCost", "2.5");
  await owner.click("#poAddLine");
  await owner.click('#poForm button[type="submit"]');
  await backedUp(owner, "poList");
  let poDocs =
    (await rest("businesses/" + ownerUid + "/purchaseOrders")).documents || [];
  assert.equal(poDocs.length, 1);
  assert.equal(poDocs[0].fields.status.stringValue, "draft");
  await owner.click('[data-po-act="order"]');
  await owner.waitForFunction(() =>
    /Ordered/.test(document.getElementById("poList").textContent),
  );
  await backedUp(owner, "poList");
  poDocs =
    (await rest("businesses/" + ownerUid + "/purchaseOrders")).documents || [];
  assert.equal(
    poDocs[0].fields.status.stringValue,
    "ordered",
    "the order's new status reached the cloud",
  );
  assert.equal(
    ((await rest("businesses/" + ownerUid + "/suppliers")).documents || [])
      .length,
    1,
    "the supplier was backed up",
  );
  console.log(
    "ok: purchase order and supplier synced; cashier has no Purchasing screen",
  );

  /* ----- owner removes the cashier's access ----- */
  await tab(owner, "setup");
  await owner.click("#staffList [data-staff]");
  await owner.waitForFunction(
    () => /Removed/.test(document.getElementById("staffList").textContent),
    null,
    { timeout: 30000 },
  );
  await sell(cash);
  await cash.click("#syncNow");
  await waitSales(cash, "rejected|pending");
  await cash.waitForTimeout(1500);
  const after = await salesText(cash);
  assert.match(
    after,
    /rejected/,
    "a deactivated cashier's sale is refused by the cloud",
  );
  assert.equal(
    ((await rest("businesses/" + ownerUid + "/sales")).documents || []).length,
    2,
    "nothing new was stored",
  );
  console.log("ok: deactivated cashier is refused");

  /* ----- owner removes a product -> deleted in the cloud ----- */
  await tab(owner, "products");
  await owner.click("[data-delete]");
  await owner.click("#syncNow");
  await owner.waitForFunction(async (u) => true, ownerUid);
  for (let i = 0; i < 20; i++) {
    products = await rest("businesses/" + ownerUid + "/products");
    if (!(products.documents || []).length) break;
    await owner.waitForTimeout(500);
  }
  assert.equal(
    (products.documents || []).length,
    0,
    "the removal reached the cloud",
  );
  console.log("ok: product removal synced");

  assert.deepEqual(errors, [], "no page errors: " + errors.join(" | "));
  await browser.close();
  server.close();
  console.log("ALL FIREBASE E2E CHECKS PASSED");
})().catch(async (e) => {
  console.error("FAILED:", e.message);
  for (const [name, p] of pages) {
    const t = (sel) =>
      p.textContent(sel).then(
        (s) => String(s).replace(/\s+/g, " ").slice(0, 300),
        () => "-",
      );
    console.error(
      "  [" + name + "] status:",
      await t("#cloudStatus"),
      "| sync:",
      await t("#syncStatus"),
      "/",
      await t("#syncDetail"),
      "| staff:",
      await t("#staffList"),
      "| products:",
      await t("#productTable"),
      "| toast:",
      await t("#toast"),
    );
  }
  process.exit(1);
});
