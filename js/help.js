/* Help & Guides view wiring. Logic and HTML builders live in guides.js (GuidesCore). */
const HelpCentre = (() => {
  const C = GuidesCore,
    $ = (id) => document.getElementById(id);
  let category = "",
    openGuide = null;
  const newId = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : "res-" + Date.now() + "-" + Math.random().toString(16).slice(2);

  async function render() {
    const q = $("helpSearch").value;
    const [bookmarks, recent, resources] = await Promise.all([
      C.listBookmarks(POSDB),
      C.listRecent(POSDB),
      C.listResources(POSDB),
    ]);
    const byId = Object.fromEntries(C.OFFICIAL_GUIDES.map((g) => [g.id, g]));
    $("helpCategories").innerHTML = C.CATEGORIES.map(
      (c) =>
        `<button class="chip${category === c.id ? " active" : ""}" data-help-cat="${C.esc(c.id)}"><span aria-hidden="true">${c.icon}</span> <strong>${C.esc(c.title)}</strong><small>${C.esc(c.blurb)}</small></button>`,
    ).join("");
    if (openGuide && byId[openGuide]) {
      $("helpList").innerHTML = C.guideDetail(
        byId[openGuide],
        bookmarks.includes(openGuide),
      );
    } else {
      const searching = q.trim() || category;
      const results = C.searchGuides(C.OFFICIAL_GUIDES, q, category);
      const card = (g) => C.guideCard(g, bookmarks.includes(g.id));
      let html = "";
      if (!searching) {
        const pop = C.OFFICIAL_GUIDES.filter((g) => g.popular),
          saved = bookmarks.map((i) => byId[i]).filter(Boolean),
          rec = recent.map((i) => byId[i]).filter(Boolean);
        html += `<h3>Popular guides</h3><div class="guide-grid">${pop.map(card).join("")}</div>`;
        if (saved.length)
          html += `<h3>Saved guides</h3><div class="guide-grid">${saved.map(card).join("")}</div>`;
        if (rec.length)
          html += `<h3>Recently viewed</h3><div class="guide-grid">${rec.map(card).join("")}</div>`;
      } else {
        html += results.length
          ? `<div class="guide-grid">${results.map(card).join("")}</div>`
          : `<p class="empty">No guides match “${C.esc(q)}”.</p>`;
      }
      $("helpList").innerHTML = html;
    }
    $("officialLinks").innerHTML =
      C.OFFICIAL_LINKS.map(
        (l) =>
          `<div class="resource-row"><div><strong>${C.externalLink(l)}</strong><small>${C.esc(l.note)}</small></div></div>`,
      ).join("") +
      "<h3>Contact Mwakete Support</h3>" +
      C.supportContacts();
    $("businessResources").innerHTML = resources.length
      ? resources.map(C.resourceRow).join("")
      : '<p class="empty">No business links or notes yet.</p>';
    const reports = await C.listReports(POSDB);
    $("reportList").innerHTML = reports.length
      ? reports.map((r) => C.reportRow(r, !!C.SUPPORT_EMAIL)).join("")
      : '<p class="empty">No saved reports.</p>';
  }

  // Opt-in technical details only: no sales, product or customer data.
  function diagnostics() {
    return {
      appVersion: "shell-v7",
      online: navigator.onLine,
      userAgent: navigator.userAgent,
    };
  }
  async function findReport(id) {
    return (await C.listReports(POSDB)).find((r) => r.id === id);
  }

  async function init() {
    $("helpSearch").addEventListener("input", () => {
      openGuide = null;
      render();
    });
    $("resourceForm").elements.kind.addEventListener("change", (e) => {
      const note = e.target.value === "note";
      $("resourceUrlLabel").classList.toggle("hidden", note);
      $("resourceForm").elements.url.required = !note;
    });
    $("resourceForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget,
        f = form.elements;
      const r = await C.addResource(
        POSDB,
        {
          kind: f.kind.value,
          title: f.title.value,
          url: f.url.value,
          note: f.note.value,
        },
        newId(),
      );
      if (!r.ok) return toast(r.error);
      form.reset();
      $("resourceUrlLabel").classList.remove("hidden");
      f.url.required = true;
      await render();
      toast("Saved on this device.");
    });
    const reportForm = $("reportForm");
    reportForm.elements.category.innerHTML =
      '<option value="">Choose…</option>' +
      C.REPORT_CATEGORIES.map(
        (c) => `<option value="${C.esc(c.id)}">${C.esc(c.title)}</option>`,
      ).join("");
    reportForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = reportForm.elements;
      const r = await C.addReport(
        POSDB,
        {
          category: f.category.value,
          message: f.message.value,
          guideId: f.guideId.value,
        },
        newId(),
      );
      if (!r.ok) return toast(r.error);
      const keep = f.diagnostics.checked;
      reportForm.reset();
      f.diagnostics.checked = keep;
      await render();
      toast("Report saved on this device. It has NOT been sent.");
    });
    document.addEventListener("click", async (e) => {
      const t = e.target;
      const rg = t.closest("[data-report-guide]");
      if (rg) {
        reportForm.elements.guideId.value = rg.dataset.reportGuide;
        reportForm.elements.category.value = "guide";
        $("reportPanel").scrollIntoView({ behavior: "smooth" });
        reportForm.elements.message.focus();
        return;
      }
      const cp = t.closest("[data-copy-report]");
      if (cp) {
        const r = await findReport(cp.dataset.copyReport);
        if (!r) return;
        const text = C.buildReportText(
          r,
          reportForm.elements.diagnostics.checked ? diagnostics() : null,
        );
        try {
          await navigator.clipboard.writeText(text);
          toast("Report copied. Paste it into a message to support.");
        } catch {
          prompt("Copy this report:", text);
        }
        return;
      }
      const em = t.closest("[data-email-report]");
      if (em) {
        const r = await findReport(em.dataset.emailReport);
        const url =
          r &&
          C.mailtoUrl(
            C.SUPPORT_EMAIL,
            r,
            reportForm.elements.diagnostics.checked ? diagnostics() : null,
          );
        if (url) location.href = url;
        return;
      }
      const rr = t.closest("[data-remove-report]");
      if (rr) {
        if (confirm("Remove this saved report from this device?")) {
          await C.removeReport(POSDB, rr.dataset.removeReport);
          render();
        }
        return;
      }
      const ext = t.closest("a[data-ext]");
      if (ext) {
        if (
          !confirm(
            "You are leaving Mwakete POS and opening " +
              ext.dataset.ext +
              ".\nOnly continue if you trust this site. Never enter your Mwakete or Google password there on request.",
          )
        )
          e.preventDefault();
        return;
      }
      const cat = t.closest("[data-help-cat]");
      if (cat) {
        category = category === cat.dataset.helpCat ? "" : cat.dataset.helpCat;
        openGuide = null;
        return render();
      }
      const open = t.closest("[data-guide]");
      if (open) {
        openGuide = open.dataset.guide;
        await C.recordView(POSDB, openGuide);
        return render();
      }
      if (t.closest("[data-guide-back]")) {
        openGuide = null;
        return render();
      }
      const bm = t.closest("[data-bookmark]");
      if (bm) {
        await C.toggleBookmark(POSDB, bm.dataset.bookmark);
        return render();
      }
      const rm = t.closest("[data-remove-resource]");
      if (rm && confirm("Remove this item from this device?")) {
        await C.removeResource(POSDB, rm.dataset.removeResource);
        render();
      }
    });
    await render();
  }
  return { init, render };
})();
