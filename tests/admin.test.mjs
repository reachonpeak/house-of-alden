/* The admin, end to end against the emulators: its real screens (in jsdom)
   and its real database calls, signed in as the owner, under the real
   security rules. A write the rules would refuse fails here first.  npm test */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { clearAuth, clearFirestore } from "./_harness.mjs";

const { auth: adminAuth, db: adminDb } = await import("../api/_firebase.js");
const { FieldValue } = await import("firebase-admin/firestore");

/* --- A browser-ish world for the admin's modules ----------------------------- */

const dom = new JSDOM("<!doctype html><html><body><main id='main'></main></body></html>", { url: "https://shop.test/admin", pretendToBeVisual: true });
const w = dom.window;
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement",
  "HTMLButtonElement", "HTMLAnchorElement", "HTMLDialogElement", "SVGElement", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent",
  "InputEvent", "FocusEvent", "DocumentFragment", "Text", "location", "history", "localStorage", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame", "DOMParser", "MutationObserver"]) {
  Object.defineProperty(globalThis, key, { value: key === "window" ? w : w[key], configurable: true, writable: true });
}
w.matchMedia = globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.ResizeObserver = w.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.CSS = w.CSS = { escape: (s) => String(s) };
if (!w.HTMLDialogElement.prototype.showModal) {
  w.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  w.HTMLDialogElement.prototype.close = function close() { this.open = false; };
}

/* --- The admin, with fb.js pointed at the emulators ---------------------------- */

const outdir = fileURLToPath(new URL("../node_modules/.cache/hoa-admin-test/", import.meta.url));
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL("./fixtures/admin-entry.mjs", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  outfile: `${outdir}bundle.mjs`,
  logLevel: "error",
  plugins: [{
    name: "swap",
    setup(b) {
      b.onResolve({ filter: /(^|\/)fb\.js$/ }, () => ({ path: fileURLToPath(new URL("./fixtures/fb-emulator.mjs", import.meta.url)) }));
      b.onResolve({ filter: /motion-mini\.js$/ }, () => ({ path: fileURLToPath(new URL("./fixtures/motion-stub.mjs", import.meta.url)) }));
    },
  }],
});
const A = await import(`${outdir}bundle.mjs?${Date.now()}`);
const { fb, store, ops } = A;

/* --- Helpers --------------------------------------------------------------------- */

const OWNER = { email: "owner@example.com", password: "owner-pass-1" };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await tick(40);
  }
}
const read = async (path) => (await adminDb().doc(path).get()).data();
const route = (params = {}, q = "") => ({ params, query: new URLSearchParams(q) });
/* Screens draw into #main, as in the app; body-level pieces (save bar,
   toasts, dialogs) live beside it and survive between screens. */
const mount = () => {
  const el = document.createElement("div");
  document.getElementById("main").replaceChildren(el);
  return el;
};
function type(el, value) {
  el.value = value;
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
  el.dispatchEvent(new w.Event("change", { bubbles: true }));
}
const byLabel = (root, text) => {
  const label = [...root.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(text));
  assert.ok(label, `no field labelled "${text}"`);
  return root.querySelector(`#${label.getAttribute("for")}`);
};
const buttonNamed = (root, text) => [...root.querySelectorAll("button, a.btn")].find((b) => b.textContent.trim() === text);
const newOrders = [];

before(async () => {
  await clearFirestore();
  await clearAuth();
  const owner = await adminAuth().createUser({ ...OWNER, displayName: "Kawalpreet" });
  await adminAuth().setCustomUserClaims(owner.uid, { admin: true, role: "owner" });
  const db = adminDb();
  await Promise.all([
    db.doc(`staff/${owner.uid}`).set({ email: OWNER.email, role: "owner", name: "Kawalpreet" }),
    db.doc("products/alden-heritage").set({
      name: "The Alden Heritage", status: "active", category: "watches", price: 8900, compareAtPrice: null,
      images: [], specs: [], tags: [], sku: "AH-1", trackInventory: true, quantity: 5, continueSelling: false,
      badge: "", blurb: "", description: "", position: 10, seoTitle: "", seoDescription: "",
    }),
    db.doc("products/pearl-drop").set({
      name: "The Alden Pearl Drop", status: "active", category: "earrings", price: 3400, compareAtPrice: null,
      images: [], specs: [], tags: [], sku: "", trackInventory: false, quantity: 0, continueSelling: false,
      badge: "", blurb: "", description: "", position: 20, seoTitle: "", seoDescription: "",
    }),
    db.doc("settings/store").set({ whatsapp: "917087511282", email: "shop@example.com", instagram: "", pinterest: "", shipping: { flatRate: 0, freeAbove: 0 } }),
    db.doc("settings/admin").set({ lowStockThreshold: 2 }),
    db.doc("counters/orders").set({ next: 1001 }),
  ]);
  await fb.signInWithEmailAndPassword(fb.auth, OWNER.email, OWNER.password);
  store.start({ newOrder: (o) => newOrders.push(o) });
  await until(() => store.isReady("products", "orders", "customers", "settings", "adminSettings", "costs", "staff"), "live data");
});

