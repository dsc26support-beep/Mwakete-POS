/* Stock screen: change stock by hand with a recorded reason, and read the movement history.
 * Logic lives in stock.js (StockCore). The movement is saved BEFORE the product's stock changes, so there is always a record. */
const StockUI = (() => {
  const S = StockCore,
    $ = (id) => document.getElementById(id);
  let products = [];

  const form = () => $("stockForm").elements;
  const product = () => products.find((p) => p.id === form().product.value);

  function preview() {
    const out = $("stockPreview");
    const f = form();
    $("stockQtyLabel").textContent =
      f.action.value === "count" ? "Number on the shelf now" : "Quantity";
    if (!product() || f.qty.value === "") {
      out.textContent = "";
      return null;
    }
    const r = S.buildMove(product(), f.action.value, f.qty.value, {
      note: f.note.value,
    });
    out.textContent = r.ok
      ? product().name +
        ": " +
        (Number(product().stock) || 0) +
        " → " +
        r.newStock +
        " (" +
        S.deltaText(r.value.delta) +
        ")"
      : r.error;
    return r.ok ? r : null;
  }

  async function render() {
    if (!$("view-stock")) return;
    products = (await POSDB.all("products")).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const keepP = $("stockProduct").value;
    $("stockProduct").innerHTML = products.length
      ? products
          .map(
            (p) =>
              `<option value="${esc(p.id)}">${esc(p.name)} (${Number(p.stock) || 0} in stock)</option>`,
          )
          .join("")
      : '<option value="">Add a product first</option>';
    if (products.some((p) => p.id === keepP)) $("stockProduct").value = keepP;
    if (!$("stockAction").options.length)
      $("stockAction").innerHTML = Object.entries(S.ACTIONS)
        .map(([k, a]) => `<option value="${k}">${esc(a.label)}</option>`)
        .join("");
    const byId = new Map(products.map((p) => [p.id, p]));
    const moves = (await POSDB.all("stockMoves"))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 40);
    $("stockMoves").innerHTML = moves.length
      ? moves
          .map(
            (m) =>
              `<div class="sale-row"><div><strong>${esc(m.productName || byId.get(m.productId)?.name || "Product")}</strong><small>${esc(new Date(m.createdAt).toLocaleString())} · ${esc(S.REASONS[m.reason] || m.reason)}${m.note ? " · " + esc(m.note) : ""} · ${m.syncStatus === "synced" ? "Backed up" : m.syncStatus === "rejected" ? "Refused by the cloud" : "Not yet backed up"}</small></div><strong>${esc(S.deltaText(m.delta))}</strong></div>`,
          )
          .join("")
      : '<p class="empty">No stock changes recorded yet.</p>';
    preview();
  }

  async function init() {
    if (!$("view-stock")) return;
    $("stockForm").addEventListener("input", preview);
    $("stockForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const formEl = e.currentTarget; // currentTarget is null after an await
      const f = formEl.elements;
      const p = await POSDB.get("products", f.product.value); // re-read: a sale may just have changed it
      const r = S.buildMove(p, f.action.value, f.qty.value, {
        id: uid(),
        note: f.note.value,
      });
      if (!r.ok) return toast(r.error);
      await POSDB.put("stockMoves", r.value);
      await POSDB.put("products", { ...p, stock: r.newStock }); // stock only: the catalogue timestamp is untouched
      formEl.elements.qty.value = "";
      formEl.elements.note.value = "";
      toast(p.name + " is now " + r.newStock + " in stock.");
      if (typeof refresh === "function") await refresh();
      await render();
      if (typeof POSSynchroniser !== "undefined" && navigator.onLine)
        POSSynchroniser.run().catch(() => {});
    });
    await render();
  }
  return { init, render };
})();
window.StockUI = StockUI;
