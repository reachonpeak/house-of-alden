/* ==========================================================================
   HOUSE OF ALDEN ADMIN — Create order
   For orders that never touched the website: a WhatsApp chat, a phone call,
   someone at the door. Same numbering, same stock rules, same records.
   ========================================================================== */

import { availability, isReady, state, subscribe } from "../store.js";
import { money, phoneDigits, prettyPhone } from "../format.js";
import { navigate, setLeaveGuard } from "../router.js";
import * as ops from "../ops.js";
import {
  busy, button, card, confirmDialog, emptyState, field, h, icon, input, layout, loadingPage, moneyInput, page,
  pageHeader, setTitle, textarea, thumb, toast, toastError,
} from "../ui.js";

/* Same rule as the website (js/cart.js, api/orders.js). */
function autoShipping(subtotal, count) {
  const s = (state.settings && state.settings.shipping) || {};
  const flat = Number(s.flatRate) || 0;
  const free = Number(s.freeAbove) || 0;
  return count === 0 || flat === 0 || (free > 0 && subtotal >= free) ? 0 : flat;
}

/* A text box that suggests matches as you type (products, customers). */
function picker({ label, placeholder, search, renderItem, onPick }) {
  const box = input({ type: "search", placeholder, autocomplete: "off", role: "combobox", "aria-expanded": "false", "aria-autocomplete": "list" });
  const list = h("ul", { class: "suggest", role: "listbox", hidden: true });
  const listId = `${box.id || (box.id = `pick-${Math.random().toString(36).slice(2, 7)}`)}-list`;
  list.id = listId;
  box.setAttribute("aria-controls", listId);
  let items = [];
  let index = -1;

  const close = () => {
    list.hidden = true;
    box.setAttribute("aria-expanded", "false");
    box.removeAttribute("aria-activedescendant");
    index = -1;
  };
  const highlight = (i) => {
    index = i;
    [...list.children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    const li = list.children[i];
    if (li) {
      box.setAttribute("aria-activedescendant", li.id);
      li.scrollIntoView({ block: "nearest" });
    }
  };
  const pick = (item) => {
    onPick(item);
    box.value = "";
    close();
    box.focus();
  };
  const update = () => {
    items = search(box.value.trim()).slice(0, 8);
    list.replaceChildren(...items.map((item, i) => {
      const li = h("li", { role: "option", id: `${listId}-${i}`, "aria-selected": "false", class: "suggest-item" }, renderItem(item));
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus in the box
        pick(item);
      });
      return li;
    }));
    if (!items.length) list.append(h("li", { class: "suggest-empty" }, "No matches"));
    list.hidden = false;
    box.setAttribute("aria-expanded", "true");
    index = -1;
  };

  box.addEventListener("input", update);
  box.addEventListener("focus", update);
  box.addEventListener("blur", () => setTimeout(close, 100));
  box.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlight(Math.min(items.length - 1, index + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight(Math.max(0, index - 1));
    } else if (e.key === "Enter" && index > -1) {
      e.preventDefault();
      pick(items[index]);
    } else if (e.key === "Escape") {
      close();
    }
  });
  return h("div", { class: "picker" }, field({ label, control: box, labelHidden: true }), list);
}

