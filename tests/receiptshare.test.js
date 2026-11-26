const test = require("node:test");
const assert = require("node:assert/strict");
const RS = require("../js/receiptshare.js");

const lines = [
  "Mwakete POS",
  "Receipt: R-AB12-0007",
  "1 x Tea (hot)        4.00",
  "TOTAL AUD            4.00",
  "Thank you – é",
];

test("the PDF is well formed: header, objects, and cross-reference offsets that really point at each object", () => {
  const { text, bytes } = RS.buildPdf(lines);
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.equal(bytes.length, text.length);
  const xrefAt = Number(/startxref\n(\d+)\n/.exec(text)[1]);
  assert.equal(text.slice(xrefAt, xrefAt + 4), "xref");
  const entries = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map(
    (m) => Number(m[1]),
  );
  assert.equal(entries.length, 5);
  entries.forEach((off, i) =>
    assert.ok(text.startsWith(i + 1 + " 0 obj\n", off), "object " + (i + 1)),
  );
  // the declared stream length matches the stream
  const m = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(text);
  assert.equal(Number(m[1]), m[2].length);
});

test("text is escaped and non-ASCII becomes ?", () => {
  const { text } = RS.buildPdf(["a (b) \\ c", "café — “q”"]);
  assert.ok(text.includes("(a \\(b\\) \\\\ c) Tj"));
  assert.ok(text.includes('(caf? - "q") Tj'));
  assert.ok(!/[^\x00-\x7f]/.test(text));
});

test("page height grows with the number of lines and long lines are cut", () => {
  const small = RS.buildPdf(["x"]).text.match(/MediaBox \[0 0 240 (\d+)\]/)[1];
  const big = RS.buildPdf(
    Array.from({ length: 60 }, () => "y".repeat(100)),
  ).text;
  assert.ok(Number(big.match(/MediaBox \[0 0 240 (\d+)\]/)[1]) > Number(small));
  assert.ok(!/y{61}/.test(big));
  assert.equal(
    RS.buildPdf(Array.from({ length: 1000 }, () => "z")).text.split(" Tj T*")
      .length - 1,
    400,
  );
});

test("empty input still gives a valid page", () => {
  const { text } = RS.buildPdf([]);
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(RS.buildPdf(null).bytes.length > 100);
});

test("file names are safe", () => {
  assert.equal(
    RS.fileName({ receiptNo: "R-AB12-0007" }, "pdf"),
    "receipt-R-AB12-0007.pdf",
  );
  assert.equal(
    RS.fileName({ id: "../../x y\u0000" }, "png"),
    "receipt-....xy.png",
  );
  assert.equal(RS.fileName({}, "pdf"), "receipt-receipt.pdf");
  assert.ok(!/[\/\\ ]/.test(RS.fileName({ receiptNo: "a/b c\\d" }, "pdf")));
});

test("file sharing is only offered when the browser can really do it", () => {
  const f = [{ type: "application/pdf" }];
  assert.equal(RS.canShareFiles({ share() {}, canShare: () => true }, f), true);
  assert.equal(
    RS.canShareFiles({ share() {}, canShare: () => false }, f),
    false,
  );
  assert.equal(RS.canShareFiles({ share() {} }, f), false);
  assert.equal(RS.canShareFiles({ canShare: () => true }, f), false);
  assert.equal(RS.canShareFiles(null, f), false);
  assert.equal(
    RS.canShareFiles(
      {
        share() {},
        canShare: () => {
          throw new Error("x");
        },
      },
      f,
    ),
    false,
  );
});

test("picture layout fits the longest line", () => {
  const l = RS.pictureLayout(["short", "a much longer receipt line goes here"]);
  assert.equal(l.rows.length, 2);
  assert.ok(l.width >= l.pad * 2 + 36 * l.charW);
  assert.equal(l.height, l.pad * 2 + 2 * l.lineH);
});
