/* Business tiers: Counter (existing app) / Retail / Wholesale.
 * The tier is a UI setting stored locally. It is NOT an authorisation boundary:
 * real enforcement of what a business may do must live in the authenticated backend.
 * Changing tier never deletes data; it only shows or hides screens.
 */
const TierCore = (() => {
  const RETAIL = [
    "barcode",
    "discounts",
    "receipts",
    "customers",
    "categories",
    "reports",
    "lowStock",
  ];
  const WHOLESALE_ONLY = [
    "priceTiers",
    "bulkUnits",
    "invoices",
    "purchaseOrders",
    "quotes",
  ];
  const TIERS = {
    counter: {
      id: "counter",
      title: "Counter",
      available: true,
      features: [],
      blurb:
        "Restaurants and micro-sellers. A short product list and fast cash sales.",
    },
    retail: {
      id: "retail",
      title: "Retail",
      available: true,
      features: RETAIL,
      blurb:
        "Shops with many products: barcode scanning, low-stock alerts, discounts, receipts, customers and reports.",
    },
    wholesale: {
      id: "wholesale",
      title: "Wholesale",
      available: false,
      features: [...RETAIL, ...WHOLESALE_ONLY],
      blurb:
        "Trade sellers: price tiers, bulk units, invoices and purchase orders. Coming soon.",
    },
  };
  const DEFAULT_TIER = "counter";
  const KEY = "tier";

  const normalize = (t) =>
    Object.prototype.hasOwnProperty.call(TIERS, t) ? t : DEFAULT_TIER;
  const has = (tier, feature) =>
    TIERS[normalize(tier)].features.includes(feature);
  // A missing / unknown / unavailable tier always resolves to something usable, so a bad value can never lock a shop out.
  const usable = (t) =>
    TIERS[normalize(t)].available ? normalize(t) : DEFAULT_TIER;

  async function getTier(store) {
    const row = await store.get("settings", KEY);
    return usable(row?.value);
  }
  function canChange(from, to) {
    if (!Object.prototype.hasOwnProperty.call(TIERS, to))
      return { ok: false, error: "Unknown business type." };
    if (!TIERS[to].available)
      return { ok: false, error: TIERS[to].title + " is not available yet." };
    return { ok: true, warning: changeWarning(from, to) };
  }
  // Returned only when features will be hidden. Data is always kept.
  function changeWarning(from, to) {
    const lost = TIERS[normalize(from)].features.filter((f) => !has(to, f));
    return lost.length
      ? "Switching to " +
          TIERS[to].title +
          " hides Retail screens (customers, reports, discounts). Your data is kept and comes back if you switch again."
      : "";
  }
  async function setTier(store, to) {
    const from = await getTier(store);
    const c = canChange(from, to);
    if (!c.ok) return c;
    await store.put("settings", { key: KEY, value: to });
    return { ok: true, tier: to, warning: c.warning };
  }

  return {
    TIERS,
    DEFAULT_TIER,
    KEY,
    normalize,
    usable,
    has,
    getTier,
    setTier,
    canChange,
    changeWarning,
  };
})();
if (typeof module !== "undefined") module.exports = TierCore;