after(async () => {
  store.stop();
  await fb.signOut(fb.auth).catch(() => {});
  dom.window.close();
  /* Firebase keeps sockets open; leave once the results are reported. */
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
});

/* --- Tests ------------------------------------------------------------------------- */

test("the owner sees the live catalogue and the staff list", () => {
  assert.equal(store.state.products.length, 2);
  assert.deepEqual(store.state.products.map((p) => p.id), ["alden-heritage", "pearl-drop"]);
  assert.equal(store.state.staff[0].role, "owner");
  assert.equal(Object.keys(store.state.errors).length, 0, JSON.stringify(store.state.errors));
});

test("products screen lists and filters", async () => {
  const root = mount();
  const off = A.products.render(root, route());
  assert.equal(root.querySelectorAll("tbody tr").length, 2);
  type(root.querySelector('input[type="search"]'), "pearl");
  await tick(200);
  assert.equal(root.querySelectorAll("tbody tr").length, 1);
  assert.match(root.querySelector("tbody").textContent, /Pearl Drop/);
  off();
});

test("adding a product through the editor publishes a valid document", async () => {
  const root = mount();
  const off = A.product.render(root, route());
  type(byLabel(root, "Title"), "The Moon Hoop");
  type(byLabel(root, "Price"), "4,200");
  type(byLabel(root, "Compare-at price"), "5000");
  type(byLabel(root, "Cost per item"), "1500");
  type(byLabel(root, "Available"), "3");
  type(byLabel(root, "Description"), "A crescent of gold.");
  const category = byLabel(root, "Category");
  category.value = "earrings";
  category.dispatchEvent(new w.Event("change"));
  assert.ok(A.ui.saveBar.visible, "unsaved-changes bar shows");
  assert.match(root.textContent, /Profit/);
  buttonNamed(document.body.querySelector(".savebar"), "Save").click();
  const saved = await until(() => read("products/the-moon-hoop"), "new product");
  assert.equal(saved.name, "The Moon Hoop");
  assert.equal(saved.price, 4200);
  assert.equal(saved.compareAtPrice, 5000);
  assert.equal(saved.category, "earrings");
  assert.equal(saved.trackInventory, true);
  assert.equal(saved.quantity, 3);
  assert.equal(saved.status, "active");
  assert.equal(saved.position, 30, "goes to the end of the display order");
  assert.equal((await read("productCosts/the-moon-hoop")).cost, 1500);
  off();
});

test("the editor refuses a price that isn't a number, and a duplicate handle", async () => {
  const root = mount();
  const off = A.product.render(root, route());
  type(byLabel(root, "Title"), "Alden Heritage"); // → handle "alden-heritage", already in use
  type(byLabel(root, "Price"), "abc");
  buttonNamed(document.body.querySelector(".savebar"), "Save").click();
  await tick(50);
  assert.equal(byLabel(root, "Price").getAttribute("aria-invalid"), "true");
  assert.equal(byLabel(root, "URL handle").getAttribute("aria-invalid"), "true", "alden-heritage is taken");
  off();
  A.ui.saveBar.hide();
});

test("editing stock in the editor sends an increment, not an overwrite", async () => {
  await until(() => store.state.productsById.get("the-moon-hoop"), "moon hoop in store");
  const root = mount();
  const off = A.product.render(root, route({ id: "the-moon-hoop" }));
  type(byLabel(root, "Description"), "A crescent of gold, on a fine hook."); // unsaved work: the form stays put
  /* An order lands while the editor is open: 3 → 2. */
  await adminDb().doc("products/the-moon-hoop").update({ quantity: FieldValue.increment(-1) });
  await tick(300);
  type(byLabel(root, "Available"), "5"); // the owner adds 2 to the 3 they saw
  buttonNamed(document.body.querySelector(".savebar"), "Save").click();
  await until(async () => (await read("products/the-moon-hoop")).quantity === 4, "quantity 4 (2 + the 2 added)");
  off();
});

