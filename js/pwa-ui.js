/* Install, update and backlog messages. Logic lives in pwa.js (PwaCore).
 * An update never reloads the page by itself: the cashier chooses when, so a sale in progress is not lost. */
const PwaUI = (() => {
  const P = PwaCore,
    $ = (id) => document.getElementById(id);
  let deferred = null;
  const hadController = !!(
    navigator.serviceWorker && navigator.serviceWorker.controller
  );

  // Listen from the moment this script loads, not at the end of start-up, so an early update is not missed.
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (P.updateReady(hadController, !!navigator.serviceWorker.controller))
        $("updateBar").classList.remove("hidden");
    });
  }

  const env = () => ({
    standalone:
      window.matchMedia && matchMedia("(display-mode: standalone)").matches,
    navStandalone: navigator.standalone === true,
    ua: navigator.userAgent,
    canPrompt: !!deferred,
  });
  function renderInstall() {
    const a = P.installAdvice(env());
    $("installText").textContent = a.text;
    $("installBtn").classList.toggle("hidden", a.state !== "prompt");
    $("installVersion").textContent =
      (typeof Diagnostics !== "undefined" && Diagnostics.APP_VERSION) || "";
  }

  /* "3 waiting to sync" under the sync status. Counts every record kind that syncs. */
  async function renderBacklog() {
    const names = [
      "sales",
      "payments",
      "refunds",
      "registers",
      "stockMoves",
      "suppliers",
      "purchaseOrders",
      "quotes",
    ];
    const stores = {};
    for (const n of names) {
      try {
        stores[n] = await POSDB.all(n);
      } catch {
        stores[n] = [];
      }
    }
    const signedIn =
      typeof FirebaseBackend !== "undefined" && FirebaseBackend.isSignedIn();
    const b = P.backlog(stores);
    $("pendingCount").textContent = P.backlogText(
      b,
      navigator.onLine,
      signedIn,
    );
    return b;
  }

  /* ---------- sync history (last 20 finished runs, kept on this device) ---------- */
  let syncLog = [];
  const MAX_LOG = 20;
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
  function renderSyncLog() {
    const box = $("syncHistory");
    if (!box) return;
    box.innerHTML = syncLog.length
      ? syncLog
          .slice()
          .reverse()
          .map(
            (e) =>
              `<div class="resource-row"><div><strong>${esc(e.title)}</strong><small>${esc(new Date(e.at).toLocaleString())} · ${esc(e.detail)}</small></div></div>`,
          )
          .join("")
      : '<p class="empty">No sync has finished on this device yet.</p>';
  }
  async function logSync(title, detail) {
    const last = syncLog[syncLog.length - 1];
    // the same message twice in a row (automatic retries) is shown once
    if (
      last &&
      last.title === title &&
      last.detail === String(detail).slice(0, 200) &&
      Date.now() - last.at < 60000
    )
      return;
    syncLog.push({
      at: Date.now(),
      title: String(title).slice(0, 40),
      detail: String(detail).slice(0, 200),
    });
    if (syncLog.length > MAX_LOG) syncLog = syncLog.slice(-MAX_LOG);
    try {
      await POSDB.put("settings", { key: "syncLog", value: syncLog });
    } catch {}
    renderSyncLog();
  }

  async function init() {
    syncLog = (await POSDB.get("settings", "syncLog"))?.value || [];
    renderSyncLog();
    $("syncHistoryClear")?.addEventListener("click", async () => {
      syncLog = [];
      await POSDB.put("settings", { key: "syncLog", value: [] });
      renderSyncLog();
      toast("Sync history cleared.");
    });
    renderInstall();
    renderBacklog();
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferred = e;
      renderInstall();
    });
    window.addEventListener("appinstalled", () => {
      deferred = null;
      renderInstall();
      toast("Installed.");
    });
    $("installBtn").addEventListener("click", async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
      renderInstall();
    });
    window.addEventListener("online", renderBacklog);
    window.addEventListener("offline", renderBacklog);

    $("updateReload").addEventListener("click", () => location.reload());
    $("updateLater").addEventListener("click", () =>
      $("updateBar").classList.add("hidden"),
    );

    // Ask the browser not to clear this app's data when space runs low (granted quietly where allowed).
    try {
      if (navigator.storage && navigator.storage.persist)
        navigator.storage.persist();
    } catch {}
  }
  // refresh() runs often; the backlog count is recalculated at most a few times a second.
  let t;
  const render = () =>
    new Promise((res) => {
      clearTimeout(t);
      t = setTimeout(() => res(renderBacklog()), 400);
    });
  return {
    init,
    render: () => (render(), Promise.resolve()),
    now: renderBacklog,
    logSync,
  };
})();
if (typeof window !== "undefined") window.PwaUI = PwaUI;
