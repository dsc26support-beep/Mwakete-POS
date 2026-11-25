/* Security screen: device name, screen lock (PIN + idle), tamper-evident activity log.
 * Logic lives in security.js (SecurityCore). window.Audit.log(action, detail) is called from the other screens. */
const SecurityUI = (() => {
  const S = SecurityCore,
    $ = (id) => document.getElementById(id);
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
  let log = [];
  let pin = null; // {salt, hash, rounds}
  let idle = 0;
  let fail = { fails: 0, lockedUntil: 0 };
  let lastActive = Date.now();
  let locked = false;
  let chain = Promise.resolve();

  const setting = async (k) => (await POSDB.get("settings", k))?.value;
  const put = (k, v) => POSDB.put("settings", { key: k, value: v });

  async function deviceId() {
    return (await setting("deviceCode")) || "";
  }
  async function actor() {
    try {
      if (
        typeof FirebaseBackend !== "undefined" &&
        FirebaseBackend.isSignedIn()
      )
        return FirebaseBackend.email() || "signed in";
    } catch {}
    return "this device";
  }

  /* One entry at a time, so two quick actions cannot fork the chain. */
  function logEntry(action, detail) {
    const run = async () => {
      log = await S.append(log, {
        action,
        detail,
        actor: await actor(),
        deviceId: await deviceId(),
      });
      await put("auditLog", log);
      renderLog();
    };
    chain = chain.then(run, run);
    return chain.catch(() => {});
  }

  /* ---------- log screen ---------- */
  function renderLog() {
    const o = { q: $("auditText").value, action: $("auditAction").value };
    const list = S.filter(log, o).slice().reverse();
    $("auditList").innerHTML = list.length
      ? list
          .slice(0, 100)
          .map(
            (e) =>
              `<div class="resource-row"><div><strong>${esc(S.ACTIONS[e.action] || e.action)}</strong><small>${esc(new Date(e.at).toLocaleString())} · ${esc(e.actor || "")}${e.deviceId ? " · device " + esc(e.deviceId) : ""}</small>${e.detail ? `<small>${esc(e.detail)}</small>` : ""}</div></div>`,
          )
          .join("")
      : '<p class="empty">Nothing in the activity log yet.</p>';
  }
  async function checkLog() {
    const v = await S.verify(log);
    $("auditState").textContent = v.ok
      ? log.length +
        " entries. Chain check passed: no entry has been changed or removed since it was written."
      : "Warning: the activity log was changed (" +
        v.reason +
        " Entry " +
        (v.index + 1) +
        "). Keep a copy and tell the owner.";
    $("auditState").className = v.ok ? "hint" : "low";
  }

  /* ---------- lock ---------- */
  function lock(reason) {
    if (!pin || locked) return;
    locked = true;
    $("lockError").textContent = "";
    $("lockPin").value = "";
    $("lockScreen").classList.remove("hidden");
    $("lockPin").focus();
    logEntry("lock", reason || "");
  }
  function unlockUi() {
    locked = false;
    lastActive = Date.now();
    $("lockScreen").classList.add("hidden");
  }
  async function tryUnlock(e) {
    e.preventDefault();
    const wait = S.waitSeconds(fail);
    if (wait > 0) {
      $("lockError").textContent =
        "Too many wrong PINs. Wait " + wait + " seconds.";
      return;
    }
    const entered = $("lockPin").value;
    const good = await S.checkPin(pin, entered);
    fail = S.afterAttempt(fail, good);
    await put("pinFail", fail);
    if (good) {
      unlockUi();
      logEntry("unlock", "");
    } else {
      $("lockError").textContent =
        S.waitSeconds(fail) > 0
          ? "Too many wrong PINs. Wait " + S.waitSeconds(fail) + " seconds."
          : "That PIN is not right.";
      $("lockPin").value = "";
      logEntry("unlock-failed", "");
    }
  }

  /* ---------- setup forms ---------- */
  function renderPinState() {
    $("pinState").textContent = pin
      ? "A PIN is set. The screen locks " +
        (idle ? "after " + idle + " minute(s) without use and " : "") +
        "whenever the app is reopened."
      : "No PIN is set, so the screen never locks.";
    $("idleSelect").value = String(idle);
  }
  async function renderDevice() {
    $("deviceCodeText").textContent =
      (await deviceId()) || "created with the first sale";
    $("appVersionText").textContent =
      (typeof Diagnostics !== "undefined" && Diagnostics.APP_VERSION) || "";
    const name = await setting("deviceName");
    $("deviceForm").elements.deviceName.value = name || "";
    try {
      const p =
        navigator.storage && navigator.storage.persisted
          ? await navigator.storage.persisted()
          : null;
      $("persistText").textContent =
        p === null ? "unknown on this browser" : p ? "yes" : "not guaranteed";
    } catch {
      $("persistText").textContent = "unknown";
    }
  }

  async function init() {
    log = (await setting("auditLog")) || [];
    pin = (await setting("pinRecord")) || null;
    idle = Number(await setting("idleMinutes")) || 0;
    fail = (await setting("pinFail")) || fail;
    $("auditAction").innerHTML =
      '<option value="">All activity</option>' +
      Object.entries(S.ACTIONS)
        .map(([k, v]) => `<option value="${k}">${esc(v)}</option>`)
        .join("");
    renderLog();
    renderPinState();
    await renderDevice();
    await checkLog();

    $("auditText").addEventListener("input", renderLog);
    $("auditAction").addEventListener("input", renderLog);
    $("auditExport").addEventListener("click", () => {
      const url = URL.createObjectURL(
        new Blob(["﻿" + S.toCsv(log)], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download =
        "activity-log-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });

    $("deviceForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const n = S.deviceName($("deviceForm").elements.deviceName.value);
      if (!n.ok) return toast(n.error);
      await put("deviceName", n.value);
      logEntry("device-rename", n.value);
      toast("Device name saved.");
    });
    $("persistBtn").addEventListener("click", async () => {
      try {
        const ok =
          navigator.storage && navigator.storage.persist
            ? await navigator.storage.persist()
            : false;
        toast(
          ok
            ? "The browser will keep your data."
            : "The browser did not agree. Keep regular backups.",
        );
      } catch {
        toast("This browser cannot do that. Keep regular backups.");
      }
      renderDevice();
    });

    $("pinForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget.elements; // read before awaiting
      const entered = f.pin.value;
      const minutes = Number(f.idle.value) || 0;
      if (entered) {
        const m = await S.makePin(entered);
        if (!m.ok) return toast(m.error);
        pin = m.record;
        await put("pinRecord", pin);
        logEntry("pin-set", "");
        f.pin.value = "";
      } else if (!pin && minutes) {
        return toast("Set a PIN first.");
      }
      idle = pin ? minutes : 0;
      await put("idleMinutes", idle);
      renderPinState();
      toast("Lock settings saved.");
    });
    $("pinClear").addEventListener("click", async () => {
      if (!pin) return toast("No PIN is set.");
      if (!confirm("Remove the lock PIN? The screen will no longer lock."))
        return;
      pin = null;
      idle = 0;
      await POSDB.remove("settings", "pinRecord");
      await put("idleMinutes", 0);
      logEntry("pin-clear", "");
      renderPinState();
    });
    $("lockNow").addEventListener("click", () =>
      pin ? lock("manual") : toast("Set a PIN first."),
    );
    $("lockForm").addEventListener("submit", tryUnlock);

    for (const ev of ["pointerdown", "keydown", "touchstart"])
      document.addEventListener(
        ev,
        () => {
          if (!locked) lastActive = Date.now();
        },
        { passive: true },
      );
    setInterval(() => {
      if (pin && !locked && S.idleDue(lastActive, idle)) lock("idle");
    }, 10000);
    if (pin) lock("app opened");
  }
  window.Audit = { log: logEntry };
  return { init, lock, render: renderDevice, isLocked: () => locked };
})();
if (typeof window !== "undefined") window.SecurityUI = SecurityUI;
