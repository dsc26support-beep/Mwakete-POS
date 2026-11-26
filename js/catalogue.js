/* CatalogueCore — pure product-catalogue logic: validation of the extra product fields, availability status,
 * stock valuation, filtering, bulk edits and price history. No DOM, no storage. Unit tested in Node. */
(function (root) {
  const UNITS = ["each", "kg", "g", "L", "mL", "pack", "box", "dozen", "m"];
  const MAX_HISTORY = 20;
  const toMinor = (n) => Math.round(Number(n) * 100);
  const fromMinor = (m) => m / 100;
  const fail = (error) => ({ ok: false, error });
  const text = (s, max) =>
    String(s == null ? "" : s)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, max);
  const optMoney = (v, label) => {
    if (v === undefined || v === null || v === "") return { ok: true };
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e9)
      return fail(label + " must be zero or more.");
    return { ok: true, value: fromMinor(toMinor(n)) };
  };

  /* Validate edits to the descriptive fields. `input` keys are optional; only given keys change. */
  function cleanFields(input) {
    const out = {};
    if ("name" in input) {
      const n = text(input.name, 100);
      if (!n) return fail("Enter a product name.");
      out.name = n;
    }
    if ("price" in input) {
      const p = Number(input.price);
      if (input.price === "" || !Number.isFinite(p) || p < 0 || p > 1e9)
        return fail("Price must be zero or more.");
      out.price = fromMinor(toMinor(p));
    }
    if ("costPrice" in input) {
      const c = optMoney(input.costPrice, "Cost price");
      if (!c.ok) return c;
      out.costPrice = c.value; // undefined clears it
    }
    if ("description" in input) out.description = text(input.description, 300);
    if ("sku" in input) out.sku = text(input.sku, 80);
    if ("barcode" in input) out.barcode = text(input.barcode, 80);
    if ("category" in input) out.category = text(input.category, 40);
    if ("unit" in input) {
      const u = String(input.unit || "each");
      if (!UNITS.includes(u)) return fail("Choose a unit from the list.");
      out.unit = u;
    }
    if ("reorderLevel" in input) {
      const r = input.reorderLevel;
      if (r === "" || r === undefined || r === null)
        out.reorderLevel = undefined;
      else {
        const n = Number(r);
        if (!Number.isInteger(n) || n < 0 || n > 1e7)
          return fail("Reorder level must be a whole number.");
        out.reorderLevel = n;
      }
    }
    if ("archived" in input) out.archived = !!input.archived;
    if ("minQty" in input) {
      const m = input.minQty;
      if (m === "" || m === undefined || m === null || Number(m) === 0)
        out.minQty = undefined;
      else {
        const n = Number(m);
        if (!Number.isInteger(n) || n < 1 || n > 1e6)
          return fail("Minimum trade quantity must be a whole number.");
        out.minQty = n;
      }
    }
    if ("qtyBreaks" in input) {
      const b = parseBreaks(input.qtyBreaks);
      if (!b.ok) return b;
      out.qtyBreaks = b.value.length ? b.value : undefined;
    }
    return { ok: true, fields: out };
  }

  /* Quantity discounts: text lines "10:5" = from 10 units, 5% off the unit price. Also accepts an array of {qty, pct}. */
  const MAX_BREAKS = 5;
  function parseBreaks(raw) {
    let list;
    if (Array.isArray(raw))
      list = raw.map((b) => ({
        qty: Number(b && b.qty),
        pct: Number(b && b.pct),
      }));
    else {
      list = [];
      for (const line of String(raw == null ? "" : raw).split(/\r?\n|;/)) {
        const t = line.trim();
        if (!t) continue;
        const m = /^(\d+)\s*[:=]\s*(\d+(?:\.\d+)?)\s*%?$/.exec(t);
        if (!m)
          return fail(
            'Write each quantity discount like "10:5" (from 10 units, 5% off).',
          );
        list.push({ qty: Number(m[1]), pct: Number(m[2]) });
      }
    }
    if (list.length > MAX_BREAKS)
      return fail("At most " + MAX_BREAKS + " quantity discounts.");
    for (const b of list)
      if (
        !Number.isInteger(b.qty) ||
        b.qty < 2 ||
        b.qty > 1e6 ||
        !(b.pct > 0) ||
        b.pct > 90
      )
        return fail(
          "A quantity discount needs 2 or more units and 0.1 to 90 percent.",
        );
    const sorted = list.slice().sort((a, b) => a.qty - b.qty);
    for (let i = 1; i < sorted.length; i++)
      if (sorted[i].qty === sorted[i - 1].qty)
        return fail("Two quantity discounts start at the same quantity.");
      else if (sorted[i].pct <= sorted[i - 1].pct)
        return fail("A bigger quantity must give a bigger discount.");
    return {
      ok: true,
      value: sorted.map((b) => ({
        qty: b.qty,
        pct: Math.round(b.pct * 10) / 10,
      })),
    };
  }
  const breaksText = (list) =>
    (list || []).map((b) => b.qty + ":" + b.pct).join("\n");
  /* Unit price for `qty` units, from the price the line starts at. Returns {price, pct}. */
  function priceForQty(basePrice, breaks, qty) {
    let pct = 0;
    for (const b of breaks || []) if (qty >= b.qty) pct = b.pct;
    return {
      price: fromMinor(Math.round(toMinor(basePrice) * (1 - pct / 100))),
      pct,
    };
  }

  function addHistory(history, from, to, now, note) {
    const h = Array.isArray(history) ? history.slice() : [];
    if (toMinor(from) === toMinor(to)) return h;
    const e = {
      at: now,
      from: fromMinor(toMinor(from)),
      to: fromMinor(toMinor(to)),
    };
    if (note) e.note = text(note, 40);
    h.push(e);
    return h.slice(-MAX_HISTORY);
  }

  /* Apply validated fields to a product; records a price change; removes keys set to undefined. */
  function applyEdit(product, input, opts = {}) {
    const c = cleanFields(input);
    if (!c.ok) return c;
    const now = opts.now || Date.now();
    const next = { ...product };
    for (const [k, v] of Object.entries(c.fields)) {
      if (v === undefined || v === "" || (k === "archived" && v === false))
        delete next[k];
      else next[k] = v;
    }
    if ("price" in c.fields)
      next.priceHistory = addHistory(
        product.priceHistory,
        product.price,
        c.fields.price,
        now,
        opts.note,
      );
    if (!next.priceHistory || !next.priceHistory.length)
      delete next.priceHistory;
    next.updatedAt = now;
    return { ok: true, product: next };
  }

  /* archived | out | low | available */
  function availability(p) {
    if (p.archived) return "archived";
    const stock = Number(p.stock) || 0;
    if (stock <= 0) return "out";
    if (Number.isInteger(p.reorderLevel) && stock <= p.reorderLevel)
      return "low";
    return "available";
  }
  const AVAIL_LABEL = {
    archived: "Archived",
    out: "Out of stock",
    low: "Low stock",
    available: "Available",
  };

  /* Stock valuation. Products with no cost price are counted separately and never guessed. */
  function valuation(products) {
    let cost = 0,
      retail = 0,
      units = 0,
      missingCost = 0,
      counted = 0;
    for (const p of products || []) {
      if (p.archived) continue;
      const s = Math.max(0, Number(p.stock) || 0);
      units += s;
      retail += toMinor(p.price) * s;
      if (p.costPrice === undefined || p.costPrice === null) {
        if (s > 0) missingCost++;
      } else {
        cost += toMinor(p.costPrice) * s;
        counted++;
      }
    }
    return {
      costValue: fromMinor(cost),
      retailValue: fromMinor(retail),
      units,
      missingCost,
      costedProducts: counted,
      potentialMargin: fromMinor(retail - cost),
    };
  }

  /* Stock report as CSV: one row per active product with value at selling price and at cost (blank when no cost). */
  const csvCell = (v) => {
    const s = String(v == null ? "" : v);
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  };
  function stockReportCsv(products) {
    const rows = [
      "name,sku,category,unit,stock,status,price,cost,value at price,value at cost",
    ];
    const list = (products || [])
      .filter((p) => !p.archived)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    for (const p of list) {
      const s = Math.max(0, Number(p.stock) || 0);
      const hasCost = p.costPrice !== undefined && p.costPrice !== null;
      rows.push(
        [
          p.name,
          p.sku || "",
          p.category || "",
          p.unit || "each",
          s,
          AVAIL_LABEL[availability(p)],
          Number(p.price).toFixed(2),
          hasCost ? Number(p.costPrice).toFixed(2) : "",
          fromMinor(toMinor(p.price) * s).toFixed(2),
          hasCost ? fromMinor(toMinor(p.costPrice) * s).toFixed(2) : "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
    const v = valuation(products);
    rows.push(
      [
        "TOTAL",
        "",
        "",
        "",
        v.units,
        "",
        "",
        "",
        v.retailValue.toFixed(2),
        v.costedProducts ? v.costValue.toFixed(2) : "",
      ]
        .map(csvCell)
        .join(","),
    );
    return rows.join("\r\n") + "\r\n";
  }

  /* True when a price would sell below the cost the owner entered. */
  const belowCost = (price, cost) =>
    cost !== undefined &&
    cost !== null &&
    cost !== "" &&
    Number(cost) > 0 &&
    toMinor(price) < toMinor(cost);

  function categories(products) {
    return [
      ...new Set(
        (products || [])
          .map((p) => p.category)
          .filter((c) => c && String(c).trim()),
      ),
    ].sort((a, b) => a.localeCompare(b));
  }

  /* Filter for lists. opts: {q, category, availability: ""|archived|out|low|available, includeArchived} */
  function filter(products, opts = {}) {
    const q = String(opts.q || "")
      .toLowerCase()
      .trim();
    return (products || []).filter((p) => {
      const a = availability(p);
      if (opts.availability) {
        if (a !== opts.availability) return false;
      } else if (p.archived && !opts.includeArchived) return false;
      if (opts.category) {
        if (opts.category === "__none__") {
          if (p.category) return false;
        } else if (p.category !== opts.category) return false;
      }
      if (q) {
        const hay = (
          p.name +
          " " +
          (p.sku || "") +
          " " +
          (p.barcode || "") +
          " " +
          (p.description || "")
        ).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  /* Bulk changes to several products. change: {type: percent|category|archive|restore|unit, value} */
  function bulk(products, ids, change, opts = {}) {
    const now = opts.now || Date.now();
    const pick = new Set(ids || []);
    if (!pick.size) return fail("Choose at least one product.");
    if (pick.size > 500) return fail("Choose at most 500 products at once.");
    const changed = [];
    const t = change && change.type;
    if (t === "percent") {
      const v = Number(change.value);
      if (!Number.isFinite(v) || v < -90 || v > 500 || v === 0)
        return fail("Enter a percentage between -90 and 500 (not 0).");
    } else if (t === "category") {
      if (text(change.value, 40) === "" && change.value !== "")
        return fail("Enter a category.");
    } else if (t === "unit") {
      if (!UNITS.includes(change.value)) return fail("Choose a unit.");
    } else if (t !== "archive" && t !== "restore") {
      return fail("Unknown bulk change.");
    }
    for (const p of products || []) {
      if (!pick.has(p.id)) continue;
      let r;
      if (t === "percent") {
        const price = fromMinor(
          Math.round(toMinor(p.price) * (1 + Number(change.value) / 100)),
        );
        r = applyEdit(
          p,
          { price },
          { now, note: "bulk " + change.value + "%" },
        );
      } else if (t === "category")
        r = applyEdit(p, { category: change.value }, { now });
      else if (t === "unit") r = applyEdit(p, { unit: change.value }, { now });
      else r = applyEdit(p, { archived: t === "archive" }, { now });
      if (r.ok) changed.push(r.product);
    }
    return { ok: true, changed };
  }

  /* Shrink an image data-URL request: returns the target size keeping the aspect ratio. */
  function thumbSize(w, h, max = 96) {
    if (!(w > 0 && h > 0)) return { w: max, h: max };
    const k = Math.min(1, max / Math.max(w, h));
    return {
      w: Math.max(1, Math.round(w * k)),
      h: Math.max(1, Math.round(h * k)),
    };
  }
  const MAX_IMAGE_CHARS = 20000;
  const validImage = (s) =>
    typeof s === "string" &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s) &&
    s.length <= MAX_IMAGE_CHARS;

  const api = {
    UNITS,
    AVAIL_LABEL,
    MAX_HISTORY,
    cleanFields,
    applyEdit,
    availability,
    valuation,
    categories,
    stockReportCsv,
    belowCost,
    filter,
    bulk,
    addHistory,
    thumbSize,
    validImage,
    parseBreaks,
    breaksText,
    priceForQty,
    MAX_BREAKS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CatalogueCore = api;
})(typeof window !== "undefined" ? window : globalThis);
