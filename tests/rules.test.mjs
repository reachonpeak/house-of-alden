/* Firestore + Storage security rules, run against the local emulators.
   npm test   (needs Java for the emulators) */

import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-house-of-alden";
let env;

const product = (over = {}) => ({
  name: "The Alden Heritage",
  status: "active",
  category: "watches",
  price: 8900,
  compareAtPrice: null,
  badge: "",
  blurb: "",
  description: "",
  images: [{ url: "images/watch-alden-heritage.webp", path: "", alt: "A watch" }],
  specs: [{ label: "Case", value: "38 mm" }],
  sku: "AH-1",
  trackInventory: true,
  quantity: 4,
  continueSelling: false,
  tags: [],
  position: 10,
  seoTitle: "",
  seoDescription: "",
  ...over,
});

const order = (over = {}) => ({
  number: 1001,
  name: "#1001",
  source: "admin",
  status: "open",
  financialStatus: "pending",
  fulfillmentStatus: "unfulfilled",
  customer: { name: "Asha", phone: "", email: "", address: "" },
  lines: [{ productId: "alden-heritage", name: "The Alden Heritage", price: 8900, qty: 1, total: 8900 }],
  subtotal: 8900,
  shipping: 0,
  total: 8900,
  timeline: [],
  note: "",
  ...over,
});

const owner = () => env.authenticatedContext("owner", { admin: true, role: "owner" });
const claimOnly = () => env.authenticatedContext("ghost", { admin: true, role: "staff" });
const shopper = () => env.authenticatedContext("shopper", {});
const anon = () => env.unauthenticatedContext();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../storage.rules", import.meta.url), "utf8") },
  });
});

after(async () => {
  if (env) await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "products/alden-heritage"), product());
    await setDoc(doc(db, "products/secret-draft"), product({ status: "draft", name: "Unreleased" }));
    await setDoc(doc(db, "productCosts/alden-heritage"), { cost: 3100 });
    await setDoc(doc(db, "staff/owner"), { role: "owner", email: "owner@example.com" });
    await setDoc(doc(db, "settings/store"), {
      whatsapp: "917087511282",
      email: "shop@example.com",
      instagram: "https://instagram.com/",
      pinterest: "",
      shipping: { flatRate: 0, freeAbove: 0 },
    });
    await setDoc(doc(db, "settings/admin"), { lowStockThreshold: 2 });
    await setDoc(doc(db, "orders/o1"), order());
    await setDoc(doc(db, "customers/917087511282"), { name: "Asha", phone: "+91 70875 11282" });
    await setDoc(doc(db, "counters/orders"), { next: 1002 });
  });
});

/* --- The shop window --------------------------------------------------- */

test("anyone can read an active product, but not a draft", async () => {
  const db = anon().firestore();
  await assertSucceeds(getDoc(doc(db, "products/alden-heritage")));
  await assertFails(getDoc(doc(db, "products/secret-draft")));
});

test("the shop's query for active products is allowed; an unfiltered list is not", async () => {
  const db = anon().firestore();
  await assertSucceeds(getDocs(query(collection(db, "products"), where("status", "==", "active"))));
  await assertFails(getDocs(collection(db, "products")));
});

test("anyone can read the public store settings, nothing else", async () => {
  const db = anon().firestore();
  await assertSucceeds(getDoc(doc(db, "settings/store")));
  await assertFails(getDoc(doc(db, "settings/admin")));
  await assertFails(getDoc(doc(db, "productCosts/alden-heritage")));
  await assertFails(getDoc(doc(db, "orders/o1")));
  await assertFails(getDoc(doc(db, "customers/917087511282")));
  await assertFails(getDoc(doc(db, "staff/owner")));
});

test("shoppers can never write", async () => {
  for (const ctx of [anon(), shopper()]) {
    const db = ctx.firestore();
    await assertFails(setDoc(doc(db, "products/new-one"), product()));
    await assertFails(updateDoc(doc(db, "products/alden-heritage"), { price: 1 }));
    await assertFails(setDoc(doc(db, "orders/x"), order()));
    await assertFails(setDoc(doc(db, "settings/store"), { whatsapp: "1" }));
    await assertFails(setDoc(doc(db, "staff/shopper"), { role: "owner" }));
  }
});

/* --- Staff ------------------------------------------------------------- */

test("an admin claim without a staff record opens nothing", async () => {
  const db = claimOnly().firestore();
  await assertFails(getDoc(doc(db, "orders/o1")));
  await assertFails(getDoc(doc(db, "products/secret-draft")));
  await assertFails(updateDoc(doc(db, "products/alden-heritage"), { price: 1 }));
});

test("staff can read the back office", async () => {
  const db = owner().firestore();
  await assertSucceeds(getDocs(collection(db, "products")));
  await assertSucceeds(getDoc(doc(db, "products/secret-draft")));
  await assertSucceeds(getDocs(collection(db, "orders")));
  await assertSucceeds(getDocs(collection(db, "customers")));
  await assertSucceeds(getDoc(doc(db, "settings/admin")));
  await assertSucceeds(getDoc(doc(db, "productCosts/alden-heritage")));
  await assertSucceeds(getDocs(collection(db, "staff")));
});

