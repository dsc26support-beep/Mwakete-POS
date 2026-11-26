/* Whole-business report from the cloud account (owner only). Pure functions, unit-testable in Node.
 * Combines the sales and credit notes of every till and cashier. Money is in integer cents, so totals are exact.
 *   net = sales - credit notes (refunds of any kind), by the date each record was made.
 * Tax is reported where the sale carries it (Wholesale tax invoices). Counts and amounts are for the chosen period only.
 */
const CloudReport = (() => {
  const toMinor = (n) => Math.round(Number(n || 0) * 100);
  const fromMinor = (m) => m / 100;
  const DAY = 86400000;

  // The calendar day of a timestamp in the person's own time zone (offsetMin = minutes east of UTC).
  const dayOf = (ms, offsetMin = 0) =>
    new Date(ms + offsetMin * 60000).toISOString().slice(0, 10);
  // Start of the day `back` days before `now` (back = 0: today), in the person's time zone.
  function periodStart(now, days, offsetMin = 0) {
    const local = now + offsetMin * 60000;
    const midnight = local - (((local % DAY) + DAY) % DAY);
    return midnight - (Math.max(1, days) - 1) * DAY - offsetMin * 60000;
  }

  // staff: [{uid, name}] (owner added separately). opts: {ownerUid, from, to, offsetMin}
  function summarize(sales, refunds, staff, opts = {}) {
    const from = opts.from ?? 0,
      to = opts.to ?? Infinity,
      off = opts.offsetMin || 0;
    const inRange = (r) =>
      typeof r.createdAt === "number" &&
      r.createdAt >= from &&
      r.createdAt <= to;
    const names = new Map((staff || []).map((s) => [s.uid, s.name]));
    if (opts.ownerUid) names.set(opts.ownerUid, "Owner");
    const label = (uid) => names.get(uid) || "Former or unknown staff";

    const t = { sales: 0, gross: 0, tax: 0, refunds: 0, refundTotal: 0 };
    const staffRows = new Map();
    const dayRows = new Map();
    const methodRows = new Map();
    const productRows = new Map();
    const bump = (map, key, init) => {
      if (!map.has(key)) map.set(key, init());
      return map.get(key);
    };
    const staffRow = (uid) =>
      bump(staffRows, uid, () => ({
        uid,
        name: label(uid),
        sales: 0,
        gross: 0,
        refunds: 0,
        refundTotal: 0,
      }));
    const dayRow = (d) =>
      bump(dayRows, d, () => ({ day: d, sales: 0, gross: 0, refundTotal: 0 }));

    for (const s of sales || []) {
      if (!inRange(s)) continue;
      const g = toMinor(s.total);
      t.sales++;
      t.gross += g;
      t.tax += toMinor(s.tax ?? s.invoice?.tax ?? 0);
      const sr = staffRow(s.staffUid);
      sr.sales++;
      sr.gross += g;
      const dr = dayRow(dayOf(s.createdAt, off));
      dr.sales++;
      dr.gross += g;
      // Split sales are spread across the methods that paid them.
      const parts =
        Array.isArray(s.payments) && s.payments.length
          ? s.payments.map((p) => [p.method || "other", toMinor(p.amount)])
          : [[s.paymentMethod || "other", g]];
      for (const [method, minor] of parts) {
        const m = bump(methodRows, method, () => ({
          method,
          sales: 0,
          gross: 0,
        }));
        m.sales++;
        m.gross += minor;
      }
      for (const it of s.items || []) {
        const key = it.productId || it.name;
        const p = bump(productRows, key, () => ({
          name: it.name,
          quantity: 0,
          revenue: 0,
        }));
        p.quantity += Number(it.quantity) || 0;
        p.revenue += toMinor(it.unitPrice) * (Number(it.quantity) || 0);
      }
    }
    for (const r of refunds || []) {
      if (!inRange(r)) continue;
      const g = toMinor(r.total);
      t.refunds++;
      t.refundTotal += g;
      const sr = staffRow(r.staffUid);
      sr.refunds++;
      sr.refundTotal += g;
      dayRow(dayOf(r.createdAt, off)).refundTotal += g;
    }
    const money = (o, keys) =>
      Object.fromEntries(
        Object.entries(o).map(([k, v]) => [
          k,
          keys.includes(k) ? fromMinor(v) : v,
        ]),
      );
    return {
      totals: {
        ...money(t, ["gross", "tax", "refundTotal"]),
        net: fromMinor(t.gross - t.refundTotal),
        average: t.sales ? fromMinor(Math.round(t.gross / t.sales)) : 0,
      },
      byStaff: [...staffRows.values()]
        .map((r) => ({
          ...money(r, ["gross", "refundTotal"]),
          net: fromMinor(r.gross - r.refundTotal),
        }))
        .sort((a, b) => b.gross - a.gross || a.name.localeCompare(b.name)),
      byDay: [...dayRows.values()]
        .map((r) => ({
          ...money(r, ["gross", "refundTotal"]),
          net: fromMinor(r.gross - r.refundTotal),
        }))
        .sort((a, b) => (a.day < b.day ? 1 : -1)),
      byMethod: [...methodRows.values()]
        .map((r) => money(r, ["gross"]))
        .sort((a, b) => b.gross - a.gross),
      topProducts: [...productRows.values()]
        .map((r) => money(r, ["revenue"]))
        .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name))
        .slice(0, 10),
    };
  }
  return { summarize, periodStart, dayOf };
})();
if (typeof module !== "undefined") module.exports = CloudReport;