test("inventory screen adjusts available stock", async () => {
  const root = mount();
  const off = A.inventory.render(root, route());
  const box = root.querySelector('input[aria-label="Available for The Alden Heritage"]');
  box.dispatchEvent(new w.Event("focus"));
  type(box, "8");
  box.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter" }));
  await until(async () => (await read("products/alden-heritage")).quantity === 8, "quantity 8");
  off();
});

test("creating an order by hand takes stock, numbers it and records the customer", async () => {
  const id = await ops.createOrder({
    lines: [{ productId: "alden-heritage", qty: 2 }, { productId: "pearl-drop", qty: 1 }],
    customer: { name: "Asha Gill", phone: "98765 43210", email: "", address: "Maur Mandi" },
    shipping: 120,
    paid: false,
    note: "Phone order",
  });
  const o = await read(`orders/${id}`);
  assert.equal(o.number, 1001);
  assert.equal(o.total, 2 * 8900 + 3400 + 120);
  assert.equal(o.source, "admin");
  assert.equal(o.customerId, "919876543210");
  assert.equal((await read("products/alden-heritage")).quantity, 6);
  assert.equal((await read("customers/919876543210")).name, "Asha Gill");
  assert.equal((await read("counters/orders")).next, 1002);
  await tick(300);
  assert.ok(!newOrders.some((x) => x.id === id), "your own order isn't announced as new");
});

test("an order from the website is announced while the admin is open", async () => {
  await adminDb().doc("orders/web-test-1").set({
    number: 1002, name: "#1002", source: "web", status: "open", financialStatus: "pending", fulfillmentStatus: "unfulfilled",
    customer: { name: "Simran", phone: "", email: "", address: "" }, lines: [{ productId: "pearl-drop", name: "The Alden Pearl Drop", price: 3400, qty: 1, total: 3400, reserved: false }],
    subtotal: 3400, shipping: 0, total: 3400, timeline: [], note: "", inventoryReserved: false, createdAt: FieldValue.serverTimestamp(),
  });
  await until(() => newOrders.some((o) => o.id === "web-test-1"), "new-order alert");
});

test("every order action passes the rules and lands on the timeline", async () => {
  const o = () => store.state.ordersById.get("web-test-1");
  await until(o, "order in store");
  await ops.setPaid(o(), true);
  await ops.setFulfilled(o(), true, { carrier: "India Post", number: "EE123456789IN", url: "" });
  await ops.addComment(o(), "Packed in the gift box.");
  await ops.saveOrderNote(o(), "VIP");
  await ops.saveOrderCustomer(o(), { name: "Simran Kaur", phone: "9876500000", email: "s@example.com", address: "Bathinda" });
  await ops.setArchived(o(), true);
  await ops.setArchived(o(), false);
  const saved = await read("orders/web-test-1");
  assert.equal(saved.financialStatus, "paid");
  assert.equal(saved.fulfillmentStatus, "fulfilled");
  assert.equal(saved.tracking.number, "EE123456789IN");
  assert.equal(saved.note, "VIP");
  assert.equal(saved.customer.name, "Simran Kaur");
  assert.equal(saved.status, "open");
  assert.deepEqual(saved.timeline.map((e) => e.type), ["paid", "fulfilled", "comment", "edited", "archived", "unarchived"]);
  assert.equal(saved.timeline[2].by, OWNER.email);
});

test("cancelling with restock puts stock back and voids an unpaid order", async () => {
  const id = await ops.createOrder({ lines: [{ productId: "alden-heritage", qty: 1 }], customer: { name: "", phone: "", email: "", address: "" }, shipping: 0, paid: false, note: "" });
  assert.equal((await read("products/alden-heritage")).quantity, 5);
  await until(() => store.state.ordersById.get(id), "order in store");
  await ops.cancelOrder(store.state.ordersById.get(id), { restock: true, reason: "Items unavailable" });
  const o = await read(`orders/${id}`);
  assert.equal(o.status, "cancelled");
  assert.equal(o.financialStatus, "voided");
  assert.equal(o.inventoryReserved, false);
  assert.equal((await read("products/alden-heritage")).quantity, 6);
  await assert.rejects(() => ops.cancelOrder({ id }, { restock: true }), /already cancelled/);
});

