const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/scan.js");

const type = (buf, text, start, gap, enter = true) => {
  let t = start;
  for (const ch of text) {
    buf.feed(ch, t);
    t += gap;
  }
  return enter ? buf.feed("Enter", t) : null;
};

test("a fast burst ending in Enter is a scan", () => {
  const b = S.createBuffer();
  assert.equal(type(b, "4006381333931", 1000, 8), "4006381333931");
});

test("slow typing is not a scan", () => {
  const b = S.createBuffer();
  assert.equal(type(b, "4006381333931", 1000, 200), null);
});

test("short bursts and spaces are not scans", () => {
  const b = S.createBuffer();
  assert.equal(type(b, "123", 0, 5), null);
  assert.equal(type(b, "ab cd ef", 0, 5), null);
});

test("typing before a scan does not leak into it", () => {
  const b = S.createBuffer();
  type(b, "hello", 0, 300, false);
  assert.equal(type(b, "5449000000996", 5000, 6), "5449000000996");
});

test("two scans in a row are separate", () => {
  const b = S.createBuffer();
  assert.equal(type(b, "11112222", 0, 5), "11112222");
  assert.equal(type(b, "33334444", 100, 5), "33334444");
});

test("control keys are ignored and Enter alone gives nothing", () => {
  const b = S.createBuffer();
  assert.equal(b.feed("Shift", 1), null);
  assert.equal(b.feed("Enter", 2), null);
});

test("clean strips control characters and caps length", () => {
  assert.equal(S.clean(" 12\u0000 34\n"), "12 34");
  assert.equal(S.clean("x".repeat(200)).length, S.MAX_CODE);
  assert.equal(S.clean(null), "");
});

test("duplicate camera frames count once", () => {
  const last = { code: "123456", at: 1000 };
  assert.equal(S.isDuplicate(last, "123456", 1500), true);
  assert.equal(S.isDuplicate(last, "123456", 2600), false);
  assert.equal(S.isDuplicate(last, "999999", 1100), false);
  assert.equal(S.isDuplicate(null, "1", 1), false);
});

test("camera support needs a detector, a camera and a secure page", () => {
  const det = function () {};
  const md = { getUserMedia() {} };
  assert.equal(
    S.cameraSupport({ BarcodeDetector: det, mediaDevices: md, secure: true })
      .ok,
    true,
  );
  assert.equal(S.cameraSupport({ mediaDevices: md, secure: true }).ok, false);
  assert.equal(
    S.cameraSupport({ BarcodeDetector: det, secure: true }).ok,
    false,
  );
  assert.equal(
    S.cameraSupport({ BarcodeDetector: det, mediaDevices: md, secure: false })
      .ok,
    false,
  );
});

test("unknown code becomes a new-product starting point", () => {
  assert.deepEqual(S.newProductFromCode(" 9310000000012 "), {
    sku: "9310000000012",
  });
  assert.equal(S.newProductFromCode("a b"), null);
  assert.equal(S.newProductFromCode(""), null);
});
