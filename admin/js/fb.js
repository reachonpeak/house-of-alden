/* ==========================================================================
   HOUSE OF ALDEN ADMIN — Firebase
   --------------------------------------------------------------------------
   One app, one sign-in, one database, one photo bucket. The SDK comes from
   Google's CDN at an exact version — the same one the shop loads (js/live.js).

   Sign-in is kept in IndexedDB so staff stay signed in across visits, the way
   Shopify does. No popup/redirect resolver is installed: that would load
   Google's sign-in iframe and scripts on every visit, and email + password
   needs neither.
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  browserLocalPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

const config = window.HOA_FIREBASE;
if (!config || !config.projectId) {
  throw new Error("Firebase settings missing: /js/firebase-config.js did not load.");
}

export const app = initializeApp(config, "admin");
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
export const db = getFirestore(app);
export const storage = getStorage(app);

export {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

export {
  Timestamp,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

export {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";
