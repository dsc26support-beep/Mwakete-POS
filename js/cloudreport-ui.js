/* Owner's whole-business report from the cloud account. Maths lives in cloudreport.js (CloudReport). */
const CloudReportUI = (() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toFixed(2);
  const table = (head, rows) =>
    `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

  function draw(r, meta) {
    const t = r.totals;
    const cap = meta.capped
      ? '<p class="notice warn">Only the newest 5,000 records of each kind were read, so older ones in this period are missing.</p>'
      : "";
    $("cloudReportBody").innerHTML =
      cap +
      `<p><strong>${t.sales}</strong> sale(s) · sales <strong>${fmt(t.gross)}</strong> · credit notes −<strong>${fmt(t.refundTotal)}</strong> (${t.refunds}) · <strong>net ${fmt(t.net)}</strong> · tax in sales ${fmt(t.tax)} · average sale ${fmt(t.average)}</p>` +
      "<h3>By person</h3>" +
      (r.byStaff.length
        ? table(
            ["Who", "Sales", "Amount", "Credit notes", "Net"],
            r.byStaff.map((s) => [
              s.name,
              s.sales,
              fmt(s.gross),
              "−" + fmt(s.refundTotal) + " (" + s.refunds + ")",
              fmt(s.net),
            ]),
          )
        : '<p class="empty">No sales in this period.</p>') +
      "<h3>By day</h3>" +
      (r.byDay.length
        ? table(
            ["Day", "Sales", "Amount", "Credit notes", "Net"],
            r.byDay.map((d) => [
              d.day,
              d.sales,
              fmt(d.gross),
              "−" + fmt(d.refundTotal),
              fmt(d.net),
            ]),
          )
        : '<p class="empty">Nothing yet.</p>') +
      "<h3>By payment method</h3>" +
      (r.byMethod.length
        ? table(
            ["Method", "Sales", "Amount"],
            r.byMethod.map((m) => [m.method, m.sales, fmt(m.gross)]),
          )
        : '<p class="empty">Nothing yet.</p>') +
      "<h3>Best sellers</h3>" +
      (r.topProducts.length
        ? table(
            ["Product", "Units", "Revenue"],
            r.topProducts.map((p) => [p.name, p.quantity, fmt(p.revenue)]),
          )
        : '<p class="empty">Nothing yet.</p>');
  }

  async function init() {
    if (!$("cloudReportPanel")) return;
    $("cloudReportForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const days = Number($("cloudReportRange").value) || 7;
      const btn = e.currentTarget.querySelector("button");
      btn.disabled = true;
      $("cloudReportBody").innerHTML = '<p class="muted">Loading…</p>';
      try {
        if (
          typeof FirebaseBackend === "undefined" ||
          !FirebaseBackend.isSignedIn()
        )
          throw new Error(
            "Sign in to your cloud account first (Business setup → Cloud account).",
          );
        const offset = -new Date().getTimezoneOffset();
        const now = Date.now();
        const from = CloudReport.periodStart(now, days, offset);
        const data = await FirebaseBackend.fetchReport(from);
        const r = CloudReport.summarize(data.sales, data.refunds, data.staff, {
          ownerUid: FirebaseBackend.uid(),
          from,
          to: now + 86400000,
          offsetMin: offset,
        });
        draw(r, data);
      } catch (err) {
        $("cloudReportBody").innerHTML =
          `<p class="notice warn" role="alert">${esc(err.message)}</p>`;
      } finally {
        btn.disabled = false;
      }
    });
  }
  return { init };
})();
window.CloudReportUI = CloudReportUI;
