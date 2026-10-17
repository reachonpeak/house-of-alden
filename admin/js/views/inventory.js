/* ==========================================================================
   HOUSE OF ALDEN ADMIN — Inventory
   --------------------------------------------------------------------------
   Committed  = units in open orders that haven't been sent yet
   Available  = what the website can still sell (counts down per order)
   On hand    = available + committed: what should physically be in the drawer

   Changes are saved as "+3" / "−2" against the number you started from, so
   an order arriving while you type is never overwritten.
   ========================================================================== */

import { availability, derive, isReady, state, subscribe } from "../store.js";
import { number } from "../format.js";
import { setQuery } from "../router.js";
import * as ops from "../ops.js";
import { downloadCsv, stamp } from "../lib/csv.js";
import {
  badge, busy, button, card, dataTable, emptyState, field, h, input, openDialog, page, pageHeader, rowLink,
  searchField, setTitle, skeleton, tabs, thumb, toast, toastError,
} from "../ui.js";
import { firstImage } from "./products.js";

const TABS = [
  { id: "all", label: "All" },
  { id: "low", label: "Low stock" },
  { id: "out", label: "Out of stock" },
  { id: "untracked", label: "Not tracked" },
];

function trackDialog(p) {
  const qty = input({ type: "number", inputmode: "numeric", step: "1", min: "0", value: "1" });
  const go = button("Start tracking", { variant: "primary" });
  const d = openDialog({
    title: `Track stock for ${p.name}`,
    body: h("div", { class: "stack stack--md" },
      h("p", null, "Enter how many you have right now. Each order will count it down, and at 0 the piece shows as sold out."),
      field({ label: "Available", control: qty })),
    actions: [button("Cancel", { onClick: () => d.close() }), go],
    size: "small",
  });
  go.addEventListener("click", () => {
    const n = Math.floor(Number(qty.value));
    if (!Number.isFinite(n) || n < 0 || n > 1000000) {
      toast("Enter a whole number, like 5.", { tone: "critical" });
      qty.focus();
      return;
    }
    busy(go, async () => {
      try {
        await ops.setTracking(p.id, true, n);
        toast(`Tracking stock for ${p.name}`);
        d.close();
      } catch (err) {
        toastError(err);
      }
    });
  });
}

