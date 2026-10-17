/* ==========================================================================
   HOUSE OF ALDEN ADMIN — Orders
   Every order, newest first, live. Tabs filter, search finds by number,
   customer, phone or piece; ticked rows can be paid, fulfilled or archived
   together; the current view exports to CSV.
   ========================================================================== */

import { isOpenUnfulfilled, isReady, state, subscribe } from "../store.js";
import { dateTime, money, relative } from "../format.js";
import { setQuery } from "../router.js";
import * as ops from "../ops.js";
import { downloadCsv, stamp } from "../lib/csv.js";
import {
  bulkBar, button, card, dataTable, emptyState, h, page, pageHeader, pagination, rowLink,
  searchField, setTitle, skeleton, tabs, toast, toastError,
} from "../ui.js";
import { channelLabel, customerLabel, fulfillmentBadge, itemsLabel, orderStateBadge, paymentBadge } from "./shared.js";

const TABS = [
  { id: "all", label: "All", test: () => true },
  { id: "unfulfilled", label: "Unfulfilled", test: isOpenUnfulfilled, counted: true },
  { id: "unpaid", label: "Unpaid", test: (o) => o.status !== "cancelled" && o.financialStatus === "pending", counted: true },
  { id: "open", label: "Open", test: (o) => o.status === "open" },
  { id: "archived", label: "Archived", test: (o) => o.status === "archived" },
  { id: "cancelled", label: "Cancelled", test: (o) => o.status === "cancelled" },
];
const PER_PAGE = 50;

