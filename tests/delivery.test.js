const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../js/delivery.js");

const sale = {
  id: "abcdefghij",
  receiptNo: "R-AAAA-0001",
  currency: "AUD",
  total: 12.5,
  items: [{ name: "Tea", quantity: 2 }],
};

test("phone numbers: local numbers get the country code, bad ones are refused", () => {
  assert.equal(D.normalizePhone("7212 3456").value, "68672123456");
  assert.equal(D.normalizePhone("+61 400 123 456").value, "61400123456");
  assert.equal(D.normalizePhone("0061 400 123 456").value, "61400123456");
  assert.equal(D.normalizePhone("+686 7212 3456").value, "68672123456");
  assert.equal(D.normalizePhone("").ok, false);
  assert.equal(D.normalizePhone("abc").ok, false);
  assert.equal(D.normalizePhone("123").ok, false);
  assert.equal(D.normalizePhone("+" + "9".repeat(20)).ok, false);
});

test("email checks", () => {
  assert.equal(D.checkEmail("a@b.co").ok, true);
  for (const bad of ["", "a@b", "a b@c.com", "a@b.com,c@d.com", "<x>@y.com"])
    assert.equal(D.checkEmail(bad).ok, false, bad);
});

test("links open the right app with the text encoded", () => {
  const t = "Total 5 & thanks\nline2";
  const e = D.buildLink({
    channel: "email",
    to: "x@y.com",
    subject: "Hi there",
    text: t,
  });
  assert.ok(e.url.startsWith("mailto:x%40y.com?subject=Hi%20there&body="));
  assert.ok(e.url.includes(encodeURIComponent(t)));
  const w = D.buildLink({ channel: "whatsapp", to: "7212 3456", text: t });
  assert.ok(w.url.startsWith("https://wa.me/68672123456?text="));
  const s = D.buildLink({ channel: "sms", to: "+68672123456", text: t });
  assert.ok(s.url.startsWith("sms:+68672123456?&body="));
  assert.equal(D.buildLink({ channel: "fax", to: "1", text: t }).ok, false);
  assert.equal(
    D.buildLink({ channel: "email", to: "nope", text: t }).ok,
    false,
  );
});

test("a line break in the subject (for example from a business name) never reaches the link or the queue", () => {
  const m = D.make({
    saleId: "s",
    channel: "email",
    to: "x@y.com",
    subject: "Shop\r\nBcc: z@z.com",
    text: "t",
  });
  assert.equal(m.item.subject, "Shop Bcc: z@z.com");
  const l = D.buildLink({
    channel: "email",
    to: "x@y.com",
    subject: "A\r\nBcc: z",
    text: "b",
  });
  assert.ok(
    !/%0[Dd]|%0[Aa]/.test(l.url.split("&body=")[0]),
    "no encoded line break in the subject part",
  );
});

test("no header injection: line breaks stay inside the encoded body", () => {
  const l = D.buildLink({
    channel: "email",
    to: "x@y.com",
    subject: "a\r\nBcc: z@z.com",
    text: "b",
  });
  assert.ok(!/[\r\n]/.test(l.url));
  assert.ok(!l.url.includes("Bcc: "));
});

test("short text lists items, total and receipt number", () => {
  const t = D.shortText(sale, "Mwakete Shop");
  assert.match(
    t,
    /Mwakete Shop – Receipt R-AAAA-0001: 2x Tea\. Total 12\.50 AUD/,
  );
  const big = {
    ...sale,
    items: Array.from({ length: 9 }, (_, i) => ({
      name: "Item" + i,
      quantity: 1,
    })),
  };
  assert.match(D.shortText(big), /\+3 more/);
  assert.ok(
    D.shortText({ ...sale, items: [{ name: "x".repeat(900), quantity: 1 }] })
      .length <= 480,
  );
});

test("lifecycle: Queued -> Sending -> Delivered; Failed -> Retry pending -> Sending", () => {
  const m = D.make(
    { saleId: "s", channel: "sms", to: "72123456", text: "hello" },
    { now: 1, id: "d1" },
  );
  assert.equal(m.ok, true);
  assert.equal(m.item.status, "Queued");
  assert.equal(D.move(m.item, "Delivered").ok, false);
  let it = D.move(m.item, "Sending", { now: 2 }).item;
  assert.equal(it.attempts, 1);
  it = D.move(it, "Failed", { now: 3, note: "no signal" }).item;
  assert.equal(it.note, "no signal");
  assert.equal(D.move(it, "Sending").ok, false);
  it = D.move(it, "Retry pending", { now: 4 }).item;
  it = D.move(it, "Sending", { now: 5 }).item;
  assert.equal(it.attempts, 2);
  it = D.move(it, "Delivered", { now: 6 }).item;
  assert.deepEqual(
    it.history.map((h) => h.status),
    ["Queued", "Sending", "Failed", "Retry pending", "Sending", "Delivered"],
  );
  assert.equal(D.move(it, "Cancelled").ok, false);
  assert.equal(D.move(m.item, "Cancelled").ok, true);
});

test("make refuses bad recipients and empty text", () => {
  assert.equal(D.make({ channel: "email", to: "x", text: "a" }).ok, false);
  assert.equal(
    D.make({ channel: "sms", to: "72123456", text: "  " }).ok,
    false,
  );
  assert.equal(D.make({ channel: "pigeon", to: "1", text: "a" }).ok, false);
});

test("queue: add, replace, pending count, full queue keeps waiting messages", () => {
  const mk = (i, status) => ({
    ...D.make({ channel: "sms", to: "72123456", text: "a" }, { id: "d" + i })
      .item,
    status,
  });
  let q = [];
  for (let i = 0; i < D.MAX_QUEUE; i++) q = D.add(q, mk(i, "Queued")).queue;
  assert.equal(D.add(q, mk("x", "Queued")).ok, false);
  q[3] = { ...q[3], status: "Delivered" };
  const r = D.add(q, mk("y", "Queued"));
  assert.equal(r.ok, true);
  assert.equal(r.queue.length, D.MAX_QUEUE);
  assert.equal(
    r.queue.some((x) => x.id === "d3"),
    false,
  );
  assert.equal(
    D.pending([mk(1, "Queued"), mk(2, "Delivered"), mk(3, "Failed")]),
    2,
  );
  assert.equal(
    D.replace([mk(1, "Queued")], { ...mk(1, "Failed") })[0].status,
    "Failed",
  );
});
