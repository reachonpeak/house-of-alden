/* Shared helpers for the API tests. They call the real handlers against the
   local Firestore and Auth emulators started by `npm test`. */

import { Readable } from "node:stream";

export const PROJECT = process.env.GCLOUD_PROJECT || "demo-house-of-alden";
process.env.FIREBASE_PROJECT_ID = PROJECT;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Run the API tests with `npm test` — they need the Firebase emulators.");
}

/* Drives a Vercel-style (req, res) handler and resolves with the response. */
export function call(handler, { method = "POST", body, headers = {} } = {}) {
  const payload = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const req = Readable.from(payload ? [Buffer.from(payload)] : []);
  req.method = method;
  req.headers = {
    host: "shop.test",
    origin: "https://shop.test",
    "content-type": "application/json",
    "x-real-ip": "203.0.113.5",
    ...headers,
  };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(data) {
        resolve({ status: this.statusCode, headers: this.headers, body: data ? JSON.parse(data) : null });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

export async function clearFirestore() {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`could not clear Firestore emulator: ${res.status}`);
}

export async function clearAuth() {
  const url = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`could not clear Auth emulator: ${res.status}`);
}

/* Signs in through the Auth emulator's REST API and returns an ID token. */
export async function signIn(email, password) {
  const url = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`sign-in failed: ${JSON.stringify(data)}`);
  return data.idToken;
}
