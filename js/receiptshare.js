/* ReceiptShare — turns receipt text into a small PDF (and tells the screen how to draw a picture) so a receipt can be
 * shared with its file attached through the phone's share sheet (WhatsApp, email, Messenger...). Pure: no DOM.
 * The PDF is written by hand: one page, Courier, ASCII text only, no libraries and nothing fetched. */
(function (root) {
  const MAX_LINES = 400;
  const asciiLine = (s) =>
    String(s == null ? "" : s)
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/[^\x20-\x7e]/g, "?")
      .slice(0, 60);
  const pdfEscape = (s) =>
    s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  /* lines: array of strings. Returns {bytes: Uint8Array, text: string (the same PDF as text)}. */
  function buildPdf(lines) {
    const rows = (lines || []).slice(0, MAX_LINES).map(asciiLine);
    const size = 10; // font size
    const lead = 12; // line height
    const margin = 14;
    const width = 240; // about 80 mm wide, like a till roll
    const height = Math.max(120, margin * 2 + rows.length * lead);
    let stream =
      "BT\n/F1 " +
      size +
      " Tf\n" +
      lead +
      " TL\n" +
      margin +
      " " +
      (height - margin - size) +
      " Td\n";
    for (const r of rows) stream += "(" + pdfEscape(r) + ") Tj T*\n";
    stream += "ET";
    const objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
        width +
        " " +
        height +
        "] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
    ];
    let out = "%PDF-1.4\n";
    const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(out.length);
      out += i + 1 + " 0 obj\n" + o + "\nendobj\n";
    });
    const xref = out.length;
    out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n";
    for (const off of offsets)
      out += String(off).padStart(10, "0") + " 00000 n \n";
    out +=
      "trailer\n<< /Size " +
      (objs.length + 1) +
      " /Root 1 0 R >>\nstartxref\n" +
      xref +
      "\n%%EOF\n";
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return { bytes, text: out };
  }

  /* A safe file name such as receipt-R-AB12-0007.pdf */
  function fileName(sale, ext) {
    const base = String(
      (sale && (sale.receiptNo || (sale.invoice && sale.invoice.number))) ||
        (sale && sale.id) ||
        "receipt",
    )
      .replace(/[^A-Za-z0-9._-]/g, "")
      .slice(0, 40);
    return "receipt-" + (base || "sale") + "." + ext;
  }

  /* Can this browser share files? `nav` is injected for tests. files: [{type}] objects with a File-like shape. */
  function canShareFiles(nav, files) {
    if (!nav || typeof nav.share !== "function") return false;
    if (typeof nav.canShare !== "function") return false;
    try {
      return !!nav.canShare({ files });
    } catch {
      return false;
    }
  }

  /* The picture: size and text lines for the canvas (the screen draws it). */
  function pictureLayout(lines) {
    const rows = (lines || []).slice(0, MAX_LINES).map(asciiLine);
    const charW = 11;
    const lineH = 22;
    const pad = 24;
    const longest = rows.reduce((n, r) => Math.max(n, r.length), 32);
    return {
      rows,
      width: pad * 2 + longest * charW,
      height: pad * 2 + rows.length * lineH,
      charW,
      lineH,
      pad,
    };
  }

  const api = { buildPdf, fileName, canShareFiles, pictureLayout, asciiLine };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReceiptShare = api;
})(typeof window !== "undefined" ? window : globalThis);
