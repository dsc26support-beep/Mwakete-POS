/* Cash register shifts (open / close the drawer). Pure functions, unit-testable in Node.
 *
 * A shift starts with an opening float counted into the drawer. While it is open the till keeps selling as usual.
 * Closing works out what SHOULD be in the drawer from this device's own records, compares it with what was counted,
 * and saves a closed-shift record (append-only; it is never edited). Only cash moves the drawer:
 *   expected = opening float + cash sales + cash payments received on account - cash refunds
 * Sales on account, and payments recorded as "other", do not touch the drawer.
 * Money is in integer minor units (cents) so the totals are exact.
 */
const RegisterCore = (() => {
  const LIMITS = { amount: 1e9, note: 200 };
  const toMinor = (n) => Math.round(Number(n) * 100);
  const fromMinor = (m) => m / 100;
  const money = (n) => Number(n || 0).toFixed(2);
  const validAmount = (v) => {
    const n = Number(v);
    if (v === "" || v === null || v === undefined || !Number.isFinite(n))
      return { ok: false, error: "Enter an amount (use 0 if there is none)." };
    if (n < 0 || n > LIMITS.amount)
      return { ok: false, error: "The amount must be 0 or more." };
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6)
      return { ok: false, error: "The amount can have at most 2 decimals." };
    return { ok: true, value: Math.round(n * 100) / 100 };
  };

  /* ---------- opening ---------- */
  // -> {ok, value: open shift}. id/now are passed in so this stays pure.
  function buildOpen(floatInput, opts = {}) {
    const a = validAmount(floatInput);
    if (!a.ok) return { ok: false, error: "Opening float: " + a.error };
    return {
      ok: true,
      value: {
        id: opts.id,
        openedAt: opts.now || Date.now(),
        openingFloat: a.value,
      },
    };
  }

  /* ---------- what should be in the drawer ---------- */
  // Records from this device between the shift opening and `until`. Rejected records never count (they were refused).
  const within = (r, from, until) =>
    r.createdAt >= from && r.createdAt <= until && r.syncStatus !== "rejected";
  function summarize(open, sales, payments, refunds, until = Date.now()) {
    let cashSales = 0,
      cashPayments = 0,
      cashRefunds = 0,
      count = 0;
    for (const s of sales || [])
      if (within(s, open.openedAt, until) && s.paymentMethod === "cash") {
        cashSales += toMinor(s.total);
        count++;
      }
    for (const p of payments || [])
      if (within(p, open.openedAt, until) && (p.method || "cash") === "cash")
        cashPayments += toMinor(p.amount);
    for (const r of refunds || [])
      if (within(r, open.openedAt, until) && r.method === "cash")
        cashRefunds += toMinor(r.total);
    const expected =
      toMinor(open.openingFloat) + cashSales + cashPayments - cashRefunds;
    return {
      cashSales: fromMinor(cashSales),
      cashPayments: fromMinor(cashPayments),
      cashRefunds: fromMinor(cashRefunds),
      salesCount: count,
      expectedCash: fromMinor(expected),
    };
  }

  /* ---------- closing ---------- */
  // counted: cash actually in the drawer. opts: {id, now, note, currency, sales, payments, refunds}
  function buildClose(open, countedInput, opts = {}) {
    if (!open || !open.id) return { ok: false, error: "No register is open." };
    const a = validAmount(countedInput);
    if (!a.ok) return { ok: false, error: "Cash counted: " + a.error };
    const note = String(opts.note ?? "").trim();
    if (note.length > LIMITS.note)
      return {
        ok: false,
        error: "Note is too long (max " + LIMITS.note + " characters).",
      };
    const now = opts.now || Date.now();
    const sum = summarize(open, opts.sales, opts.payments, opts.refunds, now);
    const diff = toMinor(a.value) - toMinor(sum.expectedCash);
    const rec = {
      id: open.id,
      openedAt: open.openedAt,
      closedAt: Math.max(now, open.openedAt),
      openingFloat: open.openingFloat,
      countedCash: a.value,
      expectedCash: sum.expectedCash,
      difference: fromMinor(diff),
      salesCount: sum.salesCount,
      cashSales: sum.cashSales,
      cashRefunds: sum.cashRefunds,
      cashPayments: sum.cashPayments,
      syncStatus: "pending",
    };
    if (note) rec.note = note;
    if (opts.currency) rec.currency = String(opts.currency).slice(0, 8);
    return { ok: true, value: rec };
  }
  const differenceText = (diff) => {
    const m = toMinor(diff);
    if (m === 0) return "Balanced: the drawer matches.";
    return m > 0
      ? "Over by " + money(fromMinor(m)) + " (more cash than expected)."
      : "Short by " + money(fromMinor(-m)) + " (less cash than expected).";
  };

  /* ---------- shift report text (32 columns) ---------- */
  const WIDTH = 32;
  const row = (l, r) => {
    const a = String(l),
      b = String(r);
    return a.length + b.length + 1 > WIDTH
      ? a.slice(0, Math.max(1, WIDTH - b.length - 1)) + " " + b
      : a + " ".repeat(WIDTH - a.length - b.length) + b;
  };
  const stamp = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
  function buildShiftText(rec, business = {}) {
    const L = [
      String(business.name || "Mwakete POS"),
      "REGISTER SHIFT REPORT",
      "Opened: " + stamp(rec.openedAt),
      "Closed: " + stamp(rec.closedAt),
      "-".repeat(WIDTH),
      row("Opening float", money(rec.openingFloat)),
      row("+ Cash sales (" + rec.salesCount + ")", money(rec.cashSales)),
      row("+ Payments on account", money(rec.cashPayments)),
      row("- Cash refunds", money(rec.cashRefunds)),
      "-".repeat(WIDTH),
      row("EXPECTED IN DRAWER", money(rec.expectedCash)),
      row("COUNTED", money(rec.countedCash)),
      row(
        "DIFFERENCE",
        (rec.difference > 0 ? "+" : "") + money(rec.difference),
      ),
      differenceText(rec.difference),
    ];
    if (rec.note) L.push("Note: " + rec.note);
    return L.join("\n");
  }

  return {
    LIMITS,
    validAmount,
    buildOpen,
    summarize,
    buildClose,
    differenceText,
    buildShiftText,
  };
})();
if (typeof module !== "undefined") module.exports = RegisterCore;
