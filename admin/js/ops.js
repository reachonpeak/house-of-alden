/* ==========================================================================
   HOUSE OF ALDEN ADMIN — every change the admin can make
   --------------------------------------------------------------------------
   Screens call these; nothing else writes to the database. Anything that
   moves stock runs in a transaction, so an order arriving from the website at
   the same moment can never be double-counted. Stock edits are sent as
   increments ("+3"), never as "set to 7", for the same reason.
   ========================================================================== */

import {
  Timestamp,
  arrayUnion,
  auth,
  collection,
  db,
  deleteDoc,
  deleteObject,
  doc,
  getDownloadURL,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
  storage,
  storageRef,
  updateDoc,
  uploadBytesResumable,
  writeBatch,
} from "./fb.js";
import { money, phoneDigits } from "./format.js";
import { state } from "./store.js";

const by = () => (auth.currentUser && auth.currentUser.email) || "Staff";
const event = (type, text) => ({ at: Timestamp.now(), type, text, by: by() });
const orderRef = (id) => doc(db, "orders", id);

/* --- Orders --------------------------------------------------------------- */

export function setPaid(order, paid) {
  return updateDoc(orderRef(order.id), {
    financialStatus: paid ? "paid" : "pending",
    paidAt: paid ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
    timeline: arrayUnion(event(paid ? "paid" : "unpaid", paid ? `Marked as paid (${money(order.total)}).` : "Marked as payment pending.")),
  });
}

export function setFulfilled(order, fulfilled, tracking = null) {
  const clean = tracking && (tracking.number || tracking.carrier || tracking.url)
    ? { carrier: tracking.carrier || "", number: tracking.number || "", url: tracking.url || "" }
    : null;
  const text = fulfilled
    ? `Marked as fulfilled${clean && clean.number ? ` (${[clean.carrier, clean.number].filter(Boolean).join(" ")})` : ""}.`
    : "Marked as unfulfilled.";
  return updateDoc(orderRef(order.id), {
    fulfillmentStatus: fulfilled ? "fulfilled" : "unfulfilled",
    fulfilledAt: fulfilled ? serverTimestamp() : null,
    tracking: fulfilled ? clean : null,
    updatedAt: serverTimestamp(),
    timeline: arrayUnion(event(fulfilled ? "fulfilled" : "unfulfilled", text)),
  });
}

export function setArchived(order, archived) {
  return updateDoc(orderRef(order.id), {
    status: archived ? "archived" : "open",
    updatedAt: serverTimestamp(),
    timeline: arrayUnion(event(archived ? "archived" : "unarchived", archived ? "Order archived." : "Order unarchived.")),
  });
}

export function addComment(order, text) {
  return updateDoc(orderRef(order.id), {
    updatedAt: serverTimestamp(),
    timeline: arrayUnion(event("comment", text)),
  });
}

export function saveOrderNote(order, note) {
  return updateDoc(orderRef(order.id), { note, updatedAt: serverTimestamp() });
}

export function saveOrderCustomer(order, customer) {
  return updateDoc(orderRef(order.id), {
    customer,
    updatedAt: serverTimestamp(),
    timeline: arrayUnion(event("edited", "Contact details or address updated.")),
  });
}

/* Puts the order's reserved units back on the shelf (inside a transaction:
   all reads happen before any write). Returns how many lines went back. */
async function restockReads(tx, o) {
  const lines = o.inventoryReserved ? (o.lines || []).filter((l) => l.reserved && l.productId) : [];
  const snaps = await Promise.all(lines.map((l) => tx.get(doc(db, "products", l.productId))));
  return () => {
    let count = 0;
    lines.forEach((l, i) => {
      const s = snaps[i];
      if (s.exists() && s.data().trackInventory === true) {
        tx.update(s.ref, { quantity: increment(Number(l.qty) || 0) });
        count += 1;
      }
    });
    return count;
  };
}

/** Cancels an order: optionally restocks, voids an unpaid order, refunds a paid one. */
export function cancelOrder(order, { restock = true, reason = "", refund = false } = {}) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef(order.id));
    if (!snap.exists()) throw new Error("This order no longer exists.");
    const o = snap.data();
    if (o.status === "cancelled") throw new Error("This order is already cancelled.");
    const putBack = restock ? await restockReads(tx, o) : () => 0;

    const restocked = putBack() > 0;
    const financial = o.financialStatus === "pending" ? "voided"
      : o.financialStatus === "paid" && refund ? "refunded"
        : o.financialStatus;
    const notes = [
      `Order cancelled${reason ? `: ${reason}` : ""}.`,
      restocked ? "Items restocked." : "",
      financial === "refunded" ? "Marked as refunded." : "",
    ].filter(Boolean).join(" ");

    tx.update(snap.ref, {
      status: "cancelled",
      cancelledAt: serverTimestamp(),
      cancelReason: reason,
      financialStatus: financial,
      inventoryReserved: restock ? false : o.inventoryReserved === true,
      updatedAt: serverTimestamp(),
      timeline: arrayUnion(event("cancelled", notes)),
    });
  });
}

