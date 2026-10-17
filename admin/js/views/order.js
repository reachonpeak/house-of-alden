/* ==========================================================================
   HOUSE OF ALDEN ADMIN — one order
   Items and fulfillment, payment, the timeline (with staff comments), the
   customer and notes. Every action records itself on the timeline.
   ========================================================================== */

import { isReady, state, subscribe } from "../store.js";
import { dateTime, money, phoneDigits, prettyPhone, relative, time, toDate, whatsappLink } from "../format.js";
import { navigate } from "../router.js";
import * as ops from "../ops.js";
import {
  busy, button, card, checkbox, emptyState, field, h, icon, input, layout, lines, loadingPage, menuButton,
  openDialog, page, pageHeader, select, setTitle, textarea, thumb, toast, toastError, confirmDialog, assetUrl,
} from "../ui.js";
import { CANCEL_REASONS, channelLabel, fulfillmentBadge, itemsLabel, orderStateBadge, paymentBadge } from "./shared.js";

const CARRIERS = ["India Post", "Delhivery", "Blue Dart", "DTDC", "Shiprocket", "Ekart", "Xpressbees", "Hand delivered", "Other"];

/* --- Dialogs ----------------------------------------------------------------- */

function fulfillDialog(o) {
  const carrier = select([{ value: "", label: "Choose a carrier" }, ...CARRIERS.map((c) => ({ value: c, label: c }))]);
  const number = input({ autocomplete: "off" });
  const url = input({ type: "url", inputmode: "url", placeholder: "https://", autocomplete: "off" });
  const phone = o.customer && o.customer.phone;
  const notify = checkbox("Send the customer a WhatsApp message", { checked: !!phone, disabled: !phone,
    help: phone ? `Opens WhatsApp to ${prettyPhone(phone)} with the tracking details` : "No phone number on this order" });
  const save = button("Mark as fulfilled", { variant: "primary" });
  const d = openDialog({
    title: `Fulfill ${o.name}`,
    body: h("div", { class: "stack stack--md" },
      h("p", null, `${itemsLabel(o)} will be marked as sent. Tracking details are optional.`),
      h("div", { class: "grid-2 grid-2--tight" },
        field({ label: "Carrier", control: carrier, optional: true }),
        field({ label: "Tracking number", control: number, optional: true })),
      field({ label: "Tracking link", control: url, optional: true }),
      notify.el),
    actions: [button("Cancel", { onClick: () => d.close() }), save],
  });
  save.addEventListener("click", () => {
    const link = url.value.trim();
    if (link && !/^https:\/\/\S+$/.test(link)) {
      toast("The tracking link must start with https://", { tone: "critical" });
      url.focus();
      return;
    }
    const tracking = { carrier: carrier.value, number: number.value.trim(), url: link };
    /* The WhatsApp tab must open inside the click, before anything is awaited,
       or the browser treats it as an unwanted pop-up. */
    const tab = notify.input.checked ? window.open("", "_blank") : null;
    busy(save, async () => {
      try {
        await ops.setFulfilled(o, true, tracking);
        if (tab) {
          const parts = [`Hello${o.customer.name ? ` ${o.customer.name}` : ""}, your House of Alden order ${o.name} is on its way.`];
          if (tracking.number) parts.push(`${tracking.carrier ? `${tracking.carrier} ` : ""}tracking number: ${tracking.number}`);
          if (tracking.url) parts.push(tracking.url);
          parts.push("Thank you for shopping with us.");
          tab.opener = null;
          tab.location.replace(whatsappLink(phone, parts.join("\n")));
        }
        toast(`${o.name} marked as fulfilled`);
        d.close();
      } catch (err) {
        if (tab) tab.close();
        toastError(err);
      }
    });
  });
}

