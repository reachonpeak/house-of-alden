/* scripts/setup-firebase.mjs against the emulators: the owner it creates can
   sign in to the admin, and every product it copies out of js/config.js can
   be edited under the security rules.  npm test */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { PROJECT, clearAuth, clearFirestore, signIn } from "./_harness.mjs";

const { auth, db } = await import("../api/_firebase.js");

const script = fileURLToPath(new URL("../scripts/setup-firebase.mjs", import.meta.url));
const OWNER = { email: "owner@example.com", password: "owner-pass-1" };
let env;

const run = (extra = {}) =>
  spawnSync(process.execPath, [script], {
    env: { ...process.env, ADMIN_EMAIL: OWNER.email, ADMIN_PASSWORD: OWNER.password, ...extra },
    encoding: "utf8",
  });

before(async () => {
  await clearFirestore();
  await clearAuth();
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});

after(async () => {
  if (env) await env.cleanup();
});

test("creates the owner and copies the catalogue on an empty database", async () => {
  const out = run();
  assert.equal(out.status, 0, out.stderr || out.stdout);

  const user = await auth().getUserByEmail(OWNER.email);
  assert.deepEqual(user.customClaims, { admin: true, role: "owner" });
  assert.equal((await db().doc(`staff/${user.uid}`).get()).data().role, "owner");
  assert.ok(await signIn(OWNER.email, OWNER.password));

  const products = await db().collection("products").get();
  assert.equal(products.size, 8);
  const vine = (await db().doc("products/vine-chandelier").get()).data();
  assert.equal(vine.trackInventory, true, "sold out in config.js → tracked at 0");
  assert.equal(vine.quantity, 0);
  assert.equal((await db().doc("products/alden-heritage").get()).data().trackInventory, false);
  assert.equal((await db().doc("counters/orders").get()).data().next, 1001);
  assert.equal((await db().doc("settings/store").get()).data().whatsapp, "917087511282");
});

test("every copied product passes the security rules when staff edit it", async () => {
  const user = await auth().getUserByEmail(OWNER.email);
  const staffDb = env.authenticatedContext(user.uid, { admin: true, role: "owner" }).firestore();
  const ids = (await db().collection("products").get()).docs.map((d) => d.id);
  for (const id of ids) {
    await assertSucceeds(updateDoc(doc(staffDb, `products/${id}`), { badge: "New" }));
  }
  const shop = env.unauthenticatedContext().firestore();
  const visible = await getDocs(query(collection(shop, "products"), where("status", "==", "active")));
  assert.equal(visible.size, 8);
});

test("running it again changes nothing it should not", async () => {
  await db().doc("products/alden-heritage").update({ price: 9999 });
  const out = run({ ADMIN_PASSWORD: "" });
  assert.equal(out.status, 0, out.stderr || out.stdout);
  assert.match(out.stdout, /already present — left alone/);
  assert.equal((await db().doc("products/alden-heritage").get()).data().price, 9999);
  assert.ok(await signIn(OWNER.email, OWNER.password), "password kept when none is given");
});
