const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../js/invoices.js");

function fakeStore() {
  const rows = new Map();
  return {
    rows,
    async get(s, k) {
      assert.equal(s, "settings");
      return rows.get(k);
    },
    async put(s, v) {
      assert.equal(s, "settings");
      rows.set(v.key, structuredClone(v));
      return v;
    },
  };
}
const L = (price, qty = 1, taxExempt = false) => ({ price, qty, taxExempt });

/* ---- totals ---- */
test("12.5% tax on a simple invoice", () => {
  const t = I.computeInvoiceTotals([L(100, 2)], 0, 12.5);
  assert.deepEqual(
    [t.subtotal, t.discount, t.taxableNet, t.tax, t.total, t.rate],
    [200, 0, 200, 25, 225, 12.5],
  );
});
test("exempt lines are not taxed", () => {
  const t = I.computeInvoiceTotals([L(100, 1), L(50, 2, true)], 0, 12.5);
  assert.deepEqual(
    [t.subtotal, t.taxableNet, t.tax, t.total],
    [200, 100, 12.5, 212.5],
  );
});
test("discount reduces the taxable base pro-rata (taxable 100 + exempt 100, discount 20 -> taxable 90)", () => {
  const t = I.computeInvoiceTotals([L(100), L(100, 1, true)], 20, 12.5);
  assert.deepEqual(
    [t.subtotal, t.discount, t.taxableNet, t.tax, t.total],
    [200, 20, 90, 11.25, 191.25],
  );
});
test("a discount on an all-taxed invoice reduces tax proportionally", () => {
  const t = I.computeInvoiceTotals([L(80)], 8, 12.5);
  assert.deepEqual([t.taxableNet, t.tax, t.total], [72, 9, 81]);
});
test("a discount on an all-exempt invoice leaves tax at zero", () => {
  const t = I.computeInvoiceTotals([L(100, 1, true)], 10, 12.5);
  assert.deepEqual([t.taxableNet, t.tax, t.total], [0, 0, 90]);
});
test("tax rounds half up to the cent, once", () => {
  assert.equal(I.computeInvoiceTotals([L(0.04)], 0, 12.5).tax, 0.01); // 0.005
  assert.equal(I.computeInvoiceTotals([L(0.03)], 0, 12.5).tax, 0); // 0.00375
  assert.equal(
    I.computeInvoiceTotals([L(0.04), L(0.04), L(0.04)], 0, 12.5).tax,
    0.02,
  ); // 0.015 on the whole
  assert.equal(I.computeInvoiceTotals([L(0.1, 3)], 0, 0).subtotal, 0.3);
});
test("zero rate, empty cart and 100% discount", () => {
  assert.equal(I.computeInvoiceTotals([L(10)], 0, 0).total, 10);
  assert.deepEqual(I.computeInvoiceTotals([], 0, 12.5).total, 0);
  assert.equal(I.computeInvoiceTotals([L(10)], 10, 12.5).total, 0);
});
test("invalid rate or discount is rejected", () => {
  for (const rate of [-1, 100.01, 12.345, NaN, "abc"])
    assert.equal(
      I.computeInvoiceTotals([L(1)], 0, rate).ok,
      false,
      String(rate),
    );
  assert.equal(I.computeInvoiceTotals([L(10)], 10.01, 12.5).ok, false);
  assert.equal(I.computeInvoiceTotals([L(10)], -1, 12.5).ok, false);
});
test("large amounts stay exact (BigInt ratios)", () => {
  const t = I.computeInvoiceTotals([L(999999999.99)], 123456789.12, 12.5);
  assert.equal(
    I.toMinor(t.total),
    I.toMinor(t.subtotal) - I.toMinor(t.discount) + I.toMinor(t.tax),
  );
  assert.equal(I.mulDivRound(1e17, 3, 2), 150000000000000000);
});

