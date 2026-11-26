/* AnalyticsCore — period reports for one device: day / week / month / custom ranges, filters, breakdowns, profit estimate.
 * Pure (no DOM). Unit tested in Node.
 * Honest limits, repeated on screen: figures cover THIS device only (and what has been synced to it);
 * profit uses each product's CURRENT cost price, only for products that have one; sale lines are before discount
 * and tax in the product/category tables; refunds are counted on the day the credit note was made. */
(function (root) {
  const toMinor = (n) => Math.round(Number(n) * 100);
  const fromMinor = (m) => m / 100;
  const DAY = 86400000;
  const startOfDay = (ms) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const endOfDay = (ms) => {
    const d = new Date(ms);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  };

  /* preset: today | yesterday | week (Mon-today) | lastweek | month | lastmonth | custom (opts.from/opts.to = ms) */
  function range(preset, now = Date.now(), custom = {}) {
    const today = startOfDay(now);
    const dow = (new Date(now).getDay() + 6) % 7; // Monday = 0
    switch (preset) {
      case "today":
        return { from: today, to: endOfDay(now), label: "Today" };
      case "yesterday":
        return {
          from: today - DAY,
          to: endOfDay(today - DAY),
          label: "Yesterday",
        };
      case "week":
        return {
          from: today - dow * DAY,
          to: endOfDay(now),
          label: "This week (Monday to today)",
        };
      case "lastweek": {
        const mon = today - dow * DAY - 7 * DAY;
        return { from: mon, to: endOfDay(mon + 6 * DAY), label: "Last week" };
      }
      case "month": {
        const d = new Date(now);
        return {
          from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
          to: endOfDay(now),
          label: "This month",
        };
      }
      case "lastmonth": {
        const d = new Date(now);
        const from = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
        const to = endOfDay(
          new Date(d.getFullYear(), d.getMonth(), 0).getTime(),
        );
        return { from, to, label: "Last month" };
      }
      case "custom": {
        const from = Number(custom.from);
        const to = Number(custom.to);
        if (!Number.isFinite(from) || !Number.isFinite(to))
          return { error: "Choose both dates." };
        if (to < from)
          return { error: "The end date is before the start date." };
        if (to - from > 366 * DAY)
          return { error: "Choose a period of at most one year." };
        return {
          from: startOfDay(from),
          to: endOfDay(to),
          label: "Custom dates",
        };
      }
      default:
        return { error: "Unknown period." };
    }
  }

  const dayKey = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  };

  function bump(map, key, init) {
    let r = map.get(key);
    if (!r) {
      r = init();
      map.set(key, r);
    }
    return r;
  }

  /* opts: {from, to, category, method, staffUid, tier}; products supply category + cost price (current values). */
  function build(sales, refunds, products, opts = {}) {
    const byId = new Map((products || []).map((p) => [p.id, p]));
    const from = opts.from ?? -Infinity;
    const to = opts.to ?? Infinity;
    const days = new Map(),
      prods = new Map(),
      cats = new Map(),
      methods = new Map(),
      staff = new Map(),
      tiers = new Map();
    const t = {
      count: 0,
      gross: 0,
      discount: 0,
      tax: 0,
      units: 0,
      refunds: 0,
      refundCount: 0,
    };
    const profit = {
      revenue: 0,
      cost: 0,
      costedRevenue: 0,
      uncostedRevenue: 0,
      uncostedProducts: new Set(),
    };
    const used = [];
    for (const s of sales || []) {
      if (!s || s.syncStatus === "rejected") continue;
      if (s.createdAt < from || s.createdAt > to) continue;
      if (opts.staffUid && s.staffUid !== opts.staffUid) continue;
      if (opts.tier && (s.tier || "counter") !== opts.tier) continue;
      const pays =
        Array.isArray(s.payments) && s.payments.length
          ? s.payments
          : [{ method: s.paymentMethod || "other", amount: s.total }];
      if (opts.method && !pays.some((p) => p.method === opts.method)) continue;
      const items = (s.items || []).filter((i) => {
        if (!opts.category) return true;
        const cat = byId.get(i.productId)?.category || "";
        return opts.category === "__none__" ? !cat : cat === opts.category;
      });
      if (opts.category && !items.length) continue;
      used.push(s);
      const g = toMinor(s.total);
      t.count++;
      t.gross += g;
      t.discount += toMinor(s.discount?.amount || 0);
      t.tax += toMinor(s.tax ?? s.invoice?.tax ?? 0);
      const d = bump(days, dayKey(s.createdAt), () => ({
        day: dayKey(s.createdAt),
        sales: 0,
        gross: 0,
      }));
      d.sales++;
      d.gross += g;
      const sr = bump(staff, s.staffUid || "this device", () => ({
        staff: s.staffUid || "this device",
        sales: 0,
        gross: 0,
      }));
      sr.sales++;
      sr.gross += g;
      const tr = bump(tiers, s.tier || "counter", () => ({
        edition: s.tier || "counter",
        sales: 0,
        gross: 0,
      }));
      tr.sales++;
      tr.gross += g;
      for (const p of pays) {
        const m = bump(methods, p.method, () => ({
          method: p.method,
          sales: 0,
          gross: 0,
        }));
        m.sales++;
        m.gross += toMinor(p.amount);
      }
      let lines = 0;
      for (const i of s.items || [])
        lines += toMinor(i.unitPrice) * (Number(i.quantity) || 0);
      const disc = toMinor(s.discount?.amount || 0);
      const factor = lines > 0 ? Math.max(0, (lines - disc) / lines) : 1;
      for (const i of items) {
        const q = Number(i.quantity) || 0;
        const rev = toMinor(i.unitPrice) * q;
        t.units += q * (i.packUnits || 1);
        const pr = bump(prods, i.productId || i.name, () => ({
          name: i.name,
          quantity: 0,
          revenue: 0,
        }));
        pr.quantity += q;
        pr.revenue += rev;
        const prod = byId.get(i.productId);
        const cat = prod?.category || "Uncategorised";
        const cr = bump(cats, cat, () => ({
          category: cat,
          quantity: 0,
          revenue: 0,
        }));
        cr.quantity += q;
        cr.revenue += rev;
        const net = Math.round(rev * factor);
        if (
          prod &&
          prod.costPrice !== undefined &&
          prod.costPrice !== null &&
          prod.costPrice !== ""
        ) {
          profit.revenue += net;
          profit.costedRevenue += net;
          profit.cost += toMinor(prod.costPrice) * q * (i.packUnits || 1);
        } else {
          profit.uncostedRevenue += net;
          profit.uncostedProducts.add(i.name);
        }
      }
    }
    const usedIds = new Set(used.map((s) => s.id));
    for (const r of refunds || []) {
      if (r.createdAt < from || r.createdAt > to) continue;
      if (opts.method || opts.category || opts.staffUid || opts.tier) {
        if (!usedIds.has(r.saleId)) continue; // keep refunds in step with the filtered sales
      }
      t.refunds += toMinor(r.total);
      t.refundCount++;
    }
    const money = (rows, keys) =>
      rows.map((r) => {
        const o = { ...r };
        for (const k of keys) o[k] = fromMinor(r[k]);
        return o;
      });
    const sortBy = (rows, k) => rows.sort((a, b) => b[k] - a[k]);
    return {
      totals: {
        count: t.count,
        gross: fromMinor(t.gross),
        refunds: fromMinor(t.refunds),
        refundCount: t.refundCount,
        net: fromMinor(t.gross - t.refunds),
        discount: fromMinor(t.discount),
        tax: fromMinor(t.tax),
        units: t.units,
        average: t.count ? fromMinor(Math.round(t.gross / t.count)) : 0,
      },
      byDay: money(
        [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
        ["gross"],
      ),
      byProduct: money(sortBy([...prods.values()], "revenue"), ["revenue"]),
      byCategory: money(sortBy([...cats.values()], "revenue"), ["revenue"]),
      byMethod: money(sortBy([...methods.values()], "gross"), ["gross"]),
      byStaff: money(sortBy([...staff.values()], "gross"), ["gross"]),
      byEdition: money(sortBy([...tiers.values()], "gross"), ["gross"]),
      profit: {
        costedRevenue: fromMinor(profit.costedRevenue),
        cost: fromMinor(profit.cost),
        estimate: fromMinor(profit.revenue - profit.cost),
        marginPct:
          profit.revenue > 0
            ? Math.round(
                ((profit.revenue - profit.cost) / profit.revenue) * 1000,
              ) / 10
            : null,
        uncostedRevenue: fromMinor(profit.uncostedRevenue),
        uncostedProducts: [...profit.uncostedProducts].sort(),
      },
    };
  }

  const safe = (v) => {
    const s = String(v == null ? "" : v);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  };
  const q = (v) => {
    const s = safe(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  /* One CSV with labelled sections, readable in a spreadsheet. */
  function toCsv(report, label = "") {
    const L = [];
    const row = (...c) => L.push(c.map(q).join(","));
    row("Report", label);
    row("Sales", report.totals.count);
    row("Gross sales", report.totals.gross.toFixed(2));
    row("Refunds", report.totals.refunds.toFixed(2));
    row("Net sales", report.totals.net.toFixed(2));
    row("Discounts given", report.totals.discount.toFixed(2));
    row("Tax", report.totals.tax.toFixed(2));
    row(
      "Profit estimate",
      report.profit.estimate.toFixed(2),
      "costed products only",
    );
    L.push("");
    const sec = (title, head, rows, f) => {
      row(title);
      row(...head);
      for (const r of rows) row(...f(r));
      L.push("");
    };
    sec("By day", ["day", "sales", "gross"], report.byDay, (r) => [
      r.day,
      r.sales,
      r.gross.toFixed(2),
    ]);
    sec(
      "By product",
      ["product", "quantity", "revenue"],
      report.byProduct,
      (r) => [r.name, r.quantity, r.revenue.toFixed(2)],
    );
    sec(
      "By category",
      ["category", "quantity", "revenue"],
      report.byCategory,
      (r) => [r.category, r.quantity, r.revenue.toFixed(2)],
    );
    sec(
      "By payment method",
      ["method", "sales", "gross"],
      report.byMethod,
      (r) => [r.method, r.sales, r.gross.toFixed(2)],
    );
    sec("By staff", ["staff", "sales", "gross"], report.byStaff, (r) => [
      r.staff,
      r.sales,
      r.gross.toFixed(2),
    ]);
    sec("By edition", ["edition", "sales", "gross"], report.byEdition, (r) => [
      r.edition,
      r.sales,
      r.gross.toFixed(2),
    ]);
    return L.join("\r\n") + "\r\n";
  }

  const api = { range, build, toCsv, dayKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AnalyticsCore = api;
})(typeof window !== "undefined" ? window : globalThis);
