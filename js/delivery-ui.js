/* Receipt delivery screens: the "Send a receipt" dialog and the delivery queue list.
 * Logic lives in delivery.js (DeliveryCore). Nothing is sent by this app itself: it opens the user's own
 * email / SMS / WhatsApp app, and the user confirms the result. No keys or accounts are stored. */
const DeliveryUI = (() => {
  const D = DeliveryCore,
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
  let queue = [];
  let sale = null;
  let business = "";
  let dirty = false;
  let busy = false;

  async function load() {
    const v = (await POSDB.get("settings", "deliveryQueue"))?.value;
    queue = Array.isArray(v) ? v : [];
  }
  async function save() {
    await POSDB.put("settings", { key: "deliveryQueue", value: queue });
  }

  function openLink(url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function render() {
    const rows = queue
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50);
    const btn = (id, act, text) =>
      `<button class="text-button" type="button" data-dq="${esc(id)}" data-act="${act}">${text}</button>`;
    $("deliveryList").innerHTML = rows.length
      ? rows
          .map((q) => {
            const actions = {
              Queued: btn(q.id, "send", "Send") + btn(q.id, "cancel", "Cancel"),
              "Retry pending":
                btn(q.id, "send", "Send") + btn(q.id, "cancel", "Cancel"),
              Sending:
                btn(q.id, "done", "I sent it") +
                btn(q.id, "fail", "It failed") +
                btn(q.id, "cancel", "Cancel"),
              Failed:
                btn(q.id, "retry", "Retry") + btn(q.id, "cancel", "Cancel"),
              Delivered: "",
              Cancelled: "",
            }[q.status];
            return `<div class="resource-row"><div><strong>${esc(D.CHANNELS[q.channel])} to ${esc(q.to)}</strong><small>${esc(new Date(q.createdAt).toLocaleString())} · <span class="badge ${q.status === "Failed" ? "out" : q.status === "Delivered" ? "" : "low"}">${esc(q.status)}${q.status === "Delivered" ? " (you confirmed)" : ""}</span> · tries ${esc(q.attempts)}</small></div><div class="row-actions">${actions}</div></div>`;
          })
          .join("")
      : '<p class="empty">No receipts in the queue.</p>';
  }

  /* ---------- dialog ---------- */
  function defaultText() {
    return $("deliveryChannel").value === "email"
      ? RetailCore.buildReceiptText(sale, business, null)
      : D.shortText(sale, business);
  }
  /* ---------- share a receipt FILE through the phone's share sheet ---------- */
  const RS = ReceiptShare;
  let customer = null;
  function receiptLines() {
    return RetailCore.buildReceiptText(sale, business, customer).split("\n");
  }
  function drawPng() {
    const L = RS.pictureLayout(receiptLines());
    const c = document.createElement("canvas");
    c.width = L.width;
    c.height = L.height;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#111111";
    g.font = "bold 18px ui-monospace, Menlo, Consolas, monospace";
    g.textBaseline = "top";
    L.rows.forEach((r, i) => g.fillText(r, L.pad, L.pad + i * L.lineH));
    return new Promise((res) => c.toBlob(res, "image/png"));
  }
  async function makeFile(kind) {
    if (kind === "pdf") {
      const { bytes } = RS.buildPdf(receiptLines());
      return new File([bytes], RS.fileName(sale, "pdf"), {
        type: "application/pdf",
      });
    }
    const blob = await drawPng();
    return new File([blob], RS.fileName(sale, "png"), { type: "image/png" });
  }
  async function shareFile(kind) {
    if (!sale || busy) return;
    busy = true;
    try {
      const file = await makeFile(kind);
      if (!RS.canShareFiles(navigator, [file])) {
        $("deliveryError").textContent =
          "This phone cannot attach a file here. Use the WhatsApp, SMS or Email buttons instead.";
        return;
      }
      try {
        await navigator.share({
          files: [file],
          title: "Receipt " + (sale.receiptNo || ""),
          text: D.shortText(sale, business),
        });
        if (window.Audit)
          Audit.log(
            "receipt-send",
            "Shared receipt " +
              (kind === "pdf" ? "PDF" : "picture") +
              " for sale " +
              sale.id.slice(0, 8),
          );
        $("deliveryPanel").classList.add("hidden");
        toast("Receipt shared.");
      } catch (e) {
        if (e && e.name !== "AbortError")
          $("deliveryError").textContent =
            "Could not share: " + (e.message || e.name);
      }
    } finally {
      busy = false;
    }
  }

  async function open(saleId) {
    sale = (await POSDB.get("sales", saleId)) || null;
    if (!sale) return toast("That sale was not found.");
    business = (await POSDB.get("settings", "businessName"))?.value || "";
    const cust = sale.customerId
      ? await POSDB.get("customers", sale.customerId)
      : null;
    customer = cust;
    // The file buttons show only where this phone can really attach files to a share.
    let canFiles = false;
    try {
      canFiles = RS.canShareFiles(navigator, [
        new File([new Uint8Array(1)], "r.pdf", { type: "application/pdf" }),
      ]);
    } catch {}
    $("shareBox").classList.toggle("hidden", !canFiles);
    dirty = false;
    $("deliveryError").textContent = "";
    $("deliveryChannel").value = cust?.phone
      ? "sms"
      : cust?.email
        ? "email"
        : "sms";
    $("deliveryTo").value =
      $("deliveryChannel").value === "email"
        ? cust?.email || ""
        : cust?.phone || "";
    $("deliveryText").value = defaultText();
    $("deliveryPanel").classList.remove("hidden");
    $("deliveryTo").focus();
  }
  function input() {
    return {
      saleId: sale.id,
      channel: $("deliveryChannel").value,
      to: $("deliveryTo").value,
      text: $("deliveryText").value,
      subject: "Your receipt" + (business ? " from " + business : ""),
    };
  }
  async function create(sendNow) {
    if (busy || !sale) return;
    busy = true;
    try {
      const m = D.make(input());
      if (!m.ok) {
        $("deliveryError").textContent = m.error;
        return;
      }
      const a = D.add(queue, m.item);
      if (!a.ok) {
        $("deliveryError").textContent = a.error;
        return;
      }
      queue = a.queue;
      await save();
      $("deliveryPanel").classList.add("hidden");
      render();
      if (sendNow) await act(m.item.id, "send");
      else toast("Added to the delivery queue.");
    } finally {
      busy = false;
    }
  }

  async function act(id, what) {
    const q = queue.find((x) => x.id === id);
    if (!q) return;
    let r;
    if (what === "send") {
      const link = D.buildLink(q);
      if (!link.ok) return toast(link.error);
      r = D.move(q, "Sending");
      if (!r.ok) return toast(r.error);
      openLink(link.url);
      if (window.Audit)
        Audit.log(
          "receipt-send",
          D.CHANNELS[q.channel] + " receipt for sale " + q.saleId.slice(0, 8),
        );
      toast("Opening your app. Press Send there, then come back and confirm.");
    } else if (what === "done") r = D.move(q, "Delivered");
    else if (what === "fail") r = D.move(q, "Failed");
    else if (what === "retry") r = D.move(q, "Retry pending");
    else if (what === "cancel") r = D.move(q, "Cancelled");
    if (!r || !r.ok) return r && toast(r.error);
    queue = D.replace(queue, r.item);
    await save();
    render();
  }

  async function init() {
    await load();
    render();
    $("deliveryList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-dq]");
      if (b) act(b.dataset.dq, b.dataset.act);
    });
    $("deliveryChannel").addEventListener("change", () => {
      if (!dirty && sale) $("deliveryText").value = defaultText();
    });
    $("deliveryText").addEventListener("input", () => {
      dirty = true;
    });
    $("deliveryForm").addEventListener("submit", (e) => {
      e.preventDefault();
      create(true);
    });
    $("deliveryQueue").addEventListener("click", () => create(false));
    $("deliveryShareImg").addEventListener("click", () => shareFile("png"));
    $("deliverySharePdf").addEventListener("click", () => shareFile("pdf"));
    // From the receipt pop-up
    $("receiptSend").addEventListener("click", () => {
      const id = $("receiptPanel").dataset.saleId;
      if (!id) return;
      $("receiptPanel").classList.add("hidden");
      open(id);
    });
    // The sale that was just made (works in every edition, even without receipt pop-ups)
    let lastId = "";
    document.addEventListener("pos:sale", (e) => {
      lastId = e.detail.id;
      $("sendLast").classList.remove("hidden");
    });
    $("sendLast").addEventListener("click", () => lastId && open(lastId));
    $("deliveryCancel").addEventListener("click", () =>
      $("deliveryPanel").classList.add("hidden"),
    );
  }
  return { init, open, render, pendingCount: () => D.pending(queue) };
})();
if (typeof window !== "undefined") window.DeliveryUI = DeliveryUI;
