const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../js/wholesale.js");

function fakeStore() {
  const stores = { priceLists: new Map() };
  return {
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
const rice = {
  id: "p1",
  name: "Rice 1kg",
  price: 10,
  stock: 100,
  prices: { trade: 8.5, dist: 7 },
  packs: [
    { id: "ctn", name: "Carton", units: 24, sku: "RICE-C" },
    { id: "pal", name: "Pallet", units: 480, price: 3000 },
  ],
};

/* ---- price lists ---- */
test("price lists: add, list sorted, remove", async () => {
  const s = fakeStore();
  assert.equal((await W.addPriceList(s, { name: " Trade " }, "a", 1)).ok, true);
  assert.equal(
    (await W.addPriceList(s, { name: "Distributor" }, "b", 2)).ok,
    true,
  );
  assert.deepEqual(
    (await W.listPriceLists(s)).map((l) => l.name),
    ["Distributor", "Trade"],
  );
  await W.removePriceList(s, "a");
  assert.deepEqual(
    (await W.listPriceLists(s)).map((l) => l.id),
    ["b"],
  );
});
test("price lists: invalid, duplicate (case-insensitive) and over-limit are rejected", async () => {
  const s = fakeStore();
  await W.addPriceList(s, { name: "Trade" }, "a");
  for (const bad of [
    { name: "" },
    { name: "  " },
    { name: "x".repeat(41) },
    { name: "TRADE" },
    undefined,
  ])
    assert.equal(
      (await W.addPriceList(s, bad, "z")).ok,
      false,
      JSON.stringify(bad),
    );
  for (let i = 0; i < 19; i++)
    assert.equal(
      (await W.addPriceList(s, { name: "L" + i }, "i" + i)).ok,
      true,
    );
  assert.equal(
    (await W.addPriceList(s, { name: "One too many" }, "x")).ok,
    false,
  );
});

/* ---- price resolution ---- */
test("base unit uses the customer's list price, else the base price", () => {
  assert.deepEqual(W.resolvePrice(rice, "trade"), {
    price: 8.5,
    source: "list",
    usedBasePrice: false,
  });
  assert.deepEqual(W.resolvePrice(rice, ""), {
    price: 10,
    source: "base",
    usedBasePrice: false,
  });
  assert.deepEqual(W.resolvePrice(rice, "unknown-list"), {
    price: 10,
    source: "base",
    usedBasePrice: true,
  });
  assert.equal(
    W.resolvePrice({ price: 5, prices: {} }, "trade").usedBasePrice,
    true,
  );
});
test("a list price of 0 is a real price (free), not 'missing'", () => {
  assert.equal(
    W.resolvePrice({ price: 5, prices: { trade: 0 } }, "trade").price,
    0,
  );
});
test("pack without its own price = unit price (list or base) x units, in exact cents", () => {
  assert.equal(W.resolvePrice(rice, "trade", rice.packs[0]).price, 204); // 8.50 x 24
  assert.equal(W.resolvePrice(rice, "", rice.packs[0]).price, 240);
  assert.equal(
    W.resolvePrice({ price: 0.1, packs: [] }, "", { units: 3 }).price,
    0.3,
  ); // float trap
  assert.equal(
    W.resolvePrice(rice, "trade", rice.packs[0]).source,
    "list-x-units",
  );
});
test("pack with its own price uses it for every list", () => {
  for (const l of ["", "trade", "dist"])
    assert.deepEqual(W.resolvePrice(rice, l, rice.packs[1]), {
      price: 3000,
      source: "pack",
      usedBasePrice: false,
    });
});
test("stock units: packs reduce stock by units x quantity", () => {
  assert.equal(W.packStockUnits(rice.packs[0], 3), 72);
  assert.equal(W.packStockUnits(null, 5), 5);
});
test("findPack / findPackBySku are exact", () => {
  assert.equal(W.findPack(rice, "ctn").units, 24);
  assert.equal(W.findPack(rice, "nope"), null);
  assert.equal(W.findPackBySku([rice], " rice-c ").pack.id, "ctn");
  assert.equal(W.findPackBySku([rice], "RICE"), null);
  assert.equal(W.findPackBySku([rice], ""), null);
});

/* ---- till lines ---- */
test("buildLine: base unit and pack lines are distinct and keep the product id", () => {
  const base = W.buildLine(rice, "trade", null);
  const ctn = W.buildLine(rice, "trade", rice.packs[0]);
  assert.deepEqual(
    [base.id, base.productId, base.price, base.qty, base.packId],
    ["p1", "p1", 8.5, 1, undefined],
  );
  assert.deepEqual(
    [ctn.id, ctn.productId, ctn.price, ctn.packId, ctn.packUnits],
    ["p1:ctn", "p1", 204, "ctn", 24],
  );
  assert.equal(ctn.name, "Rice 1kg (Carton x24)");
});
test("repriceLines changes prices when the list changes and leaves unknown lines alone", () => {
  const cart = [
    W.buildLine(rice, "trade", null),
    W.buildLine(rice, "trade", rice.packs[0]),
    { id: "gone", productId: "gone", price: 7, qty: 1 },
  ];
  const out = W.repriceLines(cart, [rice], "dist");
  assert.deepEqual(
    out.map((l) => l.price),
    [7, 168, 7],
  );
  assert.equal(W.repriceLines(cart, [rice], "")[0].price, 10);
  assert.equal(cart[0].price, 8.5, "input not mutated");
});

/* ---- product validation ---- */
test("product wholesale extras: prices, packs and tax exempt", () => {
  const v = W.validateProductWholesale(
    {
      prices: { trade: "8.5", dist: "", other: "1" },
      packs: [
        { name: " Carton ", units: "24", price: "", sku: " C1 " },
        { name: "", units: "", price: "", sku: "" },
      ],
      taxExempt: true,
    },
    ["trade", "dist"],
  );
  assert.deepEqual(v.value, {
    prices: { trade: 8.5 },
    packs: [{ id: "pack1", name: "Carton", units: 24, sku: "C1" }],
    taxExempt: true,
  });
});
test("product wholesale extras: nothing entered = nothing stored (Counter/Retail products unchanged)", () => {
  assert.deepEqual(
    W.validateProductWholesale(
      { prices: {}, packs: [{ name: "", units: "" }] },
      ["a"],
    ),
    { ok: true, value: {} },
  );
  assert.deepEqual(W.validateProductWholesale(undefined, []), {
    ok: true,
    value: {},
  });
});
test("product wholesale extras: bad input is rejected", () => {
  const L = ["trade"];
  for (const bad of [
    { prices: { trade: "-1" } },
    { prices: { trade: "abc" } },
    { prices: { trade: "1.005" } },
    { packs: [{ name: "C", units: "1" }] },
    { packs: [{ name: "C", units: "2.5" }] },
    { packs: [{ name: "C", units: "100001" }] },
    { packs: [{ name: "", units: "5" }] },
    { packs: [{ name: "x".repeat(31), units: "5" }] },
    { packs: [{ name: "C", units: "5", price: "-2" }] },
    {
      packs: [
        { name: "A", units: "2", sku: "S" },
        { name: "B", units: "3", sku: "s" },
      ],
    },
    {
      packs: Array.from({ length: 6 }, (_, i) => ({
        name: "P" + i,
        units: 2 + i,
      })),
    },
  ])
    assert.equal(
      W.validateProductWholesale(bad, L).ok,
      false,
      JSON.stringify(bad).slice(0, 80),
    );
});

/* ---- tax ---- */
test("tax rate defaults to 12.5 and is validated", () => {
  assert.equal(W.validateTaxRate("").value, 12.5);
  assert.equal(W.validateTaxRate("15").value, 15);
  assert.equal(W.validateTaxRate("0").value, 0);
  for (const bad of ["-1", "101", "abc", "12.345", "Infinity"])
    assert.equal(W.validateTaxRate(bad).ok, false, bad);
});
test("tax: 12.5% on a simple total", () => {
  const t = W.computeTaxTotals([{ price: 100, qty: 2 }]);
  assert.deepEqual(
    [t.subtotal, t.taxable, t.tax, t.total, t.rate],
    [200, 200, 25, 225, 12.5],
  );
});
test("tax: exempt lines are excluded from the taxable amount", () => {
  const t = W.computeTaxTotals([
    { price: 100, qty: 1 },
    { price: 50, qty: 2, taxExempt: true },
  ]);
  assert.deepEqual(
    [t.subtotal, t.taxable, t.tax, t.total],
    [200, 100, 12.5, 212.5],
  );
});
test("tax: rounds half up to the cent, once on the taxable subtotal", () => {
  // 0.04 * 12.5% = 0.005 -> rounds up to 0.01
  assert.equal(W.computeTaxTotals([{ price: 0.04, qty: 1 }]).tax, 0.01);
  // 0.03 * 12.5% = 0.00375 -> 0.00
  assert.equal(W.computeTaxTotals([{ price: 0.03, qty: 1 }]).tax, 0);
  // three lines of 0.04: tax on the 0.12 subtotal = 0.015 -> 0.02 (per-line rounding would give 0.03)
  assert.equal(
    W.computeTaxTotals([
      { price: 0.04, qty: 1 },
      { price: 0.04, qty: 1 },
      { price: 0.04, qty: 1 },
    ]).tax,
    0.02,
  );
  assert.equal(W.computeTaxTotals([{ price: 0.1, qty: 3 }]).subtotal, 0.3);
});
test("tax: zero rate, empty cart, invalid rate", () => {
  assert.equal(W.computeTaxTotals([{ price: 10, qty: 1 }], 0).total, 10);
  assert.deepEqual(W.computeTaxTotals([], 12.5), {
    ok: true,
    rate: 12.5,
    subtotal: 0,
    taxable: 0,
    tax: 0,
    total: 0,
  });
  assert.equal(W.computeTaxTotals([{ price: 1, qty: 1 }], 200).ok, false);
});

/* ---- trade customers ---- */
test("trade customer extras", () => {
  assert.deepEqual(W.validateTradeExtras({ type: "retail" }, ["a"]), {
    ok: true,
    value: {},
  });
  assert.deepEqual(
    W.validateTradeExtras(
      {
        type: "trade",
        priceListId: "a",
        creditLimit: "500",
        terms: " 30 days ",
        taxNumber: " T-1 ",
      },
      ["a"],
    ).value,
    {
      type: "trade",
      priceListId: "a",
      creditLimit: 500,
      terms: "30 days",
      taxNumber: "T-1",
    },
  );
  assert.deepEqual(W.validateTradeExtras({ type: "trade" }, []).value, {
    type: "trade",
  });
});
test("trade customer extras: invalid values rejected", () => {
  for (const bad of [
    { priceListId: "nope" },
    { creditLimit: "-5" },
    { creditLimit: "abc" },
    { creditLimit: "1.005" },
    { terms: "x".repeat(41) },
    { taxNumber: "x".repeat(31) },
  ])
    assert.equal(
      W.validateTradeExtras({ type: "trade", ...bad }, ["a"]).ok,
      false,
      JSON.stringify(bad),
    );
});

/* ---- HTML builders ---- */
test("builders escape all text", () => {
  const evil = "<img src=x onerror=alert(1)>";
  assert.ok(!W.priceListRow({ id: '"><b>', name: evil }).includes("<img"));
  assert.ok(
    !W.packCard(
      { id: evil, name: evil },
      { id: evil, name: evil, units: evil },
      1,
    ).includes("<img"),
  );
  assert.ok(
    !W.tradeBadge(
      { type: "trade", priceListId: "a", terms: evil },
      { a: evil },
    ).includes("<img"),
  );
  assert.equal(W.tradeBadge({ type: "retail" }, {}), "");
});
