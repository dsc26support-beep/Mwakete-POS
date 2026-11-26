/* PwaCore — small pure helpers for install, update and sync-backlog messages. No DOM. Unit tested in Node. */
(function (root) {
  const isIos = (ua) => /iphone|ipad|ipod/i.test(String(ua || ""));
  const isAndroid = (ua) => /android/i.test(String(ua || ""));
  /* env: {standalone (matchMedia result), navStandalone (iOS navigator.standalone)} */
  const isInstalled = (env) => !!(env && (env.standalone || env.navStandalone));

  /* What to tell the person about installing. */
  function installAdvice(env) {
    if (isInstalled(env))
      return {
        state: "installed",
        text: "Installed: the app opens from your home screen.",
      };
    if (env && env.canPrompt)
      return {
        state: "prompt",
        text: "Install the app on this device for faster start and offline use.",
      };
    if (isIos(env && env.ua))
      return {
        state: "ios",
        text: "On iPhone or iPad: tap the Share button, then Add to Home Screen.",
      };
    if (isAndroid(env && env.ua))
      return {
        state: "android",
        text: "In the browser menu choose Install app or Add to Home screen.",
      };
    return {
      state: "browser",
      text: "In the browser menu look for Install or Add to Home screen.",
    };
  }

  /* A service worker taking control for the FIRST time is the first install, not an update. */
  const updateReady = (hadController, nowHasController) =>
    !!hadController && !!nowHasController;

  const UNSYNCED = new Set([
    "pending",
    "rejected",
    "failed",
    undefined,
    null,
    "",
  ]);
  /* Counts of records still waiting to reach the cloud, per store. Rejected ones are counted separately. */
  function backlog(stores) {
    const out = { waiting: 0, refused: 0 };
    for (const recs of Object.values(stores || {}))
      for (const r of recs || []) {
        if (!r || r.syncStatus === "synced") continue;
        if (r.syncStatus === "rejected") out.refused++;
        else if (UNSYNCED.has(r.syncStatus)) out.waiting++;
      }
    return out;
  }
  function backlogText(b, online, signedIn) {
    if (!b.waiting && !b.refused)
      return signedIn ? "Everything is synced." : "";
    const parts = [];
    if (b.waiting) parts.push(b.waiting + " waiting to sync");
    if (b.refused) parts.push(b.refused + " refused by the cloud");
    return parts.join(", ") + (online ? "" : " (offline)");
  }

  const api = {
    isIos,
    isAndroid,
    isInstalled,
    installAdvice,
    updateReady,
    backlog,
    backlogText,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PwaCore = api;
})(typeof window !== "undefined" ? window : globalThis);
