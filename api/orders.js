/* ==========================================================================
   HOUSE OF ALDEN — POST /api/orders
   --------------------------------------------------------------------------
   Records a shop order before the customer is handed to WhatsApp.

   The browser sends only WHAT it wants ({id, qty} per line) and who it is.
   Every price, the shipping charge, the total and the stock check are read
   from the database here — a shopper can edit anything in their own browser,
   so nothing it says about money is believed.

   In one transaction: check the rate limit, read each product, refuse if any
   tracked piece is short, take the next order number, reduce stock, write the
   order and the customer record. Either all of it happens or none of it does.

   Idempotent: the cart sends a random checkout token, and the order is stored
   under it. Sending the same token twice (a retry after a dropped connection)
   returns the first order instead of creating — and charging stock for — a
   second one.
   ========================================================================== */

import crypto from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./_firebase.js";
import { HttpError, clean, clientIp, fail, readJson, sameOrigin, send } from "./_http.js";

const MAX_LINES = 25;
const MAX_QTY = 99; // matches the ceiling js/cart.js enforces
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 8; // orders per connection per window
const FIRST_ORDER_NUMBER = 1001;

const PRODUCT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* --- Input -------------------------------------------------------------- */

function parse(body) {
  /* A form field no person ever sees. Only a bot fills it in. */
  if (body.website) throw new HttpError(400, "That order could not be read.");

  const raw = Array.isArray(body.lines) ? body.lines : [];
  if (!raw.length) throw new HttpError(400, "Your cart is empty.");
  if (raw.length > MAX_LINES) throw new HttpError(400, "That is more pieces than one order can hold.");

  const merged = new Map();
  for (const line of raw) {
    const id = line && typeof line.id === "string" ? line.id : "";
    const qty = Math.floor(Number(line && line.qty));
    if (!PRODUCT_ID.test(id) || !Number.isFinite(qty) || qty < 1) {
      throw new HttpError(400, "That order could not be read.");
    }
    merged.set(id, Math.min(MAX_QTY, (merged.get(id) || 0) + qty));
  }

  const c = body.customer && typeof body.customer === "object" ? body.customer : {};
  const email = clean(c.email, 254);
  const customer = {
    name: clean(c.name, 100),
    phone: clean(c.phone, 32),
    email: EMAIL.test(email) ? email : "",
    address: clean(c.address, 600),
  };

  return {
    lines: [...merged].map(([id, qty]) => ({ id, qty })),
    customer,
    note: clean(c.notes, 1000),
    token: typeof body.token === "string" && TOKEN.test(body.token) ? body.token : null,
  };
}

/* One customer record per phone number. A ten-digit number is an Indian
   mobile written without its country code; anything that does not reduce to
   a plausible international number gets no record (the order still stands). */
