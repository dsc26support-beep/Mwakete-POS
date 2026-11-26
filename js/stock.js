/* Stock movements, suppliers and purchase orders. Pure functions, unit-testable in Node.
 *
 * Stock is counted per device, in whole single units. Every change made by hand (receiving, damage, stock count,
 * correction) is recorded as an APPEND-ONLY stock movement, so there is always an audit trail of who changed what and why.
 * Sales and refunds change stock too but are not duplicated here: they already have their own records.
 *
 * A purchase order goes draft -> ordered -> received (or cancelled). Receiving adds the quantities to stock and writes one
 * "purchase" movement per line. A received or cancelled order is frozen. Money is in integer cents.
 */
const StockCore = (() => {
  const LIMITS = {
    qty: 1e9,
    cost: 1e9,
    note: 200,
    name: 100,
    phone: 40,
    items: 200,
  };
  const REASONS = {
    purchase: "Stock received",
    adjustment: "Adjustment",
    count: "Stock count",
    damage: "Damaged or lost",
    return: "Customer return",
    correction: "Correction",
  };
  // What the person can choose on the Stock screen.
  const ACTIONS = {
    receive: { label: "Receive stock (add)", reason: "purchase", sign: 1 },
    damage: { label: "Damaged or lost (remove)", reason: "damage", sign: -1 },
    count: {
      label: "Stock count (set the real number)",
      reason: "count",
      sign: 0,
    },
    add: { label: "Correction: add", reason: "correction", sign: 1 },
    remove: { label: "Correction: remove", reason: "correction", sign: -1 },
  };
  const toMinor = (n) => Math.round(Number(n) * 100);
  const fromMinor = (m) => m / 100;
  const money = (n) => Number(n || 0).toFixed(2);
  const wholeQty = (v) => {
    const n = Number(v);
    return v !== "" &&
      v !== null &&
      Number.isInteger(n) &&
      n >= 0 &&
      n <= LIMITS.qty
      ? n
      : null;
  };

  /* ---------- stock movements ---------- */
  // action: a key of ACTIONS. qty: whole number (for "count" it is the number really on the shelf).
  // opts: {id, now, note, refId}. Returns {ok, value: movement, newStock}.
  function buildMove(product, action, qtyInput, opts = {}) {
    const a = ACTIONS[action];
    if (!a) return { ok: false, error: "Choose what happened to the stock." };
    if (!product || !product.id)
      return { ok: false, error: "Choose a product." };
    const q = wholeQty(qtyInput);
    if (q === null)
      return { ok: false, error: "Enter a whole number (0 or more)." };
    const have = Math.max(0, Math.round(Number(product.stock) || 0));
    let delta;
    if (a.sign === 0) delta = q - have;
    else {
      if (q < 1) return { ok: false, error: "Enter 1 or more." };
      delta = a.sign * q;
    }
    if (delta === 0)
      return {
        ok: false,
        error: "That matches the stock already recorded. Nothing to change.",
      };
    if (have + delta < 0)
      return {
        ok: false,
        error:
          "Only " + have + " of " + product.name + " in stock on this device.",
      };
    const note = String(opts.note ?? "").trim();
    if (note.length > LIMITS.note)
      return {
        ok: false,
        error: "Note is too long (max " + LIMITS.note + " characters).",
      };
    const rec = {
      id: opts.id,
      productId: product.id,
      productName: String(product.name || "").slice(0, LIMITS.name),
      delta,
      reason: a.reason,
      createdAt: opts.now || Date.now(),
      syncStatus: "pending",
    };
    if (opts.refId) rec.refId = String(opts.refId).slice(0, 64);
    if (note) rec.note = note;
    return { ok: true, value: rec, newStock: have + delta };
  }
  const movesFor = (moves, productId) =>
    (moves || [])
      .filter((m) => m.productId === productId)
      .sort((a, b) => b.createdAt - a.createdAt);
  const deltaText = (d) => (d > 0 ? "+" : "") + d;

  /* Everything that changed one product's stock, newest first: hand changes, sales, and returns put back on the shelf.
   * `returns` = [{id, productId, units, at, number}] (the screen builds it from the credit notes that restocked). */
  function history(productId, moves, sales, returns) {
    const ev = [];
    for (const m of moves || [])
      if (m.productId === productId)
        ev.push({
          at: m.createdAt,
          delta: m.delta,
          kind: m.reason,
          text: REASONS[m.reason] || m.reason,
          note: m.note || "",
          ref: m.id,
          device: m.deviceId || "",
        });
    for (const s of sales || []) {
      if (s.syncStatus === "rejected") continue;
      let units = 0;
      for (const it of s.items || [])
        if (it.productId === productId)
          units += (Number(it.quantity) || 0) * (Number(it.packUnits) || 1);
      if (units)
        ev.push({
          at: s.createdAt,
          delta: -units,
          kind: "sale",
          text: "Sold",
          note: s.receiptNo || "",
          ref: s.id,
          device: s.deviceId || "",
        });
    }
    for (const r of returns || [])
      if (r.productId === productId && r.units)
        ev.push({
          at: r.at,
          delta: r.units,
          kind: "return",
          text: "Returned to shelf",
          note: r.number || "",
          ref: r.id,
          device: "",
        });
    return ev.sort((a, b) => b.at - a.at);
  }

  /* Stock take: counts = {productId: number|""}. Returns the rows that were counted with their difference. */
  function stockTake(products, counts) {
    const rows = [];
    let shortUnits = 0,
      overUnits = 0,
      valueMinor = 0;
    for (const p of products || []) {
      if (p.archived) continue;
      const raw = counts ? counts[p.id] : undefined;
      if (raw === undefined || raw === "" || raw === null) continue;
      const q = wholeQty(raw);
      const expected = Math.max(0, Math.round(Number(p.stock) || 0));
      if (q === null) {
        rows.push({
          productId: p.id,
          name: p.name,
          expected,
          counted: null,
          variance: 0,
          error: "Enter a whole number",
        });
        continue;
      }
      const variance = q - expected;
      if (variance < 0) shortUnits += -variance;
      if (variance > 0) overUnits += variance;
      const cost =
        p.costPrice !== undefined && p.costPrice !== null
          ? toMinor(p.costPrice)
          : null;
      if (cost !== null) valueMinor += variance * cost;
      rows.push({
        productId: p.id,
        name: p.name,
        expected,
        counted: q,
        variance,
        valueAtCost: cost === null ? null : fromMinor(variance * cost),
      });
    }
    return {
      rows,
      shortUnits,
      overUnits,
      varianceValueAtCost: fromMinor(valueMinor),
      errors: rows.filter((r) => r.error).length,
    };
  }

  /* The count movements that apply a stock take (only products whose count differs). */
  function stockTakeMoves(products, counts, opts = {}) {
    const take = stockTake(products, counts);
    if (take.errors)
      return { ok: false, error: "Fix the counts marked with an error first." };
    const byId = new Map((products || []).map((p) => [p.id, p]));
    const moves = [];
    let n = 0;
    for (const r of take.rows) {
      if (!r.variance) continue;
      const m = buildMove(byId.get(r.productId), "count", r.counted, {
        id: opts.idFor ? opts.idFor(n++) : undefined,
        now: opts.now,
        note: opts.note || "Stock take",
      });
      if (!m.ok) return { ok: false, error: r.name + ": " + m.error };
      if (opts.deviceId) m.value.deviceId = String(opts.deviceId).slice(0, 12);
      moves.push({ move: m.value, newStock: m.newStock });
    }
    return { ok: true, moves, take };
  }

  function stockTakeCsv(take) {
    const cell = (v) => {
      const s = String(v == null ? "" : v);
      // a plain (even negative) number is never a formula; any other text starting = + - @ is neutralised
      const numeric = /^-?\d+(\.\d+)?$/.test(s);
      const safe = !numeric && /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
      return /[",\r\n]/.test(safe)
        ? '"' + safe.replace(/"/g, '""') + '"'
        : safe;
    };
    const lines = ["product,expected,counted,difference,difference at cost"];
    for (const r of take.rows)
      lines.push(
        [
          r.name,
          r.expected,
          r.counted ?? "",
          r.variance,
          r.valueAtCost == null ? "" : r.valueAtCost.toFixed(2),
        ]
          .map(cell)
          .join(","),
      );
    lines.push(
      [
        "TOTAL",
        "",
        "",
        "short " + take.shortUnits + " / over " + take.overUnits,
        take.varianceValueAtCost.toFixed(2),
      ]
        .map(cell)
        .join(","),
    );
    return lines.join("\r\n") + "\r\n";
  }

  /* ---------- numbers (PO-<device code>-<seq>) ---------- */
  const CODE_RE = /^[A-Z0-9]{3,8}$/;
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomCode = (rand = Math.random) =>
    Array.from(
      { length: 4 },
      () => CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)],
    ).join("");
  const chains = {};
  // store needs get/put on "settings". Shares the device code with invoice and credit note numbers.
  function nextNumber(store, prefix, seqKey, rand = Math.random) {
    const run = async () => {
      let code = (await store.get("settings", "deviceCode"))?.value;
      if (!CODE_RE.test(String(code))) {
        code = randomCode(rand);
        await store.put("settings", { key: "deviceCode", value: code });
      }
      const seq = Number((await store.get("settings", seqKey))?.value) || 0;
      await store.put("settings", { key: seqKey, value: seq + 1 });
      return prefix + "-" + code + "-" + String(seq + 1).padStart(4, "0");
    };
    const p = (chains[seqKey] || Promise.resolve()).then(run, run);
    chains[seqKey] = p.catch(() => {});
    return p;
  }
  const isValidPoNumber = (n) => /^PO-[A-Z0-9]{3,8}-\d{1,9}$/.test(String(n));

  /* ---------- suppliers ---------- */
  function buildSupplier(input, opts = {}) {
    const name = String(input?.name ?? "").trim();
    if (!name) return { ok: false, error: "Enter the supplier's name." };
    if (name.length > LIMITS.name)
      return {
        ok: false,
        error: "Name is too long (max " + LIMITS.name + " characters).",
      };
    const phone = String(input?.phone ?? "").trim();
    if (phone.length > LIMITS.phone)
      return { ok: false, error: "Phone is too long." };
    const note = String(input?.note ?? "").trim();
    if (note.length > LIMITS.note)
      return {
        ok: false,
        error: "Note is too long (max " + LIMITS.note + " characters).",
      };
    const rec = {
      id: opts.id || input?.id,
      name,
      updatedAt: opts.now || Date.now(),
      syncStatus: "pending",
    };
    if (phone) rec.phone = phone;
    if (note) rec.note = note;
    if (input?.archived) rec.archived = true;
    return { ok: true, value: rec };
  }

  /* ---------- purchase orders ---------- */
  // lines: [{productId, qty, unitCost}] -> items + exact total. Products give the display name.
  function buildLines(lines, products) {
    if (!Array.isArray(lines) || !lines.length)
      return { ok: false, error: "Add at least one product." };
    if (lines.length > LIMITS.items)
      return { ok: false, error: "Too many lines (max " + LIMITS.items + ")." };
    const byId = new Map((products || []).map((p) => [p.id, p]));
    const seen = new Set();
    const items = [];
    let total = 0;
    for (const l of lines) {
      const p = byId.get(l.productId);
      if (!p)
        return {
          ok: false,
          error: "One of the products no longer exists on this device.",
        };
      if (seen.has(l.productId))
        return {
          ok: false,
          error: p.name + " is on the order twice. Combine the lines.",
        };
      seen.add(l.productId);
      const qty = wholeQty(l.qty);
      if (qty === null || qty < 1)
        return {
          ok: false,
          error: "Enter a whole quantity of 1 or more for " + p.name + ".",
        };
      const cost = Number(l.unitCost);
      if (
        l.unitCost === "" ||
        !Number.isFinite(cost) ||
        cost < 0 ||
        cost > LIMITS.cost
      )
        return {
          ok: false,
          error: "Enter the cost of " + p.name + " (0 or more).",
        };
      if (Math.abs(cost * 100 - Math.round(cost * 100)) > 1e-6)
        return {
          ok: false,
          error: "The cost of " + p.name + " can have at most 2 decimals.",
        };
      items.push({
        productId: p.id,
        name: String(p.name).slice(0, LIMITS.name),
        qty,
        unitCost: Math.round(cost * 100) / 100,
      });
      total += toMinor(cost) * qty;
    }
    if (total > LIMITS.cost * 100)
      return { ok: false, error: "The order total is too large." };
    return { ok: true, items, total: fromMinor(total) };
  }
  // input: {supplierId?, supplierName, lines, note}. opts: {id, number, now, currency}
  function buildPurchaseOrder(input, products, opts = {}) {
    const supplierName = String(input?.supplierName ?? "").trim();
    if (!supplierName)
      return { ok: false, error: "Choose or enter the supplier." };
    if (supplierName.length > LIMITS.name)
      return { ok: false, error: "Supplier name is too long." };
    const note = String(input?.note ?? "").trim();
    if (note.length > LIMITS.note)
      return {
        ok: false,
        error: "Note is too long (max " + LIMITS.note + " characters).",
      };
    const l = buildLines(input?.lines, products);
    if (!l.ok) return l;
    const now = opts.now || Date.now();
    const po = {
      id: opts.id,
      number: opts.number,
      supplierName,
      status: "draft",
      items: l.items,
      total: l.total,
      createdAt: now,
      updatedAt: now,
      syncStatus: "pending",
    };
    if (input.supplierId) po.supplierId = String(input.supplierId).slice(0, 64);
    if (opts.currency) po.currency = String(opts.currency).slice(0, 8);
    if (note) po.note = note;
    return { ok: true, value: po };
  }
  const FINAL = ["received", "cancelled"];
  // action: "order" | "receive" | "cancel". Returns {ok, order, moves[]} (moves only when receiving).
  // opts: {now, newId: () => string}
  function transition(po, action, opts = {}) {
    if (!po) return { ok: false, error: "That order was not found." };
    if (FINAL.includes(po.status))
      return {
        ok: false,
        error: "A " + po.status + " order cannot be changed.",
      };
    const now = opts.now || Date.now();
    const base = {
      ...po,
      updatedAt: Math.max(now, po.updatedAt || 0),
      syncStatus: "pending",
    };
    delete base.syncError;
    if (action === "order") {
      if (po.status !== "draft")
        return { ok: false, error: "Only a draft can be marked as ordered." };
      return { ok: true, order: { ...base, status: "ordered" }, moves: [] };
    }
    if (action === "cancel")
      return { ok: true, order: { ...base, status: "cancelled" }, moves: [] };
    if (action === "receive") {
      const moves = po.items.map((it) => ({
        id: opts.newId(),
        productId: it.productId,
        productName: it.name,
        delta: it.qty,
        reason: "purchase",
        refId: po.id,
        note: po.number,
        createdAt: base.updatedAt,
        syncStatus: "pending",
      }));
      return {
        ok: true,
        order: { ...base, status: "received", receivedAt: base.updatedAt },
        moves,
      };
    }
    return { ok: false, error: "Unknown action." };
  }

  /* ---------- document text (32 columns) ---------- */
  const WIDTH = 32;
  const row = (l, r) => {
    const a = String(l),
      b = String(r);
    return a.length + b.length + 1 > WIDTH
      ? a.slice(0, Math.max(1, WIDTH - b.length - 1)) + " " + b
      : a + " ".repeat(WIDTH - a.length - b.length) + b;
  };
  function buildPurchaseOrderText(po, business = {}) {
    const L = [
      String(business.name || "Mwakete POS"),
      "PURCHASE ORDER " + po.number,
      "Date: " + new Date(po.createdAt).toISOString().slice(0, 10),
      "Supplier: " + po.supplierName,
      "Status: " + po.status,
      "-".repeat(WIDTH),
    ];
    for (const it of po.items) {
      L.push(it.name);
      L.push(
        row(
          "  " + it.qty + " x " + money(it.unitCost),
          money(it.qty * it.unitCost),
        ),
      );
    }
    L.push(
      "-".repeat(WIDTH),
      row("TOTAL " + (po.currency || ""), money(po.total)),
    );
    if (po.note) L.push("Note: " + po.note);
    return L.join("\n");
  }

  return {
    LIMITS,
    REASONS,
    ACTIONS,
    buildMove,
    movesFor,
    history,
    stockTake,
    stockTakeMoves,
    stockTakeCsv,
    deltaText,
    nextNumber,
    isValidPoNumber,
    buildSupplier,
    buildLines,
    buildPurchaseOrder,
    transition,
    buildPurchaseOrderText,
  };
})();
if (typeof module !== "undefined") module.exports = StockCore;
