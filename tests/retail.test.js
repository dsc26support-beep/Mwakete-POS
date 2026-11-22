const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/retail.js");

function fakeStore() {
  const stores = { customers: new Map() };
  return {
    stores,
    async all(s) {
      return [...stores[s].values()];
    },
    async put(s, v) {
      stores[s].set(v.id, structuredClone(v));
      return v;
    },
    async remove(s, k) {
      stores[s].delete(k);
    },
  };
}
const cart = [
  { price: 10, qty: 2 },
  { price: 0.1, qty: 3 },
]; // 20.30

/* ---- discounts ---- */
test("no discount leaves the total unchanged", () => {
  for (const input of [
    undefined,
    { type: "none" },
    { type: "percent", value: "" },
    { type: "fixed", value: 0 },
  ]) {
    const t = R.computeTotals(cart, input);
    assert.equal(t.ok, true);
    assert.equal(t.discount, null);
    assert.equal(t.total, 20.3);
  }
});

test("percent discount is computed in cents without float drift", () => {
  const t = R.computeTotals(cart, { type: "percent", value: 10 });
  assert.equal(t.subtotal, 20.3);
  assert.equal(t.discount.amount, 2.03);
  assert.equal(t.total, 18.27);
  // classic float trap: 3 x 0.1 must be exactly 0.30
  assert.equal(R.computeTotals([{ price: 0.1, qty: 3 }], undefined).total, 0.3);
});

test("fixed discount applies and can equal the full total", () => {
  assert.equal(R.computeTotals(cart, { type: "fixed", value: 5 }).total, 15.3);
  assert.equal(R.computeTotals(cart, { type: "fixed", value: 20.3 }).total, 0);
  assert.equal(R.computeTotals(cart, { type: "percent", value: 100 }).total, 0);
});

test("invalid or excessive discounts are rejected", () => {
  for (const input of [
    { type: "fixed", value: 20.31 },
    { type: "percent", value: 100.01 },
    { type: "percent", value: -5 },
    { type: "fixed", value: "abc" },
    { type: "fixed", value: Infinity },
    { type: "bogus", value: 5 },
  ])
    assert.equal(R.computeTotals(cart, input).ok, false, JSON.stringify(input));
});

test("discount is rounded to whole cents", () => {
  const t = R.computeTotals([{ price: 0.99, qty: 1 }], {
    type: "percent",
    value: 33.333,
  });
  assert.equal(Number.isInteger(R.toMinor(t.discount.amount)), true);
  assert.ok(t.total >= 0);
});

/* ---- products ---- */
test("product extras: category and reorder level", () => {
  assert.deepEqual(
    R.validateProductExtras({ category: "  Drinks ", reorderLevel: "5" }),
    { ok: true, value: { category: "Drinks", reorderLevel: 5 } },
  );
  assert.deepEqual(
    R.validateProductExtras({ category: "", reorderLevel: "" }),
    { ok: true, value: {} },
  );
  assert.deepEqual(R.validateProductExtras({ reorderLevel: "0" }).value, {
    reorderLevel: 0,
  });
  for (const bad of [
    { reorderLevel: "-1" },
    { reorderLevel: "2.5" },
    { reorderLevel: "x" },
    { category: "x".repeat(41) },
  ])
    assert.equal(R.validateProductExtras(bad).ok, false);
});

test("low-stock list includes only products with a reorder level at or above stock", () => {
  const products = [
    { name: "A", stock: 2, reorderLevel: 5 },
    { name: "B", stock: 5, reorderLevel: 5 },
    { name: "C", stock: 6, reorderLevel: 5 },
    { name: "D", stock: 0 },
    { name: "E", stock: 1, reorderLevel: 0 },
  ];
  assert.deepEqual(
    R.lowStock(products).map((p) => p.name),
    ["A", "B"],
  );
  assert.equal(
    R.lowStock([{ name: "Z", stock: 0, reorderLevel: 0 }]).length,
    1,
  );
});

