/* ==========================================================================
   HOUSE OF ALDEN ADMIN — Home (the dashboard)
   Sales, orders and stock for a chosen period, compared with the period
   before. Everything is worked out from the live order list, so the figures
   move the moment an order is placed or changed.
   ========================================================================== */

import { availability, countsAsSale, derive, isReady, state, subscribe } from "../store.js";
import { compactMoney, greeting, money, monthLabel, number, relative, shortDate, toDate } from "../format.js";
import { salesChart } from "../lib/chart.js";
import { badge, card, dataTable, emptyState, h, icon, page, pageHeader, rowLink, select, setTitle, skeleton, thumb } from "../ui.js";
import { customerLabel, fulfillmentBadge, paymentBadge } from "./shared.js";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12m", label: "Last 12 months" },
];
const RANGE_KEY = "hoa.admin.range";

const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/* The period, the one before it, and its buckets (hours, days or months). */
function periods(range, now = new Date()) {
  const today = startOfDay(now);
  if (range === "today") {
    const buckets = Array.from({ length: 24 }, (_, hr) => new Date(today.getTime() + hr * 3600000));
    return {
      start: today, end: new Date(today.getTime() + DAY), prevStart: new Date(today.getTime() - DAY),
      buckets, unit: "hour",
      label: (d) => d.toLocaleTimeString("en-IN", { hour: "numeric" }),
      longLabel: (d) => `${shortDate(d)}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`,
      compare: "yesterday",
    };
  }
  if (range === "12m") {
    const first = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const buckets = Array.from({ length: 12 }, (_, m) => new Date(first.getFullYear(), first.getMonth() + m, 1));
    return {
      start: first, end: new Date(now.getFullYear(), now.getMonth() + 1, 1), prevStart: new Date(first.getFullYear() - 1, first.getMonth(), 1),
      buckets, unit: "month", label: (d) => d.toLocaleDateString("en-IN", { month: "short" }), longLabel: monthLabel,
      compare: "the 12 months before",
    };
  }
  const days = { "7d": 7, "30d": 30, "90d": 90 }[range] || 30;
  const start = new Date(today.getTime() - (days - 1) * DAY);
  const buckets = Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * DAY));
  return {
    start, end: new Date(today.getTime() + DAY), prevStart: new Date(start.getTime() - days * DAY),
    buckets, unit: "day", label: shortDate, longLabel: (d) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    compare: `the previous ${days} days`,
  };
}

function bucketIndex(p, d, offsetStart) {
  if (p.unit === "hour") return Math.floor((d - offsetStart) / 3600000);
  if (p.unit === "day") return Math.round((startOfDay(d) - offsetStart) / DAY);
  return (d.getFullYear() - offsetStart.getFullYear()) * 12 + d.getMonth() - offsetStart.getMonth();
}

