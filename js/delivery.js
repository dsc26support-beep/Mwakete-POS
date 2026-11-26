/* DeliveryCore — receipt delivery queue without paid services or stored credentials.
 * A receipt is sent by opening the owner's own email / SMS / WhatsApp app with the text filled in (mailto:, sms:, wa.me).
 * The app cannot see whether the message really went, so "Delivered" only ever means "the person who sent it confirmed it".
 * States: Queued -> Sending -> Delivered | Failed -> Retry pending -> Sending ...; Cancelled from any unsent state.
 * Pure module: no DOM, no storage. Unit tested in Node. */
(function (root) {
  const CHANNELS = { email: "Email", sms: "SMS", whatsapp: "WhatsApp" };
  const STATES = [
    "Queued",
    "Sending",
    "Delivered",
    "Failed",
    "Retry pending",
    "Cancelled",
  ];
  const MAX_QUEUE = 200;
  const MAX_HISTORY = 12;
  const fail = (error) => ({ ok: false, error });

  const NEXT = {
    Queued: ["Sending", "Cancelled"],
    Sending: ["Delivered", "Failed", "Cancelled"],
    Failed: ["Retry pending", "Cancelled"],
    "Retry pending": ["Sending", "Cancelled"],
    Delivered: [],
    Cancelled: [],
  };
  const canMove = (from, to) => (NEXT[from] || []).includes(to);

  /* Recipient checks. Phone numbers get the default country code when written locally. */
  function normalizePhone(raw, countryCode = "686") {
    let s = String(raw || "").trim();
    if (!s) return fail("Enter a phone number.");
    if (!/^\+?[0-9 ()-]{1,25}$/.test(s))
      return fail("That phone number has characters it should not.");
    const plus = s.startsWith("+");
    let d = s.replace(/\D/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    else if (!plus) d = d.replace(/^0+/, "");
    const cc = String(countryCode || "").replace(/\D/g, "");
    if (!plus && cc && !String(raw).trim().startsWith("00") && d.length <= 9)
      d = cc + d;
    if (d.length < 7 || d.length > 15)
      return fail(
        "A phone number has 7 to 15 digits including the country code.",
      );
    return { ok: true, value: d };
  }
  function checkEmail(raw) {
    const e = String(raw || "").trim();
    if (!e) return fail("Enter an email address.");
    if (
      e.length > 120 ||
      !/^[^\s@,;<>]{1,64}@[^\s@,;<>]{1,100}\.[^\s@,;<>]{2,}$/.test(e)
    )
      return fail("That email address does not look right.");
    return { ok: true, value: e };
  }

  /* Short text for SMS / WhatsApp links (long links are cut off by phones). */
  function shortText(sale, business) {
    const no =
      sale.receiptNo || sale.invoice?.number || String(sale.id).slice(0, 8);
    const items = (sale.items || [])
      .slice(0, 6)
      .map((i) => i.quantity + "x " + i.name)
      .join(", ");
    const more =
      (sale.items || []).length > 6
        ? " +" + ((sale.items || []).length - 6) + " more"
        : "";
    let t =
      (business ? business + " – " : "") +
      "Receipt " +
      no +
      ": " +
      items +
      more +
      ". Total " +
      Number(sale.total).toFixed(2) +
      " " +
      (sale.currency || "") +
      ". Thank you!";
    return t.length > 480 ? t.slice(0, 477) + "..." : t;
  }

  /* The link that opens the right app. Returns {ok, url}. */
  function buildLink(item) {
    if (item.channel === "email") {
      const e = checkEmail(item.to);
      if (!e.ok) return e;
      return {
        ok: true,
        url:
          "mailto:" +
          encodeURIComponent(e.value) +
          "?subject=" +
          encodeURIComponent(
            String(item.subject || "Your receipt").replace(
              /[\u0000-\u001f\u007f]+/g,
              " ",
            ),
          ) +
          "&body=" +
          encodeURIComponent(item.text),
      };
    }
    const p = normalizePhone(item.to, item.countryCode);
    if (!p.ok) return p;
    if (item.channel === "sms")
      return {
        ok: true,
        url: "sms:+" + p.value + "?&body=" + encodeURIComponent(item.text),
      };
    if (item.channel === "whatsapp")
      return {
        ok: true,
        url:
          "https://wa.me/" + p.value + "?text=" + encodeURIComponent(item.text),
      };
    return fail("Unknown channel.");
  }

  function make(input, opts = {}) {
    const now = opts.now || Date.now();
    if (!CHANNELS[input.channel]) return fail("Choose email, SMS or WhatsApp.");
    const probe = buildLink({ ...input, text: input.text || "x" });
    if (!probe.ok) return probe;
    if (!input.text || !String(input.text).trim())
      return fail("There is no receipt text to send.");
    return {
      ok: true,
      item: {
        id:
          opts.id ||
          "d" + now.toString(36) + Math.random().toString(16).slice(2, 6),
        saleId: String(input.saleId || ""),
        channel: input.channel,
        to: String(input.to).trim(),
        countryCode: input.countryCode || "686",
        // no line breaks or control characters in a mail subject (they could add mail headers in some mail apps)
        subject: String(input.subject || "Your receipt")
          .replace(/[\u0000-\u001f\u007f]+/g, " ")
          .trim()
          .slice(0, 100),
        text: String(input.text).slice(0, 2000),
        status: "Queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        history: [{ at: now, status: "Queued" }],
      },
    };
  }

  function move(item, to, opts = {}) {
    const now = opts.now || Date.now();
    if (!canMove(item.status, to))
      return fail(
        "A " +
          item.status.toLowerCase() +
          " message cannot become " +
          to.toLowerCase() +
          ".",
      );
    const next = { ...item, status: to, updatedAt: now };
    if (to === "Sending") next.attempts = (item.attempts || 0) + 1;
    next.history = [...(item.history || []), { at: now, status: to }].slice(
      -MAX_HISTORY,
    );
    if (opts.note) next.note = String(opts.note).slice(0, 100);
    return { ok: true, item: next };
  }

  function add(queue, item) {
    const q = Array.isArray(queue) ? queue.slice() : [];
    if (q.length >= MAX_QUEUE) {
      // Finished messages make room first; waiting ones are never dropped.
      const i = q.findIndex(
        (x) => x.status === "Delivered" || x.status === "Cancelled",
      );
      if (i < 0)
        return fail(
          "The delivery queue is full. Finish or cancel some messages first.",
        );
      q.splice(i, 1);
    }
    q.push(item);
    return { ok: true, queue: q };
  }
  const replace = (queue, item) =>
    (queue || []).map((x) => (x.id === item.id ? item : x));
  const pending = (queue) =>
    (queue || []).filter(
      (x) =>
        x.status === "Queued" ||
        x.status === "Retry pending" ||
        x.status === "Failed" ||
        x.status === "Sending",
    ).length;

  const api = {
    CHANNELS,
    STATES,
    canMove,
    normalizePhone,
    checkEmail,
    shortText,
    buildLink,
    make,
    move,
    add,
    replace,
    pending,
    MAX_QUEUE,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DeliveryCore = api;
})(typeof window !== "undefined" ? window : globalThis);
