const test = require("node:test");
const assert = require("node:assert/strict");
global.InvoiceCore = require("../js/invoices.js");
const T = require("../js/trade.js");

const DAY = 86400000;
const NOW = 1_700_000_000_000;
const products = [
  { id: "a", name: "Rice 25kg", price: 40, sku: "R" },
  { id: "b", name: "Salt", price: 5, taxExempt: true },
  { id: "c", name: "Oil", price: 8 },
];
const L = (productId, qty, unitPrice) => ({ productId, qty, unitPrice });
const quote = (over = {}, lines = [L("a", 3, 10), L("b", 2, 5)], opts = {}) =>
  T.buildQuote(
    {
      customer: { id: "c1", name: "Trade Co" },
      lines,
      validUntil: NOW + 7 * DAY,
      ...over,
    },
    products,
    { id: "q1", number: "QT-AB12-0001", now: NOW, currency: "AUD", ...opts },
  );

test("a quote totals its lines with tax on the taxable ones only, exactly", () => {
  const r = quote();
  assert.equal(r.ok, true);
  assert.deepEqual(
    [r.value.subtotal, r.value.tax, r.value.total],
    [40, 3.75, 43.75],
  ); // tax 12.5% of 30; salt is exempt
  assert.deepEqual(
    [
      r.value.status,
      r.value.customerId,
      r.value.customerName,
      r.value.syncStatus,
      r.value.createdAt,
      r.value.updatedAt,
    ],
    ["open", "c1", "Trade Co", "pending", NOW, NOW],
  );
  assert.equal(r.value.items[1].taxExempt, true);
  assert.equal("taxExempt" in r.value.items[0], false);
  assert.equal(r.value.currency, "AUD");
});

test("the tax rate can be changed and is validated", () => {
  assert.equal(quote({ taxRate: 0 }).value.total, 40);
  assert.equal(quote({ taxRate: 10 }).value.total, 43);
  assert.equal(quote({ taxRate: 150 }).ok, false);
});

test("a quote needs a customer name, valid lines and sensible dates", () => {
  assert.equal(
    T.buildQuote(
      { customerName: "  Walk-in Joe ", lines: [L("a", 1, 1)] },
      products,
      { now: NOW },
    ).value.customerName,
    "Walk-in Joe",
  );
  assert.equal(
    "customerId" in
      T.buildQuote({ customerName: "Joe", lines: [L("a", 1, 1)] }, products, {
        now: NOW,
      }).value,
    false,
  );
  assert.equal(T.buildQuote({ lines: [L("a", 1, 1)] }, products, {}).ok, false);
  assert.equal(
    T.buildQuote(
      { customerName: "x".repeat(101), lines: [L("a", 1, 1)] },
      products,
      {},
    ).ok,
    false,
  );
  for (const bad of [
    [],
    [L("zzz", 1, 1)],
    [L("a", 0, 1)],
    [L("a", 1.5, 1)],
    [L("a", "", 1)],
    [L("a", 1, -1)],
    [L("a", 1, "")],
    [L("a", 1, 1.005)],
    [L("a", 1, 1), L("a", 2, 1)],
  ])
    assert.equal(quote({}, bad).ok, false, JSON.stringify(bad));
  assert.match(quote({}, [L("a", 1, 1), L("a", 2, 1)]).error, /twice/);
  assert.equal(quote({ note: "n".repeat(201) }).ok, false);
  assert.equal(quote({ validUntil: NOW - 1 }).ok, false);
  assert.equal(quote({ validUntil: NOW + 400 * DAY }).ok, false);
  assert.equal(quote({ validUntil: "" }).ok, true);
  assert.equal("validUntil" in quote({ validUntil: "" }).value, false);
});

test("an open quote past its date shows as expired and cannot be loaded", () => {
  const q = quote().value;
  assert.equal(T.quoteStatus(q, NOW + DAY), "open");
  assert.equal(T.quoteStatus(q, NOW + 8 * DAY), "expired");
  assert.equal(
    T.quoteStatus({ ...q, status: "converted" }, NOW + 8 * DAY),
    "converted",
  );
  assert.equal(T.checkConvert(q, products, NOW + DAY).ok, true);
  assert.match(T.checkConvert(q, products, NOW + 8 * DAY).error, /expired/);
  assert.match(
    T.checkConvert({ ...q, status: "converted" }, products, NOW).error,
    /already been made/,
  );
  assert.match(
    T.checkConvert({ ...q, status: "declined" }, products, NOW).error,
    /declined/,
  );
  assert.match(
    T.checkConvert(q, [products[0]], NOW).error,
    /Salt is no longer/,
  );
  assert.equal(T.checkConvert(null, products).ok, false);
});

