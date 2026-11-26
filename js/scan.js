/* ScanCore — pure helpers for barcode input from a keyboard-style scanner or a camera.
 * Hardware scanners behave like a very fast keyboard that ends with Enter, so a burst of keys is told apart from typing by timing.
 * Pure (no DOM). Unit tested in Node. */
(function (root) {
  const MAX_CODE = 80;
  const clean = (raw) =>
    String(raw == null ? "" : raw)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, MAX_CODE);
  /* Barcodes are short and have no spaces: 3-80 printable characters. */
  const looksLikeCode = (s) => /^[^\s]{3,80}$/.test(s);
  /* The same code seen twice within `ms` is one scan (a camera reports a code on every video frame). */
  function isDuplicate(last, code, now, ms = 1500) {
    return !!last && last.code === code && now - last.at < ms;
  }

  /* Collects fast key bursts. feed(key, now) returns the code when Enter ends a burst that looks like a scan, else null.
   * A person typing is slower than gapMs between keys, so typed text is never taken for a scan. */
  function createBuffer(opts = {}) {
    const gapMs = opts.gapMs || 40;
    const minLen = opts.minLen || 4;
    let chars = "";
    let lastAt = 0;
    return {
      feed(key, now) {
        if (key === "Enter") {
          const code = clean(chars);
          const fast = chars.length >= minLen;
          chars = "";
          return fast && looksLikeCode(code) ? code : null;
        }
        if (key.length !== 1) return null; // Shift, Tab and so on
        if (now - lastAt > gapMs) chars = ""; // too slow: this is typing, start again
        chars += key;
        lastAt = now;
        return null;
      },
      reset() {
        chars = "";
      },
    };
  }

  /* Which camera features this browser has. `env` is injected so this can be tested. */
  function cameraSupport(env) {
    const hasDetector = typeof env.BarcodeDetector === "function";
    const hasWasm = !!env.wasm; // WebAssembly is available: the bundled reader can run
    const hasMedia = !!(env.mediaDevices && env.mediaDevices.getUserMedia);
    // "native": the browser's own reader (fast). "bundled": the reader shipped in vendor/ (works on iPhone, Firefox...).
    const engine = hasDetector ? "native" : hasWasm ? "bundled" : "none";
    return {
      ok: engine !== "none" && hasMedia && !!env.secure,
      engine,
      hasDetector,
      hasWasm,
      hasMedia,
      secure: !!env.secure,
    };
  }
  const VENDOR = {
    script: "./vendor/barcode-detector.iife.js",
    wasm: "./vendor/zxing_reader.wasm",
  };
  const FORMATS = [
    "ean_13",
    "ean_8",
    "upc_a",
    "upc_e",
    "code_128",
    "code_39",
    "itf",
    "qr_code",
  ];

  /* New-product defaults when a scanned code matches nothing. */
  function newProductFromCode(code) {
    const c = clean(code);
    return looksLikeCode(c) ? { sku: c } : null;
  }

  const api = {
    clean,
    looksLikeCode,
    isDuplicate,
    createBuffer,
    cameraSupport,
    newProductFromCode,
    VENDOR,
    FORMATS,
    MAX_CODE,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScanCore = api;
})(typeof window !== "undefined" ? window : globalThis);