function cancelDialog(o) {
  const reason = select(CANCEL_REASONS.map((r) => ({ value: r, label: r })));
  const reserved = o.inventoryReserved === true;
  const restock = checkbox("Restock the items", { checked: reserved, disabled: !reserved,
    help: reserved ? "Puts the pieces back into available stock" : "Stock wasn't taken for this order" });
  const paid = o.financialStatus === "paid";
  const refund = paid ? checkbox(`Mark ${money(o.total)} as refunded`, { checked: true, help: "Return the money yourself (UPI or bank). This only records it." }) : null;
  const go = button("Cancel order", { variant: "critical" });
  const d = openDialog({
    title: `Cancel ${o.name}?`,
    body: h("div", { class: "stack stack--md" },
      field({ label: "Reason for cancelling", control: reason }),
      restock.el,
      refund && refund.el,
      h("p", { class: "subdued" }, "A cancelled order stays in your records and can't be reopened.")),
    actions: [button("Keep order", { onClick: () => d.close() }), go],
  });
  go.addEventListener("click", () => busy(go, async () => {
    try {
      await ops.cancelOrder(o, { reason: reason.value, restock: restock.input.checked, refund: refund ? refund.input.checked : false });
      toast(`${o.name} cancelled`);
      d.close();
    } catch (err) {
      toastError(err);
    }
  }));
}

function refundDialog(o) {
  const reserved = o.inventoryReserved === true;
  const restock = checkbox("Restock the items", { checked: false, disabled: !reserved,
    help: reserved ? "Only if the pieces have come back to you" : "Stock wasn't taken for this order" });
  const go = button(`Refund ${money(o.total)}`, { variant: "primary" });
  const d = openDialog({
    title: `Refund ${o.name}`,
    body: h("div", { class: "stack stack--md" },
      h("p", null, "Send the money back to the customer yourself (UPI or bank transfer), then record it here."),
      restock.el),
    actions: [button("Cancel", { onClick: () => d.close() }), go],
  });
  go.addEventListener("click", () => busy(go, async () => {
    try {
      await ops.refundOrder(o, { restock: restock.input.checked });
      toast(`${o.name} marked as refunded`);
      d.close();
    } catch (err) {
      toastError(err);
    }
  }));
}

function noteDialog(o) {
  const note = textarea({ value: o.note || "", rows: 5, maxlength: 4000 });
  const save = button("Save", { variant: "primary" });
  const d = openDialog({
    title: "Edit notes",
    body: field({ label: "Notes", control: note, help: "Only staff see these." }),
    actions: [button("Cancel", { onClick: () => d.close() }), save],
  });
  save.addEventListener("click", () => busy(save, async () => {
    try {
      await ops.saveOrderNote(o, note.value.trim());
      toast("Notes saved");
      d.close();
    } catch (err) {
      toastError(err);
    }
  }));
}

function customerDialog(o) {
  const c = o.customer || {};
  const name = input({ value: c.name || "", autocomplete: "off", maxlength: 100 });
  const phone = input({ value: c.phone || "", type: "tel", autocomplete: "off", maxlength: 32 });
  const email = input({ value: c.email || "", type: "email", autocomplete: "off", maxlength: 254 });
  const address = textarea({ value: c.address || "", rows: 4, maxlength: 600 });
  const save = button("Save", { variant: "primary" });
  const d = openDialog({
    title: "Edit contact and address",
    body: h("div", { class: "stack stack--md" },
      field({ label: "Name", control: name }),
      h("div", { class: "grid-2 grid-2--tight" }, field({ label: "Phone", control: phone }), field({ label: "Email", control: email })),
      field({ label: "Shipping address", control: address })),
    actions: [button("Cancel", { onClick: () => d.close() }), save],
  });
  save.addEventListener("click", () => {
    const value = email.value.trim();
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      toast("That email address doesn't look right.", { tone: "critical" });
      email.focus();
      return;
    }
    busy(save, async () => {
      try {
        await ops.saveOrderCustomer(o, { name: name.value.trim(), phone: phone.value.trim(), email: value, address: address.value.trim() });
        toast("Customer details saved");
        d.close();
      } catch (err) {
        toastError(err);
      }
    });
  });
}

/* --- Pieces ------------------------------------------------------------------- */

