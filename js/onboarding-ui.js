/* First-run set-up card and dialog. Logic lives in onboarding.js (OnboardingCore).
 * It is a card on the till, not a pop-up that blocks selling: a shop can start at once and set up later. */
const OnboardingUI = (() => {
  const O = OnboardingCore,
    $ = (id) => document.getElementById(id);

  async function check() {
    const g = async (k) => (await POSDB.get("settings", k))?.value;
    const need = O.needed({
      onboarded: await g("onboarded"),
      dismissed: await g("setupDismissed"),
      businessName: await g("businessName"),
      hasProducts: (await POSDB.all("products")).length > 0,
      hasSales: (await POSDB.all("sales")).length > 0,
    });
    $("setupCard").classList.toggle("hidden", !need);
  }
  async function open() {
    $("onboardError").textContent = "";
    $("onboardPanel").classList.remove("hidden");
    $("onboardForm").elements.businessName.focus();
  }
  async function save(e) {
    e.preventDefault();
    const f = e.currentTarget.elements; // read before awaiting
    const answer = {
      businessName: f.businessName.value,
      currency: f.currency.value,
      edition: f.edition.value,
      deviceName: f.deviceName.value,
      methods: O.METHODS.filter((m) => f["m_" + m] && f["m_" + m].checked),
    };
    const r = O.validate(answer);
    if (!r.ok) {
      $("onboardError").textContent = r.error;
      return;
    }
    for (const s of O.toSettings(r.value)) await POSDB.put("settings", s);
    await TierCore.setTier(POSDB, r.value.edition);
    await TierUI.apply();
    $("onboardPanel").classList.add("hidden");
    await refresh();
    await CheckoutUI.applyMethods();
    await check();
    if (window.Audit)
      Audit.log("device-rename", r.value.deviceName + " (set-up)");
    toast("Set-up saved. Add your first product in the Products tab.");
  }
  async function init() {
    $("setupStart").addEventListener("click", open);
    $("setupSkip").addEventListener("click", async () => {
      await POSDB.put("settings", { key: "setupDismissed", value: true });
      await check();
    });
    $("onboardCancel").addEventListener("click", () =>
      $("onboardPanel").classList.add("hidden"),
    );
    $("onboardForm").addEventListener("submit", save);
    await check();
  }
  return { init, check };
})();
if (typeof window !== "undefined") window.OnboardingUI = OnboardingUI;