/* ---- numbering ---- */
test("invoice numbers are INV-<code>-<seq>, increasing, with a stable device code", async () => {
  const s = fakeStore();
  const a = await I.nextInvoiceNumber(s, () => 0.1);
  const b = await I.nextInvoiceNumber(s, () => 0.9);
  const [pa, ca, na] = a.split("-"),
    [, cb, nb] = b.split("-");
  assert.equal(pa, "INV");
  assert.equal(ca, cb, "same device code");
  assert.deepEqual([na, nb], ["0001", "0002"]);
  assert.ok(I.isValidNumber(a) && I.isValidNumber(b));
});
test("concurrent allocations never reuse a number", async () => {
  const s = fakeStore();
  const nums = await Promise.all(
    Array.from({ length: 25 }, () => I.nextInvoiceNumber(s)),
  );
  assert.equal(new Set(nums).size, 25);
});
test("a corrupt stored device code is replaced; sequence continues", async () => {
  const s = fakeStore();
  s.rows.set("deviceCode", { key: "deviceCode", value: "bad code!" });
  s.rows.set("invoiceSeq", { key: "invoiceSeq", value: 41 });
  const n = await I.nextInvoiceNumber(s);
  assert.ok(I.isValidNumber(n));
  assert.ok(n.endsWith("-0042"));
});
test("isValidNumber rejects junk", () => {
  for (const bad of [
    "",
    "INV-",
    "inv-ABCD-1",
    "INV-AB-1",
    "INV-ABCDEFGHIJ-1",
    "INV-ABCD-x",
    "INV-ABCD-1; DROP",
    5,
  ])
    assert.equal(I.isValidNumber(bad), false, String(bad));
});

/* ---- building ---- */
const cust = { id: "c1", name: "Moote Trading", taxNumber: "TX-9" };
test("buildInvoice: paid walk-in and on-account", () => {
  const cart = [{ price: 100, qty: 2 }];
  const paid = I.buildInvoice(cart, null, null, {
    rate: 12.5,
    number: "INV-ABCD-0001",
    mode: "paid",
  });
  assert.equal(paid.ok, true);
  assert.deepEqual(
    [
      paid.invoice.mode,
      paid.invoice.customerName,
      paid.invoice.tax,
      paid.invoice.total,
    ],
    ["paid", "Walk-in", 25, 225],
  );
  const acct = I.buildInvoice(cart, { amount: 20 }, cust, {
    rate: 12.5,
    number: "INV-ABCD-0002",
    mode: "account",
    terms: "30 days",
    sellerTaxNumber: "S-1",
  });
  assert.deepEqual(
    [
      acct.invoice.mode,
      acct.invoice.customerTaxNumber,
      acct.invoice.terms,
      acct.invoice.sellerTaxNumber,
    ],
    ["account", "TX-9", "30 days", "S-1"],
  );
  assert.equal(acct.totals.total, 202.5); // (200-20) + 12.5% of 180 = 22.5
});
test("buildInvoice: on account needs a customer; bad discount is rejected", () => {
  assert.equal(
    I.buildInvoice([{ price: 1, qty: 1 }], null, null, {
      rate: 12.5,
      number: "N",
      mode: "account",
    }).ok,
    false,
  );
  assert.equal(
    I.buildInvoice([{ price: 1, qty: 1 }], { amount: 5 }, cust, {
      rate: 12.5,
      number: "N",
      mode: "paid",
    }).ok,
    false,
  );
});
test("applyToSale makes sale.total the gross amount and marks account sales unverified", () => {
  const sale = {
    total: 180,
    subtotal: 200,
    paymentMethod: "cash",
    paymentVerified: true,
  };
  const built = I.buildInvoice([{ price: 100, qty: 2 }], { amount: 20 }, cust, {
    rate: 12.5,
    number: "INV-ABCD-0003",
    mode: "account",
  });
  I.applyToSale(sale, built);
  assert.deepEqual(
    [
      sale.total,
      sale.tax,
      sale.subtotal,
      sale.paymentMethod,
      sale.paymentVerified,
    ],
    [202.5, 22.5, 200, "account", false],
  );
  assert.equal(sale.invoice.number, "INV-ABCD-0003");
});

