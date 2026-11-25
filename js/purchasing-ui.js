/* Purchasing screen: suppliers and purchase orders. Logic lives in stock.js (StockCore).
 * Receiving an order saves the order as "received" FIRST (so it can never be received twice), then the stock movements,
 * then the new stock levels. If the page is closed in the middle, a stock count on the Stock screen fixes the number. */
const PurchasingUI = (() => {
  const S = StockCore,
    $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toFixed(2);
  let products = [],
    lines = []; // the order being built: [{productId, qty, unitCost}]

  const STATUS = {
    draft: "Draft",
    ordered: "Ordered",
    received: "Received",
    cancelled: "Cancelled",
  };
  const SYNC = {
    synced: "Backed up",
    rejected: "Refused by the cloud",
    pending: "Not yet backed up",
  };

  const lineTotal = () =>
    lines.reduce(
      (n, l) => n + Math.round(Number(l.unitCost) * 100) * Number(l.qty),
      0,
    ) / 100;
  function renderLines() {
    const byId = new Map(products.map((p) => [p.id, p]));
    $("poLines").innerHTML = lines.length
      ? `<table><thead><tr><th>Product</th><th>Qty</th><th>Cost</th><th></th></tr></thead><tbody>${lines
          .map(
            (l, i) =>
              `<tr><td>${esc(byId.get(l.productId)?.name || "?")}</td><td>${esc(l.qty)}</td><td>${fmt(l.unitCost)}</td><td><button class="text-button" type="button" data-remove-line="${i}" aria-label="Remove ${esc(byId.get(l.productId)?.name || "line")} from the order">Remove</button></td></tr>`,
          )
          .join("")}</tbody></table>`
      : '<p class="empty">No products on this order yet.</p>';
    $("poTotal").textContent = "Order total: " + fmt(lineTotal());
  }

  async function render() {
    if (!$("view-purchasing")) return;
    products = (await POSDB.all("products")).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const keep = $("poProduct").value;
    $("poProduct").innerHTML = products.length
      ? products
          .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
          .join("")
      : '<option value="">Add a product first</option>';
    if (products.some((p) => p.id === keep)) $("poProduct").value = keep;
    const suppliers = (await POSDB.all("suppliers"))
      .filter((s) => !s.archived)
      .sort((a, b) => a.name.localeCompare(b.name));
    $("supplierNames").innerHTML = suppliers
      .map((s) => `<option value="${esc(s.name)}"></option>`)
      .join("");
    $("supplierList").innerHTML = suppliers.length
      ? suppliers
          .map(
            (s) =>
              `<div class="sale-row"><div><strong>${esc(s.name)}</strong><small>${esc(s.phone || "")}${s.note ? " · " + esc(s.note) : ""} · ${esc(SYNC[s.syncStatus] || SYNC.pending)}</small></div></div>`,
          )
          .join("")
      : '<p class="empty">No suppliers yet. They are added automatically when you save an order.</p>';
    const orders = (await POSDB.all("purchaseOrders")).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    $("poList").innerHTML = orders.length
      ? orders
          .map((o) => {
            const open = o.status === "draft" || o.status === "ordered";
            return `<div class="sale-row" data-po-id="${esc(o.id)}"><div><strong>${esc(o.number)} · ${esc(o.supplierName)}</strong><small>${esc(new Date(o.createdAt).toLocaleDateString())} · ${esc(STATUS[o.status])} · ${o.items.length} line(s) · ${esc(SYNC[o.syncStatus] || SYNC.pending)}${o.syncError ? " — " + esc(o.syncError) : ""}</small></div><div><strong>${fmt(o.total)}</strong>
              <button class="text-button" type="button" data-po-act="view">View</button>
              ${o.status === "draft" ? '<button class="text-button" type="button" data-po-act="order">Mark ordered</button>' : ""}
              ${open ? '<button class="text-button" type="button" data-po-act="receive">Receive stock</button><button class="text-button" type="button" data-po-act="cancel">Cancel</button>' : ""}
              ${o.syncStatus === "rejected" ? '<button class="text-button" type="button" data-po-act="retry">Retry</button>' : ""}</div></div>`;
          })
          .join("")
      : '<p class="empty">No purchase orders yet.</p>';
    renderLines();
  }

  async function currencyOf() {
    return (await POSDB.get("settings", "currency"))?.value;
  }
  async function afterChange() {
    if (typeof refresh === "function") await refresh();
    if (window.StockUI) await StockUI.render();
    await render();
    if (typeof POSSynchroniser !== "undefined" && navigator.onLine)
      POSSynchroniser.run().catch(() => {});
  }

  async function act(id, action) {
    const o = await POSDB.get("purchaseOrders", id);
    if (!o) return;
    if (action === "view") {
      const name = (await POSDB.get("settings", "businessName"))?.value;
      if (window.RetailUI)
        RetailUI.showText(S.buildPurchaseOrderText(o, { name }));
      return;
    }
    if (action === "retry") {
      const { syncError, ...rest } = o;
      await POSDB.put("purchaseOrders", { ...rest, syncStatus: "pending" });
      return afterChange();
    }
    const msg = {
      receive:
        "Receive this stock now? The quantities are added to this device's stock and the order is closed.",
      cancel: "Cancel this order? A cancelled order cannot be changed.",
    }[action];
    if (msg && !confirm(msg)) return;
    const t = S.transition(o, action, { newId: uid });
    if (!t.ok) return toast(t.error);
    await POSDB.put("purchaseOrders", t.order);
    for (const m of t.moves) {
      await POSDB.put("stockMoves", m);
      const p = await POSDB.get("products", m.productId);
      if (p)
        await POSDB.put("products", {
          ...p,
          stock: (Number(p.stock) || 0) + m.delta,
        });
    }
    toast(
      action === "receive"
        ? "Stock received."
        : action === "order"
          ? "Marked as ordered."
          : "Order cancelled.",
    );
    await afterChange();
  }

  async function init() {
    if (!$("view-purchasing")) return;
    $("poAddLine").addEventListener("click", () => {
      const pid = $("poProduct").value;
      const next = [
        ...lines,
        { productId: pid, qty: $("poQty").value, unitCost: $("poCost").value },
      ];
      const r = S.buildLines(next, products);
      if (!r.ok) return toast(r.error);
      lines = next.map((l) => ({
        ...l,
        qty: Number(l.qty),
        unitCost: Number(l.unitCost),
      }));
      $("poQty").value = "";
      $("poCost").value = "";
      renderLines();
    });
    $("poLines").addEventListener("click", (e) => {
      const b = e.target.closest("[data-remove-line]");
      if (!b) return;
      lines.splice(Number(b.dataset.removeLine), 1);
      renderLines();
    });
    $("poForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const formEl = e.currentTarget; // currentTarget is null after an await
      const supplierName = formEl.elements.supplierName.value.trim();
      const suppliers = await POSDB.all("suppliers");
      let sup = suppliers.find(
        (s) => s.name.toLowerCase() === supplierName.toLowerCase(),
      );
      const input = {
        supplierName: sup ? sup.name : supplierName,
        supplierId: sup?.id,
        lines,
        note: formEl.elements.note.value,
      };
      // Validate first; a number is only used once the order is good, so a mistake does not burn one.
      const check = S.buildPurchaseOrder(input, products, { id: "check" });
      if (!check.ok) return toast(check.error);
      const number = await S.nextNumber(POSDB, "PO", "poSeq");
      const r = S.buildPurchaseOrder(input, products, {
        id: uid(),
        number,
        currency: await currencyOf(),
      });
      if (!r.ok) return toast(r.error);
      let po = r.value;
      if (!sup) {
        const s = S.buildSupplier({ name: supplierName }, { id: uid() });
        if (s.ok) {
          await POSDB.put("suppliers", s.value);
          po = { ...po, supplierId: s.value.id };
        }
      }
      await POSDB.put("purchaseOrders", po);
      lines = [];
      formEl.reset();
      toast("Saved as draft " + number + ".");
      await afterChange();
    });
    $("poList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-po-act]");
      const row = e.target.closest("[data-po-id]");
      if (b && row) act(row.dataset.poId, b.dataset.poAct);
    });
    $("supplierForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const formEl = e.currentTarget;
      const f = formEl.elements;
      const r = S.buildSupplier(
        { name: f.name.value, phone: f.phone.value, note: f.note.value },
        { id: uid() },
      );
      if (!r.ok) return toast(r.error);
      if (
        (await POSDB.all("suppliers")).some(
          (s) => s.name.toLowerCase() === r.value.name.toLowerCase(),
        )
      )
        return toast("You already have a supplier with that name.");
      await POSDB.put("suppliers", r.value);
      formEl.reset();
      toast("Supplier added.");
      await afterChange();
    });
    await render();
  }
  return { init, render };
})();
window.PurchasingUI = PurchasingUI;
