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
      if (!sales.length && !payments.length) {
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
      // Signed in to the cloud account -> Firebase. Otherwise the optional Google Apps Script backend.
      const useFirebase =
        typeof FirebaseBackend !== "undefined" && FirebaseBackend.isSignedIn();
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
      const synced =
        changes.sales.filter((s) => s.syncStatus === "synced").length +
        changes.payments.filter((p) => p.syncStatus === "synced").length;
      const rej = changes.sales.length + changes.payments.length - synced;
      if (rej)
        setSyncUI(
          "Sync needs attention",
          synced +
            " synchronised, " +
            rej +
            " rejected by your ledger. See Accounts.",
        );
      else setSyncUI("Sync complete", synced + " record(s) synchronised.");
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
function setSyncUI(title, detail) {
  const a = document.getElementById("syncStatus"),
    b = document.getElementById("syncDetail");
  if (a) a.textContent = title;
  if (b) b.textContent = detail;
}