function summarise(range) {
  const p = periods(range);
  const n = p.buckets.length;
  const current = new Array(n).fill(0);
  const previous = new Array(n).fill(0);
  const now = { sales: 0, orders: 0, units: 0 };
  const before = { sales: 0, orders: 0, units: 0 };
  const products = new Map();

  for (const o of state.orders) {
    if (!countsAsSale(o)) continue;
    const d = toDate(o.createdAt);
    if (!d) continue;
    const total = Number(o.total) || 0;
    const units = (o.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
    if (d >= p.start && d < p.end) {
      const i = bucketIndex(p, d, p.start);
      if (i >= 0 && i < n) current[i] += total;
      now.sales += total;
      now.orders += 1;
      now.units += units;
      (o.lines || []).forEach((l) => {
        const row = products.get(l.productId) || { id: l.productId, name: l.name, image: l.image, units: 0, revenue: 0 };
        row.units += Number(l.qty) || 0;
        row.revenue += Number(l.total) || 0;
        products.set(l.productId, row);
      });
    } else if (d >= p.prevStart && d < p.start) {
      const i = bucketIndex(p, d, p.prevStart);
      if (i >= 0 && i < n) previous[i] += total;
      before.sales += total;
      before.orders += 1;
      before.units += units;
    }
  }
  const top = [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  return { p, current, previous, now, before, top };
}

/* "+12% vs the previous 30 days", arrow and colour both say which way. */
function delta(nowValue, beforeValue, compare) {
  if (!beforeValue) return h("p", { class: "stat-delta" }, nowValue ? `No sales in ${compare}` : "");
  const change = Math.round(((nowValue - beforeValue) / beforeValue) * 100);
  if (change === 0) return h("p", { class: "stat-delta" }, `Same as ${compare}`);
  const up = change > 0;
  return h("p", { class: `stat-delta ${up ? "is-up" : "is-down"}` },
    icon(up ? "trending-up" : "trending-down", { size: 16 }),
    h("span", null, `${up ? "+" : ""}${change}%`),
    h("span", { class: "stat-delta-vs" }, ` vs ${compare}`));
}

function stat(label, value, d) {
  return h("div", { class: "stat" }, h("p", { class: "stat-label" }, label), h("p", { class: "stat-value" }, value), d);
}

function todo(count, text, href) {
  return h("li", null, h("a", { class: "todo", href },
    h("span", { class: "todo-count" }, number(count)), h("span", null, text), icon("chevron-right", { size: 16 })));
}

function body(range) {
  if (!isReady("orders", "products")) return h("div", { class: "stack stack--md" }, card({}, skeleton(2)), card({}, skeleton(6)));
  const s = summarise(range);
  const d = derive();
  const aov = s.now.orders ? Math.round(s.now.sales / s.now.orders) : 0;
  const aovBefore = s.before.orders ? Math.round(s.before.sales / s.before.orders) : 0;

  const stats = h("div", { class: "stats card" },
    stat("Total sales", money(s.now.sales), delta(s.now.sales, s.before.sales, s.p.compare)),
    stat("Orders", number(s.now.orders), delta(s.now.orders, s.before.orders, s.p.compare)),
    stat("Average order value", money(aov), delta(aov, aovBefore, s.p.compare)),
    stat("Units sold", number(s.now.units), delta(s.now.units, s.before.units, s.p.compare)));

  const chartCard = card({ title: "Total sales over time" },
    salesChart({
      current: s.current,
      previous: s.previous,
      labels: s.p.buckets.map(s.p.label),
      longLabels: s.p.buckets.map(s.p.longLabel),
      format: money,
      formatTick: compactMoney,
      summary: `Total sales ${money(s.now.sales)} for this period, against ${money(s.before.sales)} for ${s.p.compare}.`,
    }));

  const tasks = [];
  if (d.toFulfil) tasks.push(todo(d.toFulfil, d.toFulfil === 1 ? "order to fulfill" : "orders to fulfill", "/admin/orders?tab=unfulfilled"));
  if (d.unpaid) tasks.push(todo(d.unpaid, d.unpaid === 1 ? "payment pending" : "payments pending", "/admin/orders?tab=unpaid"));
  if (d.lowStock.length) tasks.push(todo(d.lowStock.length, d.lowStock.length === 1 ? "product low on stock" : "products low on stock", "/admin/inventory?tab=low"));
  const untracked = state.products.filter((p) => p.status === "active" && !p.trackInventory).length;
  if (untracked) tasks.push(todo(untracked, untracked === 1 ? "active product isn't tracking stock" : "active products aren't tracking stock", "/admin/inventory?tab=untracked"));
  const todoCard = card({ title: "Things to do" },
    tasks.length ? h("ul", { class: "todo-list" }, tasks)
      : h("p", { class: "all-done" }, icon("circle-check", { size: 18 }), "All caught up. Nothing waiting on you."));

  const maxRevenue = Math.max(1, ...s.top.map((t) => t.revenue));
  const topCard = card({ title: "Top products", actions: h("a", { class: "link", href: "/admin/products" }, "View all") },
    s.top.length
      ? h("ol", { class: "bar-list" }, s.top.map((t) => h("li", null,
        h("div", { class: "bar-list-head" },
          thumb(t.image, "", 32),
          h("a", { href: `/admin/products/${encodeURIComponent(t.id)}`, class: "bar-list-name" }, t.name),
          h("span", { class: "bar-list-value" }, money(t.revenue))),
        h("div", { class: "bar-track", "aria-hidden": "true" }, h("span", { class: "bar", style: { width: `${Math.max(2, (t.revenue / maxRevenue) * 100)}%` } })),
        h("p", { class: "bar-list-meta" }, `${number(t.units)} sold`))))
      : h("p", { class: "subdued" }, "No sales in this period yet."));

  const recent = state.orders.slice(0, 6);
  const recentCard = card({ title: "Recent orders", flush: true, actions: h("a", { class: "link", href: "/admin/orders" }, "View all") },
    recent.length
      ? dataTable({
        columns: [
          { label: "Order", render: (o) => rowLink(`/admin/orders/${o.id}`, o.name) },
          { label: "Date", render: (o) => relative(o.createdAt) },
          { label: "Customer", render: customerLabel },
          { label: "Payment", render: paymentBadge },
          { label: "Fulfillment", render: fulfillmentBadge },
          { label: "Total", align: "end", render: (o) => money(o.total) },
        ],
        rows: recent,
        rowHref: (o) => `/admin/orders/${o.id}`,
        caption: "Most recent orders",
      })
      : emptyState({ glyph: "receipt", title: "No orders yet", body: "Orders placed on the website appear here the moment they come in, with a sound and a notification.", compact: true }));

  const lowCard = d.lowStock.length
    ? card({ title: "Low stock", actions: h("a", { class: "link", href: "/admin/inventory?tab=low" }, "Manage") },
      h("ul", { class: "mini-list" }, d.lowStock.slice(0, 6).map((p) => {
        const a = availability(p);
        return h("li", null, thumb((p.images && p.images[0] && p.images[0].url) || "", "", 32),
          h("a", { href: `/admin/products/${encodeURIComponent(p.id)}` }, p.name),
          badge(a.label, a.quantity <= 0 ? "critical" : "warning"));
      })))
    : null;

  return h("div", { class: "stack stack--md" },
    stats,
    chartCard,
    h("div", { class: "grid-2" }, todoCard, topCard),
    lowCard,
    recentCard);
}

export function render(root) {
  setTitle("Home");
  let range = "30d";
  try {
    range = localStorage.getItem(RANGE_KEY) || range;
  } catch { /* private mode */ }
  if (!RANGES.some((r) => r.value === range)) range = "30d";

  const picker = select(RANGES, { value: range, "aria-label": "Date range", class: "input select select--inline" });
  const holder = h("div");
  let chartEl = null;

  const draw = () => {
    if (chartEl && chartEl.destroy) chartEl.destroy();
    const next = body(range);
    chartEl = next.querySelector(".chart");
    holder.replaceChildren(next);
  };
  picker.addEventListener("change", () => {
    range = picker.value;
    try {
      localStorage.setItem(RANGE_KEY, range);
    } catch { /* fine */ }
    draw();
  });

  root.replaceChildren(page({ width: "wide" },
    pageHeader({ title: greeting(), extra: picker }),
    holder));
  draw();

  const off = subscribe((topics) => {
    if (topics.has("orders") || topics.has("products") || topics.has("adminSettings")) draw();
  });
  return () => {
    off();
    if (chartEl && chartEl.destroy) chartEl.destroy();
  };
}
