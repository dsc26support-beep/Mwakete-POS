/* Mwakete marketplace integration boundary.
 * Implement only against verified, existing Mwakete APIs and authentication.
 * Never create a second marketplace customer, seller, order or inventory authority.
 *
 * STATUS: NOT CONNECTED. The Mwakete API contract (endpoints, authentication, tenancy rules) has not been supplied,
 * so nothing here calls any network address. Every method refuses with a clear reason instead of guessing.
 * The POS works fully on its own without this adapter. See docs/MWAKETE_INTEGRATION.md for what is needed to connect it. */
const MwaketeIntegration = {
  // What must be supplied by the Mwakete team before real code can be written (shown on the Setup screen).
  requirements: [
    "The documented identity / sign-in service for sellers, and how a POS device is authorised for one store",
    "The documented catalogue and inventory endpoints (read products, read and change stock) and their data shapes",
    "The documented order / sale submission endpoint, with an idempotency key rule, and error codes",
    "Which store (tenant) a seller owns, and the rule that keeps marketplace data apart from independent-business data",
    "A test environment and test accounts, so nothing is tried on the live marketplace",
  ],
  async status() {
    return {
      connected: false,
      configured: false,
      reason:
        "The Mwakete API details have not been supplied yet, so this POS runs on its own. Nothing is sent to Mwakete.",
    };
  },
  async authenticate() {
    throw new Error(
      "Mwakete sign-in is not configured. It needs the existing Mwakete identity service; no separate login is created here.",
    );
  },
  async disconnect() {
    // Nothing is connected, so there is nothing to undo; kept so the screen's Disconnect button has one honest answer.
    return { connected: false, changed: false };
  },
  async getCatalogue() {
    throw new Error("Mwakete catalogue API is not configured.");
  },
  async submitSale() {
    throw new Error("Mwakete sales API is not configured.");
  },

  /* READY-TO-FILL ADAPTER (draft, UNVERIFIED against any real Mwakete API).
   * `create(cfg)` returns a working adapter only when every field of the contract in docs/MWAKETE_INTEGRATION.md has been
   * supplied: cfg = {baseUrl (https), storeId, getToken: async () => string, fetchImpl?}. Nothing in the app calls create(),
   * so the POS stays disconnected until the real endpoints are written in and reviewed. The paths below are PLACEHOLDERS
   * named after the contract template, not Mwakete's real endpoints. Tests run it against a fake server only. */
  create(cfg) {
    const bad = [];
    if (!cfg || typeof cfg !== "object") bad.push("config");
    else {
      if (
        !/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/i.test(
          String(cfg.baseUrl || ""),
        )
      )
        bad.push("baseUrl (https)");
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(String(cfg.storeId || "")))
        bad.push("storeId");
      if (typeof cfg.getToken !== "function") bad.push("getToken");
    }
    if (bad.length)
      throw new Error(
        "Mwakete is not configured. Missing or invalid: " +
          bad.join(", ") +
          ".",
      );
    const base = cfg.baseUrl.replace(/\/+$/, "");
    const doFetch =
      cfg.fetchImpl ||
      (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (!doFetch) throw new Error("No way to reach the network.");
    // Marketplace data is addressed only by the marketplace store id; independent-business ids never go in a request.
    const call = async (method, path, body, key) => {
      const token = await cfg.getToken();
      if (!token)
        throw Object.assign(new Error("Not signed in to Mwakete."), {
          code: "auth",
        });
      const headers = {
        authorization: "Bearer " + token,
        "content-type": "application/json",
        "x-store-id": cfg.storeId,
      };
      if (key) headers["idempotency-key"] = String(key).slice(0, 80);
      const res = await doFetch(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 401 || res.status === 403)
        throw Object.assign(new Error("Mwakete refused this device."), {
          code: "auth",
        });
      if (res.status === 409) return { duplicate: true }; // same idempotency key: already recorded
      if (res.status >= 500 || res.status === 429)
        throw Object.assign(new Error("Mwakete is busy. Try again."), {
          code: "retry",
        });
      if (!res.ok)
        throw Object.assign(
          new Error("Mwakete rejected the request (" + res.status + ")."),
          { code: "rejected" },
        );
      return res.json();
    };
    return {
      configured: true,
      async status() {
        try {
          await call("GET", "/status");
          return { connected: true, configured: true, reason: "" };
        } catch (e) {
          return { connected: false, configured: true, reason: e.message };
        }
      },
      getCatalogue: () => call("GET", "/catalogue"),
      submitSale: (sale) => {
        if (!sale || !sale.id) throw new Error("A sale needs an id.");
        // The sale id is the idempotency key, so a retry after a lost answer can never record the sale twice.
        return call(
          "POST",
          "/sales",
          {
            id: sale.id,
            createdAt: sale.createdAt,
            total: sale.total,
            items: sale.items,
          },
          sale.id,
        );
      },
    };
  },
};
if (typeof module !== "undefined") module.exports = MwaketeIntegration;
