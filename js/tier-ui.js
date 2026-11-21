/* Business-type (tier) selector and screen visibility. Logic lives in tiers.js (TierCore). */
const TierUI = (() => {
  const T = TierCore,
    $ = (id) => document.getElementById(id);
  let current = T.DEFAULT_TIER;

  function renderChoices() {
    const box = $("tierChoices");
    if (!box) return;
    box.innerHTML = Object.values(T.TIERS)
      .map(
        (t) =>
          `<button type="button" class="chip${t.id === current ? " active" : ""}" data-tier="${t.id}" aria-pressed="${t.id === current}"${t.available ? "" : " disabled"}><strong>${t.title}${t.available ? "" : " (coming soon)"}</strong><small>${t.blurb}</small></button>`,
      )
      .join("");
  }

  async function apply() {
    current = await T.getTier(POSDB);
    document
      .querySelectorAll("[data-feature]")
      .forEach((el) =>
        el.classList.toggle("hidden", !T.has(current, el.dataset.feature)),
      );
    const active = document.querySelector(".tab.active");
    if (active && active.classList.contains("hidden"))
      document.querySelector('.tab[data-view="sale"]').click();
    renderChoices();
    if (window.RetailUI) await RetailUI.render();
  }

  async function choose(id) {
    if (id === current) return;
    const c = T.canChange(current, id);
    if (!c.ok) return toast(c.error);
    if (c.warning && !confirm(c.warning)) return;
    await T.setTier(POSDB, id);
    await apply();
    toast("Business type set to " + T.TIERS[id].title + ".");
  }

  async function init() {
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tier]");
      if (b && !b.disabled) choose(b.dataset.tier);
    });
    await apply();
  }
  return { init, apply, current: () => current };
})();
