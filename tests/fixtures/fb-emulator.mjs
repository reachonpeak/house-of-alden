/* Stands in for admin/js/fb.js in tests: the same exports, from the npm
   Firebase SDK, pointed at the local emulators instead of Google's CDN. */

import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-house-of-alden";
const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
const [stHost, stPort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199").split(":");

export const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` }, "admin-test");
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
connectFirestoreEmulator(db, fsHost, Number(fsPort));
connectStorageEmulator(storage, stHost, Number(stPort));

export {
  EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut, updatePassword,
} from "firebase/auth";
export {
  Timestamp, arrayUnion, collection, deleteDoc, doc, getDoc, increment, limit, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
export { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from "firebase/storage";
