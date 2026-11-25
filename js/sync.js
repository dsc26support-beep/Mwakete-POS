/* Sync: IndexedDB is an offline queue, NOT the ledger. A record is marked "synced" ONLY when the server returns its id.
 * The server answers per record: accepted ids, or rejected {id, reason}. A rejected record is kept and flagged
 * (never silently dropped, never retried blindly). Records the server did not mention stay pending.
 */
const POSSynchroniser = {
  running: false,
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const open = (r) =>
        r.syncStatus !== "synced" && r.syncStatus !== "rejected";
      const sales = (await POSDB.all("sales")).filter(open);
      const payments = (await POSDB.all("payments")).filter(open);
      // Signed in to the cloud account -> Firebase. Otherwise the optional Google Apps Script backend.
      const useFirebase =
        typeof FirebaseBackend !== "undefined" && FirebaseBackend.isSignedIn();
      const owner = useFirebase && FirebaseBackend.role() === "owner";
      // Catalogue changes still to be pushed (owner only) and product removals still to be confirmed.
      const products = owner
        ? (await POSDB.all("products")).filter(FirebaseBackend.isDirty)
        : [];
      const productDeletes = owner
        ? (await POSDB.get("settings", "productTombstones"))?.value || []
        : [];
      // Credit notes, shifts, stock movements, purchase orders and quotes (cloud account only).
      const extra = {};
      if (useFirebase)
        for (const store of EXTRA_STORES) {
          const recs = (await POSDB.all(store)).filter(open);
          if (recs.length) extra[store] = recs;
        }
      // A signed-in cloud account always syncs, even with nothing pending, so the catalogue is pulled.
      if (!useFirebase && !sales.length && !payments.length) {
        const rejected =
          (await POSDB.all("sales")).filter((s) => s.syncStatus === "rejected")
            .length +
          (await POSDB.all("payments")).filter(
            (p) => p.syncStatus === "rejected",
          ).length;
        setSyncUI(
          rejected ? "Sync needs attention" : "All changes saved",
          rejected
            ? rejected +
                " record(s) were rejected by your ledger. See Accounts."
            : "Nothing pending.",
        );
        return;
      }
      // Trade customers referenced by pending invoices/payments seed the owner's Customers sheet (insert-only on the server).
      const ids = new Set([
        ...sales
          .filter((s) => s.invoice && s.customerId)
          .map((s) => s.customerId),
        ...payments.map((p) => p.customerId),
      ]);
      const customers = [];
      for (const id of ids) {
        const c = await POSDB.get("customers", id);
        if (c && c.type === "trade")
          customers.push({
            id: c.id,
            name: c.name,
            creditLimit: c.creditLimit,
            terms: c.terms,
            taxNumber: c.taxNumber,
          });
      }
      const backend = useFirebase ? FirebaseBackend : GoogleBackend;
      const business = {
        name: (await POSDB.get("settings", "businessName"))?.value,
        currency: (await POSDB.get("settings", "currency"))?.value,
        tier: (await POSDB.get("settings", "tier"))?.value,
      };
      const result = await backend.sync({
        type: "pos_sync",
        schemaVersion: 2,
        transactions: sales,
        payments,
        customers,
        business,
        ...(useFirebase
          ? { products, productDeletes: productDeletes.map((t) => t.id), extra }
          : {}),
      });
      if (!result || !Array.isArray(result.acceptedIds))
        throw new Error(
          (result && result.error) ||
            "Backend did not confirm accepted transaction IDs.",
        );
      const changes = InvoiceCore.applySyncResult(sales, payments, result);
      for (const s of changes.sales) await POSDB.put("sales", s);
      for (const p of changes.payments) await POSDB.put("payments", p);
      if (result.balances && typeof result.balances === "object") {
        const cur = (await POSDB.get("settings", "balances"))?.value || {};
        const at = Date.now();
        for (const [id, amount] of Object.entries(result.balances))
          if (Number.isFinite(Number(amount)))
            cur[id] = { amount: Number(amount), at };
        await POSDB.put("settings", { key: "balances", value: cur });
      }
      const cloud = useFirebase
        ? await applyCloud(result, products, productDeletes)
        : null;
      const more = useFirebase
        ? await applyExtra(result, extra)
        : { synced: 0, rejected: 0 };
      const synced =
        changes.sales.filter((s) => s.syncStatus === "synced").length +
        changes.payments.filter((p) => p.syncStatus === "synced").length +
        more.synced;
      const rej =
        changes.sales.length +
        changes.payments.length -
        (synced - more.synced) +
        more.rejected;
      if (rej)
        setSyncUI(
          "Sync needs attention",
          synced +
            " synchronised, " +
            rej +
            " rejected by your ledger. See Accounts.",
        );
      else if (cloud && cloud.rejectedProducts)
        setSyncUI(
          "Sync needs attention",
          synced +
            " synchronised. " +
            cloud.rejectedProducts +
            " product(s) were refused by the cloud rules; check their fields.",
        );
      else
        setSyncUI(
          "Sync complete",
          synced +
            " record(s) synchronised." +
            (cloud && cloud.summary ? " " + cloud.summary : ""),
        );
      if (window.InvoiceUI) await InvoiceUI.render();
      if (typeof refresh === "function") await refresh();
    } catch (e) {
      setSyncUI("Sync needs attention", e.message);
      throw e;
    } finally {
      this.running = false;
    }
  },
};
// Record kinds besides sales and payments that sync to the cloud account (one local store each).
const EXTRA_STORES = [
  "refunds",
  "registers",
  "stockMoves",
  "suppliers",
  "purchaseOrders",
  "quotes",
];
/* Mark a record synced ONLY if the server returned its id; a refused one keeps the reason and is flagged.
 * A record edited while the sync was running (its updatedAt changed) is left pending, so no edit is lost. */
