let products = [],
  cart = [];
const $ = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toFixed(2);
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}
function uid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : "pos-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}
async function refresh() {
  products = await POSDB.all("products");
  renderProducts();
  renderCart();
  renderProductTable();
  renderSales();
  const settings = await POSDB.all("settings");
  const map = Object.fromEntries(settings.map((x) => [x.key, x.value]));
  $("settingsForm").elements.businessName.value = map.businessName || "";
  $("settingsForm").elements.currency.value = map.currency || "AUD";
  $("settingsForm").elements.apiUrl.value = map.apiUrl || "";
  if (window.RetailUI) await RetailUI.render();
  if (window.RegisterUI) await RegisterUI.render();
  if (window.StockUI) await StockUI.render();
  if (window.QuotesUI) await QuotesUI.render();
  if (window.PurchasingUI) await PurchasingUI.render();
}
const MAX_GRID = 150, // product cards drawn at the till
  MAX_ROWS = 200, // rows drawn in the product list
  MAX_SALES = 100; // sales drawn in the history
const MAX_QTY = 9999; // most of one item in a single sale
// Stock counts live on each device and can be out of date, so this warns and never blocks a sale.
function stockWarn(p, line) {
  if (!p || !line) return;
  const need = line.qty * (line.packUnits || 1);
  if (Number.isFinite(Number(p.stock)) && need > Number(p.stock))
    toast("Only " + p.stock + " of " + p.name + " in stock on this device.");
}
function renderProducts() {
  const q = $("productSearch").value.toLowerCase().trim(),
    // Archived products are hidden from the till (they stay in the list and in old sales).
    items = products.filter(
      (p) =>
        !p.archived &&
        (p.name + " " + (p.sku || "") + " " + (p.description || ""))
          .toLowerCase()
          .includes(q),
    );
  // A long product list is drawn in part (the search still looks through ALL of them), so a low-cost phone stays quick.
  const shown = items.slice(0, MAX_GRID);
  $("productGrid").innerHTML =
    shown
      .map(
        (p) =>
          `<button class="product-card" data-add="${p.id}"><strong>${esc(p.name)}</strong><span>${money(p.price)}</span><small>${p.stock > 0 ? p.stock + " in stock" : '<span class="badge out">Out of stock</span>'}</small></button>`,
      )
      .join("") +
    (items.length > shown.length
      ? `<p class="hint" style="grid-column:1/-1">Showing ${shown.length} of ${items.length}. Type in the search box to find the rest.</p>`
      : "");
  $("emptyProducts").classList.toggle("hidden", products.length > 0);
  if (window.WholesaleUI) WholesaleUI.afterProducts();
}
function renderCart() {
  $("cartCount").textContent = cart.reduce((n, x) => n + x.qty, 0);
  $("cartItems").innerHTML = cart.length
    ? cart
        .map(
          (x) =>
            `<div class="cart-line"><div><strong>${esc(x.name)}</strong><small>${money(x.price)} × ${x.qty}</small></div><div class="qty"><button data-dec="${x.id}" aria-label="Decrease">−</button><b>${money(x.price * x.qty)}</b><button data-inc="${x.id}" aria-label="Increase">+</button></div></div>`,
        )
        .join("")
    : '<p class="empty">Your cart is empty.</p>';
  const total = cart.reduce((n, x) => n + x.price * x.qty, 0);
  $("subtotal").textContent = money(total);
  $("total").textContent = money(total);
  $("checkout").disabled = !cart.length;
  if (window.RetailUI) RetailUI.afterCart(cart);
  if (window.CheckoutUI) CheckoutUI.afterCart(cart);
  $("checkout").textContent =
    $("paymentMethod").value === "cash"
      ? "Complete cash sale"
      : $("paymentMethod").value === "account"
        ? "Create invoice (on account)"
        : "Record payment (unverified)";
  saveDraft();
}
/* Crash recovery: the unfinished sale in the cart is kept on the device, so a dead battery or a closed tab does not lose it.
 * It is cleared by the same code path that empties the cart (a completed sale or "Clear"). */
