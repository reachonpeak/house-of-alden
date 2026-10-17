/* POST /api/orders against the Firestore emulator.  npm test */

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { call, clearFirestore } from "./_harness.mjs";

const { default: handler, customerKey, shippingFor } = await import("../api/orders.js");
const { db } = await import("../api/_firebase.js");

const product = (over) => ({
  name: "Piece",
  status: "active",
  category: "watches",
  price: 1000,
  images: [{ url: "images/x.webp", path: "", alt: "" }],
  trackInventory: false,
  quantity: 0,
  continueSelling: false,
  ...over,
});

beforeEach(async () => {
  await clearFirestore();
  const fs = db();
  await Promise.all([
    fs.doc("products/watch-a").set(product({ name: "Watch A", price: 8900, trackInventory: true, quantity: 3, sku: "WA" })),
    fs.doc("products/earring-b").set(product({ name: "Earring B", category: "earrings", price: 2200 })),
    fs.doc("products/draft-c").set(product({ name: "Draft C", status: "draft" })),
    fs.doc("products/oversell-d").set(product({ name: "Oversell D", trackInventory: true, quantity: 0, continueSelling: true })),
    fs.doc("settings/store").set({ whatsapp: "917087511282", shipping: { flatRate: 120, freeAbove: 20000 } }),
    fs.doc("counters/orders").set({ next: 1001 }),
  ]);
});

const order = (over = {}) => ({
  lines: [
    { id: "watch-a", qty: 2, price: 1 }, // a price from the browser must be ignored
    { id: "earring-b", qty: 1 },
  ],
  customer: { name: "Asha", phone: "70875 11282", address: "Maur Mandi", notes: "Gift wrap" },
  token: "tok_aaaaaaaaaaaaaaaa01",
  ...over,
});

test("records an order with prices, shipping and stock taken from the database", async () => {
  const res = await call(handler, { body: order() });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const o = res.body.order;
  assert.equal(o.number, 1001);
  assert.equal(o.name, "#1001");
  assert.equal(o.subtotal, 2 * 8900 + 2200);
  assert.equal(o.shipping, 0, "free at or above the threshold");
  assert.equal(o.total, 20000);
  assert.equal(res.headers["cache-control"], "no-store");

  const fs = db();
  assert.equal((await fs.doc("products/watch-a").get()).data().quantity, 1);
  assert.equal((await fs.doc("products/earring-b").get()).data().quantity, 0, "untracked stock is left alone");
  assert.equal((await fs.doc("counters/orders").get()).data().next, 1002);

  const saved = (await fs.doc(`orders/${o.id}`).get()).data();
  assert.equal(o.id, "web-tok_aaaaaaaaaaaaaaaa01");
  assert.equal(saved.status, "open");
  assert.equal(saved.financialStatus, "pending");
  assert.equal(saved.fulfillmentStatus, "unfulfilled");
  assert.equal(saved.inventoryReserved, true);
  assert.deepEqual(saved.lines.map((l) => [l.productId, l.price, l.qty, l.reserved]), [
    ["watch-a", 8900, 2, true],
    ["earring-b", 2200, 1, false],
  ]);
  assert.equal(saved.customerNote, "Gift wrap");
  assert.equal(saved.customerId, "917087511282");

  const customer = (await fs.doc("customers/917087511282").get()).data();
  assert.equal(customer.name, "Asha");
  assert.equal(customer.source, "web");
});

test("a web order can't overwrite a customer's saved details", async () => {
  await db().doc("customers/917087511282").set({ name: "Asha", phone: "+91 70875 11282", email: "", address: "Maur Mandi", note: "VIP" });
  const res = await call(handler, { body: order({ customer: { name: "Mallory", phone: "7087511282", email: "m@example.com", address: "Elsewhere" } }) });
  assert.equal(res.status, 201);
  const c = (await db().doc("customers/917087511282").get()).data();
  assert.equal(c.name, "Asha");
  assert.equal(c.address, "Maur Mandi");
  assert.equal(c.email, "m@example.com", "a missing field may be filled in");
  assert.equal(c.note, "VIP");
  assert.ok(c.lastOrderAt);
  const saved = (await db().doc(`orders/${res.body.order.id}`).get()).data();
  assert.equal(saved.customer.name, "Mallory", "the order keeps what was typed");
});

