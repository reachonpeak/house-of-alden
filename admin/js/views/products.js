/* ==========================================================================
   HOUSE OF ALDEN ADMIN — Products
   The whole catalogue, live. "Active" products are on the website; "Draft"
   and "Archived" are hidden from it. Display order decides what the home page
   shelves show first.
   ========================================================================== */

import { availability, derive, isReady, state, subscribe } from "../store.js";
import { money } from "../format.js";
import { setQuery } from "../router.js";
import * as ops from "../ops.js";
import { downloadCsv, stamp } from "../lib/csv.js";
import {
  bulkBar, button, card, confirmDialog, dataTable, emptyState, h, page, pageHeader, rowLink, searchField, select,
  setTitle, skeleton, tabs, thumb, toast, toastError,
} from "../ui.js";
import { productStatusBadge } from "./shared.js";

const TABS = [
  { id: "all", label: "All", test: () => true },
  { id: "active", label: "Active", test: (p) => p.status === "active" },
  { id: "draft", label: "Draft", test: (p) => p.status === "draft" },
  { id: "archived", label: "Archived", test: (p) => p.status === "archived" },
];

const SORTS = [
  { value: "position", label: "Display order", fn: () => 0 },
  { value: "name", label: "Title A to Z", fn: (a, b) => String(a.name).localeCompare(String(b.name)) },
  { value: "price-asc", label: "Price, low to high", fn: (a, b) => (a.price || 0) - (b.price || 0) },
  { value: "price-desc", label: "Price, high to low", fn: (a, b) => (b.price || 0) - (a.price || 0) },
  { value: "stock", label: "Inventory, low to high", fn: (a, b) => stockValue(a) - stockValue(b) },
  { value: "updated", label: "Recently updated", fn: (a, b) => updated(b) - updated(a) },
];

const stockValue = (p) => (p.trackInventory ? Number(p.quantity) || 0 : Number.MAX_SAFE_INTEGER);
const updated = (p) => (p.updatedAt && p.updatedAt.toMillis ? p.updatedAt.toMillis() : 0);
export const firstImage = (p) => (Array.isArray(p.images) && p.images[0] && p.images[0].url) || "";

function inventoryCell(p) {
  const a = availability(p);
  const committed = derive().committed.get(p.id) || 0;
  if (!a.tracked) return h("span", { class: "subdued" }, "Not tracked");
  return h("span", { class: a.tone === "critical" ? "critical-text" : a.tone === "warning" ? "warning-text" : null },
    a.label, committed ? h("span", { class: "subdued" }, ` (${committed} committed)`) : null);
}

function priceCell(p) {
  return [p.compareAtPrice > p.price && h("s", { class: "subdued" }, money(p.compareAtPrice)), " ", money(p.price)];
}

