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
  const support = () =>
    S.cameraSupport({
      BarcodeDetector: window.BarcodeDetector,
      wasm: typeof WebAssembly === "object" && !!WebAssembly.instantiate,
      mediaDevices: navigator.mediaDevices,
      secure: window.isSecureContext,
    });

  /* The reader: the browser's own when it has one, otherwise the bundled one (loaded once, then cached for offline use). */
  let bundledLoading = null;
  function loadBundled() {
    if (window.BarcodeDetectionAPI)
      return Promise.resolve(window.BarcodeDetectionAPI);
    if (bundledLoading) return bundledLoading;
    bundledLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = S.VENDOR.script;
      s.onload = () => {
        const api = window.BarcodeDetectionAPI;
        if (!api) return reject(new Error("The barcode reader did not load."));
        // Find the decoder file next to the app instead of on the internet.
        api.setZXingModuleOverrides({
          locateFile: (path, prefix) =>
            path.endsWith(".wasm") ? S.VENDOR.wasm : prefix + path,
        });
        resolve(api);
      };
      s.onerror = () => {
        bundledLoading = null; // allow a retry when the connection returns
        reject(
          new Error(
            "The barcode reader could not be loaded. Connect once to download it.",
          ),
        );
      };
      document.head.appendChild(s);
    });
    return bundledLoading;
  }
  async function makeDetector(engine) {
    const Ctor =
      engine === "native"
        ? window.BarcodeDetector
        : (await loadBundled()).BarcodeDetector;
    try {
      return new Ctor({ formats: S.FORMATS });
    } catch {
      return new Ctor();
    }
  }
  /* Torch (phone light) on or off, where the camera has one. */
  function setupTorch() {
    const track = stream && stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    const btn = $("scanTorch");
    btn.classList.toggle("hidden", !caps.torch);
    btn.setAttribute("aria-pressed", "false");
    btn.onclick = async () => {
      const on = btn.getAttribute("aria-pressed") !== "true";
      try {
        await track.applyConstraints({ advanced: [{ torch: on }] });
        btn.setAttribute("aria-pressed", String(on));
      } catch {
        toast("This camera cannot turn the light on.");
      }
    };
  }
  async function startCamera() {
    const sup = support();
    if (!sup.ok)
      return toast(
        "This browser cannot scan with the camera. Use a barcode scanner or type the code.",
      );
    let detector;
    try {
      toast(
        sup.engine === "bundled"
          ? "Starting the camera reader…"
          : "Starting the camera…",
      );
      detector = await makeDetector(sup.engine);
    } catch (e) {
      return toast(e.message);
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
    setupTorch();
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
    const sup = support();
    const btn = $("scanCamera");
    // Warm the cache for offline use: when the bundled reader will be needed, fetch it once while online and idle.
    if (sup.ok && sup.engine === "bundled" && navigator.onLine)
      setTimeout(() => {
        fetch(S.VENDOR.script).catch(() => {});
        fetch(S.VENDOR.wasm).catch(() => {});
      }, 8000);
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