export function customerKey(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/* Same rule as Cart.totals() in js/cart.js — keep the two in step. */
export function shippingFor(subtotal, lineCount, shipping) {
  const flatRate = Number.isInteger(shipping && shipping.flatRate) ? shipping.flatRate : 0;
  const freeAbove = Number.isInteger(shipping && shipping.freeAbove) ? shipping.freeAbove : 0;
  if (lineCount === 0 || flatRate === 0 || (freeAbove > 0 && subtotal >= freeAbove)) return 0;
  return flatRate;
}

function summary(id, d) {
  return {
    id,
    number: d.number,
    name: d.name,
    lines: (d.lines || []).map((l) => ({ id: l.productId, name: l.name, qty: l.qty, price: l.price, total: l.total })),
    subtotal: d.subtotal,
    shipping: d.shipping,
    total: d.total,
    currency: d.currency || "INR",
  };
}

function firstImage(p) {
  const img = Array.isArray(p.images) ? p.images.find((i) => i && typeof i.url === "string" && i.url) : null;
  return img ? img.url : "";
}

/* --- The transaction ---------------------------------------------------- */

async function place(order, ip) {
  const fs = db();
  const ipKey = crypto.createHash("sha256").update(`orders:${ip}`).digest("hex").slice(0, 40);
  const custId = customerKey(order.customer.phone);

  const orderRef = order.token ? fs.doc(`orders/web-${order.token}`) : fs.collection("orders").doc();
  const rateRef = fs.doc(`ratelimits/${ipKey}`);
  const counterRef = fs.doc("counters/orders");
  const settingsRef = fs.doc("settings/store");
  const customerRef = custId ? fs.doc(`customers/${custId}`) : null;
  const productRefs = order.lines.map((l) => fs.doc(`products/${l.id}`));

  return fs.runTransaction(async (tx) => {
    /* ---- Reads (all of them before any write) ---- */
    if (order.token) {
      const prior = await tx.get(orderRef);
      if (prior.exists) return { replay: true, order: summary(prior.id, prior.data()) };
    }

    const fixed = [rateRef, counterRef, settingsRef];
    if (customerRef) fixed.push(customerRef);
    const snaps = await tx.getAll(...fixed, ...productRefs);
    const [rate, counter, settings] = snaps;
    const customerSnap = customerRef ? snaps[3] : null;
    const productSnaps = snaps.slice(fixed.length);

    const now = Date.now();
    const rateData = rate.exists ? rate.data() : null;
    const windowStart = rateData && rateData.windowStart ? rateData.windowStart.toMillis() : 0;
    const inWindow = now - windowStart < RATE_WINDOW_MS;
    const used = inWindow && rateData ? Number(rateData.count) || 0 : 0;
    if (used >= RATE_MAX) {
      throw new HttpError(429, "Too many orders from this connection. Please message us on WhatsApp instead.");
    }

    const lines = [];
    const short = [];
    order.lines.forEach((want, i) => {
      const p = productSnaps[i].exists ? productSnaps[i].data() : null;
      const price = p && Number.isInteger(p.price) && p.price >= 0 ? p.price : null;
      if (!p || p.status !== "active" || price === null) {
        short.push({ id: want.id, name: (p && p.name) || "A piece in your cart", available: 0 });
        return;
      }
      const tracked = p.trackInventory === true;
      const onHand = Number.isInteger(p.quantity) ? p.quantity : 0;
      if (tracked && p.continueSelling !== true && onHand < want.qty) {
        short.push({ id: want.id, name: String(p.name), available: Math.max(0, onHand) });
        return;
      }
      lines.push({
        productId: want.id,
        name: String(p.name),
        sku: String(p.sku || ""),
        image: firstImage(p),
        price,
        qty: want.qty,
        total: price * want.qty,
        reserved: tracked,
      });
    });

    if (short.length) {
      const what = short
        .map((s) => (s.available > 0 ? `only ${s.available} of ${s.name} left` : `${s.name} is no longer available`))
        .join("; ");
      throw new HttpError(409, `Sorry — ${what}. Please update your cart.`, { code: "stock", items: short });
    }

    const subtotal = lines.reduce((n, l) => n + l.total, 0);
    const shipping = shippingFor(subtotal, lines.length, settings.exists ? settings.data().shipping : null);
    const total = subtotal + shipping;
    const counterData = counter.exists ? counter.data() : null;
    const number = counterData && Number.isInteger(counterData.next) ? counterData.next : FIRST_ORDER_NUMBER;
    const at = Timestamp.now();

    const data = {
      number,
      name: `#${number}`,
      source: "web",
      channel: "whatsapp",
      status: "open",
      financialStatus: "pending",
      fulfillmentStatus: "unfulfilled",
      customer: order.customer,
      customerId: custId,
      customerNote: order.note,
      note: "",
      lines,
      itemCount: lines.reduce((n, l) => n + l.qty, 0),
      subtotal,
      shipping,
      total,
      currency: "INR",
      inventoryReserved: lines.some((l) => l.reserved),
      tracking: null,
      timeline: [{ at, type: "placed", text: "Order placed on the website and sent on WhatsApp.", by: "Customer" }],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    /* ---- Writes ---- */
    lines.forEach((l, i) => {
      if (l.reserved) tx.update(productRefs[i], { quantity: FieldValue.increment(-l.qty) });
    });
    tx.set(counterRef, { next: number + 1 }, { merge: true });
    tx.create(orderRef, data);
    tx.set(rateRef, {
      count: used + 1,
      windowStart: inWindow && rateData ? rateData.windowStart : at,
      expiresAt: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
    });

    if (customerRef) {
      if (customerSnap.exists) {
        /* Anyone can type any phone number at checkout, so a web order may
           only FILL IN what the record is missing — never overwrite a name or
           address staff already have. (The order keeps its own copy of what
           was typed; staff can update the customer by hand.) */
        const known = customerSnap.data();
        const patch = { lastOrderAt: at, updatedAt: FieldValue.serverTimestamp() };
        ["name", "email", "address"].forEach((k) => {
          if (order.customer[k] && !known[k]) patch[k] = order.customer[k];
        });
        tx.set(customerRef, patch, { merge: true });
      } else {
        tx.set(customerRef, {
          name: order.customer.name,
          phone: order.customer.phone,
          email: order.customer.email,
          address: order.customer.address,
          note: "",
          tags: [],
          source: "web",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastOrderAt: at,
        });
      }
    }

    return { replay: false, order: summary(orderRef.id, data) };
  });
}

/* --- Handler ------------------------------------------------------------ */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (!sameOrigin(req)) return send(res, 403, { ok: false, error: "Not allowed." });

  try {
    const order = parse(await readJson(req, 32 * 1024));
    const result = await place(order, clientIp(req));
    return send(res, result.replay ? 200 : 201, { ok: true, order: result.order });
  } catch (err) {
    return fail(res, err, "orders");
  }
}
