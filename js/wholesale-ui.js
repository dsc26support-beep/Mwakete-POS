/* Wholesale screens (PR 1): price lists, pack sizes, trade customers, trade pricing at the till, tax settings.
 * Logic lives in wholesale.js (WholesaleCore). app.js / retail-ui.js call the hooks returned at the bottom.
 * For Counter and Retail every hook is a no-op, so those tiers behave exactly as before.
 * Relies on app.js globals `products`, `cart`, `renderCart`, `renderProducts` and `toast`.
 */
const WholesaleUI = (() => {
  const W = WholesaleCore,
    T = TierCore,
    $ = (id) => document.getElementById(id);
  let tier = T.DEFAULT_TIER,
    lists = [];
  const newId = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : "w-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  const on = (feature) => T.has(tier, feature);
  const names = () => Object.fromEntries(lists.map((l) => [l.id, l.name]));
  const currentList = () => (on("priceTiers") ? $("salePriceList").value : "");

  async function render() {
    tier = await T.getTier(POSDB);
    lists = await W.listPriceLists(POSDB);
    const opts = (first) =>
      `<option value="">${first}</option>` +
      lists
        .map((l) => `<option value="${W.esc(l.id)}">${W.esc(l.name)}</option>`)
        .join("");
    const keep = $("salePriceList").value;
    $("salePriceList").innerHTML = opts("Base price");
    if (lists.some((l) => l.id === keep)) $("salePriceList").value = keep;
    $("customerPriceList").innerHTML = opts("Base price");
    $("priceListList").innerHTML = lists.length
      ? lists.map(W.priceListRow).join("")
      : '<p class="empty">No price lists yet. Add one (for example Trade).</p>';
    $("productPrices").innerHTML = lists
      .map(
        (l) =>
          `<label>${W.esc(l.name)} price<input type="number" min="0" step="0.01" data-list-price="${W.esc(l.id)}" placeholder="Optional"></label>`,
      )
      .join("");
    const [rate, taxNo] = await Promise.all([
      POSDB.get("settings", "taxRate"),
      POSDB.get("settings", "taxNumber"),
    ]);
    $("taxForm").elements.taxRate.value = rate?.value ?? W.DEFAULT_TAX_RATE;
    $("taxForm").elements.taxNumber.value = taxNo?.value ?? "";
    if (typeof renderProducts === "function") renderProducts();
  }

  /* ----- hooks called by app.js / retail-ui.js ----- */

  // Cart line for a base-unit tap.
  function line(p) {
    return on("priceTiers") || on("bulkUnits")
      ? W.buildLine(p, currentList(), null)
      : { ...p, qty: 1 };
  }

  // After the product grid renders: show the selected list's price and add a card per pack size.
  function afterProducts() {
    if (!on("priceTiers") && !on("bulkUnits")) return;
    const listId = currentList();
    document
      .querySelectorAll("#productGrid .product-card[data-add]")
      .forEach((card) => {
        const p = products.find((x) => x.id === card.dataset.add);
        if (!p) return;
        const span = card.querySelector("span");
        if (span && on("priceTiers"))
          span.textContent = W.money(W.resolvePrice(p, listId, null).price);
        if (!on("bulkUnits")) return;
        let anchor = card;
        for (const pack of p.packs || []) {
          anchor.insertAdjacentHTML(
            "afterend",
            W.packCard(p, pack, W.resolvePrice(p, listId, pack).price),
          );
          anchor = anchor.nextElementSibling;
        }
      });
  }

  function addPackLine(productId, packId) {
    const p = products.find((x) => x.id === productId);
    const pack = p && W.findPack(p, packId);
    if (!pack) return false;
    const fresh = W.buildLine(p, currentList(), pack);
    const existing = cart.find((x) => x.id === fresh.id);
    if (existing) existing.qty++;
    else cart.push(fresh);
    renderCart();
    return true;
  }
  async function addPackBySku(code) {
    if (!on("bulkUnits")) return false;
    const hit = W.findPackBySku(await POSDB.all("products"), code);
    return hit ? addPackLine(hit.product.id, hit.pack.id) : false;
  }

  // Product form. null = invalid (already told the user). {} = nothing to add.
  function productExtras() {
    if (!on("priceTiers") && !on("bulkUnits") && !on("tax")) return {};
    const f = $("productForm").elements;
    const prices = {};
    document
      .querySelectorAll("#productPrices [data-list-price]")
      .forEach((i) => (prices[i.dataset.listPrice] = i.value));
    const packs = [1, 2, 3].map((n) => ({
      id: "pack" + n,
      name: f["pack" + n + "Name"].value,
      units: f["pack" + n + "Units"].value,
      price: f["pack" + n + "Price"].value,
      sku: f["pack" + n + "Sku"].value,
    }));
    const v = W.validateProductWholesale(
      {
        prices: on("priceTiers") ? prices : {},
        packs: on("bulkUnits") ? packs : [],
        taxExempt: on("tax") && f.taxExempt.checked,
      },
      lists.map((l) => l.id),
    );
    if (!v.ok) {
      toast(v.error);
      return null;
    }
    return v.value;
  }

  // Customer form (trade fields). null = invalid.
  function customerExtras() {
    if (!on("tradeCustomers")) return {};
    const f = $("customerForm").elements;
    const v = W.validateTradeExtras(
      {
        type: f.customerType.value,
        priceListId: f.priceListId.value,
        creditLimit: f.creditLimit.value,
        terms: f.terms.value,
        taxNumber: f.taxNumber.value,
      },
      lists.map((l) => l.id),
    );
    if (!v.ok) {
      toast(v.error);
      return null;
    }
    return v.value;
  }
  const badge = (c) => W.tradeBadge(c, names());

  function decorateSale(sale) {
    if (on("priceTiers") && $("salePriceList").value)
      sale.priceListId = $("salePriceList").value;
  }
  function afterSale() {
    $("salePriceList").value = "";
    if (typeof renderProducts === "function") renderProducts();
  }

  /* ----- wiring ----- */
  function reprice() {
    cart = W.repriceLines(cart, products, currentList());
    renderCart();
    renderProducts();
  }

  async function init() {
    $("salePriceList").addEventListener("change", reprice);
    // Choosing a trade customer switches the till to that customer's price list.
    $("saleCustomer").addEventListener("change", async (e) => {
      if (!on("priceTiers") || !e.target.value) return;
      const c = await POSDB.get("customers", e.target.value);
      if (c && c.type === "trade") {
        $("salePriceList").value = lists.some((l) => l.id === c.priceListId)
          ? c.priceListId
          : "";
        reprice();
      }
    });
    $("priceListForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const r = await W.addPriceList(
        POSDB,
        { name: form.elements.name.value },
        newId(),
      );
      if (!r.ok) return toast(r.error);
      form.reset();
      await render();
      toast("Price list saved on this device.");
    });
    $("taxForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget.elements;
      const rate = W.validateTaxRate(f.taxRate.value);
      if (!rate.ok) return toast(rate.error);
      const num = String(f.taxNumber.value).trim();
      if (num.length > W.LIMITS.taxNumber)
        return toast("Tax number is too long.");
      await POSDB.put("settings", { key: "taxRate", value: rate.value });
      await POSDB.put("settings", { key: "taxNumber", value: num });
      toast("Tax settings saved.");
    });
    document.addEventListener("click", async (e) => {
      const pk = e.target.closest("[data-add-pack]");
      if (pk) return void addPackLine(pk.dataset.addPack, pk.dataset.pack);
      const rm = e.target.closest("[data-remove-pricelist]");
      if (
        rm &&
        confirm(
          "Remove this price list? Prices you entered for it are kept but no longer used.",
        )
      ) {
        await W.removePriceList(POSDB, rm.dataset.removePricelist);
        if ($("salePriceList").value === rm.dataset.removePricelist)
          $("salePriceList").value = "";
        await render();
        if (window.RetailUI) RetailUI.render();
      }
    });
    await render();
  }

  return {
    init,
    render,
    line,
    afterProducts,
    productExtras,
    customerExtras,
    badge,
    decorateSale,
    afterSale,
    addPackBySku,
  };
})();
window.WholesaleUI = WholesaleUI;