test("barcode lookup is exact (trimmed, case-insensitive) and never partial", () => {
  const products = [
    { id: "1", sku: "ABC123" },
    { id: "2", sku: "ABC1234" },
    { id: "3" },
  ];
  assert.equal(R.findBySku(products, " abc123\n").id, "1");
  assert.equal(R.findBySku(products, "ABC12"), null);
  assert.equal(R.findBySku(products, ""), null);
  assert.equal(R.findBySku(products, undefined), null);
});

/* ---- customers ---- */
test("customers: add, list sorted, remove", async () => {
  const s = fakeStore();
  assert.equal(
    (await R.addCustomer(s, { name: " Zed ", phone: "+686 73052765" }, "c1", 1))
      .ok,
    true,
  );
  assert.equal((await R.addCustomer(s, { name: "Amy" }, "c2", 2)).ok, true);
  assert.deepEqual(
    (await R.listCustomers(s)).map((c) => c.name),
    ["Amy", "Zed"],
  );
  await R.removeCustomer(s, "c1");
  assert.deepEqual(
    (await R.listCustomers(s)).map((c) => c.id),
    ["c2"],
  );
});

test("invalid customers are rejected and not stored", async () => {
  const s = fakeStore();
  for (const bad of [
    { name: "" },
    { name: "x".repeat(81) },
    { name: "A", phone: "abc" },
    { name: "A", notes: "n".repeat(301) },
    undefined,
  ])
    assert.equal((await R.addCustomer(s, bad, "id")).ok, false);
  assert.equal((await R.listCustomers(s)).length, 0);
});

/* ---- receipt ---- */
const sale = {
  id: "sale-1",
  createdAt: new Date(2026, 10, 21, 9, 5).getTime(),
  currency: "AUD",
  paymentMethod: "cash",
  syncStatus: "pending",
  items: [{ name: "Bottled water", unitPrice: 2.5, quantity: 2 }],
  subtotal: 5,
  total: 4.5,
  discount: { type: "percent", value: 10, amount: 0.5 },
};
test("receipt text shows items, discount, total and sync status", () => {
  const t = R.buildReceiptText(sale, "Moote Shop", { name: "Amy" });
  assert.match(t, /Moote Shop/);
  assert.match(t, /Receipt: sale-1/);
  assert.match(t, /2026-11-21 09:05/);
  assert.match(t, /Customer: Amy/);
  assert.match(t, /2 x Bottled water\s+5\.00/);
  assert.match(t, /Discount \(10%\)\s+-0\.50/);
  assert.match(t, /TOTAL AUD\s+4\.50/);
  assert.match(t, /Paid: Cash/);
  assert.match(t, /Status: pending \(saved on this device\)/);
  assert.ok(
    t
      .split("\n")
      .every(
        (l) =>
          l.length <= 32 ||
          l.startsWith("Receipt:") ||
          l.startsWith("Customer:") ||
          l.startsWith("Status:") ||
          l.startsWith("Payment:"),
      ),
  );
});
test("non-cash receipts say the payment is NOT verified", () => {
  assert.match(
    R.buildReceiptText(
      {
        ...sale,
        paymentMethod: "other",
        discount: null,
        subtotal: 5,
        total: 5,
      },
      "S",
    ),
    /recorded, NOT verified/,
  );
});
test("receipt works for a sale with no discount fields (old sales)", () => {
  const old = {
    id: "o1",
    createdAt: 0,
    currency: "AUD",
    paymentMethod: "cash",
    items: [{ name: "X", unitPrice: 1, quantity: 1 }],
    total: 1,
  };
  const t = R.buildReceiptText(old, "S");
  assert.ok(!/Discount/.test(t));
  assert.match(t, /TOTAL AUD\s+1\.00/);
});
test("receipt HTML escapes everything", () => {
  const html = R.receiptHtml(
    R.buildReceiptText(
      {
        ...sale,
        items: [
          { name: "<img src=x onerror=alert(1)>", unitPrice: 1, quantity: 1 },
        ],
      },
      "<b>Shop</b>",
    ),
  );
  assert.ok(!html.includes("<img") && !html.includes("<b>"));
});

