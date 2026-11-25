/* CheckoutCore — pure payment + held-sale logic (no DOM, no storage). Unit tested in Node.
 * Rules: money is handled in minor units; a recorded digital payment is NEVER "verified";
 * cash change is only ever given on the cash part; split payments must add up to the total exactly. */
(function (root) {
  const METHODS = {
    cash: "Cash",
    eftpos: "EFTPOS / card",
    internet_banking: "Internet banking",
    mpaisa: "M-PAiSA",
    other: "Other (record only)",
  };
  const MAX_LINES = 4;
  const MAX_REF = 40;
  const MAX_HELD = 20;
  const toMinor = (n) => Math.round(Number(n) * 100);
  const fromMinor = (m) => m / 100;
  const cleanRef = (s) =>
    String(s == null ? "" : s)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, MAX_REF);
  const fail = (error) => ({ ok: false, error });

  /* Change due for a single cash payment. */
  function changeDue(total, tendered) {
    const t = toMinor(total);
    const g = toMinor(tendered);
    if (!Number.isFinite(t) || t < 0) return fail("Total is not valid.");
    if (!Number.isFinite(g) || g < 0)
      return fail("Enter the cash received as a number.");
    if (g < t)
      return {
        ok: false,
        error: "Cash received is less than the total.",
        short: fromMinor(t - g),
      };
    return { ok: true, change: fromMinor(g - t), tendered: fromMinor(g) };
  }

  /* lines: [{method, amount?, reference?, tendered?}] (amount optional on one "remainder" line).
   * Returns {ok, paymentMethod, payments, paymentVerified, tendered?, change?} or {ok:false,error}. */
  function build(total, lines) {
    const T = toMinor(total);
    if (!Number.isFinite(T) || T < 0) return fail("Total is not valid.");
    if (!Array.isArray(lines) || !lines.length)
      return fail("Choose a payment method.");
    if (lines.length > MAX_LINES)
      return fail("At most " + MAX_LINES + " payment lines per sale.");
    const seen = new Set();
    for (const l of lines) {
      if (!l || !METHODS[l.method]) return fail("Unknown payment method.");
      if (seen.has(l.method))
        return fail(
          "Use each payment method once; combine the amounts instead.",
        );
      seen.add(l.method);
    }
    const cashLine = lines.find((l) => l.method === "cash");
    const others = lines.filter((l) => l.method !== "cash");
    let paid = 0;
    let remainderLine = null;
    const payments = [];
    for (const l of others) {
      const has =
        l.amount !== undefined && l.amount !== null && l.amount !== "";
      if (!has) {
        if (remainderLine || cashLine)
          return fail("Enter the amount for " + METHODS[l.method] + ".");
        remainderLine = l;
        continue;
      }
      const a = toMinor(l.amount);
      if (!Number.isFinite(a) || a <= 0)
        return fail("Amount for " + METHODS[l.method] + " must be above zero.");
      paid += a;
      payments.push({ method: l.method, amount: fromMinor(a), l });
    }
    if (paid > T)
      return fail(
        "Payments are more than the total. Digital payments cannot give change.",
      );
    let due = T - paid;
    let tendered;
    let change;
    if (remainderLine) {
      if (due <= 0 && T > 0)
        return fail("Nothing left to pay on " + METHODS[remainderLine.method]);
      payments.push({
        method: remainderLine.method,
        amount: fromMinor(due),
        l: remainderLine,
      });
      due = 0;
    }
    if (cashLine) {
      if (due > 0 || (T === 0 && !payments.length)) {
        const g =
          cashLine.tendered === undefined ||
          cashLine.tendered === null ||
          cashLine.tendered === ""
            ? due
            : toMinor(cashLine.tendered);
        if (!Number.isFinite(g) || g < due) {
          return {
            ok: false,
            error: "Cash received is less than the amount due in cash.",
            short: Number.isFinite(g) ? fromMinor(due - g) : fromMinor(due),
          };
        }
        payments.push({ method: "cash", amount: fromMinor(due), l: cashLine });
        tendered = fromMinor(g);
        change = fromMinor(g - due);
        due = 0;
      } else {
        return fail("Cash is not needed: the other payments cover the total.");
      }
    }
    if (due > 0) return fail("Payments do not cover the total.");
    const out = payments.map((p) => {
      const ref = cleanRef(p.l.reference);
      return ref
        ? { method: p.method, amount: p.amount, reference: ref }
        : { method: p.method, amount: p.amount };
    });
    const allCash = out.every((p) => p.method === "cash");
    const res = {
      ok: true,
      paymentMethod: out.length === 1 ? out[0].method : "split",
      payments: out,
      paymentVerified: allCash,
    };
    if (tendered !== undefined) {
      res.tendered = tendered;
      res.change = change;
    }
    return res;
  }

  /* Cash that stays in the drawer from a sale (net of change given). Works for old sales without `payments`. */
  function cashPortion(sale) {
    if (Array.isArray(sale?.payments)) {
      let m = 0;
      for (const p of sale.payments)
        if (p && p.method === "cash") m += toMinor(p.amount);
      return fromMinor(m);
    }
    return sale && sale.paymentMethod === "cash" ? Number(sale.total) : 0;
  }

  /* Sales-by-method rows (payment-method reporting): split sales are spread across their methods. */
  function methodTotals(sales) {
    const rows = new Map();
    const bump = (method, minor) => {
      const r = rows.get(method) || { method, sales: 0, gross: 0 };
      r.sales++;
      r.gross += minor;
      rows.set(method, r);
    };
    for (const s of sales || []) {
      if (!s || s.syncStatus === "rejected") continue;
      if (Array.isArray(s.payments) && s.payments.length)
        for (const p of s.payments) bump(p.method, toMinor(p.amount));
      else bump(s.paymentMethod || "other", toMinor(s.total));
    }
    return [...rows.values()]
      .map((r) => ({ ...r, gross: fromMinor(r.gross) }))
      .sort((a, b) => b.gross - a.gross);
  }

  /* One-line description for receipts and lists. */
  function describe(sale) {
    if (Array.isArray(sale?.payments) && sale.payments.length) {
      return sale.payments
        .map(
          (p) =>
            (METHODS[p.method] || p.method) +
            (p.reference ? " ref " + p.reference : ""),
        )
        .join(" + ");
    }
    return METHODS[sale?.paymentMethod] || String(sale?.paymentMethod || "");
  }

  /* ---------- held (suspended) sales ---------- */
  function makeHold(cart, opts = {}) {
    if (!Array.isArray(cart) || !cart.length)
      return fail("The cart is empty, nothing to hold.");
    const items = [];
    for (const x of cart) {
      if (
        !x ||
        !Number.isInteger(x.qty) ||
        x.qty < 1 ||
        !Number.isFinite(x.price) ||
        x.price < 0
      )
        return fail("A cart line is not valid.");
      items.push({
        id: x.id,
        productId: x.productId || x.id,
        name: String(x.name || "").slice(0, 100),
        sku: x.sku || "",
        price: x.price,
        qty: x.qty,
        listId: x.listId || "",
        ...(x.packId ? { packId: x.packId, packUnits: x.packUnits } : {}),
        ...(x.taxExempt ? { taxExempt: true } : {}),
      });
    }
    const total = fromMinor(
      items.reduce((n, x) => n + toMinor(x.price) * x.qty, 0),
    );
    return {
      ok: true,
      hold: {
        id: opts.id || "h" + (opts.now || Date.now()).toString(36),
        createdAt: opts.now || Date.now(),
        label: cleanRef(opts.label) || "",
        customerId: opts.customerId || "",
        items,
        total,
      },
    };
  }
  function addHold(list, hold) {
    const next = (Array.isArray(list) ? list : []).filter(
      (h) => h && h.id !== hold.id,
    );
    if (next.length >= MAX_HELD)
      return fail(
        "At most " + MAX_HELD + " sales can be on hold. Resume or discard one.",
      );
    next.push(hold);
    return { ok: true, list: next };
  }
  function removeHold(list, id) {
    return (Array.isArray(list) ? list : []).filter((h) => h && h.id !== id);
  }
  /* Re-validate a held cart against current products: price/stock may have changed while it was on hold. */
  function resumeLines(hold, products) {
    const byId = new Map((products || []).map((p) => [p.id, p]));
    const lines = [];
    const dropped = [];
    for (const l of hold?.items || []) {
      const p = byId.get(l.productId);
      if (!p) {
        dropped.push(l.name);
        continue;
      }
      lines.push({ ...l });
    }
    return { lines, dropped };
  }

  const api = {
    METHODS,
    MAX_HELD,
    changeDue,
    build,
    cashPortion,
    methodTotals,
    describe,
    makeHold,
    addHold,
    removeHold,
    resumeLines,
    cleanRef,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CheckoutCore = api;
})(typeof window !== "undefined" ? window : globalThis);
