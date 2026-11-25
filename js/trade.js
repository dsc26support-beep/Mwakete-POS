/* Wholesale paperwork: quotes, delivery notes and customer statements. Pure functions, unit-testable in Node.
 *
 * Quote -> invoice is never done behind the person's back. "Convert" loads the quote into the till at the quoted prices;
 * the invoice is made by the normal checkout (same tax rules, credit limit check and invoice number). Only after that sale is
 * saved is the quote marked "converted", with the sale's id, so one quote can never become two invoices.
 *
 * A statement lists a customer's invoices on account, payments and credit notes with a running balance.
 * Payments and credit notes are matched to invoices OLDEST FIRST ("payment allocation"): this is worked out from the records, never
 * stored, so it can never disagree with them.
 * Money is in integer cents.
 */
const TradeCore = (() => {
  // Looked up when used, not when this file loads: in the browser invoices.js may load after this file.
  const IC = () =>
    typeof InvoiceCore !== "undefined" ? InvoiceCore : require("./invoices.js");
  const LIMITS = {
    name: 100,
    note: 200,
    items: 200,
    qty: 1e9,
    price: 1e9,
    validDays: 366,
  };
  const DAY = 86400000;
  const toMinor = (n) => Math.round(Number(n) * 100);
  const fromMinor = (m) => m / 100;
  const money = (n) => Number(n || 0).toFixed(2);

  /* ---------- quotes ---------- */
  // input: {customer: record|null, customerName, lines:[{productId, qty, unitPrice}], validUntil: ms|"", note, taxRate}
  // opts: {id, number, now, currency}
  function buildQuote(input, products, opts = {}) {
    const customer = input?.customer || null;
    const customerName = String(
      customer ? customer.name : (input?.customerName ?? ""),
    ).trim();
    if (!customerName)
      return { ok: false, error: "Choose a customer or type a name." };
    if (customerName.length > LIMITS.name)
      return {
        ok: false,
        error:
          "The customer name is too long (max " + LIMITS.name + " characters).",
      };
    const note = String(input?.note ?? "").trim();
    if (note.length > LIMITS.note)
      return {
        ok: false,
        error: "Note is too long (max " + LIMITS.note + " characters).",
      };
    const lines = input?.lines;
    if (!Array.isArray(lines) || !lines.length)
      return { ok: false, error: "Add at least one product." };
    if (lines.length > LIMITS.items)
      return { ok: false, error: "Too many lines (max " + LIMITS.items + ")." };
    const byId = new Map((products || []).map((p) => [p.id, p]));
    const seen = new Set();
    const items = [];
    for (const l of lines) {
      const p = byId.get(l.productId);
      if (!p)
        return {
          ok: false,
          error: "One of the products no longer exists on this device.",
        };
      if (seen.has(p.id))
        return {
          ok: false,
          error: p.name + " is on the quote twice. Combine the lines.",
        };
      seen.add(p.id);
      const q = Number(l.qty);
      if (l.qty === "" || !Number.isInteger(q) || q < 1 || q > LIMITS.qty)
        return {
          ok: false,
          error: "Enter a whole quantity of 1 or more for " + p.name + ".",
        };
      const price = Number(l.unitPrice);
      if (
        l.unitPrice === "" ||
        !Number.isFinite(price) ||
        price < 0 ||
        price > LIMITS.price
      )
        return {
          ok: false,
          error: "Enter the price of " + p.name + " (0 or more).",
        };
      if (Math.abs(price * 100 - Math.round(price * 100)) > 1e-6)
        return {
          ok: false,
          error: "The price of " + p.name + " can have at most 2 decimals.",
        };
      items.push({
        productId: p.id,
        name: String(p.name).slice(0, LIMITS.name),
        unitPrice: Math.round(price * 100) / 100,
        quantity: q,
        ...(p.taxExempt ? { taxExempt: true } : {}),
      });
    }
    const now = opts.now || Date.now();
    let validUntil;
    if (input.validUntil !== "" && input.validUntil != null) {
      validUntil = Number(input.validUntil);
      if (
        !Number.isFinite(validUntil) ||
        validUntil <= now ||
        validUntil > now + LIMITS.validDays * DAY
      )
        return {
          ok: false,
          error: "The 'valid until' date must be in the future, within a year.",
        };
    }
    const t = IC().computeInvoiceTotals(
      items.map((i) => ({
        price: i.unitPrice,
        qty: i.quantity,
        taxExempt: !!i.taxExempt,
      })),
      0,
      input.taxRate === undefined ? 12.5 : input.taxRate,
    );
    if (!t.ok) return t;
    const q = {
      id: opts.id,
      number: opts.number,
      customerName,
      status: "open",
      items,
      subtotal: t.subtotal,
      tax: t.tax,
      total: t.total,
      createdAt: now,
      updatedAt: now,
      syncStatus: "pending",
    };
    if (customer && customer.id)
      q.customerId = String(customer.id).slice(0, 64);
    if (opts.currency) q.currency = String(opts.currency).slice(0, 8);
    if (validUntil) q.validUntil = validUntil;
    if (note) q.note = note;
    return { ok: true, value: q };
  }
  // What the person sees: an open quote past its date is "expired".
  const quoteStatus = (q, now = Date.now()) =>
    q.status === "open" && q.validUntil && q.validUntil < now
      ? "expired"
      : q.status;
  // Can this quote be loaded into the till now?
  function checkConvert(q, products, now = Date.now()) {
    if (!q) return { ok: false, error: "That quote was not found." };
    const st = quoteStatus(q, now);
    if (st === "converted")
      return {
        ok: false,
        error: "This quote has already been made into an invoice.",
      };
    if (st === "declined")
      return { ok: false, error: "This quote was declined." };
    if (st === "expired")
      return { ok: false, error: "This quote has expired. Make a new one." };
    const ids = new Set((products || []).map((p) => p.id));
    const gone = q.items.find((i) => !ids.has(i.productId));
    if (gone)
      return {
        ok: false,
        error: gone.name + " is no longer on this device's product list.",
      };
    return { ok: true };
  }
  // Till lines at the QUOTED prices (the person agreed those), keeping each product's own tax-exempt flag.
  function cartLines(q, products) {
    const byId = new Map(products.map((p) => [p.id, p]));
    return q.items.map((i) => ({
      ...byId.get(i.productId),
      id: i.productId,
      productId: i.productId,
      name: i.name,
      price: i.unitPrice,
      qty: i.quantity,
      listId: "",
    }));
  }
  // Does this saved sale really contain the quoted goods for the quoted customer? (Guards the link between them.)
  function matchesSale(q, sale) {
    if (!sale || !Array.isArray(sale.items)) return false;
    if (q.customerId && sale.customerId !== q.customerId) return false;
    if (sale.items.length !== q.items.length) return false;
    const want = new Map(q.items.map((i) => [i.productId, i.quantity]));
    return sale.items.every(
      (s) => !s.packId && want.get(s.productId) === s.quantity,
    );
  }
  function markConverted(q, saleId, now = Date.now()) {
    return {
      ...q,
      status: "converted",
      convertedSaleId: saleId,
      updatedAt: Math.max(now, q.updatedAt || 0),
      syncStatus: "pending",
    };
  }
  function decline(q, now = Date.now()) {
    if (q.status !== "open")
      return { ok: false, error: "Only an open quote can be declined." };
    return {
      ok: true,
      value: {
        ...q,
        status: "declined",
        updatedAt: Math.max(now, q.updatedAt || 0),
        syncStatus: "pending",
      },
    };
  }

  /* ---------- 32-column text ---------- */
  const WIDTH = 32;
  const row = (l, r) => {
    const a = String(l),
      b = String(r);
    return a.length + b.length + 1 > WIDTH
      ? a.slice(0, Math.max(1, WIDTH - b.length - 1)) + " " + b
      : a + " ".repeat(WIDTH - a.length - b.length) + b;
  };
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  function buildQuoteText(q, business = {}, now = Date.now()) {
    const cur = q.currency || "";
    const L = [
      String(business.name || "Mwakete POS"),
      "QUOTE " + q.number,
      "Date: " + day(q.createdAt),
      "For: " + q.customerName,
    ];
    if (q.validUntil) L.push("Valid until: " + day(q.validUntil));
    L.push("Status: " + quoteStatus(q, now), "-".repeat(WIDTH));
    for (const i of q.items) {
      L.push(
        i.name,
        row(
          "  " + i.quantity + " x " + money(i.unitPrice),
          money(i.quantity * i.unitPrice),
        ),
      );
    }
    L.push(
      "-".repeat(WIDTH),
      row("Subtotal", money(q.subtotal)),
      row("Tax", money(q.tax)),
      row("TOTAL " + cur, money(q.total)),
    );
    if (q.note) L.push("Note: " + q.note);
    L.push("Prices are an offer, not an invoice.");
    return L.join("\n");
  }
  // A delivery note shows what was handed over, never prices.
  function buildDeliveryNoteText(sale, business = {}) {
    const inv = sale.invoice || {};
    const L = [
      String(business.name || "Mwakete POS"),
      "DELIVERY NOTE",
      "Invoice: " + (inv.number || String(sale.id).slice(0, 18)),
      "Date: " + day(sale.createdAt),
      "To: " + (inv.customerName || "Walk-in"),
      "-".repeat(WIDTH),
    ];
    for (const i of sale.items || []) L.push(row(i.name, "x " + i.quantity));
    L.push(
      "-".repeat(WIDTH),
      "Received in good order by:",
      "",
      "Name: ____________________",
      "Signature: ________________",
      "Date: ____________________",
    );
    return L.join("\n");
  }

  /* ---------- statements and payment allocation ---------- */
  // Everything on the customer's account from this device's records. Rejected records are left out (the cloud refused them).
  function statementEntries(customerId, sales, payments, refunds) {
    const ok = (r) => r.syncStatus !== "rejected";
    const e = [];
    for (const s of sales || [])
      if (
        s.customerId === customerId &&
        s.invoice &&
        s.invoice.mode === "account" &&
        ok(s)
      )
        e.push({
          kind: "invoice",
          at: s.createdAt,
          ref: s.invoice.number,
          change: toMinor(s.invoice.total),
          status: s.syncStatus,
          id: s.id,
        });
    for (const p of payments || [])
      if (p.customerId === customerId && ok(p))
        e.push({
          kind: "payment",
          at: p.createdAt,
          ref: "Payment",
          change: -toMinor(p.amount),
          status: p.syncStatus,
          id: p.id,
        });
    for (const r of refunds || [])
      if (r.customerId === customerId && r.method === "account" && ok(r))
        e.push({
          kind: "credit",
          at: r.createdAt,
          ref: r.number,
          change: -toMinor(r.total),
          status: r.syncStatus,
          id: r.id,
        });
    const order = { invoice: 0, payment: 1, credit: 2 };
    e.sort(
      (a, b) =>
        a.at - b.at ||
        order[a.kind] - order[b.kind] ||
        String(a.id).localeCompare(String(b.id)),
    );
    let run = 0;
    for (const x of e) {
      run += x.change;
      x.balance = run;
    }
    return e;
  }
  // Oldest invoice first: each is paid from the pool of payments and credit notes. -> [{..., paid, outstanding}], unallocated
  function allocate(entries) {
    let pool = entries
      .filter((e) => e.change < 0)
      .reduce((n, e) => n - e.change, 0);
    const invoices = [];
    for (const e of entries)
      if (e.kind === "invoice") {
        const paid = Math.min(pool, e.change);
        pool -= paid;
        invoices.push({
          number: e.ref,
          at: e.at,
          total: e.change,
          paid,
          outstanding: e.change - paid,
        });
      }
    return { invoices, unallocated: pool };
  }
  function buildStatement(customer, sales, payments, refunds) {
    const entries = statementEntries(customer.id, sales, payments, refunds);
    const alloc = allocate(entries);
    return {
      customer,
      entries,
      invoices: alloc.invoices,
      unallocated: alloc.unallocated,
      balance: entries.length ? entries[entries.length - 1].balance : 0,
      pending: entries.filter((e) => e.status !== "synced").length,
    };
  }
  function buildStatementText(
    st,
    business = {},
    now = Date.now(),
    currency = "",
  ) {
    const L = [
      String(business.name || "Mwakete POS"),
      "STATEMENT OF ACCOUNT",
      "Customer: " + st.customer.name,
      "Date: " + day(now),
      "-".repeat(WIDTH),
    ];
    if (!st.entries.length) L.push("No activity on this account.");
    for (const e of st.entries) {
      L.push(
        day(e.at) +
          " " +
          (e.kind === "invoice"
            ? "Invoice"
            : e.kind === "payment"
              ? "Payment"
              : "Credit note"),
      );
      if (e.kind !== "payment") L.push("  " + e.ref);
      L.push(
        row(
          "  " + (e.change < 0 ? "-" : "") + money(Math.abs(e.change) / 100),
          "Bal " + money(e.balance / 100),
        ),
      );
    }
    L.push(
      "-".repeat(WIDTH),
      row("BALANCE DUE " + currency, money(st.balance / 100)),
    );
    const open = st.invoices.filter((i) => i.outstanding > 0);
    if (open.length) {
      L.push("", "Unpaid invoices (oldest first):");
      for (const i of open)
        L.push(row("  " + i.number, money(i.outstanding / 100)));
    }
    if (st.unallocated > 0)
      L.push("", row("Credit in hand", money(st.unallocated / 100)));
    if (st.pending) L.push("", st.pending + " record(s) not yet confirmed.");
    L.push("From this device's records.");
    return L.join("\n");
  }

  return {
    LIMITS,
    buildQuote,
    quoteStatus,
    checkConvert,
    cartLines,
    matchesSale,
    markConverted,
    decline,
    buildQuoteText,
    buildDeliveryNoteText,
    statementEntries,
    allocate,
    buildStatement,
    buildStatementText,
    toMinor,
    fromMinor,
  };
})();
if (typeof module !== "undefined") module.exports = TradeCore;
