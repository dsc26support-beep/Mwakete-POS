/* Refund screens: the refund dialog, the credit notes list and the credit note viewer.
 * Logic lives in refunds.js (RefundCore). A refund never changes the original sale. */
const RefundsUI = (() => {
  const R = RefundCore,
    $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toFixed(2);
  let sale = null,
    refunds = [];

  const METHOD_TEXT = {
    cash: "Cash returned to the customer",
    other: "Returned another way (record only)",
    account: "Credit the customer's account",
  };

  function picks() {
    return [...document.querySelectorAll("#refundLines [data-line]")]
      .map((i) => ({ index: Number(i.dataset.line), qty: Number(i.value) }))
      .filter((p) => p.qty > 0);
  }
  function preview() {
    const f = $("refundForm").elements;
    const p = picks();
    const out = $("refundTotal");
    if (!p.length) {
      out.textContent = "Choose how many of each item are coming back.";
      $("refundConfirm").disabled = true;
      return null;
    }
    const r = R.buildRefund(sale, p, {
      id: "preview",
      number: "preview",
      method: f.method.value,
      reason: f.reason.value,
      restock: f.restock.checked,
      refunds,
    });
    $("refundConfirm").disabled = !r.ok;
    out.textContent = r.ok
      ? "Refund total: " +
        fmt(r.value.total) +
        " " +
        (sale.currency || "") +
        (r.value.tax ? " (includes tax " + fmt(r.value.tax) + ")" : "")
      : r.error;
    return r.ok ? r.value : null;
  }

  async function open(saleId) {
    sale = await POSDB.get("sales", saleId);
    if (!sale) return toast("Could not find that sale.");
    refunds = await POSDB.all("refunds");
    const lines = R.remainingLines(sale, refunds);
    if (!R.refundable(sale, refunds))
      return toast("That sale has already been refunded in full.");
    const onAccount = !!(sale.invoice && sale.invoice.mode === "account");
    $("refundSale").textContent =
      (sale.invoice
        ? "Invoice " + sale.invoice.number
        : "Sale " + sale.id.slice(0, 18)) +
      " · " +
      new Date(sale.createdAt).toLocaleString() +
      " · total " +
      fmt(sale.total);
    $("refundLines").innerHTML = lines
      .filter((l) => l.remaining > 0)
      .map(
        (l) =>
          `<label class="refund-line">${esc(l.name)} <small>(${fmt(l.unitPrice)} each, ${l.remaining} left to return)</small><input type="number" inputmode="numeric" min="0" max="${l.remaining}" step="1" value="0" data-line="${l.index}" aria-label="Quantity of ${esc(l.name)} to return"></label>`,
      )
      .join("");
    $("refundMethod").innerHTML = (onAccount ? ["account"] : ["cash", "other"])
      .map((m) => `<option value="${m}">${esc(METHOD_TEXT[m])}</option>`)
      .join("");
    $("refundForm").elements.reason.value = "";
    $("refundForm").elements.restock.checked = true;
    preview();
    $("refundPanel").classList.remove("hidden");
    const first = document.querySelector("#refundLines [data-line]");
    if (first) first.focus();
  }
  const close = () => $("refundPanel").classList.add("hidden");

  async function submit(e) {
    e.preventDefault();
    const btn = $("refundConfirm");
    btn.disabled = true;
    try {
      const f = $("refundForm").elements;
      refunds = await POSDB.all("refunds"); // re-read: another tab or a sync may have changed it
      const number = await R.nextCreditNumber(POSDB);
      const r = R.buildRefund(sale, picks(), {
        id: uid(),
        number,
        method: f.method.value,
        reason: f.reason.value,
        restock: f.restock.checked,
        refunds,
      });
      if (!r.ok) return toast(r.error);
      // Saved before anything else, so a refund is never lost; stock follows.
      await POSDB.put("refunds", r.value);
      for (const u of R.restockUnits(r.value)) {
        const p = await POSDB.get("products", u.productId);
        if (p)
          await POSDB.put("products", {
            ...p,
            stock: (Number(p.stock) || 0) + u.units,
          });
      }
      close();
      await render();
      if (typeof refresh === "function") await refresh();
      if (window.InvoiceUI) await InvoiceUI.render();
      toast("Refund recorded as credit note " + number + ".");
      await showNote(r.value);
      if (typeof POSSynchroniser !== "undefined" && navigator.onLine)
        POSSynchroniser.run().catch(() => {});
    } finally {
      btn.disabled = false;
    }
  }

  async function showNote(refund) {
    const [s, name] = await Promise.all([
      POSDB.get("sales", refund.saleId),
      POSDB.get("settings", "businessName"),
    ]);
    const text = R.buildCreditNoteText(refund, s, { name: name?.value });
    if (window.RetailUI) RetailUI.showText(text);
  }

  const STATUS = {
    pending: "Not yet backed up",
    synced: "Backed up",
    rejected: "Refused by the cloud",
  };
  async function render() {
    const box = $("refundsList");
    if (!box) return;
    refunds = (await POSDB.all("refunds")).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    box.innerHTML = refunds.length
      ? refunds
          .map(
            (r) =>
              `<div class="sale-row" data-refund-id="${esc(r.id)}" tabindex="0" role="button" aria-label="Open credit note ${esc(r.number)}"><div><strong>${esc(r.number)}</strong><small>${new Date(r.createdAt).toLocaleString()} · ${esc(r.method)} · ${esc(STATUS[r.syncStatus] || r.syncStatus)}${r.syncError ? " — " + esc(r.syncError) : ""}</small></div><div><strong>−${fmt(r.total)}</strong>${r.syncStatus === "rejected" ? ` <button class="text-button" type="button" data-retry-refund="${esc(r.id)}">Retry</button>` : ""}</div></div>`,
          )
          .join("")
      : '<p class="empty">No refunds yet.</p>';
  }

  async function init() {
    if (!$("refundPanel")) return;
    $("receiptRefund").addEventListener("click", () => {
      const id = $("receiptPanel").dataset.saleId;
      if (!id) return;
      $("receiptPanel").classList.add("hidden");
      open(id);
    });
    $("refundForm").addEventListener("input", preview);
    $("refundForm").addEventListener("submit", submit);
    $("refundCancel").addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("refundPanel").classList.contains("hidden"))
        close();
    });
    $("refundsList").addEventListener("click", async (e) => {
      const retry = e.target.closest("[data-retry-refund]");
      if (retry) {
        const r = await POSDB.get("refunds", retry.dataset.retryRefund);
        if (r) {
          const { syncError, ...rest } = r;
          await POSDB.put("refunds", { ...rest, syncStatus: "pending" });
          await render();
          if (typeof POSSynchroniser !== "undefined")
            POSSynchroniser.run().catch(() => {});
        }
        return;
      }
      const row = e.target.closest("[data-refund-id]");
      if (row) {
        const r = await POSDB.get("refunds", row.dataset.refundId);
        if (r) showNote(r);
      }
    });
    $("refundsList").addEventListener("keydown", (e) => {
      if (
        (e.key === "Enter" || e.key === " ") &&
        e.target.matches("[data-refund-id]")
      ) {
        e.preventDefault();
        e.target.click();
      }
    });
    await render();
  }
  return { init, render, open };
})();
window.RefundsUI = RefundsUI;
