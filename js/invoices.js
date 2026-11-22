/* Wholesale invoices and credit accounts (PR 2). Pure functions + HTML/text builders, unit-testable in Node.
 * Money is computed in integer minor units (cents) with BigInt for the tax / discount ratios, so results are exact.
 * The SAME arithmetic lives in google-apps-script/Code.gs (computeInvoiceTotals_); tests assert they agree.
 *
 * An invoice is stored ON the sale (sale.invoice), so a sale and its invoice are saved in one atomic write.
 * sale.total is the GROSS amount owed (net of discount, plus tax). Reports subtract sale.tax.
 * Everything here is local to the device until the owner's ledger confirms it; the ledger itself is NOT production-ready
 * until authenticated Google sign-in exists.
 */
const InvoiceCore = (() => {
  const LIMITS = {
    amount: 1e9,
    note: 200,
    terms: 40,
    deviceCodeLen: 4,
    name: 80,
  };
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
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
  const toMinor = (n) => Math.round(Number(n) * 100);
  const fromMinor = (m) => m / 100;
  const money = (n) => Number(n || 0).toFixed(2);

  // round-half-up of a*b/c for non-negative integers, exact (BigInt).
  function mulDivRound(a, b, c) {
    if (c === 0) return 0;
    const A = BigInt(a),
      B = BigInt(b),
      C = BigInt(c);
    return Number((2n * A * B + C) / (2n * C));
  }

  /* ---------- totals ---------- */
  // lines: [{price, qty, taxExempt}] (major units). discount: major units (>= 0, <= subtotal). rate: percent 0..100, <= 2 decimals.
  // The discount reduces the taxable base pro-rata; tax is computed once on the discounted taxable base.
  function computeInvoiceTotals(lines, discount = 0, rate = 12.5) {
    const r = Number(rate);
    if (
      !Number.isFinite(r) ||
      r < 0 ||
      r > 100 ||
      Math.abs(r * 100 - Math.round(r * 100)) > 1e-6
    )
      return {
        ok: false,
        error: "Tax rate must be 0 to 100 with at most 2 decimals.",
      };
    let sub = 0,
      taxable = 0;
    for (const l of lines) {
      const m = toMinor(l.price) * l.qty;
      sub += m;
      if (!l.taxExempt) taxable += m;
    }
    const disc = toMinor(discount || 0);
    if (!Number.isFinite(disc) || disc < 0 || disc > sub)
      return {
        ok: false,
        error: "The discount cannot be more than the sale total.",
      };
    const taxableNet = taxable - mulDivRound(disc, taxable, sub);
    const tax = mulDivRound(taxableNet, Math.round(r * 100), 10000);
    return {
      ok: true,
      rate: Math.round(r * 100) / 100,
      subtotal: fromMinor(sub),
      discount: fromMinor(disc),
      taxableNet: fromMinor(taxableNet),
      tax: fromMinor(tax),
      total: fromMinor(sub - disc + tax),
    };
  }

  /* ---------- invoice numbers (INV-<device code>-<seq>) ---------- */
  function randomCode(len = LIMITS.deviceCodeLen, rand = Math.random) {
    let out = "";
    for (let i = 0; i < len; i++)
      out += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
    return out;
  }
  const formatNumber = (code, seq) =>
    "INV-" + code + "-" + String(seq).padStart(4, "0");
  const isValidNumber = (n) => /^INV-[A-Z0-9]{3,8}-\d{1,9}$/.test(String(n));
  let chain = Promise.resolve(); // serialise number allocation within this page
  // store needs get/put on "settings". Returns the next unused number and persists the counter.
  function nextInvoiceNumber(store, rand = Math.random) {
    const run = async () => {
      let code = (await store.get("settings", "deviceCode"))?.value;
      if (!/^[A-Z0-9]{3,8}$/.test(String(code))) {
        code = randomCode(LIMITS.deviceCodeLen, rand);
        await store.put("settings", { key: "deviceCode", value: code });
      }
      const seq =
        Number((await store.get("settings", "invoiceSeq"))?.value) || 0;
      const next = seq + 1;
      await store.put("settings", { key: "invoiceSeq", value: next });
      return formatNumber(code, next);
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  /* ---------- building an invoice onto a sale ---------- */
  // cart lines: {price, qty, taxExempt}. discount: {amount} | null. customer: record or null.
  // opts: {rate, number, mode:"paid"|"account", terms, sellerTaxNumber}
  function buildInvoice(cart, discount, customer, opts) {
    const mode = opts.mode === "account" ? "account" : "paid";
    if (mode === "account" && !(customer && customer.id))
      return {
        ok: false,
        error: "Choose a trade customer to sell on account.",
      };
    const t = computeInvoiceTotals(
      cart.map((l) => ({
        price: l.price,
        qty: l.qty,
        taxExempt: !!l.taxExempt,
      })),
      discount ? discount.amount : 0,
      opts.rate,
    );
    if (!t.ok) return t;
    const invoice = {
      number: opts.number,
      mode,
      taxRate: t.rate,
      taxableNet: t.taxableNet,
      tax: t.tax,
      total: t.total,
      customerName: customer
        ? String(customer.name || "").slice(0, LIMITS.name)
        : "Walk-in",
    };
    if (customer?.taxNumber)
      invoice.customerTaxNumber = String(customer.taxNumber);
    if (opts.terms) invoice.terms = String(opts.terms).slice(0, LIMITS.terms);
    if (opts.sellerTaxNumber)
      invoice.sellerTaxNumber = String(opts.sellerTaxNumber);
    return { ok: true, invoice, totals: t };
  }
  // Applies the invoice to a sale (mutates). sale.total becomes the gross amount owed.
  function applyToSale(sale, built) {
    sale.invoice = built.invoice;
    sale.tax = built.totals.tax;
    sale.subtotal = built.totals.subtotal;
    sale.total = built.totals.total;
    if (built.invoice.mode === "account") {
      sale.paymentMethod = "account";
      sale.paymentVerified = false;
    }
    return sale;
  }

  /* ---------- balances and credit limit ---------- */
  const isOpen = (r) =>
    r.syncStatus !== "synced" && r.syncStatus !== "rejected";
  // Amount (major units) this device has recorded but the ledger has not confirmed yet: pending account invoices minus pending payments.
  function pendingBalance(sales, payments, customerId) {
    let m = 0;
    for (const s of sales || [])
      if (
        s.invoice &&
        s.invoice.mode === "account" &&
        s.customerId === customerId &&
        isOpen(s)
      )
        m += toMinor(s.invoice.total);
    for (const p of payments || [])
      if (p.customerId === customerId && isOpen(p)) m -= toMinor(p.amount);
    return fromMinor(m);
  }
  // creditLimit undefined/null = no limit set (no check). 0 = no credit allowed.
  function overLimit({
    confirmed = 0,
    pending = 0,
    invoiceTotal = 0,
    creditLimit,
  }) {
    const projected = fromMinor(
      toMinor(confirmed) + toMinor(pending) + toMinor(invoiceTotal),
    );
    if (creditLimit === undefined || creditLimit === null || creditLimit === "")
      return { over: false, projected, limit: null, by: 0 };
    const limit = Number(creditLimit);
    const byMinor = toMinor(projected) - toMinor(limit);
    return {
      over: byMinor > 0,
      projected,
      limit,
      by: byMinor > 0 ? fromMinor(byMinor) : 0,
    };
  }

  /* ---------- payments (money received against the account balance) ---------- */
  function validatePayment(input) {
    if (!input?.customerId)
      return { ok: false, error: "Choose the customer who paid." };
    const n = Number(input.amount);
    if (!Number.isFinite(n) || n <= 0 || n > LIMITS.amount)
      return { ok: false, error: "Enter the amount received (more than 0)." };
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6)
      return { ok: false, error: "The amount can have at most 2 decimals." };
    const note = String(input.note ?? "").trim();
    if (note.length > LIMITS.note)
      return {
        ok: false,
        error: "Note is too long (max " + LIMITS.note + " characters).",
      };
    return {
      ok: true,
      value: {
        customerId: String(input.customerId),
        amount: Math.round(n * 100) / 100,
        method: "cash",
        note,
      },
    };
  }

  /* ---------- applying the server's per-record answer ---------- */
  // Returns ONLY the records that changed. A record is "synced" only when its id is in the server's accepted list.
  function applySyncResult(sales, payments, result) {
    const acc = new Set((result && result.acceptedIds) || []);
    const accP = new Set((result && result.acceptedPaymentIds) || []);
    const rej = new Map(
      ((result && result.rejected) || []).map((r) => [
        String(r.id),
        String(r.reason || "Rejected by the ledger").slice(0, 200),
      ]),
    );
    const upd = (r, accepted) => {
      if (accepted.has(r.id)) {
        const { syncError, ...rest } = r;
        return { ...rest, syncStatus: "synced" };
      }
      if (rej.has(r.id))
        return { ...r, syncStatus: "rejected", syncError: rej.get(r.id) };
      return null;
    };
    return {
      sales: (sales || []).map((s) => upd(s, acc)).filter(Boolean),
      payments: (payments || []).map((p) => upd(p, accP)).filter(Boolean),
    };
  }

  /* ---------- document text (32 columns) ---------- */
  const WIDTH = 32;
  const row = (left, right) => {
    const l = String(left),
      r = String(right),
      room = WIDTH - r.length - 1;
    return (
      (l.length > room ? l.slice(0, Math.max(0, room)) : l.padEnd(room)) +
      " " +
      r
    );
  };
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtDate = (ms) => {
    const d = new Date(ms);
    return (
      d.getFullYear() +
      "-" +
      pad2(d.getMonth() + 1) +
      "-" +
      pad2(d.getDate()) +
      " " +
      pad2(d.getHours()) +
      ":" +
      pad2(d.getMinutes())
    );
  };
  const STATUS = {
    synced: "Confirmed by your ledger",
    rejected: "REJECTED by your ledger",
    pending: "Pending: not yet confirmed by your ledger",
  };
  function buildInvoiceText(sale, business = {}) {
    const inv = sale.invoice;
    const cur = sale.currency || "";
    const L = [String(business.name || "Mwakete POS")];
    if (inv.sellerTaxNumber || business.taxNumber)
      L.push("Tax no: " + (inv.sellerTaxNumber || business.taxNumber));
    L.push(
      "TAX INVOICE " + inv.number,
      "Date: " + fmtDate(sale.createdAt),
      "Customer: " + inv.customerName,
    );
    if (inv.customerTaxNumber)
      L.push("Customer tax no: " + inv.customerTaxNumber);
    L.push("-".repeat(WIDTH));
    for (const it of sale.items || [])
      L.push(
        row(
          it.quantity + " x " + it.name + (it.taxExempt ? " (exempt)" : ""),
          money(it.unitPrice * it.quantity),
        ),
      );
    L.push("-".repeat(WIDTH), row("Subtotal", money(sale.subtotal)));
    if (sale.discount && sale.discount.amount > 0)
      L.push(row("Discount", "-" + money(sale.discount.amount)));
    L.push(
      row("Tax " + inv.taxRate + "%", money(inv.tax)),
      row("TOTAL " + cur, money(inv.total)),
    );
    L.push(
      inv.mode === "account"
        ? "ON ACCOUNT" + (inv.terms ? " - " + inv.terms : "")
        : "Paid: " +
            (sale.paymentMethod === "cash"
              ? "Cash"
              : String(sale.paymentMethod) + " (recorded, NOT verified)"),
    );
    L.push("Status: " + (STATUS[sale.syncStatus] || STATUS.pending));
    if (sale.syncStatus === "rejected" && sale.syncError)
      L.push("Reason: " + sale.syncError);
    return L.join("\n");
  }

  /* ---------- HTML builders (all text escaped) ---------- */
  // confirmedAt: ms timestamp of the last server-confirmed balance, or null/undefined if never confirmed (then 0 is only a placeholder).
  function accountRow(c, confirmed, pending, limit, confirmedAt) {
    const total = fromMinor(toMinor(confirmed) + toMinor(pending));
    const asOf = confirmedAt
      ? "as of " + fmtDate(confirmedAt)
      : "never confirmed";
    const o = overLimit({
      confirmed,
      pending,
      invoiceTotal: 0,
      creditLimit: limit,
    });
    return `<div class="resource-row"><div><strong>${esc(c.name)}</strong><small>Confirmed ${money(confirmed)} (${esc(asOf)}) · pending on this device ${money(pending)} · limit ${limit === undefined || limit === null ? "not set" : money(limit)}</small></div><div class="row-actions"><strong class="${o.over ? "low" : ""}">${money(total)}${o.over ? " · OVER LIMIT" : ""}</strong></div></div>`;
  }
  function invoiceRow(s) {
    const inv = s.invoice;
    const bad = s.syncStatus === "rejected";
    return `<div class="resource-row sale-row" data-sale-id="${esc(s.id)}"><div><strong>${esc(inv.number)}</strong><small>${esc(fmtDate(s.createdAt))} · ${esc(inv.customerName)} · ${inv.mode === "account" ? "on account" : "paid"} · ${esc(s.syncStatus || "pending")}${bad && s.syncError ? " — " + esc(s.syncError) : ""}</small></div><strong>${money(inv.total)}</strong></div>`;
  }
  function paymentRow(p) {
    const bad = p.syncStatus === "rejected";
    return `<div class="resource-row"><div><strong>${esc(p.customerName || "Customer")}</strong><small>${esc(fmtDate(p.createdAt))} · cash · ${esc(p.syncStatus || "pending")}${bad && p.syncError ? " — " + esc(p.syncError) : ""}${p.note ? " · " + esc(p.note) : ""}</small></div><strong>-${money(p.amount)}</strong></div>`;
  }

  return {
    LIMITS,
    esc,
    money,
    toMinor,
    fromMinor,
    mulDivRound,
    computeInvoiceTotals,
    randomCode,
    formatNumber,
    isValidNumber,
    nextInvoiceNumber,
    buildInvoice,
    applyToSale,
    pendingBalance,
    overLimit,
    validatePayment,
    applySyncResult,
    buildInvoiceText,
    accountRow,
    invoiceRow,
    paymentRow,
  };
})();
if (typeof module !== "undefined") module.exports = InvoiceCore;
