/* Register screen: open and close the cash drawer. Logic lives in register.js (RegisterCore).
 * The open shift is kept on this device (settings key "registerOpen"); a CLOSED shift is saved as an
 * append-only record in the "registers" store and goes to the cloud account with the other records. */
const RegisterUI = (() => {
  const G = RegisterCore,
    $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toFixed(2);
  const KEY = "registerOpen";
  let shown = null;

  const getOpen = async () => (await POSDB.get("settings", KEY))?.value || null;
  async function figures(open) {
    const [sales, payments, refunds] = await Promise.all([
      POSDB.all("sales"),
      POSDB.all("payments"),
      POSDB.all("refunds"),
    ]);
    return {
      sales,
      payments,
      refunds,
      sum: G.summarize(open, sales, payments, refunds, Date.now()),
    };
  }

  function previewDifference(sum) {
    const v = $("registerCloseForm").elements.counted.value;
    const out = $("registerDiff");
    const a = G.validAmount(v);
    if (!a.ok) {
      out.textContent =
        v === ""
          ? "Count the cash in the drawer to see the difference."
          : a.error;
      return;
    }
    const diff = Math.round(a.value * 100) - Math.round(sum.expectedCash * 100);
    out.textContent = G.differenceText(diff / 100);
  }

  async function render() {
    if (!$("view-register")) return;
    const open = await getOpen();
    $("registerClosed").classList.toggle("hidden", !!open);
    $("registerOpen").classList.toggle("hidden", !open);
    shown = null;
    if (open) {
      const f = await figures(open);
      shown = f.sum;
      $("registerSince").textContent =
        "Open since " + new Date(open.openedAt).toLocaleString() + ".";
      $("registerLive").innerHTML = `<table><tbody>
          <tr><td>Opening float</td><td>${fmt(open.openingFloat)}</td></tr>
          <tr><td>+ Cash sales (${f.sum.salesCount})</td><td>${fmt(f.sum.cashSales)}</td></tr>
          <tr><td>+ Payments on account</td><td>${fmt(f.sum.cashPayments)}</td></tr>
          <tr><td>− Cash refunds</td><td>${fmt(f.sum.cashRefunds)}</td></tr>
          <tr><th scope="row">Expected in the drawer</th><th>${fmt(f.sum.expectedCash)}</th></tr>
        </tbody></table>`;
      previewDifference(f.sum);
    }
    const shifts = (await POSDB.all("registers"))
      .sort((a, b) => b.closedAt - a.closedAt)
      .slice(0, 30);
    $("registerList").innerHTML = shifts.length
      ? shifts
          .map(
            (s) =>
              `<div class="sale-row" data-shift-id="${esc(s.id)}" tabindex="0" role="button"><div><strong>${esc(new Date(s.closedAt).toLocaleString())}</strong><small>${esc(G.differenceText(s.difference))} · ${s.syncStatus === "synced" ? "Backed up" : s.syncStatus === "rejected" ? "Refused by the cloud" : "Not yet backed up"}</small></div><strong>${fmt(s.countedCash)}</strong></div>`,
          )
          .join("")
      : '<p class="empty">No closed shifts yet.</p>';
  }

  async function showReport(rec) {
    const name = (await POSDB.get("settings", "businessName"))?.value;
    if (window.RetailUI) RetailUI.showText(G.buildShiftText(rec, { name }));
  }

  async function init() {
    if (!$("view-register")) return;
    $("registerOpenForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget; // currentTarget is null after an await, so keep a reference
      if (await getOpen()) return toast("A register is already open.");
      const r = G.buildOpen(form.elements.float.value, { id: uid() });
      if (!r.ok) return toast(r.error);
      await POSDB.put("settings", { key: KEY, value: r.value });
      form.reset();
      await render();
      toast("Register open.");
    });
    $("registerCloseForm").addEventListener(
      "input",
      () => shown && previewDifference(shown),
    );
    $("registerCloseForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const open = await getOpen();
      if (!open) return toast("No register is open.");
      const f = await figures(open);
      const r = G.buildClose(open, form.elements.counted.value, {
        note: form.elements.note.value,
        currency: (await POSDB.get("settings", "currency"))?.value,
        sales: f.sales,
        payments: f.payments,
        refunds: f.refunds,
      });
      if (!r.ok) return toast(r.error);
      if (
        r.value.difference !== 0 &&
        !confirm(
          G.differenceText(r.value.difference) +
            "\n\nClose the register anyway?",
        )
      )
        return;
      // The closed shift is saved first; only then is the open shift cleared, so a shift is never lost.
      await POSDB.put("registers", r.value);
      await POSDB.remove("settings", KEY);
      form.reset();
      await render();
      await showReport(r.value);
      if (typeof POSSynchroniser !== "undefined" && navigator.onLine)
        POSSynchroniser.run().catch(() => {});
    });
    $("registerList").addEventListener("click", async (e) => {
      const row = e.target.closest("[data-shift-id]");
      if (!row) return;
      const rec = await POSDB.get("registers", row.dataset.shiftId);
      if (rec) showReport(rec);
    });
    $("registerList").addEventListener("keydown", (e) => {
      if (
        (e.key === "Enter" || e.key === " ") &&
        e.target.matches("[data-shift-id]")
      ) {
        e.preventDefault();
        e.target.click();
      }
    });
    await render();
  }
  return { init, render };
})();
window.RegisterUI = RegisterUI;
