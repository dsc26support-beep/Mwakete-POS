/* Cloud account panel (Settings): Email/Password sign-in for the optional Firebase backend. */
const CloudUI = (() => {
  const $ = (id) => document.getElementById(id);
  function render() {
    const signedIn = FirebaseBackend.isSignedIn();
    $("cloudStatus").textContent = signedIn
      ? "Signed in as " +
        FirebaseBackend.email() +
        ". Sales sync to your cloud account."
      : "Not signed in. Sales are saved on this device only.";
    $("cloudForm").classList.toggle("hidden", signedIn);
    $("cloudSignOut").classList.toggle("hidden", !signedIn);
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
  function creds() {
    const f = $("cloudForm").elements;
    return [f.email.value, f.password.value];
  }
  async function init() {
    if (!$("cloudPanel") || typeof FirebaseBackend === "undefined") return;
    $("cloudForm").addEventListener("submit", (e) => {
      e.preventDefault();
      run($("cloudSignIn"), () => FirebaseBackend.signIn(...creds()));
    });
    $("cloudSignUp").addEventListener("click", () =>
      run($("cloudSignUp"), () => FirebaseBackend.signUp(...creds())),
    );
    $("cloudReset").addEventListener("click", () =>
      run($("cloudReset"), async () => {
        const email = $("cloudForm").elements.email.value;
        if (!email) throw new Error("Enter your email first.");
        await FirebaseBackend.resetPassword(email);
        toast("If that email has an account, a reset link was sent.");
      }),
    );
    $("cloudSignOut").addEventListener("click", () =>
      run($("cloudSignOut"), async () => {
        await FirebaseBackend.signOut();
        toast("Signed out. Unsent sales stay on this device.");
      }),
    );
    const start = () =>
      FirebaseBackend.init()
        .then(() => {
          FirebaseBackend.onChange(() => {
            $("cloudForm").elements.password.value = "";
            render();
            if (FirebaseBackend.isSignedIn())
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
  return { init };
})();