export function render(root, route) {
  setTitle("Create order");
  const draft = {
    lines: [], // { productId, qty }
    customerId: null,
    customer: { name: "", phone: "", email: "", address: "" },
    shipping: null, // null = worked out from the shop's shipping rule
    paid: false,
    note: "",
  };
  const holder = h("div");
  root.replaceChildren(holder);

  const preset = route.query.get("customer");
  let presetApplied = false;

  setLeaveGuard(async () => (draft.lines.length ? confirmDialog({
    title: "Discard this order?",
    message: "The order hasn't been created. Leaving this page will lose it.",
    confirmLabel: "Discard",
    destructive: true,
  }) : true));

  function useCustomer(c) {
    draft.customerId = c.id;
    draft.customer = { name: c.name || "", phone: c.phone || "", email: c.email || "", address: c.address || "" };
  }

  function totals() {
    const rows = draft.lines.map((l) => ({ ...l, product: state.productsById.get(l.productId) })).filter((l) => l.product);
    const subtotal = rows.reduce((n, l) => n + (Number(l.product.price) || 0) * l.qty, 0);
    const shipping = draft.shipping == null ? autoShipping(subtotal, rows.length) : draft.shipping;
    return { rows, subtotal, shipping, total: subtotal + shipping };
  }

  function productsCard() {
    const t = totals();
    const search = picker({
      label: "Search products",
      placeholder: "Search products to add",
      search: (q) => state.products
        .filter((p) => p.status !== "archived")
        .filter((p) => !q || `${p.name} ${p.sku || ""}`.toLowerCase().includes(q.toLowerCase())),
      renderItem: (p) => [thumb((p.images && p.images[0] && p.images[0].url) || "", "", 32),
        h("span", { class: "suggest-main" }, p.name, p.status === "draft" && h("span", { class: "subdued" }, " (draft)")),
        h("span", { class: "suggest-meta" }, money(p.price))],
      onPick: (p) => {
        const hit = draft.lines.find((l) => l.productId === p.id);
        if (hit) hit.qty += 1;
        else draft.lines.push({ productId: p.id, qty: 1 });
        draw(true);
      },
    });

    return card({ title: "Products" }, search,
      t.rows.length
        ? h("ul", { class: "line-items line-items--edit" }, t.rows.map((l) => {
          const a = availability(l.product);
          const over = a.tracked && !l.product.continueSelling && l.qty > a.quantity;
          const qty = input({ type: "number", min: "1", max: "999", step: "1", value: String(l.qty), class: "input input--qty", "aria-label": `Quantity of ${l.product.name}` });
          qty.addEventListener("change", () => {
            const n = Math.max(1, Math.min(999, Math.floor(Number(qty.value)) || 1));
            draft.lines.find((x) => x.productId === l.productId).qty = n;
            draw();
          });
          return h("li", { class: "line-item" },
            thumb((l.product.images && l.product.images[0] && l.product.images[0].url) || "", "", 48),
            h("div", { class: "line-item-main" },
              h("p", { class: "strong" }, l.product.name),
              h("p", { class: over ? "critical-text" : "subdued" }, over ? `Only ${Math.max(0, a.quantity)} in stock` : a.label)),
            h("span", { class: "line-item-qty" }, `${money(l.product.price)} ×`, qty),
            h("span", { class: "line-item-total" }, money((Number(l.product.price) || 0) * l.qty)),
            button("", { variant: "tertiary", iconStart: "x", ariaLabel: `Remove ${l.product.name}`, onClick: () => {
              draft.lines = draft.lines.filter((x) => x.productId !== l.productId);
              draw();
            } }));
        }))
        : emptyState({ glyph: "tag", title: "No products yet", body: "Search above to add the pieces in this order.", compact: true }));
  }

  function customerCard() {
    const c = draft.customer;
    const chosen = draft.customerId && state.customersById.get(draft.customerId);
    const search = picker({
      label: "Find a customer",
      placeholder: "Search customers by name or phone",
      search: (q) => {
        const needle = q.toLowerCase();
        const digits = q.replace(/\D/g, "");
        return state.customers.filter((x) => !q || `${x.name || ""} ${x.email || ""}`.toLowerCase().includes(needle)
          || (digits.length >= 3 && String(x.phone || "").replace(/\D/g, "").includes(digits)));
      },
      renderItem: (x) => [h("span", { class: "suggest-main" }, x.name || "Unnamed"), h("span", { class: "suggest-meta" }, prettyPhone(x.phone))],
      onPick: (x) => {
        useCustomer(x);
        draw();
      },
    });
    const bind = (key, control) => {
      control.addEventListener("input", () => {
        c[key] = control.value;
        if (key === "phone" && draft.customerId && phoneDigits(control.value) !== draft.customerId) draft.customerId = null;
      });
      return control;
    };
    return card({ title: "Customer", actions: chosen && button("Clear", { variant: "plain", onClick: () => {
      draft.customerId = null;
      draft.customer = { name: "", phone: "", email: "", address: "" };
      draw();
    } }) },
    h("div", { class: "stack stack--md" },
      search,
      chosen && h("p", { class: "chosen" }, icon("user", { size: 18 }), `Existing customer: ${chosen.name || prettyPhone(chosen.phone)}`),
      field({ label: "Name", control: bind("name", input({ value: c.name, maxlength: 100, autocomplete: "off" })) }),
      h("div", { class: "grid-2 grid-2--tight" },
        field({ label: "Phone", control: bind("phone", input({ value: c.phone, type: "tel", maxlength: 32, autocomplete: "off" })), help: "Used to find this customer's past orders." }),
        field({ label: "Email", control: bind("email", input({ value: c.email, type: "email", maxlength: 254, autocomplete: "off" })), optional: true })),
      field({ label: "Shipping address", control: bind("address", textarea({ value: c.address, rows: 3, maxlength: 600 })) })));
  }

  function paymentCard() {
    const t = totals();
    const ship = moneyInput({ value: String(t.shipping), "aria-label": "Shipping charge" });
    ship.input.addEventListener("change", () => {
      const n = Math.round(Number(ship.input.value.replace(/[^\d.]/g, "")));
      draft.shipping = Number.isFinite(n) && n >= 0 ? n : null;
      draw();
    });
    const radio = (value, label) => {
      const id = `pay-${value}`;
      return h("div", { class: "choice" },
        h("input", { type: "radio", name: "paid", id, class: "radio", checked: draft.paid === value, onchange: () => {
          draft.paid = value;
        } }),
        h("label", { for: id }, label));
    };
    return card({ title: "Payment" },
      h("div", { class: "summary" },
        h("div", { class: "summary-row" }, h("span", null, "Subtotal"), h("span", { class: "num" }, money(t.subtotal))),
        h("div", { class: "summary-row summary-row--input" }, h("span", null, "Shipping"), ship.wrap),
        draft.shipping != null && h("button", { type: "button", class: "link small", onclick: () => {
          draft.shipping = null;
          draw();
        } }, "Use the shop's shipping rule"),
        h("div", { class: "summary-row summary-total" }, h("span", null, "Total"), h("span", { class: "num" }, money(t.total)))),
      h("fieldset", { class: "choices" }, h("legend", { class: "card-subtitle" }, "Payment status"),
        radio(false, "Payment pending"), radio(true, "Paid")));
  }

  function notesCard() {
    const note = textarea({ rows: 3, value: draft.note, maxlength: 4000 });
    note.addEventListener("input", () => (draft.note = note.value));
    return card({ title: "Notes" }, field({ label: "Notes", control: note, labelHidden: true, help: "Only staff see these." }));
  }

  function draw(refocusSearch = false) {
    if (!isReady("products", "customers", "settings")) {
      holder.replaceChildren(loadingPage("Create order"));
      return;
    }
    if (preset && !presetApplied && state.customersById.get(preset)) {
      useCustomer(state.customersById.get(preset));
      presetApplied = true;
    }
    const create = button("Create order", { variant: "primary" });
    create.addEventListener("click", submit);
    holder.replaceChildren(page({},
      pageHeader({ title: "Create order", back: { href: "/admin/orders", label: "Orders" } }),
      layout(h("div", { class: "stack stack--md" }, productsCard(), paymentCard()), h("div", { class: "stack stack--md" }, customerCard(), notesCard())),
      h("div", { class: "page-foot" }, button("Cancel", { href: "/admin/orders" }), create)));
    if (refocusSearch) {
      const box = holder.querySelector(".picker input");
      if (box) box.focus();
    }

    async function submit() {
      const t = totals();
      if (!t.rows.length) {
        toast("Add at least one product.", { tone: "critical" });
        return;
      }
      const email = draft.customer.email.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        toast("That email address doesn't look right.", { tone: "critical" });
        return;
      }
      await busy(create, async () => {
        try {
          const id = await ops.createOrder({
            lines: t.rows.map((l) => ({ productId: l.productId, qty: l.qty })),
            customer: Object.fromEntries(Object.entries(draft.customer).map(([k, v]) => [k, String(v || "").trim()])),
            customerId: draft.customerId,
            shipping: t.shipping,
            paid: draft.paid,
            note: draft.note.trim(),
          });
          draft.lines = [];
          setLeaveGuard(null);
          toast("Order created");
          navigate(`/admin/orders/${id}`, { replace: true });
        } catch (err) {
          toastError(err);
        }
      });
    }
  }

  draw();
  const off = subscribe((topics) => {
    /* Redraw for new data, but never while someone is typing in this form. */
    if (holder.contains(document.activeElement) && document.activeElement.matches("input, textarea")) return;
    if (topics.has("products") || topics.has("customers") || topics.has("settings")) draw();
  });
  return () => {
    off();
    setLeaveGuard(null);
  };
}