test("staff can create a valid product and adjust stock", async () => {
  const db = owner().firestore();
  await assertSucceeds(setDoc(doc(db, "products/pearl-drop"), product({ name: "Pearl Drop", category: "earrings" })));
  await assertSucceeds(updateDoc(doc(db, "products/alden-heritage"), { quantity: increment(-2) }));
  await assertSucceeds(deleteDoc(doc(db, "products/secret-draft")));
});

test("malformed products are refused even for staff", async () => {
  const db = owner().firestore();
  await assertFails(setDoc(doc(db, "products/Bad Id"), product()));
  await assertFails(setDoc(doc(db, "products/p1"), product({ price: "8900" })));
  await assertFails(setDoc(doc(db, "products/p2"), product({ price: 89.5 })));
  await assertFails(setDoc(doc(db, "products/p3"), product({ price: -1 })));
  await assertFails(setDoc(doc(db, "products/p4"), product({ category: "rings" })));
  await assertFails(setDoc(doc(db, "products/p5"), product({ status: "live" })));
  await assertFails(setDoc(doc(db, "products/p6"), product({ name: "" })));
  await assertFails(setDoc(doc(db, "products/p7"), product({ badge: "x".repeat(40) })));
  const { quantity, ...noQty } = product();
  await assertFails(setDoc(doc(db, "products/p8"), noQty));
});

test("store settings reject a non-https social link and a bad WhatsApp number", async () => {
  const db = owner().firestore();
  const base = { whatsapp: "917087511282", email: "", instagram: "", pinterest: "", shipping: { flatRate: 0, freeAbove: 0 } };
  await assertSucceeds(setDoc(doc(db, "settings/store"), { ...base, instagram: "https://instagram.com/houseofalden" }));
  await assertFails(setDoc(doc(db, "settings/store"), { ...base, instagram: "javascript:alert(1)" }));
  await assertFails(setDoc(doc(db, "settings/store"), { ...base, whatsapp: "+91 70875" }));
  await assertFails(setDoc(doc(db, "settings/store"), { ...base, shipping: { flatRate: -5, freeAbove: 0 } }));
});

test("only the owner can change the store settings (where orders go)", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "staff/helper"), { role: "staff", email: "helper@example.com" }));
  const staffDb = env.authenticatedContext("helper", { admin: true, role: "staff" }).firestore();
  await assertFails(updateDoc(doc(staffDb, "settings/store"), { whatsapp: "919999999999" }));
  await assertSucceeds(updateDoc(doc(staffDb, "settings/admin"), { lowStockThreshold: 3 }));
  await assertSucceeds(updateDoc(doc(staffDb, "orders/o1"), { financialStatus: "paid" }));
  await assertSucceeds(updateDoc(doc(owner().firestore(), "settings/store"), { whatsapp: "919999999999" }));
});

test("orders: staff may update but never renumber", async () => {
  const db = owner().firestore();
  await assertSucceeds(updateDoc(doc(db, "orders/o1"), { financialStatus: "paid" }));
  await assertFails(updateDoc(doc(db, "orders/o1"), { number: 7 }));
  await assertFails(updateDoc(doc(db, "orders/o1"), { financialStatus: "maybe" }));
  await assertSucceeds(setDoc(doc(db, "orders/o2"), order({ number: 1002, name: "#1002" })));
});

test("staff records and rate limits are server-only", async () => {
  const db = owner().firestore();
  await assertFails(setDoc(doc(db, "staff/someone"), { role: "staff" }));
  await assertFails(deleteDoc(doc(db, "staff/owner")));
  await assertFails(getDoc(doc(db, "ratelimits/abc")));
});

/* --- Product photographs ------------------------------------------------ */

const bytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]);

test("only staff can upload, and only real image types", async () => {
  const path = "products/alden-heritage/1700000000-abc.webp";
  await assertFails(uploadBytes(ref(anon().storage(), path), bytes, { contentType: "image/webp" }));
  await assertFails(uploadBytes(ref(claimOnly().storage(), "products/alden-heritage/x.svg"), bytes, { contentType: "image/svg+xml" }));
  await assertFails(uploadBytes(ref(owner().storage(), "uploads/x.webp"), bytes, { contentType: "image/webp" }));
  await assertFails(uploadBytes(ref(owner().storage(), "products/Bad Folder/x.webp"), bytes, { contentType: "image/webp" }));
  await assertSucceeds(uploadBytes(ref(owner().storage(), path), bytes, { contentType: "image/webp" }));
});

test("anyone can view a product photograph; only staff can delete it", async () => {
  const path = "products/alden-heritage/1700000000-def.jpg";
  await assertSucceeds(uploadBytes(ref(owner().storage(), path), bytes, { contentType: "image/jpeg" }));
  await assertSucceeds(getBytes(ref(anon().storage(), path)));
  await assertFails(deleteObject(ref(anon().storage(), path)));
  await assertSucceeds(deleteObject(ref(owner().storage(), path)));
});
