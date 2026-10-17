/* ==========================================================================
   HOUSE OF ALDEN — Firebase web settings
   --------------------------------------------------------------------------
   These values identify the Firebase project to the browser. They are PUBLIC
   by design — Google's own docs say so — and every visitor can read them.
   What keeps the data safe is not hiding this file but the security rules
   (firestore.rules, storage.rules), which decide what each visitor may do.

   The SECRET half — the service-account key used by /api — lives only in
   Vercel's environment variables. It must never be pasted here.
   ========================================================================== */

window.HOA_FIREBASE = {
  apiKey: "AIzaSyAoj_iOShHNM9d570BIICuvoINsiXfb0rA",
  authDomain: "house-of-alden.firebaseapp.com",
  projectId: "house-of-alden",
  storageBucket: "house-of-alden.firebasestorage.app",
  messagingSenderId: "728551700764",
  appId: "1:728551700764:web:1ac9c1cf8e4d90983822d9",
};
