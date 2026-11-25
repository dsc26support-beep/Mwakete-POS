/* Backup, restore and support diagnostics screen. Logic lives in backup.js (BackupCore) and diagnostics.js (Diagnostics).
 * Choosing a file to restore only shows a preview; nothing is written until the person confirms. */
const BackupUI = (() => {
  const B = BackupCore,
    $ = (id) => document.getElementById(id);
  let pending = null;

  async function showLast() {
    const at = (await POSDB.get("settings", "lastBackupAt"))?.value;
    const old = at && Date.now() - at > 30 * 86400000;
    $("backupLast").textContent = at
      ? "Last backup file: " +
        new Date(at).toLocaleDateString() +
        (old
          ? ". That was over a month ago: it is a good time to download a new one."
          : ".")
      : "You have not downloaded a backup file yet.";
  }

  async function download() {
    const data = {};
    for (const s of Object.keys(B.STORES)) data[s] = await POSDB.all(s);
    const doc = B.build(data);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(doc)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download =
      "mwakete-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    await POSDB.put("settings", { key: "lastBackupAt", value: Date.now() });
    await showLast();
    toast("Backup file downloaded.");
  }

  async function pick(file) {
    pending = null;
    $("backupPreview").innerHTML = "";
    if (!file) return;
    if (file.size > B.LIMITS.bytes)
      return toast("That file is too big to be a backup of this app.");
    const r = B.parse(await file.text());
    if (!r.ok) return toast(r.error);
    pending = r;
    const skipped = r.skipped.length + (r.skipped.skipped || 0);
    $("backupPreview").innerHTML =
      `<p>This backup${r.exportedAt ? " from <strong>" + esc(new Date(r.exportedAt).toLocaleString()) + "</strong>" : ""} has: <strong>${esc(B.summary(r.counts))}</strong>.</p>` +
      (skipped
        ? `<p class="notice warn">${skipped} record(s) in the file are damaged and will be left out: ${esc(
            r.skipped
              .slice(0, 3)
              .map((s) => s.store + " " + (s.key || "?") + " " + s.reason)
              .join("; "),
          )}${skipped > 3 ? "…" : ""}</p>`
        : "") +
      '<p class="muted">Records with the same ID are replaced by the ones in the file. Nothing is deleted.</p><button class="button primary" type="button" id="backupRestore">Restore these records</button>';
  }

  async function restore() {
    if (!pending) return;
    if (
      !confirm(
        "Restore " +
          B.summary(pending.counts) +
          " from this backup?\n\nRecords with the same ID will be replaced.",
      )
    )
      return;
    let n = 0;
    for (const [store, recs] of Object.entries(pending.stores))
      for (const r of recs) (await POSDB.put(store, r), n++);
    pending = null;
    toast(n + " records restored. Reloading…");
    setTimeout(() => location.reload(), 900); // the simplest way to redraw every screen from the restored data
  }

  async function diagnostics() {
    const text = Diagnostics.buildReport(await Diagnostics.gather());
    $("diagText").textContent = text;
    const to =
      typeof GuidesCore !== "undefined" ? GuidesCore.SUPPORT_EMAIL : "";
    $("diagMail").href =
      "mailto:" +
      to +
      "?subject=" +
      encodeURIComponent("Mwakete POS diagnostics") +
      "&body=" +
      encodeURIComponent(text.slice(0, 1500));
    return text;
  }

  async function init() {
    if (!$("backupPanel")) return;
    $("backupDownload").addEventListener("click", () =>
      download().catch((e) => toast("Could not make the backup: " + e.message)),
    );
    $("backupFile").addEventListener("change", (e) =>
      pick(e.target.files && e.target.files[0]).catch((err) =>
        toast(err.message),
      ),
    );
    $("backupPreview").addEventListener(
      "click",
      (e) =>
        e.target.closest("#backupRestore") &&
        restore().catch((err) => toast("Restore stopped: " + err.message)),
    );
    $("diagBox").addEventListener(
      "toggle",
      () => $("diagBox").open && diagnostics(),
    );
    $("diagCopy").addEventListener("click", async () => {
      const text = await diagnostics();
      try {
        await navigator.clipboard.writeText(text);
        toast("Copied. Paste it into a message to support.");
      } catch (_) {
        toast("Select the text below and copy it.");
      }
    });
    await showLast();
  }
  return { init };
})();
window.BackupUI = BackupUI;
