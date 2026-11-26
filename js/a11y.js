/* Keyboard behaviour for dialogs (the .modal elements): while one is open, Tab and Shift+Tab stay inside it,
 * focus moves into it when it opens, and returns to the control that opened it when it closes.
 * Works by watching the "hidden" class, so every dialog gets this without changing the code that opens it. */
const A11y = (() => {
  const FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const opener = new WeakMap();
  let lastOutside = null;

  const visible = (el) =>
    !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const focusables = (modal) =>
    [...modal.querySelectorAll(FOCUSABLE)].filter(visible);
  const openModal = () =>
    [...document.querySelectorAll(".modal")].find(
      (m) => !m.classList.contains("hidden"),
    );

  function watch(modal) {
    let wasOpen = !modal.classList.contains("hidden");
    new MutationObserver(() => {
      const isOpen = !modal.classList.contains("hidden");
      if (isOpen === wasOpen) return;
      wasOpen = isOpen;
      if (isOpen) {
        // The opening code often moves focus into the dialog before this runs, so use the last thing
        // focused OUTSIDE any dialog as the one to return to.
        if (!opener.has(modal)) opener.set(modal, lastOutside);
        if (!modal.contains(document.activeElement)) {
          const first = focusables(modal)[0];
          if (first) first.focus();
        }
      } else {
        const back = opener.get(modal);
        opener.delete(modal);
        if (
          back &&
          document.contains(back) &&
          visible(back) &&
          typeof back.focus === "function"
        )
          back.focus();
      }
    }).observe(modal, { attributes: true, attributeFilter: ["class"] });
  }

  function init() {
    document.querySelectorAll(".modal").forEach(watch);
    document.addEventListener("focusin", (e) => {
      if (!e.target.closest || !e.target.closest(".modal"))
        lastOutside = e.target;
    });
    // A row that acts like a button (role="button" tabindex="0") also works with Enter and Space.
    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented || (e.key !== "Enter" && e.key !== " ")) return;
      const t = e.target;
      if (
        t &&
        t.matches &&
        t.matches('[role="button"][tabindex]') &&
        !t.matches("button,a,input,select,textarea")
      ) {
        e.preventDefault();
        t.click();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const m = openModal();
      if (!m) return;
      const f = focusables(m);
      if (!f.length) return e.preventDefault();
      const first = f[0],
        last = f[f.length - 1];
      if (!m.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }
  return { init, focusables };
})();
if (typeof document !== "undefined") A11y.init();
