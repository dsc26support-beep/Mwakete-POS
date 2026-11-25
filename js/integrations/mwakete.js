/* Mwakete marketplace integration boundary.
 * Implement only against verified, existing Mwakete APIs and authentication.
 * Never create a second marketplace customer, seller, order or inventory authority.
 *
 * STATUS: NOT CONNECTED. The Mwakete API contract (endpoints, authentication, tenancy rules) has not been supplied,
 * so nothing here calls any network address. Every method refuses with a clear reason instead of guessing.
 * The POS works fully on its own without this adapter. See docs/MWAKETE_INTEGRATION.md for what is needed to connect it. */
const MwaketeIntegration = {
  // What must be supplied by the Mwakete team before real code can be written (shown on the Setup screen).
  requirements: [
    "The documented identity / sign-in service for sellers, and how a POS device is authorised for one store",
    "The documented catalogue and inventory endpoints (read products, read and change stock) and their data shapes",
    "The documented order / sale submission endpoint, with an idempotency key rule, and error codes",
    "Which store (tenant) a seller owns, and the rule that keeps marketplace data apart from independent-business data",
    "A test environment and test accounts, so nothing is tried on the live marketplace",
  ],
  async status() {
    return {
      connected: false,
      configured: false,
      reason:
        "The Mwakete API details have not been supplied yet, so this POS runs on its own. Nothing is sent to Mwakete.",
    };
  },
  async authenticate() {
    throw new Error(
      "Mwakete sign-in is not configured. It needs the existing Mwakete identity service; no separate login is created here.",
    );
  },
  async disconnect() {
    // Nothing is connected, so there is nothing to undo; kept so the screen's Disconnect button has one honest answer.
    return { connected: false, changed: false };
  },
  async getCatalogue() {
    throw new Error("Mwakete catalogue API is not configured.");
  },
  async submitSale() {
    throw new Error("Mwakete sales API is not configured.");
  },
};
if (typeof module !== "undefined") module.exports = MwaketeIntegration;