test("loading a quote into the till keeps the QUOTED price, not the product's current one", () => {
  const q = quote().value;
  const lines = T.cartLines(q, products);
  assert.deepEqual(
    lines.map((l) => [l.productId, l.price, l.qty, !!l.taxExempt]),
    [
      ["a", 10, 3, false],
      ["b", 5, 2, true],
    ],
  );
  assert.equal(products[0].price, 40);
});

test("a saved sale is linked to a quote only if it holds the quoted goods for the quoted customer", () => {
  const q = quote().value;
  const sale = (over = {}) => ({
    customerId: "c1",
    items: [
      { productId: "a", quantity: 3 },
      { productId: "b", quantity: 2 },
    ],
    ...over,
  });
  assert.equal(T.matchesSale(q, sale()), true);
  assert.equal(
    T.matchesSale(
      q,
      sale({
        items: [
          { productId: "b", quantity: 2 },
          { productId: "a", quantity: 3 },
        ],
      }),
    ),
    true,
  );
  assert.equal(T.matchesSale(q, sale({ customerId: "other" })), false);
  assert.equal(
    T.matchesSale(
      q,
      sale({
        items: [
          { productId: "a", quantity: 4 },
          { productId: "b", quantity: 2 },
        ],
      }),
    ),
    false,
  );
  assert.equal(
    T.matchesSale(q, sale({ items: [{ productId: "a", quantity: 3 }] })),
    false,
  );
  assert.equal(
    T.matchesSale(
      q,
      sale({
        items: [
          { productId: "a", quantity: 3, packId: "x" },
          { productId: "b", quantity: 2 },
        ],
      }),
    ),
    false,
  );
  assert.equal(T.matchesSale(q, null), false);
});

test("converting marks the quote with the sale's id; declining only works on an open quote", () => {
  const q = quote().value;
  const c = T.markConverted(q, "sale-9", NOW + 5);
  assert.deepEqual(
    [c.status, c.convertedSaleId, c.updatedAt, c.syncStatus],
    ["converted", "sale-9", NOW + 5, "pending"],
  );
  assert.equal(T.decline(c).ok, false);
  const d = T.decline(q, NOW + 9);
  assert.deepEqual([d.value.status, d.value.updatedAt], ["declined", NOW + 9]);
  assert.equal(
    T.markConverted({ ...q, updatedAt: NOW + 50 }, "s", NOW).updatedAt,
    NOW + 50,
    "updatedAt never goes backwards",
  );
});

test("the quote text shows lines, tax, total, expiry and that it is only an offer", () => {
  const t = T.buildQuoteText(
    quote({ note: "Delivery included" }).value,
    { name: "Corner Wholesale" },
    NOW,
  );
  assert.match(t, /Corner Wholesale/);
  assert.match(t, /QUOTE QT-AB12-0001/);
  assert.match(t, /For: Trade Co/);
  assert.match(t, /Valid until:/);
  assert.match(t, /3 x 10\.00\s+30\.00/);
  assert.match(t, /Tax\s+3\.75/);
  assert.match(t, /TOTAL AUD\s+43\.75/);
  assert.match(t, /Note: Delivery included/);
  assert.match(t, /not an invoice/);
  assert.ok(t.split("\n").every((l) => l.length <= 40));
});

test("a delivery note lists goods and a signature box but no prices", () => {
  const sale = {
    id: "inv-1",
    createdAt: NOW,
    items: [
      { name: "Rice 25kg", unitPrice: 40, quantity: 3 },
      { name: "Salt", unitPrice: 5, quantity: 12 },
    ],
    total: 170,
    invoice: { number: "INV-AB12-0007", customerName: "Trade Co", total: 170 },
  };
  const t = T.buildDeliveryNoteText(sale, { name: "Corner Wholesale" });
  assert.match(t, /DELIVERY NOTE/);
  assert.match(t, /Invoice: INV-AB12-0007/);
  assert.match(t, /To: Trade Co/);
  assert.match(t, /Rice 25kg\s+x 3/);
  assert.match(t, /Salt\s+x 12/);
  assert.match(t, /Signature:/);
  assert.doesNotMatch(t, /40\.00|170|5\.00/);
  assert.ok(t.split("\n").every((l) => l.length <= 40));
});

/* ---------- statements ---------- */
const inv = (id, at, total, over = {}) => ({
  id,
  customerId: "c1",
  createdAt: at,
  syncStatus: "synced",
  invoice: { number: "INV-" + id, mode: "account", total },
  ...over,
});
const pay = (id, at, amount, over = {}) => ({
  id,
  customerId: "c1",
  createdAt: at,
  amount,
  syncStatus: "synced",
  ...over,
});
const cn = (id, at, total, over = {}) => ({
  id,
  customerId: "c1",
  createdAt: at,
  total,
  method: "account",
  number: "CN-" + id,
  syncStatus: "synced",
  ...over,
});
const cust = { id: "c1", name: "Trade Co" };

