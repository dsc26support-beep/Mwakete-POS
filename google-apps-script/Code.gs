/**
 * Mwakete POS Google Apps Script backend starter (schema v2: sales + Wholesale invoices + credit ledger).
 * Deploy as a Web App only after reviewing OAuth and access controls.
 * Each business must own its own Apps Script project and spreadsheet.
 *
 * SECURITY: this template has NO verified sign-in. The credit ledger (invoices, payments, balances) is therefore
 * NOT production-ready and must not be used with real customer or payment data until authenticated Google sign-in and
 * owner-authorised provisioning exist. As a mitigation the ledger is OFF until the owner sets the script property
 * LEDGER_ENABLED=true (Project Settings -> Script properties). Optional property TAX_RATE (e.g. 12.5) pins the tax rate.
 */
const CONFIG = { SPREADSHEET_ID: "REPLACE_WITH_BUSINESS_OWNED_SPREADSHEET_ID", TOKEN_PROPERTY: "POS_SHARED_TOKEN" };
const MAX_BATCH = 100;
const MAX_BODY = 1000000;
const SALES_HEADER = ["Transaction ID", "Created At", "Currency", "Total", "Payment Method", "Items JSON", "Discount", "Customer ID", "Tier", "Tax", "Invoice No", "Mode"];
const INVOICE_HEADER = ["Invoice No", "Transaction ID", "Created At", "Customer ID", "Customer Name", "Customer Tax No", "Currency", "Subtotal", "Discount", "Taxable", "Tax Rate", "Tax", "Total", "Mode", "Terms", "Over Limit"];
const PAYMENT_HEADER = ["Payment ID", "Created At", "Customer ID", "Customer Name", "Amount", "Method", "Note"];
const CUSTOMER_HEADER = ["Customer ID", "Name", "Credit Limit", "Terms", "Tax No", "Added At"];
const LEDGER_OFF = "Ledger not enabled. The business owner must set LEDGER_ENABLED=true in the Apps Script project properties.";

function doGet() { return json_({ ok: true, service: "Mwakete POS Google backend", schemaVersion: 2, ledgerEnabled: ledgerEnabled_() }); }

function doPost(e) {
  try {
    const raw = (e.postData && e.postData.contents) || "{}";
    if (raw.length > MAX_BODY) throw new Error("Request too large.");
    const body = JSON.parse(raw);
    // TODO production: validate signed identity, tenant ownership and schema before anything below.
    // Never rely on a browser-supplied businessId or shared token as sole authorisation.
    if (body.type !== "pos_sync") throw new Error("Unsupported request.");
    const out = processSync_(body);
    out.ok = true;
    return json_(out);
  } catch (err) { return json_({ ok: false, error: String(err.message || err) }); }
}

function ledgerEnabled_() { return PropertiesService.getScriptProperties().getProperty("LEDGER_ENABLED") === "true"; }
function pinnedTaxRate_() {
  const v = PropertiesService.getScriptProperties().getProperty("TAX_RATE");
  return v === null || v === undefined || v === "" ? null : Number(v);
}
function list_(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_BATCH) throw new Error("Invalid batch.");
  return v;
}
function cents_(v) { return Math.round(Number(v) * 100); }
function reason_(err) { return String((err && err.message) || err).slice(0, 200); }

function sheet_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); }
  else if (sh.getLastColumn() < header.length) { sh.getRange(1, 1, 1, header.length).setValues([header]); }
  return sh;
}
function rows_(sh, width) {
  return sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : [];
}

/* Applies each record independently: one bad record never blocks the others. A record is "accepted" only when it is
 * stored (or was already stored: idempotent). The client marks a record synced ONLY if its id is returned here. */