test("charges flat shipping below the free threshold", async () => {
  const res = await call(handler, { body: order({ lines: [{ id: "earring-b", qty: 1 }], token: undefined }) });
  assert.equal(res.status, 201);
  assert.equal(res.body.order.shipping, 120);
  assert.equal(res.body.order.total, 2320);
});

test("the same checkout token never creates a second order", async () => {
  const first = await call(handler, { body: order() });
  const again = await call(handler, { body: order() });
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.body.order.id, first.body.order.id);
  assert.equal(again.body.order.number, 1001);
  assert.equal((await db().doc("products/watch-a").get()).data().quantity, 1, "stock taken once");
  assert.equal((await db().doc("counters/orders").get()).data().next, 1002);
});

test("refuses more than is in stock, and changes nothing", async () => {
  const res = await call(handler, { body: order({ lines: [{ id: "watch-a", qty: 5 }] }) });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "stock");
  assert.deepEqual(res.body.items, [{ id: "watch-a", name: "Watch A", available: 3 }]);
  assert.equal((await db().doc("products/watch-a").get()).data().quantity, 3);
  assert.equal((await db().doc("counters/orders").get()).data().next, 1001);
  assert.equal((await db().collection("orders").get()).size, 0);
});

test("refuses draft and missing products", async () => {
  for (const id of ["draft-c", "no-such-piece"]) {
    const res = await call(handler, { body: order({ lines: [{ id, qty: 1 }], token: undefined }) });
    assert.equal(res.status, 409, id);
  }
});

test("'continue selling' lets stock go below zero", async () => {
  const res = await call(handler, { body: order({ lines: [{ id: "oversell-d", qty: 2 }], token: undefined }) });
  assert.equal(res.status, 201);
  assert.equal((await db().doc("products/oversell-d").get()).data().quantity, -2);
});

test("refuses other sites, other methods and malformed bodies", async () => {
  assert.equal((await call(handler, { body: order(), headers: { origin: "https://evil.test" } })).status, 403);
  assert.equal((await call(handler, { body: order(), headers: { origin: "" } })).status, 403);
  assert.equal((await call(handler, { method: "GET" })).status, 405);
  assert.equal((await call(handler, { body: order(), headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await call(handler, { body: "{not json" })).status, 400);
  assert.equal((await call(handler, { body: order({ lines: [] }) })).status, 400);
  assert.equal((await call(handler, { body: order({ lines: [{ id: "../etc", qty: 1 }] }) })).status, 400);
  assert.equal((await call(handler, { body: order({ lines: [{ id: "watch-a", qty: 0 }] }) })).status, 400);
  assert.equal((await call(handler, { body: order({ website: "http://spam" }) })).status, 400, "honeypot");
  assert.equal((await db().collection("orders").get()).size, 0);
});

test("rate-limits one connection", async () => {
  const headers = { "x-real-ip": "198.51.100.7" };
  for (let i = 0; i < 8; i++) {
    const res = await call(handler, { body: order({ lines: [{ id: "earring-b", qty: 1 }], token: undefined }), headers });
    assert.equal(res.status, 201, `order ${i + 1}`);
  }
  const blocked = await call(handler, { body: order({ lines: [{ id: "earring-b", qty: 1 }], token: undefined }), headers });
  assert.equal(blocked.status, 429);
  const other = await call(handler, { body: order({ lines: [{ id: "earring-b", qty: 1 }], token: undefined }), headers: { "x-real-ip": "198.51.100.8" } });
  assert.equal(other.status, 201, "a different connection is unaffected");
});

test("customer keys and shipping maths", () => {
  assert.equal(customerKey("70875 11282"), "917087511282");
  assert.equal(customerKey("+91 70875 11282"), "917087511282");
  assert.equal(customerKey("07087511282"), "917087511282");
  assert.equal(customerKey("12345"), null);
  assert.equal(customerKey(""), null);
  assert.equal(shippingFor(500, 1, { flatRate: 0, freeAbove: 0 }), 0);
  assert.equal(shippingFor(500, 1, { flatRate: 120, freeAbove: 0 }), 120);
  assert.equal(shippingFor(5000, 1, { flatRate: 120, freeAbove: 5000 }), 0);
  assert.equal(shippingFor(0, 0, { flatRate: 120, freeAbove: 0 }), 0);
  assert.equal(shippingFor(500, 1, null), 0);
});
