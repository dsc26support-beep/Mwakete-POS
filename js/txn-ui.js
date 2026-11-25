/* Sales history screen: search, filters, export, per-sale details (status, payments, checks, timeline).
 * Logic lives in txn.js (TxnCore). Sales are never edited here. */
const TxnUI = (() => {
  const X = TxnCore,
    $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toFixed(2);
  const esc = (s) =>
    String(s).replace(
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
  const MAX_SHOWN = 100;
  let sales = [],
    refunds = [],
    customers = [];

  const dayStart = (v) => (v ? new Date(v + "T00:00:00").getTime() : undefined);
  const dayEnd = (v) =>
    v ? new Date(v + "T23:59:59.999").getTime() : undefined;
  const opts = () => {
    const m = $("txnMethod").value;
    return {
      q: $("txnText").value,
      from: dayStart($("txnFrom").value),
      to: dayEnd($("txnTo").value),
      method: m === "account" ? "" : m,
      status: m === "account" ? "On account" : $("txnStatus").value,
    };
  };

  function draw() {
    const list = X.filter(sales, refunds, opts()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    const s = X.summary(list, refunds);
    $("txnSummary").textContent = list.length
      ? `${s.count} sale(s), total ${fmt(s.total)}`
      : "No sales match.";
    const refunded = (sale) => {
      let m = 0;
      for (const r of refunds)
        if (r.saleId === sale.id) m += Math.round(r.total * 100);
      return m > 0 ? " · refunded " + fmt(m / 100) : "";
    };
    $("salesList").innerHTML = list.length
      ? list
          .slice(0, MAX_SHOWN)
          .map(
            (s) =>
              `<div class="sale-wrap"><div class="sale-row" data-sale-id="${esc(s.id)}" tabindex="0" role="button"><div><strong>${esc(X.label(s))}</strong><small>${new Date(s.createdAt).toLocaleString()} · ${esc(X.paymentText(s))} · ${esc(s.syncStatus)}${refunded(s)}</small></div><strong>${fmt(s.total)}</strong></div><button class="text-button" type="button" data-txn="${esc(s.id)}" aria-label="Details for ${esc(X.label(s))}">Details</button></div>`,
          )
          .join("") +
        (list.length > MAX_SHOWN
          ? `<p class="hint">Showing the newest ${MAX_SHOWN} of ${list.length} matching sales. Narrow the dates or use <strong>Export sales</strong> to get them all.</p>`
          : "")
      : '<p class="empty">No sales recorded yet.</p>';
  }

  async function render() {
    [sales, refunds, customers] = await Promise.all([
      POSDB.all("sales"),
      typeof RefundCore !== "undefined" ? POSDB.all("refunds") : [],
      POSDB.all("customers"),
    ]);
    draw();
  }

  function openDetails(id) {
    const s = sales.find((x) => x.id === id);
    if (!s) return;
    const issues = X.checkIntegrity(s);
    const cust = s.customerId && customers.find((c) => c.id === s.customerId);
    $("txnTitle").textContent = "Sale " + X.label(s);
    $("txnBody").innerHTML =
      `<p><strong>${esc(X.status(s, refunds))}</strong> · ${new Date(s.createdAt).toLocaleString()}</p>` +
      `<p>Total <strong>${fmt(s.total)}</strong> ${esc(s.currency || "")} · ${esc(X.paymentText(s))}${s.paymentVerified ? "" : s.paymentMethod === "cash" ? "" : " <small>(recorded, NOT verified)</small>"}</p>` +
      (cust ? `<p>Customer: ${esc(cust.name)}</p>` : "") +
      `<ul>${(s.items || []).map((i) => `<li>${esc(i.quantity)} × ${esc(i.name)} @ ${fmt(i.unitPrice)}</li>`).join("")}</ul>` +
      (s.discount && s.discount.amount > 0
        ? `<p>Discount: ${fmt(s.discount.amount)}</p>`
        : "") +
      (s.change > 0
        ? `<p>Cash received ${fmt(s.tendered)}, change ${fmt(s.change)}</p>`
        : "") +
      `<p class="${issues.length ? "low" : "hint"}">${issues.length ? "Check failed: " + esc(issues.join(" ")) : "Record checks passed: the lines, discount and payments add up."}</p>` +
      `<h4>History</h4><ul>${X.timeline(s, refunds)
        .map(
          (e) => `<li>${new Date(e.at).toLocaleString()} — ${esc(e.text)}</li>`,
        )
        .join("")}</ul>` +
      `<p class="hint">A recorded sale is never edited. To correct a mistake, refund it (a credit note) and ring up the right sale.</p>`;
    $("txnPanel").classList.remove("hidden");
    $("txnClose").focus();
  }

  function download() {
    const csv = X.exportCsv(
      X.filter(sales, refunds, opts()),
      refunds,
      customers,
    );
    const url = URL.createObjectURL(
      new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "sales-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function init() {
    for (const id of ["txnText", "txnFrom", "txnTo", "txnMethod", "txnStatus"])
      $(id).addEventListener("input", draw);
    $("salesList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-txn]");
      if (b) openDetails(b.dataset.txn);
    });
    $("txnClose").addEventListener("click", () =>
      $("txnPanel").classList.add("hidden"),
    );
    $("txnExport").addEventListener("click", download);
  }
  return { init, render };
})();
if (typeof window !== "undefined") window.TxnUI = TxnUI;