export function render(root, route) {
  setTitle("Products");
  const fromUrl = route.query.get("tab");
  let tab = TABS.some((t) => t.id === fromUrl) ? fromUrl : "all";
  let q = route.query.get("q") || "";
  let category = route.query.get("category") || "all";
  let sort = SORTS.some((s) => s.value === route.query.get("sort")) ? route.query.get("sort") : "position";
  let selection = new Set();

  const search = searchField({ value: q, placeholder: "Search products by title, SKU or tag", label: "Search products",
    onInput: (v) => {
      q = v.trim();
      setQuery({ q });
      draw();
    } });
  const categoryPick = select([{ value: "all", label: "All categories" }, { value: "watches", label: "Watches" }, { value: "earrings", label: "Earrings" }],
    { value: category, "aria-label": "Category", class: "input select select--inline" });
  categoryPick.addEventListener("change", () => {
    category = categoryPick.value;
    setQuery({ category: category === "all" ? null : category });
    draw();
  });
  const sortPick = select(SORTS, { value: sort, "aria-label": "Sort products", class: "input select select--inline" });
  sortPick.addEventListener("change", () => {
    sort = sortPick.value;
    setQuery({ sort: sort === "position" ? null : sort });
    draw();
  });

  const tabsHolder = h("div", { class: "index-tabs" });
  const bulkHolder = h("div");
  const listHolder = h("div");

  root.replaceChildren(page({ width: "wide" },
    pageHeader({
      title: "Products",
      secondary: [button("Export", { iconStart: "download", onClick: exportCsv }), button("Inventory", { href: "/admin/inventory" })],
      primary: button("Add product", { variant: "primary", href: "/admin/products/new" }),
    }),
    card({ flush: true, className: "index-card" }, tabsHolder,
      h("div", { class: "index-toolbar" }, search.wrap, categoryPick, sortPick), bulkHolder, listHolder)));

  function filtered() {
    const t = TABS.find((x) => x.id === tab);
    const needle = q.toLowerCase();
    const rows = state.products.filter((p) => t.test(p)
      && (category === "all" || p.category === category)
      && (!needle || `${p.name} ${p.sku || ""} ${(p.tags || []).join(" ")}`.toLowerCase().includes(needle)));
    const s = SORTS.find((x) => x.value === sort);
    return sort === "position" ? rows : [...rows].sort(s.fn);
  }

  async function bulkStatus(status, verb) {
    const ids = [...selection];
    try {
      await ops.setProductsStatus(ids, status);
      toast(`${ids.length} ${ids.length === 1 ? "product" : "products"} ${verb}`);
      selection = new Set();
      draw();
    } catch (err) {
      toastError(err);
    }
  }

  async function bulkDelete() {
    const doomed = [...selection].map((id) => state.productsById.get(id)).filter(Boolean);
    const ok = await confirmDialog({
      title: `Delete ${doomed.length} ${doomed.length === 1 ? "product" : "products"}?`,
      message: "They are removed from the shop and the admin for good. Past orders keep their details. To hide a product but keep it, archive it instead.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const results = await Promise.allSettled(doomed.map((p) => ops.deleteProduct(p)));
    const failed = results.filter((r) => r.status === "rejected");
    selection = new Set();
    if (failed.length) toastError(failed[0].reason);
    else toast(`${doomed.length} ${doomed.length === 1 ? "product" : "products"} deleted`);
    draw();
  }

  function exportCsv() {
    const rows = filtered();
    if (!rows.length) return toast("Nothing to export in this view.");
    downloadCsv(`products-${stamp()}.csv`, [
      ["Handle", "Title", "Status", "Category", "Price", "Compare-at price", "Cost", "SKU", "Track inventory", "Quantity",
        "Continue selling when out of stock", "Badge", "Tags", "Display order", "Image"],
      ...rows.map((p) => [p.id, p.name, p.status, p.category, p.price, p.compareAtPrice ?? "", state.costs.get(p.id) ?? "",
        p.sku, p.trackInventory ? "yes" : "no", p.trackInventory ? p.quantity : "", p.continueSelling ? "yes" : "no",
        p.badge, (p.tags || []).join(", "), p.position, firstImage(p)]),
    ]);
  }

  function draw() {
    if (!isReady("products")) {
      listHolder.replaceChildren(h("div", { class: "pad" }, skeleton(8)));
      return;
    }
    const focusInTabs = tabsHolder.contains(document.activeElement);
    tabsHolder.replaceChildren(tabs({
      label: "Product views",
      active: tab,
      items: TABS.map((t) => ({ id: t.id, label: t.label })),
      onSelect: (id) => {
        tab = id;
        selection = new Set();
        setQuery({ tab: id === "all" ? null : id });
        draw();
      },
    }));
    if (focusInTabs) tabsHolder.querySelector('[aria-selected="true"]').focus();

    if (!state.products.length) {
      bulkHolder.replaceChildren();
      listHolder.replaceChildren(emptyState({ glyph: "tag", title: "Add your first product",
        body: "Add a title, photos, a price and stock. Set it to Active and it appears on the website straight away.",
        action: button("Add product", { variant: "primary", href: "/admin/products/new" }) }));
      return;
    }

    const rows = filtered();
    selection = new Set([...selection].filter((id) => rows.some((r) => r.id === id)));
    bulkHolder.replaceChildren(selection.size ? bulkBar(selection.size, [
      { label: "Set as active", onClick: () => bulkStatus("active", "set as active") },
      { label: "Set as draft", onClick: () => bulkStatus("draft", "set as draft") },
      { label: "Archive", onClick: () => bulkStatus("archived", "archived") },
      { label: "Delete", destructive: true, onClick: bulkDelete },
    ], () => {
      selection = new Set();
      draw();
    }) : "");

    if (!rows.length) {
      listHolder.replaceChildren(emptyState({ glyph: "search", title: "No products found", body: "Try another search, category or tab.", compact: true }));
      return;
    }

    listHolder.replaceChildren(dataTable({
      caption: "Products",
      rows,
      rowHref: (p) => `/admin/products/${encodeURIComponent(p.id)}`,
      selection,
      onSelect: (next) => {
        selection = next;
        draw();
      },
      columns: [
        { label: "Product", render: (p) => h("span", { class: "product-cell" }, thumb(firstImage(p), "", 40),
          rowLink(`/admin/products/${encodeURIComponent(p.id)}`, p.name)) },
        { label: "Status", render: productStatusBadge },
        { label: "Inventory", render: inventoryCell },
        { label: "Category", render: (p) => (p.category === "earrings" ? "Earrings" : "Watches"), className: "hide-sm" },
        { label: "Price", align: "end", render: priceCell },
      ],
    }));
  }

  draw();
  return subscribe((topics) => {
    if (topics.has("products") || topics.has("orders") || topics.has("adminSettings")) draw();
  });
}
