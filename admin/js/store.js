/* ==========================================================================
   HOUSE OF ALDEN ADMIN — live data
   --------------------------------------------------------------------------
   One live listener per collection, opened at sign-in and kept open. Every
   screen reads from here, so an order placed on the website, or a change
   made by another member of staff, appears everywhere at once without a
   reload. Screens subscribe() and redraw when something they show changes.
   ========================================================================== */

import { collection, db, doc, limit, onSnapshot, orderBy, query } from "./fb.js";

/* Plenty for a boutique; past this the oldest orders drop off the live list
   (they stay in the database). */
export const ORDER_LIMIT = 2000;

export const state = {
  products: [],
  productsById: new Map(),
  orders: [],
  ordersById: new Map(),
  customers: [],
  customersById: new Map(),
  costs: new Map(),
  settings: null,
  adminSettings: { lowStockThreshold: 2 },
  staff: [],
  ready: new Set(),
  errors: {},
  /* Orders this browser just created — so creating one doesn't announce
     itself as a "new order" a second later. */
  localOrders: new Set(),
  version: 0,
};

const subscribers = new Set();
let unsubscribers = [];
let pending = new Set();
let scheduled = false;

function emit(topic) {
  pending.add(topic);
  state.version += 1;
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const topics = pending;
    pending = new Set();
    subscribers.forEach((fn) => {
      try {
        fn(topics);
      } catch (err) {
        console.error("[admin] a screen failed to redraw", err);
      }
    });
  });
}

/** fn(topics: Set<string>) runs after any change. Returns an unsubscribe function. */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export const isReady = (...topics) => topics.every((t) => state.ready.has(t));

const withId = (snap) => ({ id: snap.id, ...snap.data({ serverTimestamps: "estimate" }) });
const byPosition = (a, b) =>
  (Number(a.position) || 0) - (Number(b.position) || 0) || String(a.name || "").localeCompare(String(b.name || ""));
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));

/**
 * Opens every listener. `newOrder(order)` fires for orders that arrive while
 * the admin is open; `denied(err)` when the database refuses this account.
 */
export function start({ newOrder = () => {}, denied = () => {} } = {}) {
  stop();
  const failed = (topic) => (err) => {
    console.error(`[admin] live ${topic} stopped`, err);
    state.errors[topic] = err;
    state.ready.add(topic); // stop waiting; screens show the error instead
    emit(topic);
    if (err && err.code === "permission-denied") denied(err);
  };
  const listen = (target, topic, onData) => {
    unsubscribers.push(onSnapshot(target, (snap) => {
      delete state.errors[topic];
      onData(snap);
      state.ready.add(topic);
      emit(topic);
    }, failed(topic)));
  };

  listen(collection(db, "products"), "products", (snap) => {
    state.products = snap.docs.map(withId).sort(byPosition);
    state.productsById = new Map(state.products.map((p) => [p.id, p]));
  });

  let firstOrders = true;
  listen(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(ORDER_LIMIT)), "orders", (snap) => {
    if (!firstOrders) {
      snap.docChanges().forEach((change) => {
        if (change.type !== "added" || change.doc.metadata.hasPendingWrites) return;
        if (state.localOrders.has(change.doc.id) || state.ordersById.has(change.doc.id)) return;
        newOrder(withId(change.doc));
      });
    }
    firstOrders = false;
    state.orders = snap.docs.map(withId);
    state.ordersById = new Map(state.orders.map((o) => [o.id, o]));
  });

  listen(collection(db, "customers"), "customers", (snap) => {
    state.customers = snap.docs.map(withId).sort(byName);
    state.customersById = new Map(state.customers.map((c) => [c.id, c]));
  });

  listen(collection(db, "productCosts"), "costs", (snap) => {
    state.costs = new Map(snap.docs.map((d) => [d.id, d.data().cost ?? null]));
  });

  listen(doc(db, "settings", "store"), "settings", (snap) => {
    state.settings = snap.exists() ? snap.data() : {};
  });

  listen(doc(db, "settings", "admin"), "adminSettings", (snap) => {
    const data = snap.exists() ? snap.data() : {};
    state.adminSettings = { lowStockThreshold: 2, ...data };
  });

  listen(collection(db, "staff"), "staff", (snap) => {
    state.staff = snap.docs.map(withId).sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : byName(a, b)));
  });
}

export function stop() {
  unsubscribers.forEach((off) => off());
  unsubscribers = [];
  Object.assign(state, {
    products: [],
    productsById: new Map(),
    orders: [],
    ordersById: new Map(),
    customers: [],
    customersById: new Map(),
    costs: new Map(),
    settings: null,
    adminSettings: { lowStockThreshold: 2 },
    staff: [],
    ready: new Set(),
    errors: {},
  });
  state.localOrders.clear();
  state.version += 1;
}

/* --- Rules every screen shares -------------------------------------------- */

/** An order that counts towards sales: not cancelled, voided or refunded. */
export const countsAsSale = (o) =>
  o.status !== "cancelled" && o.financialStatus !== "voided" && o.financialStatus !== "refunded";

export const isOpenUnfulfilled = (o) => o.status === "open" && o.fulfillmentStatus === "unfulfilled";

/** Units the shop can still sell: tracked → quantity; untracked → unlimited. */
export function availability(p) {
  if (!p.trackInventory) return { tracked: false, quantity: null, label: "Not tracked", tone: "neutral" };
  const q = Number.isInteger(p.quantity) ? p.quantity : 0;
  const low = Number(state.adminSettings.lowStockThreshold) || 0;
  return {
    tracked: true,
    quantity: q,
    label: `${q} in stock`,
    tone: q <= 0 ? "critical" : q <= low ? "warning" : "default",
  };
}

/* Figures derived from the live lists, recomputed only when something changed. */
let derivedAt = -1;
let derived = null;

export function derive() {
  if (derivedAt === state.version && derived) return derived;
  const committed = new Map(); // productId → units in open, unfulfilled orders
  const customerStats = new Map(); // customerId → { orders, spent, last, first }
  let toFulfil = 0;
  let unpaid = 0;

  for (const o of state.orders) {
    if (isOpenUnfulfilled(o)) {
      toFulfil += 1;
      (o.lines || []).forEach((l) => {
        if (l.reserved) committed.set(l.productId, (committed.get(l.productId) || 0) + (Number(l.qty) || 0));
      });
    }
    if (o.status !== "cancelled" && o.financialStatus === "pending") unpaid += 1;
    if (o.customerId) {
      const s = customerStats.get(o.customerId) || { orders: 0, spent: 0, last: null, first: null };
      s.orders += 1;
      if (countsAsSale(o)) s.spent += Number(o.total) || 0;
      const at = o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : null;
      if (at && (!s.last || at > s.last)) s.last = at;
      if (at && (!s.first || at < s.first)) s.first = at;
      customerStats.set(o.customerId, s);
    }
  }

  const lowStock = state.products.filter((p) => {
    if (p.status === "archived" || !p.trackInventory || p.continueSelling) return false;
    return (Number(p.quantity) || 0) <= (Number(state.adminSettings.lowStockThreshold) || 0);
  });

  derived = { committed, customerStats, toFulfil, unpaid, lowStock };
  derivedAt = state.version;
  return derived;
}
