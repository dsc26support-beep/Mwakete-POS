/* Wholesale tier logic (PR 1: trade selling). Pure functions + HTML builders so everything is unit-testable in Node.
 * Prices are stored in MAJOR units (like the rest of the app) and computed in integer minor units (cents).
 * Stock is ALWAYS counted in base units; a pack sale reduces stock by units x quantity.
 * Tax (12.5% by default) is computed here but only applied to invoices/quotes from PR 2 onward.
 * Everything is LOCAL to the device; a server must re-validate totals.
 */
const WholesaleCore = (() => {
  const LIMITS = {
    listName: 40,
    lists: 20,
    packName: 30,
    packs: 5,
    maxUnits: 100000,
    terms: 40,
    taxNumber: 30,
    credit: 1e9,
    maxPrice: 1e9,
  };
  const DEFAULT_TAX_RATE = 12.5;
  const esc = (s) =>
    String(s ?? "").replace(
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
  const toMinor = (n) => Math.round(Number(n) * 100);
  const fromMinor = (m) => m / 100;
  const money = (n) => Number(n || 0).toFixed(2);
  const blank = (v) => v === "" || v === null || v === undefined;

  // A valid price: finite, >= 0, sensible upper bound, at most 2 decimals.
  function parsePrice(raw) {
    if (blank(raw)) return { ok: true, empty: true };
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > LIMITS.maxPrice)
      return { ok: false };
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false };
    return { ok: true, value: Math.round(n * 100) / 100 };
  }

  /* ---------- price lists ---------- */
  function validatePriceList(input, existing = []) {
    const name = String(input?.name ?? "").trim();
    if (!name) return { ok: false, error: "Enter a name for the price list." };
    if (name.length > LIMITS.listName)
      return { ok: false, error: "Price list name is too long." };
    if (
      existing.some((l) => String(l.name).toLowerCase() === name.toLowerCase())
    )
      return {
        ok: false,
        error: "A price list with that name already exists.",
      };
    if (existing.length >= LIMITS.lists)
      return {
        ok: false,
        error:
          "You have reached the limit of " + LIMITS.lists + " price lists.",
      };
    return { ok: true, value: { name } };
  }
  async function addPriceList(store, input, id, now = Date.now()) {
    const existing = await store.all("priceLists");
    const v = validatePriceList(input, existing);
    if (!v.ok) return v;
    const item = Object.assign({ id, createdAt: now }, v.value);
    await store.put("priceLists", item);
    return { ok: true, item };
  }
  const listPriceLists = async (store) =>
    (await store.all("priceLists")).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  // Removing a list never changes the product records: their stored prices for it are simply ignored.
  const removePriceList = (store, id) => store.remove("priceLists", id);

  /* ---------- product extras: per-list prices, packs, tax exempt ---------- */
  // input: {prices:{listId: raw}, packs:[{name,units,price,sku}], taxExempt}
  function validateProductWholesale(input, listIds = []) {
    const out = {};
    const prices = {};
    for (const [lid, raw] of Object.entries(input?.prices || {})) {
      if (!listIds.includes(lid)) continue;
      const p = parsePrice(raw);
      if (!p.ok)
        return {
          ok: false,
          error:
            "Check the price list prices: use a number with at most 2 decimals.",
        };
      if (!p.empty) prices[lid] = p.value;
    }
    if (Object.keys(prices).length) out.prices = prices;
    const packs = [];
    for (const [i, raw] of (input?.packs || []).entries()) {
      const name = String(raw?.name ?? "").trim();
      const empty =
        !name &&
        blank(raw?.units) &&
        blank(raw?.price) &&
        !String(raw?.sku ?? "").trim();
      if (empty) continue;
      if (!name || name.length > LIMITS.packName)
        return {
          ok: false,
          error: "Pack " + (i + 1) + ": enter a short name (e.g. Carton).",
        };
      const units = Number(raw.units);
      if (!Number.isInteger(units) || units < 2 || units > LIMITS.maxUnits)
        return {
          ok: false,
          error:
            "Pack " + (i + 1) + ": units must be a whole number from 2 up.",
        };
      const p = parsePrice(raw.price);
      if (!p.ok)
        return {
          ok: false,
          error:
            "Pack " +
            (i + 1) +
            ": price must be a number with at most 2 decimals.",
        };
      const sku = String(raw.sku ?? "")
        .trim()
        .slice(0, 80);
      packs.push({
        id: String(raw.id || "pack" + (packs.length + 1)),
        name,
        units,
        ...(p.empty ? {} : { price: p.value }),
        ...(sku ? { sku } : {}),
      });
    }
    if (packs.length > LIMITS.packs)
      return {
        ok: false,
        error: "At most " + LIMITS.packs + " pack sizes per product.",
      };
    const skus = packs
      .map((p) => p.sku)
      .filter(Boolean)
      .map((s) => s.toLowerCase());
    if (new Set(skus).size !== skus.length)
      return { ok: false, error: "Two packs have the same barcode." };
    if (packs.length) out.packs = packs;
    if (input?.taxExempt) out.taxExempt = true;
    return { ok: true, value: out };
  }

  /* ---------- price resolution ---------- */
  // Base unit: the customer's price-list price, else the base price.
  // Pack: the pack's own fixed price if set (same for every list), else unit price (list or base) x units.
  function resolvePrice(product, listId, pack) {
    const base = Number(product.price) || 0;
    const listPrice =
      listId &&
      product.prices &&
      Object.prototype.hasOwnProperty.call(product.prices, listId)
        ? Number(product.prices[listId])
        : null;
    const unitMinor = toMinor(listPrice ?? base);
    const unitSource = listPrice !== null ? "list" : "base";
    if (!pack)
      return {
        price: fromMinor(unitMinor),
        source: unitSource,
        usedBasePrice: unitSource === "base" && !!listId,
      };
    if (pack.price !== undefined && pack.price !== null)
      return {
        price: Number(pack.price),
        source: "pack",
        usedBasePrice: false,
      };
    return {
      price: fromMinor(unitMinor * pack.units),
      source: unitSource + "-x-units",
      usedBasePrice: unitSource === "base" && !!listId,
    };
  }
  const packStockUnits = (pack, qty) => (pack ? pack.units : 1) * qty;
  const findPack = (product, packId) =>
    (product.packs || []).find((p) => p.id === packId) || null;
  const findPackBySku = (products, code) => {
    const c = String(code ?? "")
      .trim()
      .toLowerCase();
    if (!c) return null;
    for (const product of products) {
      const pack = (product.packs || []).find(
        (p) =>
          String(p.sku ?? "")
            .trim()
            .toLowerCase() === c,
      );
      if (pack) return { product, pack };
    }
    return null;
  };

  // Cart line for the till. line.id is unique per product+pack; productId always points at the product.
  function buildLine(product, listId, pack) {
    const r = resolvePrice(product, listId, pack);
    return {
      ...product,
      id: pack ? product.id + ":" + pack.id : product.id,
      productId: product.id,
      name: pack
        ? product.name + " (" + pack.name + " x" + pack.units + ")"
        : product.name,
      price: r.price,
      qty: 1,
      ...(pack ? { packId: pack.id, packUnits: pack.units } : {}),
      listId: listId || "",
    };
  }
  // Re-price existing cart lines after the price list changes. Returns new lines; unknown products keep their price.
  function repriceLines(cart, products, listId) {
    return cart.map((line) => {
      const product = products.find(
        (p) => p.id === (line.productId || line.id),
      );
      if (!product) return line;
      const pack = line.packId ? findPack(product, line.packId) : null;
      if (line.packId && !pack) return line;
      return {
        ...line,
        price: resolvePrice(product, listId, pack).price,
        listId: listId || "",
      };
    });
  }

  /* ---------- tax (used by invoices/quotes from PR 2) ---------- */
  function validateTaxRate(raw) {
    if (blank(raw)) return { ok: true, value: DEFAULT_TAX_RATE };
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100)
      return { ok: false, error: "Tax rate must be between 0 and 100." };
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6)
      return { ok: false, error: "Tax rate can have at most 2 decimals." };
    return { ok: true, value: Math.round(n * 100) / 100 };
  }
  // lines: [{price, qty, taxExempt}]. Tax is computed ONCE on the taxable subtotal (round half up, integer cents).
  function computeTaxTotals(lines, rate = DEFAULT_TAX_RATE) {
    const r = validateTaxRate(rate);
    if (!r.ok) return r;
    let subMinor = 0,
      taxableMinor = 0;
    for (const l of lines) {
      const lineMinor = toMinor(l.price) * l.qty;
      subMinor += lineMinor;
      if (!l.taxExempt) taxableMinor += lineMinor;
    }
    const bp = Math.round(r.value * 100); // rate in basis points: 12.5% -> 1250
    const taxMinor = Math.floor((taxableMinor * bp + 5000) / 10000);
    return {
      ok: true,
      rate: r.value,
      subtotal: fromMinor(subMinor),
      taxable: fromMinor(taxableMinor),
      tax: fromMinor(taxMinor),
      total: fromMinor(subMinor + taxMinor),
    };
  }

  /* ---------- trade customers ---------- */
  // extras only; name/phone/notes are validated by RetailCore.validateCustomer.
  function validateTradeExtras(input, listIds = []) {
    if (!input || input.type !== "trade") return { ok: true, value: {} };
    const out = { type: "trade" };
    const lid = String(input.priceListId ?? "");
    if (lid) {
      if (!listIds.includes(lid))
        return { ok: false, error: "Choose a price list from the list." };
      out.priceListId = lid;
    }
    if (!blank(input.creditLimit)) {
      const c = Number(input.creditLimit);
      if (
        !Number.isFinite(c) ||
        c < 0 ||
        c > LIMITS.credit ||
        Math.abs(c * 100 - Math.round(c * 100)) > 1e-6
      )
        return {
          ok: false,
          error: "Credit limit must be 0 or more, with at most 2 decimals.",
        };
      out.creditLimit = Math.round(c * 100) / 100;
    }
    const terms = String(input.terms ?? "").trim();
    if (terms.length > LIMITS.terms)
      return { ok: false, error: "Payment terms are too long." };
    if (terms) out.terms = terms;
    const tax = String(input.taxNumber ?? "").trim();
    if (tax.length > LIMITS.taxNumber)
      return { ok: false, error: "Tax number is too long." };
    if (tax) out.taxNumber = tax;
    return { ok: true, value: out };
  }

  /* ---------- HTML builders (escaped) ---------- */
  function priceListRow(l) {
    return `<div class="resource-row"><div><strong>${esc(l.name)}</strong></div><button class="text-button" data-remove-pricelist="${esc(l.id)}">Remove</button></div>`;
  }
  function packCard(product, pack, price) {
    return `<button class="product-card pack" data-add-pack="${esc(product.id)}" data-pack="${esc(pack.id)}"><strong>${esc(product.name)}</strong><span>${money(price)}</span><small>${esc(pack.name)} x${esc(pack.units)}</small></button>`;
  }
  function tradeBadge(c, listNames) {
    if (c.type !== "trade") return "";
    const bits = ["Trade customer"];
    if (c.priceListId && listNames[c.priceListId])
      bits.push("price list: " + listNames[c.priceListId]);
    if (c.creditLimit !== undefined)
      bits.push("credit limit " + money(c.creditLimit));
    if (c.terms) bits.push(c.terms);
    return `<small>${esc(bits.join(" · "))}</small>`;
  }

  return {
    LIMITS,
    DEFAULT_TAX_RATE,
    esc,
    toMinor,
    fromMinor,
    money,
    parsePrice,
    validatePriceList,
    addPriceList,
    listPriceLists,
    removePriceList,
    validateProductWholesale,
    resolvePrice,
    packStockUnits,
    findPack,
    findPackBySku,
    buildLine,
    repriceLines,
    validateTaxRate,
    computeTaxTotals,
    validateTradeExtras,
    priceListRow,
    packCard,
    tradeBadge,
  };
})();
if (typeof module !== "undefined") module.exports = WholesaleCore;
