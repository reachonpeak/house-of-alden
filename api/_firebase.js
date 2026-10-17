/* ==========================================================================
   HOUSE OF ALDEN — Firebase Admin (server only)
   --------------------------------------------------------------------------
   Credentials come from Vercel environment variables and nowhere else. Never
   put the service-account JSON in this repository: every file in the project
   folder is one config mistake away from being served to the public.

   Either set the three variables
     FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
   or one variable holding the whole JSON file
     FIREBASE_SERVICE_ACCOUNT
   ========================================================================== */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function credentials() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (json) {
    const sa = JSON.parse(json);
    return { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key };
  }

  const projectId = (process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  /* Pasted into a dashboard the key usually arrives on one line with literal
     "\n" escapes, and sometimes still wrapped in the quotes from the JSON file.
     Both are undone here so either paste works. */
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey.includes("PRIVATE KEY")) {
    throw new Error(
      "Firebase Admin credentials are missing. Set FIREBASE_PROJECT_ID, " +
        "FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in the Vercel project settings."
    );
  }
  return { projectId, clientEmail, privateKey };
}

function app() {
  const existing = getApps();
  if (existing.length) return existing[0];

  /* The local emulator (tests) needs a project id and nothing else. */
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || "house-of-alden" });
  }

  const c = credentials();
  return initializeApp({ credential: cert(c), projectId: c.projectId });
}

export const db = () => getFirestore(app());
export const auth = () => getAuth(app());