function matches(o, q) {
  if (!q) return true;
  const needle = q.toLowerCase().replace(/^#/, "").trim();
  const c = o.customer || {};
  const hay = [o.name, o.number, c.name, c.phone, c.email, ...(o.lines || []).map((l) => l.name)].join(" ").toLowerCase();
  if (hay.includes(needle)) return true;
  const digits = needle.replace(/\D/g, "");
  return digits.length >= 4 && String(c.phone || "").replace(/\D/g, "").includes(digits);
}

export function render(root, route) {
  setTitle("Orders");
  const fromUrl = route.query.get("tab");
  let tab = TABS.some((t) => t.id === fromUrl) ? fromUrl : "all";
  let q = route.query.get("q") || "";
  let pageNo = 1;
  let selection = new Set();
  let known = null; // ids seen so far, to highlight orders that arrive while watching
  const fresh = new Set();

  const search = searchField({
    value: q,
    placeholder: "Search by order number, customer, phone or piece",
    label: "Search orders",
    onInput: (v) => {
      q = v.trim();
      pageNo = 1;
      setQuery({ q });
      draw();
    },
  });
  const tabsHolder = h("div", { class: "index-tabs" });
  const bulkHolder = h("div");
  const listHolder = h("div");

  root.replaceChildren(page({ width: "wide" },
    pageHeader({
      title: "Orders",
      secondary: [button("Export", { iconStart: "download", onClick: exportCsv })],
      primary: button("Create order", { variant: "primary", href: "/admin/orders/new" }),
    }),
    card({ flush: true, className: "index-card" }, tabsHolder, h("div", { class: "index-toolbar" }, search.wrap), bulkHolder, listHolder)));

  const filtered = () => {
    const t = TABS.find((x) => x.id === tab);
    return state.orders.filter((o) => t.test(o) && matches(o, q));
  };

  function selectedOrders() {
    return [...selection].map((id) => state.ordersById.get(id)).filter(Boolean);
  }

  async function bulk(label, eligible, run) {
    const targets = selectedOrders().filter(eligible);
    if (!targets.length) {
      toast(`None of the selected orders can be ${label}.`);
      return;
    }
    const results = await Promise.allSettled(targets.map(run));
    const failed = results.filter((r) => r.status === "rejected");
    selection = new Set();
    if (failed.length) toastError(failed[0].reason, `${failed.length} of ${targets.length} orders couldn't be updated.`);
    else toast(`${targets.length} ${targets.length === 1 ? "order" : "orders"} ${label}`);
    draw();
  }

  const bulkActions = () => [
    { label: "Mark as paid", onClick: () => bulk("marked as paid", (o) => o.status !== "cancelled" && o.financialStatus === "pending", (o) => ops.setPaid(o, true)) },
    { label: "Mark as fulfilled", onClick: () => bulk("marked as fulfilled", isOpenUnfulfilled, (o) => ops.setFulfilled(o, true)) },
    { label: "Archive", onClick: () => bulk("archived", (o) => o.status === "open", (o) => ops.setArchived(o, true)) },
    { label: "Unarchive", onClick: () => bulk("unarchived", (o) => o.status === "archived", (o) => ops.setArchived(o, false)) },
  ];

  function exportCsv() {
    const rows = filtered();
    if (!rows.length) return toast("Nothing to export in this view.");
    downloadCsv(`orders-${stamp()}.csv`, [
      ["Order", "Date", "Customer", "Phone", "Email", "Address", "Channel", "Payment", "Fulfillment", "Status",
        "Items", "Subtotal", "Shipping", "Total", "Pieces", "Customer note", "Staff note"],
      ...rows.map((o) => {
        const c = o.customer || {};
        return [o.name, dateTime(o.createdAt), c.name, c.phone, c.email, c.address, channelLabel(o), o.financialStatus,
          o.fulfillmentStatus, o.status, o.itemCount, o.subtotal, o.shipping, o.total,
          (o.lines || []).map((l) => `${l.name} x ${l.qty}`).join("; "), o.customerNote, o.note];
      }),
    ]);
  }

  function draw() {
    if (!isReady("orders")) {
      listHolder.replaceChildren(h("div", { class: "pad" }, skeleton(8)));
      return;
    }
    if (state.errors.orders) {
      listHolder.replaceChildren(emptyState({ glyph: "alert-triangle", title: "Orders couldn't load", body: "Check your connection, then reload the page." }));
      return;
    }

    /* Orders that arrive while this list is open are tinted for a moment. */
    const ids = state.orders.map((o) => o.id);
    if (known) ids.forEach((id) => {
      if (!known.has(id)) {
        fresh.add(id);
        setTimeout(() => {
          fresh.delete(id);
          const row = listHolder.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
          if (row) row.classList.remove("is-new");
        }, 8000);
      }
    });
    known = new Set(ids);

    const focusInTabs = tabsHolder.contains(document.activeElement);
    tabsHolder.replaceChildren(tabs({
      label: "Order views",
      active: tab,
      items: TABS.map((t) => ({ id: t.id, label: t.label, count: t.counted ? state.orders.filter(t.test).length || null : null })),
      onSelect: (id) => {
        tab = id;
        pageNo = 1;
        selection = new Set();
        setQuery({ tab: id === "all" ? null : id });
        draw();
      },
    }));
    if (focusInTabs) {
      const sel = tabsHolder.querySelector('[aria-selected="true"]');
      if (sel) sel.focus();
    }

    if (!state.orders.length) {
      bulkHolder.replaceChildren();
      listHolder.replaceChildren(emptyState({
        glyph: "receipt",
        title: "Your orders will show here",
        body: "When a customer places an order on the website it appears here straight away. Orders taken on WhatsApp or by phone can be added with Create order.",
        action: button("Create order", { variant: "primary", href: "/admin/orders/new" }),
      }));
      return;
    }

    const rows = filtered();
    selection = new Set([...selection].filter((id) => rows.some((r) => r.id === id)));
    const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    pageNo = Math.min(pageNo, pages);
    const visible = rows.slice((pageNo - 1) * PER_PAGE, pageNo * PER_PAGE);

    bulkHolder.replaceChildren(selection.size ? bulkBar(selection.size, bulkActions(), () => {
      selection = new Set();
      draw();
    }) : "");

    if (!rows.length) {
      listHolder.replaceChildren(emptyState({ glyph: "search", title: "No orders found", body: q ? "Try another search, or a different tab." : "Nothing in this view right now.", compact: true }));
      return;
    }

    const table = dataTable({
      caption: "Orders",
      rows: visible,
      rowHref: (o) => `/admin/orders/${o.id}`,
      rowClass: (o) => (fresh.has(o.id) ? "is-new" : ""),
      selection,
      onSelect: (next) => {
        selection = next;
        draw();
      },
      columns: [
        { label: "Order", render: (o) => rowLink(`/admin/orders/${o.id}`, o.name) },
        { label: "Date", render: (o) => relative(o.createdAt) },
        { label: "Customer", render: customerLabel },
        { label: "Channel", render: channelLabel, className: "hide-sm" },
        { label: "Total", align: "end", render: (o) => money(o.total) },
        { label: "Payment", render: (o) => [paymentBadge(o), orderStateBadge(o)] },
        { label: "Fulfillment", render: fulfillmentBadge },
        { label: "Items", render: itemsLabel, className: "hide-sm" },
      ],
    });
    table.querySelectorAll("tbody tr").forEach((tr, i) => (tr.dataset.id = visible[i].id));
    listHolder.replaceChildren(table, pagination({
      page: pageNo,
      pages,
      label: "Order pages",
      onPage: (p) => {
        pageNo = p;
        draw();
        window.scrollTo({ top: 0 });
      },
    }) || "");
  }

  draw();
  const off = subscribe((topics) => {
    if (topics.has("orders")) draw();
  });
  return off;
}