/* ---- balances / limits ---- */
test("pendingBalance counts only unconfirmed account invoices minus unconfirmed payments", () => {
  const sales = [
    {
      customerId: "c1",
      invoice: { mode: "account", total: 100 },
      syncStatus: "pending",
    },
    {
      customerId: "c1",
      invoice: { mode: "account", total: 50 },
      syncStatus: "synced",
    },
    {
      customerId: "c1",
      invoice: { mode: "account", total: 70 },
      syncStatus: "rejected",
    },
    {
      customerId: "c1",
      invoice: { mode: "paid", total: 999 },
      syncStatus: "pending",
    },
    {
      customerId: "c2",
      invoice: { mode: "account", total: 5 },
      syncStatus: "pending",
    },
    { customerId: "c1", total: 3, syncStatus: "pending" },
  ];
  const payments = [
    { customerId: "c1", amount: 30, syncStatus: "pending" },
    { customerId: "c1", amount: 40, syncStatus: "synced" },
  ];
  assert.equal(I.pendingBalance(sales, payments, "c1"), 70);
  assert.equal(I.pendingBalance(sales, payments, "c2"), 5);
  assert.equal(I.pendingBalance([], [], "c1"), 0);
});
test("overLimit: warns past the limit, no check when unset, 0 means no credit", () => {
  assert.deepEqual(
    I.overLimit({
      confirmed: 400,
      pending: 50,
      invoiceTotal: 50,
      creditLimit: 500,
    }),
    { over: false, projected: 500, limit: 500, by: 0 },
  );
  const o = I.overLimit({
    confirmed: 400,
    pending: 50,
    invoiceTotal: 60.5,
    creditLimit: 500,
  });
  assert.deepEqual([o.over, o.by, o.projected], [true, 10.5, 510.5]);
  assert.equal(
    I.overLimit({ confirmed: 9999, invoiceTotal: 1, creditLimit: undefined })
      .over,
    false,
  );
  assert.equal(
    I.overLimit({ confirmed: 0, invoiceTotal: 0.01, creditLimit: 0 }).over,
    true,
  );
  assert.equal(
    I.overLimit({ confirmed: -100, invoiceTotal: 150, creditLimit: 40 }).over,
    true,
  ); // overpaid account, still 50 > 40
  assert.equal(
    I.overLimit({ confirmed: -100, invoiceTotal: 130, creditLimit: 40 }).over,
    false,
  );
});

/* ---- payments ---- */
test("payment validation", () => {
  assert.deepEqual(
    I.validatePayment({ customerId: "c1", amount: "25.5", note: " part " })
      .value,
    { customerId: "c1", amount: 25.5, method: "cash", note: "part" },
  );
  for (const bad of [
    {},
    { customerId: "c1" },
    { customerId: "c1", amount: "0" },
    { customerId: "c1", amount: "-5" },
    { customerId: "c1", amount: "abc" },
    { customerId: "c1", amount: "1.005" },
    { customerId: "c1", amount: "1e10" },
    { customerId: "c1", amount: "5", note: "x".repeat(201) },
    { amount: "5" },
    undefined,
  ])
    assert.equal(I.validatePayment(bad).ok, false, JSON.stringify(bad));
});

/* ---- applying the server's per-record answer ---- */
test("applySyncResult: only accepted ids become synced; rejected are flagged; others untouched", () => {
  const sales = [
    { id: "a", syncStatus: "pending" },
    { id: "b", syncStatus: "pending" },
    { id: "c", syncStatus: "pending", syncError: "old" },
  ];
  const payments = [
    { id: "p1", syncStatus: "pending" },
    { id: "p2", syncStatus: "pending" },
  ];
  const out = I.applySyncResult(sales, payments, {
    acceptedIds: ["a", "c"],
    acceptedPaymentIds: ["p1"],
    rejected: [
      { id: "b", reason: "Total does not match" },
      { id: "p2", reason: "Ledger not enabled" },
    ],
  });
  assert.deepEqual(
    out.sales.map((s) => [s.id, s.syncStatus, s.syncError]),
    [
      ["a", "synced", undefined],
      ["b", "rejected", "Total does not match"],
      ["c", "synced", undefined],
    ],
  );
  assert.deepEqual(
    out.payments.map((p) => [p.id, p.syncStatus]),
    [
      ["p1", "synced"],
      ["p2", "rejected"],
    ],
  );
});
test("applySyncResult: a record the server did not mention stays pending (never assumed synced)", () => {
  const out = I.applySyncResult([{ id: "a", syncStatus: "pending" }], [], {
    acceptedIds: [],
  });
  assert.deepEqual(out, { sales: [], payments: [] });
  assert.deepEqual(I.applySyncResult([{ id: "a" }], [{ id: "p" }], {}), {
    sales: [],
    payments: [],
  });
  assert.deepEqual(I.applySyncResult(undefined, undefined, undefined), {
    sales: [],
    payments: [],
  });
});
test("applySyncResult: an id both accepted and rejected counts as accepted; reasons are capped", () => {
  const out = I.applySyncResult(
    [
      { id: "a", syncStatus: "pending" },
      { id: "b", syncStatus: "pending" },
    ],
    [],
    {
      acceptedIds: ["a"],
      rejected: [
        { id: "a", reason: "x" },
        { id: "b", reason: "y".repeat(500) },
      ],
    },
  );
  assert.equal(out.sales[0].syncStatus, "synced");
  assert.equal(out.sales[1].syncError.length, 200);
});

