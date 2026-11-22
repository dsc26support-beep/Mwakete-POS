/* Loads the REAL google-apps-script/Code.gs in a Node vm with minimal stubs for Google services.
 * opts.sheets: {Sales: [[header],[row]...], ...} existing sheets. opts.props: script properties. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeSheet(rows) {
  const data = rows.map((r) => [...r]);
  return {
    data,
    getLastRow: () => data.length,
    getLastColumn: () => data.reduce((m, r) => Math.max(m, r.length), 0),
    appendRow: (r) => data.push([...r]),
    getRange: (row, col, nr, nc) => ({
      getValues: () =>
        data
          .slice(row - 1, row - 1 + nr)
          .map((r) =>
            Array.from({ length: nc }, (_, i) =>
              r[col - 1 + i] === undefined ? "" : r[col - 1 + i],
            ),
          ),
      setValues: (v) => {
        for (let i = 0; i < v.length; i++) data[row - 1 + i] = [...v[i]];
      },
    }),
  };
}

function load(opts = {}) {
  const sheets = new Map(
    Object.entries(opts.sheets || {}).map(([n, rows]) => [n, makeSheet(rows)]),
  );
  const props = { ...(opts.props || {}) };
  const ctx = {
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (n) => sheets.get(n) || null,
        insertSheet: (n) => {
          const s = makeSheet([]);
          sheets.set(n, s);
          return s;
        },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) =>
          Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null,
      }),
    },
    ContentService: {
      createTextOutput: (s) => ({
        s,
        setMimeType() {
          return this;
        },
      }),
      MimeType: { JSON: "json" },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../../google-apps-script/Code.gs"),
      "utf8",
    ),
    ctx,
  );
  const post = (payload) =>
    JSON.parse(
      ctx.doPost({
        postData: {
          contents:
            typeof payload === "string" ? payload : JSON.stringify(payload),
        },
      }).s,
    );
  const get = () => JSON.parse(ctx.doGet().s);
  const rows = (name) => (sheets.has(name) ? sheets.get(name).data : null);
  return { ctx, post, get, rows, sheets, props };
}
module.exports = { load };
