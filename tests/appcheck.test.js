const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("App Check is off by default and only a public site key can be set", () => {
  const cfg = read("js/integrations/firebase-config.js");
  // empty (off) or a public reCAPTCHA site key, which always starts with 6L and is 40 characters long
  assert.match(
    cfg,
    /const FIREBASE_APPCHECK_SITE_KEY = "(6L[A-Za-z0-9_-]{38})?";/,
  );
  assert.ok(
    !/client_secret|private_key|BEGIN [A-Z ]*KEY/.test(cfg),
    "no secret in the config file",
  );
});

test("App Check starts only when a site key is set, never on localhost, and a failure cannot break start-up", () => {
  const src = read("js/integrations/firebase.js");
  const i = src.indexOf("FIREBASE_APPCHECK_SITE_KEY");
  assert.ok(i > 0);
  const block = src.slice(i - 60, i + 700);
  assert.match(block, /typeof FIREBASE_APPCHECK_SITE_KEY === "string"/);
  assert.match(block, /location\.hostname === "localhost"/);
  assert.match(block, /try \{[\s\S]*firebase-app-check\.js[\s\S]*\} catch/);
  // it must come before Auth and Firestore are created
  assert.ok(
    src.indexOf("initializeAppCheck") < src.indexOf("authMod.getAuth(app)"),
  );
});

test("the App Check SDK is not loaded in any other place (so nothing changes while the key is empty)", () => {
  const src = read("js/integrations/firebase.js");
  assert.equal(src.split("firebase-app-check.js").length - 1, 1);
});