function processSync_(body) {
  const transactions = list_(body.transactions), payments = list_(body.payments), customers = list_(body.customers);
  const ledgerOn = ledgerEnabled_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sales = sheet_(ss, "Sales", SALES_HEADER);
    const saleIds = new Set(rows_(sales, 1).map(function (r) { return String(r[0]); }));
    const out = { acceptedIds: [], acceptedPaymentIds: [], rejected: [], balances: {}, overLimit: [] };
    let invSh = null, paySh = null, custSh = null;
    const invoiceByNumber = new Map(), paymentIds = new Set(), limits = new Map(), balance = {};
    if (ledgerOn) {
      invSh = sheet_(ss, "Invoices", INVOICE_HEADER); paySh = sheet_(ss, "Payments", PAYMENT_HEADER); custSh = sheet_(ss, "Customers", CUSTOMER_HEADER);
      rows_(invSh, INVOICE_HEADER.length).forEach(function (r) {
        invoiceByNumber.set(String(r[0]), String(r[1]));
        if (r[13] === "account") balance[r[3]] = (balance[r[3]] || 0) + cents_(r[12]);
      });
      rows_(paySh, PAYMENT_HEADER.length).forEach(function (r) { paymentIds.add(String(r[0])); balance[r[2]] = (balance[r[2]] || 0) - cents_(r[4]); });
      rows_(custSh, CUSTOMER_HEADER.length).forEach(function (r) { limits.set(String(r[0]), r[2] === "" || r[2] === null ? null : cents_(r[2])); });
    }
    const touched = new Set();

    // 1. Trade customers: INSERT-ONLY. The credit limit lives in the owner's Sheet; the client value only seeds a new row.
    if (ledgerOn) customers.forEach(function (c) {
      try {
        if (!c || typeof c.id !== "string" || !c.id || c.id.length > 100 || typeof c.name !== "string" || !c.name || c.name.length > 80) return;
        if (limits.has(c.id)) return;
        const lim = c.creditLimit === undefined || c.creditLimit === null || c.creditLimit === "" ? null : Number(c.creditLimit);
        if (lim !== null && (!Number.isFinite(lim) || lim < 0 || lim > 1e9)) return;
        custSh.appendRow([c.id, c.name, lim === null ? "" : lim, String(c.terms || "").slice(0, 40), String(c.taxNumber || "").slice(0, 30), new Date()]);
        limits.set(c.id, lim === null ? null : cents_(lim));
      } catch (err) { /* a bad customer seed never blocks sales or payments */ }
    });

    // 2. Payments received against the account balance.
    payments.forEach(function (p) {
      const id = String((p && p.id) || "?");
      try {
        if (!ledgerOn) throw new Error(LEDGER_OFF);
        validatePayment_(p);
        if (!paymentIds.has(p.id)) {
          paySh.appendRow([p.id, new Date(Number(p.createdAt)), p.customerId, String(p.customerName || "").slice(0, 80), Number(p.amount), "cash", String(p.note || "").slice(0, 200)]);
          paymentIds.add(p.id); balance[p.customerId] = (balance[p.customerId] || 0) - cents_(p.amount);
        }
        touched.add(p.customerId); out.acceptedPaymentIds.push(p.id);
      } catch (err) { out.rejected.push({ id: id, kind: "payment", reason: reason_(err) }); }
    });

    // 3. Sales (and the invoice carried on a Wholesale sale).
    transactions.forEach(function (t) {
      const id = String((t && t.id) || "?");
      try {
        const v = validateTransaction_(t, ledgerOn);
        const inv = t.invoice;
        if (inv && invoiceByNumber.has(inv.number) && invoiceByNumber.get(inv.number) !== t.id) throw new Error("Invoice number already used by another sale.");
        if (!saleIds.has(t.id)) {
          sales.appendRow([t.id, new Date(Number(t.createdAt)), String(t.currency || ""), Number(t.total), String(t.paymentMethod || ""), JSON.stringify(t.items),
            t.discount ? Number(t.discount.amount) : 0, String(t.customerId || ""), String(t.tier || "counter"), inv ? Number(t.tax) : 0, inv ? inv.number : "", inv ? inv.mode : ""]);
          saleIds.add(t.id);
        }
        // Each step is idempotent on its own, so a retry after a partial failure completes the missing row.
        if (inv && !invoiceByNumber.has(inv.number)) {
          let over = "";
          if (inv.mode === "account") {
            balance[t.customerId] = (balance[t.customerId] || 0) + v.totalCents;
            const lim = limits.get(t.customerId);
            if (lim !== undefined && lim !== null && balance[t.customerId] > lim) over = "YES";
          }
          invSh.appendRow([inv.number, t.id, new Date(Number(t.createdAt)), String(t.customerId || ""), inv.customerName, String(inv.customerTaxNumber || ""), String(t.currency || ""),
            Number(t.subtotal), t.discount ? Number(t.discount.amount) : 0, Number(inv.taxableNet), Number(inv.taxRate), Number(inv.tax), Number(inv.total), inv.mode, String(inv.terms || ""), over]);
          invoiceByNumber.set(inv.number, t.id);
        }
        if (inv && inv.mode === "account") touched.add(t.customerId);
        out.acceptedIds.push(t.id);
      } catch (err) { out.rejected.push({ id: id, kind: "sale", reason: reason_(err) }); }
    });

    // 4. Server-computed balances for the customers touched by this request (the client never sends a balance).
    touched.forEach(function (cid) {
      const b = balance[cid] || 0;
      out.balances[cid] = b / 100;
      const lim = limits.get(cid);
      if (lim !== undefined && lim !== null && b > lim) out.overLimit.push(cid);
    });
    return out;
  } finally { lock.releaseLock(); }
}

