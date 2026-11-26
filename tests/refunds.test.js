const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/refunds.js");

const retailSale = (over = {}) => ({
  id: "sale-1",
  createdAt: 1,
  currency: "AUD",
  paymentMethod: "cash",
  items: [
    { productId: "a", name: "Jacket", unitPrice: 10, quantity: 1 },
    { productId: "b", name: "Socks", unitPrice: 5, quantity: 2 },
  ],
  subtotal: 20,
  discount: { type: "percent", value: 10, amount: 2 },
  total: 18,
  ...over,
});
const accountInvoice = (over = {}) => ({
  id: "inv-1",
  createdAt: 1,
  currency: "AUD",
  paymentMethod: "account",
  customerId: "c1",
  items: [{ productId: "w", name: "Widget", unitPrice: 50, quantity: 2 }],
  subtotal: 100,
  tax: 12.5,
  total: 112.5,
  invoice: { number: "INV-AB12-1", mode: "account", tax: 12.5, total: 112.5 },
  ...over,
});
const build = (sale, picks, opts = {}) =>
  R.buildRefund(sale, picks, {
    id: "r" + Math.random(),
    number: "CN-AB12-1",
    now: 5,
    ...opts,
  });

test("a partial refund returns the same share of the discounted total", () => {
  const r = build(retailSale(), [{ index: 0, qty: 1 }]);
  assert.equal(r.ok, true);
  assert.equal(r.value.total, 9); // 10 of 20 of the items = half of the 18 paid
  assert.equal(r.value.tax, 0);
  assert.equal(r.value.items[0].lineIndex, 0);
  assert.equal(r.value.syncStatus, "pending");
});

test("refunding what is left returns exactly the rest of the sale (no drift)", () => {
  const sale = retailSale();
  const first = build(sale, [{ index: 0, qty: 1 }]).value;
  const second = build(sale, [{ index: 1, qty: 2 }], { refunds: [first] });
  assert.equal(second.ok, true);
  assert.equal(second.value.total, 9);
  assert.equal(first.total + second.value.total, sale.total);
});

test("many small refunds never add up to more than the sale (rounding)", () => {
  const sale = {
    id: "s",
    currency: "AUD",
    paymentMethod: "cash",
    items: [{ productId: "p", name: "Pen", unitPrice: 3.33, quantity: 3 }],
    tax: 0.02,
    total: 10.01,
  };
  const refunds = [];
  for (let i = 0; i < 3; i++) {
    const r = build(sale, [{ index: 0, qty: 1 }], { refunds });
    assert.equal(r.ok, true, "step " + i);
    refunds.push(r.value);
  }
  const sumCents = refunds.reduce((n, r) => n + Math.round(r.total * 100), 0);
  const taxCents = refunds.reduce((n, r) => n + Math.round(r.tax * 100), 0);
  assert.equal(sumCents, 1001);
  assert.equal(taxCents, 2);
  assert.equal(build(sale, [{ index: 0, qty: 1 }], { refunds }).ok, false);
});

test("an invoice refund returns tax in proportion and credits the customer's account", () => {
  const sale = accountInvoice();
  const r = build(sale, [{ index: 0, qty: 1 }], { method: "account" });
  assert.equal(r.ok, true);
  assert.equal(r.value.total, 56.25);
  assert.equal(r.value.tax, 6.25);
  assert.equal(r.value.customerId, "c1");
  assert.equal(r.value.invoiceNumber, "INV-AB12-1");
  const rest = build(sale, [{ index: 0, qty: 1 }], {
    method: "account",
    refunds: [r.value],
  });
  assert.equal(rest.value.total, 56.25);
  assert.equal(rest.value.tax, 6.25);
});

test("cannot refund more than was sold, twice over, or an item that was already returned", () => {
  const sale = retailSale();
  assert.match(build(sale, [{ index: 1, qty: 3 }]).error, /Only 2 of Socks/);
  const all = build(sale, [
    { index: 0, qty: 1 },
    { index: 1, qty: 2 },
  ]).value;
  assert.equal(all.total, 18);
  assert.match(
    build(sale, [{ index: 0, qty: 1 }], { refunds: [all] }).error,
    /already been refunded|Only 0/,
  );
  assert.equal(R.refundable(sale, [all]), false);
  assert.equal(R.refundable(sale, []), true);
});

test("a rejected refund no longer counts against the sale", () => {
  const sale = retailSale();
  const r = build(sale, [{ index: 0, qty: 1 }]).value;
  const rejected = { ...r, syncStatus: "rejected" };
  assert.equal(R.refundedSoFar([rejected], sale.id).minor, 0);
  assert.equal(
    build(sale, [{ index: 0, qty: 1 }], { refunds: [rejected] }).ok,
    true,
  );
});