/* ---- reports ---- */
test("sales report aggregates by day, category and product", () => {
  const d1 = new Date(2026, 10, 20, 10).getTime(),
    d2 = new Date(2026, 10, 21, 10).getTime();
  const products = [
    { id: "p1", price: 2, stock: 10, category: "Drinks" },
    { id: "p2", price: 5, stock: 1 },
  ];
  const sales = [
    {
      createdAt: d1,
      total: 6,
      items: [{ productId: "p1", name: "Water", unitPrice: 2, quantity: 3 }],
    },
    {
      createdAt: d2,
      total: 9,
      items: [
        { productId: "p1", name: "Water", unitPrice: 2, quantity: 2 },
        { productId: "p2", name: "Rice", unitPrice: 5, quantity: 1 },
      ],
    },
    {
      createdAt: d2,
      total: 4,
      items: [
        {
          productId: "gone",
          name: "Old item",
          unitPrice: 4,
          quantity: 1,
          category: "Snacks",
        },
      ],
    },
  ];
  const r = R.salesReport(sales, products);
  assert.equal(r.salesCount, 3);
  assert.equal(r.total, 19);
  assert.deepEqual(
    r.byDay.map((d) => [d.day, d.count, d.total]),
    [
      ["2026-11-20", 1, 6],
      ["2026-11-21", 2, 13],
    ],
  );
  assert.deepEqual(
    r.byCategory.map((c) => [c.category, c.qty, c.total]),
    [
      ["Drinks", 5, 10],
      ["Uncategorised", 1, 5],
      ["Snacks", 1, 4],
    ],
  );
  assert.deepEqual(r.topProducts[0], {
    name: "Water",
    qty: 5,
    totalMinor: 1000,
    total: 10,
  });
  assert.equal(r.stockValue, 25);
});
test("sales report excludes tax on Wholesale invoices (total is gross, tax is subtracted)", () => {
  const d = new Date(2026, 10, 22, 10).getTime();
  const sales = [
    {
      createdAt: d,
      total: 225,
      tax: 25,
      items: [{ productId: "p1", name: "Rice", unitPrice: 100, quantity: 2 }],
    },
    {
      createdAt: d,
      total: 10,
      items: [{ productId: "p1", name: "Rice", unitPrice: 10, quantity: 1 }],
    },
  ];
  const r = R.salesReport(sales, []);
  assert.equal(r.total, 210);
  assert.deepEqual(
    r.byDay.map((x) => x.total),
    [210],
  );
  assert.match(R.reportHtml(r, "AUD"), /Totals exclude tax/);
});
test("sales report handles no data", () => {
  const r = R.salesReport([], []);
  assert.deepEqual(
    [r.salesCount, r.total, r.byDay, r.stockValue],
    [0, 0, [], 0],
  );
  assert.match(R.reportHtml(r, "AUD"), /No data yet/);
});
test("report HTML escapes names and states it is not the cloud ledger", () => {
  const r = R.salesReport(
    [
      {
        createdAt: 0,
        total: 1,
        items: [
          {
            productId: "x",
            name: "<script>alert(1)</script>",
            unitPrice: 1,
            quantity: 1,
          },
        ],
      },
    ],
    [],
  );
  const html = R.reportHtml(r, "<b>");
  assert.ok(!html.includes("<script>") && !html.includes("<b>"));
  assert.match(html, /not the cloud ledger/);
});

/* ---- HTML builders ---- */
test("customer and low-stock rows escape text", () => {
  const evil = "<img src=x onerror=alert(1)>";
  assert.ok(
    !R.customerRow({
      id: '"><b>',
      name: evil,
      phone: evil,
      notes: evil,
    }).includes("<img"),
  );
  assert.ok(
    !R.lowStockPanel([
      { name: evil, category: evil, stock: 1, reorderLevel: 2 },
    ]).includes("<img"),
  );
});
