/* /api/admin/staff against the Auth and Firestore emulators.  npm test */

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { call, clearAuth, clearFirestore, signIn } from "./_harness.mjs";

const { default: handler } = await import("../api/admin/staff.js");
const { auth, db } = await import("../api/_firebase.js");

const OWNER = { email: "owner@example.com", password: "owner-pass-1" };
let ownerUid;

async function makeAdmin({ email, password }, role) {
  const user = await auth().createUser({ email, password });
  await auth().setCustomUserClaims(user.uid, { admin: true, role });
  await db().doc(`staff/${user.uid}`).set({ email, role });
  return user.uid;
}

const bearer = (token) => ({ authorization: `Bearer ${token}` });

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  ownerUid = await makeAdmin(OWNER, "owner");
});

test("the owner can add a staff member", async () => {
  const token = await signIn(OWNER.email, OWNER.password);
  const res = await call(handler, {
    body: { email: "Staff@Example.com", password: "staff-pass-1", name: "Parvinder" },
    headers: bearer(token),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const user = await auth().getUser(res.body.uid);
  assert.equal(user.email, "staff@example.com");
  assert.deepEqual(user.customClaims, { admin: true, role: "staff" });
  const staff = (await db().doc(`staff/${res.body.uid}`).get()).data();
  assert.equal(staff.role, "staff");
  assert.equal(staff.name, "Parvinder");
  assert.ok(await signIn("staff@example.com", "staff-pass-1"));
});

test("staff cannot add staff; strangers cannot either", async () => {
  await makeAdmin({ email: "staff@example.com", password: "staff-pass-1" }, "staff");
  const staffToken = await signIn("staff@example.com", "staff-pass-1");
  const body = { email: "new@example.com", password: "new-pass-12" };
  assert.equal((await call(handler, { body, headers: bearer(staffToken) })).status, 403);
  assert.equal((await call(handler, { body })).status, 401);
  assert.equal((await call(handler, { body, headers: bearer("not-a-token") })).status, 401);

  await auth().createUser({ email: "shopper@example.com", password: "shopper-pass" });
  const shopperToken = await signIn("shopper@example.com", "shopper-pass");
  assert.equal((await call(handler, { body, headers: bearer(shopperToken) })).status, 403);
});

test("a claim without a staff record is not enough", async () => {
  const user = await auth().createUser({ email: "ghost@example.com", password: "ghost-pass-1" });
  await auth().setCustomUserClaims(user.uid, { admin: true, role: "owner" });
  const token = await signIn("ghost@example.com", "ghost-pass-1");
  const res = await call(handler, { body: { email: "x@example.com", password: "xxxxxxxx" }, headers: bearer(token) });
  assert.equal(res.status, 403);
});

test("passwords must be long enough", async () => {
  const token = await signIn(OWNER.email, OWNER.password);
  const res = await call(handler, { body: { email: "short@example.com", password: "123" }, headers: bearer(token) });
  assert.equal(res.status, 400);
});

test("the owner can reset a staff password and remove access", async () => {
  const staffUid = await makeAdmin({ email: "staff@example.com", password: "staff-pass-1" }, "staff");
  const token = await signIn(OWNER.email, OWNER.password);

  const reset = await call(handler, { method: "PATCH", body: { uid: staffUid, password: "brand-new-pass" }, headers: bearer(token) });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.ok(await signIn("staff@example.com", "brand-new-pass"));

  const removed = await call(handler, { method: "DELETE", body: { uid: staffUid }, headers: bearer(token) });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal((await db().doc(`staff/${staffUid}`).get()).exists, false);
  const user = await auth().getUser(staffUid);
  assert.equal(user.customClaims && user.customClaims.admin, undefined);
});

test("nobody can remove the owner or themselves", async () => {
  const token = await signIn(OWNER.email, OWNER.password);
  const self = await call(handler, { method: "DELETE", body: { uid: ownerUid }, headers: bearer(token) });
  assert.equal(self.status, 400);
  assert.equal((await db().doc(`staff/${ownerUid}`).get()).exists, true);
});

test("refuses other sites and other methods", async () => {
  const token = await signIn(OWNER.email, OWNER.password);
  const body = { email: "x@example.com", password: "xxxxxxxx" };
  assert.equal((await call(handler, { body, headers: { ...bearer(token), origin: "https://evil.test" } })).status, 403);
  assert.equal((await call(handler, { method: "GET", headers: bearer(token) })).status, 405);
});
