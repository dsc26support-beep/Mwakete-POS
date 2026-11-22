const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../js/guides.js");

const byId = (id) => G.OFFICIAL_GUIDES.find((g) => g.id === id);
const text = (id) => byId(id).steps.join(" ");

test("tier and Retail guides exist and are findable by search", () => {
  for (const id of [
    "g-tiers",
    "g-barcode",
    "g-discounts-receipts",
    "g-customers-reports",
  ])
    assert.ok(byId(id), id);
  assert.ok(
    G.searchGuides(G.OFFICIAL_GUIDES, "barcode").some(
      (g) => g.id === "g-barcode",
    ),
  );
  assert.ok(
    G.searchGuides(G.OFFICIAL_GUIDES, "discount").some(
      (g) => g.id === "g-discounts-receipts",
    ),
  );
  assert.ok(
    G.searchGuides(G.OFFICIAL_GUIDES, "business type").some(
      (g) => g.id === "g-tiers",
    ),
  );
});

test("guides are honest: Wholesale is coming soon, camera scanning is unavailable, data is device-only", () => {
  assert.match(text("g-tiers"), /credit ledger is NOT production-ready/);
  assert.match(text("g-tiers"), /Purchase orders and quotes are coming soon/);
  assert.match(text("g-invoices"), /12\.5%/);
  assert.match(
    text("g-invoices"),
    /Payments are not matched to individual invoices/,
  );
  assert.match(text("g-invoices"), /can still continue/);
  assert.match(text("g-ledger"), /NOT production-ready/);
  assert.match(text("g-ledger"), /LEDGER_ENABLED/);
  assert.match(text("g-ledger"), /Ledger not enabled/);
  assert.ok(!/credit accounts are not active yet/.test(text("g-price-lists")));
  assert.match(text("g-price-lists"), /this device only/);
  assert.match(text("g-pack-sizes"), /72 single units/);
  assert.match(text("g-tiers"), /kept/);
  assert.match(text("g-barcode"), /camera is not available yet/);
  assert.match(text("g-customers-reports"), /this device only/);
  assert.match(text("g-customers-reports"), /not the cloud ledger/);
  assert.match(text("g-discounts-receipts"), /not verified/);
});
