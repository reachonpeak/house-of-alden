/* ==========================================================================
   HOUSE OF ALDEN ADMIN — labels shared by several screens
   Shopify's convention: things still to do are yellow, things done are grey,
   and each badge carries a small state glyph so colour is never the only cue.
   ========================================================================== */

import { badge } from "../ui.js";

export function paymentBadge(o) {
  switch (o.financialStatus) {
    case "paid": return badge("Paid", "neutral", { progress: "complete" });
    case "refunded": return badge("Refunded", "neutral", { progress: "complete" });
    case "voided": return badge("Voided", "neutral", { progress: "complete" });
    default: return badge("Payment pending", "warning", { progress: "incomplete" });
  }
}

export function fulfillmentBadge(o) {
  return o.fulfillmentStatus === "fulfilled"
    ? badge("Fulfilled", "neutral", { progress: "complete" })
    : badge("Unfulfilled", "attention", { progress: "incomplete" });
}

export function orderStateBadge(o) {
  if (o.status === "cancelled") return badge("Cancelled", "critical");
  if (o.status === "archived") return badge("Archived", "neutral");
  return null;
}

export function productStatusBadge(p) {
  if (p.status === "active") return badge("Active", "success");
  if (p.status === "draft") return badge("Draft", "info");
  return badge("Archived", "neutral");
}

export const channelLabel = (o) => (o.source === "web" ? "Online store" : "Created in admin");

export const customerLabel = (o) =>
  (o.customer && (o.customer.name || o.customer.phone || o.customer.email)) || "No customer";

export const itemsLabel = (o) => {
  const n = Number(o.itemCount) || (o.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
  return `${n} ${n === 1 ? "item" : "items"}`;
};

export const CANCEL_REASONS = [
  "Customer changed or cancelled order",
  "Items unavailable",
  "Payment not received",
  "Fraudulent order",
  "Other",
];
