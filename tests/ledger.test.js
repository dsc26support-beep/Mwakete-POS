const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers/gas.js");
const I = require("../js/invoices.js");

const ON = { LEDGER_ENABLED: "true" };
const cust = (over = {}) => ({
  id: "c1",
  name: "Moote Trading",
  creditLimit: 500,
  terms: "30 days",
  taxNumber: "TX-9",
  ...over,
});

// Builds a valid Wholesale sale carrying an invoice, using the real client maths.
function invSale(o = {}) {
  const items = o.items || [
    { productId: "p", name: "Rice", unitPrice: 100, quantity: 2 },
  ];
  const cart = items.map((i) => ({
    price: i.unitPrice,
    qty: i.quantity,
    taxExempt: !!i.taxExempt,
  }));
  const discount = o.discount ? { amount: o.discount } : null;
  const built = I.buildInvoice(
    cart,
    discount,
    o.customer === null
      ? null
      : { id: "c1", name: "Moote Trading", taxNumber: "TX-9" },
    {
      rate: o.rate ?? 12.5,
      number: o.number || "INV-ABCD-0001",
      mode: o.mode || "account",
      terms: "30 days",
      sellerTaxNumber: "S-1",
    },
  );
  assert.equal(built.ok, true, built.error);
  const sub = built.totals.subtotal;
  const s = {
    id: o.id || "w1",
    createdAt: 1000,
    currency: "AUD",
    paymentMethod: "cash",
    tier: "wholesale",
    items,
    subtotal: sub,
    total: sub - (o.discount || 0),
    ...(o.customer === null ? {} : { customerId: o.customerId || "c1" }),
    ...(discount
      ? { discount: { type: "fixed", value: o.discount, amount: o.discount } }
      : {}),
  };
  I.applyToSale(s, built);
  return s;
}
const sync = (extra) => ({
  type: "pos_sync",
  schemaVersion: 2,
  transactions: [],
  payments: [],
  customers: [],
  ...extra,
});
const pay = (o = {}) => ({
  id: "p1",
  customerId: "c1",
  customerName: "Moote Trading",
  amount: 50,
  method: "cash",
  note: "",
  createdAt: 2000,
  ...o,
});

/* ---- the owner's switch ---- */
test("with the ledger OFF, invoices and payments are rejected and no ledger sheet is created", () => {
  const { post, rows } = load();
  const r = post(
    sync({ transactions: [invSale()], payments: [pay()], customers: [cust()] }),
  );
  assert.equal(r.ok, true);
  assert.deepEqual([r.acceptedIds, r.acceptedPaymentIds], [[], []]);
  assert.equal(r.rejected.length, 2);
  for (const x of r.rejected) assert.match(x.reason, /Ledger not enabled/);
  assert.deepEqual(
    [rows("Invoices"), rows("Payments"), rows("Customers")],
    [null, null, null],
  );
  assert.equal(
    rows("Sales").length,
    1,
    "the rejected invoice sale was not stored",
  );
});
test("with the ledger OFF, plain sales (including Wholesale cash sales without an invoice) still sync", () => {
  const { post } = load();
  const plain = {
    id: "k1",
    createdAt: 1,
    currency: "AUD",
    paymentMethod: "cash",
    tier: "wholesale",
    total: 10,
    items: [{ unitPrice: 5, quantity: 2 }],
  };
  assert.deepEqual(post(sync({ transactions: [plain] })).acceptedIds, ["k1"]);
});

/* ---- invoices ---- */
test("an on-account invoice is accepted, stored in Sales and Invoices, and the balance is computed by the server", () => {
  const { post, rows } = load({ props: ON });
  const r = post(sync({ transactions: [invSale()], customers: [cust()] }));
  assert.deepEqual(r.acceptedIds, ["w1"]);
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(r.balances, { c1: 225 });
  assert.deepEqual(r.overLimit, []);
  const s = rows("Sales")[1];
  assert.deepEqual(
    [s[3], s[9], s[10], s[11], s[8]],
    [225, 25, "INV-ABCD-0001", "account", "wholesale"],
  );
  const v = rows("Invoices")[1];
  assert.deepEqual(
    [
      v[0],
      v[1],
      v[3],
      v[4],
      v[5],
      v[7],
      v[9],
      v[10],
      v[11],
      v[12],
      v[13],
      v[14],
      v[15],
    ],
    [
      "INV-ABCD-0001",
      "w1",
      "c1",
      "Moote Trading",
      "TX-9",
      200,
      200,
      12.5,
      25,
      225,
      "account",
      "30 days",
      "",
    ],
  );
  assert.deepEqual(rows("Customers")[1].slice(0, 5), [
    "c1",
    "Moote Trading",
    500,
    "30 days",
    "TX-9",
  ]);
});
test("a paid invoice and a walk-in paid invoice are stored but do not change any balance", () => {
  const { post, rows } = load({ props: ON });
  const a = invSale({ id: "a", number: "INV-ABCD-0001", mode: "paid" });
  const b = invSale({
    id: "b",
    number: "INV-ABCD-0002",
    mode: "paid",
    customer: null,
  });
  const r = post(sync({ transactions: [a, b] }));
  assert.deepEqual(r.acceptedIds, ["a", "b"]);
  assert.deepEqual(r.balances, {});
  assert.equal(rows("Invoices").length, 3);
});
test("a sale on account without a customer is rejected", () => {
  const { post } = load({ props: ON });
  const s = invSale();
  delete s.customerId;
  const r = post(sync({ transactions: [s] }));
  assert.match(r.rejected[0].reason, /needs a customer/);
});

