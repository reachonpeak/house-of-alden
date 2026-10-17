/* ==========================================================================
   HOUSE OF ALDEN ADMIN — Customers
   Created automatically from website orders (one per phone number) and by
   hand here. Order counts and amount spent come from the live orders.
   ========================================================================== */

import { derive, isReady, state, subscribe } from "../store.js";
import { date, money, number, phoneDigits, prettyPhone, relative } from "../format.js";
import { navigate } from "../router.js";
import * as ops from "../ops.js";
import { downloadCsv, stamp } from "../lib/csv.js";
import {
  avatar, busy, button, card, dataTable, emptyState, field, h, input, openDialog, page, pageHeader, rowLink,
  searchField, setFieldError, setTitle, skeleton, textarea, toast, toastError,
} from "../ui.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Add or edit a customer. Resolves with the id, or null if cancelled. */
export function customerDialog(existing = null) {
  const c = existing || {};
  const name = input({ value: c.name || "", maxlength: 140, autocomplete: "off" });
  const phone = input({ value: c.phone || "", type: "tel", maxlength: 32, autocomplete: "off" });
  const email = input({ value: c.email || "", type: "email", maxlength: 254, autocomplete: "off" });
  const address = textarea({ value: c.address || "", rows: 3, maxlength: 600 });
  const note = textarea({ value: c.note || "", rows: 3, maxlength: 4000 });
  const tags = input({ value: (c.tags || []).join(", "), maxlength: 600 });
  const save = button(existing ? "Save" : "Add customer", { variant: "primary" });
  const d = openDialog({
    title: existing ? "Edit customer" : "Add customer",
    body: h("div", { class: "stack stack--md" },
      field({ label: "Name", control: name }),
      h("div", { class: "grid-2 grid-2--tight" },
        field({ label: "Phone", control: phone, help: existing ? null : "Website orders from this number join this customer." }),
        field({ label: "Email", control: email, optional: true })),
      field({ label: "Address", control: address, optional: true }),
      field({ label: "Notes", control: note, optional: true, help: "Only staff see these." }),
      field({ label: "Tags", control: tags, optional: true, help: "Separate with commas, like VIP, wholesale." })),
    actions: [button("Cancel", { onClick: () => d.close(null) }), save],
  });

  save.addEventListener("click", () => {
    [name, phone, email].forEach((el) => setFieldError(el, ""));
    const data = {
      name: name.value.trim(),
      phone: phone.value.trim(),
      email: email.value.trim(),
      address: address.value.trim(),
      note: note.value.trim(),
      tags: [...new Set(tags.value.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 30).map((t) => t.slice(0, 40)),
    };
    if (!data.name && !data.phone && !data.email) return setFieldError(name, "Add at least a name, a phone number or an email.");
    if (data.email && !EMAIL.test(data.email)) return setFieldError(email, "That email address doesn't look right.");
    const key = phoneDigits(data.phone);
    if (data.phone && !key) return setFieldError(phone, "Enter a full phone number, like 70875 11282.");

    let id = existing ? existing.id : key || null;
    if (!existing && id && state.customersById.has(id)) return setFieldError(phone, "A customer with this phone number already exists.");
    busy(save, async () => {
      try {
        id = await ops.saveCustomer(id, data, !existing);
        toast(existing ? "Customer saved" : "Customer added");
        d.close(id);
      } catch (err) {
        toastError(err);
      }
    });
  });
  return d.done;
}

export function render(root) {
  setTitle("Customers");
  let q = "";
  const search = searchField({ placeholder: "Search by name, phone or email", label: "Search customers", onInput: (v) => {
    q = v.trim();
    draw();
  } });
  const listHolder = h("div");
  const count = h("p", { class: "subdued" });

  root.replaceChildren(page({ width: "wide" },
    pageHeader({
      title: "Customers",
      meta: count,
      secondary: [button("Export", { iconStart: "download", onClick: exportCsv })],
      primary: button("Add customer", { variant: "primary", onClick: async () => {
        const id = await customerDialog();
        if (id) navigate(`/admin/customers/${encodeURIComponent(id)}`);
      } }),
    }),
    card({ flush: true, className: "index-card" }, h("div", { class: "index-toolbar" }, search.wrap), listHolder)));

  function filtered() {
    const needle = q.toLowerCase();
    const digits = q.replace(/\D/g, "");
    return state.customers.filter((c) => !q
      || `${c.name || ""} ${c.email || ""} ${(c.tags || []).join(" ")}`.toLowerCase().includes(needle)
      || (digits.length >= 3 && String(c.phone || "").replace(/\D/g, "").includes(digits)));
  }

  function exportCsv() {
    const stats = derive().customerStats;
    downloadCsv(`customers-${stamp()}.csv`, [
      ["Name", "Phone", "Email", "Address", "Orders", "Amount spent", "Last order", "Tags", "Notes"],
      ...filtered().map((c) => {
        const s = stats.get(c.id) || { orders: 0, spent: 0, last: null };
        return [c.name, c.phone, c.email, c.address, s.orders, s.spent, s.last ? date(s.last) : "", (c.tags || []).join(", "), c.note];
      }),
    ]);
  }

  function draw() {
    if (!isReady("customers", "orders")) {
      listHolder.replaceChildren(h("div", { class: "pad" }, skeleton(8)));
      return;
    }
    count.textContent = `${number(state.customers.length)} ${state.customers.length === 1 ? "customer" : "customers"}`;
    if (!state.customers.length) {
      listHolder.replaceChildren(emptyState({ glyph: "users", title: "Your customers will show here",
        body: "Everyone who orders on the website with a phone number gets a customer record, with their orders and spend. You can add people by hand too." }));
      return;
    }
    const rows = filtered();
    if (!rows.length) {
      listHolder.replaceChildren(emptyState({ glyph: "search", title: "No customers found", body: "Try a different name or number.", compact: true }));
      return;
    }
    const stats = derive().customerStats;
    listHolder.replaceChildren(dataTable({
      caption: "Customers",
      rows,
      rowHref: (c) => `/admin/customers/${encodeURIComponent(c.id)}`,
      columns: [
        { label: "Customer", render: (c) => h("span", { class: "product-cell" }, avatar(c.name || c.phone, 32),
          h("span", null, rowLink(`/admin/customers/${encodeURIComponent(c.id)}`, c.name || prettyPhone(c.phone) || c.email || "Unnamed"),
            c.name && c.phone && h("span", { class: "subdued block" }, prettyPhone(c.phone)))) },
        { label: "Email", render: (c) => c.email || h("span", { class: "subdued" }, "None"), className: "hide-sm" },
        { label: "Orders", align: "end", render: (c) => number((stats.get(c.id) || {}).orders || 0) },
        { label: "Amount spent", align: "end", render: (c) => money((stats.get(c.id) || {}).spent || 0) },
        { label: "Last order", render: (c) => {
          const last = (stats.get(c.id) || {}).last;
          return last ? relative(last) : h("span", { class: "subdued" }, "None yet");
        }, className: "hide-sm" },
      ],
    }));
  }

  draw();
  return subscribe((topics) => {
    if (topics.has("customers") || topics.has("orders")) draw();
  });
}
