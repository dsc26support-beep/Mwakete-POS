/* Checkout screen: cash received + change due, payment reference, split payment, hold / resume sales.
 * Logic lives in checkout.js (CheckoutCore). Nothing here verifies a digital payment. */
const CheckoutUI = (() => {
  const C = CheckoutCore,
    $ = (id) => document.getElementById(id),
    fmt = (n) => Number(n || 0).toFixed(2);
  const esc = (s) =>
    String(s).replace(
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
  let held = [];
  let rounding = 0; // cash rounding step from the settings: 0, 0.05 or 0.1
  let hooks = { getCart: () => [], setCart: () => {}, render: () => {} };

  // The visible total already includes any discount, so read it from the screen.
  const cartTotal = () => Number($("total").textContent) || 0;

  function splitActive() {
    return $("splitOn").checked;
  }
  function lines(total) {
    const method = $("paymentMethod").value;
    const out = [];
    const main = { method };
    if (method === "cash") {
      const t = $("cashTendered").value;
      if (t !== "") main.tendered = Number(t);
    } else {
      main.reference = $("payRef").value;
    }
    if (splitActive()) {
      const m = $("splitMethod").value;
      if (m === method)
        return { error: "Choose a different method for the second payment." };
      out.push({
        method: m,
        amount:
          $("splitAmount").value === "" ? "" : Number($("splitAmount").value),
        reference: $("splitRef").value,
      });
    }
    out.unshift(main);
    return { lines: out, total };
  }

  /* Live change display under the cash box. */
  function updateChange() {
    const method = $("paymentMethod").value;
    const account = method === "account";
    $("tenderRow").classList.toggle("hidden", method !== "cash");
    $("refRow").classList.toggle("hidden", method === "cash" || account);
    $("splitOn").closest(".retail-box").classList.toggle("hidden", account);
    $("splitBox").classList.toggle("hidden", !splitActive() || account);
    const out = $("changeDue");
    const total = cartTotal();
    if (method !== "cash" || !hooks.getCart().length) {
      out.textContent = "";
      return;
    }
    if (splitActive()) {
      out.textContent = "";
      return;
    }
    const t = $("cashTendered").value;
    const due = C.roundCash(total, rounding);
    if (t === "") {
      out.textContent =
        due !== total
          ? "Cash due " +
            fmt(due) +
            " (rounded from " +
            fmt(total) +
            "). No change due."
          : "Exact amount. No change due.";
      return;
    }
    const r = C.changeDue(due, Number(t));
    out.textContent = r.ok
      ? "Change due: " + fmt(r.change)
      : r.short !== undefined
        ? "Short by " + fmt(r.short)
        : r.error;
  }

  /* Called by app.js after the sale's final total is known. Returns false to cancel the sale. */
  function apply(sale) {
    if (sale.paymentMethod === "account") return true;
    const l = lines(sale.total);
    if (l.error) {
      toast(l.error);
      return false;
    }
    const r = C.build(sale.total, l.lines, { rounding });
    if (!r.ok) {
      toast(r.error);
      return false;
    }
    if (
      r.paymentMethod !== "cash" &&
      !r.payments.every((p) => p.method === "cash") &&
      !confirm(
        "This records a payment method only. It does NOT verify that a digital payment succeeded. Continue?",
      )
    )
      return false;
    sale.paymentMethod = r.paymentMethod;
    sale.paymentVerified = r.paymentVerified;
    sale.payments = r.payments;
    if (r.tendered !== undefined) {
      sale.tendered = r.tendered;
      sale.change = r.change;
    }
    if (r.rounding !== undefined) sale.rounding = r.rounding;
    return true;
  }
  function afterSale(sale) {
    $("cashTendered").value = "";
    $("payRef").value = "";
    $("splitOn").checked = false;
    $("splitAmount").value = "";
    $("splitRef").value = "";
    updateChange();
    if (sale && sale.change > 0) toast("Change due: " + fmt(sale.change));
    // Lets other screens offer "send the receipt" for the sale that was just made.
    if (sale)
      document.dispatchEvent(
        new CustomEvent("pos:sale", { detail: { id: sale.id } }),
      );
  }

  /* ---------- hold / resume ---------- */
  async function loadHeld() {
    const v = (await POSDB.get("settings", "heldSales"))?.value;
    held = Array.isArray(v) ? v : [];
    $("heldCount").textContent = held.length;
  }
  async function saveHeld() {
    await POSDB.put("settings", { key: "heldSales", value: held });
    $("heldCount").textContent = held.length;
  }
  async function hold() {
    const cart = hooks.getCart();
    const cust =
      window.RetailUI && $("saleCustomer") ? $("saleCustomer").value : "";
    const m = C.makeHold(cart, {
      id:
        "h" + Date.now().toString(36) + Math.random().toString(16).slice(2, 6),
      customerId: cust,
    });
    if (!m.ok) return toast(m.error);
    const a = C.addHold(held, m.hold);
    if (!a.ok) return toast(a.error);
    held = a.list;
    await saveHeld();
    hooks.setCart([]);
    hooks.render();
    toast("Sale put on hold (" + held.length + " held).");
  }
  function renderHeld() {
    $("heldList").innerHTML = held.length
      ? held
          .map(
            (h) =>
              `<div class="cart-line"><div><strong>${esc(h.label || new Date(h.createdAt).toLocaleTimeString())}</strong><small>${h.items.length} item(s) · ${fmt(h.total)}</small></div><div class="row-actions"><button class="button secondary" type="button" data-resume="${esc(h.id)}">Resume</button><button class="button secondary" type="button" data-discard="${esc(h.id)}">Discard</button></div></div>`,
          )
          .join("")
      : '<p class="empty">No sales are on hold.</p>';
  }
  function openHeld() {
    renderHeld();
    $("heldPanel").classList.remove("hidden");
    const b = $("heldList").querySelector("button") || $("heldClose");
    b.focus();
  }
  async function resume(id) {
    if (hooks.getCart().length) {
      toast("Finish or hold the sale in the cart first.");
      return;
    }
    const h = held.find((x) => x.id === id);
    if (!h) return;
    const prods = await POSDB.all("products");
    const r = C.resumeLines(h, prods);
    held = C.removeHold(held, id);
    await saveHeld();
    hooks.setCart(r.lines);
    hooks.render();
    $("heldPanel").classList.add("hidden");
    toast(
      r.dropped.length
        ? "Sale resumed. Removed (no longer sold): " + r.dropped.join(", ")
        : "Sale resumed.",
    );
  }

  function bind() {
    $("paymentMethod").addEventListener("change", updateChange);
    $("cashTendered").addEventListener("input", updateChange);
    $("splitOn").addEventListener("change", updateChange);
    $("holdSale").addEventListener("click", hold);
    $("resumeSale").addEventListener("click", openHeld);
    $("heldClose").addEventListener("click", () =>
      $("heldPanel").classList.add("hidden"),
    );
    $("heldList").addEventListener("click", async (e) => {
      const r = e.target.closest("[data-resume]");
      const d = e.target.closest("[data-discard]");
      if (r) await resume(r.dataset.resume);
      if (d && confirm("Discard this held sale? It cannot be recovered.")) {
        held = C.removeHold(held, d.dataset.discard);
        await saveHeld();
        renderHeld();
      }
    });
  }
  /* Offer only the payment methods this business accepts (set in the set-up card). Older installs offer all of them. */
  async function loadRounding() {
    const v = Number((await POSDB.get("settings", "cashRounding"))?.value) || 0;
    rounding = C.STEPS.includes(v) ? v : 0;
    updateChange();
  }
  async function applyMethods() {
    const on = OnboardingCore.enabledMethods(
      (await POSDB.get("settings", "payMethods"))?.value,
    );
    for (const id of ["paymentMethod", "splitMethod"])
      for (const o of $(id).options) {
        if (o.value === "account") continue;
        const allowed = on.includes(o.value);
        o.disabled = !allowed;
        o.hidden = !allowed;
      }
    for (const id of ["paymentMethod", "splitMethod"]) {
      const s = $(id);
      if (s.selectedOptions[0]?.disabled)
        s.value = [...s.options].find((o) => !o.disabled)?.value || "cash";
    }
    updateChange();
  }
  async function init(h) {
    hooks = { ...hooks, ...h };
    bind();
    await loadRounding();
    await applyMethods();
    await loadHeld();
    updateChange();
  }
  function afterCart(cart) {
    $("holdSale").disabled = !cart.length;
    updateChange();
  }
  return {
    init,
    apply,
    afterSale,
    afterCart,
    updateChange,
    applyMethods,
    loadRounding,
  };
})();
if (typeof window !== "undefined") window.CheckoutUI = CheckoutUI;
