/* Barcode screens: hardware scanner anywhere on the till, camera scanning where the browser supports it,
 * and "add this as a new product" for a code nothing matches. Logic lives in scan.js (ScanCore). */
const ScanUI = (() => {
  const S = ScanCore,
    $ = (id) => document.getElementById(id);
  let stream = null;
  let timer = null;
  let last = null;
  const buf = S.createBuffer();

  const tillOpen = () => !$("view-sale").classList.contains("hidden");

  /* A code that matches no product: offer to create one with the barcode filled in. */
  function unknown(code) {
    const starter = S.newProductFromCode(code);
    if (!starter) return toast("That does not look like a barcode.");
    if (
      typeof CloudUI !== "undefined" &&
      document.body.classList.contains("role-cashier")
    ) {
      return toast(
        "No product has barcode " + code + ". Ask a manager to add it.",
      );
    }
    if (
      !confirm(
        "No product has the barcode " + code + ". Add it as a new product now?",
      )
    )
      return;
    stopCamera();
    document.querySelector('.tab[data-view="products"]')?.click();
    const f = $("productForm").elements;
    f.sku.value = starter.sku;
    f.name.focus();
    toast("Barcode filled in. Enter the name and price, then save.");
  }

  /* ---------- camera ---------- */
  function stopCamera() {
    clearInterval(timer);
    timer = null;
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
    const v = $("scanVideo");
    v.srcObject = null;
    $("scanPanel").classList.add("hidden");
  }
  async function startCamera() {
    const sup = S.cameraSupport({
      BarcodeDetector: window.BarcodeDetector,
      mediaDevices: navigator.mediaDevices,
      secure: window.isSecureContext,
    });
    if (!sup.ok)
      return toast(
        "This browser cannot scan with the camera. Use a barcode scanner or type the code.",
      );
    let detector;
    try {
      detector = new window.BarcodeDetector({ formats: S.FORMATS });
    } catch {
      detector = new window.BarcodeDetector();
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
    } catch {
      return toast(
        "The camera is not available. Allow camera access in the browser, or use a scanner.",
      );
    }
    const v = $("scanVideo");
    v.srcObject = stream;
    await v.play().catch(() => {});
    $("scanPanel").classList.remove("hidden");
    $("scanStatus").textContent = "Point the camera at a barcode.";
    $("scanClose").focus();
    timer = setInterval(async () => {
      if (!stream || v.readyState < 2) return;
      try {
        const found = await detector.detect(v);
        if (!found.length) return;
        const code = S.clean(found[0].rawValue);
        const now = Date.now();
        if (!code || S.isDuplicate(last, code, now)) return;
        last = { code, at: now };
        const ok = await RetailUI.scanCode(code);
        $("scanStatus").textContent = ok
          ? "Added " + code + ". Scan the next one or press Done."
          : "No product for " + code + ".";
      } catch {
        /* a frame that cannot be read is skipped */
      }
    }, 300);
  }

  async function init() {
    // The camera button only appears where the browser can really scan.
    const sup = S.cameraSupport({
      BarcodeDetector: window.BarcodeDetector,
      mediaDevices: navigator.mediaDevices,
      secure: window.isSecureContext,
    });
    const btn = $("scanCamera");
    // The edition decides whether the button shows (data-feature); a browser that cannot scan has no button at all.
    if (!sup.ok) btn.remove();
    btn.addEventListener("click", startCamera);
    $("scanClose").addEventListener("click", stopCamera);
    window.addEventListener("pagehide", stopCamera);

    // A hardware scanner works even when the search box is not focused.
    document.addEventListener("keydown", async (e) => {
      if (!tillOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (
        ["input", "textarea", "select"].includes(tag) ||
        e.target.isContentEditable
      )
        return;
      if (!(await currentHasBarcode())) return;
      const code = buf.feed(e.key, e.timeStamp || Date.now());
      if (code) {
        e.preventDefault();
        RetailUI.scanCode(code);
      }
    });
  }
  async function currentHasBarcode() {
    const tier = await TierCore.getTier(POSDB);
    return TierCore.has(tier, "barcode");
  }
  return { init, unknown, stopCamera };
})();
if (typeof window !== "undefined") window.ScanUI = ScanUI;
