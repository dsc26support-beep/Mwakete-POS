/* Retail screens: discounts, customers, receipts, low stock, reports, barcode Enter.
 * app.js calls the hooks at the bottom (decorateSale, afterCart, afterSale, productExtras, render).
 * For the Counter tier every hook is a no-op, so Counter behaves exactly as before.
 */
const RetailUI = (() => {
  const R = RetailCore,
    T = TierCore,
    $ = (id) => document.getElementById(id);
  let tier = T.DEFAULT_TIER,
    lastCart = [],
    lastReceipt = "";
  const newId = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : "c-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  const retail = () =>
    T.has(tier, "discounts") ||
    T.has(tier, "customers") ||
    T.has(tier, "reports") ||
    T.has(tier, "lowStock");

  function discountInput() {
    return { type: $("discountType").value, value: $("discountValue").value };
  }

  async function render() {
    tier = await T.getTier(POSDB);
    if (!retail()) return;
    const [products, sales, customers, cur] = await Promise.all([
      POSDB.all("products"),
      POSDB.all("sales"),
      R.listCustomers(POSDB),
      POSDB.get("settings", "currency"),
    ]);
    $("lowStockList").innerHTML = R.lowStockPanel(R.lowStock(products));
    const cats = [
      ...new Set(products.map((p) => p.category).filter(Boolean)),
    ].sort();
    $("categoryList").innerHTML = cats
      .map((c) => `<option value="${R.esc(c)}"></option>`)
      .join("");
    $("customerList").innerHTML = customers.length
      ? customers
          .map((c) =>
            R.customerRow(c, window.WholesaleUI ? WholesaleUI.badge(c) : ""),
          )
          .join("")
      : '<p class="empty">No customers yet.</p>';
    const sel = $("saleCustomer"),
      keep = sel.value;
    sel.innerHTML =
      '<option value="">Walk-in</option>' +
      customers
        .map((c) => `<option value="${R.esc(c.id)}">${R.esc(c.name)}</option>`)
        .join("");
    if (customers.some((c) => c.id === keep)) sel.value = keep;
    $("reportBody").innerHTML = R.reportHtml(
      R.salesReport(sales, products),
      cur?.value || "",
    );
    afterCart(lastCart);
    if (window.InvoiceUI) InvoiceUI.render();
  }

  // Called by renderCart(): show the discounted total without changing the cart itself.
  function afterCart(cart) {
    lastCart = cart || [];
    const row = $("discountRow"),
      note = $("discountNote");
    if (!T.has(tier, "discounts")) return row.classList.add("hidden");
    const t = R.computeTotals(lastCart, discountInput());
    note.classList.toggle("hidden", t.ok);
    if (!t.ok) {
      note.textContent = t.error;
      $("total").textContent = R.money(
        R.computeTotals(lastCart, { type: "none" }).total,
      );
      return row.classList.add("hidden");
    }
    row.classList.toggle("hidden", !t.discount);
    if (t.discount)
      $("discountAmount").textContent = "-" + R.money(t.discount.amount);
    $("total").textContent = R.money(t.total);
  }

  // Called just before a sale is saved. Returns false to cancel the sale.
  async function decorateSale(sale, cart) {
    tier = await T.getTier(POSDB);
    if (!retail()) return true;
    const t = R.computeTotals(
      cart,
      T.has(tier, "discounts") ? discountInput() : { type: "none" },
    );
    if (!t.ok) {
      toast(t.error);
      return false;
    }
    sale.tier = tier;
    sale.subtotal = t.subtotal;
    sale.total = t.total;
    if (t.discount) sale.discount = t.discount;
    const cust = T.has(tier, "customers") ? $("saleCustomer").value : "";
    if (cust) sale.customerId = cust; // opaque local id only; the name never leaves the device
    sale.items = sale.items.map((it, i) =>
      cart[i] && cart[i].category ? { ...it, category: cart[i].category } : it,
    );
    if (window.WholesaleUI) WholesaleUI.decorateSale(sale, cart);
    // Wholesale invoices: tax, number and on-account handling. false = the sale was cancelled (message already shown).
    if (window.InvoiceUI && !(await InvoiceUI.decorateSale(sale, cart)))
      return false;
    return true;
  }

  function afterSale(sale) {
    $("discountType").value = "none";
    $("discountValue").value = "";
    $("saleCustomer").value = "";
    if (window.WholesaleUI) WholesaleUI.afterSale();
    if (T.has(tier, "receipts")) showReceipt(sale);
  }

  async function showReceipt(sale) {
    const [name, cust] = await Promise.all([
      POSDB.get("settings", "businessName"),
      sale.customerId ? POSDB.get("customers", sale.customerId) : null,
    ]);
    lastReceipt =
      sale.invoice && window.InvoiceUI
        ? await InvoiceUI.textFor(sale)
        : R.buildReceiptText(sale, name?.value || "Mwakete POS", cust);
    $("receiptBody").innerHTML = R.receiptHtml(lastReceipt);
    $("receiptPanel").dataset.saleId = sale.id;
    if ($("receiptRefund")) $("receiptRefund").hidden = false;
    $("receiptPanel").classList.remove("hidden");
    $("receiptClose").focus();
  }

  // Shows any 32-column document (for example a credit note) in the same viewer. No refund button on it.
  function showText(text) {
    lastReceipt = text;
    $("receiptBody").innerHTML = R.receiptHtml(text);
    $("receiptPanel").dataset.saleId = "";
    if ($("receiptRefund")) $("receiptRefund").hidden = true;
    $("receiptPanel").classList.remove("hidden");
    $("receiptClose").focus();
  }

  // Called by the product form. null = invalid (already told the user).
  function productExtras(formData) {
    if (!T.has(tier, "categories") && !T.has(tier, "lowStock")) return {};
    const v = R.validateProductExtras({
      category: formData.get("category"),
      reorderLevel: formData.get("reorderLevel"),
    });
    if (!v.ok) {
      toast(v.error);
      return null;
    }
    const w = window.WholesaleUI ? WholesaleUI.productExtras() : {};
    if (!w) return null;
    return { ...v.value, ...w };
  }

  async function init() {
    ["discountType", "discountValue"].forEach((id) =>
      $(id).addEventListener("input", () => afterCart(lastCart)),
    );
    $("productSearch").addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || !T.has(tier, "barcode")) return;
      e.preventDefault();
      const code = e.target.value;
      const p = R.findBySku(await POSDB.all("products"), code);
      if (!p && window.WholesaleUI && (await WholesaleUI.addPackBySku(code))) {
        e.target.value = "";
        e.target.dispatchEvent(new Event("input"));
        return;
      }
      if (!p) return toast("No product with that barcode.");
      e.target.value = "";
      e.target.dispatchEvent(new Event("input"));
      const card = document.querySelector(
        '[data-add="' + CSS.escape(p.id) + '"]',
      );
      if (card) card.click();
    });
    $("customerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget,
        f = form.elements;
      const extras = window.WholesaleUI ? WholesaleUI.customerExtras() : {};
      if (!extras) return;
      const r = await R.addCustomer(
        POSDB,
        { name: f.name.value, phone: f.phone.value, notes: f.notes.value },
        newId(),
      );
      if (!r.ok) return toast(r.error);
      if (Object.keys(extras).length)
        await POSDB.put("customers", { ...r.item, ...extras });
      form.reset();
      await render();
      toast("Customer saved on this device.");
    });
    $("receiptClose").addEventListener("click", () =>
      $("receiptPanel").classList.add("hidden"),
    );
    $("receiptPrint").addEventListener("click", () => window.print());
    $("receiptCopy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(lastReceipt);
        toast("Receipt copied.");
      } catch {
        prompt("Copy this receipt:", lastReceipt);
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") $("receiptPanel").classList.add("hidden");
    });
    document.addEventListener("click", async (e) => {
      const rm = e.target.closest("[data-remove-customer]");
      if (rm) {
        if (
          confirm("Remove this customer from this device? Past sales are kept.")
        ) {
          await R.removeCustomer(POSDB, rm.dataset.removeCustomer);
          render();
        }
        return;
      }
      const row = e.target.closest(".sale-row[data-sale-id]");
      if (row && T.has(tier, "receipts")) {
        const sale = await POSDB.get("sales", row.dataset.saleId);
        if (sale) showReceipt(sale);
      }
    });
    await render();
  }
  return {
    init,
    render,
    afterCart,
    decorateSale,
    afterSale,
    productExtras,
    showText,
    showReceipt,
  };
})();
// `const` in a classic script is not a window property; app.js checks window.RetailUI before calling the hooks.
window.RetailUI = RetailUI;
