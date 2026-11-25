/* Support diagnostics: a short log of the app's own errors, kept on the device, and a summary the person can copy or email to support.
 * Nothing is sent anywhere automatically. The summary has versions, counts and error messages only: no sales, product names,
 * customer names, amounts or email addresses. */
const Diagnostics = (() => {
  const APP_VERSION = "2026.11.25"; // change with each release (and the service worker cache number)
  const MAX_ERRORS = 30;
  const KEY = "errorLog";
  const clean = (s, n = 300) =>
    String(s ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, n);

  // Newest first, capped. e: {message, where}
  function addError(list, e, now = Date.now()) {
    const message = clean(e && e.message);
    if (!message) return list || [];
    return [
      { at: now, message, where: clean(e && e.where, 80) },
      ...(list || []),
    ].slice(0, MAX_ERRORS);
  }
  const stamp = (t) =>
    new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

  // info: {now, online, tier, cloud:{signedIn, role, verified}, waiting:{store:n}, refused:{store:n}, totals:{store:n}, errors, userAgent}
  function buildReport(info) {
    const list = (o) =>
      Object.entries(o || {})
        .filter(([, n]) => n > 0)
        .map(([k, n]) => k + " " + n)
        .join(", ") || "none";
    const c = info.cloud || {};
    const L = [
      "MWAKETE POS DIAGNOSTICS",
      "App version: " + APP_VERSION,
      "Time: " + stamp(info.now || Date.now()),
      "Online: " + (info.online ? "yes" : "no"),
      "Business type: " + (info.tier || "counter"),
      "Cloud account: " +
        (c.signedIn
          ? "signed in as " +
            (c.role || "owner") +
            ", email " +
            (c.verified ? "verified" : "NOT verified")
          : "not signed in"),
      "Waiting to sync: " + list(info.waiting),
      "Refused by the cloud: " + list(info.refused),
      "Records on this device: " + list(info.totals),
      "Browser: " + clean(info.userAgent, 160),
      "",
      "Recent problems (newest first):",
    ];
    const errs = info.errors || [];
    if (!errs.length) L.push("  none");
    for (const e of errs.slice(0, 10))
      L.push(
        "  " +
          stamp(e.at) +
          "  " +
          e.message +
          (e.where ? " (" + e.where + ")" : ""),
      );
    L.push(
      "",
      "No sales, products, customer names, amounts or email addresses are included.",
    );
    return L.join("\n");
  }

  /* ----- browser glue ----- */
  let chain = Promise.resolve();
  function log(e) {
    chain = chain
      .then(async () => {
        const cur = (await POSDB.get("settings", KEY))?.value || [];
        await POSDB.put("settings", { key: KEY, value: addError(cur, e) });
      })
      .catch(() => {}); // logging must never raise an error of its own
  }
  function install() {
    window.addEventListener("error", (ev) =>
      log({
        message: ev.message,
        where:
          (ev.filename || "").split("/").pop() +
          (ev.lineno ? ":" + ev.lineno : ""),
      }),
    );
    window.addEventListener("unhandledrejection", (ev) =>
      log({
        message:
          "Unhandled: " +
          (ev.reason && ev.reason.message ? ev.reason.message : ev.reason),
        where: "promise",
      }),
    );
  }
  const count = (rs, pred) => (rs || []).filter(pred).length;
  async function gather() {
    const open = (r) =>
      r.syncStatus !== "synced" && r.syncStatus !== "rejected";
    const bad = (r) => r.syncStatus === "rejected";
    const stores = [
      "sales",
      "payments",
      "refunds",
      "registers",
      "stockMoves",
      "suppliers",
      "purchaseOrders",
      "quotes",
    ];
    const waiting = {},
      refused = {},
      totals = {};
    for (const s of stores) {
      const rs = await POSDB.all(s);
      waiting[s] = count(rs, open);
      refused[s] = count(rs, bad);
      totals[s] = rs.length;
    }
    totals.products = (await POSDB.all("products")).length;
    totals.customers = (await POSDB.all("customers")).length;
    const fb = typeof FirebaseBackend !== "undefined" ? FirebaseBackend : null;
    return {
      now: Date.now(),
      online: navigator.onLine,
      tier: (await POSDB.get("settings", "tier"))?.value,
      cloud: {
        signedIn: !!(fb && fb.isSignedIn()),
        role: fb && fb.isSignedIn() ? fb.role() : "",
        verified: !!(fb && fb.isVerified()),
      },
      waiting,
      refused,
      totals,
      errors: (await POSDB.get("settings", KEY))?.value || [],
      userAgent: navigator.userAgent,
    };
  }
  return { APP_VERSION, addError, buildReport, install, gather, log };
})();
if (typeof module !== "undefined") module.exports = Diagnostics;
if (typeof window !== "undefined") Diagnostics.install();