test("a statement has a running balance in date order, from this customer's account records only", () => {
  const st = T.buildStatement(
    cust,
    [
      inv("2", 200, 50),
      inv("1", 100, 100),
      inv("x", 150, 999, { customerId: "other" }),
      inv("p", 160, 7, { invoice: { number: "P", mode: "paid", total: 7 } }),
    ],
    [pay("p1", 300, 30), pay("px", 310, 5, { customerId: "other" })],
    [cn("r1", 400, 20), cn("r2", 410, 9, { method: "cash" })],
  );
  assert.deepEqual(
    st.entries.map((e) => [e.kind, e.change / 100, e.balance / 100]),
    [
      ["invoice", 100, 100],
      ["invoice", 50, 150],
      ["payment", -30, 120],
      ["credit", -20, 100],
    ],
  );
  assert.equal(st.balance, 10000);
});

test("payments and credit notes are matched to the OLDEST invoices first", () => {
  const st = T.buildStatement(
    cust,
    [inv("1", 100, 100), inv("2", 200, 50)],
    [pay("p", 300, 30)],
    [cn("r", 400, 20)],
  );
  assert.deepEqual(
    st.invoices.map((i) => [
      i.number,
      i.total / 100,
      i.paid / 100,
      i.outstanding / 100,
    ]),
    [
      ["INV-1", 100, 50, 50],
      ["INV-2", 50, 0, 50],
    ],
  );
  assert.equal(st.unallocated, 0);
  const more = T.buildStatement(
    cust,
    [inv("1", 100, 100), inv("2", 200, 50)],
    [pay("p", 300, 120)],
    [],
  );
  assert.deepEqual(
    more.invoices.map((i) => i.outstanding / 100),
    [0, 30],
  );
});

test("an overpayment shows as credit in hand and a negative balance", () => {
  const st = T.buildStatement(
    cust,
    [inv("1", 100, 100)],
    [pay("p", 200, 130)],
    [],
  );
  assert.equal(st.balance, -3000);
  assert.equal(st.unallocated, 3000);
  assert.deepEqual(
    st.invoices.map((i) => i.outstanding),
    [0],
  );
});

test("rejected records are left out and unconfirmed ones are counted", () => {
  const st = T.buildStatement(
    cust,
    [
      inv("1", 100, 100, { syncStatus: "rejected" }),
      inv("2", 200, 40, { syncStatus: "pending" }),
    ],
    [pay("p", 300, 10, { syncStatus: "rejected" })],
    [],
  );
  assert.equal(st.balance, 4000);
  assert.equal(st.pending, 1);
});

test("cents never drift across many small items", () => {
  const sales = Array.from({ length: 30 }, (_, i) =>
    inv("i" + i, 100 + i, 0.1),
  );
  const st = T.buildStatement(cust, sales, [pay("p", 999, 1.5)], []);
  assert.equal(st.balance, 150);
  assert.equal(st.invoices.filter((i) => i.outstanding > 0).length, 15);
});

test("the statement text lists activity, the balance and what is still unpaid", () => {
  const st = T.buildStatement(
    cust,
    [
      inv("1", Date.UTC(2026, 0, 5), 100),
      inv("2", Date.UTC(2026, 1, 5), 50, { syncStatus: "pending" }),
    ],
    [pay("p", Date.UTC(2026, 1, 20), 30)],
    [cn("r", Date.UTC(2026, 2, 1), 20)],
  );
  const t = T.buildStatementText(
    st,
    { name: "Corner Wholesale" },
    Date.UTC(2026, 2, 10),
    "AUD",
  );
  assert.match(t, /STATEMENT OF ACCOUNT/);
  assert.match(t, /Customer: Trade Co/);
  assert.match(t, /2026-01-05 Invoice/);
  assert.match(t, /2026-02-20 Payment/);
  assert.match(t, /2026-03-01 Credit note/);
  assert.match(t, /BALANCE DUE AUD\s+100\.00/);
  assert.match(t, /Unpaid invoices \(oldest first\)/);
  assert.match(t, /INV-1\s+50\.00/);
  assert.match(t, /INV-2\s+50\.00/);
  assert.match(t, /1 record\(s\) not yet confirmed\./);
  assert.ok(t.split("\n").every((l) => l.length <= 40));
  assert.match(
    T.buildStatementText(T.buildStatement(cust, [], [], []), {}, NOW),
    /No activity/,
  );
});
