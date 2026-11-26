/* "Report by period" screen. Logic lives in analytics.js (AnalyticsCore). Figures are for this device only. */
const AnalyticsUI = (() => {
  const A = AnalyticsCore,
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
  const METHOD = {
    cash: "Cash",
    eftpos: "EFTPOS / card",
    internet_banking: "Internet banking",
    mpaisa: "M-PAiSA",
    other: "Other",
    account: "On account",
  };
  let data = { sales: [], refunds: [], products: [] };
  let last = null;

  function opts() {
    const p = $("repPeriod").value;
    const custom = {
      from: $("repFrom").value
        ? new Date($("repFrom").value + "T00:00:00").getTime()
        : NaN,
      to: $("repTo").value
        ? new Date($("repTo").value + "T00:00:00").getTime()
        : NaN,
    };
    const r = A.range(p, Date.now(), custom);
    if (r.error) return { error: r.error };
    return {
      range: r,
      filters: {
        from: r.from,
        to: r.to,
        category: $("repCategory").value,
        method: $("repMethod").value,
        staffUid:
          $("repStaff").value === "this device" ? "" : $("repStaff").value,
        tier: $("repEdition").value,
      },
    };
  }
  const table = (title, head, rows) =>
    rows.length
      ? `<h3>${esc(title)}</h3><div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      : "";

  function draw() {
    const o = opts();
    $("periodReportBody").innerHTML = "";
    $("repError").textContent = o.error || "";
    $("repFrom").classList.toggle("hidden", $("repPeriod").value !== "custom");
    $("repTo").classList.toggle("hidden", $("repPeriod").value !== "custom");
    if (o.error) {
      last = null;
      return;
    }
    const f = { ...o.filters };
    if (f.method === "account") f.method = "account";
    const r = A.build(data.sales, data.refunds, data.products, f);
    last = { r, label: o.range.label };
    const t = r.totals;
    const p = r.profit;
    $("periodReportBody").innerHTML =
      `<h3>${esc(o.range.label)}: ${new Date(o.range.from).toLocaleDateString()} to ${new Date(o.range.to).toLocaleDateString()}</h3>` +
      `<div class="stat-row"><div><small>Sales</small><strong>${t.count}</strong></div><div><small>Gross</small><strong>${fmt(t.gross)}</strong></div><div><small>Refunds</small><strong>${fmt(t.refunds)}</strong></div><div><small>Net</small><strong>${fmt(t.net)}</strong></div><div><small>Average sale</small><strong>${fmt(t.average)}</strong></div><div><small>Items sold</small><strong>${t.units}</strong></div></div>` +
      `<p class="hint">Discounts given ${fmt(t.discount)} · Tax ${fmt(t.tax)}</p>` +
      `<div class="retail-box"><strong>Profit estimate: ${p.costedRevenue > 0 ? fmt(p.estimate) + (p.marginPct !== null ? " (" + p.marginPct + "% margin)" : "") : "needs cost prices"}</strong><p class="hint">Counts only products that have a cost price (revenue ${fmt(p.costedRevenue)}, cost ${fmt(p.cost)}), after sharing discounts out. It uses today's cost price, not the price paid at the time.${p.uncostedProducts.length ? " Not counted (no cost price): " + esc(p.uncostedProducts.slice(0, 8).join(", ")) + (p.uncostedProducts.length > 8 ? "…" : "") + " (" + fmt(p.uncostedRevenue) + ")." : ""}</p></div>` +
      table(
        "By day",
        ["Day", "Sales", "Gross"],
        r.byDay.map((d) => [d.day, d.sales, fmt(d.gross)]),
      ) +
      table(
        "By product",
        ["Product", "Qty", "Revenue"],
        r.byProduct
          .slice(0, 50)
          .map((x) => [x.name, x.quantity, fmt(x.revenue)]),
      ) +
      table(
        "By category",
        ["Category", "Qty", "Revenue"],
        r.byCategory.map((x) => [x.category, x.quantity, fmt(x.revenue)]),
      ) +
      table(
        "By payment method",
        ["Method", "Sales", "Amount"],
        r.byMethod.map((x) => [
          METHOD[x.method] || x.method,
          x.sales,
          fmt(x.gross),
        ]),
      ) +
      table(
        "By staff",
        ["Staff", "Sales", "Gross"],
        r.byStaff.map((x) => [
          String(x.staff).slice(0, 12),
          x.sales,
          fmt(x.gross),
        ]),
      ) +
      table(
        "By edition",
        ["Edition", "Sales", "Gross"],
        r.byEdition.map((x) => [x.edition, x.sales, fmt(x.gross)]),
      ) +
      `<p class="hint">Product and category rows show line revenue before discount and tax. Refunds are counted on the day the credit note was made. This report covers sales on this device.</p>`;
  }

  async function render() {
    const [sales, refunds, products] = await Promise.all([
      POSDB.all("sales"),
      typeof RefundCore !== "undefined" ? POSDB.all("refunds") : [],
      POSDB.all("products"),
    ]);
    data = { sales, refunds, products };
    const keepC = $("repCategory").value,
      keepS = $("repStaff").value;
    $("repCategory").innerHTML =
      '<option value="">All categories</option><option value="__none__">No category</option>' +
      CatalogueCore.categories(products)
        .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
        .join("");
    const staff = [...new Set(sales.map((s) => s.staffUid).filter(Boolean))];
    $("repStaff").innerHTML =
      '<option value="">All staff</option>' +
      staff
        .map(
          (u) =>
            `<option value="${esc(u)}">${esc(String(u).slice(0, 12))}</option>`,
        )
        .join("");
    if ([...$("repCategory").options].some((o) => o.value === keepC))
      $("repCategory").value = keepC;
    if ([...$("repStaff").options].some((o) => o.value === keepS))
      $("repStaff").value = keepS;
    draw();
  }

  function csv() {
    if (!last) return toast("Choose a valid period first.");
    const url = URL.createObjectURL(
      new Blob(["﻿" + A.toCsv(last.r, last.label)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "report-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function init() {
    for (const id of [
      "repPeriod",
      "repFrom",
      "repTo",
      "repCategory",
      "repMethod",
      "repStaff",
      "repEdition",
    ])
      $(id).addEventListener("input", draw);
    $("repCsv").addEventListener("click", csv);
    $("repPrint").addEventListener("click", () => window.print());
  }
  return { init, render };
})();
if (typeof window !== "undefined") window.AnalyticsUI = AnalyticsUI;
