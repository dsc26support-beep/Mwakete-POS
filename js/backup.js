/* Backup file: everything on this device in one JSON file, and a careful way to read it back. Pure functions, unit-testable in Node.
 *
 * Why: sales, products and the other business records can go to the cloud account, but customers, price lists and settings stay on the
 * device. A backup file is the owner's own copy of all of it.
 *
 * Restoring is cautious:
 *  - the file is checked record by record; a bad record is skipped and listed, it never reaches the database;
 *  - only the known record kinds are read, whatever else the file contains is ignored;
 *  - a record with the same ID is replaced, nothing else is deleted;
 *  - device-specific settings (document number counters, the device code, the cloud sign-in link, the unfinished cart, an open
 *    register, the error log) are NEVER copied, so restoring onto a new device cannot create duplicate invoice numbers.
 */
const BackupCore = (() => {
  const FORMAT = 1;
  const APP = "mwakete-pos";
  const LIMITS = { bytes: 60_000_000, records: 300_000, key: 200, reasons: 20 };
  // store -> the field that identifies a record
  const STORES = {
    products: "id",
    sales: "id",
    customers: "id",
    priceLists: "id",
    payments: "id",
    refunds: "id",
    registers: "id",
    stockMoves: "id",
    suppliers: "id",
    purchaseOrders: "id",
    quotes: "id",
    settings: "key",
  };
  const SKIP_SETTINGS = new Set([
    "deviceCode",
    "invoiceSeq",
    "receiptSeq",
    "heldSales",
    "creditSeq",
    "poSeq",
    "quoteSeq",
    "cloudBusiness",
    "cartDraft",
    "registerOpen",
    "errorLog",
  ]);
  const isPlain = (o) =>
    o !== null && typeof o === "object" && !Array.isArray(o);
  const num = (v) => typeof v === "number" && Number.isFinite(v);

  // One-sentence reason a record cannot be restored, or "" if it can.
  function problem(store, r) {
    if (!isPlain(r)) return "is not a record";
    const key = r[STORES[store]];
    if (typeof key !== "string" || !key || key.length > LIMITS.key)
      return "has no valid " + STORES[store];
    if (Object.prototype.hasOwnProperty.call(r, "__proto__"))
      return "has a forbidden field";
    if (store === "settings" && SKIP_SETTINGS.has(key)) return "";
    if (
      store === "products" &&
      (typeof r.name !== "string" ||
        !num(r.price) ||
        r.price < 0 ||
        (r.stock !== undefined && !num(r.stock)))
    )
      return "is not a valid product";
    if (
      store === "sales" &&
      (!Array.isArray(r.items) || !num(r.total) || !num(r.createdAt))
    )
      return "is not a valid sale";
    if (
      store === "payments" &&
      (!num(r.amount) || !num(r.createdAt) || typeof r.customerId !== "string")
    )
      return "is not a valid payment";
    if (
      store === "refunds" &&
      (!num(r.total) || !num(r.createdAt) || typeof r.saleId !== "string")
    )
      return "is not a valid credit note";
    if (store === "customers" && typeof r.name !== "string")
      return "is not a valid customer";
    return "";
  }

  // data: {store: records[]}. -> the object to save as JSON.
  function build(data, now = Date.now()) {
    const stores = {},
      counts = {};
    for (const s of Object.keys(STORES)) {
      let recs = Array.isArray(data[s]) ? data[s] : [];
      if (s === "settings")
        recs = recs.filter((r) => !SKIP_SETTINGS.has(r.key));
      stores[s] = recs;
      counts[s] = recs.length;
    }
    return { app: APP, format: FORMAT, exportedAt: now, counts, stores };
  }

  // -> {ok, stores (valid records only), counts, skipped:[{store, key, reason}], ignoredStores, exportedAt} | {ok:false, error}
  function parse(text) {
    if (typeof text !== "string" || !text.trim())
      return { ok: false, error: "The file is empty." };
    if (text.length > LIMITS.bytes)
      return {
        ok: false,
        error: "That file is too big to be a backup of this app.",
      };
    let doc;
    try {
      doc = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch (_) {
      return {
        ok: false,
        error: "That is not a backup file (it could not be read).",
      };
    }
    if (!isPlain(doc) || doc.app !== APP)
      return { ok: false, error: "That file is not a Mwakete POS backup." };
    if (doc.format !== FORMAT)
      return {
        ok: false,
        error:
          "That backup was made by a different version of the app (format " +
          doc.format +
          ").",
      };
    if (!isPlain(doc.stores))
      return { ok: false, error: "The backup has no data in it." };
    const stores = {},
      counts = {},
      skipped = [],
      ignoredStores = [];
    let total = 0;
    for (const [name, recs] of Object.entries(doc.stores)) {
      if (!Object.prototype.hasOwnProperty.call(STORES, name)) {
        ignoredStores.push(name);
        continue;
      }
      if (!Array.isArray(recs)) {
        skipped.push({ store: name, key: "", reason: "is not a list" });
        continue;
      }
      total += recs.length;
      if (total > LIMITS.records)
        return { ok: false, error: "The backup has too many records." };
      stores[name] = [];
      for (const r of recs) {
        const why = problem(name, r);
        if (why) {
          if (skipped.length < LIMITS.reasons)
            skipped.push({
              store: name,
              key: isPlain(r) ? String(r[STORES[name]] ?? "") : "",
              reason: why,
            });
          else skipped.skipped = (skipped.skipped || 0) + 1;
          continue;
        }
        if (name === "settings" && SKIP_SETTINGS.has(r.key)) continue; // never restored
        stores[name].push(r);
      }
      counts[name] = stores[name].length;
    }
    const restorable = Object.values(counts).reduce((n, c) => n + c, 0);
    if (!restorable)
      return {
        ok: false,
        error: "The backup has no records that can be restored.",
      };
    return {
      ok: true,
      stores,
      counts,
      skipped,
      ignoredStores,
      exportedAt: Number(doc.exportedAt) || 0,
    };
  }

  const LABELS = {
    products: "products",
    sales: "sales",
    customers: "customers",
    priceLists: "price lists",
    payments: "payments",
    refunds: "credit notes",
    registers: "register shifts",
    stockMoves: "stock changes",
    suppliers: "suppliers",
    purchaseOrders: "purchase orders",
    quotes: "quotes",
    settings: "settings",
  };
  const summary = (counts) =>
    Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => n + " " + (LABELS[s] || s))
      .join(", ");

  return {
    FORMAT,
    STORES,
    SKIP_SETTINGS,
    LIMITS,
    build,
    parse,
    summary,
    problem,
  };
})();
if (typeof module !== "undefined") module.exports = BackupCore;
