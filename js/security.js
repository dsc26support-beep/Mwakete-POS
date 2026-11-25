/* SecurityCore — device-side protection that needs no server:
 *  - a tamper-evident audit log (each entry carries a SHA-256 hash of the one before it),
 *  - a screen-lock PIN (salted SHA-256, wrong-attempt lock-out),
 *  - idle timing and device naming.
 * Honest limits (also shown on screen): the audit log and PIN live in this browser's storage, so they stop casual misuse and
 * make edits to the log detectable, but they cannot stop someone who controls the device. Pure module; async hashing via WebCrypto. */
(function (root) {
  const subtle = () =>
    (root.crypto && root.crypto.subtle) ||
    (typeof require !== "undefined"
      ? require("node:crypto").webcrypto.subtle
      : null);
  const MAX_LOG = 1000;
  const GENESIS = "0".repeat(64);
  const ACTIONS = {
    "sign-in": "Signed in",
    "sign-out": "Signed out",
    "staff-change": "Staff added or changed",
    "product-edit": "Product edited",
    "product-bulk": "Bulk product change",
    "product-remove": "Product removed",
    refund: "Refund recorded",
    "register-open": "Register opened",
    "register-close": "Register closed",
    "backup-restore": "Backup restored",
    "receipt-send": "Receipt sent",
    "device-rename": "Device renamed",
    "pin-set": "Lock PIN set or changed",
    "pin-clear": "Lock PIN removed",
    lock: "Screen locked",
    unlock: "Screen unlocked",
    "unlock-failed": "Wrong PIN",
    "discount-override": "Discount approved",
    "refund-override": "Refund approved",
    "approval-set": "Approval PIN or limits changed",
    "approval-failed": "Approval refused",
  };
  const hex = (buf) =>
    [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  async function sha256(text) {
    return hex(
      await subtle().digest("SHA-256", new TextEncoder().encode(text)),
    );
  }
  const clean = (s, n) =>
    String(s == null ? "" : s)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, n);

  /* ---------- audit log ---------- */
  const body = (e) =>
    [e.id, e.at, e.action, e.detail, e.actor, e.deviceId, e.prev].join("|");
  async function makeEntry(prevEntry, input, now = Date.now()) {
    const e = {
      id: now.toString(36) + Math.random().toString(16).slice(2, 8),
      at: now,
      action: ACTIONS[input.action] ? input.action : "other",
      detail: clean(input.detail, 200),
      actor: clean(input.actor, 60),
      deviceId: clean(input.deviceId, 12),
      prev: prevEntry ? prevEntry.hash : GENESIS,
    };
    e.hash = await sha256(body(e));
    return e;
  }
  async function append(list, input, now) {
    const log = Array.isArray(list) ? list.slice() : [];
    log.push(await makeEntry(log[log.length - 1], input, now));
    // Keep the newest entries; the first kept entry's "prev" still points at what was dropped, so the chain stays checkable.
    return log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log;
  }
  /* Returns {ok:true} or {ok:false, index, reason}. The first entry's own "prev" is trusted (older entries may have been trimmed). */
  async function verify(list) {
    for (let i = 0; i < (list || []).length; i++) {
      const e = list[i];
      if (!e || typeof e.hash !== "string")
        return { ok: false, index: i, reason: "An entry is damaged." };
      if (i > 0 && e.prev !== list[i - 1].hash)
        return {
          ok: false,
          index: i,
          reason: "An earlier entry was removed or changed.",
        };
      if ((await sha256(body(e))) !== e.hash)
        return {
          ok: false,
          index: i,
          reason: "An entry was changed after it was written.",
        };
    }
    return { ok: true };
  }
  function filter(list, o = {}) {
    const q = String(o.q || "")
      .toLowerCase()
      .trim();
    return (list || []).filter((e) => {
      if (o.action && e.action !== o.action) return false;
      if (o.from && e.at < o.from) return false;
      if (o.to && e.at > o.to) return false;
      if (
        q &&
        !(e.detail + " " + e.actor + " " + (ACTIONS[e.action] || ""))
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }
  const safe = (v) => (/^[=+\-@\t\r]/.test(String(v)) ? "'" + v : String(v));
  const cell = (v) => {
    const s = safe(v == null ? "" : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  function toCsv(list) {
    const rows = ["time,action,detail,who,device,hash"];
    for (const e of list || [])
      rows.push(
        [
          new Date(e.at).toISOString(),
          ACTIONS[e.action] || e.action,
          e.detail,
          e.actor,
          e.deviceId,
          e.hash,
        ]
          .map(cell)
          .join(","),
      );
    return rows.join("\r\n") + "\r\n";
  }

  /* ---------- PIN ---------- */
  const PIN_RE = /^\d{4,8}$/;
  const LOCK = { attempts: 5, seconds: 30 };
  function validPin(pin) {
    if (!PIN_RE.test(String(pin)))
      return { ok: false, error: "Use 4 to 8 digits." };
    if (
      /^(\d)\1+$/.test(pin) ||
      "0123456789".includes(pin) ||
      "9876543210".includes(pin)
    )
      return {
        ok: false,
        error: "Choose a PIN that is not all the same digit or a simple run.",
      };
    return { ok: true };
  }
  function randomSalt() {
    const a = new Uint8Array(16);
    (root.crypto || require("node:crypto").webcrypto).getRandomValues(a);
    return hex(a);
  }
  async function makePin(pin, salt = randomSalt()) {
    const v = validPin(pin);
    if (!v.ok) return v;
    // Stretch a little so a copied hash is slower to brute-force (10,000 rounds).
    let h = await sha256(salt + ":" + pin);
    for (let i = 0; i < 10000; i++) h = await sha256(h + salt);
    return { ok: true, record: { salt, hash: h, rounds: 10000 } };
  }
  async function checkPin(record, pin) {
    if (!record || !record.hash) return false;
    let h = await sha256(record.salt + ":" + pin);
    for (let i = 0; i < (record.rounds || 0); i++)
      h = await sha256(h + record.salt);
    return h === record.hash;
  }
  /* state: {fails, lockedUntil}. Returns the next state after an attempt. */
  function afterAttempt(state, success, now = Date.now()) {
    if (success) return { fails: 0, lockedUntil: 0 };
    const fails = ((state && state.fails) || 0) + 1;
    return fails >= LOCK.attempts
      ? { fails: 0, lockedUntil: now + LOCK.seconds * 1000 }
      : { fails, lockedUntil: (state && state.lockedUntil) || 0 };
  }
  const waitSeconds = (state, now = Date.now()) =>
    Math.max(0, Math.ceil((((state && state.lockedUntil) || 0) - now) / 1000));

  /* ---------- manager approval ---------- */
  /* limits: {discountPct, refundAmount}; 0 or missing = no limit. kind: "discount" (value in percent) | "refund" (amount). */
  function needsApproval(kind, value, limits) {
    const lim =
      Number(
        limits && limits[kind === "discount" ? "discountPct" : "refundAmount"],
      ) || 0;
    return lim > 0 && Number(value) > lim;
  }
  function validLimits(input) {
    const d =
      input.discountPct === "" || input.discountPct == null
        ? 0
        : Number(input.discountPct);
    const r =
      input.refundAmount === "" || input.refundAmount == null
        ? 0
        : Number(input.refundAmount);
    if (!Number.isFinite(d) || d < 0 || d > 100)
      return {
        ok: false,
        error: "The discount limit must be 0 to 100 percent.",
      };
    if (!Number.isFinite(r) || r < 0 || r > 1e9)
      return { ok: false, error: "The refund limit must be zero or more." };
    return {
      ok: true,
      value: { discountPct: d, refundAmount: Math.round(r * 100) / 100 },
    };
  }

  /* ---------- idle + device ---------- */
  const IDLE_CHOICES = [0, 1, 2, 5, 10, 15, 30];
  const idleDue = (lastActive, minutes, now = Date.now()) =>
    minutes > 0 && now - lastActive >= minutes * 60000;
  function deviceName(raw) {
    const n = clean(raw, 30);
    return n
      ? { ok: true, value: n }
      : { ok: false, error: "Enter a name for this device." };
  }

  const api = {
    ACTIONS,
    MAX_LOG,
    LOCK,
    IDLE_CHOICES,
    GENESIS,
    makeEntry,
    append,
    verify,
    filter,
    toCsv,
    validPin,
    makePin,
    checkPin,
    afterAttempt,
    waitSeconds,
    idleDue,
    deviceName,
    sha256,
    needsApproval,
    validLimits,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SecurityCore = api;
})(typeof window !== "undefined" ? window : globalThis);
