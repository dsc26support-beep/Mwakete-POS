/* Quotes, delivery notes and customer statements (Wholesale). Logic lives in trade.js (TradeCore).
 * "Make invoice" loads the quote into the till at the quoted prices; the normal checkout makes the invoice. The quote is only marked
 * converted AFTER that sale is saved and only if the sale really contains the quoted goods, so one quote becomes at most one invoice. */
const QuotesUI = (() => {
  const T = TradeCore,
    $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toFixed(2);
  const STATUS = {
    open: "Open",
    expired: "Expired",
    converted: "Made into an invoice",
    declined: "Declined",
  };
  const SYNC = {
    synced: "Backed up",
    rejected: "Refused by the cloud",
    pending: "Not yet backed up",
  };
  let products = [],
    lines = [],
    active = null; // the quote currently loaded in the till

  const taxRate = async () => {
    const v = (await POSDB.get("settings", "taxRate"))?.value;
    return v === undefined || v === "" ? 12.5 : Number(v);
  };
  const businessName = async () =>
    (await POSDB.get("settings", "businessName"))?.value;

  async function previewTotal() {
    const items = lines.map((l) => ({
      price: Number(l.unitPrice),
      qty: Number(l.qty),
      taxExempt: !!products.find((p) => p.id === l.productId)?.taxExempt,
    }));
    const t = items.length
      ? InvoiceCore.computeInvoiceTotals(items, 0, await taxRate())
      : null;
    $("quoteTotal").textContent =
      t && t.ok
        ? "Quote total: " + fmt(t.total) + " (tax " + fmt(t.tax) + " included)"
        : "Quote total: 0.00";
  }
  function renderLines() {
    const byId = new Map(products.map((p) => [p.id, p]));
    $("quoteLines").innerHTML = lines.length
      ? `<table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th></th></tr></thead><tbody>${lines
          .map(
            (l, i) =>
              `<tr><td>${esc(byId.get(l.productId)?.name || "?")}</td><td>${esc(l.qty)}</td><td>${fmt(l.unitPrice)}</td><td><button class="text-button" type="button" data-remove-qline="${i}" aria-label="Remove ${esc(byId.get(l.productId)?.name || "line")} from the quote">Remove</button></td></tr>`,
          )
          .join("")}</tbody></table>`
      : '<p class="empty">No products on this quote yet.</p>';
    previewTotal();
  }

  async function render() {
    if (!$("view-quotes")) return;
    products = (await POSDB.all("products")).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const keep = $("quoteProduct").value;
    $("quoteProduct").innerHTML = products.length
      ? products
          .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
          .join("")
      : '<option value="">Add a product first</option>';
    if (products.some((p) => p.id === keep)) $("quoteProduct").value = keep;
    if (!$("quotePrice").value && products[0])
      $("quotePrice").value = (
        products.find((p) => p.id === $("quoteProduct").value) || products[0]
      ).price;
    const trade = (await POSDB.all("customers"))
      .filter((c) => c.type === "trade")
      .sort((a, b) => a.name.localeCompare(b.name));
    const keepC = $("quoteCustomer").value;
    $("quoteCustomer").innerHTML =
      '<option value="">Type a name below…</option>' +
      trade
        .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
        .join("");
    if (trade.some((c) => c.id === keepC)) $("quoteCustomer").value = keepC;
    const now = Date.now();
    const quotes = (await POSDB.all("quotes")).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    $("quoteList").innerHTML = quotes.length
      ? quotes
          .map((q) => {
            const st = T.quoteStatus(q, now);
            return `<div class="sale-row" data-quote-id="${esc(q.id)}"><div><strong>${esc(q.number)} · ${esc(q.customerName)}</strong><small>${esc(new Date(q.createdAt).toLocaleDateString())}${q.validUntil ? " · valid until " + esc(new Date(q.validUntil).toLocaleDateString()) : ""} · ${esc(STATUS[st])} · ${esc(SYNC[q.syncStatus] || SYNC.pending)}${q.syncError ? " — " + esc(q.syncError) : ""}</small></div><div><strong>${fmt(q.total)}</strong>
              <button class="text-button" type="button" data-quote-act="view">View</button>
              ${st === "open" ? '<button class="text-button" type="button" data-quote-act="invoice">Make invoice</button><button class="text-button" type="button" data-quote-act="decline">Decline</button>' : ""}
              ${q.syncStatus === "rejected" ? '<button class="text-button" type="button" data-quote-act="retry">Retry</button>' : ""}</div></div>`;
          })
          .join("")
      : '<p class="empty">No quotes yet.</p>';
    renderLines();
  }

  async function afterChange() {
    await render();
    if (typeof POSSynchroniser !== "undefined" && navigator.onLine)
      POSSynchroniser.run().catch(() => {});
  }

  async function makeInvoice(id) {
    const q = await POSDB.get("quotes", id);
    const prods = await POSDB.all("products");
    const c = T.checkConvert(q, prods);
    if (!c.ok) return toast(c.error);
    if (
      cart.length &&
      !confirm(
        "The till already has items in it. Replace them with this quote?",
      )
    )
      return;
    cart = T.cartLines(q, prods);
    active = { id: q.id };
    if (window.RetailUI) await RetailUI.render(); // makes sure the customer list is current
    if (q.customerId && $("saleCustomer"))
      $("saleCustomer").value = q.customerId;
    $("paymentMethod").value = q.customerId ? "account" : "cash";
    renderCart();
    document.querySelector('.tab[data-view="sale"]').click();
    toast(
      "Quote loaded at the quoted prices. Check it, then complete the sale to make the invoice.",
    );
  }

  // Called by app.js right after a sale is saved.
  async function afterSale(sale) {
    if (!active) return;
    const q = await POSDB.get("quotes", active.id);
    active = null;
    if (!q || q.status !== "open") return;
    if (!T.matchesSale(q, sale)) {
      toast("That sale does not match the quote, so the quote stays open.");
      return;
    }
    await POSDB.put("quotes", T.markConverted(q, sale.id));
    toast("Quote " + q.number + " is now an invoice.");
    await afterChange();
  }

  async function init() {
    if (!$("view-quotes")) return;
    $("quoteProduct").addEventListener("change", () => {
      const p = products.find((x) => x.id === $("quoteProduct").value);
      if (p) $("quotePrice").value = p.price;
    });
    $("quoteAddLine").addEventListener("click", () => {
      const next = [
        ...lines,
        {
          productId: $("quoteProduct").value,
          qty: $("quoteQty").value,
          unitPrice: $("quotePrice").value,
        },
      ];
      const r = T.buildQuote({ customerName: "x", lines: next }, products, {});
      if (!r.ok) return toast(r.error);
      lines = next.map((l) => ({
        ...l,
        qty: Number(l.qty),
        unitPrice: Number(l.unitPrice),
      }));
      $("quoteQty").value = "";
      renderLines();
    });
    $("quoteLines").addEventListener("click", (e) => {
      const b = e.target.closest("[data-remove-qline]");
      if (!b) return;
      lines.splice(Number(b.dataset.removeQline), 1);
      renderLines();
    });
    $("quoteForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget; // currentTarget is null after an await
      const f = form.elements;
      const customer = f.customer.value
        ? await POSDB.get("customers", f.customer.value)
        : null;
      const days = Number(f.days.value);
      const now = Date.now();
      const input = {
        customer,
        customerName: f.customerName.value,
        lines,
        validUntil:
          Number.isFinite(days) && days > 0 ? now + days * 86400000 : "",
        note: f.note.value,
        taxRate: await taxRate(),
      };
      const check = T.buildQuote(input, products, { id: "check", now });
      if (!check.ok) return toast(check.error);
      const number = await StockCore.nextNumber(POSDB, "QT", "quoteSeq"); // only used once the quote is valid
      const r = T.buildQuote(input, products, {
        id: uid(),
        number,
        now,
        currency: (await POSDB.get("settings", "currency"))?.value,
      });
      if (!r.ok) return toast(r.error);
      await POSDB.put("quotes", r.value);
      lines = [];
      form.reset();
      f.days.value = 14;
      toast("Quote " + number + " saved.");
      await afterChange();
    });
    $("quoteList").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-quote-act]");
      const row = e.target.closest("[data-quote-id]");
      if (!b || !row) return;
      const q = await POSDB.get("quotes", row.dataset.quoteId);
      if (!q) return;
      const act = b.dataset.quoteAct;
      if (act === "view")
        return (
          window.RetailUI &&
          RetailUI.showText(T.buildQuoteText(q, { name: await businessName() }))
        );
      if (act === "invoice") return makeInvoice(q.id);
      if (act === "retry") {
        const { syncError, ...rest } = q;
        await POSDB.put("quotes", { ...rest, syncStatus: "pending" });
        return afterChange();
      }
      if (act === "decline") {
        if (!confirm("Decline this quote? It cannot be reopened.")) return;
        const d = T.decline(q);
        if (!d.ok) return toast(d.error);
        await POSDB.put("quotes", d.value);
        await afterChange();
      }
    });

    // Delivery note from an invoice's receipt.
    $("receiptDelivery").addEventListener("click", async () => {
      const sale = await POSDB.get("sales", $("receiptPanel").dataset.saleId);
      if (sale && window.RetailUI)
        RetailUI.showText(
          T.buildDeliveryNoteText(sale, { name: await businessName() }),
        );
    });
    // Customer statement from the Accounts screen.
    document.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-statement]");
      if (!b) return;
      const customer = await POSDB.get("customers", b.dataset.statement);
      if (!customer) return toast("That customer was not found.");
      const [sales, payments, refunds, cur] = await Promise.all([
        POSDB.all("sales"),
        POSDB.all("payments"),
        POSDB.all("refunds"),
        POSDB.get("settings", "currency"),
      ]);
      const st = T.buildStatement(customer, sales, payments, refunds);
      if (window.RetailUI)
        RetailUI.showText(
          T.buildStatementText(
            st,
            { name: await businessName() },
            Date.now(),
            cur?.value || "",
          ),
        );
    });
    await render();
  }
  return { init, render, afterSale };
})();
window.QuotesUI = QuotesUI;
