/* Refunds and credit notes. Pure functions, unit-testable in Node.
 *
 * A refund is an APPEND-ONLY record (credit note) pointing at the original sale. The original sale is never changed.
 * Money is computed in integer minor units (cents) with BigInt for the ratios, so results are exact:
 *  - A partial refund returns the same share of the sale total (discount and tax included) as the share of the
 *    item value being returned, rounded half up.
 *  - Refunding everything that is left returns exactly what is left of the sale total (no rounding drift), so the
 *    refunds of one sale can never add up to more than the sale.
 * A refund "to account" reduces what a trade customer owes and is only allowed for an invoice sold on account.
 * Stock is returned to the shelf only if the cashier chooses; stock counts stay per device.
 */
const RefundCore = (() => {
  const LIMITS = { reason: 200, amount: 1e9 };
  const METHODS = ["cash", "account", "other"];
  const CODE_RE = /^[A-Z0-9]{3,8}$/;
  const toMinor = (n) => Math.round(Number(n) * 100);
  const fromMinor = (m) => m / 100;
  const money = (n) => Number(n || 0).toFixed(2);
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function mulDivRound(a, b, c) {
    if (c === 0) return 0;
    const A = BigInt(a),
      B = BigInt(b),
      C = BigInt(c);
    return Number((2n * A * B + C) / (2n * C));
  }
  // A rejected refund (the cloud refused it) does not count against the sale; every other one does.
  const counts = (r) => r.syncStatus !== "rejected";

  /* ---------- what is left to refund ---------- */
  // -> {qty: {lineIndex: refundedQty}, minor: totalRefundedMinor, taxMinor}
  function refundedSoFar(refunds, saleId) {
    const out = { qty: {}, minor: 0, taxMinor: 0 };
    for (const r of refunds || []) {
      if (r.saleId !== saleId || !counts(r)) continue;
      out.minor += toMinor(r.total);
      out.taxMinor += toMinor(r.tax || 0);
      for (const it of r.items || [])
        out.qty[it.lineIndex] = (out.qty[it.lineIndex] || 0) + it.quantity;
    }
    return out;
  }
  // Per line of the sale: how many can still be refunded.
  function remainingLines(sale, refunds) {
    const done = refundedSoFar(refunds, sale.id);
    return (sale.items || []).map((it, i) => ({
      index: i,
      name: it.name,
      unitPrice: it.unitPrice,
      sold: it.quantity,
      refunded: done.qty[i] || 0,
      remaining: Math.max(0, it.quantity - (done.qty[i] || 0)),
    }));
  }
  const refundable = (sale, refunds) =>
    remainingLines(sale, refunds).some((l) => l.remaining > 0) &&
    toMinor(sale.total) - refundedSoFar(refunds, sale.id).minor > 0;

  /* ---------- building a refund ---------- */
  // picks: [{index, qty}] (qty whole units of that sale line). opts: {id, number, now, method, reason, restock, refunds}
  function buildRefund(sale, picks, opts = {}) {
    if (!sale || !Array.isArray(sale.items) || !sale.items.length)
      return { ok: false, error: "That sale cannot be refunded." };
    const method = opts.method || "cash";
    if (!METHODS.includes(method))
      return { ok: false, error: "Choose how the money is returned." };
    const invoiceOnAccount = !!(
      sale.invoice && sale.invoice.mode === "account"
    );
    if (method === "account" && !invoiceOnAccount)
      return {
        ok: false,
        error:
          "Only an invoice sold on account can be credited to the customer's account.",
      };
    if (invoiceOnAccount && method !== "account")
      return {
        ok: false,
        error:
          "This invoice was sold on account. Credit it to the customer's account.",
      };
    if (method === "account" && !sale.customerId)
      return { ok: false, error: "The invoice has no customer to credit." };
    const reason = String(opts.reason ?? "").trim();
    if (reason.length > LIMITS.reason)
      return {
        ok: false,
        error: "Reason is too long (max " + LIMITS.reason + " characters).",
      };

    const rem = remainingLines(sale, opts.refunds);
    const lines = [];
    const seen = new Set();
    for (const p of picks || []) {
      const i = Number(p.index),
        q = Number(p.qty);
      if (!Number.isInteger(i) || i < 0 || i >= rem.length || seen.has(i))
        return { ok: false, error: "Pick a valid item to return." };
      seen.add(i);
      if (!Number.isInteger(q) || q < 1)
        return { ok: false, error: "Enter a whole number of 1 or more." };
      if (q > rem[i].remaining)
        return {
          ok: false,
          error:
            "Only " +
            rem[i].remaining +
            " of " +
            rem[i].name +
            " can still be refunded.",
        };
      lines.push({ i, q });
    }
    if (!lines.length)
      return { ok: false, error: "Choose at least one item to return." };

    const T = toMinor(sale.total);
    const S = sale.items.reduce(
      (n, it) => n + toMinor(it.unitPrice) * it.quantity,
      0,
    );
    if (!(S > 0) || !(T > 0))
      return { ok: false, error: "That sale has nothing to refund." };
    const done = refundedSoFar(opts.refunds, sale.id);
    const leftMinor = T - done.minor;
    if (leftMinor <= 0)
      return {
        ok: false,
        error: "That sale has already been refunded in full.",
      };
    const taxTotal = toMinor(
      sale.tax || (sale.invoice && sale.invoice.tax) || 0,
    );

    const takesAll =
      lines.length === rem.filter((l) => l.remaining > 0).length &&
      lines.every((l) => l.q === rem[l.i].remaining);
    let total, tax;
    if (takesAll) {
      total = leftMinor;
      tax = Math.max(0, taxTotal - done.taxMinor);
    } else {
      const itemMinor = lines.reduce(
        (n, l) => n + toMinor(sale.items[l.i].unitPrice) * l.q,
        0,
      );
      total = Math.min(mulDivRound(itemMinor, T, S), leftMinor);
      tax = Math.min(
        mulDivRound(total, taxTotal, T),
        Math.max(0, taxTotal - done.taxMinor),
      );
    }
    if (total <= 0)
      return { ok: false, error: "The amount to refund is too small." };

    const refund = {
      id: opts.id,
      number: opts.number,
      saleId: sale.id,
      createdAt: opts.now || Date.now(),
      currency: sale.currency,
      method,
      items: lines.map((l) => {
        const it = sale.items[l.i];
        return {
          lineIndex: l.i,
          productId: it.productId,
          name: String(it.name || "").slice(0, 100),
          unitPrice: it.unitPrice,
          quantity: l.q,
          ...(it.packId ? { packId: it.packId, packUnits: it.packUnits } : {}),
        };
      }),
      tax: fromMinor(tax),
      total: fromMinor(total),
      restock: !!opts.restock,
      syncStatus: "pending",
    };
    if (reason) refund.reason = reason;
    if (sale.customerId) refund.customerId = sale.customerId;
    if (sale.invoice && sale.invoice.number)
      refund.invoiceNumber = String(sale.invoice.number).slice(0, 64);
    return { ok: true, value: refund };
  }

  // Single units to put back on the shelf for a refund that asked for it.
  function restockUnits(refund) {
    if (!refund || !refund.restock) return [];
    return (refund.items || []).map((it) => ({
      productId: it.productId,
      units: it.quantity * (it.packUnits || 1),
    }));
  }

  /* ---------- credit note numbers (CN-<device code>-<seq>) ---------- */
  const formatNumber = (code, seq) =>
    "CN-" + code + "-" + String(seq).padStart(4, "0");
  const isValidNumber = (n) => /^CN-[A-Z0-9]{3,8}-\d{1,9}$/.test(String(n));
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function randomCode(len = 4, rand = Math.random) {
    let out = "";
    for (let i = 0; i < len; i++)
      out += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
    return out;
  }
  let chain = Promise.resolve(); // serialise number allocation within this page
  // store needs get/put on "settings". Shares the device code with invoice numbers.
  function nextCreditNumber(store, rand = Math.random) {
    const run = async () => {
      let code = (await store.get("settings", "deviceCode"))?.value;
      if (!CODE_RE.test(String(code))) {
        code = randomCode(4, rand);
        await store.put("settings", { key: "deviceCode", value: code });
      }
      const seq =
        Number((await store.get("settings", "creditSeq"))?.value) || 0;
      await store.put("settings", { key: "creditSeq", value: seq + 1 });
      return formatNumber(code, seq + 1);
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  /* ---------- document text (32 columns) ---------- */
  const WIDTH = 32;
  const row = (l, r) => {
    const a = String(l),
      b = String(r);
    return a.length + b.length + 1 > WIDTH
      ? a.slice(0, Math.max(1, WIDTH - b.length - 1)) + " " + b
      : a + " ".repeat(WIDTH - a.length - b.length) + b;
  };
  const METHOD_LABEL = {
    cash: "Cash returned",
    account: "Credited to account",
    other: "Returned (other)",
  };
  function buildCreditNoteText(refund, sale, business = {}) {
    const cur = refund.currency || (sale && sale.currency) || "";
    const L = [
      String(business.name || "Mwakete POS"),
      "CREDIT NOTE " + refund.number,
    ];
    L.push("Date: " + new Date(refund.createdAt).toISOString().slice(0, 10));
    if (refund.invoiceNumber) L.push("For invoice: " + refund.invoiceNumber);
    else L.push("For sale: " + String(refund.saleId).slice(0, 18));
    L.push("-".repeat(WIDTH));
    for (const it of refund.items || []) {
      L.push(String(it.name));
      L.push(
        row(
          "  " + it.quantity + " x " + money(it.unitPrice),
          money(it.quantity * it.unitPrice),
        ),
      );
    }
    L.push("-".repeat(WIDTH));
    if (refund.tax) L.push(row("Tax included", money(refund.tax)));
    L.push(row("TOTAL REFUNDED " + cur, money(refund.total)));
    L.push(METHOD_LABEL[refund.method] || refund.method);
    if (refund.reason) L.push("Reason: " + refund.reason);
    if (refund.restock) L.push("Items returned to stock");
    return L.join("\n");
  }

  return {
    LIMITS,
    METHODS,
    refundedSoFar,
    remainingLines,
    refundable,
    buildRefund,
    restockUnits,
    formatNumber,
    isValidNumber,
    nextCreditNumber,
    buildCreditNoteText,
    esc,
    toMinor,
    fromMinor,
  };
})();
if (typeof module !== "undefined") module.exports = RefundCore;
