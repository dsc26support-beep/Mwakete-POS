/* Cloud account panel (Settings): Email/Password sign-in, email verification, owner staff management
 * and the cashier "join a business" flow, for the optional Firebase backend. */
const CloudUI = (() => {
  const $ = (id) => document.getElementById(id);
  const show = (id, on) => $(id).classList.toggle("hidden", !on);
  const esc = (s) =>
    String(s ?? "").replace(
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
  const FB = () => FirebaseBackend;
  let bound = false;

  // Which business this device works for is remembered per account, so signing in as someone else never inherits it.
  async function restoreBusiness() {
    const s = (await POSDB.get("settings", "cloudBusiness"))?.value;
    FB().setBusiness(s && s.uid === FB().uid() ? s.businessId : null);
  }
  async function rememberBusiness(id) {
    if (id)
      await POSDB.put("settings", {
        key: "cloudBusiness",
        value: { uid: FB().uid(), businessId: id },
      });
    else await POSDB.remove("settings", "cloudBusiness");
    FB().setBusiness(id);
  }

  const ROLE_LABEL = {
    cashier: "Cashier",
    manager: "Manager",
    inventory: "Inventory staff",
    auditor: "Auditor (read only)",
  };
  // Can this signed-in person make sales? (The cloud rules enforce it too; this stops a pointless attempt.)
  function canSell() {
    const f = FB();
    if (!f.isSignedIn() || f.role() === "owner") return true;
    return ["cashier", "manager"].includes(f.staffRole());
  }
  async function renderStaff() {
    const box = $("staffList");
    if (!FB().isSignedIn() || !FB().isVerified() || FB().role() !== "owner")
      return (box.innerHTML = "");
    try {
      const staff = await FB().listStaff();
      box.innerHTML = staff.length
        ? staff
            .map(
              (s) =>
                `<div class="sale-row"><div><strong>${esc(s.name)}</strong><small>${s.active ? "Active" : "Removed"} · ${esc(ROLE_LABEL[s.role] || "Cashier")} · <code>${esc(s.uid)}</code></small></div><div class="row-actions"><select data-staff-role="${esc(s.uid)}" data-name="${esc(s.name)}" data-active="${s.active ? "1" : "0"}" aria-label="Role for ${esc(s.name)}">${FB()
                  .ROLES.map(
                    (r) =>
                      `<option value="${r}"${r === (s.role || "cashier") ? " selected" : ""}>${ROLE_LABEL[r]}</option>`,
                  )
                  .join(
                    "",
                  )}</select><button class="text-button" type="button" data-staff="${esc(s.uid)}" data-name="${esc(s.name)}" data-active="${s.active ? "1" : "0"}" data-role="${esc(s.role || "cashier")}">${s.active ? "Remove access" : "Restore access"}</button></div></div>`,
            )
            .join("")
        : '<p class="empty">No staff yet.</p>';
    } catch (e) {
      box.innerHTML = '<p class="muted">Could not load staff right now.</p>';
    }
  }

  function render() {
    const f = FB(),
      signedIn = f.isSignedIn(),
      verified = f.isVerified(),
      cashier = signedIn && f.role() === "cashier";
    $("cloudStatus").textContent = !signedIn
      ? "Not signed in. Sales are saved on this device only."
      : !verified
        ? "Signed in as " +
          f.email() +
          ". Email not verified yet, so nothing syncs."
        : cashier
          ? "Signed in as " +
            f.email() +
            " (" +
            (ROLE_LABEL[f.staffRole()] || "cashier").toLowerCase() +
            ")."
          : "Signed in as " +
            f.email() +
            ". Sales and products sync to your cloud account.";
    show("cloudForm", !signedIn);
    show("cloudSignOut", signedIn);
    show("cloudVerify", signedIn && !verified);
    show("cloudOwner", signedIn && verified && !cashier);
    show("cloudStaffJoin", signedIn && verified && !cashier);
    show("cloudCashier", cashier);
    if (signedIn) {
      $("cloudBizCode").textContent = f.uid();
      $("cloudMyCode").textContent = f.uid();
    }
    // Cashiers cannot edit the catalogue (the cloud rules enforce it; this just hides the form).
    // Managers and inventory staff may manage products; cashiers and auditors may not.
    const sr = signedIn ? f.staffRole() : "owner";
    const limited = cashier && !["manager", "inventory"].includes(sr);
    const pf = $("productForm");
    if (pf) pf.classList.toggle("hidden", limited);
    // Screens that are the owner's business (purchasing) are hidden from limited roles; the rules refuse them anyway.
    document
      .querySelectorAll("[data-owner-only]")
      .forEach((el) => el.classList.toggle("role-hidden", limited));
    // Lets dynamically drawn owner-only buttons (product edit / archive / remove) hide too.
    for (const c of [...document.body.classList])
      if (c.startsWith("role-") && c !== "role-hidden")
        document.body.classList.remove(c);
    document.body.classList.toggle("role-cashier", limited);
    document.body.classList.add("role-" + sr);
    document.body.classList.toggle("cannot-sell", !canSell());
    renderStaff();
  }

  async function run(btn, fn) {
    btn.disabled = true;
    try {
      await fn();
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
    }
  }
  const creds = () => {
    const f = $("cloudForm").elements;
    return [f.email.value, f.password.value];
  };
  const copy = (text) =>
    navigator.clipboard
      ? navigator.clipboard.writeText(text).then(
          () => toast("Copied."),
          () => toast("Select and copy the code."),
        )
      : toast("Select and copy the code.");

  async function init() {
    if (!$("cloudPanel") || typeof FirebaseBackend === "undefined") return;
    $("cloudForm").addEventListener("submit", (e) => {
      e.preventDefault();
      run($("cloudSignIn"), async () => {
        await FB().signIn(...creds());
        if (window.Audit) Audit.log("sign-in", FB().email() || "");
      });
    });
    $("cloudSignUp").addEventListener("click", () =>
      run($("cloudSignUp"), async () => {
        await FB().signUp(...creds());
        toast("Account created. Check your email to verify it.");
      }),
    );
    $("cloudReset").addEventListener("click", () =>
      run($("cloudReset"), async () => {
        const email = $("cloudForm").elements.email.value;
        if (!email) throw new Error("Enter your email first.");
        await FB().resetPassword(email);
        toast("If that email has an account, a reset link was sent.");
      }),
    );
    $("cloudSignOut").addEventListener("click", () =>
      run($("cloudSignOut"), async () => {
        if (window.Audit) await Audit.log("sign-out", FB().email() || "");
        await FB().signOut();
        toast("Signed out. Unsent sales stay on this device.");
      }),
    );
    $("cloudResend").addEventListener("click", () =>
      run($("cloudResend"), async () => {
        await FB().sendVerification();
        toast("Verification email sent.");
      }),
    );
    $("cloudRefresh").addEventListener("click", () =>
      run($("cloudRefresh"), async () => {
        const ok = await FB().refresh();
        toast(
          ok
            ? "Email verified."
            : "Not verified yet. Open the link in the email first.",
        );
        if (ok) POSSynchroniser.run().catch(() => {});
      }),
    );
    $("cloudCopyBiz").addEventListener("click", () => copy(FB().uid()));
    $("cloudCopyMine").addEventListener("click", () => copy(FB().uid()));
    $("staffForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget; // currentTarget is null after an await, so keep a reference
      const f = form.elements;
      run(form.querySelector("button"), async () => {
        await FB().saveStaff(
          f.staffCode.value,
          f.staffName.value,
          true,
          f.staffRole ? f.staffRole.value : "cashier",
        );
        if (window.Audit)
          Audit.log(
            "staff-change",
            "Added " + f.staffName.value + " as " + f.staffRole.value,
          );
        form.reset();
        toast("Staff member added.");
        await renderStaff();
      });
    });
    $("staffList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-staff]");
      if (!b) return;
      run(b, async () => {
        await FB().saveStaff(
          b.dataset.staff,
          b.dataset.name,
          b.dataset.active !== "1",
          b.dataset.role,
        );
        await renderStaff();
      });
    });
    $("staffList").addEventListener("change", (e) => {
      const s = e.target.closest("[data-staff-role]");
      if (!s) return;
      run(s, async () => {
        await FB().saveStaff(
          s.dataset.staffRole,
          s.dataset.name,
          s.dataset.active === "1",
          s.value,
        );
        toast("Role changed.");
        await renderStaff();
      });
    });
    $("joinForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      run(form.querySelector("button"), async () => {
        const id = await FB().joinBusiness(form.elements.bizCode.value);
        await rememberBusiness(id);
        form.reset();
        toast("Joined. Syncing the product list…");
        render();
        POSSynchroniser.run().catch(() => {});
      });
    });
    $("cloudLeave").addEventListener("click", () =>
      run($("cloudLeave"), async () => {
        await rememberBusiness(null);
        render();
        toast("You left that business.");
      }),
    );
    const start = () =>
      FB()
        .init()
        .then(() => {
          if (bound) return;
          bound = true;
          FB().onChange(async () => {
            $("cloudForm").elements.password.value = "";
            if (FB().isSignedIn()) await restoreBusiness();
            render();
            if (FB().isSignedIn() && FB().isVerified())
              POSSynchroniser.run().catch(() => {});
          });
        })
        .catch(() => {
          $("cloudStatus").textContent =
            "Cloud sign-in needs an internet connection. The app works offline without it.";
        });
    render();
    start();
    window.addEventListener("online", () => start());
  }
  return { init, canSell, ROLE_LABEL };
})();
