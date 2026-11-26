/* TxnCore — pure transaction-history logic: receipt numbers, status, search/filter, CSV export, integrity checks,
 * audit timeline. No DOM. Unit tested in Node. Sales are never edited; corrections are refunds + a new sale. */
(function (root) {
  const toMinor = (n) => Math.round(Number(n) * 100);
  const fromMinor = (m) => m / 100;
  const CODE = /^[A-Z0-9]{3,8}$/;
  const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomCode = (rand = Math.random) =>
    Array.from(
      { length: 4 },
      () => CHARS[Math.floor(rand() * CHARS.length)],
    ).join("");

  /* R-<device code>-<seq>, allocated one at a time on this device. store needs get/put on "settings". */
  let chain = Promise.resolve();
  function nextReceiptNumber(store, rand = Math.random) {
    const run = async () => {
      let code = (await store.get("settings", "deviceCode"))?.value;
      if (!CODE.test(String(code))) {
        code = randomCode(rand);
        await store.put("settings", { key: "deviceCode", value: code });
      }
      const seq =
        (Number((await store.get("settings", "receiptSeq"))?.value) || 0) + 1;
      await store.put("settings", { key: "receiptSeq", value: seq });
      return "R-" + code + "-" + String(seq).padStart(4, "0");
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }
  const label = (s) =>
    s.receiptNo || s.invoice?.number || String(s.id).slice(0, 18);

  /* Completed | Partly refunded | Fully refunded | On account | Not accepted by the cloud */
  function status(sale, refunds) {
    if (sale.syncStatus === "rejected") return "Not accepted by the cloud";
    let back = 0;
    for (const r of refunds || [])
      if (r.saleId === sale.id) back += toMinor(r.total);
    const total = toMinor(sale.total);
    if (total > 0 && back >= total) return "Fully refunded";
    if (back > 0) return "Partly refunded";
    if (sale.paymentMethod === "account") return "On account";
    return "Completed";
  }

  function paymentText(s) {
    if (Array.isArray(s.payments) && s.payments.length)
      return s.payments
        .map((p) => p.method + " " + Number(p.amount).toFixed(2))
        .join(" + ");
    return s.paymentMethod || "";
  }

  /* opts: {q, from, to (ms), method, status, staffUid, customerId, min, max} */
  function filter(sales, refunds, opts = {}) {
    const q = String(opts.q || "")
      .toLowerCase()
      .trim();
    return (sales || []).filter((s) => {
      if (opts.from && s.createdAt < opts.from) return false;
      if (opts.to && s.createdAt > opts.to) return false;
      if (opts.method) {
        const ms =
          Array.isArray(s.payments) && s.payments.length
            ? s.payments.map((p) => p.method)
            : [s.paymentMethod];
        if (!ms.includes(opts.method)) return false;
      }
      if (opts.staffUid && s.staffUid !== opts.staffUid) return false;
      if (opts.customerId && s.customerId !== opts.customerId) return false;
      if (
        opts.min !== undefined &&
        opts.min !== "" &&
        s.total < Number(opts.min)
      )
        return false;
      if (
        opts.max !== undefined &&
        opts.max !== "" &&
        s.total > Number(opts.max)
      )
        return false;
      if (opts.status && status(s, refunds) !== opts.status) return false;
      if (q) {
        const hay = [
          s.id,
          s.receiptNo,
          s.invoice?.number,
          s.invoice?.customerName,
          paymentText(s),
          ...(s.payments || []).map((p) => p.reference),
          ...(s.items || []).map((i) => i.name + " " + (i.sku || "")),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  const safe = (v) => {
    const s = String(v == null ? "" : v);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  };
  const quote = (v) => {
    const s = safe(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const iso = (ms) => new Date(ms).toISOString();

  function exportCsv(sales, refunds, customers = []) {
    const names = new Map(customers.map((c) => [c.id, c.name]));
    const head = [
      "receipt",
      "date",
      "status",
      "payment",
      "reference",
      "items",
      "subtotal",
      "discount",
      "tax",
      "total",
      "customer",
      "staff",
      "sync",
    ];
    const rows = [head.join(",")];
    for (const s of [...(sales || [])].sort(
      (a, b) => a.createdAt - b.createdAt,
    ))
      rows.push(
        [
          label(s),
          iso(s.createdAt),
          status(s, refunds),
          paymentText(s),
          (s.payments || [])
            .map((p) => p.reference)
            .filter(Boolean)
            .join(" / "),
          (s.items || []).reduce((n, i) => n + (Number(i.quantity) || 0), 0),
          Number(s.subtotal ?? s.total).toFixed(2),
          Number(s.discount?.amount || 0).toFixed(2),
          Number(s.tax ?? s.invoice?.tax ?? 0).toFixed(2),
          Number(s.total).toFixed(2),
          s.invoice?.customerName || names.get(s.customerId) || "",
          s.staffUid || "",
          s.syncStatus || "pending",
        ]
          .map(quote)
          .join(","),
      );
    return rows.join("\r\n") + "\r\n";
  }

  /* Re-adds the sale from its own lines. Returns a list of problems (empty = consistent). */
  function checkIntegrity(sale) {
    const issues = [];
    let lines = 0;
    for (const i of sale.items || []) {
      const q = Number(i.quantity);
      const p = Number(i.unitPrice);
      if (!Number.isInteger(q) || q < 1)
        issues.push("A line has an invalid quantity.");
      if (!Number.isFinite(p) || p < 0)
        issues.push("A line has an invalid price.");
      lines += toMinor(p) * q;
    }
    const total = toMinor(sale.total);
    const disc = toMinor(sale.discount?.amount || 0);
    const tax = toMinor(sale.invoice?.tax ?? sale.tax ?? 0);
    const expectSub =
      sale.subtotal !== undefined ? toMinor(sale.subtotal) : lines;
    if (
      !sale.invoice &&
      Math.abs(lines - disc - total) > 1 &&
      Math.abs(expectSub - disc - total) > 1
    )
      issues.push("The total does not match the lines and discount.");
    if (sale.invoice && Math.abs(total - toMinor(sale.invoice.total)) > 0)
      issues.push("The invoice total does not match the sale total.");
    if (Array.isArray(sale.payments) && sale.payments.length) {
      const paid = sale.payments.reduce((n, p) => n + toMinor(p.amount), 0);
      // cash rounding may move the cash part by a few cents; the sale records how much
      if (paid !== total + toMinor(sale.rounding || 0))
        issues.push("The payments do not add up to the total.");
    }
    if (total < 0) issues.push("The total is negative.");
    if (!(sale.createdAt > 0)) issues.push("The time is missing.");
    void tax;
    return issues;
  }

  /* Time-ordered events for one sale (derived from the records; nothing is stored separately). */
  function timeline(sale, refunds) {
    const ev = [
      {
        at: sale.createdAt,
        text:
          "Sale recorded" +
          (sale.staffUid
            ? " by staff " + String(sale.staffUid).slice(0, 8)
            : " on this device") +
          " (" +
          paymentText(sale) +
          ")",
      },
    ];
    for (const r of refunds || [])
      if (r.saleId === sale.id)
        ev.push({
          at: r.createdAt,
          text:
            "Credit note " +
            (r.number || "") +
            " for " +
            Number(r.total).toFixed(2) +
            (r.reason ? " — " + r.reason : ""),
        });
    if (sale.syncStatus === "rejected")
      ev.push({
        at: sale.createdAt,
        text:
          "Refused by the cloud" +
          (sale.syncError ? ": " + sale.syncError : ""),
      });
    return ev.sort((a, b) => a.at - b.at);
  }

  /* A customer's purchases: count, total spent, refunds, most recent sales (newest first). */
  function customerHistory(sales, refunds, customerId, limit = 10) {
    const mine = (sales || []).filter(
      (s) => s.customerId === customerId && s.syncStatus !== "rejected",
    );
    const ids = new Set(mine.map((s) => s.id));
    let back = 0;
    for (const r of refunds || [])
      if (ids.has(r.saleId)) back += toMinor(r.total);
    let total = 0;
    for (const s of mine) total += toMinor(s.total);
    const last = mine
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    return {
      count: mine.length,
      total: fromMinor(total),
      refunded: fromMinor(back),
      net: fromMinor(total - back),
      firstAt: mine.length ? Math.min(...mine.map((s) => s.createdAt)) : null,
      lastAt: last.length ? last[0].createdAt : null,
      last,
    };
  }

  function summary(sales, refunds) {
    let n = 0,
      gross = 0;
    for (const s of sales || []) {
      n++;
      gross += toMinor(s.total);
    }
    return { count: n, total: fromMinor(gross) };
  }

  const api = {
    nextReceiptNumber,
    status,
    filter,
    exportCsv,
    checkIntegrity,
    timeline,
    summary,
    customerHistory,
    label,
    paymentText,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TxnCore = api;
})(typeof window !== "undefined" ? window : globalThis);
