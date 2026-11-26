/* OnboardingCore — first-run set-up: business name, currency, edition, accepted payment methods, device name.
 * Pure: validates the answers and says which settings to write. No DOM, no storage. Unit tested in Node. */
(function (root) {
  const EDITIONS = ["counter", "retail", "wholesale"];
  const METHODS = ["cash", "eftpos", "internet_banking", "mpaisa", "other"];
  const clean = (s, n) =>
    String(s == null ? "" : s)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, n);

  function validate(input) {
    const name = clean(input.businessName, 100);
    if (!name) return { ok: false, error: "Enter your business name." };
    const currency = clean(input.currency, 8).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency))
      return {
        ok: false,
        error: "Enter a 3-letter currency code, for example AUD.",
      };
    const edition = EDITIONS.includes(input.edition) ? input.edition : null;
    if (!edition)
      return { ok: false, error: "Choose Counter, Retail or Wholesale." };
    const asked = Array.isArray(input.methods) ? input.methods : [];
    const methods = METHODS.filter((m) => m === "cash" || asked.includes(m)); // cash is always on
    const device = clean(input.deviceName, 30);
    if (!device)
      return {
        ok: false,
        error: "Give this device a name, for example Front till.",
      };
    return {
      ok: true,
      value: {
        businessName: name,
        currency,
        edition,
        methods,
        deviceName: device,
      },
    };
  }

  /* The settings records to save for a valid answer. */
  function toSettings(v, now = Date.now()) {
    return [
      { key: "businessName", value: v.businessName },
      { key: "currency", value: v.currency },
      { key: "payMethods", value: v.methods },
      { key: "deviceName", value: v.deviceName },
      { key: "onboarded", value: { at: now, edition: v.edition } },
    ];
  }

  /* Show the set-up card only on a brand-new install that nobody has used yet. */
  function needed(s) {
    if (s.onboarded || s.dismissed) return false;
    return !s.businessName && !s.hasProducts && !s.hasSales;
  }

  /* Which payment-method options a sale screen should offer. null/undefined means "all" (older installs). */
  function enabledMethods(setting) {
    if (!Array.isArray(setting)) return METHODS.slice();
    const list = METHODS.filter((m) => m === "cash" || setting.includes(m));
    return list;
  }

  const api = {
    EDITIONS,
    METHODS,
    validate,
    toSettings,
    needed,
    enabledMethods,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OnboardingCore = api;
})(typeof window !== "undefined" ? window : globalThis);
