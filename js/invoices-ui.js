/* Wholesale invoices and credit accounts: till hooks and the Accounts screen. Logic lives in invoices.js (InvoiceCore).
 * For Counter and Retail every hook is a no-op. The ledger is NOT production-ready until authenticated sign-in exists.
 */
const InvoiceUI = (() => {
  const I = InvoiceCore,
    T = TierCore,
    W = WholesaleCore,
    $ = (id) => document.getElementById(id);
  let tier = T.DEFAULT_TIER;
  const newId = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : "pay-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  const on = () => T.has(tier, "invoices");

  async function taxRate() {
    const raw = (await POSDB.get("settings", "taxRate"))?.value;
    const v = W.validateTaxRate(raw);
    return v.ok ? v.value : W.DEFAULT_TAX_RATE;
  }

  // Wholesale only: add / remove the "On account (invoice)" payment choice.
  function syncPaymentOption() {
    const sel = $("paymentMethod");
    const has = [...sel.options].some((o) => o.value === "account");
    if (on() && !has) sel.add(new Option("On account (invoice)", "account"));
    if (!on() && has) {
      if (sel.value === "account") sel.value = "cash";
      [...sel.options].find((o) => o.value === "account").remove();
    }
    if (typeof renderCart === "function") renderCart();
  }

  async function render() {
    tier = await T.getTier(POSDB);
    syncPaymentOption();
    if (!on()) return;
    const [customers, sales, payments, bal, refunds] = await Promise.all([
      POSDB.all("customers"),
      POSDB.all("sales"),
      POSDB.all("payments"),
      POSDB.get("settings", "balances"),
      POSDB.all("refunds"),
    ]);
    const balances = bal?.value || {};
    const trade = customers
      .filter((c) => c.type === "trade")
      .sort((a, b) => a.name.localeCompare(b.name));
    $("accountList").innerHTML = trade.length
      ? trade
          .map((c) =>
            I.accountRow(
              c,
              balances[c.id]?.amount ?? 0,
              I.pendingBalance(sales, payments, c.id, refunds),
              c.creditLimit,
              balances[c.id]?.at,
            ),
          )
          .join("")
      : '<p class="empty">No trade customers yet. Add one in Customers (type: Trade customer).</p>';
    const keep = $("paymentCustomer").value;
    $("paymentCustomer").innerHTML =
      '<option value="">Choose customer…</option>' +
      trade
        .map((c) => `<option value="${I.esc(c.id)}">${I.esc(c.name)}</option>`)
        .join("");
    if (trade.some((c) => c.id === keep)) $("paymentCustomer").value = keep;
    const invoices = sales
      .filter((s) => s.invoice)
      .sort((a, b) => b.createdAt - a.createdAt);
    $("invoiceList").innerHTML = invoices.length
      ? invoices.slice(0, 50).map(I.invoiceRow).join("")
      : '<p class="empty">No invoices yet.</p>';
    const pays = payments.slice().sort((a, b) => b.createdAt - a.createdAt);
    $("paymentList").innerHTML = pays.length
      ? pays.slice(0, 50).map(I.paymentRow).join("")
      : '<p class="empty">No payments recorded.</p>';
    const rejected =
      sales.filter((s) => s.syncStatus === "rejected").length +
      payments.filter((p) => p.syncStatus === "rejected").length;
    $("rejectedBox").classList.toggle("hidden", !rejected);
    $("rejectedCount").textContent = rejected;
  }

  /* ----- hooks ----- */

  // Called by retail-ui decorateSale AFTER discount / customer are set. Returns false to cancel the sale.
  async function decorateSale(sale, cart) {
    tier = await T.getTier(POSDB);
    if (!on()) return true;
    const mode = $("paymentMethod").value === "account" ? "account" : "paid";
    const customer = sale.customerId
      ? await POSDB.get("customers", sale.customerId)
      : null;
    if (mode === "account" && !(customer && customer.type === "trade")) {
      toast("Choose a trade customer to sell on account.");
      return false;
    }
    const rate = await taxRate();
    const lines = cart.map((l) => ({
      price: l.price,
      qty: l.qty,
      taxExempt: !!l.taxExempt,
    }));
    const discount = sale.discount ? { amount: sale.discount.amount } : null;
    const t = I.computeInvoiceTotals(
      lines,
      discount ? discount.amount : 0,
      rate,
    );
    if (!t.ok) {
      toast(t.error);
      return false;
    }
    if (mode === "account") {
      const [sales, payments, bal, refunds] = await Promise.all([
        POSDB.all("sales"),
        POSDB.all("payments"),
        POSDB.get("settings", "balances"),
        POSDB.all("refunds"),
      ]);
      const known = bal?.value?.[customer.id];
      const o = I.overLimit({
        confirmed: known?.amount ?? 0,
        pending: I.pendingBalance(sales, payments, customer.id, refunds),
        invoiceTotal: t.total,
        creditLimit: customer.creditLimit,
      });
      if (
        o.over &&
        !confirm(
          "OVER CREDIT LIMIT\n\n" +
            customer.name +
            "'s balance would be " +
            I.money(o.projected) +
            " (limit " +
            I.money(o.limit) +
            "), over by " +
            I.money(o.by) +
            ".\n\nThis uses the last confirmed balance" +
            (known ? "" : " (never confirmed)") +
            " plus items pending on this device, so it may be out of date.\n\nCreate the invoice anyway?",
        )
      )
        return false;
    }
    const taxNumber = (await POSDB.get("settings", "taxNumber"))?.value || "";
    const number = await I.nextInvoiceNumber(POSDB);
    const built = I.buildInvoice(lines, discount, customer, {
      rate,
      number,
      mode,
      terms: customer?.terms,
      sellerTaxNumber: taxNumber,
    });
    if (!built.ok) {
      toast(built.error);
      return false;
    }
    sale.items = sale.items.map((it, i) =>
      cart[i] && cart[i].taxExempt ? { ...it, taxExempt: true } : it,
    );
    I.applyToSale(sale, built);
    return true;
  }

  async function textFor(sale) {
    const [name, tax] = await Promise.all([
      POSDB.get("settings", "businessName"),
      POSDB.get("settings", "taxNumber"),
    ]);
    return I.buildInvoiceText(sale, {
      name: name?.value || "Mwakete POS",
      taxNumber: tax?.value || "",
    });
  }

  async function init() {
    $("paymentForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget,
        f = form.elements;
      const v = I.validatePayment({
        customerId: f.paymentCustomer.value,
        amount: f.amount.value,
        note: f.note.value,
      });
      if (!v.ok) return toast(v.error);
      const c = await POSDB.get("customers", v.value.customerId);
      if (!c || c.type !== "trade") return toast("Choose a trade customer.");
      await POSDB.put("payments", {
        id: newId(),
        ...v.value,
        customerName: c.name,
        createdAt: Date.now(),
        syncStatus: "pending",
      });
      form.reset();
      await render();
      toast(
        "Payment saved on this device. It is not confirmed until you sync.",
      );
    });
    document.addEventListener("click", async (e) => {
      if (!e.target.closest("[data-retry-rejected]")) return;
      if (
        !confirm(
          "Mark rejected records as pending and try again? Fix the cause first (for example turn the ledger on in your Apps Script).",
        )
      )
        return;
      for (const s of await POSDB.all("sales"))
        if (s.syncStatus === "rejected") {
          const { syncError, ...rest } = s;
          await POSDB.put("sales", { ...rest, syncStatus: "pending" });
        }
      for (const p of await POSDB.all("payments"))
        if (p.syncStatus === "rejected") {
          const { syncError, ...rest } = p;
          await POSDB.put("payments", { ...rest, syncStatus: "pending" });
        }
      await render();
      if (typeof refresh === "function") await refresh();
      toast("Marked pending. Press Sync now.");
    });
    await render();
  }
  return { init, render, decorateSale, textFor };
})();
window.InvoiceUI = InvoiceUI;