let draftTimer;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const value = cart.map((x) => ({
      id: x.id,
      productId: x.productId || x.id,
      name: x.name,
      sku: x.sku,
      price: x.price,
      qty: x.qty,
      listId: x.listId || "",
      ...(x.packId ? { packId: x.packId, packUnits: x.packUnits } : {}),
      ...(x.taxExempt ? { taxExempt: true } : {}),
    }));
    Promise.resolve(POSDB.put("settings", { key: "cartDraft", value })).catch(
      () => {},
    );
  }, 50);
}
async function restoreDraft() {
  const d = (await POSDB.get("settings", "cartDraft"))?.value;
  if (!Array.isArray(d) || !d.length || cart.length) return;
  const prods = await POSDB.all("products");
  const byId = new Map(prods.map((p) => [p.id, p]));
  const keep = d.filter(
    (l) =>
      l &&
      byId.has(l.productId) &&
      Number.isInteger(l.qty) &&
      l.qty > 0 &&
      Number.isFinite(l.price) &&
      l.price >= 0,
  );
  if (!keep.length) return;
  cart = keep.map((l) => ({ ...byId.get(l.productId), ...l })); // current stock and tax flag, the line's own price and quantity
  renderCart();
  toast("Your unfinished sale was restored.");
}
function renderProductTable() {
  if (window.CatalogueUI) return CatalogueUI.render(products);
  $("productTable").innerHTML = products.length
    ? `<table><thead><tr><th>Product</th><th>SKU / barcode</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody>${products
        .slice(0, MAX_ROWS)
        .map(
          (p) =>
            `<tr><td>${esc(p.name)}</td><td>${esc(p.sku || "—")}</td><td>${money(p.price)}</td><td>${p.stock}</td><td><button class="text-button" data-delete="${p.id}" aria-label="Remove ${esc(p.name)}">Remove</button></td></tr>`,
        )
        .join(
          "",
        )}</tbody></table>${products.length > MAX_ROWS ? `<p class="hint">Showing the first ${MAX_ROWS} of ${products.length} products. Use <strong>Export products</strong> below to see them all.</p>` : ""}`
    : '<p class="empty">No products added yet.</p>';
}
async function renderSales() {
  if (window.TxnUI) return TxnUI.render();
  const sales = (await POSDB.all("sales")).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  const refunds =
    typeof RefundCore !== "undefined" ? await POSDB.all("refunds") : [];
  const refundedText = (s) => {
    const m = refunds.length
      ? RefundCore.refundedSoFar(refunds, s.id).minor
      : 0;
    return m > 0 ? " · refunded " + money(m / 100) : "";
  };
  $("salesList").innerHTML = sales.length
    ? sales
        .slice(0, MAX_SALES)
        .map(
          (s) =>
            `<div class="sale-row" data-sale-id="${esc(s.id)}" tabindex="0" role="button"><div><strong>${esc(s.id.slice(0, 18))}</strong><small>${new Date(s.createdAt).toLocaleString()} · ${s.paymentMethod} · ${s.syncStatus}${refundedText(s)}</small></div><strong>${money(s.total)}</strong></div>`,
        )
        .join("") +
      (sales.length > MAX_SALES
        ? `<p class="hint">Showing the newest ${MAX_SALES} of ${sales.length} sales. Older sales are still saved.</p>`
        : "")
    : '<p class="empty">No sales recorded yet.</p>';
}
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
document.addEventListener("click", async (e) => {
  const add = e.target.closest("[data-add]");
  if (add) {
    const p = products.find((x) => x.id === add.dataset.add);
    if (p) {
      const line = cart.find((x) => x.id === p.id);
      if (line) {
        if (line.qty >= MAX_QTY)
          toast("Maximum " + MAX_QTY + " of one item per sale.");
        else line.qty++;
      } else
        cart.push(window.WholesaleUI ? WholesaleUI.line(p) : { ...p, qty: 1 });
      stockWarn(
        p,
        cart.find((x) => x.id === p.id),
      );
      renderCart();
    }
    return;
  }
  const inc = e.target.closest("[data-inc]");
  if (inc) {
    const x = cart.find((x) => x.id === inc.dataset.inc);
    if (x && x.qty >= MAX_QTY)
      toast("Maximum " + MAX_QTY + " of one item per sale.");
    else if (x) {
      x.qty++;
      stockWarn(
        products.find((p) => p.id === (x.productId || x.id)),
        x,
      );
    }
    renderCart();
    return;
  }
  const dec = e.target.closest("[data-dec]");
  if (dec) {
    const x = cart.find((x) => x.id === dec.dataset.dec);
    if (x && --x.qty <= 0) cart = cart.filter((y) => y.id !== x.id);
    renderCart();
    return;
  }
  const del = e.target.closest("[data-delete]");
  if (del) {
    const gone = products.find((x) => x.id === del.dataset.delete);
    await POSDB.remove("products", del.dataset.delete);
    // A product that reached the cloud leaves a removal marker, so the delete can be sent on the next sync.
    if (gone && gone.cloudSyncedAt) {
      const cur =
        (await POSDB.get("settings", "productTombstones"))?.value || [];
      await POSDB.put("settings", {
        key: "productTombstones",
        value: [
          ...cur.filter((t) => t.id !== gone.id),
          { id: gone.id, at: Date.now() },
        ],
      });
    }
    await refresh();
    toast("Product removed");
    return;
  }
  const tab = e.target.closest("[data-view]");
  if (tab) {
    document
      .querySelectorAll(".tab")
      .forEach((x) => x.classList.toggle("active", x === tab));
    document
      .querySelectorAll(".view")
      .forEach((x) => x.classList.add("hidden"));
    $("view-" + tab.dataset.view).classList.remove("hidden");
  }
});
$("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.currentTarget),
    name = String(f.get("name")).trim(),
    price = Number(f.get("price")),
    stock = Number(f.get("stock"));
  if (
    !name ||
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isInteger(stock) ||
    stock < 0
  )
    return toast("Check product details.");
  const ex = window.RetailUI ? RetailUI.productExtras(f) : {};
  if (!ex) return;
  await POSDB.put("products", {
    id: uid(),
    name,
    price,
    stock,
    sku: String(f.get("sku") || "").trim(),
    updatedAt: Date.now(),
    ...ex,
  });
  $("productForm").reset();
  await refresh();
  toast("Product saved on this device.");
});
$("checkout").addEventListener("click", async () => {
  if (!cart.length) return;
  const method = $("paymentMethod").value;
  if (
    !window.CheckoutUI &&
    method !== "cash" &&
    method !== "account" &&
    !confirm(
      "This records a payment method only. It does NOT verify that a digital payment succeeded. Continue?",
    )
  )
    return;
  const total = cart.reduce((n, x) => n + x.price * x.qty, 0),
    sale = {
      id: uid(),
      createdAt: Date.now(),
      currency: (await POSDB.get("settings", "currency"))?.value || "AUD",
      items: cart.map((x) => ({
        productId: x.productId || x.id,
        name: x.name,
        sku: x.sku,
        unitPrice: x.price,
        quantity: x.qty,
        ...(x.packId ? { packId: x.packId, packUnits: x.packUnits } : {}),
      })),
      total,
      paymentMethod: method,
      paymentVerified: method === "cash",
      syncStatus: "pending",
    };
  if (window.RetailUI && !(await RetailUI.decorateSale(sale, cart))) return;
  if (window.CheckoutUI && !CheckoutUI.apply(sale)) return;
  if (window.TxnCore) sale.receiptNo = await TxnCore.nextReceiptNumber(POSDB);
  await POSDB.put("sales", sale);
  for (const line of cart) {
    const p = products.find((x) => x.id === (line.productId || line.id));
    if (p) {
      p.stock = Math.max(0, p.stock - line.qty * (line.packUnits || 1));
      await POSDB.put("products", p);
    }
  }
  cart = [];
  await refresh();
  toast("Sale saved. Receipt: " + (sale.receiptNo || sale.id));
  if (window.CheckoutUI) CheckoutUI.afterSale(sale);
  if (window.RetailUI) RetailUI.afterSale(sale);
  if (window.QuotesUI) await QuotesUI.afterSale(sale);
});
$("clearCart").addEventListener("click", () => {
  cart = [];
  renderCart();
});
$("productSearch").addEventListener("input", renderProducts);
$("paymentMethod").addEventListener("change", renderCart);
$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  await POSDB.put("settings", {
    key: "businessName",
    value: String(f.get("businessName")).trim(),
  });
  await POSDB.put("settings", {
    key: "currency",
    value: String(f.get("currency")).trim().toUpperCase(),
  });
  const url = String(f.get("apiUrl") || "").trim();
  if (url)
    try {
      await GoogleBackend.configure(url);
    } catch (err) {
      toast(err.message);
      return;
    }
  else await POSDB.remove("settings", "apiUrl");
  toast("Settings saved.");
});
$("syncNow").addEventListener("click", async () => {
  try {
    await POSSynchroniser.run();
  } catch (e) {
    toast("Sync not completed: " + e.message);
  }
});
function connection() {
  const online = navigator.onLine;
  $("onlineDot").classList.toggle("online", online);
  $("connectionText").textContent = online
    ? "Internet available"
    : "Offline mode";
  if (!online)
    setSyncUI("Working offline", "Sales remain saved on this device.");
}
window.addEventListener("online", () => {
  connection();
  POSSynchroniser.run().catch(() => {});
});
window.addEventListener("offline", connection);
(async () => {
  await POSDB.open();
  $("year").textContent = new Date().getFullYear();
  await refresh();
  await TierUI.init();
  await RetailUI.init();
  await WholesaleUI.init();
  await InvoiceUI.init();
  await CheckoutUI.init({
    getCart: () => cart,
    setCart: (c) => {
      cart = c;
    },
    render: renderCart,
  });
  await CatalogueUI.init();
  await TxnUI.init();
  await RefundsUI.init();
  await RegisterUI.init();
  await StockUI.init();
  await CsvUI.init();
  await BackupUI.init();
  await CloudReportUI.init();
  await QuotesUI.init();
  await PurchasingUI.init();
  await HelpCentre.init();
  await CloudUI.init();
  await restoreDraft();
  connection();
  if ("serviceWorker" in navigator)
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch(console.error);
})();