test("invalid picks are refused", () => {
  const sale = retailSale();
  for (const picks of [
    [],
    [{ index: 5, qty: 1 }],
    [{ index: -1, qty: 1 }],
    [{ index: 0, qty: 0 }],
    [{ index: 0, qty: 1.5 }],
    [{ index: 0, qty: "x" }],
    [
      { index: 0, qty: 1 },
      { index: 0, qty: 1 },
    ],
  ])
    assert.equal(build(sale, picks).ok, false, JSON.stringify(picks));
  assert.equal(R.buildRefund(null, [], {}).ok, false);
  assert.equal(R.buildRefund({ items: [] }, [], {}).ok, false);
});

test("method rules: account credit only for an invoice on account, and it must be used", () => {
  assert.match(
    build(retailSale(), [{ index: 0, qty: 1 }], { method: "account" }).error,
    /on account/,
  );
  assert.match(
    build(accountInvoice(), [{ index: 0, qty: 1 }], { method: "cash" }).error,
    /credit it/i,
  );
  assert.equal(
    build(accountInvoice(), [{ index: 0, qty: 1 }], { method: "account" }).ok,
    true,
  );
  assert.equal(
    build(retailSale(), [{ index: 0, qty: 1 }], { method: "other" }).ok,
    true,
  );
  assert.match(
    build(retailSale(), [{ index: 0, qty: 1 }], { method: "bitcoin" }).error,
    /how the money/,
  );
  const noCust = accountInvoice();
  delete noCust.customerId;
  assert.match(
    build(noCust, [{ index: 0, qty: 1 }], { method: "account" }).error,
    /no customer/,
  );
});

test("the reason is trimmed and length limited", () => {
  const ok = build(retailSale(), [{ index: 0, qty: 1 }], {
    reason: "  Too small  ",
  });
  assert.equal(ok.value.reason, "Too small");
  assert.equal(
    build(retailSale(), [{ index: 0, qty: 1 }], { reason: "x".repeat(201) }).ok,
    false,
  );
  assert.equal(
    "reason" in build(retailSale(), [{ index: 0, qty: 1 }]).value,
    false,
  );
});

test("restock returns single units, expanding cartons, only when asked", () => {
  const sale = retailSale({
    items: [
      {
        productId: "p",
        name: "Cola",
        unitPrice: 24,
        quantity: 2,
        packId: "carton",
        packUnits: 24,
      },
    ],
    subtotal: 48,
    discount: undefined,
    total: 48,
  });
  const yes = build(sale, [{ index: 0, qty: 1 }], { restock: true }).value;
  assert.deepEqual(R.restockUnits(yes), [{ productId: "p", units: 24 }]);
  const no = build(sale, [{ index: 0, qty: 1 }], { restock: false }).value;
  assert.deepEqual(R.restockUnits(no), []);
});

test("credit note numbers are unique, ordered and share the device code", async () => {
  const data = new Map();
  const store = {
    get: async (_s, k) => data.get(k),
    put: async (_s, v) => void data.set(v.key, v),
  };
  const [a, b, c] = await Promise.all([
    R.nextCreditNumber(store, () => 0.1),
    R.nextCreditNumber(store, () => 0.1),
    R.nextCreditNumber(store, () => 0.1),
  ]);
  assert.deepEqual(
    [a, b, c].map((n) => n.split("-")[2]),
    ["0001", "0002", "0003"],
  );
  assert.ok([a, b, c].every(R.isValidNumber));
  assert.equal(a.split("-")[1], data.get("deviceCode").value);
});

test("the credit note text shows number, items, total and how the money went back", () => {
  const sale = accountInvoice();
  const r = build(sale, [{ index: 0, qty: 1 }], {
    method: "account",
    reason: "Damaged",
    number: "CN-AB12-7",
    restock: true,
  }).value;
  const t = R.buildCreditNoteText(r, sale, { name: "Trade Shop" });
  assert.match(t, /Trade Shop/);
  assert.match(t, /CREDIT NOTE CN-AB12-7/);
  assert.match(t, /For invoice: INV-AB12-1/);
  assert.match(t, /Widget/);
  assert.match(t, /TOTAL REFUNDED AUD\s+56\.25/);
  assert.match(t, /Credited to account/);
  assert.match(t, /Reason: Damaged/);
  assert.match(t, /returned to stock/i);
  assert.ok(t.split("\n").every((l) => l.length <= 40));
});