/** Records a refund (money is returned outside the shop) and optionally restocks. */
export function refundOrder(order, { restock = false } = {}) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef(order.id));
    if (!snap.exists()) throw new Error("This order no longer exists.");
    const o = snap.data();
    const putBack = restock ? await restockReads(tx, o) : () => 0;
    const restocked = putBack() > 0;
    tx.update(snap.ref, {
      financialStatus: "refunded",
      refundedAt: serverTimestamp(),
      inventoryReserved: restock ? false : o.inventoryReserved === true,
      updatedAt: serverTimestamp(),
      timeline: arrayUnion(event("refunded", `Marked as refunded (${money(o.total)}).${restocked ? " Items restocked." : ""}`)),
    });
  });
}

export function deleteOrder(order) {
  return deleteDoc(orderRef(order.id));
}

/**
 * Creates an order by hand (a WhatsApp chat, a phone call, a walk-in).
 * lines: [{ productId, qty }] — prices are read from the products in the
 * transaction, exactly as the website's own orders are.
 */
export async function createOrder({ lines, customer, customerId, shipping, paid, note }) {
  const ref = doc(collection(db, "orders"));
  state.localOrders.add(ref.id);
  const custId = customerId || phoneDigits(customer.phone) || null;
  const customerDoc = custId ? doc(db, "customers", custId) : null;
  const counterDoc = doc(db, "counters", "orders");

  await runTransaction(db, async (tx) => {
    const counter = await tx.get(counterDoc);
    const products = await Promise.all(lines.map((l) => tx.get(doc(db, "products", l.productId))));
    const existingCustomer = customerDoc ? await tx.get(customerDoc) : null;

    const problems = [];
    const built = lines.map((l, i) => {
      const s = products[i];
      if (!s.exists()) {
        problems.push("a piece in this order was deleted");
        return null;
      }
      const p = s.data();
      const qty = Math.max(1, Math.floor(Number(l.qty) || 1));
      const tracked = p.trackInventory === true;
      const onHand = Number.isInteger(p.quantity) ? p.quantity : 0;
      if (tracked && p.continueSelling !== true && onHand < qty) problems.push(`only ${Math.max(0, onHand)} of ${p.name} in stock`);
      return {
        productId: s.id,
        name: String(p.name || ""),
        sku: String(p.sku || ""),
        image: (Array.isArray(p.images) && p.images[0] && p.images[0].url) || "",
        price: Number(p.price) || 0,
        qty,
        total: (Number(p.price) || 0) * qty,
        reserved: tracked,
      };
    });
    if (problems.length) throw new Error(`Can't create this order: ${problems.join("; ")}.`);

    const subtotal = built.reduce((n, l) => n + l.total, 0);
    const ship = Math.max(0, Math.round(Number(shipping) || 0));
    const number = counter.exists() && Number.isInteger(counter.data().next) ? counter.data().next : 1001;
    const at = Timestamp.now();

    built.forEach((l, i) => {
      if (l.reserved) tx.update(products[i].ref, { quantity: increment(-l.qty) });
    });
    tx.set(counterDoc, { next: number + 1 }, { merge: true });
    tx.set(ref, {
      number,
      name: `#${number}`,
      source: "admin",
      channel: "manual",
      status: "open",
      financialStatus: paid ? "paid" : "pending",
      fulfillmentStatus: "unfulfilled",
      customer: {
        name: customer.name || "",
        phone: customer.phone || "",
        email: customer.email || "",
        address: customer.address || "",
      },
      customerId: custId,
      customerNote: "",
      note: note || "",
      lines: built,
      itemCount: built.reduce((n, l) => n + l.qty, 0),
      subtotal,
      shipping: ship,
      total: subtotal + ship,
      currency: "INR",
      inventoryReserved: built.some((l) => l.reserved),
      tracking: null,
      paidAt: paid ? serverTimestamp() : null,
      timeline: [
        { at, type: "placed", text: "Order created in the admin.", by: by() },
        ...(paid ? [{ at, type: "paid", text: `Marked as paid (${money(subtotal + ship)}).`, by: by() }] : []),
      ],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (customerDoc) {
      if (existingCustomer && existingCustomer.exists()) {
        const patch = { lastOrderAt: at, updatedAt: serverTimestamp() };
        ["name", "email", "address", "phone"].forEach((k) => {
          if (customer[k]) patch[k] = customer[k];
        });
        tx.set(customerDoc, patch, { merge: true });
      } else {
        tx.set(customerDoc, {
          name: customer.name || "",
          phone: customer.phone || "",
          email: customer.email || "",
          address: customer.address || "",
          note: "",
          tags: [],
          source: "admin",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastOrderAt: at,
        });
      }
    }
  });
  return ref.id;
}

/* --- Products -------------------------------------------------------------- */

/**
 * New product: `data` is the whole document. Existing product: `data` is
 * every field except quantity, and `qtyDelta` carries any stock change.
 */
export async function saveProduct({ id, isNew, data, cost, qtyDelta = 0 }) {
  const batch = writeBatch(db);
  const ref = doc(db, "products", id);
  if (isNew) {
    batch.set(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  } else {
    batch.update(ref, { ...data, ...(qtyDelta ? { quantity: increment(qtyDelta) } : {}), updatedAt: serverTimestamp() });
  }
  batch.set(doc(db, "productCosts", id), { cost: Number.isInteger(cost) ? cost : null, updatedAt: serverTimestamp() });
  await batch.commit();
}

/* A photo still shown on an order (its line keeps the picture) is kept in
   storage even when the product lets go of it. */
function referencedByOrders(url) {
  return state.orders.some((o) => (o.lines || []).some((l) => l.image === url));
}

export async function deleteImages(images) {
  const doomed = (images || []).filter((img) => img && img.path && img.path.startsWith("products/") && !referencedByOrders(img.url));
  await Promise.allSettled(doomed.map((img) => deleteObject(storageRef(storage, img.path))));
}

export async function deleteProduct(product) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "products", product.id));
  batch.delete(doc(db, "productCosts", product.id));
  await batch.commit();
  await deleteImages(product.images);
}