async function applyExtra(result, extra) {
  const rej = new Map(
    (result.rejected || []).map((r) => [
      String(r.id),
      String(r.reason || "Rejected by the cloud").slice(0, 200),
    ]),
  );
  let synced = 0,
    rejected = 0;
  for (const [store, recs] of Object.entries(extra)) {
    const acc = new Set((result.acceptedExtra || {})[store] || []);
    for (const r of recs) {
      const isAcc = acc.has(r.id),
        isRej = !isAcc && rej.has(r.id);
      if (!isAcc && !isRej) continue;
      const cur = await POSDB.get(store, r.id);
      if (cur && (cur.updatedAt || 0) !== (r.updatedAt || 0)) continue;
      const { syncError, ...rest } = r;
      if (isAcc) {
        await POSDB.put(store, { ...rest, syncStatus: "synced" });
        synced++;
      } else {
        await POSDB.put(store, {
          ...rest,
          syncStatus: "rejected",
          syncError: rej.get(r.id),
        });
        rejected++;
      }
    }
  }
  return { synced, rejected };
}
/* Apply what the cloud confirmed. Local products are marked cloudSyncedAt ONLY for ids the server accepted;
 * a product removal tombstone is cleared ONLY when the server confirmed the delete. */
async function applyCloud(result, sentProducts, sentDeletes) {
  const accepted = new Map(
    (result.acceptedProducts || []).map((p) => [p.id, p.updatedAt]),
  );
  for (const p of sentProducts) {
    if (!accepted.has(p.id)) continue;
    const cur = await POSDB.get("products", p.id);
    // Only if it was not edited again while the sync was running.
    if (cur && (cur.updatedAt || 0) === accepted.get(p.id))
      await POSDB.put("products", {
        ...cur,
        cloudSyncedAt: accepted.get(p.id),
      });
  }
  if (sentDeletes.length) {
    const done = new Set(result.deletedProductIds || []);
    const left = sentDeletes.filter((t) => !done.has(t.id));
    if (left.length !== sentDeletes.length)
      await POSDB.put("settings", { key: "productTombstones", value: left });
  }
  let added = 0,
    removed = 0;
  if (Array.isArray(result.cloudProducts)) {
    const tomb = new Set(
      ((await POSDB.get("settings", "productTombstones"))?.value || []).map(
        (t) => t.id,
      ),
    );
    const { upserts, removes } = FirebaseBackend.mergeProducts(
      await POSDB.all("products"),
      result.cloudProducts.filter((c) => !tomb.has(c.id)),
    );
    for (const p of upserts) {
      await POSDB.put("products", p);
      added++;
    }
    for (const id of removes) {
      await POSDB.remove("products", id);
      removed++;
    }
  }
  // Trade customers created by the owner appear on cashier devices. Existing local customers are never overwritten.
  if (Array.isArray(result.cloudCustomers)) {
    for (const c of result.cloudCustomers) {
      if (!c || !c.id || (await POSDB.get("customers", c.id))) continue;
      await POSDB.put("customers", { ...c, type: "trade" });
    }
  }
  const parts = [];
  if (added) parts.push(added + " product(s) updated from the cloud.");
  if (removed) parts.push(removed + " product(s) removed by the owner.");
  return {
    summary: parts.join(" "),
    rejectedProducts: (result.rejectedProducts || []).length,
  };
}
function setSyncUI(title, detail) {
  const a = document.getElementById("syncStatus"),
    b = document.getElementById("syncDetail");
  if (a) a.textContent = title;
  if (b) b.textContent = detail;
}
