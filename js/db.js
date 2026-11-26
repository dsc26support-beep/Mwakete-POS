/* Local-first database. IndexedDB is the durable offline queue; never silently discard pending sales. */
const POSDB = (() => {
  const NAME = "mwakete-pos-v1",
    VERSION = 5;
  let db;
  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("products")) {
          const s = d.createObjectStore("products", { keyPath: "id" });
          s.createIndex("sku", "sku", { unique: false });
        }
        if (!d.objectStoreNames.contains("sales")) {
          const s = d.createObjectStore("sales", { keyPath: "id" });
          s.createIndex("createdAt", "createdAt");
        }
        if (!d.objectStoreNames.contains("settings"))
          d.createObjectStore("settings", { keyPath: "key" });
        if (!d.objectStoreNames.contains("customers")) {
          const s = d.createObjectStore("customers", { keyPath: "id" });
          s.createIndex("name", "name");
        }
        if (!d.objectStoreNames.contains("priceLists"))
          d.createObjectStore("priceLists", { keyPath: "id" });
        if (!d.objectStoreNames.contains("payments")) {
          const s = d.createObjectStore("payments", { keyPath: "id" });
          s.createIndex("customerId", "customerId");
        }
        // Version 5 (additive): credit notes, register shifts, stock movements, suppliers, purchase orders, quotes.
        if (!d.objectStoreNames.contains("refunds")) {
          const s = d.createObjectStore("refunds", { keyPath: "id" });
          s.createIndex("saleId", "saleId");
        }
        if (!d.objectStoreNames.contains("registers"))
          d.createObjectStore("registers", { keyPath: "id" });
        if (!d.objectStoreNames.contains("stockMoves")) {
          const s = d.createObjectStore("stockMoves", { keyPath: "id" });
          s.createIndex("productId", "productId");
        }
        if (!d.objectStoreNames.contains("suppliers"))
          d.createObjectStore("suppliers", { keyPath: "id" });
        if (!d.objectStoreNames.contains("purchaseOrders"))
          d.createObjectStore("purchaseOrders", { keyPath: "id" });
        if (!d.objectStoreNames.contains("quotes"))
          d.createObjectStore("quotes", { keyPath: "id" });
      };
      req.onsuccess = () => {
        db = req.result;
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }
  function tx(store, mode = "readonly") {
    return db.transaction(store, mode).objectStore(store);
  }
  function all(store) {
    return new Promise((res, rej) => {
      const r = tx(store).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function get(store, key) {
    return new Promise((res, rej) => {
      const r = tx(store).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function put(store, value) {
    return new Promise((res, rej) => {
      const r = tx(store, "readwrite").put(value);
      r.onsuccess = () => res(value);
      r.onerror = () => rej(r.error);
    });
  }
  function remove(store, key) {
    return new Promise((res, rej) => {
      const r = tx(store, "readwrite").delete(key);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }
  return { open, all, get, put, remove };
})();