export async function setProductsStatus(ids, status) {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => batch.update(doc(db, "products", id), { status, updatedAt: serverTimestamp() }));
    await batch.commit();
  }
}

export function adjustQuantity(productId, delta) {
  return updateDoc(doc(db, "products", productId), { quantity: increment(delta), updatedAt: serverTimestamp() });
}

/** Turning tracking on needs a real count, or the piece would show as sold out. */
export function setTracking(productId, tracked, quantity) {
  return updateDoc(doc(db, "products", productId), {
    trackInventory: tracked,
    ...(tracked && Number.isInteger(quantity) ? { quantity } : {}),
    updatedAt: serverTimestamp(),
  });
}

/** Uploads a prepared photo (see lib/image.js) into products/<folder>/. */
export function uploadImage(folder, prepared, onProgress) {
  const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  const path = `products/${folder}/${Date.now().toString(36)}-${rand}.${prepared.ext}`;
  const task = uploadBytesResumable(storageRef(storage, path), prepared.blob, {
    contentType: prepared.type,
    /* Every upload gets a new name, so browsers may keep it for a year. */
    cacheControl: "public, max-age=31536000, immutable",
  });
  const promise = new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (s) => onProgress && s.totalBytes && onProgress(s.bytesTransferred / s.totalBytes),
      reject,
      async () => {
        try {
          resolve({ url: await getDownloadURL(task.snapshot.ref), path });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
  return { promise, cancel: () => task.cancel() };
}

/* --- Customers -------------------------------------------------------------- */

export async function saveCustomer(id, data, isNew) {
  const ref = id ? doc(db, "customers", id) : doc(collection(db, "customers"));
  await setDoc(ref, {
    ...data,
    ...(isNew ? { createdAt: serverTimestamp(), source: "admin", tags: data.tags || [] } : {}),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return ref.id;
}

export function deleteCustomer(id) {
  return deleteDoc(doc(db, "customers", id));
}

/* --- Settings ---------------------------------------------------------------- */

export function saveStoreSettings(data) {
  return setDoc(doc(db, "settings", "store"), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export function saveAdminSettings(data) {
  return setDoc(doc(db, "settings", "admin"), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

/* --- Staff (server side: only the Admin SDK may grant access) ---------------- */

export async function staffRequest(method, body) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again.");
  let res;
  try {
    res = await fetch("/api/admin/staff", {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("No connection. Check your internet and try again.");
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data && data.ok) return data;
  if (res.status === 404) throw new Error("The staff service isn't available on this address. It works once the site is deployed on Vercel.");
  throw new Error((data && data.error) || `That didn't work (error ${res.status}).`);
}