/* ---- server recomputes the money ---- */
test("tax with a discount and exempt lines matches the client maths exactly", () => {
  const { post, rows } = load({ props: ON });
  const s = invSale({
    items: [
      { unitPrice: 100, quantity: 1 },
      { unitPrice: 100, quantity: 1, taxExempt: true },
    ],
    discount: 20,
  });
  assert.deepEqual(
    [s.invoice.taxableNet, s.invoice.tax, s.total],
    [90, 11.25, 191.25],
  );
  assert.deepEqual(post(sync({ transactions: [s] })).acceptedIds, ["w1"]);
  assert.equal(rows("Invoices")[1][11], 11.25);
});
test("tampered money is rejected: tax, taxable, total, subtotal, sale total, rate", () => {
  const cases = [
    [
      "tax",
      (s) => {
        s.invoice.tax = 24;
        s.tax = 24;
      },
      /Tax does not match/,
    ],
    [
      "tax only on invoice",
      (s) => {
        s.invoice.tax = 0;
      },
      /Tax does not match/,
    ],
    [
      "tax only on sale",
      (s) => {
        s.tax = 0;
      },
      /Tax does not match/,
    ],
    [
      "taxable",
      (s) => {
        s.invoice.taxableNet = 150;
      },
      /Taxable amount/,
    ],
    [
      "invoice total",
      (s) => {
        s.invoice.total = 200;
      },
      /Invoice total/,
    ],
    [
      "subtotal",
      (s) => {
        s.subtotal = 100;
      },
      /Subtotal/,
    ],
    [
      "sale total",
      (s) => {
        s.total = 200;
      },
      /does not match/,
    ],
    [
      "rate",
      (s) => {
        s.invoice.taxRate = 0;
      },
      /Tax does not match/,
    ],
    [
      "exempt flag dropped",
      (s) => {
        s.items[0].taxExempt = true;
      },
      /Tax does not match/,
    ],
  ];
  for (const [name, mutate, re] of cases) {
    const { post, rows } = load({ props: ON });
    const s = invSale();
    mutate(s);
    const r = post(sync({ transactions: [s] }));
    assert.deepEqual(r.acceptedIds, [], name);
    assert.match(r.rejected[0].reason, re, name);
    assert.equal(rows("Sales").length, 1, name + ": nothing stored");
  }
});
test("invalid invoice fields are rejected", () => {
  const cases = [
    (s) => {
      s.invoice.mode = "gift";
    },
    (s) => {
      s.invoice.number = "INV-1";
    },
    (s) => {
      s.invoice.number = "x; DROP";
    },
    (s) => {
      s.invoice.customerName = "";
    },
    (s) => {
      s.invoice.customerName = "x".repeat(81);
    },
    (s) => {
      s.invoice.taxRate = -1;
    },
    (s) => {
      s.invoice.taxRate = 101;
    },
    (s) => {
      s.invoice.taxRate = 12.345;
    },
    (s) => {
      s.invoice.terms = "x".repeat(41);
    },
    (s) => {
      s.invoice.customerTaxNumber = "x".repeat(31);
    },
  ];
  cases.forEach((mutate, i) => {
    const { post } = load({ props: ON });
    const s = invSale();
    mutate(s);
    assert.deepEqual(
      post(sync({ transactions: [s] })).acceptedIds,
      [],
      "case " + i,
    );
  });
});
test("a pinned TAX_RATE property rejects invoices at any other rate", () => {
  const { post } = load({ props: { ...ON, TAX_RATE: "12.5" } });
  assert.deepEqual(post(sync({ transactions: [invSale()] })).acceptedIds, [
    "w1",
  ]);
  const other = invSale({ id: "w2", number: "INV-ABCD-0002", rate: 10 });
  assert.match(
    post(sync({ transactions: [other] })).rejected[0].reason,
    /rate set for this business/,
  );
});

