/* Retail tier logic: discounts, low stock, barcode lookup, customers, receipts, reports.
 * Pure functions + HTML builders (all dynamic text escaped) so everything is unit-testable in Node.
 * Money is computed in integer minor units (cents) to avoid float drift. Assumes a 2-decimal currency.
 * Everything here is LOCAL to the device. Totals and discounts computed here must be re-validated by the server.
 */
const RetailCore = (() => {
  const LIMITS = {
    name: 80,
    phone: 20,
    notes: 300,
    category: 40,
    customers: 5000,
    reorder: 1000000,
    top: 10,
  };
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

  /* ---------- discounts ---------- */
  function cartSubtotalMinor(cart) {
    return cart.reduce((n, x) => n + toMinor(x.price) * x.qty, 0);
  }
  // input: {type:"none"|"percent"|"fixed", value}. Returns amounts in major units.
  function computeTotals(cart, input) {
    const subMinor = cartSubtotalMinor(cart);
    const type = input?.type;
    const raw = input?.value;
    const empty = raw === "" || raw === null || raw === undefined;
    if (!type || type === "none" || empty)
      return {
        ok: true,
        subtotal: fromMinor(subMinor),
        discount: null,
        total: fromMinor(subMinor),
      };
    if (type !== "percent" && type !== "fixed")
      return { ok: false, error: "Unknown discount type." };
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0)
      return { ok: false, error: "Enter a valid discount." };
    if (value === 0)
      return {
        ok: true,
        subtotal: fromMinor(subMinor),
        discount: null,
        total: fromMinor(subMinor),
      };
    let amountMinor;
    if (type === "percent") {
      if (value > 100)
        return {
          ok: false,
          error: "A percentage discount cannot be more than 100%.",
        };
      amountMinor = Math.round((subMinor * value) / 100);
    } else {
      amountMinor = toMinor(value);
      if (amountMinor > subMinor)
        return {
          ok: false,
          error: "The discount cannot be more than the sale total.",
        };
    }
    return {
      ok: true,
      subtotal: fromMinor(subMinor),
      discount: { type, value, amount: fromMinor(amountMinor) },
      total: fromMinor(subMinor - amountMinor),
    };
  }

  /* ---------- products ---------- */
  function validateProductExtras(input) {
    const category = String(input?.category ?? "").trim();
    if (category.length > LIMITS.category)
      return { ok: false, error: "Category name is too long." };
    const out = {};
    if (category) out.category = category;
    const rl = input?.reorderLevel;
    if (rl !== "" && rl !== null && rl !== undefined) {
      const n = Number(rl);
      if (!Number.isInteger(n) || n < 0 || n > LIMITS.reorder)
        return {
          ok: false,
          error: "Reorder level must be a whole number, 0 or more.",
        };
      out.reorderLevel = n;
    }
    return { ok: true, value: out };
  }
  function lowStock(products) {
    return products
      .filter(
        (p) =>
          Number.isInteger(p.reorderLevel) && Number(p.stock) <= p.reorderLevel,
      )
      .sort(
        (a, b) =>
          Number(a.stock) - Number(b.stock) ||
          String(a.name).localeCompare(String(b.name)),
      );
  }
  // Exact barcode / SKU match (what a keyboard-style scanner types before Enter).
  function findBySku(products, code) {
    const c = String(code ?? "")
      .trim()
      .toLowerCase();
    if (!c) return null;
    return (
      products.find(
        (p) =>
          String(p.sku ?? "")
            .trim()
            .toLowerCase() === c,
      ) || null
    );
  }

  /* ---------- customers (local only, never synced) ---------- */
  function validateCustomer(input) {
    const name = String(input?.name ?? "").trim();
    if (!name) return { ok: false, error: "Enter the customer's name." };
    if (name.length > LIMITS.name)
      return { ok: false, error: "Name is too long." };
    const phone = String(input?.phone ?? "").trim();
    if (phone && !/^\+?[0-9 ()-]{5,20}$/.test(phone))
      return {
        ok: false,
        error: "Enter a valid phone number or leave it empty.",
      };
    const notes = String(input?.notes ?? "").trim();
    if (notes.length > LIMITS.notes)
      return {
        ok: false,
        error: "Note is too long (max " + LIMITS.notes + " characters).",
      };
    const email = String(input?.email ?? "").trim();
    if (
      email &&
      (email.length > 120 ||
        !/^[^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{2,}$/.test(email))
    )
      return {
        ok: false,
        error: "Enter a valid email address or leave it empty.",
      };
    const address = String(input?.address ?? "").trim();
    if (address.length > 120)
      return { ok: false, error: "Address is too long (max 120 characters)." };
    const category = String(input?.category ?? "").trim();
    if (category.length > 30)
      return {
        ok: false,
        error: "Customer group is too long (max 30 characters).",
      };
    const value = { name, phone, notes };
    if (email) value.email = email;
    if (address) value.address = address;
    if (category) value.category = category;
    return { ok: true, value };
  }
  async function addCustomer(store, input, id, now = Date.now()) {
    const v = validateCustomer(input);
    if (!v.ok) return v;
    const all = await store.all("customers");
    if (all.length >= LIMITS.customers)
      return { ok: false, error: "Customer limit reached." };
    const item = Object.assign({ id, createdAt: now }, v.value);
    await store.put("customers", item);
    return { ok: true, item };
  }
  const listCustomers = async (store) =>
    (await store.all("customers")).sort((a, b) => a.name.localeCompare(b.name));
  const removeCustomer = (store, id) => store.remove("customers", id);

  /* ---------- receipt ---------- */
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtDate = (ms) => {
    const d = new Date(ms);
    return (
      d.getFullYear() +
      "-" +
      pad2(d.getMonth() + 1) +
      "-" +
      pad2(d.getDate()) +
      " " +
      pad2(d.getHours()) +
      ":" +
      pad2(d.getMinutes())
    );
  };
  const WIDTH = 32;
  const PAY_LABEL = {
    eftpos: "EFTPOS/card",
    internet_banking: "Internet banking",
    mpaisa: "M-PAiSA",
    other: "Other",
  };
  const row = (left, right) => {
    const l = String(left),
      r = String(right);
    const room = WIDTH - r.length - 1;
    return (
      (l.length > room ? l.slice(0, Math.max(0, room)) : l.padEnd(room)) +
      " " +
      r
    );
  };
  function buildReceiptText(sale, business, customer) {
    const cur = sale.currency || "";
    const lines = [
      String(business || "Mwakete POS"),
      "Receipt: " +
        (sale.receiptNo
          ? sale.receiptNo + " (" + sale.id.slice(0, 8) + ")"
          : sale.id),
      "Date: " + fmtDate(sale.createdAt),
    ];
    if (customer?.name) lines.push("Customer: " + customer.name);
    lines.push("-".repeat(WIDTH));
    for (const it of sale.items || []) {
      lines.push(
        row(it.quantity + " x " + it.name, money(it.unitPrice * it.quantity)),
      );
    }
    lines.push("-".repeat(WIDTH));
    const sub = sale.subtotal ?? sale.total;
    if (sale.discount && sale.discount.amount > 0) {
      lines.push(row("Subtotal", money(sub)));
      const label =
        sale.discount.type === "percent"
          ? "Discount (" + sale.discount.value + "%)"
          : "Discount";
      lines.push(row(label, "-" + money(sale.discount.amount)));
    }
    lines.push(row("TOTAL " + cur, money(sale.total)));
    if (Array.isArray(sale.payments) && sale.payments.length) {
      for (const p of sale.payments) {
        lines.push(
          row(
            p.method === "cash"
              ? "Cash"
              : (PAY_LABEL[p.method] || p.method) + " (NOT verified)",
            money(p.amount),
          ),
        );
        if (p.reference) lines.push("  ref " + p.reference);
      }
      if (sale.tendered !== undefined) {
        lines.push(row("Cash received", money(sale.tendered)));
        lines.push(row("Change", money(sale.change || 0)));
      }
    } else
      lines.push(
        sale.paymentMethod === "cash"
          ? "Paid: Cash"
          : "Payment: " + sale.paymentMethod + " (recorded, NOT verified)",
      );
    lines.push(
      "Status: " + (sale.syncStatus || "pending") + " (saved on this device)",
    );
    return lines.join("\n");
  }

  /* ---------- reports (this device only) ---------- */
  const dayKey = (ms) => {
    const d = new Date(ms);
    return (
      d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
    );
  };
  function salesReport(sales, products) {
    const catById = Object.fromEntries(
      (products || []).map((p) => [p.id, p.category]),
    );
    const days = new Map(),
      cats = new Map(),
      tops = new Map();
    let totalMinor = 0;
    for (const s of sales || []) {
      // Reports exclude tax (Wholesale invoices store sale.tax; sale.total is the gross amount owed).
      const tMinor = toMinor(s.total) - toMinor(s.tax || 0);
      totalMinor += tMinor;
      const k = dayKey(s.createdAt);
      const d = days.get(k) || { day: k, count: 0, totalMinor: 0 };
      d.count++;
      d.totalMinor += tMinor;
      days.set(k, d);
      for (const it of s.items || []) {
        const lineMinor = toMinor(it.unitPrice) * it.quantity;
        const cat = it.category || catById[it.productId] || "Uncategorised";
        const c = cats.get(cat) || { category: cat, qty: 0, totalMinor: 0 };
        c.qty += it.quantity;
        c.totalMinor += lineMinor;
        cats.set(cat, c);
        const tk = it.productId || it.name;
        const t = tops.get(tk) || { name: it.name, qty: 0, totalMinor: 0 };
        t.qty += it.quantity;
        t.totalMinor += lineMinor;
        tops.set(tk, t);
      }
    }
    const fin = (m) => ({ ...m, total: fromMinor(m.totalMinor) });
    const stockMinor = (products || []).reduce(
      (n, p) => n + toMinor(p.price) * (Number(p.stock) || 0),
      0,
    );
    return {
      salesCount: (sales || []).length,
      total: fromMinor(totalMinor),
      byDay: [...days.values()]
        .sort((a, b) => a.day.localeCompare(b.day))
        .map(fin),
      byCategory: [...cats.values()]
        .sort((a, b) => b.totalMinor - a.totalMinor)
        .map(fin),
      topProducts: [...tops.values()]
        .sort((a, b) => b.qty - a.qty || b.totalMinor - a.totalMinor)
        .slice(0, LIMITS.top)
        .map(fin),
      stockValue: fromMinor(stockMinor),
    };
  }

  /* ---------- HTML builders ---------- */
  function lowStockPanel(list) {
    if (!list.length)
      return '<p class="empty">No products at or below their reorder level.</p>';
    return list
      .map(
        (p) =>
          `<div class="resource-row"><div><strong>${esc(p.name)}</strong><small>${esc(p.category || "Uncategorised")} · reorder at ${esc(p.reorderLevel)}</small></div><strong class="low">${esc(p.stock)} left</strong></div>`,
      )
      .join("");
  }
  // `extraHtml` is pre-escaped HTML from a trusted builder (e.g. the Wholesale trade badge).
  function customerRow(c, extraHtml = "") {
    return `<div class="resource-row"><div><strong>${esc(c.name)}</strong>${c.phone ? `<small>${esc(c.phone)}</small>` : ""}${c.email ? `<small>${esc(c.email)}</small>` : ""}${c.category ? `<small>Group: ${esc(c.category)}</small>` : ""}${c.address ? `<small>${esc(c.address)}</small>` : ""}${extraHtml}${c.notes ? `<p class="note-text">${esc(c.notes)}</p>` : ""}</div><button class="text-button" data-remove-customer="${esc(c.id)}">Remove</button></div>`;
  }
  function table(head, rows) {
    return rows.length
      ? `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      : '<p class="empty">No data yet.</p>';
  }
  function reportHtml(r, currency) {
    const cur = esc(currency || "");
    return (
      `<p class="hint">Calculated from sales saved on <strong>this device</strong>. This is not the cloud ledger. Totals exclude tax.</p>` +
      `<div class="stat-row"><div><small>Sales</small><strong>${esc(r.salesCount)}</strong></div><div><small>Total ${cur}</small><strong>${money(r.total)}</strong></div><div><small>Stock value ${cur}</small><strong>${money(r.stockValue)}</strong></div></div>` +
      `<h3>By day</h3>` +
      table(
        ["Day", "Sales", "Total"],
        r.byDay.map((d) => [d.day, d.count, money(d.total)]),
      ) +
      `<h3>By category</h3>` +
      table(
        ["Category", "Units", "Total"],
        r.byCategory.map((c) => [c.category, c.qty, money(c.total)]),
      ) +
      `<h3>Top products</h3>` +
      table(
        ["Product", "Units", "Total"],
        r.topProducts.map((t) => [t.name, t.qty, money(t.total)]),
      )
    );
  }
  const receiptHtml = (text) => `<pre class="receipt">${esc(text)}</pre>`;

  return {
    LIMITS,
    esc,
    money,
    toMinor,
    fromMinor,
    computeTotals,
    validateProductExtras,
    lowStock,
    findBySku,
    validateCustomer,
    addCustomer,
    listCustomers,
    removeCustomer,
    buildReceiptText,
    dayKey,
    salesReport,
    lowStockPanel,
    customerRow,
    reportHtml,
    receiptHtml,
  };
})();
if (typeof module !== "undefined") module.exports = RetailCore;
