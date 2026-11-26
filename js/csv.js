/* CSV import and export of products. Pure functions, unit-testable in Node.
 *
 * Import never writes anything by itself: it parses the file, checks every row, and returns a PREVIEW (what would be added,
 * updated or skipped, and which rows have problems). The screen only saves after the person confirms.
 * Duplicates are found by barcode/SKU (or by name when there is no SKU), both inside the file and against existing products.
 * Updating an existing product never overwrites its stock count unless the person asks for that.
 * Export neutralises spreadsheet formulas (a cell starting with = + - @ gets a leading apostrophe) so a hostile product name
 * cannot run code when the file is opened in a spreadsheet; import removes that apostrophe again.
 */
const CsvCore = (() => {
  const LIMITS = {
    bytes: 2_000_000,
    rows: 5000,
    name: 100,
    sku: 80,
    category: 40,
    price: 1e9,
    qty: 1e9,
  };
  const FIELDS = ["name", "sku", "price", "stock", "category", "reorderLevel"];

  /* ---------- parsing ---------- */
  function detectDelimiter(text) {
    const first = text.split(/\r\n|\n|\r/)[0] || "";
    let best = ",",
      bestN = -1;
    for (const d of [",", ";", "\t"]) {
      let n = 0,
        inQ = false;
      for (const ch of first) {
        if (ch === '"') inQ = !inQ;
        else if (ch === d && !inQ) n++;
      }
      if (n > bestN) {
        bestN = n;
        best = d;
      }
    }
    return best;
  }
  // -> {ok, delimiter, headers, rows} | {ok:false, error}. Rows are arrays of trimmed strings; blank lines are dropped.
  function parse(input) {
    let text = String(input ?? "");
    if (text.length > LIMITS.bytes)
      return { ok: false, error: "That file is too big (max 2 MB)." };
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (!text.trim()) return { ok: false, error: "The file is empty." };
    const delimiter = detectDelimiter(text);
    const rows = [];
    let row = [],
      cell = "",
      inQ = false,
      i = 0;
    const endCell = () => {
      row.push(cell.trim());
      cell = "";
    };
    const endRow = () => {
      endCell();
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    };
    for (; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else inQ = false;
        } else cell += ch;
      } else if (ch === '"' && cell === "") inQ = true;
      else if (ch === delimiter) endCell();
      else if (ch === "\r") {
        if (text[i + 1] === "\n") i++;
        endRow();
      } else if (ch === "\n") endRow();
      else cell += ch;
      if (rows.length > LIMITS.rows + 1)
        return {
          ok: false,
          error: "Too many rows (max " + LIMITS.rows + " products at a time).",
        };
    }
    if (inQ)
      return {
        ok: false,
        error:
          "The file has a quote that is never closed. Check the quotes around text.",
      };
    if (cell !== "" || row.length) endRow();
    if (rows.length < 2)
      return {
        ok: false,
        error: "The file needs a heading row and at least one product.",
      };
    return { ok: true, delimiter, headers: rows[0], rows: rows.slice(1) };
  }

  /* ---------- column mapping ---------- */
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const SYNONYMS = {
    name: [
      "name",
      "product",
      "productname",
      "item",
      "itemname",
      "description",
      "title",
    ],
    sku: [
      "sku",
      "barcode",
      "code",
      "itemcode",
      "productcode",
      "upc",
      "ean",
      "plu",
    ],
    price: [
      "price",
      "sellingprice",
      "unitprice",
      "retailprice",
      "saleprice",
      "sell",
    ],
    stock: [
      "stock",
      "qty",
      "quantity",
      "onhand",
      "instock",
      "openingstock",
      "stockonhand",
    ],
    category: ["category", "group", "department", "type"],
    reorderLevel: [
      "reorderlevel",
      "reorder",
      "minstock",
      "minimum",
      "min",
      "lowstock",
    ],
  };
  // Best guess of which column holds what. -1 = not found. A column is used for one field only.
  function guessMapping(headers) {
    const used = new Set();
    const map = {};
    for (const f of FIELDS) {
      let idx = -1;
      for (const syn of SYNONYMS[f]) {
        const k = headers.findIndex((h, j) => !used.has(j) && norm(h) === syn);
        if (k >= 0) {
          idx = k;
          break;
        }
      }
      if (idx >= 0) used.add(idx);
      map[f] = idx;
    }
    return map;
  }

  /* ---------- cell checks ---------- */
  // Removes the apostrophe export adds in front of a formula-looking cell.
  const unsafe = (s) => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);
  function parseMoney(s) {
    const t = String(s).replace(/\s/g, "");
    if (t === "") return { ok: false, error: "needs a price" };
    const plain = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)
      ? t.replace(/,/g, "")
      : t;
    if (!/^\d+(\.\d+)?$/.test(plain))
      return { ok: false, error: "price must be a number like 12.50" };
    const n = Number(plain);
    if (n > LIMITS.price) return { ok: false, error: "price is too large" };
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6)
      return { ok: false, error: "price can have at most 2 decimals" };
    return { ok: true, value: Math.round(n * 100) / 100 };
  }
  function parseWhole(s, label) {
    const t = String(s).trim();
    if (!/^\d+$/.test(t))
      return { ok: false, error: label + " must be a whole number" };
    const n = Number(t);
    if (n > LIMITS.qty) return { ok: false, error: label + " is too large" };
    return { ok: true, value: n };
  }

  /* ---------- building the preview ---------- */
  // rows: from parse(). mapping: field -> column index (-1 = none). existing: current products.
  // opts: {onDuplicate: "skip"|"update", updateStock: false, now, newId}
  function buildImport(rows, mapping, existing, opts = {}) {
    const onDuplicate = opts.onDuplicate === "update" ? "update" : "skip";
    const now = opts.now || Date.now();
    const cell = (r, f) =>
      mapping[f] >= 0 && mapping[f] < r.length
        ? unsafe(r[mapping[f]] ?? "")
        : "";
    if (!(mapping.name >= 0))
      return {
        ok: false,
        error: "Choose which column holds the product name.",
      };
    if (!(mapping.price >= 0))
      return { ok: false, error: "Choose which column holds the price." };
    const bySku = new Map();
    const byName = new Map();
    for (const p of existing || []) {
      if (p.sku) bySku.set(String(p.sku).toLowerCase(), p);
      byName.set(String(p.name).toLowerCase(), p);
    }
    const items = [],
      errors = [];
    const seenSku = new Map(),
      seenName = new Map();
    rows.forEach((r, k) => {
      const rowNo = k + 2; // the heading is row 1
      const bad = (message) => errors.push({ row: rowNo, message });
      const name = cell(r, "name");
      if (!name) return bad("needs a product name");
      if (name.length > LIMITS.name)
        return bad("name is too long (max " + LIMITS.name + ")");
      const price = parseMoney(cell(r, "price"));
      if (!price.ok) return bad(price.error);
      const sku = cell(r, "sku");
      if (sku.length > LIMITS.sku)
        return bad("barcode is too long (max " + LIMITS.sku + ")");
      const category = cell(r, "category");
      if (category.length > LIMITS.category)
        return bad("category is too long (max " + LIMITS.category + ")");
      let stock = 0,
        stockGiven = false;
      if (cell(r, "stock") !== "") {
        const s = parseWhole(cell(r, "stock"), "stock");
        if (!s.ok) return bad(s.error);
        stock = s.value;
        stockGiven = true;
      }
      let reorderLevel;
      if (cell(r, "reorderLevel") !== "") {
        const s = parseWhole(cell(r, "reorderLevel"), "reorder level");
        if (!s.ok) return bad(s.error);
        reorderLevel = s.value;
      }
      // the same product twice in one file
      const dupIn = sku
        ? seenSku.get(sku.toLowerCase())
        : seenName.get(name.toLowerCase());
      if (dupIn)
        return bad("is the same product as row " + dupIn + " in this file");
      (sku ? seenSku : seenName).set(
        sku ? sku.toLowerCase() : name.toLowerCase(),
        rowNo,
      );
      // a product already on this device
      const match =
        (sku && bySku.get(sku.toLowerCase())) ||
        (!sku && byName.get(name.toLowerCase())) ||
        null;
      if (match) {
        if (onDuplicate === "skip")
          return items.push({
            row: rowNo,
            action: "skip",
            name,
            reason: "already exists",
            product: match,
          });
        const next = { ...match, name, price: price.value, updatedAt: now };
        if (sku) next.sku = sku;
        if (category) next.category = category;
        if (reorderLevel !== undefined) next.reorderLevel = reorderLevel;
        if (opts.updateStock && stockGiven) next.stock = stock;
        return items.push({
          row: rowNo,
          action: "update",
          name,
          product: next,
          before: match,
        });
      }
      const p = {
        id: opts.newId ? opts.newId() : undefined,
        name,
        price: price.value,
        stock,
        sku,
        updatedAt: now,
      };
      if (category) p.category = category;
      if (reorderLevel !== undefined) p.reorderLevel = reorderLevel;
      items.push({ row: rowNo, action: "add", name, product: p });
    });
    const counts = { add: 0, update: 0, skip: 0, error: errors.length };
    for (const it of items) counts[it.action]++;
    return { ok: true, items, errors, counts };
  }

  /* ---------- export ---------- */
  const safe = (v) => {
    const s = String(v ?? "");
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  };
  const quote = (v) => {
    const s = safe(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  function exportProducts(products) {
    const head = ["name", "sku", "price", "stock", "category", "reorderLevel"];
    const lines = [head.join(",")];
    for (const p of [...(products || [])].sort((a, b) =>
      String(a.name).localeCompare(String(b.name)),
    ))
      lines.push(
        [
          p.name,
          p.sku || "",
          Number(p.price).toFixed(2),
          Number(p.stock) || 0,
          p.category || "",
          p.reorderLevel === undefined ||
          p.reorderLevel === null ||
          p.reorderLevel === ""
            ? ""
            : p.reorderLevel,
        ]
          .map(quote)
          .join(","),
      );
    return lines.join("\r\n") + "\r\n";
  }

  return { LIMITS, FIELDS, parse, guessMapping, buildImport, exportProducts };
})();
if (typeof module !== "undefined") module.exports = CsvCore;
