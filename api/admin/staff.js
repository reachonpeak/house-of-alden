/* ==========================================================================
   HOUSE OF ALDEN — /api/admin/staff   (store owner only)
   --------------------------------------------------------------------------
   Admin access is two keys the browser can never set for itself: a custom
   claim on the Firebase account, and a staff/{uid} document. Only the Admin
   SDK can write either, which is why this lives on the server.

     POST   { email, password, name }  add a staff account (or grant access
                                       to an existing account with that email)
     PATCH  { uid, password }          set a new password for a staff member
     DELETE { uid }                    remove a staff member's access

   Removing access deletes the staff document (the database stops answering
   that account at once), strips the claim, and signs the account out
   everywhere.
   ========================================================================== */

import { FieldValue } from "firebase-admin/firestore";
import { auth, db } from "../_firebase.js";
import { HttpError, clean, fail, readJson, requireAdmin, sameOrigin, send } from "../_http.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const MIN_PASSWORD = 8;

function password(value, required) {
  const p = typeof value === "string" ? value : "";
  if (!p && !required) return "";
  if (p.length < MIN_PASSWORD) {
    throw new HttpError(400, `Use a password of at least ${MIN_PASSWORD} characters.`);
  }
  if (p.length > 128) throw new HttpError(400, "That password is too long.");
  return p;
}

function uidFrom(body) {
  const uid = typeof body.uid === "string" ? body.uid : "";
  if (!UID.test(uid)) throw new HttpError(400, "Unknown staff member.");
  return uid;
}

async function findByEmail(email) {
  try {
    return await auth().getUserByEmail(email);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") return null;
    throw err;
  }
}

async function addStaff(me, body) {
  const email = clean(body.email, 254).toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email address.");
  const name = clean(body.name, 80);

  let user = await findByEmail(email);
  if (user) {
    if (user.customClaims && user.customClaims.role === "owner") {
      throw new HttpError(409, "That account is the store owner.");
    }
    const pw = password(body.password, false);
    if (pw) user = await auth().updateUser(user.uid, { password: pw });
  } else {
    user = await auth().createUser({
      email,
      password: password(body.password, true),
      displayName: name || undefined,
    });
  }

  await auth().setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: true, role: "staff" });
  await db().doc(`staff/${user.uid}`).set({
    email,
    name: name || user.displayName || "",
    role: "staff",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: me.email || me.uid,
  });
  return { uid: user.uid };
}

async function staffTarget(me, uid) {
  if (uid === me.uid) throw new HttpError(400, "Use Settings → Account to change your own sign-in.");
  const doc = await db().doc(`staff/${uid}`).get();
  if (!doc.exists) throw new HttpError(404, "Unknown staff member.");
  if (doc.data().role === "owner") throw new HttpError(403, "The owner's account cannot be changed here.");
  return doc;
}

async function setPassword(me, body) {
  const uid = uidFrom(body);
  await staffTarget(me, uid);
  await auth().updateUser(uid, { password: password(body.password, true) });
  await auth().revokeRefreshTokens(uid);
  return { uid };
}

async function removeStaff(me, body) {
  const uid = uidFrom(body);
  await staffTarget(me, uid);
  await db().doc(`staff/${uid}`).delete();
  try {
    const user = await auth().getUser(uid);
    const claims = { ...(user.customClaims || {}) };
    delete claims.admin;
    delete claims.role;
    await auth().setCustomUserClaims(uid, claims);
    await auth().revokeRefreshTokens(uid);
  } catch (err) {
    if (!err || err.code !== "auth/user-not-found") throw err;
  }
  return { uid };
}

export default async function handler(req, res) {
  const run = { POST: addStaff, PATCH: setPassword, DELETE: removeStaff }[req.method];
  if (!run) {
    res.setHeader("Allow", "POST, PATCH, DELETE");
    return send(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (!sameOrigin(req)) return send(res, 403, { ok: false, error: "Not allowed." });

  try {
    const me = await requireAdmin(req, { owner: true });
    const body = await readJson(req, 8 * 1024);
    const result = await run(me, body);
    return send(res, 200, { ok: true, ...result });
  } catch (err) {
    return fail(res, err, "admin/staff");
  }
}