/* Same arithmetic as js/invoices.js (computeInvoiceTotals), in exact integer cents (BigInt for the ratios). */
function mulDivRound_(a, b, c) {
  if (c === 0) return 0;
  const A = BigInt(a), B = BigInt(b), C = BigInt(c);
  return Number((BigInt(2) * A * B + C) / (BigInt(2) * C));
}
function computeInvoiceTotals_(subCents, taxableCents, discCents, rateBp) {
  const taxableNet = taxableCents - mulDivRound_(discCents, taxableCents, subCents);
  return { taxableNet: taxableNet, tax: mulDivRound_(taxableNet, rateBp, 10000) };
}

/* Never trust client-computed money. Recompute in integer cents: total = sum(unitPrice*quantity) - discount (+ tax on invoices). */
function validateTransaction_(t, ledgerOn) {
  if (!t || typeof t.id !== "string" || !t.id || t.id.length > 100 || !Array.isArray(t.items) || !t.items.length || t.items.length > 200) throw new Error("Invalid transaction payload.");
  let subtotal = 0, taxable = 0;
  t.items.forEach(function (it) {
    const q = Number(it && it.quantity), p = Number(it && it.unitPrice);
    if (!Number.isInteger(q) || q < 1 || q > 100000 || !Number.isFinite(p) || p < 0) throw new Error("Invalid line item.");
    const line = Math.round(p * 100) * q;
    subtotal += line;
    if (!(it && it.taxExempt === true)) taxable += line;
  });
  let discount = 0;
  if (t.discount !== undefined && t.discount !== null) {
    const a = Number(t.discount.amount);
    if (!Number.isFinite(a) || a < 0) throw new Error("Invalid discount.");
    discount = Math.round(a * 100);
    if (discount > subtotal) throw new Error("Discount exceeds the sale subtotal.");
  }
  let tax = 0;
  const inv = t.invoice;
  if (inv !== undefined && inv !== null) {
    if (!ledgerOn) throw new Error(LEDGER_OFF);
    tax = validateInvoice_(t, inv, subtotal, taxable, discount);
  } else if (t.tax !== undefined && t.tax !== null && cents_(t.tax) !== 0) {
    throw new Error("Tax is only allowed on invoices.");
  }
  const total = Math.round(Number(t.total) * 100);
  if (!Number.isFinite(total) || total !== subtotal - discount + tax) throw new Error("Total does not match items and discount.");
  return { totalCents: total };
}

function validateInvoice_(t, inv, subtotal, taxable, discount) {
  if (typeof inv !== "object" || (inv.mode !== "paid" && inv.mode !== "account")) throw new Error("Invalid invoice mode.");
  if (typeof inv.number !== "string" || !/^INV-[A-Z0-9]{3,8}-\d{1,9}$/.test(inv.number)) throw new Error("Invalid invoice number.");
  if (typeof inv.customerName !== "string" || !inv.customerName || inv.customerName.length > 80) throw new Error("Invalid customer name.");
  if (inv.mode === "account" && (typeof t.customerId !== "string" || !t.customerId || t.customerId.length > 100)) throw new Error("A sale on account needs a customer.");
  ["customerTaxNumber", "sellerTaxNumber"].forEach(function (k) { if (inv[k] !== undefined && String(inv[k]).length > 30) throw new Error("Tax number is too long."); });
  if (inv.terms !== undefined && String(inv.terms).length > 40) throw new Error("Payment terms are too long.");
  const rate = Number(inv.taxRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100 || Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-6) throw new Error("Invalid tax rate.");
  const pinned = pinnedTaxRate_();
  if (pinned !== null && Math.round(pinned * 100) !== Math.round(rate * 100)) throw new Error("Tax rate does not match the rate set for this business.");
  const c = computeInvoiceTotals_(subtotal, taxable, discount, Math.round(rate * 100));
  if (cents_(inv.tax) !== c.tax || t.tax === undefined || t.tax === null || cents_(t.tax) !== c.tax) throw new Error("Tax does not match the items and rate.");
  if (cents_(inv.taxableNet) !== c.taxableNet) throw new Error("Taxable amount does not match the items.");
  if (cents_(inv.total) !== subtotal - discount + c.tax) throw new Error("Invoice total does not match the items.");
  if (t.subtotal === undefined || cents_(t.subtotal) !== subtotal) throw new Error("Subtotal does not match the items.");
  return c.tax;
}

function validatePayment_(p) {
  if (!p || typeof p.id !== "string" || !p.id || p.id.length > 100) throw new Error("Invalid payment.");
  if (typeof p.customerId !== "string" || !p.customerId || p.customerId.length > 100) throw new Error("A payment needs a customer.");
  const a = Number(p.amount);
  if (!Number.isFinite(a) || a <= 0 || a > 1e9 || Math.abs(a * 100 - Math.round(a * 100)) > 1e-6) throw new Error("Invalid payment amount.");
  if (p.method !== "cash") throw new Error("Only cash payments can be recorded.");
  if (!Number.isFinite(Number(p.createdAt))) throw new Error("Invalid payment date.");
  if (p.note !== undefined && String(p.note).length > 200) throw new Error("Payment note is too long.");
}

function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
