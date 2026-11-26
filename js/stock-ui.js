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
    await renderTake();
    await renderHistory();
  }

  /* ---------- everything that changed the selected product's stock ---------- */
  async function renderHistory() {
    const id = form().product.value;
    if (!id)
      return ($("productHistoryList").innerHTML =
        '<p class="empty">Choose a product.</p>');
    const [moves, sales, refunds] = await Promise.all([
      POSDB.all("stockMoves"),
      POSDB.all("sales"),
      typeof RefundCore !== "undefined" ? POSDB.all("refunds") : [],
    ]);
    const returns = [];
    for (const r of refunds)
      if (typeof RefundCore !== "undefined")
        for (const u of RefundCore.restockUnits(r))
          if (u.productId === id)
            returns.push({
              id: r.id,
              productId: id,
              units: u.units,
              at: r.createdAt,
              number: r.number,
            });
    const h = S.history(id, moves, sales, returns).slice(0, 60);
    $("productHistoryList").innerHTML = h.length
      ? h
          .map(
            (e) =>
              `<div class="sale-row"><div><strong>${esc(e.text)}</strong><small>${esc(new Date(e.at).toLocaleString())}${e.note ? " · " + esc(e.note) : ""}${e.device ? " · device " + esc(e.device) : ""}</small></div><strong>${esc(S.deltaText(e.delta))}</strong></div>`,
          )
          .join("")
      : '<p class="empty">Nothing recorded for this product yet.</p>';
  }

  /* ---------- stock take ---------- */
  const counts = {};
  function readCounts() {
    for (const i of document.querySelectorAll("#takeTable [data-take]"))
      counts[i.dataset.take] = i.value;
    return counts;
  }
  async function renderTake() {
    const q = $("takeFilter").value.toLowerCase().trim();
    const list = products
      .filter(
        (p) =>
          !p.archived &&
          (!q || (p.name + " " + (p.sku || "")).toLowerCase().includes(q)),
      )
      .slice(0, 200);
    readCounts();
    $("takeTable").innerHTML = list.length
      ? `<table><thead><tr><th>Product</th><th>On record</th><th>Counted</th></tr></thead><tbody>${list
          .map(
            (p) =>
              `<tr><td>${esc(p.name)}</td><td>${Number(p.stock) || 0}</td><td><input type="number" inputmode="numeric" min="0" step="1" data-take="${esc(p.id)}" value="${esc(counts[p.id] ?? "")}" aria-label="Counted ${esc(p.name)}"></td></tr>`,
          )
          .join("")}</tbody></table>`
      : '<p class="empty">No products to count.</p>';
  }
  function takeResult() {
    readCounts();
    return S.stockTake(products, counts);
  }
  function showTake() {
    const t = takeResult();
    $("takeSummary").textContent = !t.rows.length
      ? "Nothing counted yet."
      : (t.errors ? t.errors + " count(s) are not whole numbers. " : "") +
        t.rows.filter((r) => r.variance).length +
        " product(s) differ: short " +
        t.shortUnits +
        ", over " +
        t.overUnits +
        (t.varianceValueAtCost
          ? ", worth " + Number(t.varianceValueAtCost).toFixed(2) + " at cost"
          : "") +
        ".";
    return t;
  }
  async function applyTake() {
    const t = showTake();
    if (!t.rows.length) return toast("Enter at least one count.");
    const dev = (await POSDB.get("settings", "deviceCode"))?.value;
    const r = S.stockTakeMoves(products, counts, {
      idFor: () => uid(),
      note: "Stock take " + new Date().toLocaleDateString(),
      deviceId: dev,
    });
    if (!r.ok) return toast(r.error);
    if (!r.moves.length)
      return toast("Every count matches the record. Nothing to change.");
    if (
      !confirm(
        "Change the stock of " +
          r.moves.length +
          " product(s) to the counted numbers?",
      )
    )
      return;
    for (const m of r.moves) {
      const p = await POSDB.get("products", m.move.productId); // re-read: a sale may just have changed it
      await POSDB.put("stockMoves", m.move); // the movement is saved before the stock changes
      await POSDB.put("products", { ...p, stock: m.newStock });
    }
    for (const k of Object.keys(counts)) delete counts[k];
    if (window.Audit)
      Audit.log(
        "product-bulk",
        "Stock take: " + r.moves.length + " product(s) counted",
      );
    toast("Stock take applied to " + r.moves.length + " product(s).");
    if (typeof refresh === "function") await refresh();
    await render();
    $("takeSummary").textContent = "";
  }

  async function init() {
    if (!$("view-stock")) return;
    $("stockForm").addEventListener("input", preview);
    $("stockProduct").addEventListener("change", renderHistory);
    $("takeFilter").addEventListener("input", renderTake);
    $("takeCheck").addEventListener("click", showTake);
    $("takeApply").addEventListener("click", applyTake);
    $("takeCsv").addEventListener("click", () => {
      const t = takeResult();
      if (!t.rows.length) return toast("Enter at least one count.");
      const url = URL.createObjectURL(
        new Blob(["﻿" + S.stockTakeCsv(t)], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download =
        "stock-take-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
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
      const dev = (await POSDB.get("settings", "deviceCode"))?.value;
      if (dev) r.value.deviceId = dev; // which till made the change
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