function itemsCard(o) {
  const done = o.fulfillmentStatus === "fulfilled";
  const live = o.status !== "cancelled";
  const t = o.tracking;
  return card({ title: h("span", { class: "inline" }, fulfillmentBadge(o), done ? "Fulfilled" : "Unfulfilled", h("span", { class: "subdued" }, `(${itemsLabel(o)})`)) },
    h("ul", { class: "line-items" }, (o.lines || []).map((l) => {
      const exists = state.productsById.has(l.productId);
      return h("li", { class: "line-item" },
        thumb(l.image, "", 48),
        h("div", { class: "line-item-main" },
          exists ? h("a", { href: `/admin/products/${encodeURIComponent(l.productId)}` }, l.name) : h("span", null, l.name),
          l.sku && h("p", { class: "subdued" }, `SKU ${l.sku}`)),
        h("span", { class: "line-item-qty" }, `${money(l.price)} × ${l.qty}`),
        h("span", { class: "line-item-total" }, money(l.total)));
    })),
    done && t && (t.number || t.carrier) && h("div", { class: "tracking" }, icon("truck", { size: 18 }),
      h("span", null, [t.carrier, t.number].filter(Boolean).join(" ")),
      t.url && /^https:\/\//.test(t.url) && h("a", { href: t.url, target: "_blank", rel: "noopener noreferrer", class: "link" }, "Track")),
    live && h("div", { class: "card-foot" },
      done
        ? button("Mark as unfulfilled", { onClick: (e) => busy(e.currentTarget, () => ops.setFulfilled(o, false).then(() => toast("Marked as unfulfilled")).catch(toastError)) })
        : button("Mark as fulfilled", { variant: "primary", onClick: () => fulfillDialog(o) })));
}

function paymentCard(o) {
  const paid = o.financialStatus === "paid";
  const live = o.status !== "cancelled";
  const row = (label, value, cls = "") => h("div", { class: `summary-row ${cls}` }, h("span", null, label), h("span", { class: "num" }, value));
  return card({ title: h("span", { class: "inline" }, paymentBadge(o), paid ? "Paid" : o.financialStatus === "pending" ? "Payment pending" : o.financialStatus === "refunded" ? "Refunded" : "Voided") },
    h("div", { class: "summary" },
      row("Subtotal", money(o.subtotal)),
      h("p", { class: "summary-sub" }, itemsLabel(o)),
      row("Shipping", o.shipping ? money(o.shipping) : "Free"),
      row("Total", money(o.total), "summary-total"),
      h("hr"),
      row("Paid by customer", paid ? money(o.total) : money(0)),
      o.financialStatus === "refunded" && row("Refunded", `−${money(o.total)}`)),
    live && h("div", { class: "card-foot" },
      o.financialStatus === "pending" && button("Mark as paid", { variant: "primary",
        onClick: (e) => busy(e.currentTarget, () => ops.setPaid(o, true).then(() => toast(`${o.name} marked as paid`)).catch(toastError)) }),
      paid && button("Refund", { onClick: () => refundDialog(o) }),
      paid && button("Mark as unpaid", { variant: "plain",
        onClick: (e) => busy(e.currentTarget, () => ops.setPaid(o, false).then(() => toast("Marked as payment pending")).catch(toastError)) })));
}

function timelineCard(o, draft) {
  const box = textarea({ rows: 2, placeholder: "Leave a comment for your team", "aria-label": "Comment", maxlength: 1000, value: draft.text, "data-keep": "comment" });
  box.addEventListener("input", () => (draft.text = box.value));
  const post = button("Post", { size: "slim" });
  post.addEventListener("click", () => {
    const text = box.value.trim();
    if (!text) return box.focus();
    busy(post, async () => {
      try {
        await ops.addComment(o, text);
        draft.text = "";
        box.value = "";
      } catch (err) {
        toastError(err);
      }
    });
  });

  const events = [...(o.timeline || [])]
    .map((e) => ({ ...e, date: toDate(e.at) }))
    .filter((e) => e.date)
    .sort((a, b) => b.date - a.date);
  const groups = [];
  events.forEach((e) => {
    const label = relative(e.date).replace(/ at .*/, "");
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  });

  return card({ title: "Timeline" },
    h("div", { class: "comment-box" }, box, h("div", { class: "comment-actions" }, post)),
    h("ol", { class: "timeline" }, groups.map((g) => h("li", { class: "timeline-day" },
      h("p", { class: "timeline-date" }, g.label),
      h("ul", null, g.items.map((e) => h("li", { class: `timeline-event${e.type === "comment" ? " is-comment" : ""}` },
        h("span", { class: "timeline-dot", "aria-hidden": "true" }),
        h("div", null, h("p", null, e.text), h("p", { class: "subdued" }, `${e.by || "Staff"}, ${time(e.date)}`)))))))));
}

function customerCard(o) {
  const c = o.customer || {};
  const record = o.customerId && state.customersById.get(o.customerId);
  const count = o.customerId ? state.orders.filter((x) => x.customerId === o.customerId).length : 0;
  const wa = whatsappLink(c.phone);
  return card({ title: "Customer", actions: button("", { variant: "tertiary", iconStart: "pencil", ariaLabel: "Edit contact and address", onClick: () => customerDialog(o) }) },
    c.name || c.phone || c.email
      ? h("div", { class: "stack stack--sm" },
        record ? h("a", { href: `/admin/customers/${encodeURIComponent(record.id)}`, class: "strong" }, c.name || prettyPhone(c.phone)) : h("p", { class: "strong" }, c.name || "Unnamed customer"),
        count > 1 && h("p", { class: "subdued" }, `${count} orders`),
        h("h3", { class: "card-subtitle" }, "Contact information"),
        c.phone ? h("p", { class: "inline" }, h("a", { href: phoneDigits(c.phone) ? `tel:+${phoneDigits(c.phone)}` : `tel:${String(c.phone).replace(/[^\d+]/g, "")}` }, prettyPhone(c.phone)),
          wa && h("a", { href: wa, target: "_blank", rel: "noopener noreferrer", class: "icon-link", "aria-label": "Message on WhatsApp" }, icon("brand-whatsapp", { size: 18 })))
          : h("p", { class: "subdued" }, "No phone number"),
        c.email ? h("a", { href: `mailto:${c.email}` }, c.email) : h("p", { class: "subdued" }, "No email"),
        h("h3", { class: "card-subtitle" }, "Shipping address"),
        c.address ? h("p", { class: "address" }, lines(c.address)) : h("p", { class: "subdued" }, "No address"))
      : h("p", { class: "subdued" }, "No customer details. The order came through WhatsApp; add them with the pencil."));
}

function notesCard(o) {
  return card({ title: "Notes", actions: button("", { variant: "tertiary", iconStart: "pencil", ariaLabel: "Edit notes", onClick: () => noteDialog(o) }) },
    o.note ? h("p", { class: "prewrap" }, o.note) : h("p", { class: "subdued" }, "No notes from staff"),
    o.customerNote && h("div", { class: "customer-note" }, h("h3", { class: "card-subtitle" }, "Note from customer"), h("p", { class: "prewrap" }, o.customerNote)));
}

/* --- Screen ------------------------------------------------------------------ */

export function render(root, route) {
  const id = route.params.id;
  const draft = { text: "" };
  const holder = h("div");
  root.replaceChildren(holder);

  function draw() {
    if (!isReady("orders")) {
      holder.replaceChildren(loadingPage("Order"));
      return;
    }
    const o = state.ordersById.get(id);
    if (!o) {
      setTitle("Order not found");
      holder.replaceChildren(page({}, pageHeader({ title: "Order not found", back: { href: "/admin/orders", label: "Orders" } }),
        card({}, emptyState({ glyph: "receipt", title: "This order isn't here", body: "It may have been deleted, or the link is incomplete.",
          action: button("Back to orders", { href: "/admin/orders" }) }))));
      return;
    }
    setTitle(`Order ${o.name}`);

    /* Keep a half-written comment (and its focus) through live redraws. */
    const active = document.activeElement;
    const keep = active && active.dataset ? active.dataset.keep : null;
    const caret = keep && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;

    const index = state.orders.findIndex((x) => x.id === o.id);
    const newer = index > 0 ? state.orders[index - 1] : null;
    const older = index > -1 && index < state.orders.length - 1 ? state.orders[index + 1] : null;
    const cancelled = o.status === "cancelled";
    const wa = whatsappLink(o.customer && o.customer.phone, `Hello${o.customer && o.customer.name ? ` ${o.customer.name}` : ""}, this is House of Alden about your order ${o.name}.`);

    const more = menuButton("More actions", [
      o.financialStatus === "pending" && !cancelled && { label: "Mark as paid", icon: "cash", onClick: () => ops.setPaid(o, true).then(() => toast(`${o.name} marked as paid`)).catch(toastError) },
      o.financialStatus === "paid" && { label: "Refund", icon: "arrow-back-up", onClick: () => refundDialog(o) },
      { label: "Print", icon: "printer", onClick: () => window.print() },
      o.status === "open" && { label: "Archive", icon: "archive", onClick: () => ops.setArchived(o, true).then(() => toast(`${o.name} archived`)).catch(toastError) },
      o.status === "archived" && { label: "Unarchive", icon: "arrow-back-up", onClick: () => ops.setArchived(o, false).then(() => toast(`${o.name} unarchived`)).catch(toastError) },
      !cancelled && { label: "Cancel order", icon: "ban", destructive: true, onClick: () => cancelDialog(o) },
      (cancelled || o.status === "archived") && {
        label: "Delete order", icon: "trash", destructive: true,
        onClick: async () => {
          const ok = await confirmDialog({ title: `Delete ${o.name}?`, message: "The order is removed for good. It no longer counts in your sales or the customer's history.", confirmLabel: "Delete order", destructive: true });
          if (!ok) return;
          try {
            await ops.deleteOrder(o);
            toast(`${o.name} deleted`);
            navigate("/admin/orders", { replace: true });
          } catch (err) {
            toastError(err);
          }
        },
      },
    ]);

    holder.replaceChildren(page({},
      pageHeader({
        title: o.name,
        back: { href: "/admin/orders", label: "Orders" },
        badges: [paymentBadge(o), fulfillmentBadge(o), orderStateBadge(o)],
        meta: `${dateTime(o.createdAt)} from ${channelLabel(o)}`,
        secondary: [
          wa && button("WhatsApp", { iconStart: "brand-whatsapp", href: wa, target: "_blank" }),
          more,
          h("div", { class: "pager" },
            button("", { iconStart: "chevron-up", ariaLabel: "Newer order", href: newer ? `/admin/orders/${newer.id}` : null, disabled: !newer, size: "slim" }),
            button("", { iconStart: "chevron-down", ariaLabel: "Older order", href: older ? `/admin/orders/${older.id}` : null, disabled: !older, size: "slim" })),
        ],
      }),
      cancelled && h("div", { class: "banner banner--critical" }, icon("ban", { size: 20 }),
        h("p", null, `Cancelled ${relative(o.cancelledAt)}${o.cancelReason ? `: ${o.cancelReason}` : ""}.`)),
      layout(
        h("div", { class: "stack stack--md" }, itemsCard(o), paymentCard(o), timelineCard(o, draft)),
        h("div", { class: "stack stack--md" }, notesCard(o), customerCard(o))),
      printSheet(o)));

    if (keep) {
      const again = holder.querySelector(`[data-keep="${keep}"]`);
      if (again) {
        again.focus();
        if (caret) again.setSelectionRange(caret[0], caret[1]);
      }
    }
  }

  draw();
  return subscribe((topics) => {
    if (topics.has("orders") || topics.has("customers") || topics.has("products")) draw();
  });
}

/* A plain packing slip for window.print(); hidden on screen (admin.css). */
function printSheet(o) {
  const c = o.customer || {};
  const s = state.settings || {};
  return h("section", { class: "print-sheet", "aria-hidden": "true" },
    h("header", null,
      h("img", { src: assetUrl("images/logo-mark.webp"), alt: "", width: 40, height: 52 }),
      h("div", null, h("h2", null, "House of Alden"), h("p", null, [s.email, s.whatsapp && prettyPhone(s.whatsapp)].filter(Boolean).join("  |  ")))),
    h("div", { class: "print-meta" },
      h("div", null, h("h3", null, `Order ${o.name}`), h("p", null, dateTime(o.createdAt))),
      h("div", null, h("h3", null, "Ship to"), h("p", null, c.name || ""), h("p", { class: "address" }, lines(c.address || "")), c.phone && h("p", null, prettyPhone(c.phone)))),
    h("table", null,
      h("thead", null, h("tr", null, h("th", null, "Item"), h("th", null, "Qty"), h("th", null, "Price"), h("th", null, "Total"))),
      h("tbody", null, (o.lines || []).map((l) => h("tr", null, h("td", null, l.name), h("td", null, String(l.qty)), h("td", null, money(l.price)), h("td", null, money(l.total)))))),
    h("p", { class: "print-total" }, `Subtotal ${money(o.subtotal)}  |  Shipping ${o.shipping ? money(o.shipping) : "Free"}  |  Total ${money(o.total)}`),
    h("p", { class: "print-status" }, `Payment: ${o.financialStatus}`),
    h("p", { class: "print-thanks" }, "Thank you for shopping with House of Alden."));
}
