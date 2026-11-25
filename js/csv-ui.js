/* Product CSV import and export screen. Logic lives in csv.js (CsvCore).
 * Choosing a file only builds a PREVIEW; products are saved when the person presses Import. */
const CsvUI = (() => {
  const C = CsvCore,
    $ = (id) => document.getElementById(id);
  const LABELS = {
    name: "Product name",
    price: "Price",
    sku: "Barcode / SKU",
    stock: "Stock",
    category: "Category",
    reorderLevel: "Reorder level",
  };
  let parsed = null,
    mapping = null,
    preview = null;

  function mappingForm() {
    const opts = (sel) =>
      '<option value="-1">— not in the file —</option>' +
      parsed.headers
        .map(
          (h, i) =>
            `<option value="${i}"${i === sel ? " selected" : ""}>${esc(h || "(blank heading)")}</option>`,
        )
        .join("");
    $("csvMap").innerHTML = C.FIELDS.map(
      (f) =>
        `<label>${esc(LABELS[f])}${f === "name" || f === "price" ? " *" : ""}<select data-csv-field="${f}">${opts(mapping[f])}</select></label>`,
    ).join("");
    $("csvMap").classList.remove("hidden");
  }

  async function build() {
    if (!parsed) return;
    const existing = await POSDB.all("products");
    const r = C.buildImport(parsed.rows, mapping, existing, {
      onDuplicate: $("csvDup").value,
      updateStock: $("csvStock").checked,
      newId: uid,
    });
    preview = r.ok ? r : null;
    if (!r.ok) {
      $("csvPreview").innerHTML =
        `<p class="notice warn" role="alert">${esc(r.error)}</p>`;
      $("csvOptions").classList.add("hidden");
      return;
    }
    const c = r.counts;
    const sample = r.items
      .filter((i) => i.action !== "skip")
      .slice(0, 8)
      .map(
        (i) =>
          `<tr><td>${i.action === "add" ? "New" : "Update"}</td><td>${esc(i.product.name)}</td><td>${Number(i.product.price).toFixed(2)}</td><td>${esc(i.product.stock)}</td></tr>`,
      )
      .join("");
    const probs = r.errors
      .slice(0, 10)
      .map((e) => `<li>Row ${e.row}: ${esc(e.message)}</li>`)
      .join("");
    $("csvPreview").innerHTML =
      `<p><strong>${c.add}</strong> to add · <strong>${c.update}</strong> to update · <strong>${c.skip}</strong> already here (skipped) · <strong>${c.error}</strong> with problems</p>` +
      (sample
        ? `<div class="table-wrap"><table><thead><tr><th></th><th>Product</th><th>Price</th><th>Stock</th></tr></thead><tbody>${sample}</tbody></table></div>`
        : "") +
      (probs
        ? `<p class="muted">These rows will be left out:</p><ul>${probs}${r.errors.length > 10 ? `<li>…and ${r.errors.length - 10} more</li>` : ""}</ul>`
        : "");
    $("csvOptions").classList.remove("hidden");
    $("csvImport").disabled = c.add + c.update === 0;
    $("csvImport").textContent =
      c.add + c.update
        ? "Import " + (c.add + c.update) + " product(s)"
        : "Nothing to import";
  }

  function reset() {
    parsed = mapping = preview = null;
    $("csvFile").value = "";
    // Back to the safe choices, so one import's "update" or "replace stock" never carries over to the next file.
    $("csvDup").value = "skip";
    $("csvStock").checked = false;
    $("csvMap").classList.add("hidden");
    $("csvOptions").classList.add("hidden");
    $("csvPreview").innerHTML = "";
  }

  async function init() {
    if (!$("csvPanel")) return;
    $("csvFile").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > C.LIMITS.bytes)
        return toast("That file is too big (max 2 MB).");
      const p = C.parse(await file.text());
      if (!p.ok) {
        reset();
        return toast(p.error);
      }
      parsed = p;
      mapping = C.guessMapping(p.headers);
      mappingForm();
      await build();
    });
    $("csvMap").addEventListener("change", (e) => {
      const s = e.target.closest("[data-csv-field]");
      if (!s) return;
      mapping[s.dataset.csvField] = Number(s.value);
      build();
    });
    $("csvDup").addEventListener("change", build);
    $("csvStock").addEventListener("change", build);
    $("csvImport").addEventListener("click", async () => {
      if (!preview) return;
      const todo = preview.items.filter(
        (i) => i.action === "add" || i.action === "update",
      );
      for (const it of todo) await POSDB.put("products", it.product);
      toast(todo.length + " product(s) imported.");
      reset();
      if (typeof refresh === "function") await refresh();
      if (typeof POSSynchroniser !== "undefined" && navigator.onLine)
        POSSynchroniser.run().catch(() => {});
    });
    $("csvExport").addEventListener("click", async () => {
      const products = await POSDB.all("products");
      if (!products.length)
        return toast("There are no products to export yet.");
      const url = URL.createObjectURL(
        new Blob(["﻿" + C.exportProducts(products)], {
          type: "text/csv;charset=utf-8",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "products-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
  }
  return { init };
})();
window.CsvUI = CsvUI;