export function render(root, route) {
  setTitle("Inventory");
  const fromUrl = route.query.get("tab");
  let tab = TABS.some((t) => t.id === fromUrl) ? fromUrl : "all";
  let q = "";
  const editing = new Map(); // productId → { base, value } while a number is being changed

  const search = searchField({ placeholder: "Search by title or SKU", label: "Search inventory", onInput: (v) => {
    q = v.trim().toLowerCase();
    draw();
  } });
  const tabsHolder = h("div", { class: "index-tabs" });
  const listHolder = h("div");

  root.replaceChildren(page({ width: "wide" },
    pageHeader({ title: "Inventory", back: { href: "/admin/products", label: "Products" },
      secondary: [button("Export", { iconStart: "download", onClick: exportCsv })] }),
    card({ flush: true, className: "index-card" }, tabsHolder, h("div", { class: "index-toolbar" }, search.wrap), listHolder)));

  function rows() {
    const low = Number(state.adminSettings.lowStockThreshold) || 0;
    return state.products.filter((p) => p.status !== "archived").filter((p) => {
      const qty = Number(p.quantity) || 0;
      if (tab === "low") return p.trackInventory && qty > 0 && qty <= low;
      if (tab === "out") return p.trackInventory && qty <= 0;
      if (tab === "untracked") return !p.trackInventory;
      return true;
    }).filter((p) => !q || `${p.name} ${p.sku || ""}`.toLowerCase().includes(q));
  }

  function exportCsv() {
    const d = derive();
    downloadCsv(`inventory-${stamp()}.csv`, [
      ["Handle", "Title", "SKU", "Tracked", "Committed", "Available", "On hand"],
      ...rows().map((p) => {
        const c = d.committed.get(p.id) || 0;
        return [p.id, p.name, p.sku, p.trackInventory ? "yes" : "no", c, p.trackInventory ? p.quantity : "", p.trackInventory ? (Number(p.quantity) || 0) + c : ""];
      }),
    ]);
  }

  function availableCell(p) {
    if (!p.trackInventory) {
      return button("Track stock", { variant: "plain", size: "slim", onClick: () => trackDialog(p) });
    }
    const state0 = editing.get(p.id);
    const current = Number(p.quantity) || 0;
    const box = input({ type: "number", inputmode: "numeric", step: "1", class: "input input--qty",
      value: String(state0 ? state0.value : current), "aria-label": `Available for ${p.name}`, "data-keep": `qty-${p.id}` });
    const save = button("Save", { variant: "primary", size: "slim" });
    save.hidden = !state0;
    box.addEventListener("focus", () => {
      if (!editing.has(p.id)) editing.set(p.id, { base: current, value: String(current) });
    });
    box.addEventListener("blur", () => {
      const e = editing.get(p.id);
      if (e && String(e.value).trim() === String(e.base)) editing.delete(p.id); // untouched: follow live changes again
    });
    box.addEventListener("input", () => {
      const e = editing.get(p.id) || { base: current };
      e.value = box.value;
      editing.set(p.id, e);
      save.hidden = String(e.base) === box.value.trim();
    });
    const commit = () => {
      const e = editing.get(p.id);
      if (!e) return;
      const n = Math.floor(Number(e.value));
      if (!Number.isFinite(n) || String(e.value).trim() === "") {
        toast("Enter a whole number.", { tone: "critical" });
        return;
      }
      const delta = n - e.base;
      if (!delta) {
        editing.delete(p.id);
        draw();
        return;
      }
      busy(save, async () => {
        try {
          await ops.adjustQuantity(p.id, delta);
          editing.delete(p.id);
          toast(`${p.name}: ${delta > 0 ? "+" : ""}${number(delta)} available`);
        } catch (err) {
          toastError(err);
        }
      });
    };
    save.addEventListener("click", commit);
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") {
        editing.delete(p.id);
        draw();
      }
    });
    return h("div", { class: "qty-edit" }, box, save);
  }

  function draw() {
    if (!isReady("products", "orders")) {
      listHolder.replaceChildren(h("div", { class: "pad" }, skeleton(8)));
      return;
    }
    const keep = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.keep : null;
    const focusInTabs = tabsHolder.contains(document.activeElement);
    tabsHolder.replaceChildren(tabs({
      label: "Inventory views",
      active: tab,
      items: TABS,
      onSelect: (id) => {
        tab = id;
        setQuery({ tab: id === "all" ? null : id });
        draw();
      },
    }));
    if (focusInTabs) tabsHolder.querySelector('[aria-selected="true"]').focus();

    const list = rows();
    if (!list.length) {
      listHolder.replaceChildren(emptyState({ glyph: "packages", compact: true,
        title: tab === "all" ? "No products yet" : "Nothing here", body: tab === "low" ? "No tracked product is running low." : tab === "out" ? "Nothing tracked is out of stock." : "Try another tab or search." }));
      return;
    }
    const d = derive();
    listHolder.replaceChildren(dataTable({
      caption: "Inventory",
      rows: list,
      columns: [
        { label: "Product", render: (p) => h("span", { class: "product-cell" }, thumb(firstImage(p), "", 40),
          h("span", null, rowLink(`/admin/products/${encodeURIComponent(p.id)}`, p.name), p.sku && h("span", { class: "subdued block" }, `SKU ${p.sku}`))) },
        { label: "Stock", render: (p) => {
          const a = availability(p);
          if (!a.tracked) return badge("Not tracked", "neutral");
          if (a.quantity <= 0) return badge(p.continueSelling ? "Selling at 0" : "Out of stock", p.continueSelling ? "warning" : "critical");
          return a.tone === "warning" ? badge("Low", "warning") : badge("In stock", "success");
        } },
        { label: "Committed", align: "end", render: (p) => number(d.committed.get(p.id) || 0) },
        { label: "Available", align: "end", render: availableCell },
        { label: "On hand", align: "end", render: (p) => (p.trackInventory ? number((Number(p.quantity) || 0) + (d.committed.get(p.id) || 0)) : "") },
      ],
    }));
    if (keep) {
      const again = listHolder.querySelector(`[data-keep="${CSS.escape(keep)}"]`);
      if (again) again.focus();
    }
  }

  draw();
  return subscribe((topics) => {
    if (topics.has("products") || topics.has("orders") || topics.has("adminSettings")) draw();
  });
}