/* ---- idempotency and numbering ---- */
test("re-sending an invoice is idempotent: accepted again, stored once, balance unchanged", () => {
  const { post, rows } = load({ props: ON });
  post(sync({ transactions: [invSale()], customers: [cust()] }));
  const r = post(sync({ transactions: [invSale()] }));
  assert.deepEqual(r.acceptedIds, ["w1"]);
  assert.deepEqual(r.balances, { c1: 225 });
  assert.deepEqual([rows("Sales").length, rows("Invoices").length], [2, 2]);
});
test("a reused invoice NUMBER with a different sale id is rejected; the same id is accepted", () => {
  const { post, rows } = load({ props: ON });
  post(sync({ transactions: [invSale()] }));
  const clash = invSale({ id: "other" });
  const r = post(sync({ transactions: [clash] }));
  assert.deepEqual(r.acceptedIds, []);
  assert.match(r.rejected[0].reason, /already used/);
  assert.equal(rows("Sales").length, 2, "the clashing sale was not stored");
});
test("a retry completes a partly written invoice (sale row present, invoice row missing)", () => {
  const first = load({ props: ON });
  first.post(sync({ transactions: [invSale()], customers: [cust()] }));
  const seed = {
    Sales: first.rows("Sales"),
    Customers: first.rows("Customers"),
    Invoices: [first.rows("Invoices")[0]],
    Payments: [
      [
        "Payment ID",
        "Created At",
        "Customer ID",
        "Customer Name",
        "Amount",
        "Method",
        "Note",
      ],
    ],
  };
  const { post, rows } = load({ props: ON, sheets: seed });
  const r = post(sync({ transactions: [invSale()] }));
  assert.deepEqual(r.acceptedIds, ["w1"]);
  assert.equal(rows("Sales").length, 2, "sale not duplicated");
  assert.equal(rows("Invoices").length, 2, "missing invoice row written");
  assert.deepEqual(r.balances, { c1: 225 });
});

/* ---- payments ---- */
test("payments reduce the balance, are idempotent, and the server computes the result", () => {
  const { post, rows } = load({ props: ON });
  post(sync({ transactions: [invSale()], customers: [cust()] }));
  const r = post(sync({ payments: [pay({ amount: 100 })] }));
  assert.deepEqual([r.acceptedPaymentIds, r.balances], [["p1"], { c1: 125 }]);
  const again = post(sync({ payments: [pay({ amount: 100 })] }));
  assert.deepEqual(
    [again.acceptedPaymentIds, again.balances, rows("Payments").length],
    [["p1"], { c1: 125 }, 2],
  );
  assert.deepEqual(
    rows("Payments")[1]
      .slice(0, 6)
      .map((v, i) => (i === 1 ? "d" : v)),
    ["p1", "d", "c1", "Moote Trading", 100, "cash"],
  );
});
test("an overpayment gives a negative balance (credit) rather than an error", () => {
  const { post } = load({ props: ON });
  post(sync({ transactions: [invSale()] }));
  assert.deepEqual(post(sync({ payments: [pay({ amount: 300 })] })).balances, {
    c1: -75,
  });
});
test("invalid payments are rejected individually", () => {
  const bad = [
    pay({ id: "" }),
    pay({ customerId: "" }),
    pay({ amount: 0 }),
    pay({ amount: -5 }),
    pay({ amount: "abc" }),
    pay({ amount: 1.005 }),
    pay({ method: "card" }),
    pay({ createdAt: "x" }),
    pay({ note: "x".repeat(201) }),
    null,
  ];
  const { post, rows } = load({ props: ON });
  const r = post(sync({ payments: [...bad, pay({ id: "good" })] }));
  assert.deepEqual(r.acceptedPaymentIds, ["good"]);
  assert.equal(r.rejected.length, bad.length);
  assert.equal(rows("Payments").length, 2);
});