test("a refund can restock the pieces", async () => {
  const id = await ops.createOrder({ lines: [{ productId: "alden-heritage", qty: 2 }], customer: { name: "R", phone: "", email: "", address: "" }, shipping: 0, paid: true, note: "" });
  assert.equal((await read("products/alden-heritage")).quantity, 4);
  await ops.refundOrder({ id }, { restock: true });
  const o = await read(`orders/${id}`);
  assert.equal(o.financialStatus, "refunded");
  assert.equal((await read("products/alden-heritage")).quantity, 6);
});

test("the order screen's Mark as paid button works", async () => {
  const id = await ops.createOrder({ lines: [{ productId: "pearl-drop", qty: 1 }], customer: { name: "Button", phone: "", email: "", address: "" }, shipping: 0, paid: false, note: "" });
  await until(() => store.state.ordersById.get(id), "order in store");
  const root = mount();
  const off = A.order.render(root, route({ id }));
  buttonNamed(root, "Mark as paid").click();
  await until(async () => (await read(`orders/${id}`)).financialStatus === "paid", "paid");
  off();
});

test("store settings save, and a dangerous link is refused by the rules", async () => {
  await ops.saveStoreSettings({ instagram: "https://instagram.com/houseofalden", shipping: { flatRate: 120, freeAbove: 5000 } });
  const s = await read("settings/store");
  assert.equal(s.instagram, "https://instagram.com/houseofalden");
  assert.equal(s.shipping.flatRate, 120);
  await assert.rejects(() => ops.saveStoreSettings({ instagram: "javascript:alert(1)" }), (err) => err.code === "permission-denied");
});

test("customers can be added and deleted", async () => {
  const id = await ops.saveCustomer(null, { name: "Walk-in", phone: "", email: "", address: "", note: "", tags: ["vip"] }, true);
  assert.equal((await read(`customers/${id}`)).name, "Walk-in");
  await ops.deleteCustomer(id);
  assert.equal(await read(`customers/${id}`), undefined);
});

test("the dashboard adds up the period's sales", async () => {
  await tick(300);
  const root = mount();
  const off = A.home.render(root, route());
  const sales = store.state.orders.filter(store.countsAsSale).reduce((n, o) => n + o.total, 0);
  const tile = [...root.querySelectorAll(".stat")].find((s) => s.textContent.startsWith("Total sales"));
  assert.ok(tile, "total sales tile");
  assert.match(tile.textContent.replace(/\s/g, ""), new RegExp(`₹${sales.toLocaleString("en-IN").replace(/,/g, ",")}`));
  assert.ok(root.querySelector(".chart"), "chart drawn");
  assert.match(root.textContent, /orders? to fulfill/);
  off();
});

test("photos upload to the product folder under the rules", async () => {
  const { promise } = ops.uploadImage("the-moon-hoop", { blob: new Blob([new Uint8Array([82, 73, 70, 70, 1, 2, 3])], { type: "image/webp" }), type: "image/webp", ext: "webp" });
  const result = await promise;
  assert.match(result.path, /^products\/the-moon-hoop\/[a-z0-9]+-[a-z0-9]+\.webp$/);
  assert.match(result.url, /^http/);
  await ops.deleteImages([{ url: result.url, path: result.path }]);
});

test("deleting a product removes it and its cost", async () => {
  await ops.deleteProduct(store.state.productsById.get("the-moon-hoop"));
  assert.equal(await read("products/the-moon-hoop"), undefined);
  assert.equal(await read("productCosts/the-moon-hoop"), undefined);
});

test("an account with the claim but no staff record is refused", async () => {
  const ghost = await adminAuth().createUser({ email: "ghost@example.com", password: "ghost-pass-1" });
  await adminAuth().setCustomUserClaims(ghost.uid, { admin: true, role: "owner" });
  store.stop();
  await fb.signOut(fb.auth);
  await fb.signInWithEmailAndPassword(fb.auth, "ghost@example.com", "ghost-pass-1");
  await assert.rejects(() => fb.getDoc(fb.doc(fb.db, "staff", ghost.uid)), (err) => err.code === "permission-denied");
  await assert.rejects(() => ops.setPaid({ id: "web-test-1", total: 0 }, true), (err) => err.code === "permission-denied");
});
