const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/csv.js");

const NOW = 1_700_000_000_000;
let n = 0;
const opts = (o = {}) => ({ now: NOW, newId: () => "id" + ++n, ...o });
const run = (text, existing = [], o = {}) => {
  const p = C.parse(text);
  assert.equal(p.ok, true, p.error);
  return C.buildImport(p.rows, C.guessMapping(p.headers), existing, opts(o));
};

test("parses commas, quotes, doubled quotes, embedded commas and newlines, CRLF and a BOM", () => {
  const p = C.parse(
    '﻿name,price,note\r\n"Tea, black",2.50,"say ""hi"""\r\n"Two\nlines",1,x\r\n',
  );
  assert.equal(p.ok, true);
  assert.deepEqual(p.headers, ["name", "price", "note"]);
  assert.deepEqual(p.rows, [
    ["Tea, black", "2.50", 'say "hi"'],
    ["Two\nlines", "1", "x"],
  ]);
});

test("detects semicolons and tabs, and ignores blank lines", () => {
  assert.equal(C.parse("name;price\nTea;2\n\n\nJam;3\n").delimiter, ";");
  assert.deepEqual(C.parse("name;price\nTea;2\n\n\nJam;3\n").rows, [
    ["Tea", "2"],
    ["Jam", "3"],
  ]);
  assert.equal(C.parse("name\tprice\nTea\t2").delimiter, "\t");
  assert.equal(
    C.parse('"a,b";c\n1;2').delimiter,
    ";",
    "a comma inside quotes does not count",
  );
});

test("refuses empty files, a heading with no products, unclosed quotes, huge files and too many rows", () => {
  assert.match(C.parse("").error, /empty/);
  assert.match(C.parse("   \n  ").error, /empty/);
  assert.match(C.parse("name,price\n").error, /at least one product/);
  assert.match(C.parse('name,price\n"Tea,2').error, /never closed/);
  assert.match(C.parse("x".repeat(2_000_001)).error, /too big/);
  const many =
    "name,price\n" +
    Array.from({ length: 5002 }, (_, i) => "P" + i + ",1").join("\n");
  assert.match(C.parse(many).error, /Too many rows/);
});

test("guesses columns from common headings, each column used once", () => {
  const m = C.guessMapping([
    "Product Name",
    "Barcode",
    "Selling Price",
    "Qty",
    "Category",
    "Reorder Level",
  ]);
  assert.deepEqual(m, {
    name: 0,
    sku: 1,
    price: 2,
    stock: 3,
    category: 4,
    reorderLevel: 5,
  });
  const odd = C.guessMapping(["Item", "Code", "Price"]);
  assert.deepEqual(
    [odd.name, odd.sku, odd.price, odd.stock, odd.category],
    [0, 1, 2, -1, -1],
  );
  assert.equal(
    C.guessMapping(["Cost price", "Thing"]).price,
    -1,
    "a cost price is not guessed as the selling price",
  );
});

test("a good file previews every product as an add, with checked values", () => {
  const r = run(
    'name,sku,price,stock,category,reorder level\nTea,T1,2.5,10,Drinks,3\nJam,,"1,200.00",,,\n',
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { add: 2, update: 0, skip: 0, error: 0 });
  assert.deepEqual(r.items[0].product, {
    id: "id1",
    name: "Tea",
    price: 2.5,
    stock: 10,
    sku: "T1",
    updatedAt: NOW,
    category: "Drinks",
    reorderLevel: 3,
  });
  assert.deepEqual(
    [
      r.items[1].product.price,
      r.items[1].product.stock,
      "category" in r.items[1].product,
    ],
    [1200, 0, false],
  );
});

test("each bad row is reported with its row number and nothing else is lost", () => {
  const r = run(
    "name,price,stock,reorder\n,5,1,\nOK,abc,1,\nBad price,1.234,1,\nNeg,-2,1,\nStock,3,1.5,\nRe,3,1,x\nGood,4,2,1\n" +
      "L".repeat(101) +
      ",1,1,\n",
  );
  assert.equal(r.counts.add, 1);
  assert.deepEqual(
    r.errors.map((e) => e.row),
    [2, 3, 4, 5, 6, 7, 9],
  );
  assert.match(r.errors[0].message, /product name/);
  assert.match(r.errors[1].message, /number/);
  assert.match(r.errors[2].message, /2 decimals/);
  assert.match(r.errors[4].message, /stock must be a whole number/);
  assert.match(r.errors[5].message, /reorder level/);
  assert.match(r.errors[6].message, /too long/);
});