/* ---- customers and credit limit ---- */
test("the credit limit lives in the owner's Sheet: client seeds are INSERT-ONLY", () => {
  const { post, rows } = load({ props: ON });
  post(sync({ customers: [cust({ creditLimit: 100 })] }));
  post(sync({ customers: [cust({ creditLimit: 99999, name: "Changed" })] }));
  assert.equal(rows("Customers").length, 2);
  assert.deepEqual(rows("Customers")[1].slice(1, 3), ["Moote Trading", 100]);
});
test("over-limit uses the limit in the Sheet (editable by the owner), not the client's value", () => {
  const sheets = {
    Customers: [
      ["Customer ID", "Name", "Credit Limit", "Terms", "Tax No", "Added At"],
      ["c1", "Moote Trading", 200, "", "", ""],
    ],
  };
  const { post, rows } = load({ props: ON, sheets });
  const r = post(
    sync({
      transactions: [invSale()],
      customers: [cust({ creditLimit: 99999 })],
    }),
  ); // 225 > 200
  assert.deepEqual(r.overLimit, ["c1"]);
  assert.equal(rows("Invoices")[1][15], "YES");
  assert.equal(rows("Customers").length, 2, "not overwritten");
});
test("a customer with no limit is never flagged; a payment clears the flag", () => {
  const a = load({ props: ON });
  assert.deepEqual(
    a.post(
      sync({
        transactions: [invSale()],
        customers: [cust({ creditLimit: "" })],
      }),
    ).overLimit,
    [],
  );
  const b = load({ props: ON });
  assert.deepEqual(
    b.post(
      sync({
        transactions: [invSale()],
        customers: [cust({ creditLimit: 200 })],
      }),
    ).overLimit,
    ["c1"],
  );
  assert.deepEqual(
    b.post(sync({ payments: [pay({ amount: 100 })] })).overLimit,
    [],
  );
});
test("bad customer seeds are ignored and never block sales", () => {
  const { post, rows } = load({ props: ON });
  const r = post(
    sync({
      transactions: [invSale()],
      customers: [
        null,
        { id: "", name: "x" },
        { id: "c2", name: "" },
        { id: "c3", name: "A", creditLimit: -5 },
        cust({ id: "c9", creditLimit: 10 }),
      ],
    }),
  );
  assert.deepEqual(r.acceptedIds, ["w1"]);
  assert.deepEqual(
    rows("Customers")
      .slice(1)
      .map((x) => x[0]),
    ["c9"],
  );
});

/* ---- mixed batches ---- */
test("a mixed batch reports each record on its own", () => {
  const { post } = load({ props: ON });
  const bad = invSale({ id: "bad", number: "INV-ABCD-0002" });
  bad.tax = 1;
  const r = post(
    sync({
      transactions: [
        invSale(),
        bad,
        invSale({ id: "w3", number: "INV-ABCD-0003" }),
      ],
      payments: [pay(), pay({ id: "pbad", amount: -1 })],
    }),
  );
  assert.deepEqual(r.acceptedIds, ["w1", "w3"]);
  assert.deepEqual(r.acceptedPaymentIds, ["p1"]);
  assert.deepEqual(r.rejected.map((x) => [x.id, x.kind]).sort(), [
    ["bad", "sale"],
    ["pbad", "payment"],
  ]);
  assert.deepEqual(r.balances, { c1: 225 + 225 - 50 });
});
test("balances are returned only for customers touched by the request", () => {
  const { post } = load({ props: ON });
  post(sync({ transactions: [invSale()] }));
  const other = invSale({
    id: "w9",
    number: "INV-ABCD-0009",
    customerId: "c2",
  });
  assert.deepEqual(
    Object.keys(post(sync({ transactions: [other] })).balances),
    ["c2"],
  );
});

/* ---- client and server agree ---- */
test("client and server tax maths agree on 2000 random invoices", () => {
  const { ctx } = load({ props: ON });
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let n = 0; n < 2000; n++) {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({
      price: Math.round(rnd() * 100000) / 100,
      qty: 1 + Math.floor(rnd() * 20),
      taxExempt: rnd() < 0.3,
    }));
    const sub = lines.reduce((m, l) => m + I.toMinor(l.price) * l.qty, 0);
    const disc = rnd() < 0.5 ? 0 : Math.floor(rnd() * (sub + 1));
    const rate = Math.round(rnd() * 3000) / 100;
    const c = I.computeInvoiceTotals(lines, disc / 100, rate);
    const taxable = lines
      .filter((l) => !l.taxExempt)
      .reduce((m, l) => m + I.toMinor(l.price) * l.qty, 0);
    const s = ctx.computeInvoiceTotals_(
      sub,
      taxable,
      disc,
      Math.round(rate * 100),
    );
    assert.deepEqual(
      [s.taxableNet, s.tax],
      [I.toMinor(c.taxableNet), I.toMinor(c.tax)],
      JSON.stringify({ lines, disc, rate }),
    );
  }
});
