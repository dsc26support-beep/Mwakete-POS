/* Setup screen for the optional Mwakete Marketplace link. It is honest about being not connected. */
const MwaketeUI = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  async function render() {
    const s = await MwaketeIntegration.status();
    $("mwStatus").textContent = s.connected ? "Connected" : "Not connected";
    $("mwReason").textContent = s.reason;
    $("mwNeeds").innerHTML = MwaketeIntegration.requirements
      .map((r) => `<li>${esc(r)}</li>`)
      .join("");
    $("mwConnect").disabled = !s.configured;
    $("mwDisconnect").disabled = !s.connected;
  }
  async function init() {
    await render();
    $("mwConnect").addEventListener("click", async () => {
      try {
        await MwaketeIntegration.authenticate();
      } catch (e) {
        toast(e.message);
      }
    });
    $("mwDisconnect").addEventListener("click", async () => {
      await MwaketeIntegration.disconnect();
      await render();
      toast("Nothing was connected.");
    });
  }
  return { init, render };
})();
if (typeof window !== "undefined") window.MwaketeUI = MwaketeUI;
