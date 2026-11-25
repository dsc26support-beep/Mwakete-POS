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

  async function init() {
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
  };
})();
if (typeof window !== "undefined") window.PwaUI = PwaUI;
