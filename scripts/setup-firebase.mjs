/* ==========================================================================
   HOUSE OF ALDEN — one-time Firebase setup
   --------------------------------------------------------------------------
   1. Creates the owner's admin account (or repairs it: resets the password if
      one is given, and re-grants admin access).
   2. On an EMPTY database, copies the catalogue and the shop settings out of
      js/config.js into Firestore, so the admin opens with your real pieces.
      Products and settings that already exist are never touched.

   Run from the project folder:

     ADMIN_EMAIL="owner@example.com" ADMIN_PASSWORD="choose-one" \
       node scripts/setup-firebase.mjs --key /path/outside/this/folder/service-account.json

   The service-account key must live OUTSIDE this folder and never be
   committed. --key may be left out if FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL
   and FIREBASE_PRIVATE_KEY are already set in the environment.

   Flags:  --no-seed   only set up the owner account
   ========================================================================== */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : undefined;
};

const keyPath = option("--key");
if (keyPath) process.env.FIREBASE_SERVICE_ACCOUNT = readFileSync(keyPath, "utf8");

const { auth, db } = await import("../api/_firebase.js");
const { FieldValue } = await import("firebase-admin/firestore");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CATEGORIES = new Set(["watches", "earrings"]);

/* --- Owner account ------------------------------------------------------ */

async function ensureOwner(email, password, name) {
  let user = null;
  try {
    user = await auth().getUserByEmail(email);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }

  let action;
  if (!user) {
    if (!password) throw new Error("ADMIN_PASSWORD is required to create the owner account.");
    user = await auth().createUser({ email, password, emailVerified: true, displayName: name });
    action = "created";
  } else if (password) {
    user = await auth().updateUser(user.uid, { password, emailVerified: true });
    action = "password reset";
  } else {
    action = "kept";
  }

  await auth().setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: true, role: "owner" });

  const staffRef = db().doc(`staff/${user.uid}`);
  const staff = await staffRef.get();
  await staffRef.set(
    {
      email,
      name,
      role: "owner",
      ...(staff.exists ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: "setup" }),
    },
    { merge: true }
  );
  return { uid: user.uid, action };
}

/* --- Catalogue out of js/config.js ------------------------------------- */

function loadConfig() {
  const code = readFileSync(join(root, "js", "config.js"), "utf8");
  const sandbox = vm.createContext({});
  return vm.runInContext(`${code}\n;({ BUSINESS, PRODUCTS })`, sandbox, { timeout: 2000 });
}

/* Built from scratch with literals, so nothing from the sandbox's realm
   reaches Firestore (it refuses objects with a foreign prototype). */
function productDoc(p, index) {
  if (!CATEGORIES.has(p.category)) throw new Error(`Product "${p.id}" has an unknown category "${p.category}".`);
  const shots = [p.image, ...(Array.isArray(p.images) ? p.images : [])]
    .filter((s) => typeof s === "string" && s.trim())
    .filter((s, i, all) => all.indexOf(s) === i);

  return {
    name: String(p.name),
    status: "active",
    category: String(p.category),
    price: Math.max(0, Math.round(Number(p.price) || 0)),
    compareAtPrice: null,
    badge: String(p.badge || ""),
    blurb: String(p.blurb || ""),
    description: String(p.description || ""),
    images: shots.map((url, i) => ({ url: String(url), path: "", alt: i === 0 ? String(p.alt || "") : "" })),
    specs: (Array.isArray(p.specs) ? p.specs : [])
      .filter((row) => Array.isArray(row) && row.length >= 2)
      .map(([label, value]) => ({ label: String(label), value: String(value) })),
    sku: "",
    /* config.js only knew "in stock" or "sold out", not how many. Sold-out
       pieces start tracked at 0; the rest start untracked (always buyable,
       exactly as before) until real counts are entered under Inventory. */
    trackInventory: p.stock === false,
    quantity: 0,
    continueSelling: false,
    tags: [],
    position: (index + 1) * 10,
    seoTitle: "",
    seoDescription: "",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function seed() {
  const { BUSINESS, PRODUCTS } = loadConfig();
  const fs = db();
  const done = [];

  const existing = await fs.collection("products").limit(1).get();
  if (existing.empty) {
    const batch = fs.batch();
    PRODUCTS.forEach((p, i) => batch.set(fs.doc(`products/${p.id}`), productDoc(p, i)));
    await batch.commit();
    done.push(`products: copied ${PRODUCTS.length} from js/config.js`);
  } else {
    done.push("products: already present — left alone");
  }

  const createIfMissing = async (path, data, label) => {
    try {
      await fs.doc(path).create(data);
      done.push(`${label}: created`);
    } catch (err) {
      if (err.code !== 6) throw err; // 6 = ALREADY_EXISTS
      done.push(`${label}: already present — left alone`);
    }
  };

  await createIfMissing(
    "settings/store",
    {
      whatsapp: String(BUSINESS.whatsapp || "").replace(/\D/g, ""),
      email: String(BUSINESS.email || ""),
      instagram: String((BUSINESS.social && BUSINESS.social.instagram) || ""),
      pinterest: String((BUSINESS.social && BUSINESS.social.pinterest) || ""),
      shipping: {
        flatRate: Math.max(0, Math.round(Number(BUSINESS.shipping && BUSINESS.shipping.flatRate) || 0)),
        freeAbove: Math.max(0, Math.round(Number(BUSINESS.shipping && BUSINESS.shipping.freeAbove) || 0)),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    "settings/store"
  );
  await createIfMissing("settings/admin", { lowStockThreshold: 2, updatedAt: FieldValue.serverTimestamp() }, "settings/admin");
  await createIfMissing("counters/orders", { next: 1001 }, "counters/orders");
  return done;
}

/* --- Run ----------------------------------------------------------------- */

try {
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("Set ADMIN_EMAIL to the owner's email address.");
  const password = process.env.ADMIN_PASSWORD || "";
  if (password && password.length < 6) throw new Error("ADMIN_PASSWORD must be at least 6 characters.");

  const owner = await ensureOwner(email, password, process.env.ADMIN_NAME || "House of Alden");
  console.log(`owner: ${email} — ${owner.action}, admin access granted (uid ${owner.uid})`);

  if (!flag("--no-seed")) (await seed()).forEach((line) => console.log(line));
  console.log("\nDone. Sign in at /admin.");
  process.exit(0);
} catch (err) {
  console.error(`\nSetup failed: ${err.message}`);
  process.exit(1);
}
