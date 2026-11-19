/* Guides & Links — in-app help centre (hybrid management model).
 *
 * Official content : bundled with the app (cached by the service worker), managed by Mwakete
 *                    through normal releases. It is read-only for businesses.
 * Business content : links and staff notes the owner adds. Stored locally in the existing
 *                    IndexedDB "settings" store (no schema migration). NOT shared across devices
 *                    until the authenticated backend exists.
 * This file is pure logic + HTML string builders so it can be unit-tested in Node.
 */
const GuidesCore = (() => {
  const CATEGORIES = [
    {
      id: "start",
      icon: "🚀",
      title: "Getting started",
      blurb: "Set up your business",
    },
    {
      id: "inventory",
      icon: "📦",
      title: "Inventory",
      blurb: "Products and stock",
    },
    {
      id: "sales",
      icon: "🧾",
      title: "Sales",
      blurb: "Record and review sales",
    },
    {
      id: "offline",
      icon: "📶",
      title: "Offline POS",
      blurb: "Work without internet",
    },
    {
      id: "google",
      icon: "☁️",
      title: "Google connection",
      blurb: "Sync and backups",
    },
    {
      id: "security",
      icon: "🔒",
      title: "Security",
      blurb: "Keep your business safe",
    },
  ];

  // Official guides describe only what the app does TODAY. Update them whenever behaviour changes.
  const OFFICIAL_GUIDES = [
    {
      id: "g-first-sale",
      category: "sales",
      popular: true,
      title: "How to record your first sale",
      subtitle: "Add items to the cart and complete a cash sale",
      description: "Quick sale screen, cart, cash payment, receipt ID.",
      steps: [
        "Add at least one product in Products (see “How to add products and prices”).",
        "Open Quick sale and tap a product to add it to the cart. Tap + or − to change the quantity.",
        "Check the total. Leave Payment method on Cash.",
        "Tap Complete cash sale. The sale is saved on this device and gets a receipt ID.",
        "Open Sales history to see the sale and its sync status (pending until the server confirms it).",
      ],
    },
    {
      id: "g-add-products",
      category: "inventory",
      popular: true,
      title: "How to add products and prices",
      subtitle: "Create your catalogue and opening stock",
      description: "Products tab: name, price, opening stock, barcode or SKU.",
      steps: [
        "Open Products.",
        "Enter the product name, price and opening stock. Barcode / SKU is optional.",
        "Tap Add product. It is saved on this device straight away.",
        "To remove a product, tap Remove in the product list. Past sales are kept.",
      ],
    },
    {
      id: "g-setup",
      category: "start",
      title: "Set up your business",
      subtitle: "Business name and currency",
      description: "Business setup tab: business name, currency code.",
      steps: [
        "Open Business setup.",
        "Enter your business name and your currency code (for example AUD).",
        "Tap Save settings. These settings are stored on this device.",
        "Leave the Google field empty until your owner-authorised Google connection is ready.",
      ],
    },
    {
      id: "g-offline",
      category: "offline",
      popular: true,
      title: "How to work without internet",
      subtitle: "Keep selling when the connection drops",
      description: "Offline mode, local saving, pending sales.",
      steps: [
        "Open Mwakete POS once while online so the app is saved on your device.",
        "If the internet drops, the top bar shows Offline mode. Keep selling as normal.",
        "Every sale is saved on this device and marked pending.",
        "Do not clear browser data or uninstall the app while sales are pending — unsynced sales would be lost.",
        "When the internet returns, use Sync now (see the synchronise guide).",
      ],
    },
    {
      id: "g-sync",
      category: "offline",
      popular: true,
      title: "How to synchronise offline sales",
      subtitle: "Send pending sales to your business backend",
      description: "Sync now, pending vs synced, what to do if sync fails.",
      steps: [
        "Connect to the internet.",
        "Tap Sync now. A sale becomes Synced only after the server confirms its ID.",
        "If sync fails, the sales stay pending. Nothing is deleted. Try again later.",
        "Sync only works once a business backend URL is saved in Business setup. Until then, sales stay on this device.",
      ],
    },
    {
      id: "g-google",
      category: "google",
      popular: true,
      title: "How to connect Google Sheets",
      subtitle: "Your business data stays in your own Google account",
      description:
        "Owner-authorised Google backend; current status and safety.",
      steps: [
        "Status today: automatic Google sign-in and setup is NOT available yet.",
        "Your business data is meant to live in your own Google account. You stay the owner.",
        "Never type your Google password into Mwakete POS or share it with staff.",
        "If your owner or Mwakete support gave you an Apps Script Web App URL, paste it in Business setup. It must start with https://script.google.com.",
        "Do not use a Web App URL from someone you do not trust.",
      ],
    },
    {
      id: "g-marketplace",
      category: "google",
      title: "Using Mwakete Marketplace with POS",
      subtitle: "Marketplace sellers keep one identity",
      description:
        "Marketplace sellers reuse their existing Mwakete account, customers and inventory.",
      steps: [
        "Status today: the Marketplace connection is NOT active in this version.",
        "Marketplace sellers will sign in with their existing Mwakete account. No second account is needed.",
        "Marketplace stock and customers will stay in Mwakete. Independent businesses keep their data separate.",
      ],
    },
    {
      id: "g-digital-pay",
      category: "sales",
      title: "Other payment methods are not verified",
      subtitle: "Recording a payment is not proof of payment",
      description: "Mobile money, bank transfer and card are record-only.",
      steps: [
        "Choosing Other only records the method. The app does not check that money arrived.",
        "Confirm the payment in your bank or mobile-money app before handing over goods.",
        "The sale is saved as unverified.",
      ],
    },
    {
      id: "g-security",
      category: "security",
      title: "Keep your business data safe",
      subtitle: "Device and account safety basics",
      description: "Device lock, shared devices, links, secrets.",
      steps: [
        "Use a screen lock on every device that runs the POS.",
        "Sales and products are stored in the browser on that device. Anyone who can open the browser profile may see them.",
        "Only open links you trust. The app tells you before you leave it.",
        "Never share passwords, tokens or keys in business notes. Notes are not encrypted.",
        "Report anything suspicious to the business owner.",
      ],
    },
  ].map((g) =>
    Object.assign({ source: "official", status: "published", version: 1 }, g),
  );

  // Only URLs that are verified. Add Marketplace / Support links here once the real addresses are confirmed.
  const OFFICIAL_LINKS = [
    {
      id: "l-drive",
      title: "Google Drive",
      url: "https://drive.google.com/",
      note: "Where your business files live",
    },
    {
      id: "l-sheets",
      title: "Google Sheets",
      url: "https://docs.google.com/spreadsheets/",
      note: "Open your business spreadsheet",
    },
    {
      id: "l-script",
      title: "Google Apps Script",
      url: "https://script.google.com/",
      note: "Manage your business backend",
    },
  ].map((l) => Object.assign({ source: "official" }, l));

  const LIMITS = {
    title: 80,
    note: 500,
    url: 2000,
    resources: 100,
    recent: 8,
    report: 1000,
    reports: 50,
  };
  // Set to a verified Mwakete support address to enable the "Email" button. Empty = button hidden.
  const SUPPORT_EMAIL = "admin@mwakete.com";
  // Official support channels, supplied by the Mwakete owner. Phone is shown exactly as given (no country code assumed).
  const SUPPORT_CONTACTS = {
    email: SUPPORT_EMAIL,
    messenger: "https://m.me/moote.nakau",
    phone: "73052765",
  };
  const REPORT_CATEGORIES = [
    { id: "guide", title: "A guide is wrong or unclear" },
    { id: "app", title: "Something in the app is not working" },
    { id: "sync", title: "Sync problem" },
    { id: "other", title: "Something else" },
  ];
  const KEYS = {
    reports: "helpReports",
    resources: "helpResources",
    bookmarks: "helpBookmarks",
    recent: "helpRecent",
  };

  const esc = (s) =>
    String(s ?? "").replace(
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

  /* ---------- URL safety ---------- */
  function normalizeUrl(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return { ok: false, error: "Enter a web address." };
    if (text.length > LIMITS.url)
      return { ok: false, error: "That web address is too long." };
    let u;
    try {
      u = new URL(text);
    } catch {
      return { ok: false, error: "That is not a valid web address." };
    }
    if (u.protocol !== "https:")
      return { ok: false, error: "Only secure https:// links are allowed." };
    if (u.username || u.password)
      return {
        ok: false,
        error: "Links with a username or password are not allowed.",
      };
    const host = u.hostname.toLowerCase();
    const isIp =
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      host.includes(":") ||
      host.startsWith("[");
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      isIp ||
      !host.includes(".")
    )
      return { ok: false, error: "Use a public website address." };
    return { ok: true, url: u.href, host };
  }

  /* ---------- search ---------- */
  function searchGuides(guides, query, category) {
    const terms = String(query ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return guides.filter((g) => {
      if (g.status && g.status !== "published") return false;
      if (category && g.category !== category) return false;
      const hay = (
        g.title +
        " " +
        g.subtitle +
        " " +
        g.description
      ).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  /* ---------- business resources (local) ---------- */
  function validateResource(input) {
    const kind = input?.kind === "note" ? "note" : "link";
    const title = String(input?.title ?? "").trim();
    if (!title) return { ok: false, error: "Enter a title." };
    if (title.length > LIMITS.title)
      return { ok: false, error: "Title is too long." };
    const note = String(input?.note ?? "").trim();
    if (note.length > LIMITS.note)
      return {
        ok: false,
        error: "Note is too long (max " + LIMITS.note + " characters).",
      };
    if (kind === "note") {
      if (!note) return { ok: false, error: "Write the note text." };
      return { ok: true, value: { kind, title, note } };
    }
    const u = normalizeUrl(input?.url);
    if (!u.ok) return u;
    return { ok: true, value: { kind, title, url: u.url, note } };
  }

  async function readList(store, key) {
    const row = await store.get("settings", key);
    return Array.isArray(row?.value) ? row.value : [];
  }
  const writeList = (store, key, list) =>
    store.put("settings", { key, value: list });

  async function listResources(store) {
    return readList(store, KEYS.resources);
  }
  async function addResource(store, input, id, now = Date.now()) {
    const v = validateResource(input);
    if (!v.ok) return v;
    const list = await readList(store, KEYS.resources);
    if (list.length >= LIMITS.resources)
      return {
        ok: false,
        error:
          "You have reached the limit of " + LIMITS.resources + " saved items.",
      };
    const item = Object.assign(
      { id, source: "business", createdAt: now },
      v.value,
    );
    list.push(item);
    await writeList(store, KEYS.resources, list);
    return { ok: true, item };
  }
  async function removeResource(store, id) {
    const list = await readList(store, KEYS.resources);
    const next = list.filter((r) => r.id !== id);
    await writeList(store, KEYS.resources, next);
    return next.length !== list.length;
  }

  /* ---------- bookmarks and recently viewed ---------- */
  async function toggleBookmark(store, guideId) {
    const list = await readList(store, KEYS.bookmarks);
    const has = list.includes(guideId);
    const next = has ? list.filter((x) => x !== guideId) : [...list, guideId];
    await writeList(store, KEYS.bookmarks, next);
    return !has;
  }
  const listBookmarks = (store) => readList(store, KEYS.bookmarks);
  async function recordView(store, guideId) {
    const list = await readList(store, KEYS.recent);
    const next = [guideId, ...list.filter((x) => x !== guideId)].slice(
      0,
      LIMITS.recent,
    );
    await writeList(store, KEYS.recent, next);
    return next;
  }
  const listRecent = (store) => readList(store, KEYS.recent);

  /* ---------- problem reports (saved locally; NEVER marked as sent) ---------- */
  function validateReport(input) {
    const category = REPORT_CATEGORIES.find((c) => c.id === input?.category);
    if (!category)
      return { ok: false, error: "Choose what the problem is about." };
    const message = String(input?.message ?? "").trim();
    if (message.length < 5)
      return {
        ok: false,
        error: "Describe the problem (at least a few words).",
      };
    if (message.length > LIMITS.report)
      return {
        ok: false,
        error:
          "Description is too long (max " + LIMITS.report + " characters).",
      };
    const known = OFFICIAL_GUIDES.some((g) => g.id === input?.guideId);
    return {
      ok: true,
      value: {
        category: category.id,
        message,
        guideId: known ? input.guideId : "",
      },
    };
  }
  async function addReport(store, input, id, now = Date.now()) {
    const v = validateReport(input);
    if (!v.ok) return v;
    const list = await readList(store, KEYS.reports);
    if (list.length >= LIMITS.reports)
      return {
        ok: false,
        error: "Too many saved reports. Remove old ones first.",
      };
    const item = Object.assign(
      { id, createdAt: now, status: "saved" },
      v.value,
    );
    list.push(item);
    await writeList(store, KEYS.reports, list);
    return { ok: true, item };
  }
  const listReports = (store) => readList(store, KEYS.reports);
  async function removeReport(store, id) {
    const list = await readList(store, KEYS.reports);
    const next = list.filter((r) => r.id !== id);
    await writeList(store, KEYS.reports, next);
    return next.length !== list.length;
  }
  // Plain text for copy / email. Diagnostics are opt-in and contain no sales, product or customer data.
  function buildReportText(report, diagnostics) {
    const cat = REPORT_CATEGORIES.find((c) => c.id === report.category);
    const guide = OFFICIAL_GUIDES.find((g) => g.id === report.guideId);
    const lines = [
      "Mwakete POS problem report",
      "Topic: " + (cat ? cat.title : report.category),
    ];
    if (guide) lines.push("Guide: " + guide.title);
    lines.push(
      "Date: " + new Date(report.createdAt).toISOString(),
      "",
      report.message,
    );
    if (diagnostics && typeof diagnostics === "object") {
      lines.push("", "Diagnostics (shared by choice):");
      for (const k of ["appVersion", "online", "userAgent"])
        if (k in diagnostics)
          lines.push("- " + k + ": " + String(diagnostics[k]).slice(0, 300));
    }
    return lines.join("\n");
  }
  function mailtoUrl(email, report, diagnostics) {
    if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(String(email ?? "")))
      return "";
    const subject = "Mwakete POS problem report";
    return (
      "mailto:" +
      email +
      "?subject=" +
      encodeURIComponent(subject) +
      "&body=" +
      encodeURIComponent(buildReportText(report, diagnostics))
    );
  }

  /* ---------- HTML builders (all dynamic text escaped) ---------- */
  function supportContacts() {
    const c = SUPPORT_CONTACTS,
      rows = [];
    if (/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(c.email))
      rows.push(
        `<div class="resource-row"><div><strong><a class="contact-link" href="mailto:${esc(c.email)}">Email: ${esc(c.email)}</a></strong><small>Opens your email app</small></div></div>`,
      );
    if (normalizeUrl(c.messenger).ok)
      rows.push(
        `<div class="resource-row"><div><strong>${externalLink({ title: "Messenger chat", url: c.messenger })}</strong><small>Opens Messenger</small></div></div>`,
      );
    if (/^[0-9]{5,15}$/.test(c.phone))
      rows.push(
        `<div class="resource-row"><div><strong><a class="contact-link" href="tel:${esc(c.phone)}">Phone: ${esc(c.phone)}</a></strong><small>Opens your phone app</small></div></div>`,
      );
    return rows.join("");
  }
  function reportRow(r, canEmail) {
    const cat = REPORT_CATEGORIES.find((c) => c.id === r.category);
    const guide = OFFICIAL_GUIDES.find((g) => g.id === r.guideId);
    const when = new Date(r.createdAt).toLocaleString();
    return `<div class="resource-row"><div><strong>${esc(cat ? cat.title : "Report")}</strong><small>${esc(when)}${guide ? " · " + esc(guide.title) : ""} · <b>Not sent</b> — saved on this device only</small><p class="note-text">${esc(r.message)}</p></div><div class="row-actions"><button class="text-button" data-copy-report="${esc(r.id)}">Copy</button>${canEmail ? `<button class="text-button" data-email-report="${esc(r.id)}">Email</button>` : ""}<button class="text-button" data-remove-report="${esc(r.id)}">Remove</button></div></div>`;
  }
  function externalLink(item) {
    const u = normalizeUrl(item.url);
    if (!u.ok)
      return `<span class="muted">${esc(item.title)} (invalid link hidden)</span>`;
    return `<a class="ext-link" href="${esc(u.url)}" target="_blank" rel="noopener noreferrer" data-ext="${esc(u.host)}">${esc(item.title)} <span aria-hidden="true">↗</span></a>`;
  }
  function guideCard(g, bookmarked) {
    return `<article class="guide-card"><button class="guide-open" data-guide="${esc(g.id)}"><strong>${esc(g.title)}</strong><small>${esc(g.subtitle)}</small></button><button class="bookmark${bookmarked ? " on" : ""}" data-bookmark="${esc(g.id)}" aria-pressed="${bookmarked}" aria-label="${bookmarked ? "Remove bookmark" : "Bookmark"}: ${esc(g.title)}">${bookmarked ? "★" : "☆"}</button></article>`;
  }
  function guideDetail(g, bookmarked) {
    const steps = g.steps.map((s) => `<li>${esc(s)}</li>`).join("");
    return `<div class="guide-detail"><button class="text-button" data-guide-back>← All guides</button><p class="eyebrow">${esc((CATEGORIES.find((c) => c.id === g.category) || {}).title || "")}</p><h3>${esc(g.title)}</h3><p class="muted">${esc(g.subtitle)}</p><ol class="steps">${steps}</ol><button class="button secondary" data-bookmark="${esc(g.id)}" aria-pressed="${bookmarked}">${bookmarked ? "★ Bookmarked" : "☆ Bookmark this guide"}</button> <button class="text-button" data-report-guide="${esc(g.id)}">Report a problem with this guide</button></div>`;
  }
  function resourceRow(r) {
    const body =
      r.kind === "note"
        ? `<strong>${esc(r.title)}</strong><p class="note-text">${esc(r.note)}</p>`
        : `<strong>${externalLink(r)}</strong>${r.note ? `<small>${esc(r.note)}</small>` : ""}`;
    return `<div class="resource-row"><div>${body}</div><button class="text-button" data-remove-resource="${esc(r.id)}">Remove</button></div>`;
  }

  return {
    CATEGORIES,
    OFFICIAL_GUIDES,
    OFFICIAL_LINKS,
    LIMITS,
    KEYS,
    esc,
    normalizeUrl,
    searchGuides,
    validateResource,
    listResources,
    addResource,
    removeResource,
    toggleBookmark,
    listBookmarks,
    recordView,
    listRecent,
    externalLink,
    guideCard,
    guideDetail,
    resourceRow,
    SUPPORT_EMAIL,
    SUPPORT_CONTACTS,
    supportContacts,
    REPORT_CATEGORIES,
    validateReport,
    addReport,
    listReports,
    removeReport,
    buildReportText,
    mailtoUrl,
    reportRow,
  };
})();
if (typeof module !== "undefined") module.exports = GuidesCore;
