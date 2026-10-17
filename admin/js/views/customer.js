/* ==========================================================================
   HOUSE OF ALDEN ADMIN — one customer
   Contact details, notes, tags and every order they have placed.
   ========================================================================== */

import { derive, isReady, state, subscribe } from "../store.js";
import { date, money, number, prettyPhone, relative, whatsappLink } from "../format.js";
import { navigate } from "../router.js";
import * as ops from "../ops.js";
import {
  badge, button, card, confirmDialog, dataTable, emptyState, h, icon, layout, lines, loadingPage, menuButton, page,
  pageHeader, rowLink, setTitle, toast, toastError,
} from "../ui.js";
import { customerDialog } from "./customers.js";
import { fulfillmentBadge, paymentBadge } from "./shared.js";

export function render(root, route) {
  const id = route.params.id;
  const holder = h("div");
  root.replaceChildren(holder);

  function draw() {
    if (!isReady("customers", "orders")) {
      holder.replaceChildren(loadingPage("Customer"));
      return;
    }
    const c = state.customersById.get(id);
    if (!c) {
      setTitle("Customer not found");
      holder.replaceChildren(page({}, pageHeader({ title: "Customer not found", back: { href: "/admin/customers", label: "Customers" } }),
        card({}, emptyState({ glyph: "users", title: "This customer isn't here", body: "They may have been deleted, or the link is incomplete.",
          action: button("Back to customers", { href: "/admin/customers" }) }))));
      return;
    }
    const title = c.name || prettyPhone(c.phone) || c.email || "Unnamed customer";
    setTitle(title);
    const s = derive().customerStats.get(id) || { orders: 0, spent: 0, last: null, first: null };
    const orders = state.orders.filter((o) => o.customerId === id);
    const wa = whatsappLink(c.phone, `Hello${c.name ? ` ${c.name}` : ""}, this is House of Alden.`);

    const more = menuButton("More actions", [
      { label: "Edit customer", icon: "pencil", onClick: () => customerDialog(c) },
      { label: "Create order", icon: "receipt", onClick: () => navigate(`/admin/orders/new?customer=${encodeURIComponent(id)}`) },
      { label: "Delete customer", icon: "trash", destructive: true, onClick: async () => {
        const ok = await confirmDialog({ title: `Delete ${title}?`, message: "Their customer record is removed. Their orders stay, with the name and address they were placed with.", confirmLabel: "Delete customer", destructive: true });
        if (!ok) return;
        try {
          await ops.deleteCustomer(id);
          toast("Customer deleted");
          navigate("/admin/customers", { replace: true });
        } catch (err) {
          toastError(err);
        }
      } },
    ]);

    const stat = (label, value) => h("div", { class: "stat" }, h("p", { class: "stat-label" }, label), h("p", { class: "stat-value stat-value--sm" }, value));

    holder.replaceChildren(page({},
      pageHeader({
        title,
        back: { href: "/admin/customers", label: "Customers" },
        meta: s.first ? `Customer since ${date(s.first)}` : c.createdAt ? `Added ${date(c.createdAt)}` : null,
        secondary: [wa && button("WhatsApp", { iconStart: "brand-whatsapp", href: wa, target: "_blank" }), more],
      }),
      layout(
        h("div", { class: "stack stack--md" },
          h("div", { class: "stats card" },
            stat("Amount spent", money(s.spent)),
            stat("Orders", number(s.orders)),
            stat("Average order", money(s.orders ? Math.round(s.spent / s.orders) : 0)),
            stat("Last order", s.last ? relative(s.last) : "None yet")),
          card({ title: "Orders", flush: true, actions: button("Create order", { variant: "plain", href: `/admin/orders/new?customer=${encodeURIComponent(id)}` }) },
            orders.length
              ? dataTable({
                caption: `Orders from ${title}`,
                rows: orders,
                rowHref: (o) => `/admin/orders/${o.id}`,
                columns: [
                  { label: "Order", render: (o) => rowLink(`/admin/orders/${o.id}`, o.name) },
                  { label: "Date", render: (o) => relative(o.createdAt) },
                  { label: "Payment", render: paymentBadge },
                  { label: "Fulfillment", render: fulfillmentBadge },
                  { label: "Total", align: "end", render: (o) => money(o.total) },
                ],
              })
              : emptyState({ glyph: "receipt", title: "No orders yet", compact: true }))),
        h("div", { class: "stack stack--md" },
          card({ title: "Contact", actions: button("", { variant: "tertiary", iconStart: "pencil", ariaLabel: "Edit customer", onClick: () => customerDialog(c) }) },
            h("div", { class: "stack stack--sm" },
              c.phone ? h("p", { class: "inline" }, icon("phone", { size: 18 }), h("a", { href: `tel:${String(c.phone).replace(/[^\d+]/g, "")}` }, prettyPhone(c.phone))) : h("p", { class: "subdued" }, "No phone number"),
              c.email ? h("p", { class: "inline" }, icon("mail", { size: 18 }), h("a", { href: `mailto:${c.email}` }, c.email)) : h("p", { class: "subdued" }, "No email"),
              h("h3", { class: "card-subtitle" }, "Address"),
              c.address ? h("p", { class: "address" }, lines(c.address)) : h("p", { class: "subdued" }, "No address"))),
          card({ title: "Notes" }, c.note ? h("p", { class: "prewrap" }, c.note) : h("p", { class: "subdued" }, "No notes")),
          card({ title: "Tags" }, (c.tags || []).length ? h("div", { class: "tag-list" }, c.tags.map((t) => badge(t, "neutral"))) : h("p", { class: "subdued" }, "No tags"))))));
  }

  draw();
  return subscribe((topics) => {
    if (topics.has("customers") || topics.has("orders")) draw();
  });
}
