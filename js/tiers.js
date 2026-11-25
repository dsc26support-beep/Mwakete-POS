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
    "refunds",
    "register",
    "stock",
  ];
  // Each Wholesale PR turns on only what it ships. Declared-but-off (PR 3-4): purchaseOrders, quotes.
  const WHOLESALE_ONLY = [
    "priceTiers",
    "bulkUnits",
    "tradeCustomers",
    "tax",
    "invoices",
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
      available: true,
      features: [...RETAIL, ...WHOLESALE_ONLY],
      blurb:
        "Trade sellers: everything in Retail plus price lists, pack sizes (cartons), trade customers, and tax invoices with credit accounts (ledger not production-ready yet). Purchase orders and quotes are coming soon.",
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
          " hides screens it does not include (" +
          (normalize(from) === "wholesale" && to === "retail"
            ? "price lists, pack sizes, trade customers"
            : "customers, reports, discounts, price lists") +
          "). Your data is kept and comes back if you switch again."
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
