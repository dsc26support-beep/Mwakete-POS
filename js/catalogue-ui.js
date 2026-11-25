/* Product list screen: search/filter, availability badges, edit dialog (description, cost, unit, picture, archive),
 * bulk edits, stock valuation and out-of-stock alerts. Logic lives in catalogue.js (CatalogueCore).
 * Cost price and pictures stay on this device; they are never sent to the cloud. */
const CatalogueUI = (() => {
  const K = CatalogueCore,
    $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toFixed(2);
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
  const MAX_ROWS = 200;
  let all = [];
  let editing = null;
  let pendingImage; // undefined = untouched, string = new picture
  const selected = new Set();

  const opts = () => ({
    q: $("prodFilterText").value,
    category: $("prodFilterCat").value,
    availability: $("prodFilterAvail").value,
  });

  function renderFilters() {
    const cur = $("prodFilterCat").value;
    $("prodFilterCat").innerHTML =
      '<option value="">All categories</option><option value="__none__">No category</option>' +
      K.categories(all)
        .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
        .join("");
    $("prodFilterCat").value = [...$("prodFilterCat").options].some(
      (o) => o.value === cur,
    )
      ? cur
      : "";
  }

  function renderSummary() {
    const out = all.filter((p) => K.availability(p) === "out").length;
    const low = all.filter((p) => K.availability(p) === "low").length;
    $("stockAlerts").textContent =
      out || low
        ? `${out} out of stock · ${low} low stock (counts are kept on this device).`
        : "No stock alerts.";
    const v = K.valuation(all);
    $("stockValue").textContent =
      `Stock on hand: ${v.units} unit(s) worth ${fmt(v.retailValue)} at selling price` +
      (v.costedProducts
        ? `; ${fmt(v.costValue)} at cost` +
          (v.missingCost
            ? ` (${v.missingCost} stocked product(s) have no cost price and are left out of the cost figure).`
            : ".")
        : ". Add cost prices to see stock value at cost.");
  }

  function renderTable() {
    const list = K.filter(all, opts());
    const shown = list.slice(0, MAX_ROWS);
    for (const id of [...selected])
      if (!all.some((p) => p.id === id)) selected.delete(id);
    $("productTable").innerHTML = list.length
      ? `<table><thead><tr><th><span class="sr-only">Select</span></th><th>Product</th><th>SKU / barcode</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody>${shown
          .map((p) => {
            const a = K.availability(p);
            return `<tr><td data-owner-only><input type="checkbox" data-sel="${esc(p.id)}" aria-label="Select ${esc(p.name)}"${selected.has(p.id) ? " checked" : ""}></td><td>${K.validImage(p.image) ? `<img class="thumb" src="${esc(p.image)}" alt="">` : ""}${esc(p.name)}${p.unit && p.unit !== "each" ? ` <small>per ${esc(p.unit)}</small>` : ""}</td><td>${esc(p.sku || "—")}</td><td>${fmt(p.price)}</td><td>${esc(p.stock)}</td><td>${a === "available" ? "" : `<span class="badge ${a}">${K.AVAIL_LABEL[a]}</span>`}</td><td data-owner-only><button class="text-button" data-edit="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">Edit</button> <button class="text-button" data-delete="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">Remove</button></td></tr>`;
          })
          .join(
            "",
          )}</tbody></table>${list.length > MAX_ROWS ? `<p class="hint">Showing the first ${MAX_ROWS} of ${list.length} products. Use <strong>Export products</strong> below to see them all.</p>` : ""}`
      : all.length
        ? '<p class="empty">No products match these filters.</p>'
        : '<p class="empty">No products added yet.</p>';
  }

  function render(products) {
    all = products || [];
    renderFilters();
    renderSummary();
    renderTable();
  }

  /* ---------- picture ---------- */
  function readThumb(file) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onerror = () => resolve(null);
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => resolve(null);
        img.onload = () => {
          try {
            const s = K.thumbSize(img.width, img.height);
            const c = document.createElement("canvas");
            c.width = s.w;
            c.height = s.h;
            c.getContext("2d").drawImage(img, 0, 0, s.w, s.h);
            let q = 0.7;
            let url = c.toDataURL("image/jpeg", q);
            while (!K.validImage(url) && q > 0.2) {
              q -= 0.15;
              url = c.toDataURL("image/jpeg", q);
            }
            resolve(K.validImage(url) ? url : null);
          } catch {
            resolve(null);
          }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ---------- edit dialog ---------- */
  function openEdit(id) {
    const p = all.find((x) => x.id === id);
    if (!p) return;
    editing = p;
    pendingImage = undefined;
    const f = $("productEditForm").elements;
    f.name.value = p.name || "";
    f.price.value = p.price;
    f.costPrice.value = p.costPrice ?? "";
    f.sku.value = p.sku || "";
    f.category.value = p.category || "";
    f.reorderLevel.value = p.reorderLevel ?? "";
    f.unit.innerHTML = K.UNITS.map(
      (u) => `<option value="${u}">${u}</option>`,
    ).join("");
    f.unit.value = p.unit || "each";
    f.description.value = p.description || "";
    f.archived.checked = !!p.archived;
    f.clearImage.checked = false;
    f.imageFile.value = "";
    const h = (p.priceHistory || []).slice(-5).reverse();
    $("productHistory").textContent = h.length
      ? "Recent price changes: " +
        h
          .map(
            (e) =>
              new Date(e.at).toLocaleDateString() +
              " " +
              fmt(e.from) +
              " → " +
              fmt(e.to),
          )
          .join("; ")
      : "No price changes recorded yet.";
    $("productEditPanel").classList.remove("hidden");
    f.name.focus();
  }
  async function saveEdit(e) {
    e.preventDefault();
    if (!editing) return;
    const form = e.currentTarget; // captured before any await
    const f = form.elements;
    const input = {
      name: f.name.value,
      price: f.price.value,
      costPrice: f.costPrice.value,
      sku: f.sku.value,
      category: f.category.value,
      reorderLevel: f.reorderLevel.value,
      unit: f.unit.value,
      description: f.description.value,
      archived: f.archived.checked,
    };
    const r = K.applyEdit(editing, input);
    if (!r.ok) return toast(r.error);
    const next = r.product;
    if (f.clearImage.checked) delete next.image;
    else if (f.imageFile.files && f.imageFile.files[0]) {
      const url = await readThumb(f.imageFile.files[0]);
      if (!url)
        return toast("That picture could not be used. Try a smaller photo.");
      next.image = url;
    }
    await POSDB.put("products", next);
    $("productEditPanel").classList.add("hidden");
    editing = null;
    await refresh();
    toast("Product saved on this device.");
  }

  /* ---------- bulk ---------- */
  async function applyBulk() {
    const type = $("bulkType").value;
    const raw = $("bulkValue").value;
    const change = { type };
    if (type === "percent") change.value = Number(raw);
    else if (type === "category" || type === "unit") change.value = raw.trim();
    const r = K.bulk(all, [...selected], change);
    if (!r.ok) return toast(r.error);
    if (!r.changed.length) return toast("Nothing changed.");
    if (!confirm("Change " + r.changed.length + " product(s)?")) return;
    for (const p of r.changed) await POSDB.put("products", p);
    selected.clear();
    $("prodSelectAll").checked = false;
    await refresh();
    toast(r.changed.length + " product(s) updated.");
  }

  function bind() {
    for (const id of ["prodFilterText", "prodFilterCat", "prodFilterAvail"])
      $(id).addEventListener("input", renderTable);
    $("productTable").addEventListener("click", (e) => {
      const b = e.target.closest("[data-edit]");
      if (b) openEdit(b.dataset.edit);
    });
    $("productTable").addEventListener("change", (e) => {
      const c = e.target.closest("[data-sel]");
      if (!c) return;
      if (c.checked) selected.add(c.dataset.sel);
      else selected.delete(c.dataset.sel);
    });
    $("prodSelectAll").addEventListener("change", (e) => {
      const on = e.target.checked;
      for (const p of K.filter(all, opts()).slice(0, MAX_ROWS))
        on ? selected.add(p.id) : selected.delete(p.id);
      renderTable();
    });
    $("productEditForm").addEventListener("submit", saveEdit);
    $("productEditCancel").addEventListener("click", () =>
      $("productEditPanel").classList.add("hidden"),
    );
    $("bulkApply").addEventListener("click", applyBulk);
    $("bulkType").addEventListener("change", () => {
      const t = $("bulkType").value;
      $("bulkValue").classList.toggle(
        "hidden",
        t === "archive" || t === "restore",
      );
      $("bulkValue").placeholder =
        t === "percent"
          ? "e.g. 10 or -5"
          : t === "unit"
            ? "each, kg, L…"
            : "Value";
    });
  }
  async function init() {
    bind();
  }
  return { init, render };
})();
if (typeof window !== "undefined") window.CatalogueUI = CatalogueUI;