/* ---- text / HTML ---- */
const sale = {
  id: "s1",
  createdAt: new Date(2026, 10, 22, 9, 30).getTime(),
  currency: "AUD",
  paymentMethod: "account",
  syncStatus: "pending",
  items: [
    { name: "Rice 1kg (Carton x24)", unitPrice: 204, quantity: 2 },
    { name: "Salt", unitPrice: 1, quantity: 5, taxExempt: true },
  ],
  subtotal: 413,
  discount: { type: "fixed", value: 13, amount: 13 },
  tax: 22.5,
  total: 422.5,
  invoice: {
    number: "INV-ABCD-0007",
    mode: "account",
    taxRate: 12.5,
    taxableNet: 180,
    tax: 22.5,
    total: 422.5,
    customerName: "Moote Trading",
    customerTaxNumber: "TX-9",
    terms: "30 days",
    sellerTaxNumber: "S-1",
  },
};
test("invoice text shows the tax invoice fields and the unconfirmed status", () => {
  const t = I.buildInvoiceText(sale, { name: "Trade Shop" });
  assert.match(t, /Trade Shop/);
  assert.match(t, /Tax no: S-1/);
  assert.match(t, /TAX INVOICE INV-ABCD-0007/);
  assert.match(t, /Customer: Moote Trading/);
  assert.match(t, /Customer tax no: TX-9/);
  assert.match(t, /Salt \(exempt\)/);
  assert.match(t, /Discount\s+-13\.00/);
  assert.match(t, /Tax 12\.5%\s+22\.50/);
  assert.match(t, /TOTAL AUD\s+422\.50/);
  assert.match(t, /ON ACCOUNT - 30 days/);
  assert.match(t, /Pending: not yet confirmed/);
  assert.ok(
    t
      .split("\n")
      .every(
        (l) =>
          l.length <= 32 ||
          /^(TAX INVOICE|Customer|Tax no|Customer tax|Status|Reason)/.test(l),
      ),
  );
});
test("invoice text: paid cash, paid other (unverified), rejected with reason", () => {
  const paid = {
    ...sale,
    paymentMethod: "cash",
    syncStatus: "synced",
    invoice: { ...sale.invoice, mode: "paid" },
  };
  const a = I.buildInvoiceText(paid, {});
  assert.match(a, /Paid: Cash/);
  assert.match(a, /Confirmed by your ledger/);
  const o = I.buildInvoiceText({ ...paid, paymentMethod: "other" }, {});
  assert.match(o, /recorded, NOT verified/);
  const r = I.buildInvoiceText(
    { ...sale, syncStatus: "rejected", syncError: "Total does not match" },
    {},
  );
  assert.match(r, /REJECTED/);
  assert.match(r, /Reason: Total does not match/);
});
test("HTML builders escape all text", () => {
  const evil = "<img src=x onerror=alert(1)>";
  const s = {
    ...sale,
    id: '"><b>',
    syncStatus: "rejected",
    syncError: evil,
    invoice: { ...sale.invoice, number: evil, customerName: evil },
  };
  assert.ok(
    !I.invoiceRow(s).includes("<img") && !I.invoiceRow(s).includes("<b>"),
  );
  assert.ok(!I.accountRow({ name: evil }, 1, 2, 3).includes("<img"));
  assert.ok(
    !I.paymentRow({
      customerName: evil,
      note: evil,
      syncStatus: "rejected",
      syncError: evil,
      amount: 1,
      createdAt: 0,
    }).includes("<img"),
  );
});
test("accountRow says when the confirmed balance is from, or that it was never confirmed", () => {
  assert.match(I.accountRow({ name: "A" }, 0, 0, 100), /never confirmed/);
  assert.match(
    I.accountRow(
      { name: "A" },
      10,
      0,
      100,
      new Date(2026, 10, 22, 9, 30).getTime(),
    ),
    /as of 2026-11-22 09:30/,
  );
});
test("accountRow shows OVER LIMIT only when over", () => {
  assert.match(I.accountRow({ name: "A" }, 400, 150, 500), /OVER LIMIT/);
  assert.ok(!/OVER LIMIT/.test(I.accountRow({ name: "A" }, 400, 50, 500)));
  assert.match(I.accountRow({ name: "A" }, 1, 0, undefined), /limit not set/);
});