test("the same product twice in the file is caught (by barcode, or by name when there is none)", () => {
  const r = run("name,sku,price\nTea,T1,2\nTea Deluxe,t1,3\nJam,,1\njam,,2\n");
  assert.equal(r.counts.add, 2);
  assert.deepEqual(
    r.errors.map((e) => [e.row, /row \d/.exec(e.message)[0]]),
    [
      [3, "row 2"],
      [5, "row 4"],
    ],
  );
});

test("existing products: skipped by default, found by barcode or by name", () => {
  const existing = [
    { id: "e1", name: "Tea", sku: "T1", price: 2, stock: 7 },
    { id: "e2", name: "Jam", sku: "", price: 1, stock: 4 },
  ];
  const r = run(
    "name,sku,price\nTea (new name),T1,9\nJam,,9\nSalt,S1,1\n",
    existing,
  );
  assert.deepEqual(
    r.items.map((i) => i.action),
    ["skip", "skip", "add"],
  );
  assert.deepEqual(r.counts, { add: 1, update: 0, skip: 2, error: 0 });
});

test("updating changes price and details but keeps the stock count, unless asked", () => {
  const existing = [
    {
      id: "e1",
      name: "Tea",
      sku: "T1",
      price: 2,
      stock: 7,
      category: "Old",
      updatedAt: 5,
    },
  ];
  const csv = "name,sku,price,stock,category\nTea Premium,T1,9,100,Drinks\n";
  const u = run(csv, existing, { onDuplicate: "update" }).items[0];
  assert.equal(u.action, "update");
  assert.deepEqual(
    [
      u.product.id,
      u.product.name,
      u.product.price,
      u.product.stock,
      u.product.category,
      u.product.updatedAt,
    ],
    ["e1", "Tea Premium", 9, 7, "Drinks", NOW],
  );
  assert.equal(u.before.price, 2);
  assert.equal(
    run(csv, existing, { onDuplicate: "update", updateStock: true }).items[0]
      .product.stock,
    100,
  );
  assert.equal(
    run("name,sku,price\nTea,T1,3\n", existing, {
      onDuplicate: "update",
      updateStock: true,
    }).items[0].product.stock,
    7,
    "no stock column or empty cell: stock untouched",
  );
});

test("a missing name or price column is refused before any row is read", () => {
  const p = C.parse("sku,stock\nA,1\n");
  assert.match(
    C.buildImport(p.rows, C.guessMapping(p.headers), [], opts()).error,
    /product name/,
  );
  const q = C.parse("name,stock\nA,1\n");
  assert.match(
    C.buildImport(q.rows, C.guessMapping(q.headers), [], opts()).error,
    /price/,
  );
});

test("short rows do not crash and missing optional cells are fine", () => {
  const r = run("name,price,stock,category\nTea,2\nJam,1,5\n");
  assert.equal(r.counts.add, 2);
  assert.equal(r.items[1].product.stock, 5);
});

test("export is a CSV with every product, quotes where needed, and formulas neutralised", () => {
  const out = C.exportProducts([
    {
      name: "Tea, black",
      sku: "T1",
      price: 2.5,
      stock: 3,
      category: 'The "best"',
      reorderLevel: 2,
    },
    { name: '=HYPERLINK("http://evil")', sku: "+1", price: 1, stock: 0 },
    { name: "Plain", price: 1.005, stock: "x" },
  ]);
  const lines = out.split("\r\n");
  assert.equal(lines[0], "name,sku,price,stock,category,reorderLevel");
  assert.ok(lines.includes('"Tea, black",T1,2.50,3,"The ""best""",2'));
  assert.ok(
    lines.includes('"\'=HYPERLINK(""http://evil"")",\'+1,1.00,0,,'),
    "formula-looking cells get a leading apostrophe",
  );
  assert.ok(lines.some((l) => l.startsWith("Plain,,1.00,0")));
  assert.ok(out.endsWith("\r\n"));
});

test("an exported file imports back to the same products (formula apostrophe removed)", () => {
  const products = [
    {
      id: "a",
      name: "=SUM(A1)",
      sku: "X1",
      price: 2,
      stock: 4,
      category: "C",
      reorderLevel: 1,
    },
    { id: "b", name: 'Tea, "black"', sku: "", price: 3.5, stock: 0 },
  ];
  const r = run(C.exportProducts(products));
  assert.equal(r.counts.add, 2);
  const byName = Object.fromEntries(
    r.items.map((i) => [i.product.name, i.product]),
  );
  const f = byName["=SUM(A1)"];
  assert.deepEqual(
    [f.sku, f.price, f.stock, f.category, f.reorderLevel],
    ["X1", 2, 4, "C", 1],
  );
  assert.equal(byName['Tea, "black"'].price, 3.5);
});
